-- LINK Karaoke · multisite capture, queue, community and scoring
-- Source of truth: LINK CONTROL CENTRAL Supabase + LINKRRSS/Zernio.

create table if not exists public.link_karaoke_sites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.link_world_businesses(id) on delete cascade,
  rrss_profile_id uuid references public.link_rrss_profiles(id) on delete set null,
  instagram_account_id uuid references public.link_rrss_accounts(id) on delete set null,
  slug text not null unique,
  name text not null,
  instagram_username text not null,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_karaoke_sites_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint link_karaoke_sites_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

create table if not exists public.link_karaoke_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.link_karaoke_sites(id) on delete cascade,
  title text not null,
  status text not null default 'planned',
  public_display boolean not null default true,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_karaoke_sessions_status_check check (status in ('planned','open','closed','archived')),
  constraint link_karaoke_sessions_time_check check (closed_at is null or opened_at is null or closed_at >= opened_at)
);

create table if not exists public.link_karaoke_join_intents (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.link_karaoke_sites(id) on delete cascade,
  session_id uuid not null references public.link_karaoke_sessions(id) on delete cascade,
  instagram_username text not null,
  artistic_name text,
  public_profile boolean not null default true,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  converted_at timestamptz,
  constraint link_karaoke_join_status_check check (status in ('pending','matched','converted','expired')),
  constraint link_karaoke_join_username_check check (
    instagram_username = lower(instagram_username)
    and instagram_username ~ '^[a-z0-9._]{1,30}$'
  ),
  constraint link_karaoke_join_name_check check (artistic_name is null or char_length(artistic_name) between 1 and 60),
  unique (session_id, instagram_username)
);

create table if not exists public.link_karaoke_singers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.link_karaoke_sites(id) on delete cascade,
  person_id uuid not null references public.link_persons(id) on delete cascade,
  instagram_username text not null,
  participant_name text,
  artistic_name text not null,
  profile_picture text,
  public_profile boolean not null default true,
  first_joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_karaoke_singers_username_check check (
    instagram_username = lower(instagram_username)
    and instagram_username ~ '^[a-z0-9._]{1,30}$'
  ),
  constraint link_karaoke_singers_name_check check (char_length(artistic_name) between 1 and 60),
  constraint link_karaoke_singers_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists link_karaoke_singers_site_username_uq
  on public.link_karaoke_singers(site_id, instagram_username);
create unique index if not exists link_karaoke_singers_site_person_uq
  on public.link_karaoke_singers(site_id, person_id);

create table if not exists public.link_karaoke_public_profiles (
  singer_id uuid primary key references public.link_karaoke_singers(id) on delete cascade,
  site_id uuid not null references public.link_karaoke_sites(id) on delete cascade,
  artistic_name text not null,
  public_avatar_url text,
  instagram_username text,
  instagram_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.link_karaoke_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.link_karaoke_sites(id) on delete cascade,
  session_id uuid not null references public.link_karaoke_sessions(id) on delete cascade,
  singer_id uuid not null references public.link_karaoke_singers(id) on delete cascade,
  song_title text not null,
  song_artist text,
  status text not null default 'pending',
  queue_position integer,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  host_score numeric(4,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_karaoke_request_status_check check (status in ('pending','queued','on_stage','completed','skipped','cancelled')),
  constraint link_karaoke_request_position_check check (queue_position is null or queue_position > 0),
  constraint link_karaoke_request_score_check check (host_score is null or (host_score >= 0 and host_score <= 10)),
  constraint link_karaoke_request_song_check check (char_length(song_title) between 1 and 140)
);

create index if not exists link_karaoke_requests_session_status_position_idx
  on public.link_karaoke_requests(session_id, status, queue_position, requested_at);
create index if not exists link_karaoke_requests_singer_completed_idx
  on public.link_karaoke_requests(singer_id, completed_at desc)
  where status = 'completed';

create table if not exists public.link_karaoke_request_sources (
  request_id uuid primary key references public.link_karaoke_requests(id) on delete cascade,
  conversation_id uuid references public.link_rrss_conversations(id) on delete set null,
  source_message_id uuid unique references public.link_rrss_messages(id) on delete set null,
  external_conversation_id text,
  external_message_id text,
  raw_message text,
  source_kind text not null default 'instagram_dm',
  created_at timestamptz not null default now(),
  constraint link_karaoke_request_source_kind_check check (source_kind in ('instagram_dm','manual','join_form'))
);

create index if not exists link_karaoke_join_site_session_created_idx
  on public.link_karaoke_join_intents(site_id, session_id, created_at desc);
create index if not exists link_karaoke_sessions_site_status_idx
  on public.link_karaoke_sessions(site_id, status, opened_at desc);

alter table public.link_karaoke_sites enable row level security;
alter table public.link_karaoke_sessions enable row level security;
alter table public.link_karaoke_join_intents enable row level security;
alter table public.link_karaoke_singers enable row level security;
alter table public.link_karaoke_public_profiles enable row level security;
alter table public.link_karaoke_requests enable row level security;
alter table public.link_karaoke_request_sources enable row level security;

drop policy if exists "karaoke sites public read" on public.link_karaoke_sites;
create policy "karaoke sites public read"
on public.link_karaoke_sites for select
to anon, authenticated
using (active = true);

drop policy if exists "karaoke sites member write" on public.link_karaoke_sites;
create policy "karaoke sites member write"
on public.link_karaoke_sites for all
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "karaoke sessions public read" on public.link_karaoke_sessions;
create policy "karaoke sessions public read"
on public.link_karaoke_sessions for select
to anon, authenticated
using (public_display = true and status in ('open','closed'));

drop policy if exists "karaoke sessions member write" on public.link_karaoke_sessions;
create policy "karaoke sessions member write"
on public.link_karaoke_sessions for all
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "karaoke join public insert" on public.link_karaoke_join_intents;
create policy "karaoke join public insert"
on public.link_karaoke_join_intents for insert
to anon, authenticated
with check (
  status = 'pending'
  and exists (
    select 1
    from public.link_karaoke_sessions s
    join public.link_karaoke_sites k on k.id = s.site_id
    where s.id = session_id
      and s.site_id = site_id
      and s.status = 'open'
      and s.public_display = true
      and k.active = true
  )
);

drop policy if exists "karaoke join member read" on public.link_karaoke_join_intents;
create policy "karaoke join member read"
on public.link_karaoke_join_intents for select
to authenticated
using ((select public.link_world_is_member()));

drop policy if exists "karaoke join member update" on public.link_karaoke_join_intents;
create policy "karaoke join member update"
on public.link_karaoke_join_intents for update
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "karaoke singers member all" on public.link_karaoke_singers;
create policy "karaoke singers member all"
on public.link_karaoke_singers for all
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "karaoke public profiles read" on public.link_karaoke_public_profiles;
create policy "karaoke public profiles read"
on public.link_karaoke_public_profiles for select
to anon, authenticated
using (
  exists (
    select 1 from public.link_karaoke_sites s
    where s.id = site_id and s.active = true
  )
);

drop policy if exists "karaoke public profiles member write" on public.link_karaoke_public_profiles;
create policy "karaoke public profiles member write"
on public.link_karaoke_public_profiles for all
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "karaoke requests public read" on public.link_karaoke_requests;
create policy "karaoke requests public read"
on public.link_karaoke_requests for select
to anon, authenticated
using (
  exists (
    select 1
    from public.link_karaoke_sessions s
    where s.id = session_id
      and s.public_display = true
      and s.status in ('open','closed')
  )
);

drop policy if exists "karaoke requests member write" on public.link_karaoke_requests;
create policy "karaoke requests member write"
on public.link_karaoke_requests for all
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

drop policy if exists "karaoke request sources member all" on public.link_karaoke_request_sources;
create policy "karaoke request sources member all"
on public.link_karaoke_request_sources for all
to authenticated
using ((select public.link_world_is_member()))
with check ((select public.link_world_is_member()));

grant select on public.link_karaoke_sites to anon, authenticated;
grant select on public.link_karaoke_sessions to anon, authenticated;
grant insert on public.link_karaoke_join_intents to anon;
grant select, insert, update, delete on public.link_karaoke_join_intents to authenticated;
grant select, insert, update, delete on public.link_karaoke_singers to authenticated;
grant select on public.link_karaoke_public_profiles to anon, authenticated;
grant insert, update, delete on public.link_karaoke_public_profiles to authenticated;
grant select on public.link_karaoke_requests to anon, authenticated;
grant insert, update, delete on public.link_karaoke_requests to authenticated;
grant select, insert, update, delete on public.link_karaoke_request_sources to authenticated;

insert into public.link_karaoke_sites (
  business_id, rrss_profile_id, instagram_account_id, slug, name, instagram_username, active, settings
)
select
  b.id,
  p.id,
  a.id,
  'caracol',
  'Karaoke Caracol',
  lower(a.username),
  true,
  jsonb_build_object(
    'auto_welcome', true,
    'welcome_message', '¡Bienvenido al Karaoke Caracol! 🎤 Mándanos por aquí la canción que quieres cantar. Si quieres, usa formato: Canción — Artista.',
    'ask_song_message', '🎤 ¿Qué canción quieres cantar? Envíame el nombre y, si sabes, el artista.',
    'queue_visible', true,
    'community_visible', true,
    'score_scale', 10
  )
from public.link_world_businesses b
join public.link_rrss_profiles p on p.business_id = b.id and p.status = 'active'
join public.link_rrss_sources s on s.profile_id = p.id
join public.link_rrss_accounts a on a.source_id = s.id and a.platform = 'instagram' and a.status = 'connected'
where b.slug = 'caracol'
order by a.updated_at desc
limit 1
on conflict (slug) do update set
  business_id = excluded.business_id,
  rrss_profile_id = excluded.rrss_profile_id,
  instagram_account_id = excluded.instagram_account_id,
  instagram_username = excluded.instagram_username,
  active = true,
  updated_at = now();

insert into public.link_ingestion_sources (
  source_key, label, source_system, owner_table, business_id, role,
  feeds_sales_leads, feeds_interactions, status, metadata
)
select
  'caracol_karaoke_qr',
  'Caracol · QR Karaoke',
  'link_karaoke',
  'link_karaoke_join_intents',
  b.id,
  'lead_source',
  true,
  true,
  'active',
  jsonb_build_object('site_slug','caracol','channel','instagram','entry','qr')
from public.link_world_businesses b
where b.slug = 'caracol'
on conflict (source_key) do update set
  business_id = excluded.business_id,
  status = 'active',
  metadata = excluded.metadata,
  updated_at = now();

comment on table public.link_karaoke_sites is 'Multisite registry for LINK Karaoke. Connects each karaoke venue to one LINK WORLD business and an RRSS Instagram account.';
comment on table public.link_karaoke_join_intents is 'Low-friction QR entry. Captures Instagram username before the participant moves to Instagram DM.';
comment on table public.link_karaoke_requests is 'Public-safe karaoke queue/performance record. Raw Instagram message evidence lives separately in link_karaoke_request_sources.';
comment on table public.link_karaoke_request_sources is 'Private evidence bridge from karaoke requests to LINKRRSS conversations/messages.';
