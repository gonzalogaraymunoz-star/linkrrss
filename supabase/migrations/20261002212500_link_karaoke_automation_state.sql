alter table public.link_karaoke_join_intents
  add column if not exists conversation_id uuid references public.link_rrss_conversations(id) on delete set null,
  add column if not exists welcome_sent_at timestamptz,
  add column if not exists last_prompt_at timestamptz;

create index if not exists link_karaoke_join_conversation_idx
  on public.link_karaoke_join_intents(conversation_id)
  where conversation_id is not null;

update public.link_karaoke_sites
set settings = settings || jsonb_build_object(
  'auto_welcome', coalesce((settings->>'auto_welcome')::boolean,true),
  'auto_confirm_request', true,
  'sync_seconds', 45
),
updated_at=now()
where slug='caracol';