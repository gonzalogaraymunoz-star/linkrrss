-- LINKRRSS secure ChatGPT bridge.
-- Generated 2026-09-29. No raw Zernio or agent credentials are stored in Git.

create extension if not exists http with schema extensions;
create schema if not exists link_private;
revoke all on schema link_private from public, anon, authenticated;

create table if not exists public.link_rrss_agent_credentials (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  vault_secret_id uuid not null,
  scopes text[] not null default array['publish','sync']::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.link_rrss_agent_credentials enable row level security;
revoke all on public.link_rrss_agent_credentials from anon, authenticated;

do $$
declare
  v_secret_id uuid;
  v_token text;
begin
  if not exists (
    select 1 from public.link_rrss_agent_credentials
    where label='chatgpt-supabase-bridge'
  ) then
    v_token := 'link_agent_' || encode(extensions.gen_random_bytes(32), 'hex');
    v_secret_id := vault.create_secret(
      v_token,
      'link-rrss-agent-chatgpt-supabase-bridge',
      'Machine credential for ChatGPT -> LINKRRSS bridge'
    );
    insert into public.link_rrss_agent_credentials(label,vault_secret_id,scopes,metadata)
    values(
      'chatgpt-supabase-bridge',
      v_secret_id,
      array['publish','sync']::text[],
      '{"route":"ChatGPT -> LINKRRSS -> Zernio"}'::jsonb
    );
  end if;
end $$;

create or replace function link_private.link_rrss_agent_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, link_private, pg_temp
as $$
declare
  v_credential public.link_rrss_agent_credentials%rowtype;
  v_secret text;
  v_response extensions.http_response;
  v_body jsonb;
begin
  select *
  into v_credential
  from public.link_rrss_agent_credentials
  where label='chatgpt-supabase-bridge'
    and active=true
  limit 1;

  if v_credential.id is null then
    raise exception 'Credencial LINK Agent no disponible';
  end if;

  select decrypted_secret
  into v_secret
  from vault.decrypted_secrets
  where id=v_credential.vault_secret_id;

  if coalesce(v_secret,'')='' then
    raise exception 'No se pudo abrir la credencial LINK Agent';
  end if;

  select *
  into v_response
  from extensions.http((
    'POST'::extensions.http_method,
    'https://zgbnjlrxzvzpigmwidsp.supabase.co/functions/v1/link-rrss-agent',
    array[
      extensions.http_header('x-link-agent-key', v_secret),
      extensions.http_header('x-link-agent-id', v_credential.label),
      extensions.http_header('accept', 'application/json')
    ],
    'application/json',
    p_payload::text
  )::extensions.http_request);

  begin
    v_body := coalesce(v_response.content,'{}')::jsonb;
  exception when others then
    v_body := jsonb_build_object('ok',false,'error','Respuesta LINK Agent no JSON');
  end;

  return jsonb_build_object('http_status',v_response.status,'response',v_body);
end;
$$;

revoke all on function link_private.link_rrss_agent_request(jsonb) from public, anon, authenticated;

create table if not exists link_private.link_rrss_agent_media_chunks (
  asset_key text not null,
  chunk_index integer not null,
  chunk_data text not null,
  created_at timestamptz not null default now(),
  primary key(asset_key, chunk_index)
);
revoke all on link_private.link_rrss_agent_media_chunks from public, anon, authenticated;

create or replace function link_private.link_rrss_publish_staged(
  p_asset_key text,
  p_source_id uuid,
  p_account_id uuid,
  p_filename text,
  p_content_type text,
  p_caption text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, link_private, pg_temp
as $$
declare
  v_base64 text;
  v_upload jsonb;
  v_publish jsonb;
  v_media_url text;
begin
  select string_agg(chunk_data, '' order by chunk_index)
  into v_base64
  from link_private.link_rrss_agent_media_chunks
  where asset_key=p_asset_key;

  if coalesce(v_base64,'')='' then
    raise exception 'No hay media staged para %', p_asset_key;
  end if;

  v_upload := link_private.link_rrss_agent_request(jsonb_build_object(
    'action','media.upload',
    'source_id',p_source_id,
    'filename',p_filename,
    'content_type',p_content_type,
    'base64_data',v_base64
  ));

  if coalesce((v_upload->>'http_status')::int,500) >= 300
     or coalesce((v_upload->'response'->>'ok')::boolean,false) is not true then
    return jsonb_build_object('ok',false,'stage','media.upload','upload',v_upload);
  end if;

  v_media_url := v_upload->'response'->>'public_url';
  if coalesce(v_media_url,'')='' then
    return jsonb_build_object('ok',false,'stage','media.url','upload',v_upload);
  end if;

  v_publish := link_private.link_rrss_agent_request(jsonb_build_object(
    'action','post.publish',
    'source_id',p_source_id,
    'account_id',p_account_id,
    'content',p_caption,
    'media_url',v_media_url,
    'media_type','image',
    'idempotency_key',p_idempotency_key
  ));

  if coalesce((v_publish->>'http_status')::int,500) < 300
     and coalesce((v_publish->'response'->>'ok')::boolean,false) is true then
    delete from link_private.link_rrss_agent_media_chunks where asset_key=p_asset_key;
  end if;

  return jsonb_build_object(
    'ok',coalesce((v_publish->'response'->>'ok')::boolean,false),
    'upload',v_upload,
    'publish',v_publish
  );
end;
$$;

revoke all on function link_private.link_rrss_publish_staged(text,uuid,uuid,text,text,text,text)
from public, anon, authenticated;
