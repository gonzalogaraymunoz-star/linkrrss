-- LINK Studio: native audiovisual production cell for LINKRRSS.
-- Inspired by Recordly interaction patterns, without copying or embedding AGPL source code.

create table if not exists public.link_rrss_studio_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.link_world_businesses(id) on delete cascade,
  name text not null,
  intent text not null default 'reel' check (intent in ('reel','edit','screen_recording','adapt')),
  status text not null default 'draft' check (status in ('draft','editing','review','approved','exported','archived')),
  aspect_ratio text not null default '9:16',
  channel text,
  brief text,
  editor_state jsonb not null default '{}'::jsonb,
  brand_contract jsonb not null default '{}'::jsonb,
  source_adapter text not null default 'link-native',
  source_project_ref text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.link_rrss_studio_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.link_rrss_studio_projects(id) on delete cascade,
  asset_type text not null check (asset_type in ('video','image','audio','caption','overlay','export','external_project')),
  name text not null,
  storage_path text,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists link_rrss_studio_projects_business_idx on public.link_rrss_studio_projects(business_id, updated_at desc);
create index if not exists link_rrss_studio_assets_project_idx on public.link_rrss_studio_assets(project_id, sort_order);

drop trigger if exists link_rrss_studio_projects_touch on public.link_rrss_studio_projects;
create trigger link_rrss_studio_projects_touch before update on public.link_rrss_studio_projects
for each row execute function public.set_updated_at();

alter table public.link_rrss_studio_projects enable row level security;
alter table public.link_rrss_studio_assets enable row level security;
revoke all on public.link_rrss_studio_projects from anon;
revoke all on public.link_rrss_studio_assets from anon;
grant select,insert,update,delete on public.link_rrss_studio_projects to authenticated;
grant select,insert,update,delete on public.link_rrss_studio_assets to authenticated;
grant all on public.link_rrss_studio_projects to service_role;
grant all on public.link_rrss_studio_assets to service_role;

drop policy if exists "link members manage studio projects" on public.link_rrss_studio_projects;
create policy "link members manage studio projects" on public.link_rrss_studio_projects for all to authenticated
using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));

drop policy if exists "link members manage studio assets" on public.link_rrss_studio_assets;
create policy "link members manage studio assets" on public.link_rrss_studio_assets for all to authenticated
using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));

with w as (select id from public.link_dot_workspaces where workspace_key='linkrrss-mar')
insert into public.link_dot_workspace_subdots(workspace_id,subdot_slug,name,responsibility,sort_order,status,metadata)
select w.id,'linksubdot-video','Video & Montaje','Transforma material bruto en piezas audiovisuales editables, adaptadas al contrato visual de cada negocio y listas para revisión de MAR.',25,'active',
'{"capabilities":["video.ingest","video.timeline","video.adapt","brand.apply","export.prepare"],"engine_contract":"adapter","agpl_boundary":"Recordly source is not embedded"}'::jsonb
from w
on conflict (workspace_id,subdot_slug) do update set name=excluded.name,responsibility=excluded.responsibility,sort_order=excluded.sort_order,status='active',metadata=excluded.metadata,updated_at=now();

with w as (select id from public.link_dot_workspaces where workspace_key='linkrrss-mar'),
s as (select id from public.link_dot_workspace_subdots where workspace_id=(select id from w) and subdot_slug='linksubdot-video')
insert into public.link_dot_artifacts(workspace_id,subdot_id,business_id,artifact_key,name,description,artifact_type,work_definition,route,source_system,source_table,status,metadata)
select w.id,s.id,null::uuid,'link-studio','LINK Studio','Mesa audiovisual de MAR: crear Reel, editar video, preparar grabación de pantalla o adaptar una pieza a otro canal.','studio',
'Recibir material, conservar un proyecto editable, aplicar contrato visual del negocio, preparar formatos y entregar una versión revisable antes de publicación.',
'/?section=studio','supabase','link_rrss_studio_projects','active',
'{"owner":"MAR","operator":"LINKSUBDOT VIDEO","handoff":["review","publishing","zernio"],"recordly":{"mode":"reference-adapter","license_boundary":"AGPL-3.0","source_embedded":false}}'::jsonb
from w join s on true
on conflict (workspace_id,artifact_key) do update set subdot_id=excluded.subdot_id,name=excluded.name,description=excluded.description,artifact_type=excluded.artifact_type,work_definition=excluded.work_definition,route=excluded.route,source_system=excluded.source_system,source_table=excluded.source_table,status=excluded.status,metadata=excluded.metadata,updated_at=now();
