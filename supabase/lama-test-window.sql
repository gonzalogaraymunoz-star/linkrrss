-- Controlled personal-channel test. Off by default; no customer request can be created.
ALTER TABLE public.link_lama_machine_config ADD COLUMN test_until timestamptz;
DO $patch$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('public.link_lama_machine_v1(text,jsonb)'::regprocedure);
 IF position('AND conv.participant_id<>''56967885621''' IN d)=0 THEN RAISE EXCEPTION 'claim changed';END IF;
 d:=replace(d,'AND conv.participant_id<>''56967885621''','AND (conv.participant_id<>''56967885621'' OR (cfg.test_until>now() AND EXISTS(SELECT 1 FROM public.link_rrss_messages tm WHERE tm.conversation_id=conv.id AND tm.direction=''incoming'' AND tm.created_at>=cfg.test_until-interval ''20 minutes'' AND tm.message LIKE ''PRUEBA LAMA E2E:%'')))');
 d:=replace(d,'WHERE m.conversation_id=c.id ORDER BY','WHERE m.conversation_id=c.id AND (NOT EXISTS(SELECT 1 FROM public.link_rrss_conversations tc WHERE tc.id=c.id AND tc.participant_id=''56967885621'') OR (m.direction=''incoming'' AND m.created_at>=cfg.test_until-interval ''20 minutes'' AND m.message LIKE ''PRUEBA LAMA E2E:%'')) ORDER BY');
 d:=replace(d,'FOR r IN SELECT value FROM jsonb_array_elements(ex->''requests'') LOOP','IF EXISTS(SELECT 1 FROM public.link_rrss_conversations tc WHERE tc.id=j.conversation_id AND tc.participant_id=''56967885621'') AND (ex->>''classification''<>''test'' OR jsonb_array_length(ex->''requests'')<>0) THEN RAISE EXCEPTION ''personal_test_cannot_create_request'';END IF; FOR r IN SELECT value FROM jsonb_array_elements(ex->''requests'') LOOP');
 EXECUTE d;
END $patch$;
CREATE FUNCTION public.link_lama_intake_runs_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $r$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM link_lama_intake_members WHERE business_id='766f9317-97e4-43e8-aea0-ff8d7e318edc' AND user_id=auth.uid() AND active) THEN RAISE EXCEPTION 'Sin acceso';END IF;
 RETURN jsonb_build_object('ok',true,'runs',coalesce((SELECT jsonb_agg(x) FROM (SELECT j.conversation_id,j.classification,j.completed_at,j.last_error,(c.participant_id='56967885621') AS personal_test FROM link_lama_machine_jobs j JOIN link_rrss_conversations c ON c.id=j.conversation_id WHERE c.account_id='e73576fe-3532-4dc6-b344-fa24f99f34dd' ORDER BY j.completed_at DESC NULLS LAST LIMIT 20)x),'[]'::jsonb));
END $r$;
REVOKE ALL ON FUNCTION public.link_lama_intake_runs_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_lama_intake_runs_v1() TO authenticated;
