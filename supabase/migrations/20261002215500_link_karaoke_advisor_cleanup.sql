-- LINK Karaoke · advisor cleanup: focused RLS policies and FK indexes
create index if not exists link_karaoke_public_profiles_site_idx on public.link_karaoke_public_profiles(site_id);
create index if not exists link_karaoke_request_sources_conversation_idx on public.link_karaoke_request_sources(conversation_id);
create index if not exists link_karaoke_requests_site_idx on public.link_karaoke_requests(site_id);
create index if not exists link_karaoke_sessions_created_by_idx on public.link_karaoke_sessions(created_by);
create index if not exists link_karaoke_singers_person_idx on public.link_karaoke_singers(person_id);
create index if not exists link_karaoke_sites_business_idx on public.link_karaoke_sites(business_id);
create index if not exists link_karaoke_sites_rrss_profile_idx on public.link_karaoke_sites(rrss_profile_id);
create index if not exists link_karaoke_sites_instagram_account_idx on public.link_karaoke_sites(instagram_account_id);

drop policy if exists "karaoke sites public read" on public.link_karaoke_sites;
drop policy if exists "karaoke sites member write" on public.link_karaoke_sites;
create policy "karaoke sites anon read" on public.link_karaoke_sites
  for select to anon using (active = true);
create policy "karaoke sites authenticated read" on public.link_karaoke_sites
  for select to authenticated using (active = true or (select public.link_world_is_member()));
create policy "karaoke sites member insert" on public.link_karaoke_sites
  for insert to authenticated with check ((select public.link_world_is_member()));
create policy "karaoke sites member update" on public.link_karaoke_sites
  for update to authenticated using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));
create policy "karaoke sites member delete" on public.link_karaoke_sites
  for delete to authenticated using ((select public.link_world_is_member()));

drop policy if exists "karaoke sessions public read" on public.link_karaoke_sessions;
drop policy if exists "karaoke sessions member write" on public.link_karaoke_sessions;
create policy "karaoke sessions anon read" on public.link_karaoke_sessions
  for select to anon using (public_display = true and status in ('open','closed'));
create policy "karaoke sessions authenticated read" on public.link_karaoke_sessions
  for select to authenticated using (
    (public_display = true and status in ('open','closed')) or (select public.link_world_is_member())
  );
create policy "karaoke sessions member insert" on public.link_karaoke_sessions
  for insert to authenticated with check ((select public.link_world_is_member()));
create policy "karaoke sessions member update" on public.link_karaoke_sessions
  for update to authenticated using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));
create policy "karaoke sessions member delete" on public.link_karaoke_sessions
  for delete to authenticated using ((select public.link_world_is_member()));

drop policy if exists "karaoke public profiles read" on public.link_karaoke_public_profiles;
drop policy if exists "karaoke public profiles member write" on public.link_karaoke_public_profiles;
create policy "karaoke public profiles anon read" on public.link_karaoke_public_profiles
  for select to anon using (
    exists (select 1 from public.link_karaoke_sites s where s.id = site_id and s.active = true)
  );
create policy "karaoke public profiles authenticated read" on public.link_karaoke_public_profiles
  for select to authenticated using (
    exists (select 1 from public.link_karaoke_sites s where s.id = site_id and s.active = true)
    or (select public.link_world_is_member())
  );
create policy "karaoke public profiles member insert" on public.link_karaoke_public_profiles
  for insert to authenticated with check ((select public.link_world_is_member()));
create policy "karaoke public profiles member update" on public.link_karaoke_public_profiles
  for update to authenticated using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));
create policy "karaoke public profiles member delete" on public.link_karaoke_public_profiles
  for delete to authenticated using ((select public.link_world_is_member()));

drop policy if exists "karaoke requests public read" on public.link_karaoke_requests;
drop policy if exists "karaoke requests member write" on public.link_karaoke_requests;
create policy "karaoke requests anon read" on public.link_karaoke_requests
  for select to anon using (
    exists (
      select 1 from public.link_karaoke_sessions s
      where s.id = session_id and s.public_display = true and s.status in ('open','closed')
    )
  );
create policy "karaoke requests authenticated read" on public.link_karaoke_requests
  for select to authenticated using (
    exists (
      select 1 from public.link_karaoke_sessions s
      where s.id = session_id and s.public_display = true and s.status in ('open','closed')
    )
    or (select public.link_world_is_member())
  );
create policy "karaoke requests member insert" on public.link_karaoke_requests
  for insert to authenticated with check ((select public.link_world_is_member()));
create policy "karaoke requests member update" on public.link_karaoke_requests
  for update to authenticated using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));
create policy "karaoke requests member delete" on public.link_karaoke_requests
  for delete to authenticated using ((select public.link_world_is_member()));