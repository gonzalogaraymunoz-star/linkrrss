-- LINKDOT workspaces: reusable contract for LINK apps.
-- First instance: LINKRRSS owned by LINKDOT MAR with five SubLinkDots and real artifacts.

create table if not exists public.link_dot_workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null unique,
  app_key text not null,
  name text not null,
  description text,
  owner_linkdot_slug text not null,
  owner_director_slug text,
  route text,
  status text not null default 'active' check (status in ('active','paused','draft','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.link_dot_workspace_subdots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.link_dot_workspaces(id) on delete cascade,
  subdot_slug text not null,
  name text not null,
  responsibility text not null,
  sort_order integer not null default 100,
  status text not null default 'active' check (status in ('active','paused','draft','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, subdot_slug)
);

create table if not exists public.link_dot_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.link_dot_workspaces(id) on delete cascade,
  subdot_id uuid not null references public.link_dot_workspace_subdots(id) on delete restrict,
  business_id uuid references public.link_world_businesses(id) on delete set null,
  artifact_key text not null,
  name text not null,
  description text,
  artifact_type text not null default 'workspace',
  work_definition text not null,
  route text,
  source_system text,
  source_table text,
  source_ref text,
  status text not null default 'active' check (status in ('active','attention','building','paused','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, artifact_key)
);

create index if not exists link_dot_workspace_subdots_workspace_idx
  on public.link_dot_workspace_subdots(workspace_id, sort_order);
create index if not exists link_dot_artifacts_workspace_idx
  on public.link_dot_artifacts(workspace_id, status);
create index if not exists link_dot_artifacts_subdot_idx
  on public.link_dot_artifacts(subdot_id, status);
create index if not exists link_dot_artifacts_business_idx
  on public.link_dot_artifacts(business_id) where business_id is not null;

drop trigger if exists link_dot_workspaces_touch on public.link_dot_workspaces;
create trigger link_dot_workspaces_touch before update on public.link_dot_workspaces
for each row execute function public.set_updated_at();
drop trigger if exists link_dot_workspace_subdots_touch on public.link_dot_workspace_subdots;
create trigger link_dot_workspace_subdots_touch before update on public.link_dot_workspace_subdots
for each row execute function public.set_updated_at();
drop trigger if exists link_dot_artifacts_touch on public.link_dot_artifacts;
create trigger link_dot_artifacts_touch before update on public.link_dot_artifacts
for each row execute function public.set_updated_at();

alter table public.link_dot_workspaces enable row level security;
alter table public.link_dot_workspace_subdots enable row level security;
alter table public.link_dot_artifacts enable row level security;

revoke all on public.link_dot_workspaces from anon;
revoke all on public.link_dot_workspace_subdots from anon;
revoke all on public.link_dot_artifacts from anon;
grant select, insert, update, delete on public.link_dot_workspaces to authenticated;
grant select, insert, update, delete on public.link_dot_workspace_subdots to authenticated;
grant select, insert, update, delete on public.link_dot_artifacts to authenticated;
grant all on public.link_dot_workspaces to service_role;
grant all on public.link_dot_workspace_subdots to service_role;
grant all on public.link_dot_artifacts to service_role;

drop policy if exists "link members manage dot workspaces" on public.link_dot_workspaces;
create policy "link members manage dot workspaces" on public.link_dot_workspaces for all to authenticated
using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));
drop policy if exists "link members manage dot workspace subdots" on public.link_dot_workspace_subdots;
create policy "link members manage dot workspace subdots" on public.link_dot_workspace_subdots for all to authenticated
using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));
drop policy if exists "link members manage dot artifacts" on public.link_dot_artifacts;
create policy "link members manage dot artifacts" on public.link_dot_artifacts for all to authenticated
using ((select public.link_world_is_member())) with check ((select public.link_world_is_member()));

insert into public.link_dot_workspaces
(workspace_key,app_key,name,description,owner_linkdot_slug,owner_director_slug,route,status,metadata)
values (
  'linkrrss-mar','linkrrss','LINKRRSS · MAR',
  'Espacio de trabajo de LINKDOT MAR para convertir atención social en campañas, contenido, publicación, comunidad, aprendizaje y handoff identificable hacia Ventas.',
  'linkdot-marketing-rrss','director-marketing','/?section=artifacts','active',
  '{"architecture":"LINKDOT","version":"1.0","handoff_to":"BEL","mission_code":"MSN-LINKDOT-MAR-PERSIST-V1"}'::jsonb
)
on conflict (workspace_key) do update set
  app_key=excluded.app_key,name=excluded.name,description=excluded.description,
  owner_linkdot_slug=excluded.owner_linkdot_slug,owner_director_slug=excluded.owner_director_slug,
  route=excluded.route,status=excluded.status,metadata=excluded.metadata,updated_at=now();

with w as (select id from public.link_dot_workspaces where workspace_key='linkrrss-mar')
insert into public.link_dot_workspace_subdots
(workspace_id,subdot_slug,name,responsibility,sort_order,metadata)
select w.id,x.subdot_slug,x.name,x.responsibility,x.sort_order,x.metadata from w
cross join (values
  ('linksubdot-marketing-strategy','Estrategia & Audiencia','Define a quién alcanzar, con qué propuesta, por qué canal y con qué objetivo medible.',10,'{"capabilities":["audience.research","campaign.brief","channel.mix"]}'::jsonb),
  ('linksubdot-marketing-content','Contenido & Creatividad','Convierte estrategia y evidencia en conceptos, copies, piezas y planes listos para revisión.',20,'{"capabilities":["content.plan","creative.brief","asset.review"]}'::jsonb),
  ('linksubdot-marketing-publishing','Publicación & Calendario','Ordena calendario, borradores, preflight y trazabilidad. Publicar externamente requiere autorización.',30,'{"capabilities":["calendar.manage","draft.prepare","publication.preflight"]}'::jsonb),
  ('linksubdot-marketing-community','Comunidad & Escucha','Ordena inbox y comentarios, prepara respuestas y detecta identidades contactables para handoff a Ventas.',40,'{"capabilities":["inbox.triage","lead.detect","response.draft"]}'::jsonb),
  ('linksubdot-marketing-intelligence','Métricas & Aprendizaje','Lee métricas, atribuye resultados, detecta alertas y convierte evidencia en aprendizaje para el siguiente ciclo.',50,'{"capabilities":["metrics.read","attribution.analyze","learning.capture"]}'::jsonb)
) as x(subdot_slug,name,responsibility,sort_order,metadata)
on conflict (workspace_id,subdot_slug) do update set
  name=excluded.name,responsibility=excluded.responsibility,sort_order=excluded.sort_order,
  metadata=excluded.metadata,status='active',updated_at=now();

with w as (select id from public.link_dot_workspaces where workspace_key='linkrrss-mar'),
s as (
  select id,subdot_slug from public.link_dot_workspace_subdots
  where workspace_id=(select id from w)
)
insert into public.link_dot_artifacts
(workspace_id,subdot_id,business_id,artifact_key,name,description,artifact_type,work_definition,route,source_system,source_table,source_ref,status,metadata)
select w.id,s.id,x.business_id,x.artifact_key,x.name,x.description,x.artifact_type,x.work_definition,x.route,x.source_system,x.source_table,x.source_ref,x.status,x.metadata
from w join s on true
join (values
 ('linksubdot-marketing-strategy',null::uuid,'mar-monthly-plan','Plan mensual','Mesa para transformar objetivo comercial en campaña, frecuencia, canales y trabajo verificable del mes.','plan','Definir el objetivo del periodo, audiencia, propuesta, canales, presupuesto y tareas antes de producir.','/?section=operation','supabase','link_rrss_operation_plans',null,'active','{"scope":"all_businesses"}'::jsonb),
 ('linksubdot-marketing-strategy','31333b84-79fa-4c52-b974-977145ec9e9a'::uuid,'caracol-oct-2026-brief','Brief Caracol · Octubre 2026','Brief comercial/marketing persistente del piloto Caracol.','brief','Completar producto, audiencia, beneficio, anzuelo, oferta, presupuesto y meta de leads; convertirlo en plan medible.','/?business=caracol&section=operation','supabase','link_marketing_briefs','c84acea2-0aec-49ce-8ed1-6046f35e2d14','attention','{"pilot":true}'::jsonb),
 ('linksubdot-marketing-content',null::uuid,'mar-content-studio','Contenido & Creatividad','Espacio donde viven publicaciones, borradores, piezas y su revisión creativa.','content','Preparar conceptos, copies y piezas coherentes con el brief antes de autorización y publicación.','/?section=content','supabase','link_rrss_publication_drafts',null,'active','{"scope":"current_business"}'::jsonb),
 ('linksubdot-marketing-publishing',null::uuid,'mar-publication-calendar','Calendario de publicación','Calendario trazable de publicaciones y borradores por negocio y cuenta.','calendar','Programar qué sale, cuándo, por qué canal y con qué estado de aprobación.','/?section=calendar','supabase','link_rrss_publication_drafts',null,'active','{"scope":"current_business"}'::jsonb),
 ('linksubdot-marketing-community',null::uuid,'mar-community-inbox','Comunidad & Inbox','Conversaciones sociales donde MAR escucha, responde y detecta oportunidades identificables.','inbox','Priorizar conversaciones, preparar respuesta y convertir identidad natural + punto de contacto en handoff a BEL.','/?section=inbox','supabase','link_rrss_conversations',null,'active','{"handoff":"BEL"}'::jsonb),
 ('linksubdot-marketing-community','31333b84-79fa-4c52-b974-977145ec9e9a'::uuid,'link-karaoke-caracol','LINK Karaoke · Caracol','Experiencia social multisite que convierte QR + Instagram DM en participación identificada, canción, cola e historial.','experience','Recuperar la interacción de Instagram, identificar cantante + canción + artista, ordenar la cola y conservar evidencia de participación.','/karaoke?site=caracol','supabase','link_karaoke_sites','a2b59a8a-7870-430d-be48-d1d099ea0551','active','{"site":"caracol","channel":"instagram","multisite":true}'::jsonb),
 ('linksubdot-marketing-intelligence',null::uuid,'mar-metrics-learning','Métricas & Aprendizaje','Lectura de resultados sociales y memoria para decidir el siguiente ciclo.','analytics','Comparar resultados, atribuir señales al contenido/canal y registrar qué debe repetirse, corregirse o abandonar.','/?section=analytics','supabase','link_rrss_post_metric_history',null,'active','{"scope":"current_business"}'::jsonb)
) as x(subdot_slug,business_id,artifact_key,name,description,artifact_type,work_definition,route,source_system,source_table,source_ref,status,metadata)
on x.subdot_slug=s.subdot_slug
on conflict (workspace_id,artifact_key) do update set
  subdot_id=excluded.subdot_id,business_id=excluded.business_id,name=excluded.name,
  description=excluded.description,artifact_type=excluded.artifact_type,
  work_definition=excluded.work_definition,route=excluded.route,source_system=excluded.source_system,
  source_table=excluded.source_table,source_ref=excluded.source_ref,status=excluded.status,
  metadata=excluded.metadata,updated_at=now();
