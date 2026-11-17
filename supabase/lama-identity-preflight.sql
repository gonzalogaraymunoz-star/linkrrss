DO $patch$ DECLARE d text;a text;b text;BEGIN
 d:=pg_get_functiondef('public.link_lama_intake_submit_v1(jsonb)'::regprocedure);
 a:='IF v_lead IS NULL THEN
   SELECT id INTO v_control';
 b:='IF v_lead IS NULL AND NOT coalesce(private.link_natural_person_name(v_name),false) THEN RETURN jsonb_build_object(''ok'',false,''code'',''identity_review_required'');END IF;
 IF v_lead IS NULL THEN
   SELECT id INTO v_control';
 IF position(a IN d)=0 THEN RAISE EXCEPTION 'submit source changed';END IF;
 EXECUTE replace(d,a,b);
END $patch$;
