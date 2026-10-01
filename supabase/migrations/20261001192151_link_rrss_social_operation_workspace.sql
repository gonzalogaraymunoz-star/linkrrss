create table if not exists public.link_rrss_operation_plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.link_world_businesses(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'active'
    check (status in ('draft','active','paused','closed')),
  client_fee_clp integer not null default 0 check (client_fee_clp >= 0),
  operator_fee_clp integer not null default 0 check (operator_fee_clp >= 0),
  operator_name text,
  objective text,
  deliverables jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_rrss_operation_plans_period_check check (period_end >= period_start),
  constraint link_rrss_operation_plans_business_period_unique unique (business_id, period_start)
);

create table if not exists public.link_rrss_operation_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.link_rrss_operation_plans(id) on delete cascade,
  business_id uuid not null references public.link_world_businesses(id) on delete cascade,
  account_id uuid references public.link_rrss_accounts(id) on delete set null,
  title text not null,
  content_type text not null default 'post',
  channel text,
  planned_at timestamptz,
  status text not null default 'planned'
    check (status in ('planned','in_progress','awaiting_proof','verified','cancelled')),
  linked_post_id uuid references public.link_rrss_posts(id) on delete set null,
  proof_type text,
  proof_url text,
  proof_note text,
  proof_metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_rrss_operation_tasks_verified_requires_evidence
    check (
      status <> 'verified'
      or linked_post_id is not null
      or nullif(btrim(coalesce(proof_url,'')), '') is not null
    )
);

create index if not exists link_rrss_operation_plans_business_period_idx
  on public.link_rrss_operation_plans (business_id, period_start desc);

create index if not exists link_rrss_operation_tasks_business_planned_idx
  on public.link_rrss_operation_tasks (business_id, planned_at desc);

create index if not exists link_rrss_operation_tasks_plan_status_idx
  on public.link_rrss_operation_tasks (plan_id, status);

alter table public.link_rrss_operation_plans enable row level security;
alter table public.link_rrss_operation_tasks enable row level security;

grant select, insert, update, delete on public.link_rrss_operation_plans to authenticated;
grant select, insert, update, delete on public.link_rrss_operation_tasks to authenticated;

drop policy if exists "link members read rrss operation plans" on public.link_rrss_operation_plans;
create policy "link members read rrss operation plans"
on public.link_rrss_operation_plans for select
to authenticated
using ((select public.link_world_is_member()));

drop policy if exists "link members insert rrss operation plans" on public.link_rrss_operation_plans;
create policy "link members insert rrss operation plans"
on public.link_rrss_operation_plans for insert
to authenticated
with check ((select public.link_world_is_member()));

drop policy if exists "link members update rrss operation plans" on public.link_rrss_operation_plans;
create policy "link members update rrss operation plans"
on public.link_rrss_operation_plans for update
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "link members delete rrss operation plans" on public.link_rrss_operation_plans;
create policy "link members delete rrss operation plans"
on public.link_rrss_operation_plans for delete
to authenticated
using ((select public.link_world_is_member()));

drop policy if exists "link members read rrss operation tasks" on public.link_rrss_operation_tasks;
create policy "link members read rrss operation tasks"
on public.link_rrss_operation_tasks for select
to authenticated
using ((select public.link_world_is_member()));

drop policy if exists "link members insert rrss operation tasks" on public.link_rrss_operation_tasks;
create policy "link members insert rrss operation tasks"
on public.link_rrss_operation_tasks for insert
to authenticated
with check ((select public.link_world_is_member()));

drop policy if exists "link members update rrss operation tasks" on public.link_rrss_operation_tasks;
create policy "link members update rrss operation tasks"
on public.link_rrss_operation_tasks for update
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "link members delete rrss operation tasks" on public.link_rrss_operation_tasks;
create policy "link members delete rrss operation tasks"
on public.link_rrss_operation_tasks for delete
to authenticated
using ((select public.link_world_is_member()));

insert into public.link_rrss_operation_plans (
  business_id, period_start, period_end, status,
  client_fee_clp, operator_fee_clp, objective, deliverables, notes
)
values (
  '31333b84-79fa-4c52-b974-977145ec9e9a'::uuid,
  date '2026-10-01',
  date '2026-10-31',
  'active',
  750000,
  250000,
  'Piloto de cobertura social LINK: producir, publicar, comprobar y estudiar el trabajo para convertirlo en un sistema replicable.',
  '[{"type":"reel","label":"Reels","target":null},{"type":"post","label":"Publicaciones","target":null},{"type":"story","label":"Stories","target":null}]'::jsonb,
  'Caracol funciona como laboratorio inicial. Las metas de piezas quedan abiertas hasta definir el alcance operativo con la encargada de contenido.'
)
on conflict (business_id, period_start) do update set
  period_end = excluded.period_end,
  status = excluded.status,
  client_fee_clp = excluded.client_fee_clp,
  operator_fee_clp = excluded.operator_fee_clp,
  objective = excluded.objective,
  deliverables = excluded.deliverables,
  notes = excluded.notes,
  updated_at = now();
