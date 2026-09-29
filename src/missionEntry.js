import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './connection.js';

const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const safe=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=(v='')=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

function ensureStyles(){
  if(document.getElementById('link-mission-entry-style'))return;
  const style=document.createElement('style');
  style.id='link-mission-entry-style';
  style.textContent=`
    .link-mission-backdrop{position:fixed;inset:0;z-index:190;background:rgba(18,18,18,.34);backdrop-filter:blur(6px);display:grid;place-items:center;padding:18px}
    .link-mission-card{width:min(760px,100%);max-height:min(820px,90vh);overflow:auto;background:#fff;border:1px solid #dededb;border-radius:20px;box-shadow:0 28px 90px rgba(0,0,0,.22);padding:24px;color:#202123}
    .link-mission-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.link-mission-head span{font-size:8px;letter-spacing:.13em;color:#90908c;font-weight:700}
    .link-mission-head h2{font-size:30px;line-height:1.04;letter-spacing:-.045em;margin:5px 0 7px}.link-mission-head p{margin:0;color:#747474;font-size:10px;line-height:1.55;max-width:620px}
    .link-mission-close{border:0;background:#f1f1ef;width:34px;height:34px;border-radius:10px;font-size:18px}
    .link-mission-route{margin:18px 0;padding:12px 14px;border-radius:11px;background:#f7f7f5;font-size:9px;color:#666;line-height:1.55}
    .link-mission-actions{display:grid;gap:8px}.link-mission-action{border:1px solid #e4e4e1;border-radius:12px;padding:13px;display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:12px;align-items:start}
    .link-mission-code{font-size:8px;font-weight:700;color:#777;padding-top:2px}.link-mission-action strong{display:block;font-size:11px}.link-mission-action p{font-size:9px;color:#777;line-height:1.5;margin:5px 0 0}.link-mission-status{font-size:8px;border-radius:999px;padding:5px 8px;background:#f1f1ef;white-space:nowrap}
    .link-mission-action[data-status="in_progress"]{border-color:#c9d9cf;background:#fbfdfb}.link-mission-action[data-status="in_progress"] .link-mission-status{background:#e9f3ed;color:#2f6f4e}
    .link-mission-evidence{margin-top:16px;padding-top:15px;border-top:1px solid #ececea;display:flex;justify-content:space-between;gap:12px;align-items:center}.link-mission-evidence p{font-size:9px;color:#777;margin:0;line-height:1.5}.link-mission-evidence b{font-size:9px}
    .link-mission-error{padding:14px;border-radius:10px;background:#fff0ed;color:#8b3c32;font-size:10px}
    @media(max-width:620px){.link-mission-card{padding:18px;border-radius:16px}.link-mission-head h2{font-size:25px}.link-mission-action{grid-template-columns:42px 1fr}.link-mission-status{grid-column:2;justify-self:start}}
  `;
  document.head.append(style);
}

async function resolveBusiness(){
  const requested=new URLSearchParams(location.search).get('business');
  let query=db.from('link_world_rrss_status_v').select('business_id,business_slug,business_name,rrss_status');
  if(requested){
    query=/^[0-9a-f-]{36}$/i.test(requested)?query.eq('business_id',requested):query.eq('business_slug',requested);
  }else{
    const name=document.querySelector('.crumb strong')?.textContent?.trim();
    if(!name)return null;
    query=query.eq('business_name',name);
  }
  const {data,error}=await query.maybeSingle();
  if(error)throw error;
  return data||null;
}

async function readMission(business){
  const {data:request,error:reqError}=await db.from('link_world_requests')
    .select('id,title,instruction,status,evidence,created_at')
    .contains('business_ids',[business.business_id])
    .in('status',['pending','researching','awaiting_approval','approved'])
    .order('created_at',{ascending:false})
    .limit(1)
    .maybeSingle();
  if(reqError)throw reqError;
  if(!request)return {request:null,actions:[]};

  let {data:actions,error:actionError}=await db.from('link_game_actions')
    .select('id,source_id,title,description,status,category,evidence_requirement,prompt,next_prompt,metadata,created_at')
    .eq('business_id',business.business_id)
    .eq('source_type','transfer_hotel_atacama_mission_chain');
  if(actionError)throw actionError;
  if(!actions?.length){
    const fallback=await db.from('link_game_actions')
      .select('id,source_id,title,description,status,category,evidence_requirement,prompt,next_prompt,metadata,created_at')
      .eq('mission_request_id',request.id);
    if(fallback.error)throw fallback.error;
    actions=fallback.data||[];
  }
  actions=(actions||[]).sort((a,b)=>Number(a.metadata?.sequence||999)-Number(b.metadata?.sequence||999));
  return {request,actions};
}

function renderModal(business,mission){
  ensureStyles();
  document.getElementById('link-mission-entry')?.remove();
  const wrap=document.createElement('div');
  wrap.id='link-mission-entry';
  wrap.className='link-mission-backdrop';
  const actionMarkup=mission.actions.length?mission.actions.map(a=>`
    <article class="link-mission-action" data-status="${safe(a.status)}">
      <span class="link-mission-code">${safe(a.source_id||a.metadata?.mission_code||'MISIÓN')}</span>
      <div><strong>${safe(a.title)}</strong><p>${safe(a.prompt||a.description||'')}</p></div>
      <span class="link-mission-status">${safe(label(a.status))}</span>
    </article>`).join(''):'<div class="link-mission-error">La misión existe, pero todavía no tiene acciones del juego asociadas.</div>';
  wrap.innerHTML=`
    <section class="link-mission-card" role="dialog" aria-modal="true" aria-label="Misión activa">
      <div class="link-mission-head"><div><span>LINK WORLD / MISIÓN ACTIVA</span><h2>${safe(mission.request?.title||'Misión RRSS')}</h2><p>${safe(mission.request?.instruction||'')}</p></div><button class="link-mission-close" aria-label="Cerrar">×</button></div>
      <div class="link-mission-route">LINKRRSS ZERNIO → contenido → interacción → lead → solicitud → pricing → confirmación/pago → operación → cierre → aprendizaje</div>
      <div class="link-mission-actions">${actionMarkup}</div>
      <div class="link-mission-evidence"><p>El avance solo se registra con evidencia verificable. Crear o abrir la misión no entrega progreso por sí solo.</p><b>${safe(business.business_name)}</b></div>
    </section>`;
  const close=()=>wrap.remove();
  wrap.addEventListener('click',e=>{if(e.target===wrap||e.target.closest('.link-mission-close'))close();});
  document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',esc);}});
  document.body.append(wrap);
}

async function openActiveMission(button){
  const old=button.textContent;
  button.disabled=true;button.textContent='Abriendo misión…';
  try{
    const business=await resolveBusiness();
    if(!business)throw new Error('No se pudo identificar el negocio activo.');
    const mission=await readMission(business);
    if(!mission.request)throw new Error('No se encontró una misión activa para este negocio.');
    renderModal(business,mission);
  }catch(error){
    ensureStyles();
    const message=document.createElement('div');
    message.className='link-mission-backdrop';
    message.innerHTML='<section class="link-mission-card"><div class="link-mission-error">'+safe(error?.message||String(error))+'</div></section>';
    message.addEventListener('click',()=>message.remove());
    document.body.append(message);
  }finally{
    button.disabled=false;button.textContent=old;
  }
}

document.addEventListener('click',event=>{
  const button=event.target.closest('#create-mission');
  if(!button||!/ver misión activa/i.test(button.textContent||''))return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  openActiveMission(button);
},true);
