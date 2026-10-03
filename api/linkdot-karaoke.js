import { createClient } from '@supabase/supabase-js';

export default async function handler(req,res){
  const secret=process.env.CRON_SECRET;
  if(secret && req.headers.authorization!==`Bearer ${secret}`) return res.status(401).json({error:'unauthorized'});
  const url=process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) return res.status(500).json({error:'missing server env'});
  const db=createClient(url,key,{auth:{persistSession:false}});
  const {data,error}=await db.rpc('linkdot_karaoke_cron_worker',{p_site_slug:'caracol'});
  if(error) return res.status(500).json({error:error.message});
  return res.status(200).json({ok:true,created:data,at:new Date().toISOString()});
}
