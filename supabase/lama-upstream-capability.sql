-- Extend only the existing narrow capability. No new credential or global grant.
ALTER TABLE public.link_lama_machine_config ADD COLUMN last_sync_at timestamptz;
DO $p$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('public.link_lama_machine_v1(text,jsonb)'::regprocedure);
 IF position('IF p_action NOT IN (''claim'',''complete'',''fail'')' IN d)=0 THEN RAISE EXCEPTION 'machine source changed';END IF;
 d:=replace(d,'IF p_action NOT IN (''claim'',''complete'',''fail'')','IF p_action NOT IN (''claim'',''complete'',''fail'',''sync_authorize'')');
 d:=replace(d,'IF p_action=''claim'' THEN','IF p_action=''sync_authorize'' THEN IF cfg.last_sync_at>now()-interval ''1 hour'' THEN RETURN jsonb_build_object(''ok'',true,''state'',''sync_cooldown'');END IF;UPDATE public.link_lama_machine_config SET last_sync_at=now() WHERE id;RETURN jsonb_build_object(''ok'',true,''state'',''sync_allowed'',''not_before'',cfg.not_before);END IF; IF p_action=''claim'' THEN');
 d:=replace(d,'m.created_at>=cfg.not_before','coalesce(m.platform_created_at,m.created_at)>=cfg.not_before');
 EXECUTE d;
END $p$;
