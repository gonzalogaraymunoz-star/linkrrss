-- LAMA intake v1. No outbound communication, payments or reservation confirmation.
CREATE TABLE public.link_lama_intake_members(
 business_id uuid NOT NULL CHECK(business_id='766f9317-97e4-43e8-aea0-ff8d7e318edc'::uuid),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(business_id,user_id));
ALTER TABLE public.link_lama_intake_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_lama_intake_members FROM PUBLIC,anon,authenticated;
CREATE UNIQUE INDEX link_sales_inbox_one_pending_conversation_legacy ON public.link_sales_inbox(business_id,source_conversation_id)
 WHERE source_conversation_id IS NOT NULL AND status='received' AND (business_id<>'766f9317-97e4-43e8-aea0-ff8d7e318edc'::uuid OR external_ref IS NULL OR external_ref NOT LIKE 'linkrrss-request:%');
CREATE UNIQUE INDEX link_sales_inbox_unique_source_message_legacy ON public.link_sales_inbox(business_id,source_message_id)
 WHERE source_message_id IS NOT NULL AND (business_id<>'766f9317-97e4-43e8-aea0-ff8d7e318edc'::uuid OR external_ref IS NULL OR external_ref NOT LIKE 'linkrrss-request:%');
DROP INDEX public.link_sales_inbox_one_pending_conversation;
DROP INDEX public.link_sales_inbox_unique_source_message;
ALTER TABLE public.link_rrss_conversations ADD COLUMN intake_content_revision bigint NOT NULL DEFAULT 0;

CREATE FUNCTION public.link_rrss_lama_intake_revision_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_conversation uuid; v_business uuid;
BEGIN
 IF TG_OP='UPDATE' AND
    ROW(NEW.message,NEW.direction,NEW.sender_id,NEW.platform_created_at,to_jsonb(NEW)->'attachments',NEW.conversation_id)
    IS NOT DISTINCT FROM
    ROW(OLD.message,OLD.direction,OLD.sender_id,OLD.platform_created_at,to_jsonb(OLD)->'attachments',OLD.conversation_id)
 THEN RETURN NEW; END IF;
 FOR v_conversation IN
   SELECT DISTINCT x FROM unnest(CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.conversation_id]
      WHEN 'DELETE' THEN ARRAY[OLD.conversation_id]
      ELSE ARRAY[OLD.conversation_id,NEW.conversation_id] END) x WHERE x IS NOT NULL ORDER BY x
 LOOP
   SELECT p.business_id INTO v_business FROM public.link_rrss_conversations c
   JOIN public.link_rrss_accounts a ON a.id=c.account_id
   JOIN public.link_rrss_sources s ON s.id=a.source_id
   JOIN public.link_rrss_profiles p ON p.id=s.profile_id WHERE c.id=v_conversation;
   IF v_business='766f9317-97e4-43e8-aea0-ff8d7e318edc'::uuid THEN
     UPDATE public.link_rrss_conversations SET intake_content_revision=intake_content_revision+1 WHERE id=v_conversation;
     UPDATE public.link_sales_inbox
       SET review=review||jsonb_build_object('intake_needs_review',true),updated_at=now()
       WHERE business_id=v_business AND source_conversation_id=v_conversation AND status='received'
         AND review ? 'intake_draft_v1';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.link_rrss_lama_intake_revision_v1() FROM PUBLIC;
CREATE TRIGGER link_rrss_lama_intake_revision_v1
AFTER INSERT OR UPDATE OR DELETE ON public.link_rrss_messages
FOR EACH ROW EXECUTE FUNCTION public.link_rrss_lama_intake_revision_v1();
CREATE OR REPLACE FUNCTION public.link_lama_intake_submit_v1(p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
 u uuid:=auth.uid(); b uuid:='766f9317-97e4-43e8-aea0-ff8d7e318edc'; i public.link_sales_inbox%rowtype;
 c public.link_rrss_conversations%rowtype; r bigint; v_lead uuid; v_person uuid; v_control uuid;
 draft jsonb; v_name text; v_phone text; v_message text; v_products text; matches uuid[]; ref text;
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM public.link_lama_intake_members WHERE business_id=b AND user_id=u AND active)
 THEN RAISE EXCEPTION 'Captación LAMA no autorizada'; END IF;
 IF (p_data->>'business_id')::uuid IS DISTINCT FROM b OR p_data->>'crm_review_confirmed' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Revisión de captación obligatoria'; END IF;
 SELECT * INTO i FROM public.link_sales_inbox WHERE id=(p_data->>'inbox_id')::uuid AND business_id=b;
 IF NOT FOUND OR NOT i.review ? 'intake_draft_v1' THEN RAISE EXCEPTION 'Borrador no encontrado'; END IF;
 SELECT * INTO c FROM public.link_rrss_conversations WHERE id=i.source_conversation_id FOR NO KEY UPDATE;
 SELECT * INTO i FROM public.link_sales_inbox WHERE id=i.id FOR UPDATE;
 IF i.status='converted' THEN RETURN jsonb_build_object('ok',true,'inbox_id',i.id,'lead_id',i.lead_id,'already_submitted',true); END IF;
 IF i.status<>'received' THEN RETURN jsonb_build_object('ok',false,'code','request_not_editable'); END IF;
 draft:=i.review->'intake_draft_v1';
 IF i.review->>'intake_needs_review' IS DISTINCT FROM 'false' OR (draft->>'source_revision')::bigint<>c.intake_content_revision
 OR p_data->>'expected_draft_revision' IS DISTINCT FROM draft->>'draft_revision'
 THEN RETURN jsonb_build_object('ok',false,'code','source_changed'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(draft->'fields') f WHERE f.value->>'state'='conflict')
 THEN RETURN jsonb_build_object('ok',false,'code','unresolved_conflict'); END IF;
 SELECT p.business_id INTO v_lead FROM public.link_rrss_accounts a JOIN public.link_rrss_sources s ON s.id=a.source_id
 JOIN public.link_rrss_profiles p ON p.id=s.profile_id WHERE a.id=c.account_id AND lower(a.platform)='whatsapp';
 IF v_lead IS DISTINCT FROM b OR c.participant_id !~ '^[1-9][0-9]{7,14}$' OR c.platform_url<>'https://wa.me/'||c.participant_id
 THEN RAISE EXCEPTION 'Origen directo no validado'; END IF;
 v_phone:='+'||c.participant_id; v_name:=coalesce(nullif(c.participant_name,''),v_phone);
 PERFORM pg_advisory_xact_lock(hashtextextended('lama-intake:'||v_phone,0));
 SELECT array_agg(l.id ORDER BY l.created_at) INTO matches FROM public.sales_leads l WHERE l.business_id=b
 AND private.link_phone_identity_key(l.phone)=private.link_phone_identity_key(v_phone) AND l.stage NOT IN ('lost','won');
 v_lead:=nullif(p_data->>'existing_lead_id','')::uuid;
 IF v_lead IS NOT NULL AND NOT v_lead=ANY(coalesce(matches,ARRAY[]::uuid[])) THEN RAISE EXCEPTION 'Lead ajeno a esta identidad'; END IF;
 IF v_lead IS NULL AND cardinality(matches)>1 THEN RETURN jsonb_build_object('ok',false,'code','multiple_leads','lead_ids',to_jsonb(matches)); END IF;
 IF v_lead IS NULL AND cardinality(matches)=1 THEN v_lead:=matches[1]; END IF;
 SELECT string_agg(coalesce(m.platform_created_at,m.created_at)::text||' ['||m.direction||'] '||coalesce(m.message,'[Adjunto pendiente]'),E'\n' ORDER BY coalesce(m.platform_created_at,m.created_at),m.id)
 INTO v_message FROM public.link_rrss_messages m WHERE m.id IN (SELECT x::uuid FROM jsonb_array_elements_text(draft->'message_ids') x) AND m.conversation_id=c.id;
 v_products:=CASE WHEN draft->'fields'->'service'->>'state'='proposed' THEN left(draft->'fields'->'service'->>'value',600) ELSE NULL END;
 ref:='linkrrss-request:'||(draft->>'request_key');
 IF v_lead IS NULL THEN
   SELECT id INTO v_control FROM public.controls WHERE slug='link-control-central' LIMIT 1;
   IF v_control IS NULL THEN RAISE EXCEPTION 'Control central no disponible'; END IF;
   INSERT INTO public.sales_leads(control_id,business_id,source,external_ref,full_name,phone,interested_product,message,stage,metadata)
   VALUES(v_control,b,'whatsapp',NULL,v_name,v_phone,v_products,v_message,'new',jsonb_build_object('intake','LAMA_reviewed_v1','inbox_id',i.id,'request',draft,'evidence',i.evidence,'confirmation_state','not_confirmed'))
   RETURNING id INTO v_lead;
 ELSE
   SELECT person_id INTO v_person FROM public.link_person_leads WHERE lead_id=v_lead LIMIT 1;
   IF v_person IS NOT NULL THEN INSERT INTO public.link_interactions(person_id,business_id,lead_id,action_type,channel,source,confidence,metadata)
    VALUES(v_person,b,v_lead,'inbound_message','whatsapp','lama-intake-v1','observed',jsonb_build_object('inbox_id',i.id,'request_key',draft->>'request_key')); END IF;
 END IF;
 UPDATE public.link_sales_inbox SET status='converted',lead_id=v_lead,reviewed_by=u,reviewed_at=now(),updated_at=now(),
 review=review||jsonb_build_object('crm_submitted_by',u,'crm_submitted_at',now(),'confirmation_state','not_confirmed') WHERE id=i.id;
 SELECT person_id INTO v_person FROM public.link_person_leads WHERE lead_id=v_lead LIMIT 1;
 IF v_person IS NULL THEN RAISE EXCEPTION 'Identidad LINK pendiente de revisar; no se convirtió la solicitud'; END IF;
 RETURN jsonb_build_object('ok',true,'inbox_id',i.id,'lead_id',v_lead,'person_id',v_person,'status','converted','reservation_confirmed',false,'payment_created',false);
END $fn$;
REVOKE ALL ON FUNCTION public.link_lama_intake_submit_v1(jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.link_sales_rrss_intake_v1(p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
 v_user uuid:=auth.uid(); v_business uuid:='766f9317-97e4-43e8-aea0-ff8d7e318edc';
 v_role text; v_conversation uuid; v_revision bigint; v_ids uuid[]; v_sources jsonb;
 v_request uuid; v_ref text; v_anchor uuid; v_existing public.link_sales_inbox%rowtype;
 v_selection_hash text; v_history jsonb; v_pending jsonb; v_payload_hash text; v_manifest jsonb; v_fields jsonb; v_field record; v_sid text; v_count integer; v_id uuid; v_details jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Payload inválido'; END IF;
 IF nullif(p_data->>'business_id','')::uuid IS DISTINCT FROM v_business THEN RAISE EXCEPTION 'Negocio fuera de alcance'; END IF;
 SELECT 'intake' INTO v_role FROM public.link_lama_intake_members WHERE business_id=v_business AND user_id=v_user AND active;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Sin acceso a este negocio'; END IF;
 IF p_action NOT IN ('draft_snapshot','draft_save','list','crm_submit') THEN RAISE EXCEPTION 'Acción fuera de alcance'; END IF;
 IF p_action='list' THEN RETURN jsonb_build_object('ok',true,'requests',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM (SELECT id,external_ref,status,source_conversation_id,source_message_id,lead_id,review,evidence,created_at FROM public.link_sales_inbox WHERE business_id=v_business AND review ? 'intake_draft_v1' ORDER BY created_at DESC LIMIT 100) i),'[]'::jsonb)); END IF;
 IF p_action='crm_submit' THEN RETURN public.link_lama_intake_submit_v1(p_data); END IF;
 v_conversation:=nullif(p_data->>'conversation_id','')::uuid;
 IF v_conversation IS NULL OR jsonb_typeof(p_data->'message_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecciona mensajes'; END IF;
 IF jsonb_array_length(p_data->'message_ids') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Selecciona entre 1 y 50 mensajes'; END IF;
 SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_data->'message_ids') x;
 IF cardinality(v_ids)<>jsonb_array_length(p_data->'message_ids') THEN RAISE EXCEPTION 'Mensajes repetidos'; END IF;
 SELECT c.intake_content_revision INTO v_revision FROM public.link_rrss_conversations c
 JOIN public.link_rrss_accounts a ON a.id=c.account_id
 JOIN public.link_rrss_sources s ON s.id=a.source_id
 JOIN public.link_rrss_profiles p ON p.id=s.profile_id
 WHERE c.id=v_conversation AND p.business_id=v_business AND lower(a.platform)='whatsapp'
   AND a.id='e73576fe-3532-4dc6-b344-fa24f99f34dd'::uuid
   AND c.participant_id ~ '^[1-9][0-9]{7,14}$'
   AND c.platform_url='https://wa.me/'||c.participant_id
 FOR NO KEY UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Chat directo no validado en la cuenta LAMA'; END IF;
 SELECT count(*),jsonb_agg(jsonb_build_object('message_id',m.id,'text',m.message,'direction',m.direction,'sender_id',m.sender_id,
   'original_at',coalesce(m.platform_created_at,m.created_at),'attachments',to_jsonb(m)->'attachments')
   ORDER BY coalesce(m.platform_created_at,m.created_at),m.id)
 INTO v_count,v_sources FROM public.link_rrss_messages m WHERE m.id=ANY(v_ids) AND m.conversation_id=v_conversation;
 IF v_count<>cardinality(v_ids) THEN RAISE EXCEPTION 'Mensaje ajeno, eliminado o no disponible'; END IF;
 SELECT m.id INTO v_anchor FROM public.link_rrss_messages m WHERE m.id=ANY(v_ids)
 AND m.conversation_id=v_conversation AND m.direction='incoming' AND (length(btrim(coalesce(m.message,'')))>=1 OR (jsonb_typeof(m.attachments)='array' AND jsonb_array_length(m.attachments)>0))
 ORDER BY coalesce(m.platform_created_at,m.created_at),m.id LIMIT 1;
 IF v_anchor IS NULL THEN RAISE EXCEPTION 'Falta un mensaje entrante con texto o adjunto revisable'; END IF;
 SELECT jsonb_build_object('inbox_id',i.id,'request',i.review->'intake_draft_v1','needs_review',i.review->'intake_needs_review',
   'legacy_record',NOT (i.review ? 'intake_draft_v1')) INTO v_pending FROM public.link_sales_inbox i
   WHERE i.business_id=v_business AND i.source_conversation_id=v_conversation AND i.status='received' AND i.review ? 'intake_draft_v1' AND i.review->'intake_draft_v1'->>'request_key'=p_data->>'request_key';
 IF p_action='draft_snapshot' THEN RETURN jsonb_build_object('ok',true,'source_revision',v_revision,'sources',v_sources,'pending_request',v_pending,
   'coverage','selected_saved_messages_only','reservation_confirmed',false); END IF;
 IF (p_data->>'expected_source_revision')::bigint IS DISTINCT FROM v_revision THEN
   RETURN jsonb_build_object('ok',false,'code','source_changed','current_revision',v_revision); END IF;
 IF p_data->>'request_review_confirmed' IS DISTINCT FROM 'true' OR p_data->>'direct_chat_review_confirmed' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Revisa que sea un chat directo y una solicitud real, no un saludo ni una prueba'; END IF;
 IF p_data->>'request_kind' NOT IN ('tour_request','confirmation_request','other_request') OR p_data->>'request_kind' IS NULL
 THEN RAISE EXCEPTION 'Tipo de solicitud no permitido'; END IF;
 v_request:=nullif(p_data->>'request_key','')::uuid;
 IF v_request IS NULL THEN RAISE EXCEPTION 'Falta clave estable de solicitud'; END IF;
 v_fields:=p_data->'fields';
 IF jsonb_typeof(v_fields) IS DISTINCT FROM 'object' OR length(v_fields::text)>8000 THEN RAISE EXCEPTION 'Campos inválidos'; END IF;
 IF NOT v_fields ?& ARRAY['service','date','pax','language','pickup'] THEN RAISE EXCEPTION 'Faltan campos, usa unknown donde corresponda'; END IF;
 FOR v_field IN SELECT * FROM jsonb_each(v_fields) LOOP
   IF v_field.key NOT IN ('service','date','pax','language','pickup','note') THEN RAISE EXCEPTION 'Campo fuera de alcance'; END IF;
   IF jsonb_typeof(v_field.value) IS DISTINCT FROM 'object'
     OR coalesce(v_field.value->>'state','') NOT IN ('unknown','proposed','conflict')
     OR jsonb_typeof(v_field.value->'source_message_ids') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'Estado o fuentes inválidos'; END IF;
   IF (v_field.value->>'state')='unknown' THEN
     IF coalesce(v_field.value->'value','null'::jsonb)<>'null'::jsonb OR jsonb_array_length(v_field.value->'source_message_ids')<>0
     THEN RAISE EXCEPTION 'Un dato desconocido no tiene valor ni fuente confirmada'; END IF;
   ELSE
     IF coalesce(v_field.value->'value','null'::jsonb)='null'::jsonb OR jsonb_array_length(v_field.value->'source_message_ids')=0
     THEN RAISE EXCEPTION 'Dato sin evidencia'; END IF;
   END IF;
   FOR v_sid IN SELECT jsonb_array_elements_text(v_field.value->'source_message_ids') LOOP
     IF NOT (v_sid::uuid=ANY(v_ids)) THEN RAISE EXCEPTION 'Fuente fuera de la selección revisada'; END IF;
   END LOOP;
 END LOOP;
 v_selection_hash:=md5(jsonb_build_object('kind',p_data->>'request_kind','fields',v_fields,'ids',to_jsonb(v_ids))::text);
 v_payload_hash:=md5(jsonb_build_object('request_kind',p_data->>'request_kind','fields',v_fields,'ids',to_jsonb(v_ids),'revision',v_revision)::text);
 SELECT jsonb_agg(x-'text' ORDER BY x->>'message_id') INTO v_manifest FROM jsonb_array_elements(v_sources) x;
 v_ref:='linkrrss-request:'||v_request::text;
 SELECT * INTO v_existing FROM public.link_sales_inbox WHERE business_id=v_business AND channel='whatsapp' AND external_ref=v_ref FOR UPDATE;
 IF FOUND THEN
   IF v_existing.source_conversation_id IS DISTINCT FROM v_conversation OR v_existing.status<>'received'
     OR NOT (v_existing.review ? 'intake_draft_v1') THEN
     RETURN jsonb_build_object('ok',false,'code','request_not_editable'); END IF;
   IF v_existing.review->'intake_draft_v1'->>'payload_hash'=v_payload_hash AND v_existing.review->>'intake_needs_review'='false' THEN
     RETURN jsonb_build_object('ok',true,'inbox_id',v_existing.id,'draft_revision',v_existing.review->'intake_draft_v1'->'draft_revision',
       'source_revision',v_revision,'status','received','reused',true,'lead_created',false,'reservation_confirmed',false);
   END IF;
   IF p_data->>'expected_draft_revision' IS DISTINCT FROM v_existing.review->'intake_draft_v1'->>'draft_revision'
   THEN RETURN jsonb_build_object('ok',false,'code','draft_changed'); END IF;
 ELSE
   SELECT id INTO v_id FROM public.link_sales_inbox WHERE business_id=v_business AND source_conversation_id=v_conversation AND status IN ('received','converted') AND review->'intake_draft_v1'->>'selection_hash'=v_selection_hash LIMIT 1;
   IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','duplicate_request','inbox_id',v_id); END IF;
   IF p_data->>'new_request_confirmed' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok',false,'code','new_request_review_required'); END IF;
 END IF;
 v_history:=coalesce(v_existing.review->'intake_history_v1','[]'::jsonb);
 IF v_existing.id IS NOT NULL THEN
   IF jsonb_typeof(v_history)<>'array' OR jsonb_array_length(v_history)>=20 THEN
     RETURN jsonb_build_object('ok',false,'code','revision_history_limit'); END IF;
   v_history:=v_history||jsonb_build_array(v_existing.review->'intake_draft_v1');
 END IF;
 v_details:=jsonb_build_object('selection_hash',v_selection_hash,'payload_hash',v_payload_hash,'request_key',v_request,'request_kind',p_data->>'request_kind','fields',v_fields,
   'source_revision',v_revision,'message_ids',to_jsonb(v_ids),'draft_revision',
   coalesce((v_existing.review->'intake_draft_v1'->>'draft_revision')::bigint,0)+1,
   'reviewed_by',v_user,'reviewed_at',now(),'coverage','selected_saved_messages_only');
 IF v_existing.id IS NULL THEN
   INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,raw_message,fingerprint,source_message_id,source_conversation_id,evidence,review,created_by)
   VALUES(v_business,'whatsapp',v_ref,NULL,md5(v_business::text||'|'||v_ref),v_anchor,v_conversation,
     jsonb_build_object('source','linkrrss','intake_v1',jsonb_build_object('source_revision',v_revision,'sources',v_manifest)),
     jsonb_build_object('intake_draft_v1',v_details,'intake_history_v1',v_history,'intake_needs_review',false),v_user)
   RETURNING id INTO v_id;
 ELSE
   v_id:=v_existing.id;
   UPDATE public.link_sales_inbox SET
     evidence=evidence||jsonb_build_object('intake_v1',jsonb_build_object('source_revision',v_revision,'sources',v_manifest)),
     review=review||jsonb_build_object('intake_draft_v1',v_details,'intake_history_v1',v_history,'intake_needs_review',false),updated_at=now()
   WHERE id=v_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'source_revision',v_revision,
   'draft_revision',v_details->'draft_revision','status','received','coverage','selected_saved_messages_only',
   'lead_created',false,'reservation_confirmed',false);
END $fn$;
REVOKE ALL ON FUNCTION public.link_sales_rrss_intake_v1(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_sales_rrss_intake_v1(text,jsonb) TO authenticated;

DO $compat$
DECLARE d text; old text; patch text;
BEGIN
 d:=pg_get_functiondef('public.link_sales_rrss(text,jsonb)'::regprocedure);
 old:=' IF p_action=''candidates'' THEN';
 IF position(old IN d)=0 OR position('explicit_selection_required' IN d)>0 THEN RAISE EXCEPTION 'RPC rrss changed: review compatibility'; END IF;
 patch:=' IF v_b=''766f9317-97e4-43e8-aea0-ff8d7e318edc''::uuid AND p_action IN (''candidates'',''import'') THEN RETURN jsonb_build_object(''ok'',false,''code'',''explicit_selection_required'',''candidates'',''[]''::jsonb); END IF;';
 EXECUTE replace(d,old,patch||E'\n'||old);
 d:=pg_get_functiondef('public.link_sales_acquisition(text,jsonb)'::regprocedure);
 old:=' IF p_action<>''convert'' THEN RAISE EXCEPTION ''Acción no permitida''; END IF;';
 IF position(old IN d)=0 OR position('draft_conversion_not_enabled' IN d)>0 THEN RAISE EXCEPTION 'RPC acquisition changed: review compatibility'; END IF;
 patch:=' IF v_b=''766f9317-97e4-43e8-aea0-ff8d7e318edc''::uuid AND v_inbox.review ? ''intake_draft_v1'' THEN RETURN jsonb_build_object(''ok'',false,''code'',''draft_conversion_not_enabled''); END IF;';
 EXECUTE replace(d,old,old||E'\n'||patch);
END $compat$;
