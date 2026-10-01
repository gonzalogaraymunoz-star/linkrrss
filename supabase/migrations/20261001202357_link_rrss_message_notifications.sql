create table if not exists public.link_rrss_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.link_world_businesses(id) on delete cascade,
  account_id uuid references public.link_rrss_accounts(id) on delete cascade,
  conversation_id uuid references public.link_rrss_conversations(id) on delete cascade,
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  notification_type text not null default 'new_message',
  title text not null,
  body text,
  external_event_key text not null unique,
  is_read boolean not null default false,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists link_rrss_notifications_business_created_idx
  on public.link_rrss_notifications (business_id, created_at desc);

create index if not exists link_rrss_notifications_assignee_unread_idx
  on public.link_rrss_notifications (assigned_to_user_id, is_read, created_at desc);

alter table public.link_rrss_notifications enable row level security;
grant select, insert, update, delete on public.link_rrss_notifications to authenticated;

drop policy if exists "link members read rrss notifications" on public.link_rrss_notifications;
create policy "link members read rrss notifications"
on public.link_rrss_notifications for select
to authenticated
using ((select public.link_world_is_member()));

drop policy if exists "link members update rrss notifications" on public.link_rrss_notifications;
create policy "link members update rrss notifications"
on public.link_rrss_notifications for update
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

create or replace function public.link_rrss_enqueue_message_notification()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_business_id uuid;
  v_assignee uuid;
  v_account_username text;
  v_event_key text;
begin
  if coalesce(new.unread_count,0) <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (
    new.last_message_at is distinct from old.last_message_at
    or coalesce(new.unread_count,0) > coalesce(old.unread_count,0)
  ) then
    return new;
  end if;

  select p.business_id, a.username
  into v_business_id, v_account_username
  from public.link_rrss_accounts a
  join public.link_rrss_sources s on s.id=a.source_id
  join public.link_rrss_profiles p on p.id=s.profile_id
  where a.id=new.account_id;

  if v_business_id is null then
    return new;
  end if;

  select op.operator_user_id
  into v_assignee
  from public.link_rrss_operation_plans op
  where op.business_id=v_business_id
    and op.status='active'
    and current_date between op.period_start and op.period_end
  order by op.period_start desc
  limit 1;

  v_event_key :=
    new.id::text || ':' ||
    coalesce(new.last_message_at::text, new.updated_at::text, now()::text) || ':' ||
    coalesce(new.unread_count,0)::text;

  insert into public.link_rrss_notifications(
    business_id, account_id, conversation_id, assigned_to_user_id,
    notification_type, title, body, external_event_key, metadata
  ) values (
    v_business_id,
    new.account_id,
    new.id,
    v_assignee,
    'new_message',
    coalesce(new.participant_name,new.participant_username,'Nuevo mensaje'),
    nullif(new.last_message,''),
    v_event_key,
    jsonb_build_object(
      'participant_username',new.participant_username,
      'platform_url',new.platform_url,
      'account_username',v_account_username,
      'unread_count',new.unread_count,
      'last_message_at',new.last_message_at
    )
  )
  on conflict (external_event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists link_rrss_conversation_message_alert on public.link_rrss_conversations;
create trigger link_rrss_conversation_message_alert
after insert or update of unread_count,last_message,last_message_at
on public.link_rrss_conversations
for each row
execute function public.link_rrss_enqueue_message_notification();

revoke all on function public.link_rrss_enqueue_message_notification() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='link_rrss_notifications'
  ) then
    alter publication supabase_realtime add table public.link_rrss_notifications;
  end if;
end $$;

insert into public.link_rrss_notifications(
  business_id, account_id, conversation_id, assigned_to_user_id,
  notification_type, title, body, external_event_key, metadata
)
select
  p.business_id,
  c.account_id,
  c.id,
  op.operator_user_id,
  'new_message',
  coalesce(c.participant_name,c.participant_username,'Nuevo mensaje'),
  nullif(c.last_message,''),
  c.id::text || ':' || coalesce(c.last_message_at::text,c.updated_at::text) || ':' || coalesce(c.unread_count,0)::text,
  jsonb_build_object(
    'participant_username',c.participant_username,
    'platform_url',c.platform_url,
    'account_username',a.username,
    'unread_count',c.unread_count,
    'last_message_at',c.last_message_at
  )
from public.link_rrss_conversations c
join public.link_rrss_accounts a on a.id=c.account_id
join public.link_rrss_sources s on s.id=a.source_id
join public.link_rrss_profiles p on p.id=s.profile_id
left join lateral (
  select operator_user_id
  from public.link_rrss_operation_plans op
  where op.business_id=p.business_id
    and op.status='active'
    and current_date between op.period_start and op.period_end
  order by op.period_start desc
  limit 1
) op on true
where coalesce(c.unread_count,0) > 0
on conflict (external_event_key) do nothing;
