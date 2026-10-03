-- LINK Karaoke · realtime + one open night per site
create unique index if not exists link_karaoke_one_open_session_per_site_uq
  on public.link_karaoke_sessions(site_id)
  where status='open';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='link_karaoke_requests'
  ) then
    alter publication supabase_realtime add table public.link_karaoke_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='link_karaoke_join_intents'
  ) then
    alter publication supabase_realtime add table public.link_karaoke_join_intents;
  end if;
end $$;