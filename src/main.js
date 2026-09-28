import { createClient } from '@supabase/supabase-js';
import { createIcons, Home, MessageCircle, FileText, ChartNoAxesCombined, PlugZap, Workflow, Activity, Search, Plus, ChevronDown, RefreshCw, ArrowLeft, Instagram, Facebook, Youtube, Music2, Globe2, CircleAlert, CircleCheck, KeyRound, X, Send, ShieldCheck } from 'lucide';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LINK_WORLD_URL } from './connection.js';
import './style.css';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

db.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY'){
    const u=new URL(location.href);
    u.searchParams.set('recovery','1');
    history.replaceState({},'',u);
    setTimeout(()=>handleRecoveryFlow(),0);
  }
});

const $ = (s, r=document) => r.querySelector(s);
const safe = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = v => {
  if(!v) return '—';
  try { return new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)); }
  catch { return String(v); }
};

const state = {
  session: null,
  businesses: [],
  statuses: [],
  business: null,
  profiles: [],
  sources: [],
  accounts: [],
  section: 'home',
  activeAccount: null,
  liveData: {},
  loading: false,
  search: '',
  canManage: false,
  autoSyncAttempted: new Set(),
  workspace: null,
  snapshots: [],
  syncRuns: [],
  syncing: false,
  businessLoadedId: null,
  period: 'month',
  selectedPostId: null,
  selectedConversationId: null,
  conversationMessages: {},
  conversationLoading: {},
  socialActivity: [],
  panelRefreshAt: new Map(),
  activityType: 'all',
  activityCommentsLoadedKey: null
};

const nav = [
  ['home','Inicio',Home],
  ['inbox','Conversaciones',MessageCircle],
  ['content','Contenido',FileText],
  ['analytics','Analytics',ChartNoAxesCombined],
  ['connections','Conexiones',PlugZap],
  ['automations','Automatizaciones',Workflow],
  ['activity','Actividad',Activity]
];

const connectPlatforms=[
  ['instagram','Instagram','IG'],
  ['facebook','Facebook','f'],
  ['tiktok','TikTok','TT'],
  ['youtube','YouTube','YT'],
  ['threads','Threads','@'],
  ['linkedin','LinkedIn','in'],
  ['pinterest','Pinterest','P'],
  ['reddit','Reddit','r/'],
  ['googlebusiness','Google Business','G'],
  ['bluesky','Bluesky','BS'],
  ['whatsapp','WhatsApp','WA']
];

function iconFor(platform='') {
  const p=platform.toLowerCase();
  if(p==='instagram') return Instagram;
  if(p==='facebook') return Facebook;
  if(p==='youtube') return Youtube;
  if(p==='tiktok') return Music2;
  return Globe2;
}
function statusForBusiness(id){ return state.statuses.find(x=>x.business_id===id) || {rrss_status:'missing',account_count:0,source_count:0}; }
function statusLabel(s){
  return ({missing:'Sin configurar',mission:'Misión abierta',configuring:'Configurando',active:'Activo',attention:'Requiere atención'})[s] || s;
}
function statusDot(s){ return s==='active'?'ok':s==='attention'?'warn':s==='missing'?'off':'pending'; }

async function invokeZernio(body){
  const { data, error } = await db.functions.invoke('link-rrss-zernio',{ body });
  if(error) throw error;
  if(!data?.ok) throw new Error(data?.error || 'No se pudo consultar Zernio.');
  return data;
}

async function handleZernioReturn(){
  const params=new URLSearchParams(location.search);
  if(params.get('zernio_return')!=='1') return;
  const sourceId=params.get('source');
  const error=params.get('error');
  if(error){
    setTimeout(()=>toast('Zernio: '+(params.get('error_message')||error),true),100);
  }else if(sourceId && state.canManage){
    try{
      await invokeZernio({action:'source.sync',source_id:sourceId});
      if(state.business?.id) await invokeZernio({action:'sync.business',business_id:state.business.id,trigger:'oauth_return'});
      setTimeout(()=>toast('Cuenta conectada, recordada y sincronizada.'),100);
    }catch(e){setTimeout(()=>toast(e.message||String(e),true),100);}
  }
  ['zernio_return','source','connected','profileId','accountId','username','error','error_message','request_id','stage','platform'].forEach(k=>params.delete(k));
  const next=location.pathname+(params.toString()?'?'+params.toString():'');
  history.replaceState({},'',next);
}

async function loadBase(){
  const { data:{session} } = await db.auth.getSession();
  state.session=session;
  state.canManage=false;

  if(session){
    const { data:member } = await db.rpc('link_world_is_member');
    state.canManage=member===true;
  }

  const s=await db.from('link_world_rrss_status_v').select('*').order('business_name');
  if(s.error) throw s.error;
  state.statuses=s.data||[];
  state.businesses=state.statuses.map(x=>({
    id:x.business_id,
    slug:x.business_slug,
    name:x.business_name
  }));

  const requested=new URLSearchParams(location.search).get('business');
  state.business = state.businesses.find(x=>x.id===requested || x.slug===requested) || state.businesses[0] || null;
  await loadBusiness({restore:true});
  await handleZernioReturn();
  await handleRecoveryFlow();
}

async function loadBusiness(opts={}){
  if(!state.business){ renderApp(); return; }
  const { id } = state.business;
  const businessChanged=state.businessLoadedId!==id;
  const profileTable=state.canManage?'link_rrss_profiles':'link_rrss_public_profiles_v';
  const sourceTable=state.canManage?'link_rrss_sources':'link_rrss_public_sources_v';
  const accountTable=state.canManage?'link_rrss_accounts':'link_rrss_public_accounts_v';

  const [p,statusRow]=await Promise.all([
    db.from(profileTable).select('*').eq('business_id',id).order('created_at'),
    db.from('link_world_rrss_status_v').select('*').eq('business_id',id).maybeSingle()
  ]);
  if(p.error) throw p.error;
  state.profiles=p.data||[];
  if(statusRow.data){
    state.statuses=state.statuses.filter(x=>x.business_id!==id).concat(statusRow.data);
  }

  const profileIds=state.profiles.map(x=>x.id);
  if(profileIds.length){
    const s=await db.from(sourceTable).select('*').in('profile_id',profileIds).order('created_at');
    if(s.error) throw s.error;
    state.sources=s.data||[];
  } else state.sources=[];

  const sourceIds=state.sources.map(x=>x.id);
  if(sourceIds.length){
    const a=await db.from(accountTable).select('*').in('source_id',sourceIds).order('platform').order('username');
    if(a.error) throw a.error;
    state.accounts=a.data||[];
  } else state.accounts=[];

  if(state.canManage){
    const accountIds=state.accounts.map(x=>x.id);
    const [ws,snaps,runs,activity]=await Promise.all([
      db.from('link_rrss_workspace_state').select('*').eq('business_id',id).maybeSingle(),
      db.from('link_rrss_snapshots').select('*').eq('business_id',id).order('fetched_at',{ascending:false}),
      db.from('link_rrss_sync_runs').select('*').eq('business_id',id).order('started_at',{ascending:false}).limit(12),
      accountIds.length
        ? db.from('link_rrss_activity_cache').select('*').in('account_id',accountIds).order('occurred_at',{ascending:false}).limit(300)
        : Promise.resolve({data:[]})
    ]);
    state.workspace=ws.data||{business_id:id,last_section:'home',sync_interval_minutes:5,last_sync_status:'idle',ui_state:{}};
    state.snapshots=snaps.data||[];
    state.syncRuns=runs.data||[];
    state.socialActivity=activity.data||[];

    if((businessChanged||opts.restore) && state.workspace?.last_section && nav.some(x=>x[0]===state.workspace.last_section)){
      state.section=state.workspace.last_section;
    }
    const remembered=state.accounts.find(x=>x.id===state.workspace?.active_account_id);
    if(businessChanged || !state.activeAccount || !state.accounts.some(x=>x.id===state.activeAccount.id)){
      state.activeAccount=remembered||state.accounts[0]||null;
    }
  } else {
    state.workspace=null; state.snapshots=[]; state.syncRuns=[]; state.socialActivity=[];
    if(!state.activeAccount || !state.accounts.some(x=>x.id===state.activeAccount.id)){
      state.activeAccount=state.accounts[0]||null;
    }
  }

  state.businessLoadedId=id;
  state.liveData={};
  syncUrl();
  renderApp();

  if(state.canManage){
    persistWorkspace();
    setTimeout(()=>maybeAutoSync(false),80);
  }
}

function snapshotFor(module,accountId=state.activeAccount?.id){
  const matching=state.snapshots.filter(s=>s.module===module && (accountId?s.account_id===accountId:true));
  if(accountId) return matching.find(s=>s.account_id===accountId)||null;
  return matching[0]||null;
}
function sourceSnapshot(module){
  const source=sourceForActiveAccount()||state.sources[0];
  return state.snapshots.find(s=>s.module===module && s.source_id===source?.id && !s.account_id)||null;
}
function snapshotError(snap){
  if(!snap?.error) return null;
  try{return JSON.parse(snap.error);}catch{return {message:snap.error};}
}
function isSnapshotStale(snap){return !snap || !snap.stale_after || new Date(snap.stale_after).getTime()<=Date.now();}
function ago(v){
  if(!v)return 'Nunca';
  const ms=Date.now()-new Date(v).getTime();
  if(ms<60000)return 'Ahora';
  if(ms<3600000)return 'Hace '+Math.max(1,Math.round(ms/60000))+' min';
  if(ms<86400000)return 'Hace '+Math.round(ms/3600000)+' h';
  return fmtDate(v);
}

function periodStart(period=state.period, now=new Date()){
  const d=new Date(now);
  if(period==='day'){ d.setHours(0,0,0,0); return d; }
  if(period==='week'){ d.setDate(d.getDate()-6); d.setHours(0,0,0,0); return d; }
  if(period==='month'){ d.setDate(1); d.setHours(0,0,0,0); return d; }
  d.setMonth(0,1); d.setHours(0,0,0,0); return d;
}
function inPeriod(value,period=state.period){
  if(!value)return false;
  const d=new Date(value);
  return !Number.isNaN(d.getTime()) && d>=periodStart(period) && d<=new Date();
}
function periodControls(){
  const labels={day:'Día',week:'Semana',month:'Mes',year:'Año'};
  return '<div class="period-bar"><span>PERIODO</span>'+Object.entries(labels).map(([id,label])=>'<button data-period="'+id+'" class="'+(state.period===id?'active':'')+'">'+label+'</button>').join('')+'<small>Filtra por fecha de publicación o actividad</small></div>';
}
function compactNumber(value){
  const n=Number(value);
  if(!Number.isFinite(n))return '—';
  return new Intl.NumberFormat('es-CL',{notation:n>=1000?'compact':'standard',maximumFractionDigits:1}).format(n);
}
function numberOf(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function contentRows(){
  const snap=snapshotFor('content');
  const rows=snap?.payload?.posts||snap?.payload?.data||[];
  return Array.isArray(rows)?rows:[];
}
function rawPostMetrics(p={}){
  return p.analytics||p.metrics||p.platforms?.[0]?.analytics||{};
}
function normalizePost(p={}){
  const m=rawPostMetrics(p);
  const id=String(p._id||p.id||p.platformPostId||p.platforms?.[0]?.platformPostId||'');
  return {
    raw:p,id,
    text:p.content||p.message||p.caption||p.text||'Publicación sin texto',
    date:p.publishedAt||p.createdTime||p.createdAt||p.scheduledFor||null,
    mediaType:String(p.mediaProductType||p.mediaType||p.type||state.activeAccount?.platform||'post').toUpperCase(),
    image:p.thumbnailUrl||p.thumbnail||p.picture||p.mediaItems?.[0]?.thumbnail||null,
    url:p.platformPostUrl||p.permalink||p.platforms?.[0]?.platformPostUrl||null,
    likes:numberOf(m.likes??p.likeCount??p.likes),
    comments:numberOf(m.comments??p.commentCount??p.comments),
    shares:numberOf(m.shares??p.shareCount??p.shares),
    saves:numberOf(m.saves??p.saveCount??p.saves),
    reach:numberOf(m.reach??p.reach),
    impressions:numberOf(m.impressions??m.views??p.impressions),
    views:numberOf(m.views??p.views??m.impressions),
    engagementRate:numberOf(m.engagementRate??p.engagementRate),
    skipRate:numberOf(m.reelsSkipRate??p.reelsSkipRate),
    completionRate:numberOf(m.completionRate??p.completionRate),
    avgWatchMs:numberOf(m.igReelsAvgWatchTime??p.igReelsAvgWatchTime),
    duration:numberOf(m.videoDurationSeconds??p.videoDurationSeconds),
    updated:m.lastUpdated||p.updatedAt||null
  };
}
function filteredPosts(){
  return contentRows().map(normalizePost).filter(p=>inPeriod(p.date));
}
function median(values=[]){
  const v=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!v.length)return 0;
  const m=Math.floor(v.length/2);
  return v.length%2?v[m]:(v[m-1]+v[m])/2;
}
function postEngagement(p){return p.likes+p.comments+p.shares+p.saves;}
function postAdvice(post,pool=filteredPosts()){
  const ideas=[];
  const ers=pool.map(p=>p.engagementRate).filter(x=>x>0);
  const erMedian=median(ers);
  if(post.skipRate>=60) ideas.push({title:'Abrir más fuerte',text:'El '+post.skipRate.toFixed(1)+'% de skip sugiere probar un gancho visual o textual antes del segundo 2.'});
  else if(post.skipRate>0 && post.skipRate<45) ideas.push({title:'Conservar el inicio',text:'El skip está en '+post.skipRate.toFixed(1)+'%, señal para reutilizar el tipo de apertura en nuevas piezas.'});
  if(post.engagementRate>0 && erMedian>0){
    ideas.push(post.engagementRate>=erMedian
      ? {title:'Patrón para repetir',text:'Engagement '+post.engagementRate.toFixed(2)+'%, sobre la mediana visible de '+erMedian.toFixed(2)+'%.'}
      : {title:'Más reacción por alcance',text:'Engagement '+post.engagementRate.toFixed(2)+'%, bajo la mediana visible de '+erMedian.toFixed(2)+'%; prueba CTA o una idea más concreta.'});
  }
  if(post.saves+post.shares>post.comments && post.saves+post.shares>0) ideas.push({title:'Contenido que circula',text:'Guardados + compartidos superan comentarios. Conviene iterar este tema o formato.'});
  if(post.reach>0 && postEngagement(post)===0) ideas.push({title:'Alcance sin respuesta',text:'La pieza llegó a personas pero no registra interacción: revisa promesa, cierre y llamada a la acción.'});
  if(!ideas.length) ideas.push({title:'Seguir midiendo',text:'Todavía faltan señales suficientes para una recomendación específica en esta pieza.'});
  return ideas.slice(0,3);
}
function conversationRows(){
  const snap=snapshotFor('inbox');
  const rows=snap?.payload?.data||snap?.payload?.conversations||[];
  return Array.isArray(rows)?rows:[];
}
function conversationDate(c){return c?.updatedTime||c?.updatedAt||c?.lastMessageAt||null;}
function conversationText(c){
  return typeof c?.lastMessage==='string'?c.lastMessage:(c?.lastMessage?.text||c?.lastMessageText||c?.preview||'Conversación');
}
function conversationStatus(id,row){
  const saved=state.workspace?.ui_state?.conversation_status?.[id];
  if(saved)return saved;
  if(Number(row?.unreadCount||0)>0)return 'pending';
  if(String(row?.status||'').toLowerCase()==='closed')return 'resolved';
  return 'open';
}
function statusLabelConversation(status){
  return ({pending:'Por responder',open:'En curso',resolved:'Resuelta'})[status]||status;
}
function suggestedReplies(row){
  const t=conversationText(row).toLowerCase();
  if(/hora|abiert|cierr|hasta que|hasta q/.test(t)) return [
    '¡Hola! Gracias por escribirnos. Te confirmo el horario de hoy enseguida. ¿Quieres venir al local o retirar un pedido?',
    '¡Hola! Claro, te ayudo. ¿Para qué hora necesitas venir o retirar tu pedido?'
  ];
  if(/reserv|mesa|personas|pax/.test(t)) return [
    '¡Hola! Claro. ¿Para qué día, hora y cuántas personas necesitas la reserva?',
    '¡Hola! Te ayudo con la reserva. Envíame fecha, hora y cantidad de personas y lo revisamos.'
  ];
  if(/karaoke|música|musica|evento|tocan|artista/.test(t)) return [
    '¡Hola! Sí, te puedo confirmar la programación. ¿Qué día estás pensando venir?',
    '¡Hola! Gracias por escribirnos. Dime la fecha y te confirmamos qué actividad tenemos ese día.'
  ];
  if(/precio|carta|menu|menú|comida|pedido/.test(t)) return [
    '¡Hola! Claro. ¿Qué te gustaría pedir o qué tipo de comida buscas? Te orientamos con la carta.',
    '¡Hola! Te ayudo con eso. Dime qué producto o plato estás buscando y te confirmamos la información.'
  ];
  return [
    '¡Hola! Gracias por escribirnos. ¿En qué te podemos ayudar?',
    '¡Hola! Gracias por contactarnos. Cuéntame un poco más y te ayudamos por aquí.'
  ];
}
function normalizeMessages(payload){
  const list=Array.isArray(payload)?payload:(payload?.data||payload?.messages||[]);
  if(!Array.isArray(list))return [];
  return list.map((m,i)=>{
    const text=typeof m==='string'?m:(m.text||m.message||m.content||m.body||'[Contenido adjunto]');
    const direction=String(m.direction||m.type||m.senderType||'').toLowerCase();
    const outgoing=m.isFromMe===true||m.fromMe===true||direction.includes('out')||direction==='sent'||direction==='account';
    return {id:String(m.id||m._id||i),text,date:m.createdAt||m.createdTime||m.timestamp||m.sentAt||null,outgoing};
  });
}
function socialActivityRows(){
  const rows=[...(state.socialActivity||[])];
  const known=new Set(rows.map(x=>x.activity_type+':'+x.external_id));
  if(!rows.length){
    for(const c of conversationRows()){
      const d=conversationDate(c); if(!d)continue;
      rows.push({activity_type:'message',external_id:String(c.id||c._id||d),occurred_at:d,payload:{
        conversation_id:c.id||c._id,participant_name:c.participantName||c.participantUsername||'Contacto',
        participant_username:c.participantUsername||null,message:conversationText(c),unread_count:Number(c.unreadCount||0),url:c.url||null
      }});
    }
    for(const p of contentRows().map(normalizePost)){
      if(!p.id||!p.date)continue;
      rows.push({activity_type:'publication',external_id:p.id,occurred_at:p.date,payload:{post_id:p.id,text:p.text,url:p.url,metrics:rawPostMetrics(p.raw)}});
    }
  }
  const comments=state.liveData.activityComments||[];
  for(const c of comments){
    const key='comment:'+c.external_id;
    if(known.has(key))continue;
    rows.push(c);known.add(key);
  }
  return rows.filter(x=>inPeriod(x.occurred_at)).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
}

function syncStateLabel(){
  if(state.syncing)return 'Sincronizando';
  const s=state.workspace?.last_sync_status||'idle';
  return ({ok:'Al día',partial:'Parcial',error:'Error',syncing:'Sincronizando',idle:'Sin sincronizar'})[s]||s;
}
async function persistWorkspace(){
  if(!state.canManage||!state.business)return;
  try{
    await invokeZernio({
      action:'workspace.touch',
      business_id:state.business.id,
      last_section:state.section,
      active_account_id:state.activeAccount?.id||null,
      active_profile_id:state.profiles[0]?.id||null
    });
  }catch{}
}
function needsAutoSync(){
  if(!state.canManage||!state.sources.length||state.syncing)return false;
  const last=state.workspace?.last_full_sync_at;
  if(!last)return true;
  const minutes=Number(state.workspace?.sync_interval_minutes||5);
  return Date.now()-new Date(last).getTime()>minutes*60000;
}
async function maybeAutoSync(force=false){
  if(!state.canManage||!state.business||!state.sources.length||state.syncing)return;
  if(!force && !needsAutoSync())return;
  state.syncing=true;
  renderApp();
  try{
    await invokeZernio({action:'sync.business',business_id:state.business.id,trigger:force?'manual':'app_open'});
    await loadBusiness({restore:false});
  }catch(e){
    state.syncing=false;
    toast(e.message||String(e),true);
    await loadBusiness({restore:false});
  }finally{
    state.syncing=false;
  }
}

function syncUrl(){
  if(!state.business) return;
  const u=new URL(location.href);
  u.searchParams.set('business',state.business.id);
  history.replaceState({},'',u);
}

function renderLogin(){
  $('#app').innerHTML=`
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand-mark">L</div>
        <span class="eyebrow">LINK WORLD / RRSS</span>
        <h1>Entra al aparato social.</h1>
        <p>Usa tu sesión de LINK CONTROL CENTRAL. Las credenciales Zernio permanecen cifradas y nunca se exponen en el navegador.</p>
        <form id="login-form">
          <label>Correo<input id="email" type="email" autocomplete="username" required></label>
          <label>Contraseña<input id="password" type="password" autocomplete="current-password" required></label>
          <button type="submit">Entrar</button>
        </form>
        <div id="auth-error" class="inline-error hidden"></div>
      </section>
    </main>`;
  $('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const errorBox=$('#auth-error');
    errorBox.classList.add('hidden');
    const {error}=await db.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(error){errorBox.textContent=error.message;errorBox.classList.remove('hidden');return;}
    await loadBase();
  });
}
function renderDenied(){
  $('#app').innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="brand-mark">L</div><h1>Acceso LINK requerido.</h1><p>La sesión existe, pero no pertenece al equipo autorizado de LINK WORLD.</p><button id="logout">Cerrar sesión</button></section></main>`;
  $('#logout').onclick=()=>db.auth.signOut().then(()=>loadBase());
}

function sidebar(){
  const visible=state.businesses.filter(b=>!state.search || b.name.toLowerCase().includes(state.search.toLowerCase()));
  return `
    <aside class="sidebar">
      <div class="side-top">
        <div class="app-title"><span class="brand-mark small">L</span><div><strong>LINK RRSS</strong><small>aparato social</small></div></div>
        <button class="icon-btn" id="close-mobile">×</button>
      </div>
      ${state.canManage?'<button class="new-connection" id="quick-connect"><span>＋</span>Nueva conexión</button>':'<button class="new-connection" id="admin-access"><span>⌁</span>Administrar</button>'}
      <div class="side-search"><i data-lucide="search"></i><input id="business-search" placeholder="Buscar negocio" value="${safe(state.search)}"></div>
      <div class="side-label">NEGOCIOS</div>
      <nav class="business-list">
        ${visible.map(b=>{const st=statusForBusiness(b.id);return `
          <button class="business-item ${state.business?.id===b.id?'active':''}" data-business="${b.id}">
            <span class="business-avatar">${safe(b.name.slice(0,1).toUpperCase())}</span>
            <span class="business-copy"><strong>${safe(b.name)}</strong><small>${st.account_count||0} cuentas · ${safe(statusLabel(st.rrss_status))}</small></span>
            <span class="status-dot ${statusDot(st.rrss_status)}"></span>
          </button>`}).join('')}
      </nav>
      <div class="side-footer">
        <button id="back-world"><i data-lucide="arrow-left"></i><span>Volver a LINK WORLD</span></button>
        ${state.canManage?'<button id="logout"><span class="user-dot"></span><span>Sesión LINK</span><small>Salir</small></button>':'<button id="admin-login"><span class="user-dot public"></span><span>Vista abierta</span><small>Administrar</small></button>'}
      </div>
    </aside>`;
}

function topbar(){
  const st=state.business?statusForBusiness(state.business.id):{};
  return `
    <header class="topbar">
      <button class="mobile-menu" id="mobile-menu">☰</button>
      <div class="crumb"><span>LINK WORLD</span><b>/</b><strong>${safe(state.business?.name||'RRSS')}</strong></div>
      <div class="top-actions">
        ${state.canManage?'<span class="sync-memory '+(state.syncing?'syncing':'')+'"><b>'+safe(syncStateLabel())+'</b><small>'+safe(ago(state.workspace?.last_full_sync_at))+'</small></span>':''}
        <span class="health-pill ${statusDot(st.rrss_status)}"><span></span>${safe(statusLabel(st.rrss_status))}</span>
        <button class="icon-btn ${state.syncing?'spin':''}" id="refresh" title="Forzar sincronización"><i data-lucide="refresh-cw"></i></button>
      </div>
    </header>`;
}

function sectionNav(){
  return `<nav class="section-nav">${nav.map(([id,label])=>`
    <button data-section="${id}" class="${state.section===id?'active':''}"><i data-lucide="${({home:'home',inbox:'message-circle',content:'file-text',analytics:'chart-no-axes-combined',connections:'plug-zap',automations:'workflow',activity:'activity'})[id]}"></i><span>${label}</span></button>`).join('')}</nav>`;
}

function accountStrip(){
  if(!state.accounts.length) return '';
  return `<div class="account-strip">
    <span class="strip-label">CUENTAS</span>
    ${state.accounts.map(a=>`<button data-account="${a.id}" class="${state.activeAccount?.id===a.id?'active':''}"><span class="platform-dot">${safe((a.platform||'?').slice(0,1).toUpperCase())}</span><span>${safe(a.username?'@'+a.username:(a.display_name||a.platform))}</span></button>`).join('')}
  </div>`;
}

function emptyMission(){
  const st=statusForBusiness(state.business.id);
  return `
    <section class="empty-apparatus">
      <div class="empty-orbit"><span></span><span></span><b>RRSS</b></div>
      <span class="eyebrow">${st.rrss_status==='mission'?'MISIÓN EN CURSO':'APARATO NO CONSTRUIDO'}</span>
      <h1>${safe(state.business.name)} todavía no tiene su aparato RRSS.</h1>
      <p>Podemos convertir esta ausencia en una misión de LINK WORLD o conectarlo ahora mismo usando una API de Zernio.</p>
      <div class="empty-actions">
        ${state.canManage?'<button class="primary" id="create-mission">'+(st.rrss_status==='mission'?'Ver misión activa':'Generar misión RRSS')+'</button><button id="connect-now">Conectar Zernio</button>':'<button class="primary" id="admin-empty">Administrar aparato</button>'}
      </div>
      <div class="flow-line"><span>Negocio</span><i>→</i><span>Perfil RRSS</span><i>→</i><span>Zernio API</span><i>→</i><span>Cuentas</span><i>→</i><span>Actividad</span></div>
    </section>`;
}

function homeSection(){
  if(!state.profiles.length && !state.sources.length) return emptyMission();
  const account=state.activeAccount||state.accounts[0]||null;
  const content=account?snapshotFor('content',account.id):null;
  const analytics=account?snapshotFor('analytics',account.id):null;
  const inbox=account?snapshotFor('inbox',account.id):null;
  const caps=account?snapshotFor('capabilities',account.id):null;
  const posts=content?.payload?.posts||content?.payload?.data||[];
  const aroot=analytics?.payload||{};
  const overview=aroot.overview||{};
  const inboxRows=inbox?.payload?.data||inbox?.payload?.conversations||[];
  const inboxLabel=inbox?.status==='blocked'?'Bloqueado':Array.isArray(inboxRows)?inboxRows.length:'—';
  const healthy=state.accounts.filter(x=>x.status==='connected').length;
  const last=state.workspace?.last_full_sync_at;

  return `
    <section class="hero rrss-command-hero">
      <div>
        <span class="eyebrow">APARATO RRSS / ${safe(state.business.name.toUpperCase())}</span>
        <h1>La puerta social de ${safe(state.business.name)}.</h1>
        <p>LINK RRSS recuerda lo último que sabe, abre con contexto y refresca Zernio en segundo plano.</p>
      </div>
      <div class="memory-orb ${state.syncing?'syncing':''}"><b>${safe(syncStateLabel())}</b><span>${safe(ago(last))}</span></div>
    </section>
    <section class="metric-row">
      <article><strong>${state.accounts.length}</strong><span>Cuentas conectadas</span></article>
      <article><strong>${overview.totalPosts??(Array.isArray(posts)?posts.length:'—')}</strong><span>Posts detectados</span></article>
      <article><strong>${safe(inboxLabel)}</strong><span>Conversaciones</span></article>
      <article><strong>${healthy}/${state.accounts.length||0}</strong><span>Salud de cuentas</span></article>
    </section>
    <div class="home-grid">
      <section class="panel span2">
        <div class="panel-head"><div><span class="eyebrow">MEMORIA RECIENTE</span><h2>Qué está pasando</h2></div><span class="freshness">${safe(content?ago(content.fetched_at):'Construyendo')}</span></div>
        <div class="activity-feed">
          ${Array.isArray(posts)&&posts.length?posts.slice(0,5).map(p=>`<div class="activity-row"><span class="activity-type">${safe(p.mediaType||'Post')}</span><div><strong>${safe((p.message||p.content||p.caption||'Publicación sin texto').slice(0,120))}</strong><small>${safe(fmtDate(p.createdTime||p.publishedAt||p.createdAt))} · ♥ ${safe(p.likeCount??'—')} · ◌ ${safe(p.commentCount??'—')}</small></div></div>`).join(''):emptyMemory('Primera memoria en construcción','LINK RRSS está sincronizando la actividad de esta cuenta.')}
        </div>
      </section>
      <section class="panel apparatus-health">
        <div class="panel-head"><div><span class="eyebrow">CAPACIDADES</span><h2>Estado del aparato</h2></div><button data-section-jump="connections">Gestionar</button></div>
        <div class="capability-list">
          <div><span class="status-dot ${account?.can_post===false?'warn':'ok'}"></span><b>Publicación</b><small>${account?.can_post===false?'Limitada':'Disponible'}</small></div>
          <div><span class="status-dot ${account?.can_analytics===false?'warn':'ok'}"></span><b>Analytics</b><small>${account?.can_analytics===false?'Limitado':'Disponible'}</small></div>
          <div><span class="status-dot ${caps?.payload?.inbox?'ok':inbox?.status==='blocked'?'warn':'pending'}"></span><b>Inbox</b><small>${inbox?.status==='blocked'?'Falta '+safe(snapshotError(inbox)?.required_group||'permiso'):caps?.payload?.inbox?'Disponible':'Pendiente'}</small></div>
          <div><span class="status-dot ${state.sources[0]?.status==='healthy'?'ok':'warn'}"></span><b>Zernio</b><small>${safe(state.sources[0]?.status||'sin fuente')}</small></div>
        </div>
      </section>
    </div>`;
}

function connectionsSection(){
  const profile=state.profiles[0]||null;
  return `
    <section class="section-heading zernio-heading">
      <div><span class="eyebrow">PERFIL / CONEXIONES</span><h1>Conexiones</h1><p>Primero el perfil. Después las redes conectadas a ese perfil, igual que en Zernio.</p></div>
      ${state.canManage?(state.sources.length?'<button class="primary" id="add-network">＋ Conectar red</button>':'<button class="primary" id="add-source">＋ Conectar Zernio</button>'):'<button class="primary" id="admin-connections">Administrar</button>'}
    </section>

    <div class="z-connect-shell">
      <aside class="z-profile-column">
        <div class="z-block-title"><span>PERFIL</span><small>1 negocio · 1 contexto</small></div>
        <article class="z-profile-card active">
          <div class="z-profile-avatar">${safe(state.business.name.slice(0,1).toUpperCase())}</div>
          <div><strong>${safe(profile?.name||state.business.name)}</strong><small>${safe(state.business.name)} · LINK WORLD</small></div>
          <span class="status-dot ${profile?'ok':'off'}"></span>
        </article>
        <div class="z-profile-note">Todas las cuentas que conectemos aquí pertenecen a este perfil del negocio.</div>
      </aside>

      <section class="z-connections-main">
        <div class="z-stepbar">
          <span class="done"><b>1</b> Perfil</span><i>→</i>
          <span class="${state.sources.length?'done':'active'}"><b>2</b> Zernio</span><i>→</i>
          <span class="${state.accounts.length?'done':state.sources.length?'active':''}"><b>3</b> Redes</span>
        </div>

        ${state.sources.length?state.sources.map(s=>`
          <article class="z-source">
            <div class="z-source-top">
              <div class="zernio-mark">Z</div>
              <div class="z-source-copy">
                <span class="eyebrow">FUENTE ZERNIO</span>
                <h2>${safe(s.label)}</h2>
                <p>${safe(s.metadata?.external_profile_name||'Perfil Zernio vinculado')}</p>
              </div>
              <span class="health-pill ${s.status==='healthy'?'ok':'warn'}"><span></span>${safe(s.status)}</span>
            </div>
            <div class="z-account-list">
              ${state.accounts.filter(a=>a.source_id===s.id).map(a=>`
                <div class="z-account-row">
                  <span class="z-platform-badge">${safe((a.platform||'?').slice(0,2).toUpperCase())}</span>
                  <div><strong>${safe(a.display_name||a.username||a.platform)}</strong><small>${safe(a.username?'@'+a.username:a.platform)}</small></div>
                  <span class="z-account-cap">${a.can_post===false?'Lectura':'Conectado'}</span>
                </div>`).join('')||'<div class="z-empty-row">Todavía no hay redes conectadas a este perfil.</div>'}
            </div>
            ${state.canManage?'<div class="z-source-actions"><button class="sync-source" data-source-sync="'+s.id+'"><i data-lucide="refresh-cw"></i>Sincronizar</button><button class="connect-network" data-source-connect="'+s.id+'">＋ Conectar otra red</button></div>':''}
          </article>`).join(''):`
          <article class="z-empty-source">
            <div class="zernio-mark large">Z</div>
            <span class="eyebrow">PASO 2</span>
            <h2>Vincula este perfil con Zernio</h2>
            <p>La API key se usa una sola vez para identificar tu espacio Zernio y elegir qué perfil corresponde a ${safe(state.business.name)}.</p>
            ${state.canManage?'<button class="primary" id="connect-zernio-main">Conectar Zernio</button>':'<button class="primary" id="admin-zernio-main">Administrar</button>'}
          </article>`}
      </section>
    </div>
  `;
}

function issuePanel(title,snap){
  const err=snapshotError(snap)||{};
  const group=err.required_group||err.requiredGroup||null;
  return `<div class="memory-state blocked"><div class="memory-icon">!</div><div><span class="eyebrow">CAPACIDAD BLOQUEADA</span><h2>${safe(title)}</h2><p>${safe(group?'Zernio necesita habilitar el permiso '+group+'.':err.message||snap?.error||'Esta capacidad no está disponible todavía.')}</p>${group?'<span class="permission-chip">'+safe(group)+'</span>':''}</div></div>`;
}
function emptyMemory(title,text){
  return `<div class="memory-state"><div class="memory-icon">·</div><div><span class="eyebrow">MEMORIA LINK</span><h2>${safe(title)}</h2><p>${safe(text)}</p></div></div>`;
}

function inboxSection(){
  if(!state.activeAccount) return noAccounts('Conversaciones');
  const snap=snapshotFor('inbox');
  if(!snap) return '<section class="section-heading compact"><div><span class="eyebrow">INBOX</span><h1>Conversaciones</h1></div></section>'+emptyMemory('Preparando Inbox','LINK RRSS está construyendo la primera memoria de esta cuenta.');
  if(snap.status==='blocked'||snap.status==='error') return '<section class="section-heading compact"><div><span class="eyebrow">INBOX</span><h1>Conversaciones</h1></div></section>'+issuePanel('Inbox no disponible',snap);
  const rows=conversationRows().filter(c=>inPeriod(conversationDate(c)));
  const selected=rows.find(c=>String(c.id||c._id)===String(state.selectedConversationId))||null;
  const messages=selected?normalizeMessages(state.conversationMessages[String(selected.id||selected._id)]):[];
  const selectedId=selected?String(selected.id||selected._id):'';
  const selectedStatus=selected?conversationStatus(selectedId,selected):'';
  const detail=!selected
    ? '<div class="conversation-empty"><i data-lucide="message-circle"></i><strong>Selecciona una conversación</strong><span>Verás el hilo, estado, sugerencias y respuesta desde LINK.</span></div>'
    : '<div class="conversation-detail">'+
      '<header class="conversation-detail-head"><div class="conversation-person"><span class="conversation-avatar large">'+(selected.participantPicture?'<img src="'+safe(selected.participantPicture)+'" alt="">':safe((selected.participantName||selected.participantUsername||'?')[0]?.toUpperCase()||'?'))+'</span><div><strong>'+safe(selected.participantName||selected.participantUsername||'Contacto')+'</strong><small>'+safe(selected.participantUsername?'@'+selected.participantUsername:state.activeAccount.platform)+'</small></div></div>'+
      '<div class="conversation-state"><label>ESTADO<select data-conversation-status="'+safe(selectedId)+'"><option value="pending" '+(selectedStatus==='pending'?'selected':'')+'>Por responder</option><option value="open" '+(selectedStatus==='open'?'selected':'')+'>En curso</option><option value="resolved" '+(selectedStatus==='resolved'?'selected':'')+'>Resuelta</option></select></label>'+
      (Number(selected.unreadCount||0)>0?'<button data-mark-read="'+safe(selectedId)+'">Marcar leído</button>':'')+'</div></header>'+
      '<div class="message-thread">'+(state.conversationLoading[selectedId]
        ? '<div class="loading-panel">Cargando conversación…</div>'
        : messages.length
          ? messages.map(m=>'<div class="message-bubble '+(m.outgoing?'outgoing':'incoming')+'"><p>'+safe(m.text)+'</p><small>'+safe(fmtDate(m.date))+'</small></div>').join('')
          : '<div class="thread-preview"><span>ÚLTIMO MENSAJE</span><p>'+safe(conversationText(selected))+'</p><small>Abriendo el hilo completo desde Zernio…</small></div>')+'</div>'+
      '<div class="reply-assist"><span class="eyebrow">RESPUESTAS SUGERIDAS</span><div class="reply-suggestions">'+suggestedReplies(selected).map(x=>'<button data-suggest-reply="'+safe(x)+'">'+safe(x)+'</button>').join('')+'</div></div>'+
      (state.canManage?'<form class="reply-composer" data-reply-form="'+safe(selectedId)+'"><textarea id="conversation-reply" rows="3" placeholder="Escribe una respuesta…"></textarea><div><small>Se enviará por '+safe(state.activeAccount.platform)+' mediante Zernio.</small><button class="primary" type="submit"><i data-lucide="send"></i> Enviar</button></div></form>':'')+
      '</div>';
  return `
    <section class="section-heading compact"><div><span class="eyebrow">INBOX / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Conversaciones</h1><p>Lee, clasifica y responde desde LINK. ${rows.filter(x=>Number(x.unreadCount||0)>0).length} conversaciones tienen mensajes sin leer en este periodo.</p></div><span class="freshness">${safe(ago(snap.fetched_at))}</span></section>
    <div class="conversation-layout interactive">
      <div class="conversation-list">
        ${rows.length?rows.map(x=>{const id=String(x.id||x._id);const st=conversationStatus(id,x);return '<button class="conversation-item '+(selectedId===id?'active':'')+'" data-conversation="'+safe(id)+'"><span class="conversation-avatar">'+(x.participantPicture?'<img src="'+safe(x.participantPicture)+'" alt="">':safe((x.participantName||x.participantUsername||'?')[0]?.toUpperCase()||'?'))+'</span><div><strong>'+safe(x.participantName||x.participantUsername||'Contacto')+'</strong><p>'+safe(conversationText(x))+'</p><span class="conversation-status '+st+'">'+statusLabelConversation(st)+(Number(x.unreadCount||0)>0?' · '+Number(x.unreadCount)+' nuevo':'')+'</span></div><small>'+safe(ago(conversationDate(x)))+'</small></button>'}).join(''):'<div class="list-empty">Sin conversaciones en este periodo.</div>'}
      </div>
      ${detail}
    </div>`;
}


function contentSection(){
  if(!state.activeAccount) return noAccounts('Contenido');
  const snap=snapshotFor('content');
  if(snap?.status==='blocked'||snap?.status==='error') return `<section class="section-heading compact"><div><span class="eyebrow">CONTENIDO / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Publicaciones</h1></div></section>${issuePanel('Contenido no disponible',snap)}`;
  const rows=filteredPosts();
  const all=contentRows().map(normalizePost);
  const erMedian=median(all.map(p=>p.engagementRate).filter(x=>x>0));
  const body=rows.length?rows.map(p=>{
    const engagement=postEngagement(p);
    const benchmark=p.engagementRate>0&&erMedian>0?(p.engagementRate>=erMedian?'Sobre mediana':'Bajo mediana'):'Sin base';
    return `<article class="post-card rich-post post-open" data-post-open="${safe(p.id)}" tabindex="0">
      ${p.image?'<div class="post-media"><img src="'+safe(p.image)+'" alt=""></div>':''}
      <div class="post-card-body">
        <div class="post-meta"><span>${safe(p.mediaType)}</span><small>${safe(fmtDate(p.date))}</small></div>
        <p>${safe(String(p.text).slice(0,360))}</p>
        <div class="post-kpis">
          <span><b>${compactNumber(p.reach)}</b> alcance</span>
          <span><b>${compactNumber(p.views||p.impressions)}</b> vistas</span>
          <span><b>${compactNumber(engagement)}</b> interacciones</span>
          <span><b>${p.engagementRate?p.engagementRate.toFixed(2)+'%':'—'}</b> engagement</span>
        </div>
        <div class="post-foot"><span class="signal-chip">${safe(benchmark)}</span><strong>Abrir ficha →</strong></div>
      </div>
    </article>`;
  }).join(''):emptyMemory('Sin publicaciones en este periodo','Cambia el filtro o sincroniza la cuenta para ampliar la memoria.');
  return `
    <section class="section-heading compact"><div><span class="eyebrow">CONTENIDO / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Publicaciones</h1><p>Cada pieza es una ficha medible: contenido, alcance, retención, interacción y aprendizaje.</p></div><span class="freshness">${safe(snap?ago(snap.fetched_at):'Pendiente')}</span></section>
    <div id="content-live" class="content-grid">${body}</div>`;
}

function openPostDetail(postId){
  const post=contentRows().map(normalizePost).find(p=>p.id===String(postId));
  if(!post)return;
  const ideas=postAdvice(post,contentRows().map(normalizePost));
  const watch=post.avgWatchMs?Math.round(post.avgWatchMs/100)/10:null;
  const interactions=postEngagement(post);
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal post-detail-modal">
        <button class="modal-close" id="modal-close">×</button>
        <div class="post-detail-top">
          ${post.image?'<div class="post-detail-image"><img src="'+safe(post.image)+'" alt=""></div>':''}
          <div><span class="eyebrow">FICHA / ${safe(post.mediaType)}</span><h2>Qué nos enseñó esta publicación</h2><p>${safe(String(post.text).slice(0,420))}</p><small>${safe(fmtDate(post.date))}</small></div>
        </div>
        <div class="post-detail-kpis">
          <div><strong>${compactNumber(post.reach)}</strong><span>Alcance</span></div>
          <div><strong>${compactNumber(post.views||post.impressions)}</strong><span>Vistas</span></div>
          <div><strong>${compactNumber(interactions)}</strong><span>Interacciones</span></div>
          <div><strong>${post.engagementRate?post.engagementRate.toFixed(2)+'%':'—'}</strong><span>Engagement</span></div>
          <div><strong>${post.skipRate?post.skipRate.toFixed(1)+'%':'—'}</strong><span>Skip reel</span></div>
          <div><strong>${watch!==null?watch+' s':'—'}</strong><span>Watch medio</span></div>
          <div><strong>${compactNumber(post.saves)}</strong><span>Guardados</span></div>
          <div><strong>${compactNumber(post.shares)}</strong><span>Compartidos</span></div>
        </div>
        <div class="post-detail-grid">
          <section><span class="eyebrow">INTERACCIÓN</span><div class="interaction-split"><span>♥ ${post.likes} likes</span><span>◌ ${post.comments} comentarios</span><span>↗ ${post.shares} compartidos</span><span>▣ ${post.saves} guardados</span></div></section>
          <section><span class="eyebrow">SIGUIENTE APRENDIZAJE</span><div class="advice-stack">${ideas.map(i=>'<article><strong>'+safe(i.title)+'</strong><p>'+safe(i.text)+'</p></article>').join('')}</div></section>
        </div>
        <div class="post-detail-actions">${post.url?'<a href="'+safe(post.url)+'" target="_blank" rel="noreferrer">Abrir publicación ↗</a>':''}<button data-copy-post-insight="${safe(ideas.map(i=>i.title+': '+i.text).join(' | '))}">Copiar aprendizaje</button></div>
      </section>
    </div>`;
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
  $('[data-copy-post-insight]')?.addEventListener('click',async e=>{await navigator.clipboard?.writeText(e.currentTarget.dataset.copyPostInsight||'');toast('Aprendizaje copiado.');});
}


function analyticsSection(){
  if(!state.activeAccount) return noAccounts('Analytics');
  const snap=snapshotFor('analytics');
  const posts=filteredPosts();
  const total=(key)=>posts.reduce((a,p)=>a+numberOf(p[key]),0);
  const interactions=posts.reduce((a,p)=>a+postEngagement(p),0);
  const reach=total('reach');
  const views=posts.reduce((a,p)=>a+numberOf(p.views||p.impressions),0);
  const erValues=posts.map(p=>p.engagementRate).filter(x=>x>0);
  const avgEr=erValues.length?erValues.reduce((a,b)=>a+b,0)/erValues.length:(reach?interactions/reach*100:0);
  const skipValues=posts.map(p=>p.skipRate).filter(x=>x>0);
  const avgSkip=skipValues.length?skipValues.reduce((a,b)=>a+b,0)/skipValues.length:0;
  const watchValues=posts.map(p=>p.avgWatchMs).filter(x=>x>0);
  const avgWatch=watchValues.length?(watchValues.reduce((a,b)=>a+b,0)/watchValues.length/1000):0;
  const best=[...posts].sort((a,b)=>(b.engagementRate-a.engagementRate)||(b.reach-a.reach)).slice(0,6);
  const formats={};
  for(const p of posts){const k=p.mediaType||'POST';(formats[k] ||= []).push(p.engagementRate||0);}
  const formatEntries=Object.entries(formats).map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/v.length,v.length]).sort((a,b)=>b[1]-a[1]);
  const signals=[];
  if(formatEntries[0])signals.push({title:'Formato a profundizar',text:formatEntries[0][0]+' promedia '+formatEntries[0][1].toFixed(2)+'% de engagement en '+formatEntries[0][2]+' pieza(s).'});
  if(avgSkip)signals.push({title:avgSkip>=60?'Problema de retención':'Retención observable',text:'Skip promedio de reels: '+avgSkip.toFixed(1)+'%. '+(avgSkip>=60?'Prioriza aperturas más rápidas y promesa visible al inicio.':'Mantén los ganchos que reducen el abandono y pruébalos en nuevas piezas.')});
  const saves=total('saves'),shares=total('shares'),comments=total('comments');
  signals.push({title:'Tipo de reacción',text:(saves+shares>comments?'Guardados + compartidos ('+(saves+shares)+') superan comentarios ('+comments+'): conviene crear contenido que la gente quiera conservar o enviar.':'Los comentarios tienen peso relativo: abre más conversación y responde rápido para convertirla en relación.')});
  if(!posts.length)signals.push({title:'Sin muestra',text:'No hay publicaciones dentro del periodo seleccionado. Cambia el filtro para comparar.'});
  return `
    <section class="section-heading compact"><div><span class="eyebrow">ANALYTICS / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Rendimiento</h1><p>El tablero se construye desde cada publicación, no desde números aislados. Muestra solo lo que la fuente realmente entregó.</p></div><span class="freshness">${safe(snap?ago(snap.fetched_at):'Memoria de contenido')}</span></section>
    <div class="analytics-command">
      <div class="metric-row analytics-metrics">
        <article><strong>${posts.length}</strong><span>Publicaciones</span></article>
        <article><strong>${compactNumber(reach)}</strong><span>Alcance acumulado</span></article>
        <article><strong>${compactNumber(views)}</strong><span>Vistas / impresiones</span></article>
        <article><strong>${compactNumber(interactions)}</strong><span>Interacciones</span></article>
        <article><strong>${avgEr?avgEr.toFixed(2)+'%':'—'}</strong><span>Engagement medio</span></article>
        <article><strong>${avgSkip?avgSkip.toFixed(1)+'%':'—'}</strong><span>Skip medio reels</span></article>
        <article><strong>${avgWatch?avgWatch.toFixed(1)+' s':'—'}</strong><span>Watch medio</span></article>
        <article><strong>${compactNumber(saves+shares)}</strong><span>Guardados + compartidos</span></article>
      </div>
      <div class="analytics-grid">
        <section class="panel">
          <div class="panel-head"><div><span class="eyebrow">PIEZAS CLAVE</span><h2>Qué contenido está moviendo la cuenta</h2></div></div>
          <div class="ranked-posts">${best.length?best.map((p,i)=>'<button data-post-open="'+safe(p.id)+'"><span class="rank">'+String(i+1).padStart(2,'0')+'</span><div><strong>'+safe(String(p.text).slice(0,90))+'</strong><small>'+safe(p.mediaType)+' · '+compactNumber(p.reach)+' alcance · '+(p.engagementRate?p.engagementRate.toFixed(2)+'% ER':'ER —')+'</small></div><span>→</span></button>').join(''):'<p class="muted">Sin piezas en el periodo.</p>'}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><span class="eyebrow">LECTURA LINK</span><h2>Señales para avanzar</h2></div></div>
          <div class="insight-grid">${signals.slice(0,3).map(s=>'<article><strong>'+safe(s.title)+'</strong><p>'+safe(s.text)+'</p></article>').join('')}</div>
        </section>
      </div>
    </div>`;
}

function automationsSection(){
  const source=sourceForActiveAccount()||state.sources[0];
  if(!source) return noAccounts('Automatizaciones');
  const snap=sourceSnapshot('automations');
  const payload=snap?.payload||{};
  const blocks=[['Workflows',payload.workflows],['Comentario → DM',payload.comment_automations],['Secuencias',payload.sequences]];
  return `
    <section class="section-heading compact"><div><span class="eyebrow">AUTOMATIZACIÓN</span><h1>Flujos</h1><p>Estado persistente de workflows, secuencias y comentario → DM.</p></div><span class="freshness">${safe(snap?ago(snap.fetched_at):'Pendiente')}</span></section>
    <div id="automation-live" class="automation-grid">${blocks.map(([title,data])=>{
      if(!data)return `<article class="panel automation-card"><span class="eyebrow">${safe(title.toUpperCase())}</span><h2>${safe(title)}</h2><p class="muted">Aún sin memoria.</p></article>`;
      if(data.ok===false){const g=data.error?.required_group;return `<article class="panel automation-card blocked-card"><span class="eyebrow">${safe(title.toUpperCase())}</span><h2>${safe(title)}</h2><p>${safe(g?'Bloqueado · falta permiso '+g:data.error?.message||'No disponible')}</p></article>`;}
      const arr=data.data?.data||data.data?.workflows||data.data?.sequences||data.data?.automations||[];
      return `<article class="panel automation-card"><span class="eyebrow">${safe(title.toUpperCase())}</span><h2>${safe(title)}</h2><strong class="automation-count">${Array.isArray(arr)?arr.length:'✓'}</strong><p class="muted">${Array.isArray(arr)?'elementos detectados':'Conectado'}</p></article>`;
    }).join('')}</div>`;
}
function activitySection(){
  const runs=state.syncRuns||[];
  const moduleState=state.workspace?.module_state||{};
  return `
    <section class="section-heading compact"><div><span class="eyebrow">MEMORIA / TRAZABILIDAD</span><h1>Actividad</h1><p>Cada apertura, sincronización y bloqueo queda registrado. Esta es la memoria operativa del aparato RRSS.</p></div><span class="freshness">${safe(ago(state.workspace?.last_full_sync_at))}</span></section>
    <div class="activity-dashboard">
      <section class="panel">
        <div class="panel-head"><div><span class="eyebrow">SINCRONIZACIONES</span><h2>Historial</h2></div></div>
        <div class="sync-run-list">${runs.length?runs.map(r=>`<div class="sync-run"><span class="status-dot ${r.status==='ok'?'ok':r.status==='partial'?'warn':r.status==='error'?'warn':'pending'}"></span><div><strong>${safe(r.trigger||'sync')}</strong><small>${safe(fmtDate(r.started_at))} · ${safe(r.status)}</small></div><span>${safe(Array.isArray(r.modules)?r.modules.length:0)} módulos</span></div>`).join(''):'<p class="muted">Todavía no hay historial.</p>'}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><span class="eyebrow">DIAGNÓSTICO</span><h2>Último ciclo</h2></div></div>
        <div class="diagnostic-grid">
          <div><strong>${safe(moduleState.accounts??state.accounts.length)}</strong><span>cuentas</span></div>
          <div><strong>${safe(moduleState.sources??state.sources.length)}</strong><span>fuentes</span></div>
          <div><strong>${safe(moduleState.blocked?.length??0)}</strong><span>bloqueos</span></div>
          <div><strong>${safe(moduleState.errors?.length??0)}</strong><span>errores</span></div>
        </div>
        ${moduleState.blocked?.length?`<div class="blocked-summary">${moduleState.blocked.map(x=>`<span>${safe(x.module)} · falta ${safe(x.required_group||'permiso')}</span>`).join('')}</div>`:''}
      </section>
    </div>`;
}
function noAccounts(title){return `<section class="empty-apparatus small"><span class="eyebrow">${safe(title.toUpperCase())}</span><h1>Primero conecta una cuenta.</h1><p>Ve a Conexiones y añade una fuente Zernio. LINK detectará automáticamente las cuentas disponibles.</p><button class="primary" data-section-jump="connections">Ir a Conexiones</button></section>`;}

function bodySection(){
  if(!state.business) return '<section class="empty-apparatus"><h1>No hay negocios en LINK WORLD.</h1></section>';
  if(state.section==='connections') return connectionsSection();
  if(state.section==='inbox') return inboxSection();
  if(state.section==='content') return contentSection();
  if(state.section==='analytics') return analyticsSection();
  if(state.section==='automations') return automationsSection();
  if(state.section==='activity') return activitySection();
  return homeSection();
}

function renderApp(){
  $('#app').innerHTML=`
    <div class="app-shell">
      ${sidebar()}
      <div class="mobile-scrim" id="mobile-scrim"></div>
      <main class="main">
        ${topbar()}
        ${sectionNav()}
        ${accountStrip()}
        ${state.section==='connections'?'':periodControls()}
        <div class="content">${bodySection()}</div>
      </main>
    </div>
    <div id="modal-root"></div>
    <div id="toast" class="toast hidden"></div>`;
  createIcons({icons:{Home,MessageCircle,FileText,ChartNoAxesCombined,PlugZap,Workflow,Activity,Search,Plus,ChevronDown,RefreshCw,ArrowLeft,Instagram,Facebook,Youtube,Music2,Globe2,CircleAlert,CircleCheck,KeyRound,X,Send,ShieldCheck}});
  bind();
  setTimeout(()=>loadCurrentSection(),0);
}

function bind(){
  document.querySelectorAll('[data-business]').forEach(btn=>btn.onclick=async()=>{
    state.business=state.businesses.find(x=>x.id===btn.dataset.business);
    state.activeAccount=null;
    await loadBusiness({restore:true});
  });
  document.querySelectorAll('[data-section]').forEach(btn=>btn.onclick=()=>{
    state.section=btn.dataset.section; renderApp(); persistWorkspace();
  });
  document.querySelectorAll('[data-section-jump]').forEach(btn=>btn.onclick=()=>{state.section=btn.dataset.sectionJump;renderApp();persistWorkspace();});
  document.querySelectorAll('[data-account]').forEach(btn=>btn.onclick=()=>{state.activeAccount=state.accounts.find(x=>x.id===btn.dataset.account);renderApp();persistWorkspace();});
  $('#business-search')?.addEventListener('input',e=>{state.search=e.target.value;renderApp();$('#business-search')?.focus();});
  $('#quick-connect')?.addEventListener('click',openConnectionModal);
  $('#add-source')?.addEventListener('click',openConnectionModal);
  $('#connect-zernio-main')?.addEventListener('click',openConnectionModal);
  $('#connect-now')?.addEventListener('click',openConnectionModal);
  $('#add-network')?.addEventListener('click',()=>openNetworkModal(state.sources[0]?.id));
  $('#admin-zernio-main')?.addEventListener('click',openAdminLoginModal);
  $('#create-mission')?.addEventListener('click',createMission);
  $('#admin-access')?.addEventListener('click',openAdminLoginModal);
  $('#admin-login')?.addEventListener('click',openAdminLoginModal);
  $('#admin-empty')?.addEventListener('click',openAdminLoginModal);
  $('#admin-connections')?.addEventListener('click',openAdminLoginModal);
  $('#refresh')?.addEventListener('click',()=>maybeAutoSync(true));
  $('#logout')?.addEventListener('click',()=>db.auth.signOut().then(()=>loadBase()));
  $('#back-world')?.addEventListener('click',()=>{location.href=LINK_WORLD_URL+(state.business?('?business='+encodeURIComponent(state.business.id)):'');});
  $('#mobile-menu')?.addEventListener('click',()=>document.body.classList.add('side-open'));
  $('#close-mobile')?.addEventListener('click',()=>document.body.classList.remove('side-open'));
  $('#mobile-scrim')?.addEventListener('click',()=>document.body.classList.remove('side-open'));
  document.querySelectorAll('[data-source-sync]').forEach(btn=>btn.onclick=()=>syncSource(btn.dataset.sourceSync));
  document.querySelectorAll('[data-source-connect]').forEach(btn=>btn.onclick=()=>openNetworkModal(btn.dataset.sourceConnect));
  $('#load-inbox')?.addEventListener('click',loadInbox);
  $('#load-content')?.addEventListener('click',loadContent);
  $('#load-analytics')?.addEventListener('click',loadAnalytics);
  $('#load-automations')?.addEventListener('click',loadAutomations);
}

async function loadCurrentSection(){
  return;
}

function sourceForActiveAccount(){
  if(!state.activeAccount) return null;
  return state.sources.find(s=>s.id===state.activeAccount.source_id)||null;
}

function toast(text,error=false){
  const el=$('#toast'); if(!el)return;
  el.textContent=text;el.classList.toggle('error',error);el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),3500);
}

function openAdminLoginModal(){
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal compact-modal">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">MODO ADMINISTRACIÓN</span>
        <h2>Administrar LINK RRSS</h2>
        <p>La navegación queda abierta. Solo pedimos sesión LINK para conectar APIs, sincronizar Zernio o crear misiones.</p>
        <form id="admin-login-form">
          <label>Correo<input id="admin-email" type="email" autocomplete="username" required></label>
          <label>Contraseña<input id="admin-password" type="password" autocomplete="current-password" required></label>
          <button class="primary wide" type="submit">Entrar a administración</button>
        </form>
        <button class="auth-secondary" id="admin-forgot" type="button">No recuerdo mi contraseña</button>
        <div id="admin-login-error" class="connect-status hidden"></div>
      </section>
    </div>`;
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
  $('#admin-forgot').onclick=()=>openPasswordRecoveryModal();
  $('#admin-login-form').onsubmit=async e=>{
    e.preventDefault();
    const box=$('#admin-login-error');box.classList.add('hidden');
    const {error}=await db.auth.signInWithPassword({email:$('#admin-email').value.trim(),password:$('#admin-password').value});
    if(error){box.textContent=error.message;box.classList.add('error');box.classList.remove('hidden');return;}
    const {data:member}=await db.rpc('link_world_is_member');
    if(member!==true){
      await db.auth.signOut();
      box.textContent='Esta cuenta no pertenece al equipo autorizado de LINK.';
      box.classList.add('error');box.classList.remove('hidden');return;
    }
    $('#modal-root').innerHTML='';
    await loadBase();
  };
}

async function openPasswordRecoveryModal(){
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal compact-modal">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">RECUPERAR ACCESO</span>
        <h2>Crear una contraseña LINK</h2>
        <p>Te enviaremos un enlace que volverá directamente a LINK RRSS, no al Swagger del CRM.</p>
        <form id="recovery-form">
          <label>Correo<input id="recovery-email" type="email" value="gonzalogaraymunoz@gmail.com" required></label>
          <button class="primary wide" type="submit">Enviar enlace</button>
        </form>
        <div id="recovery-status" class="connect-status hidden"></div>
      </section>
    </div>`;
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('#recovery-form').onsubmit=async e=>{
    e.preventDefault();
    const box=$('#recovery-status');box.classList.remove('hidden','error');box.textContent='Enviando…';
    const redirectTo=location.origin+location.pathname+'?recovery=1';
    const {error}=await db.auth.resetPasswordForEmail($('#recovery-email').value.trim(),{redirectTo});
    if(error){box.textContent=error.message;box.classList.add('error');return;}
    box.textContent='Correo enviado. Abre el enlace desde este mismo navegador.';
  };
}

async function handleRecoveryFlow(){
  const params=new URLSearchParams(location.search);
  const rawHash=location.hash.replace(/^#/,'').replace(/^\//,'');
  let decodedHash=rawHash;
  try{ decodedHash=decodeURIComponent(rawHash); }catch{}
  const hash=new URLSearchParams(decodedHash);
  const isRecovery=params.get('recovery')==='1' || hash.get('type')==='recovery';

  if(hash.get('access_token') && hash.get('refresh_token')){
    const {error}=await db.auth.setSession({
      access_token:hash.get('access_token'),
      refresh_token:hash.get('refresh_token')
    });
    if(error) console.warn('Recovery session error',error);
  }

  if(!isRecovery && !hash.get('access_token')) return false;

  $('#modal-root').innerHTML=`
    <div class="modal-backdrop recovery-lock">
      <section class="modal compact-modal">
        <span class="eyebrow">NUEVA CONTRASEÑA</span>
        <h2>Define tu acceso LINK</h2>
        <p>Esta contraseña servirá para entrar al modo Administración de LINK RRSS.</p>
        <form id="new-password-form">
          <label>Nueva contraseña<input id="new-password" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Repetir contraseña<input id="new-password-confirm" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="primary wide" type="submit">Guardar contraseña</button>
        </form>
        <div id="new-password-status" class="connect-status hidden"></div>
      </section>
    </div>`;

  $('#new-password-form').onsubmit=async e=>{
    e.preventDefault();
    const a=$('#new-password').value,b=$('#new-password-confirm').value;
    const box=$('#new-password-status');box.classList.remove('hidden','error');
    if(a!==b){box.textContent='Las contraseñas no coinciden.';box.classList.add('error');return;}
    box.textContent='Guardando…';
    const {error}=await db.auth.updateUser({password:a});
    if(error){box.textContent=error.message;box.classList.add('error');return;}
    const u=new URL(location.href);u.searchParams.delete('recovery');history.replaceState({},'',u);
    box.textContent='Contraseña creada. Entrando a LINK RRSS…';
    setTimeout(async()=>{ $('#modal-root').innerHTML=''; await loadBase(); },700);
  };
  return true;
}

async function createMission(){
  if(!state.canManage){openAdminLoginModal();return;}
  try{
    const {data,error}=await db.rpc('link_rrss_create_mission',{p_business_id:state.business.id});
    if(error)throw error;
    toast('Misión RRSS creada en LINK WORLD.');
    state.statuses=(await db.from('link_world_rrss_status_v').select('*')).data||state.statuses;
    renderApp();
  }catch(e){toast(e.message||String(e),true);}
}

function openConnectionModal(){
  if(!state.canManage){openAdminLoginModal();return;}
  if(!state.business)return;
  let preview=null;
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal z-wizard">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">CONEXIÓN ZERNIO</span>
        <h2>Vincular perfil</h2>
        <div class="wizard-steps"><span class="active"><b>1</b> API</span><span><b>2</b> Perfil</span><span><b>3</b> Importar</span></div>
        <div id="wizard-body">
          <p>Usaremos la API para abrir tu espacio Zernio y mostrar sus perfiles. Después eliges cuál corresponde a <strong>${safe(state.business.name)}</strong>.</p>
          <form id="preview-zernio-form">
            <label>API key Zernio<div class="secret-field"><input id="source-key" type="password" placeholder="sk_…" autocomplete="off" required><span><i data-lucide="shield-check"></i>Vault</span></div></label>
            <div class="security-note">No elegimos cuentas todavía. Primero validamos el espacio Zernio y sus perfiles.</div>
            <button class="primary wide" type="submit">Continuar</button>
          </form>
        </div>
        <div id="connect-status" class="connect-status hidden"></div>
      </section>
    </div>`;
  createIcons({icons:{ShieldCheck}});
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
  $('#preview-zernio-form').onsubmit=async e=>{
    e.preventDefault();
    const key=$('#source-key').value.trim();
    const status=$('#connect-status');status.classList.remove('hidden','error');status.textContent='Leyendo perfiles de Zernio…';
    try{
      preview=await invokeZernio({action:'source.preview',api_key:key});
      status.classList.add('hidden');
      const profiles=preview.profiles||[];
      $('#wizard-body').innerHTML=`
        <p>Encontré <strong>${profiles.length}</strong> perfil(es) en Zernio. Elige el que representa a <strong>${safe(state.business.name)}</strong>.</p>
        <div class="z-profile-picker">
          ${profiles.map(p=>`<button type="button" class="z-picker-card" data-zprofile="${safe(p.id)}"><span class="zernio-mark">Z</span><div><strong>${safe(p.name)}</strong><small>${p.is_default?'Perfil predeterminado':'Perfil Zernio'}</small></div><span>→</span></button>`).join('')||'<div class="inline-error">Esta key no devolvió perfiles Zernio.</div>'}
        </div>`;
      document.querySelectorAll('[data-zprofile]').forEach(btn=>btn.onclick=()=>saveZernioProfile(key,btn.dataset.zprofile,profiles.find(p=>p.id===btn.dataset.zprofile)));
    }catch(err){status.textContent=err.message||String(err);status.classList.add('error');}
  };
}

async function saveZernioProfile(apiKey,externalProfileId,profile){
  const status=$('#connect-status');status.classList.remove('hidden','error');status.textContent='Vinculando perfil e importando cuentas…';
  try{
    const out=await invokeZernio({
      action:'source.create',
      business_id:state.business.id,
      label:'Zernio · '+(profile?.name||state.business.name),
      api_key:apiKey,
      external_profile_id:externalProfileId
    });
    status.textContent='Perfil conectado. '+out.account_count+' cuenta(s) importada(s).';
    await loadBusiness();
    setTimeout(()=>{$('#modal-root').innerHTML='';state.section='connections';renderApp();},650);
  }catch(err){status.textContent=err.message||String(err);status.classList.add('error');}
}

function openNetworkModal(sourceId){
  if(!state.canManage){openAdminLoginModal();return;}
  if(!sourceId){openConnectionModal();return;}
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal z-network-modal">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">ZERNIO / CONECTAR CUENTA</span>
        <h2>¿Qué red quieres conectar?</h2>
        <p>Zernio abrirá la autorización oficial de la plataforma y devolverá la cuenta a este perfil.</p>
        <div class="platform-grid">
          ${connectPlatforms.map(([id,label,mark])=>`<button type="button" data-platform-connect="${id}"><span class="platform-logo p-${id}">${mark}</span><strong>${label}</strong><small>Conectar</small></button>`).join('')}
        </div>
        <button class="advanced-link" id="sync-existing">Ya la conecté en Zernio · sincronizar</button>
      </section>
    </div>`;
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
  document.querySelectorAll('[data-platform-connect]').forEach(btn=>btn.onclick=()=>startPlatformConnect(sourceId,btn.dataset.platformConnect));
  $('#sync-existing').onclick=()=>{ $('#modal-root').innerHTML=''; syncSource(sourceId); };
}

async function startPlatformConnect(sourceId,platform){
  try{
    toast('Abriendo '+platform+' mediante Zernio…');
    const redirect=new URL(location.origin+location.pathname);
    redirect.searchParams.set('business',state.business.id);
    redirect.searchParams.set('source',sourceId);
    redirect.searchParams.set('zernio_return','1');
    const out=await invokeZernio({
      action:'connect.url',
      source_id:sourceId,
      platform,
      redirect_url:redirect.toString(),
      login_method:platform==='instagram'?'instagram_login':undefined
    });
    const data=out.data||{};
    const authUrl=data.authUrl||data.auth_url||data.url;
    if(authUrl){ location.href=authUrl; return; }
    if(data.alreadyConnected || data.accountId){
      await syncSource(sourceId);
      $('#modal-root').innerHTML='';
      return;
    }
    throw new Error('Zernio no devolvió una URL de autorización.');
  }catch(err){toast(err.message||String(err),true);}
}

async function syncSource(id,opts={}){
  if(!state.canManage){openAdminLoginModal();return;}
  if(!opts.silent) toast('Sincronizando Zernio…');
  try{
    await invokeZernio({action:'source.sync',source_id:id});
    if(!opts.silent) toast('Conexión actualizada.');
    await loadBusiness();
  }catch(e){
    toast(e.message||String(e),true);
  }
}

async function loadHomeLive(){return;}
async function loadInbox(){return maybeAutoSync(true);}
async function loadContent(){return maybeAutoSync(true);}
async function loadAnalytics(){return maybeAutoSync(true);}
async function loadAutomations(){return maybeAutoSync(true);}

loadBase().catch(e=>{
  $('#app').innerHTML=`<main class="auth-shell"><section class="auth-card"><h1>No pudimos abrir LINK RRSS.</h1><p>${safe(e.message||String(e))}</p></section></main>`;
});
