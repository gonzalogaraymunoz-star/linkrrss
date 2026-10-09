-- LINK Commerce v0.2 / canonical re-creation schema
-- Depends on existing LINK CONTROL CENTRAL: public.link_world_businesses,
-- public.app_members, private.lc_is_active_member(). 
-- Existing production database was migrated with Supabase MCP in separate revisions.
create table if not exists public.link_commerce_accounts (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null unique references public.link_world_businesses(id) on delete restrict,
 status text not null default 'active' check (status in ('active','paused')),
 business_model text not null default 'configurable' check (length(business_model) between 1 and 100),
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists link_commerce_accounts_status_idx on public.link_commerce_accounts(status,updated_at desc);
create table if not exists public.link_commerce_sites (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.link_world_businesses(id) on delete restrict,
 name text not null check (length(trim(name)) between 1 and 120),
 website_url text not null check (website_url ~* '^https://[^[:space:]]+$' and length(website_url)<=1500),
 kind text not null default 'acquisition' check (kind in ('acquisition','catalog','reservation','delivery','reference')),
 status text not null default 'registered' check (status in ('registered','verified','paused')),
 modules jsonb not null default '[]'::jsonb check (jsonb_typeof(modules)='array'),
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(business_id,website_url),
 unique(id,business_id)
);
create index if not exists link_commerce_sites_business_idx on public.link_commerce_sites(business_id,status,updated_at desc);
create table if not exists public.link_commerce_acquisitions (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null,
 site_id uuid not null,
 source text not null default 'website' check (source in ('website','qr','instagram','whatsapp','manual','other')),
 customer_name text not null check (length(trim(customer_name)) between 1 and 180),
 contact_email text,
 contact_phone text,
 interest text not null default '' check (length(interest)<=2000),
 external_ref text,
 status text not null default 'received' check (status in ('received','reviewed','handed_off','cancelled')),
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default now(),
 constraint link_commerce_acquisitions_site_business_fk
 foreign key(site_id,business_id) references public.link_commerce_sites(id,business_id) on delete restrict
);
create index if not exists link_commerce_acquisitions_business_idx on public.link_commerce_acquisitions(business_id,created_at desc);
create index if not exists link_commerce_acquisitions_site_business_idx on public.link_commerce_acquisitions(site_id,business_id);
create unique index if not exists link_commerce_acquisitions_external_uidx
 on public.link_commerce_acquisitions(site_id,external_ref) where external_ref is not null;
alter table public.link_commerce_accounts enable row level security;
alter table public.link_commerce_sites enable row level security;
alter table public.link_commerce_acquisitions enable row level security;
revoke all on public.link_commerce_accounts,public.link_commerce_sites,public.link_commerce_acquisitions from anon;
grant select,insert,update on public.link_commerce_accounts,public.link_commerce_sites,public.link_commerce_acquisitions to authenticated;

drop policy if exists link_commerce_accounts_member_read on public.link_commerce_accounts;
create policy link_commerce_accounts_member_read on public.link_commerce_accounts
 for select to authenticated using ((select private.lc_is_active_member()));
drop policy if exists link_commerce_accounts_owner_insert on public.link_commerce_accounts;
create policy link_commerce_accounts_owner_insert on public.link_commerce_accounts
 for insert to authenticated with check (
 created_by=(select auth.uid()) and exists
 (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin'))
 );
drop policy if exists link_commerce_accounts_owner_update on public.link_commerce_accounts;
create policy link_commerce_accounts_owner_update on public.link_commerce_accounts for update to authenticated
 using (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')))
 with check (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')));

drop policy if exists link_commerce_sites_member_read on public.link_commerce_sites;
create policy link_commerce_sites_member_read on public.link_commerce_sites for select to authenticated
 using ((select private.lc_is_active_member()));
drop policy if exists link_commerce_sites_owner_insert on public.link_commerce_sites;
create policy link_commerce_sites_owner_insert on public.link_commerce_sites for insert to authenticated
 with check (status='registered' and created_by=(select auth.uid()) and
 exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')) and
 exists (select 1 from public.link_commerce_accounts a where a.business_id=link_commerce_sites.business_id and a.status='active'));
drop policy if exists link_commerce_sites_owner_update on public.link_commerce_sites;
create policy link_commerce_sites_owner_update on public.link_commerce_sites for update to authenticated
 using (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')) and
 exists (select 1 from public.link_commerce_accounts a where a.business_id=link_commerce_sites.business_id and a.status='active'))
 with check (status in ('registered','paused') and
 exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')) and
 exists (select 1 from public.link_commerce_accounts a where a.business_id=link_commerce_sites.business_id and a.status='active'));

drop policy if exists link_commerce_acquisitions_owner_read on public.link_commerce_acquisitions;
create policy link_commerce_acquisitions_owner_read on public.link_commerce_acquisitions for select to authenticated
 using (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')));
drop policy if exists link_commerce_acquisitions_member_read on public.link_commerce_acquisitions;
drop policy if exists link_commerce_acquisitions_owner_insert on public.link_commerce_acquisitions;
create policy link_commerce_acquisitions_owner_insert on public.link_commerce_acquisitions for insert to authenticated
 with check (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')) and
 exists (select 1 from public.link_commerce_accounts a where a.business_id=link_commerce_acquisitions.business_id and a.status='active'));
drop policy if exists link_commerce_acquisitions_owner_update on public.link_commerce_acquisitions;
create policy link_commerce_acquisitions_owner_update on public.link_commerce_acquisitions for update to authenticated
 using (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')))
 with check (exists (select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin')));

create or replace function public.link_commerce_immutable_site_columns()
 returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.business_id is distinct from old.business_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
 raise exception 'LINK Commerce: business, author and creation timestamp are immutable';
 end if;
 return new;
end $$;
drop trigger if exists link_commerce_immutable_site_columns_trigger on public.link_commerce_sites;
create trigger link_commerce_immutable_site_columns_trigger before update on public.link_commerce_sites
 for each row execute function public.link_commerce_immutable_site_columns();

create or replace function public.link_commerce_account_identity_immutable()
 returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.business_id is distinct from old.business_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
 raise exception 'Commerce account identity is immutable';
 end if;
 return new;
end $$;
drop trigger if exists link_commerce_account_identity_immutable_trigger on public.link_commerce_accounts;
create trigger link_commerce_account_identity_immutable_trigger before update on public.link_commerce_accounts
 for each row execute function public.link_commerce_account_identity_immutable();
