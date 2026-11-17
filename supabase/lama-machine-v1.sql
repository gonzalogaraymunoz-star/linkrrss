-- PREPARATION ONLY. Not applied. Dedicated machine capability; no human review flags.
-- Token hash must be installed out of band. Empty configuration denies every request.
CREATE TABLE public.link_lama_machine_config(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT false,not_before timestamptz NOT NULL DEFAULT now(),
 quota_day date NOT NULL DEFAULT current_date,claims_today integer NOT NULL DEFAULT 0,max_claims integer NOT NULL DEFAULT 30 CHECK(max_claims BETWEEN 1 AND 30));
ALTER TABLE public.link_lama_machine_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_lama_machine_config FROM PUBLIC,anon,authenticated;
CREATE TABLE public.link_lama_machine_jobs(
 conversation_id uuid PRIMARY KEY REFERENCES public.link_rrss_conversations(id),completed_revision bigint NOT NULL DEFAULT -1,
 claim_id uuid,claimed_revision bigint,claimed_message_ids uuid[],lease_until timestamptz,
 classification text,last_error text,model text,usage jsonb,completed_at timestamptz);
ALTER TABLE public.link_lama_machine_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_lama_machine_jobs FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.link_lama_machine_v1(p_action text,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE cfg public.link_lama_machine_config%rowtype;j public.link_lama_machine_jobs%rowtype;
 b constant uuid:='766f9317-97e4-43e8-aea0-ff8d7e318edc';a constant uuid:='e73576fe-3532-4dc6-b344-fa24f99f34dd';
 tok text;c record;ids uuid[];msgs jsonb;ex jsonb;r jsonb;f jsonb;e jsonb;k text;i integer:=0;v_ref text;v_anchor uuid;v_id uuid;v_ids jsonb:='[]';v_value text;source_text text;v_prior uuid;v_service text;
BEGIN
 tok:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-lama-key','');
 SELECT * INTO cfg FROM public.link_lama_machine_config WHERE id FOR UPDATE;
 IF NOT FOUND OR NOT cfg.enabled OR length(tok)<40 OR encode(sha256(convert_to(tok,'UTF8')),'hex')<>cfg.token_sha256 THEN RAISE EXCEPTION 'machine_access_denied';END IF;
 IF p_action NOT IN ('claim','complete','fail') THEN RAISE EXCEPTION 'unsupported_action';END IF;
 IF p_action='claim' THEN
  IF cfg.quota_day<>current_date THEN UPDATE public.link_lama_machine_config SET quota_day=current_date,claims_today=0 WHERE id;cfg.claims_today:=0;END IF;
  IF cfg.claims_today>=cfg.max_claims THEN RETURN jsonb_build_object('ok',true,'state','quota_paused');END IF;
  SELECT conv.id,conv.intake_content_revision INTO c FROM public.link_rrss_conversations conv
   JOIN public.link_rrss_accounts acc ON acc.id=conv.account_id JOIN public.link_rrss_sources s ON s.id=acc.source_id JOIN public.link_rrss_profiles p ON p.id=s.profile_id
   LEFT JOIN public.link_lama_machine_jobs jobs ON jobs.conversation_id=conv.id
   WHERE p.business_id=b AND conv.account_id=a AND lower(acc.platform)='whatsapp'
   AND conv.participant_id ~ '^[1-9][0-9]{7,14}$' AND conv.platform_url='https://wa.me/'||conv.participant_id
   AND conv.participant_id<>'56967885621'
   AND coalesce(jobs.completed_revision,-1)<conv.intake_content_revision AND coalesce(jobs.lease_until,'-infinity')<now()
   AND EXISTS(SELECT 1 FROM public.link_rrss_messages m WHERE m.conversation_id=conv.id AND m.direction='incoming' AND m.created_at>=cfg.not_before)
   ORDER BY conv.id FOR NO KEY UPDATE OF conv SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'state','idle');END IF;
  SELECT array_agg(x.id ORDER BY x.at,x.id),jsonb_agg(jsonb_build_object('id',x.id,'direction',x.direction,'message',x.message) ORDER BY x.at,x.id)
   INTO ids,msgs FROM (SELECT m.id,m.direction,m.message,coalesce(m.platform_created_at,m.created_at) at FROM public.link_rrss_messages m WHERE m.conversation_id=c.id ORDER BY coalesce(m.platform_created_at,m.created_at) DESC,m.id DESC LIMIT 50)x;
  INSERT INTO public.link_lama_machine_jobs(conversation_id,claim_id,claimed_revision,claimed_message_ids,lease_until) VALUES(c.id,gen_random_uuid(),c.intake_content_revision,ids,now()+interval '10 minutes')
   ON CONFLICT(conversation_id) DO UPDATE SET claim_id=excluded.claim_id,claimed_revision=excluded.claimed_revision,claimed_message_ids=excluded.claimed_message_ids,lease_until=excluded.lease_until RETURNING * INTO j;
  UPDATE public.link_lama_machine_config SET claims_today=claims_today+1 WHERE id;
  RETURN jsonb_build_object('ok',true,'state','claimed','claim_id',j.claim_id,'packet',jsonb_build_object('business_id',b,'conversation_id',c.id,'source_revision',c.intake_content_revision,'messages',msgs));
 END IF;
 SELECT * INTO j FROM public.link_lama_machine_jobs WHERE claim_id=nullif(p_data->>'claim_id','')::uuid FOR UPDATE;
 IF NOT FOUND OR j.lease_until<now() THEN RAISE EXCEPTION 'claim_not_active';END IF;
 SELECT id,intake_content_revision INTO c FROM public.link_rrss_conversations WHERE id=j.conversation_id FOR NO KEY UPDATE;
 IF p_action='fail' THEN UPDATE public.link_lama_machine_jobs SET lease_until=now()+interval '1 hour',last_error=left(p_data->>'reason',100) WHERE conversation_id=j.conversation_id;RETURN jsonb_build_object('ok',true);END IF;
 IF c.intake_content_revision IS DISTINCT FROM j.claimed_revision OR (p_data->>'source_revision')::bigint IS DISTINCT FROM j.claimed_revision THEN
  UPDATE public.link_lama_machine_jobs SET lease_until=now() WHERE conversation_id=j.conversation_id;RETURN jsonb_build_object('ok',false,'code','source_changed');END IF;
 ex:=p_data->'extraction';
 IF ex->>'business_id' IS DISTINCT FROM b::text OR ex->>'conversation_id' IS DISTINCT FROM j.conversation_id::text OR (ex->>'source_revision')::bigint IS DISTINCT FROM j.claimed_revision THEN RAISE EXCEPTION 'wrong_extraction_scope';END IF;
 IF coalesce(ex->>'classification','') NOT IN ('request','greeting','test','uncertain') OR jsonb_typeof(ex->'requests') IS DISTINCT FROM 'array' OR jsonb_array_length(ex->'requests')>8 THEN RAISE EXCEPTION 'invalid_extraction';END IF;
 IF ex->>'classification'<>'request' AND jsonb_array_length(ex->'requests')<>0 THEN RAISE EXCEPTION 'non_request_payload';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(ex->'requests') LOOP
  v_anchor:=nullif(r->>'anchor_message_id','')::uuid;
  IF NOT v_anchor=ANY(j.claimed_message_ids) OR NOT EXISTS(SELECT 1 FROM public.link_rrss_messages WHERE id=v_anchor AND conversation_id=j.conversation_id AND direction='incoming') THEN RAISE EXCEPTION 'invalid_anchor';END IF;
  IF coalesce(r->>'request_kind','') NOT IN ('tour_request','confirmation_request','other_request') OR jsonb_typeof(r->'fields') IS DISTINCT FROM 'object' OR NOT (r->'fields') ?& ARRAY['service','date','pax','language','pickup'] OR length(r::text)>10000 THEN RAISE EXCEPTION 'invalid_request';END IF;
  FOR k,f IN SELECT key,value FROM jsonb_each(r->'fields') LOOP
   IF k NOT IN ('service','date','pax','language','pickup') OR coalesce(f->>'state','') NOT IN ('unknown','proposed','conflict') OR jsonb_typeof(f->'evidence') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_field';END IF;
   IF f->>'state'='unknown' THEN
    IF f->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_array_length(f->'evidence')<>0 THEN RAISE EXCEPTION 'unknown_has_value';END IF;
   ELSE
    v_value:=f->>'value';IF coalesce(length(v_value),0) NOT BETWEEN 1 AND 500 OR jsonb_array_length(f->'evidence') NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'missing_evidence';END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(f->'evidence') LOOP
     SELECT message INTO source_text FROM public.link_rrss_messages WHERE id=(e->>'message_id')::uuid AND id=ANY(j.claimed_message_ids) AND conversation_id=j.conversation_id AND direction='incoming';
     IF source_text IS NULL OR coalesce(length(e->>'quote'),0)=0 OR strpos(source_text,e->>'quote')=0 THEN RAISE EXCEPTION 'quote_not_in_source';END IF;
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f->'evidence') ev WHERE strpos(ev->>'quote',v_value)>0) THEN RAISE EXCEPTION 'value_not_literal';END IF;
   END IF;
  END LOOP;
  v_ref:='linkrrss-request:'||md5(j.conversation_id::text||r::text)::uuid::text;
  v_service:=lower(btrim(r->'fields'->'service'->>'value'));
  SELECT id INTO v_prior FROM public.link_sales_inbox WHERE business_id=b AND source_conversation_id=j.conversation_id AND source_message_id=v_anchor AND review ? 'intake_auto_v1' AND status='received'
   AND lower(btrim(review->'intake_auto_v1'->'fields'->'service'->>'value')) IS NOT DISTINCT FROM v_service AND external_ref<>v_ref LIMIT 1;
  IF v_prior IS NOT NULL THEN
   UPDATE public.link_sales_inbox SET review=review||jsonb_build_object('intake_needs_review',true,'machine_revision_conflict',true),updated_at=now() WHERE id=v_prior;
   v_ids:=v_ids||to_jsonb(v_prior);CONTINUE;
  END IF;
  SELECT id INTO v_id FROM public.link_sales_inbox WHERE business_id=b AND channel='whatsapp' AND external_ref=v_ref;
  IF v_id IS NULL THEN
   INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,fingerprint,source_message_id,source_conversation_id,evidence,review)
   VALUES(b,'whatsapp',v_ref,md5(b::text||v_ref),v_anchor,j.conversation_id,
    jsonb_build_object('source','linkrrss','machine_model',p_data->>'model','source_revision',j.claimed_revision),
    jsonb_build_object('intake_auto_v1',r,'source_revision',j.claimed_revision,'machine_generated',true,'human_reviewed',false,'intake_needs_review',true,'reservation_confirmed',false,'payment_created',false)) RETURNING id INTO v_id;
  END IF;
  v_ids:=v_ids||to_jsonb(v_id);i:=i+1;
 END LOOP;
 UPDATE public.link_lama_machine_jobs SET completed_revision=j.claimed_revision,lease_until=NULL,claim_id=NULL,classification=ex->>'classification',last_error=NULL,model=left(p_data->>'model',150),usage=p_data->'usage',completed_at=now() WHERE conversation_id=j.conversation_id;
 RETURN jsonb_build_object('ok',true,'request_count',i,'inbox_ids',v_ids,'lead_created',false,'reservation_confirmed',false,'payment_created',false);
END $fn$;
CREATE OR REPLACE FUNCTION public.link_lama_auto_invalidate_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $iv$
BEGIN
 IF NEW.intake_content_revision IS DISTINCT FROM OLD.intake_content_revision THEN
  UPDATE public.link_sales_inbox SET review=review||jsonb_build_object('intake_needs_review',true,'machine_source_changed',true),updated_at=now()
   WHERE business_id='766f9317-97e4-43e8-aea0-ff8d7e318edc' AND source_conversation_id=NEW.id AND status='received' AND review ? 'intake_auto_v1';
 END IF;RETURN NEW;
END $iv$;
REVOKE ALL ON FUNCTION public.link_lama_auto_invalidate_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lama_auto_invalidate AFTER UPDATE OF intake_content_revision ON public.link_rrss_conversations FOR EACH ROW EXECUTE FUNCTION public.link_lama_auto_invalidate_v1();
REVOKE ALL ON FUNCTION public.link_lama_machine_v1(text,jsonb) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.link_lama_machine_v1(text,jsonb) TO anon;
