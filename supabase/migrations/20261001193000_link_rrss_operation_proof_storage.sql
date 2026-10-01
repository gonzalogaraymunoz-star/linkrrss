insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'link-rrss-operation-proof',
  'link-rrss-operation-proof',
  false,
  26214400,
  array['image/jpeg','image/png','image/webp','application/pdf','video/mp4','video/quicktime']::text[]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "link members read rrss operation proof" on storage.objects;
create policy "link members read rrss operation proof"
on storage.objects for select to authenticated
using (bucket_id='link-rrss-operation-proof' and (select public.link_world_is_member()));

drop policy if exists "link members upload rrss operation proof" on storage.objects;
create policy "link members upload rrss operation proof"
on storage.objects for insert to authenticated
with check (bucket_id='link-rrss-operation-proof' and (select public.link_world_is_member()));

drop policy if exists "link members update rrss operation proof" on storage.objects;
create policy "link members update rrss operation proof"
on storage.objects for update to authenticated
using (bucket_id='link-rrss-operation-proof' and (select public.link_world_is_member()))
with check (bucket_id='link-rrss-operation-proof' and (select public.link_world_is_member()));

drop policy if exists "link members delete rrss operation proof" on storage.objects;
create policy "link members delete rrss operation proof"
on storage.objects for delete to authenticated
using (bucket_id='link-rrss-operation-proof' and (select public.link_world_is_member()));