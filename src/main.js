import { createClient } from '@supabase/supabase-js';
import { createIcons, Home, MessageCircle, FileText, ChartNoAxesCombined, PlugZap, Workflow, Activity, Search, Plus, ChevronDown, RefreshCw, ArrowLeft, Instagram, Facebook, Youtube, Music2, Globe2, CircleAlert, CircleCheck, KeyRound, X, Send, ShieldCheck, CalendarDays, Info } from 'lucide';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LINK_WORLD_URL } from './connection.js';
import './style.css';
import { operationSection, bindOperation } from './operation.js';
import { loadNotifications, startNotificationRealtime, notificationBell, bindNotifications } from './notifications.js';
import { bootKaraokeRoute } from './karaoke.js';
import { loadStudio, studioSection, bindStudio } from './studio.js';
import { comunEscuchaSection } from './comunescucha.js';
import './comunescucha.css';

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
  gameStates: [],
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
  periodOffset: 0,
  persistentPosts: [],
  publicationDrafts: [],
  persistentConversations: [],
  accountMemory: [],
  historyBackfillRequested: new Set(),
  selectedPostId: null,
  selectedConversationId: null,
  conversationMessages: {},
  conversationLoading: {},
  conversationControl: [],
  conversationFilter: 'all',
  conversationChannel: 'all',
  conversationQuery: '',
  socialActivity: [],
  panelRefreshAt: new Map(),
  activityType: 'all',
  activityCommentsLoadedKey: null,
  analyticsTab: 'overview',
  analyticsSort: 'recent',
  autoOpenedDraft: null,
  operationPlans: [],
  operationTasks: [],
  operationView: 'direction',
  notifications: [],
  dotWorkspace: null,
  dotSubdots: [],
  dotArtifacts: [],
  studioProjects: []
};

const nav = [
  ['home','Inicio',Home],
  ['artifacts','Artefactos',Workflow],
  ['inbox','Conversaciones',MessageCircle],
  ['content','Contenido',FileText],
  ['studio','Studio',Music2],
  ['operation','Operación',Activity],
  ['calendar','Calendario',CalendarDays],
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
function gameStateForBusiness(id){ return state.gameStates.find(x=>x.business_id===id) || null; }
function gameStateTone(s){
  if(!s)return 'neutral';
  if(s.game_state==='critical_frozen'||s.game_state==='red_close')return 'critical';
  if(s.game_state==='frozen'||s.game_state==='cold')return 'cold';
  if(s.game_state==='hot'||s.game_state==='very_hot')return 'hot';
  if(s.game_state==='converted')return 'converted';
  return 'warm';
}
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

  const [s,g]=await Promise.all([
    db.from('link_world_rrss_status_v').select('*').order('business_name'),
    state.canManage
      ? db.from('link_game_operating_state_v').select('business_id,name,temperature,conversion_percent,game_state,game_state_label,awaiting_evidence_count,next_action_due_at,overdue,attention_mode,panel_tone,suggested_action,suggested_prompt,hours_remaining').order('name')
      : Promise.resolve({data:[]})
  ]);
  if(s.error) throw s.error;
  state.statuses=s.data||[];
  state.gameStates=g.data||[];
  state.businesses=state.statuses.map(x=>({
    id:x.business_id,
    slug:x.business_slug,
    name:x.business_name
  }));

  const params=new URLSearchParams(location.search);
  const requested=params.get('business');
  state.business = state.businesses.find(x=>x.id===requested || x.slug===requested) || state.businesses[0] || null;
  await loadBusiness({restore:true});
  const requestedSection=params.get('section');
  if(requestedSection && nav.some(x=>x[0]===requestedSection)){
    state.section=requestedSection;
    syncUrl();
    renderApp();
    persistWorkspace();
  }
  await handleZernioReturn();
  await handleRecoveryFlow();
}

async function loadDotWorkspace(){
  state.dotWorkspace=null;
  state.dotSubdots=[];
  state.dotArtifacts=[];
  if(!state.canManage)return;

  const ws=await db.from('link_dot_workspaces')
    .select('*')
    .eq('workspace_key','linkrrss-mar')
    .eq('status','active')
    .maybeSingle();
  if(ws.error) throw ws.error;
  if(!ws.data)return;

  const [subs,arts]=await Promise.all([
    db.from('link_dot_workspace_subdots')
      .select('*')
      .eq('workspace_id',ws.data.id)
      .eq('status','active')
      .order('sort_order'),
    db.from('link_dot_artifacts')
      .select('*')
      .eq('workspace_id',ws.data.id)
      .neq('status','archived')
      .order('created_at')
  ]);
  if(subs.error) throw subs.error;
  if(arts.error) throw arts.error;
  state.dotWorkspace=ws.data;
  state.dotSubdots=subs.data||[];
  state.dotArtifacts=(arts.data||[]).filter(a=>!a.business_id||a.business_id===state.business?.id);
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

  const accountIds=state.accounts.map(x=>x.id);
  if(state.canManage){
    const [ws,snaps,runs,activity,posts,conversations,conversationControl,memory,drafts,operationPlans,operationTasks]=await Promise.all([
      db.from('link_rrss_workspace_state').select('*').eq('business_id',id).maybeSingle(),
      db.from('link_rrss_snapshots').select('*').eq('business_id',id).order('fetched_at',{ascending:false}),
      db.from('link_rrss_sync_runs').select('*').eq('business_id',id).order('started_at',{ascending:false}).limit(12),
      accountIds.length
        ? db.from('link_rrss_activity_cache').select('*').in('account_id',accountIds).order('occurred_at',{ascending:false}).limit(500)
        : Promise.resolve({data:[]}),
      accountIds.length
        ? db.from('link_rrss_posts').select('*').in('account_id',accountIds).order('published_at',{ascending:false}).limit(2000)
        : Promise.resolve({data:[]}),
      accountIds.length
        ? db.from('link_rrss_conversations').select('*').in('account_id',accountIds).order('last_message_at',{ascending:false}).limit(1000)
        : Promise.resolve({data:[]}),
      db.from('link_rrss_comunescucha_panel_v').select('*').eq('business_id',id).order('last_activity_at',{ascending:false}).limit(1000),
      accountIds.length
        ? db.from('link_rrss_account_memory').select('*').in('account_id',accountIds)
        : Promise.resolve({data:[]}),
      accountIds.length
        ? db.from('link_rrss_publication_drafts').select('*').eq('business_id',id).in('account_id',accountIds).order('created_at',{ascending:false}).limit(200)
        : Promise.resolve({data:[]}),
      db.from('link_rrss_operation_plans').select('*').eq('business_id',id).order('period_start',{ascending:false}).limit(24),
      db.from('link_rrss_operation_tasks').select('*').eq('business_id',id).order('planned_at',{ascending:true})
    ]);
    state.workspace=ws.data||{business_id:id,last_section:'home',sync_interval_minutes:5,last_sync_status:'idle',ui_state:{}};
    state.snapshots=snaps.data||[];
    state.syncRuns=runs.data||[];
    state.socialActivity=activity.data||[];
    state.persistentPosts=posts.data||[];
    state.persistentConversations=conversations.data||[];
    state.conversationControl=conversationControl.data||[];
    state.accountMemory=memory.data||[];
    state.publicationDrafts=drafts.data||[];
    state.operationPlans=operationPlans.data||[];
    state.operationTasks=operationTasks.data||[];
    await loadNotifications({db,state});
    await loadDotWorkspace();

    if((businessChanged||opts.restore) && state.workspace?.last_section && nav.some(x=>x[0]===state.workspace.last_section)){
      state.section=state.workspace.last_section;
    }
    const remembered=state.accounts.find(x=>x.id===state.workspace?.active_account_id);
    if(businessChanged || !state.activeAccount || !state.accounts.some(x=>x.id===state.activeAccount.id)){
      state.activeAccount=remembered||state.accounts[0]||null;
    }
  } else {
    const [posts,memory]=await Promise.all([
      db.from('link_rrss_public_posts_v').select('*').eq('business_id',id).order('published_at',{ascending:false}).limit(2000),
      db.from('link_rrss_public_memory_v').select('*').eq('business_id',id)
    ]);
    state.snapshots=[]; state.syncRuns=[]; state.socialActivity=[]; state.persistentConversations=[]; state.conversationControl=[]; state.publicationDrafts=[]; state.operationPlans=[]; state.operationTasks=[]; state.notifications=[]; state.dotWorkspace=null; state.dotSubdots=[]; state.dotArtifacts=[];
    state.persistentPosts=posts.data||[];
    state.accountMemory=memory.data||[];
    if(!state.activeAccount || !state.accounts.some(x=>x.id===state.activeAccount.id)){
      state.activeAccount=state.accounts[0]||null;
    }
    const mem=state.accountMemory.find(x=>x.account_id===state.activeAccount?.id)||state.accountMemory[0]||null;
    state.workspace={
      business_id:id,
      last_section:state.section,
      last_full_sync_at:mem?.last_successful_sync_at||null,
      last_sync_status:mem?.last_successful_sync_at?'ok':'idle',
      ui_state:{}
    };
  }

  state.businessLoadedId=id;
  state.liveData={};
  syncUrl();
  renderApp();
  startNotificationRealtime({db,state,renderApp,toast});

  const requestedDraft=new URLSearchParams(location.search).get('draft');
  if(state.canManage && requestedDraft && state.publicationDrafts.some(d=>d.id===requestedDraft) && state.autoOpenedDraft!==requestedDraft){
    state.autoOpenedDraft=requestedDraft;
    state.section='content';
    renderApp();
    setTimeout(()=>openPublicationDraftApproval(requestedDraft),30);
  }

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

function periodRange(period=state.period,offset=state.periodOffset,now=new Date()){
  const endNow=new Date(now);
  if(period==='history') return {start:new Date(0),end:endNow,label:'Todo el historial guardado'};
  if(period==='day'){
    const start=new Date(now); start.setDate(start.getDate()+offset); start.setHours(0,0,0,0);
    const end=new Date(start); end.setHours(23,59,59,999);
    return {start,end,label:start.toLocaleDateString('es-CL',{day:'numeric',month:'long',year:'numeric'})};
  }
  if(period==='week'){
    const end=new Date(now); end.setDate(end.getDate()+offset*7); end.setHours(23,59,59,999);
    const start=new Date(end); start.setDate(start.getDate()-6); start.setHours(0,0,0,0);
    return {start,end,label:start.toLocaleDateString('es-CL',{day:'numeric',month:'short'})+' — '+end.toLocaleDateString('es-CL',{day:'numeric',month:'short',year:'numeric'})};
  }
  if(period==='month'){
    const start=new Date(now.getFullYear(),now.getMonth()+offset,1,0,0,0,0);
    const end=new Date(now.getFullYear(),now.getMonth()+offset+1,0,23,59,59,999);
    return {start,end,label:start.toLocaleDateString('es-CL',{month:'long',year:'numeric'})};
  }
  const start=new Date(now.getFullYear()+offset,0,1,0,0,0,0);
  const end=new Date(now.getFullYear()+offset,11,31,23,59,59,999);
  return {start,end,label:String(start.getFullYear())};
}
function periodStart(period=state.period,now=new Date()){return periodRange(period,state.periodOffset,now).start;}
function inPeriod(value,period=state.period){
  if(!value)return false;
  const d=new Date(value); if(Number.isNaN(d.getTime())) return false;
  const range=periodRange(period,state.periodOffset,new Date());
  return d>=range.start && d<=range.end;
}
function periodControls(){
  const labels={day:'Día',week:'Semana',month:'Mes',year:'Año',history:'Histórico'};
  const range=periodRange();
  return '<div class="period-bar">'+
    '<span>PERIODO</span>'+
    Object.entries(labels).map(([id,label])=>'<button data-period="'+id+'" class="'+(state.period===id?'active':'')+'">'+label+'</button>').join('')+
    '<div class="period-nav">'+
      (state.period!=='history'?'<button data-period-shift="-1" aria-label="Periodo anterior">←</button><b>'+safe(range.label)+'</b><button data-period-shift="1" aria-label="Periodo siguiente">→</button>':'<b>'+safe(range.label)+'</b>')+
      (state.periodOffset!==0?'<button data-period-now="1">Hoy</button>':'')+
    '</div>'+
    '<small>La información viene de memoria persistente, no solo de la última sincronización.</small>'+
  '</div>';
}
function compactNumber(value){
  const n=Number(value);
  if(!Number.isFinite(n))return '—';
  return new Intl.NumberFormat('es-CL',{notation:n>=1000?'compact':'standard',maximumFractionDigits:1}).format(n);
}
function numberOf(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function contentRows(){
  const persisted=(state.persistentPosts||[]).filter(x=>!state.activeAccount||x.account_id===state.activeAccount.id);
  if(persisted.length) return persisted;
  const snap=snapshotFor('content');
  const rows=snap?.payload?.posts||snap?.payload?.data||[];
  return Array.isArray(rows)?rows:[];
}
function rawPostMetrics(p={}){
  return p.analytics||p.metrics||p.platforms?.[0]?.analytics||{};
}
function normalizePost(p={}){
  const m=rawPostMetrics(p);
  const id=String(p.external_post_id||p.platform_post_id||p._id||p.id||p.platformPostId||p.platforms?.[0]?.platformPostId||'');
  return {
    raw:p,id,
    text:p.content||p.message||p.caption||p.text||'Publicación sin texto',
    date:p.published_at||p.publishedAt||p.createdTime||p.createdAt||p.scheduled_for||p.scheduledFor||null,
    mediaType:String(p.media_type||p.mediaProductType||p.mediaType||p.type||state.activeAccount?.platform||'post').toUpperCase(),
    image:p.thumbnail_url||p.thumbnailUrl||p.thumbnail||p.picture||p.mediaItems?.[0]?.thumbnail||null,
    url:p.post_url||p.platformPostUrl||p.permalink||p.platforms?.[0]?.platformPostUrl||null,
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
  const persisted=(state.persistentConversations||[]).filter(x=>!state.activeAccount||x.account_id===state.activeAccount.id);
  if(persisted.length) return persisted.map(c=>({
    ...c,
    id:c.external_conversation_id,
    participantId:c.participant_id,
    participantName:c.participant_name,
    participantUsername:c.participant_username,
    participantPicture:c.participant_picture,
    url:c.platform_url,
    unreadCount:c.unread_count,
    lastMessage:c.last_message,
    updatedTime:c.last_message_at
  }));
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
  u.searchParams.set('section',state.section);
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

// LINK RRSS SIDEBAR COLLAPSE
function isSidebarCollapsed(){
  try{return localStorage.getItem('linkrrss.sidebar.collapsed')==='1';}catch{return false;}
}
function setSidebarCollapsed(value){
  document.body.classList.toggle('sidebar-collapsed',Boolean(value));
  try{localStorage.setItem('linkrrss.sidebar.collapsed',value?'1':'0');}catch{}
}
function toggleSidebar(){setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));}

function sidebar(){
  const visible=state.businesses.filter(b=>!state.search || b.name.toLowerCase().includes(state.search.toLowerCase()));
  return `
    <aside class="sidebar">
      <div class="side-top">
        <div class="app-title"><span class="brand-mark small">L</span><div><strong>LINK RRSS</strong><small>aparato social</small></div></div>
        <div class="side-top-actions">
          <button class="sidebar-collapse-btn" id="sidebar-collapse" type="button" title="Contraer o expandir menú" aria-label="Contraer o expandir menú"><span>‹</span></button>
          <button class="icon-btn" id="close-mobile">×</button>
        </div>
      </div>
      ${state.canManage?'<button class="new-connection" id="quick-connect"><span>＋</span>Nueva conexión</button>':'<button class="new-connection" id="admin-access"><span>⌁</span>Administrar</button>'}
      <div class="side-search"><i data-lucide="search"></i><input id="business-search" placeholder="Buscar negocio" value="${safe(state.search)}"></div>
      <div class="side-label">NEGOCIOS</div>
      <nav class="business-list">
        ${visible.map(b=>{const st=statusForBusiness(b.id),gs=gameStateForBusiness(b.id);return `
          <button class="business-item ${state.business?.id===b.id?'active':''} game-${safe(gs?.game_state||'none')}" data-business="${b.id}">
            <span class="business-avatar">${safe(b.name.slice(0,1).toUpperCase())}</span>
            <span class="business-copy"><strong>${safe(b.name)}</strong><small>${st.account_count||0} cuentas · ${safe(statusLabel(st.rrss_status))}${gs?' · '+Math.round(Number(gs.temperature||0))+'°':''}</small></span>
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
  const gs=state.business?gameStateForBusiness(state.business.id):null;
  return `
    <header class="topbar">
      <button class="mobile-menu" id="mobile-menu">☰</button>
      <div class="crumb"><span>LINK WORLD</span><b>/</b><strong>${safe(state.business?.name||'RRSS')}</strong></div>
      <div class="top-actions">
        ${state.canManage?'<span class="sync-memory '+(state.syncing?'syncing':'')+'"><b>'+safe(syncStateLabel())+'</b><small>'+safe(ago(state.workspace?.last_full_sync_at))+'</small></span>':''}
        ${gs?'<span class="game-heat-pill '+gameStateTone(gs)+'"><strong>'+Math.round(Number(gs.temperature||0))+'°</strong><span>'+safe(gs.game_state_label)+'</span><small>'+Math.round(Number(gs.conversion_percent||0))+'%</small></span>':''}
        <span class="health-pill ${statusDot(st.rrss_status)}"><span></span>${safe(statusLabel(st.rrss_status))}</span>
        ${notificationBell(state)}
        <button class="icon-btn ${state.syncing?'spin':''}" id="refresh" title="Forzar sincronización"><i data-lucide="refresh-cw"></i></button>
      </div>
    </header>`;
}

function sectionNav(){
  return `<nav class="section-nav">${nav.map(([id,label])=>`
    <button data-section="${id}" class="${state.section===id?'active':''}"><i data-lucide="${({home:'home',artifacts:'workflow',inbox:'message-circle',content:'file-text',calendar:'calendar-days',operation:'activity',analytics:'chart-no-axes-combined',connections:'plug-zap',automations:'workflow',activity:'activity'})[id]}"></i><span>${label}</span></button>`).join('')}</nav>`;
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
  const caps=account?snapshotFor('capabilities',account.id):null;
  const contentSnap=account?snapshotFor('content',account.id):null;
  const inboxSnap=account?snapshotFor('inbox',account.id):null;
  const posts=filteredPosts();
  const conversations=conversationRows().filter(c=>inPeriod(conversationDate(c)));
  const unread=state.canManage?conversations.filter(c=>Number(c.unreadCount||0)>0):[];
  const reach=posts.reduce((a,p)=>a+p.reach,0);
  const interactions=posts.reduce((a,p)=>a+postEngagement(p),0);
  const best=[...posts].sort((a,b)=>(b.engagementRate-a.engagementRate)||(b.reach-a.reach))[0]||null;
  const highSkip=posts.filter(p=>p.skipRate>=60).length;
  const healthy=state.accounts.filter(x=>x.status==='connected').length;
  const last=state.workspace?.last_full_sync_at;
  const actions=[];
  const gs=gameStateForBusiness(state.business.id);
  if(gs?.suggested_action){
    const tone=(gs.game_state==='red_close'||gs.game_state==='critical_frozen')?'urgent':(gs.game_state==='frozen'||gs.game_state==='cold')?'warn':'positive';
    actions.push({tone,title:gs.game_state_label+' · '+Math.round(Number(gs.temperature||0))+'°',text:gs.suggested_action,gamePrompt:gs.suggested_prompt});
  }
  if(unread.length) actions.push({tone:'urgent',title:'Responder '+unread.length+' conversación(es)',text:'Hay mensajes sin leer. Prioriza preguntas de compra, reserva, horario o visita.',jump:'inbox'});
  if(best) actions.push({tone:'positive',title:'Repetir lo que funcionó',text:(best.mediaType||'POST')+' · '+(best.engagementRate?best.engagementRate.toFixed(2)+'% ER':'alcance '+compactNumber(best.reach))+'. Abre la ficha para entender la señal.',post:best.id});
  if(highSkip) actions.push({tone:'warn',title:'Mejorar el inicio de '+highSkip+' reel(s)',text:'Tienen skip de 60% o más. Prueba una promesa visible antes del segundo 2.',jump:'analytics'});
  if(!actions.length) actions.push({tone:'positive',title:'Sin urgencias dominantes',text:'Revisa Analytics para elegir el próximo experimento a partir del contenido medido.',jump:'analytics'});
  const recent=socialActivityRows().slice(0,5);
  return `
    <section class="hero rrss-command-hero">
      <div>
        <span class="eyebrow">APARATO RRSS / ${safe(state.business.name.toUpperCase())}</span>
        <h1>Qué necesita atención ahora.</h1>
        <p>LINK RRSS cruza contenido, conversación e interacción del periodo seleccionado para convertir la red social en trabajo concreto.</p>
      </div>
      <div class="memory-orb ${state.syncing?'syncing':''}"><b>${safe(syncStateLabel())}</b><span>${safe(ago(last))}</span></div>
    </section>
    <section class="metric-row home-metrics">
      <article><strong>${posts.length}</strong><span>Publicaciones del periodo</span></article>
      <article><strong>${compactNumber(reach)}</strong><span>Alcance medido</span></article>
      <article><strong>${compactNumber(interactions)}</strong><span>Interacciones</span></article>
      <article><strong>${state.canManage?unread.length:'—'}</strong><span>${state.canManage?'Conversaciones por responder':'Inbox privado'}</span></article>
    </section>
    <div class="home-grid intelligence-home">
      <section class="panel span2">
        <div class="panel-head"><div><span class="eyebrow">PRIORIDAD</span><h2>Siguientes movimientos</h2></div><span class="freshness">${safe(contentSnap?ago(contentSnap.fetched_at):'Construyendo')}</span></div>
        <div class="next-moves">${actions.map(a=>'<button class="'+safe(a.tone)+'" '+(a.gamePrompt?'data-game-prompt="'+safe(a.gamePrompt)+'"':a.post?'data-post-open="'+safe(a.post)+'"':'data-section-jump="'+safe(a.jump)+'"')+'><span></span><div><strong>'+safe(a.title)+'</strong><p>'+safe(a.text)+'</p></div><b>→</b></button>').join('')}</div>
      </section>
      <section class="panel apparatus-health">
        <div class="panel-head"><div><span class="eyebrow">CAPACIDADES</span><h2>Estado del aparato</h2></div><button data-section-jump="connections">Gestionar</button></div>
        <div class="capability-list">
          <div><span class="status-dot ${account?.can_post===false?'warn':'ok'}"></span><b>Publicación</b><small>${account?.can_post===false?'Limitada':'Disponible'}</small></div>
          <div><span class="status-dot ${account?.can_analytics===false?'warn':'ok'}"></span><b>Analytics</b><small>${account?.can_analytics===false?'Limitado':'Disponible'}</small></div>
          <div><span class="status-dot ${caps?.payload?.inbox?'ok':inboxSnap?.status==='blocked'?'warn':'pending'}"></span><b>Inbox</b><small>${inboxSnap?.status==='blocked'?'Revisar permiso':caps?.payload?.inbox?'Disponible':'Pendiente'}</small></div>
          <div><span class="status-dot ${state.sources[0]?.status==='healthy'?'ok':'warn'}"></span><b>Zernio</b><small>${safe(state.sources[0]?.status||'sin fuente')}</small></div>
          <div><span class="status-dot ${healthy===state.accounts.length?'ok':'warn'}"></span><b>Cuentas</b><small>${healthy}/${state.accounts.length||0} conectadas</small></div>
        </div>
      </section>
      <section class="panel span3">
        <div class="panel-head"><div><span class="eyebrow">SEÑALES RECIENTES</span><h2>Lo último que ocurrió en las redes</h2></div><button data-section-jump="activity">Ver actividad</button></div>
        <div class="home-social-feed">${recent.length?recent.map(x=>{const p=x.payload||{};const who=p.participant_name||p.author_name||p.author_username||(x.activity_type==='publication'?'Publicación':'Interacción');const text=p.message||p.text||('♥ '+numberOf(p.metrics?.likes)+' · ◌ '+numberOf(p.metrics?.comments)+' · ↗ '+numberOf(p.metrics?.shares));return '<div><span class="event-dot '+safe(x.activity_type)+'"></span><strong>'+safe(who)+'</strong><p>'+safe(String(text||'Actividad').slice(0,150))+'</p><small>'+safe(ago(x.occurred_at))+'</small></div>'}).join(''):'<p class="muted">Sin señales en este periodo.</p>'}</div>
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
  return comunEscuchaSection({state});
}


function dateKey(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function dateFromKey(key){
  const [y,m,d]=String(key).split('-').map(Number);
  return new Date(y,m-1,d,12,0,0,0);
}
function monthTitle(d){return d.toLocaleDateString('es-CL',{month:'long',year:'numeric'});}
function postsByDay(posts){
  const map=new Map();
  for(const p of posts){
    const key=dateKey(p.date);
    if(!key) continue;
    if(!map.has(key)) map.set(key,[]);
    map.get(key).push(p);
  }
  for(const list of map.values()) list.sort((a,b)=>new Date(a.date)-new Date(b.date));
  return map;
}
function calendarPostChip(p,compact=false){
  const engagement=postEngagement(p);
  return '<button class="calendar-post '+(compact?'compact':'')+'" data-post-open="'+safe(p.id)+'" title="'+safe(String(p.text).slice(0,140))+'">'+
    (p.image?'<span class="calendar-thumb"><img src="'+safe(p.image)+'" alt=""></span>':'<span class="calendar-thumb no-image">'+safe((p.mediaType||'P')[0])+'</span>')+
    '<span class="calendar-post-copy"><strong>'+safe(String(p.text||'Publicación').slice(0,compact?46:74))+'</strong>'+
    '<small>'+safe(new Date(p.date).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}))+' · '+compactNumber(p.reach)+' alcance · '+engagement+' int.</small></span>'+
  '</button>';
}
function dayCalendarView(posts){
  const range=periodRange();
  const dayPosts=[...posts].sort((a,b)=>new Date(a.date)-new Date(b.date));
  return '<section class="calendar-day-view">'+
    '<div class="calendar-day-head"><div><span class="eyebrow">AGENDA DEL DÍA</span><h2>'+safe(range.label)+'</h2></div><strong>'+dayPosts.length+' publicación(es)</strong></div>'+
    '<div class="calendar-timeline">'+
      (dayPosts.length?dayPosts.map(p=>'<div class="calendar-time-row"><time>'+safe(new Date(p.date).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}))+'</time>'+calendarPostChip(p)+'</div>').join(''):'<div class="calendar-empty-day">No hay publicaciones guardadas para este día.</div>')+
    '</div></section>';
}
function weekCalendarView(posts){
  const range=periodRange();
  const byDay=postsByDay(posts);
  const days=[];
  const d=new Date(range.start);
  while(d<=range.end){days.push(new Date(d));d.setDate(d.getDate()+1);}
  return '<section class="calendar-week-view"><div class="calendar-week-grid">'+days.map(day=>{
    const key=dateKey(day),list=byDay.get(key)||[];
    return '<article class="calendar-week-day"><header><span>'+safe(day.toLocaleDateString('es-CL',{weekday:'short'}))+'</span><b>'+day.getDate()+'</b><small>'+list.length+' pub.</small></header><div>'+(list.length?list.map(p=>calendarPostChip(p,true)).join(''):'<p class="calendar-none">Sin publicaciones</p>')+'</div></article>';
  }).join('')+'</div></section>';
}
function monthCalendarView(posts){
  const range=periodRange();
  const focus=new Date(range.start);
  const byDay=postsByDay(posts);
  const first=new Date(focus.getFullYear(),focus.getMonth(),1);
  const last=new Date(focus.getFullYear(),focus.getMonth()+1,0);
  const start=new Date(first);
  const mondayIndex=(start.getDay()+6)%7;
  start.setDate(start.getDate()-mondayIndex);
  const end=new Date(last);
  const endIndex=(end.getDay()+6)%7;
  end.setDate(end.getDate()+(6-endIndex));
  const days=[];
  const d=new Date(start);
  while(d<=end){days.push(new Date(d));d.setDate(d.getDate()+1);}
  const weekNames=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  return '<section class="calendar-month-view">'+
    '<div class="calendar-weekdays">'+weekNames.map(x=>'<span>'+x+'</span>').join('')+'</div>'+
    '<div class="calendar-month-grid">'+days.map(day=>{
      const key=dateKey(day),list=byDay.get(key)||[];
      const outside=day.getMonth()!==focus.getMonth();
      const isToday=dateKey(day)===dateKey(new Date());
      return '<article class="calendar-cell '+(outside?'outside ':'')+(isToday?'today':'')+'">'+
        '<header><button data-calendar-day="'+key+'">'+day.getDate()+'</button><small>'+list.length+'</small></header>'+
        '<div class="calendar-cell-posts">'+(list.length?list.slice(0,4).map(p=>calendarPostChip(p,true)).join(''):'')+
        (list.length>4?'<button class="calendar-more" data-calendar-day="'+key+'">+'+(list.length-4)+' más</button>':'')+
        '</div></article>';
    }).join('')+'</div></section>';
}
function yearCalendarView(posts){
  const range=periodRange();
  const year=range.start.getFullYear();
  const byDay=postsByDay(posts);
  const months=[];
  for(let month=0;month<12;month++){
    const first=new Date(year,month,1);
    const daysInMonth=new Date(year,month+1,0).getDate();
    const leading=(first.getDay()+6)%7;
    const cells=Array(leading).fill(null);
    for(let day=1;day<=daysInMonth;day++) cells.push(new Date(year,month,day));
    const monthPosts=posts.filter(p=>{const d=new Date(p.date);return d.getFullYear()===year&&d.getMonth()===month;});
    months.push('<button class="year-month-card" data-calendar-month="'+month+'">'+
      '<header><strong>'+safe(first.toLocaleDateString('es-CL',{month:'long'}))+'</strong><span>'+monthPosts.length+' pub.</span></header>'+
      '<div class="mini-weekdays"><i>L</i><i>M</i><i>X</i><i>J</i><i>V</i><i>S</i><i>D</i></div>'+
      '<div class="mini-month-grid">'+cells.map(day=>{
        if(!day)return '<i></i>';
        const count=(byDay.get(dateKey(day))||[]).length;
        return '<i class="'+(count?'has-posts':'')+'"><b>'+day.getDate()+'</b>'+(count?'<em>'+count+'</em>':'')+'</i>';
      }).join('')+'</div></button>');
  }
  return '<section class="calendar-year-view">'+months.join('')+'</section>';
}
function historyCalendarView(posts){
  const groups={};
  for(const p of [...posts].sort((a,b)=>new Date(b.date)-new Date(a.date))){
    const d=new Date(p.date);
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    (groups[key] ||= []).push(p);
  }
  return '<section class="calendar-history-view">'+(Object.keys(groups).length?Object.entries(groups).map(([key,list])=>{
    const [year,month]=key.split('-').map(Number);
    const d=new Date(year,month-1,1);
    return '<article class="calendar-history-month"><header><div><span class="eyebrow">ARCHIVO</span><h2>'+safe(monthTitle(d))+'</h2></div><button data-calendar-month-jump="'+key+'">'+list.length+' publicaciones →</button></header><div class="history-strip">'+list.slice(0,10).map(p=>calendarPostChip(p,true)).join('')+'</div></article>';
  }).join(''):'<div class="calendar-empty-day">Todavía no hay historial persistente para esta cuenta.</div>')+'</section>';
}
function calendarSection(){
  if(!state.activeAccount) return noAccounts('Calendario');
  const all=contentRows().map(normalizePost).filter(p=>p.date);
  const posts=state.period==='history'?all:all.filter(p=>inPeriod(p.date));
  const range=periodRange();
  const memory=(state.accountMemory||[]).find(x=>x.account_id===state.activeAccount.id);
  const view=state.period==='day'?dayCalendarView(posts)
    :state.period==='week'?weekCalendarView(posts)
    :state.period==='month'?monthCalendarView(posts)
    :state.period==='year'?yearCalendarView(posts)
    :historyCalendarView(posts);
  return '<section class="section-heading compact calendar-heading"><div><span class="eyebrow">CALENDARIO / '+safe(state.activeAccount.platform.toUpperCase())+'</span><h1>Calendario editorial</h1><p>Observa cuándo se publicó, abre cualquier pieza y recorre el pasado con los mismos filtros del resto de LINK RRSS.</p></div><div class="calendar-memory-badge"><strong>'+all.length+'</strong><span>publicaciones guardadas</span><small>'+(memory?.earliest_post_at?'Desde '+safe(new Date(memory.earliest_post_at).toLocaleDateString('es-CL',{month:'short',year:'numeric'})):'Construyendo historial')+'</small></div></section>'+
    '<div class="calendar-summary"><span><b>'+posts.length+'</b> en '+safe(range.label)+'</span><span><b>'+compactNumber(posts.reduce((a,p)=>a+p.reach,0))+'</b> alcance</span><span><b>'+compactNumber(posts.reduce((a,p)=>a+postEngagement(p),0))+'</b> interacciones</span></div>'+
    view;
}
function jumpToCalendarDay(key){
  const target=dateFromKey(key);
  const today=new Date(); today.setHours(12,0,0,0);
  const diff=Math.round((target-today)/86400000);
  state.period='day';state.periodOffset=diff;renderApp();
}
function jumpToCalendarMonth(monthIndex,year=periodRange('year',state.periodOffset).start.getFullYear()){
  const now=new Date();
  state.period='month';
  state.periodOffset=(year-now.getFullYear())*12+(Number(monthIndex)-now.getMonth());
  renderApp();
}


function publicationDraftRows(){
  return (state.publicationDrafts||[]).filter(d=>!state.activeAccount||d.account_id===state.activeAccount.id);
}
function publicationDraftStatusLabel(status){
  return ({
    draft:'Borrador',
    ready_for_review:'Esperando autorización',
    approved:'Autorizado',
    publishing:'Publicando',
    published:'Publicado',
    error:'Error',
    cancelled:'Cancelado'
  })[status]||status;
}
function publicationQueueMarkup(){
  if(!state.canManage||!state.activeAccount)return '';
  const all=publicationDraftRows();
  const pending=all.filter(d=>['draft','ready_for_review','approved','publishing','error'].includes(d.status));
  if(!pending.length) return '<section class="publication-queue empty"><div><span class="eyebrow">COLA DE PUBLICACIÓN</span><h2>Sin piezas esperando autorización</h2><p>Las instrucciones creadas desde ChatGPT aparecerán aquí de forma persistente.</p></div></section>';
  return '<section class="publication-queue">'+
    '<div class="publication-queue-head"><div><span class="eyebrow">COLA DE PUBLICACIÓN</span><h2>'+pending.length+' pieza'+(pending.length===1?'':'s')+' esperando acción</h2><p>ChatGPT prepara. LINKRRSS conserva. Tú autorizas el envío a Zernio.</p></div><span class="queue-badge">'+pending.filter(d=>d.status==='ready_for_review').length+' por autorizar</span></div>'+
    '<div class="publication-queue-list">'+pending.map(d=>{
      const media=d.media_name||d.media_url?'Media preparada':'Media pendiente';
      return '<article class="publication-draft '+safe(d.status)+'">'+
        '<div class="draft-status-row"><span class="draft-status">'+safe(publicationDraftStatusLabel(d.status))+'</span><small>'+safe(fmtDate(d.created_at))+'</small></div>'+
        '<p>'+safe(String(d.caption||'Sin copy').slice(0,340))+'</p>'+
        '<div class="draft-meta"><span>'+safe(d.post_type||'post')+'</span><span>'+safe(media)+'</span>'+(d.media_name?'<span>'+safe(d.media_name)+'</span>':'')+'</div>'+
        (d.error?'<div class="draft-error">'+safe(d.error)+'</div>':'')+
        '<div class="draft-actions">'+
          (['ready_for_review','draft','error'].includes(d.status)?'<button class="primary" data-draft-approve="'+safe(d.id)+'">Autorizar publicación</button>':'')+
          (['approved','publishing'].includes(d.status)?'<button disabled>Procesando…</button>':'')+
          '<button class="auth-secondary" data-draft-cancel="'+safe(d.id)+'">Cancelar</button>'+
        '</div>'+
      '</article>';
    }).join('')+'</div></section>';
}

async function cancelPublicationDraft(draftId){
  if(!state.canManage)return;
  const {error}=await db.from('link_rrss_publication_drafts')
    .update({status:'cancelled',updated_at:new Date().toISOString()})
    .eq('id',draftId);
  if(error){toast(error.message||String(error),true);return;}
  state.publicationDrafts=(state.publicationDrafts||[]).map(d=>d.id===draftId?{...d,status:'cancelled',updated_at:new Date().toISOString()}:d);
  renderApp();
  toast('Borrador cancelado.');
}

function openPublicationDraftApproval(draftId){
  if(!state.canManage){openAdminLoginModal();return;}
  const draft=(state.publicationDrafts||[]).find(d=>d.id===draftId);
  if(!draft)return;
  const account=state.accounts.find(a=>a.id===draft.account_id)||state.activeAccount;
  if(!account)return;

  const needsFile=!draft.media_url;
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal composer-modal approval-modal">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">AUTORIZACIÓN / ${safe(String(account.platform||'').toUpperCase())}</span>
        <h2>Revisar antes de publicar</h2>
        <p>Esta pieza fue preparada fuera de LINKRRSS y quedó guardada como borrador. Nada se publica hasta que autorices aquí.</p>
        <div class="approval-target"><span>Destino</span><strong>@${safe(account.username||account.display_name||'cuenta')}</strong></div>
        <form id="draft-approval-form">
          ${needsFile?`<label>Pieza ${draft.media_name?'<small>Esperada: '+safe(draft.media_name)+'</small>':''}
            <input id="draft-media" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime" required>
          </label>`:'<div class="security-note"><strong>Media lista</strong><br>LINKRRSS ya tiene una URL persistida para esta pieza.</div>'}
          <label>Pie de publicación
            <textarea id="draft-caption" rows="8" maxlength="2200" required>${safe(draft.caption||'')}</textarea>
          </label>
          <div class="security-note">Al autorizar, LINKRRSS enviará esta versión exacta a Zernio. Zernio publica en la cuenta conectada y el resultado vuelve a esta ficha.</div>
          <button class="primary wide" id="draft-publish-submit" type="submit">Autorizar y publicar</button>
        </form>
        <div id="draft-publish-status" class="connect-status hidden"></div>
      </section>
    </div>`;
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};

  $('#draft-approval-form').onsubmit=async e=>{
    e.preventDefault();
    const caption=String($('#draft-caption').value||'').trim();
    const file=$('#draft-media')?.files?.[0]||null;
    const status=$('#draft-publish-status');
    const submit=$('#draft-publish-submit');
    if(!caption)return;
    if(needsFile&&!file){
      status.classList.remove('hidden');status.classList.add('error');status.textContent='Adjunta la pieza antes de autorizar.';
      return;
    }
    submit.disabled=true;
    status.classList.remove('hidden','error');
    status.textContent='Autorizando en LINKRRSS…';
    try{
      const approvedAt=new Date().toISOString();
      const approvedBy=state.session?.user?.id||null;
      let mediaUrl=draft.media_url||null;

      const {error:approveError}=await db.from('link_rrss_publication_drafts').update({
        status:'approved',
        caption,
        approved_at:approvedAt,
        approved_by:approvedBy,
        error:null,
        updated_at:approvedAt
      }).eq('id',draft.id);
      if(approveError)throw approveError;

      if(!mediaUrl){
        status.textContent='Subiendo pieza mediante LINKRRSS → Zernio…';
        if(file.size>25*1024*1024)throw new Error('El archivo supera 25 MB.');
        const dataUrl=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(String(reader.result||''));
          reader.onerror=()=>reject(reader.error||new Error('No se pudo leer el archivo.'));
          reader.readAsDataURL(file);
        });
        const uploaded=await invokeZernio({
          action:'media.upload',
          source_id:draft.source_id,
          filename:file.name||draft.media_name||('linkrrss-'+Date.now()),
          content_type:file.type||draft.media_mime||'image/jpeg',
          base64_data:dataUrl
        });
        mediaUrl=uploaded.public_url;
        await db.from('link_rrss_publication_drafts').update({
          media_url:mediaUrl,
          media_name:file.name||draft.media_name,
          media_mime:file.type||draft.media_mime,
          status:'publishing',
          updated_at:new Date().toISOString()
        }).eq('id',draft.id);
      }else{
        await db.from('link_rrss_publication_drafts').update({
          status:'publishing',
          updated_at:new Date().toISOString()
        }).eq('id',draft.id);
      }

      status.textContent='Publicando mediante Zernio…';
      const published=await invokeZernio({
        action:'post.publish',
        source_id:draft.source_id,
        account_id:draft.account_id,
        content:caption,
        media_url:mediaUrl,
        media_type:(file?.type||draft.media_mime||'').startsWith('video/')?'video':'image',
        idempotency_key:'linkrrss-draft-'+draft.id
      });
      const finished=new Date().toISOString();
      const {error:finishError}=await db.from('link_rrss_publication_drafts').update({
        status:'published',
        caption,
        media_url:mediaUrl,
        published_at:finished,
        post_url:published.platform_post_url||null,
        external_post_id:published.post_id||null,
        error:null,
        updated_at:finished
      }).eq('id',draft.id);
      if(finishError)throw finishError;

      await invokeZernio({action:'sync.business',business_id:draft.business_id,trigger:'draft_approval'}).catch(()=>null);
      await loadBusiness({restore:true});
      const target=new URL(location.href);target.searchParams.delete('draft');history.replaceState({},'',target);
      status.innerHTML=published.platform_post_url
        ? 'Publicado correctamente · <a href="'+safe(published.platform_post_url)+'" target="_blank" rel="noreferrer">Abrir publicación ↗</a>'
        : 'Zernio confirmó la publicación.';
      toast('Publicación autorizada y enviada.');
      submit.textContent='Publicado';
    }catch(error){
      const message=error.message||'No se pudo publicar.';
      await db.from('link_rrss_publication_drafts').update({
        status:'error',error:message,updated_at:new Date().toISOString()
      }).eq('id',draft.id).catch(()=>null);
      status.classList.add('error');status.textContent=message;submit.disabled=false;
    }
  };
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
    <section class="section-heading compact"><div><span class="eyebrow">CONTENIDO / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Publicaciones</h1><p>Cada pieza es una ficha medible: contenido, alcance, retención, interacción y aprendizaje.</p></div><div class="content-heading-actions">${state.canManage&&state.activeAccount?.can_post!==false?'<button class="primary" id="new-post">＋ Publicación manual</button>':''}<span class="freshness">${safe(snap?ago(snap.fetched_at):'Pendiente')}</span></div></section>
    ${publicationQueueMarkup()}
    <div id="content-live" class="content-grid">${body}</div>`;
}

function openPostComposer(){
  if(!state.canManage){openAdminLoginModal();return;}
  if(!state.activeAccount)return;
  if(state.activeAccount.can_post===false){toast('Esta cuenta no tiene permiso de publicación.',true);return;}
  const savedDraft=state.workspace?.ui_state?.composer_draft;
  const draft=savedDraft?.account_id===state.activeAccount.id?savedDraft:null;
  const draftCaption=draft?.caption||'';
  const draftAsset=draft?.asset_name||'';
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal composer-modal">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">PUBLICAR / ${safe(state.activeAccount.platform.toUpperCase())}</span>
        <h2>Nueva publicación</h2>
        <p>La pieza se sube al almacenamiento de Zernio y se publica en <strong>@${safe(state.activeAccount.username||state.activeAccount.display_name||'cuenta')}</strong>. LINK no vuelve a pedir la sesión de Instagram.</p>
        <form id="post-composer-form">
          <label>Imagen
            <input id="post-media" type="file" accept="image/jpeg,image/png,image/gif,image/webp" required>
          </label>
          <label>Pie de publicación
            <textarea id="post-caption" rows="7" maxlength="2200" placeholder="Escribe el pie de publicación…" required>${safe(draftCaption)}</textarea>
          </label>
          ${draftAsset?'<div class="composer-draft-note"><strong>Pieza preparada</strong><span>'+safe(draftAsset)+'</span><small>Selecciona este archivo para completar el envío.</small></div>':''}
          <div class="composer-preview hidden" id="composer-preview"><img id="composer-preview-img" alt=""></div>
          <div class="security-note">Publicación inmediata mediante LINKRRSS → Zernio. La cuenta destino se valida en Supabase antes de enviar.</div>
          <button class="primary wide" id="publish-submit" type="submit">Publicar ahora</button>
        </form>
        <div id="publish-status" class="connect-status hidden"></div>
      </section>
    </div>`;
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
  const media=$('#post-media');
  media.onchange=()=>{
    const file=media.files?.[0];
    const preview=$('#composer-preview');
    const img=$('#composer-preview-img');
    if(!file){preview.classList.add('hidden');return;}
    if(file.type.startsWith('image/')){
      img.src=URL.createObjectURL(file);
      preview.classList.remove('hidden');
    }
  };
  $('#post-composer-form').onsubmit=async e=>{
    e.preventDefault();
    const file=media.files?.[0];
    const caption=String($('#post-caption').value||'').trim();
    const status=$('#publish-status');
    const submit=$('#publish-submit');
    if(!file || !caption)return;
    if(file.size>25*1024*1024){status.classList.remove('hidden');status.classList.add('error');status.textContent='El archivo supera 25 MB.';return;}
    const sourceId=state.activeAccount.source_id || state.sources.find(s=>s.id===state.activeAccount.source_id)?.id || state.sources[0]?.id;
    if(!sourceId){status.classList.remove('hidden');status.classList.add('error');status.textContent='No se encontró la fuente Zernio de esta cuenta.';return;}
    submit.disabled=true;
    status.classList.remove('hidden','error');
    status.textContent='Subiendo pieza a Zernio…';
    try{
      const dataUrl=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||''));
        reader.onerror=()=>reject(reader.error||new Error('No se pudo leer el archivo.'));
        reader.readAsDataURL(file);
      });
      const uploaded=await invokeZernio({
        action:'media.upload',
        source_id:sourceId,
        filename:file.name||('linkrrss-'+Date.now()+'.png'),
        content_type:file.type,
        base64_data:dataUrl
      });
      status.textContent='Publicando en '+(state.activeAccount.platform||'la red')+'…';
      const published=await invokeZernio({
        action:'post.publish',
        source_id:sourceId,
        account_id:state.activeAccount.id,
        content:caption,
        media_url:uploaded.public_url,
        media_type:file.type.startsWith('video/')?'video':'image',
        idempotency_key:crypto.randomUUID()
      });
      status.textContent=published.platform_post_url?'Publicado correctamente.':'Zernio recibió la publicación.';
      const nextUi={...(state.workspace?.ui_state||{})};
      if(nextUi.composer_draft?.account_id===state.activeAccount.id) delete nextUi.composer_draft;
      await invokeZernio({action:'workspace.touch',business_id:state.business.id,ui_state:nextUi}).catch(()=>null);
      state.workspace={...(state.workspace||{}),ui_state:nextUi};
      await invokeZernio({action:'sync.business',business_id:state.business.id,trigger:'post_publish'}).catch(()=>null);
      await loadBusiness({restore:true});
      if(published.platform_post_url){
        status.innerHTML='Publicado correctamente · <a href="'+safe(published.platform_post_url)+'" target="_blank" rel="noreferrer">Abrir en la red ↗</a>';
      }
      toast('Publicación enviada correctamente.');
      submit.textContent='Publicado';
    }catch(error){
      status.classList.add('error');
      status.textContent=error.message||'No se pudo publicar.';
      submit.disabled=false;
    }
  };
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



function metricDefinitions(){
  return [
    {name:'Alcance',short:'Personas únicas',formula:'Cuentas únicas que vieron la pieza.',why:'Mide distribución real. LINK lo usa para separar un problema de distribución de un problema de reacción.'},
    {name:'Vistas',short:'Reproducciones / visualizaciones',formula:'Cantidad de veces que la pieza fue vista o reproducida. Puede incluir más de una vista por persona.',why:'Mide consumo. En video, una vista no equivale necesariamente a una persona única.'},
    {name:'Impresiones',short:'Veces mostrada',formula:'Número total de apariciones de la pieza en pantalla.',why:'Comparadas con alcance permiten observar repetición sobre la misma audiencia.'},
    {name:'Interacciones',short:'Acciones sobre la pieza',formula:'Likes + comentarios + compartidos + guardados.',why:'Es la reacción total simple. Después LINK la descompone porque cada tipo de interacción significa algo distinto.'},
    {name:'Engagement',short:'Reacción relativa',formula:'Usamos la tasa entregada por la fuente; si falta, LINK puede estimar interacciones ÷ alcance × 100.',why:'Permite comparar piezas con tamaños de audiencia distintos. Se prioriza la comparación contra tu propio histórico.'},
    {name:'Likes',short:'Aprobación rápida',formula:'Cantidad de Me gusta.',why:'Es una señal ligera: útil para volumen, pero menos fuerte que guardar, compartir o comentar cuando buscamos intención.'},
    {name:'Comentarios',short:'Conversación',formula:'Cantidad de comentarios recibidos.',why:'Indican intención de conversar. LINK los usa para detectar temas que conviene responder, desarrollar o automatizar con cuidado.'},
    {name:'Compartidos',short:'Contenido que circula',formula:'Cantidad de veces que la publicación fue compartida.',why:'Es una señal fuerte de utilidad o identificación. Si crece, conviene repetir tema, estructura o promesa.'},
    {name:'Guardados',short:'Contenido que vale conservar',formula:'Cantidad de veces que la publicación fue guardada.',why:'Suele indicar valor duradero. LINK lo agrupa con compartidos para identificar contenido de utilidad real.'},
    {name:'Skip rate',short:'Abandono temprano',formula:'Porcentaje de personas que saltan el reel según la métrica entregada por Instagram/Zernio.',why:'LINK marca 60% o más como alerta operativa para probar un hook más fuerte. Es una regla interna de experimentación, no un estándar universal.'},
    {name:'Watch medio',short:'Tiempo medio visto',formula:'Tiempo promedio de reproducción por vista, mostrado en segundos.',why:'Indica capacidad de mantener atención. Siempre se lee junto a duración total y skip rate.'},
    {name:'Completion rate',short:'Finalización',formula:'Porcentaje de reproducciones que llegan al final cuando la plataforma lo entrega.',why:'Mide profundidad de consumo. No se interpreta sola porque depende mucho de la duración.'},
    {name:'Mediana LINK',short:'Tu referencia interna',formula:'Mediana del engagement de las publicaciones comparables disponibles.',why:'“Sobre mediana” significa estar por encima del centro de tu propio histórico visible, no de un benchmark externo.'}
  ];
}
function metricIndexMarkup(){
  return '<section class="panel metric-dictionary">'+
    '<div class="panel-head"><div><span class="eyebrow">ÍNDICE DE MÉTRICAS</span><h2>Qué significa cada número y cómo lo usa LINK</h2></div><button id="metric-methodology">Metodología</button></div>'+
    '<div class="metric-dictionary-grid">'+metricDefinitions().map(m=>
      '<article><div><strong>'+safe(m.name)+'</strong><span>'+safe(m.short)+'</span></div><p><b>Qué mide:</b> '+safe(m.formula)+'</p><p><b>Por qué importa:</b> '+safe(m.why)+'</p></article>'
    ).join('')+'</div>'+
    '<div class="metric-method-note"><strong>Regla principal:</strong> LINK no inventa métricas que la fuente no entrega. Un “—” significa dato no disponible. Los consejos son hipótesis de trabajo basadas en señales observables.</div>'+
  '</section>';
}
function openMetricMethodology(){
  $('#modal-root').innerHTML='<div class="modal-backdrop"><section class="modal metric-method-modal"><button class="modal-close" id="modal-close">×</button><span class="eyebrow">METODOLOGÍA LINK RRSS</span><h2>Cómo llegamos a los análisis</h2><div class="method-steps">'+
    '<article><b>1</b><div><strong>Persistimos el dato</strong><p>La publicación y sus métricas quedan guardadas para que el análisis no dependa de una respuesta momentánea.</p></div></article>'+
    '<article><b>2</b><div><strong>Respetamos el periodo</strong><p>Día, semana, mes, año o histórico. No mezclamos periodos sin indicarlo.</p></div></article>'+
    '<article><b>3</b><div><strong>Preferimos tu propio histórico</strong><p>Engagement y piezas clave se comparan principalmente con la mediana y comportamiento de tu cuenta.</p></div></article>'+
    '<article><b>4</b><div><strong>Separamos distribución, reacción y retención</strong><p>Alcance = distribución; interacciones/engagement = reacción; skip/watch/completion = retención.</p></div></article>'+
    '<article><b>5</b><div><strong>Las alertas son experimentos</strong><p>Ejemplo: skip ≥ 60% activa una recomendación de probar un inicio más fuerte. Es una regla operativa LINK, no un estándar universal.</p></div></article>'+
  '</div></section></div>';
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
}

function analyticsSeries(posts=[]){
  const days=new Map();
  for(const p of posts){
    if(!p.date)continue;
    const d=new Date(p.date); if(Number.isNaN(d.getTime()))continue;
    const key=d.toISOString().slice(0,10);
    days.set(key,(days.get(key)||0)+numberOf(p.views||p.impressions));
  }
  return [...days.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
}
function instagramLineChart(series=[]){
  if(!series.length)return '<div class="ig-chart-empty">Sin datos suficientes para dibujar la evolución.</div>';
  const w=720,h=250,pad=24,max=Math.max(...series.map(x=>x[1]),1);
  const pts=series.map((x,i)=>[(pad+(i*(w-pad*2)/Math.max(1,series.length-1))),h-pad-(x[1]/max)*(h-pad*2)]);
  const poly=pts.map(x=>x.join(',')).join(' ');
  return '<div class="ig-chart"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Evolución de reproducciones"><line x1="'+pad+'" y1="'+(h-pad)+'" x2="'+(w-pad)+'" y2="'+(h-pad)+'"></line><polyline points="'+poly+'"></polyline>'+pts.map((p,i)=>'<circle data-chart-point="'+i+'" cx="'+p[0]+'" cy="'+p[1]+'" r="10"><title>'+safe(series[i][0])+' · '+compactNumber(series[i][1])+'</title></circle>').join('')+'</svg><div class="ig-chart-labels"><span>'+safe(series[0][0].slice(5))+'</span><span>'+safe(series[Math.floor(series.length/2)][0].slice(5))+'</span><span>'+safe(series[series.length-1][0].slice(5))+'</span></div></div>';
}
function analyticsOverview(posts,snap){
  const views=posts.reduce((a,p)=>a+numberOf(p.views||p.impressions),0);
  const reach=posts.reduce((a,p)=>a+numberOf(p.reach),0);
  const audience=reach||0;
  const sorted=[...posts].sort((a,b)=>state.analyticsSort==='views'?(b.views||b.impressions)-(a.views||a.impressions):new Date(b.date||0)-new Date(a.date||0));
  const ranked=[...posts].sort((a,b)=>(b.views||b.impressions)-(a.views||a.impressions));
  return '<section class="ig-account"><div class="ig-section-head"><h2>Cuenta <span title="Información">ⓘ</span></h2><span>'+safe(periodRange().label)+'</span></div>'+
    '<div class="ig-kpi-scroll"><button class="active"><small>Reproducciones de reels</small><strong>'+compactNumber(views)+'</strong></button><button><small>Espectadores</small><strong>'+compactNumber(audience)+'</strong></button><button><small>Alcance</small><strong>'+compactNumber(reach)+'</strong></button></div>'+
    instagramLineChart(analyticsSeries(posts))+'</section>'+
    '<section class="ig-reels"><div class="ig-section-head"><h2>Reels <span>ⓘ</span></h2><span>Todas⌄</span></div><div class="ig-sort"><button data-analytics-sort="recent" class="'+(state.analyticsSort==='recent'?'active':'')+'">Más recientes</button><button data-analytics-sort="views" class="'+(state.analyticsSort==='views'?'active':'')+'">Más visualizaciones</button></div>'+
    '<div class="ig-reel-list">'+(sorted.length?sorted.slice(0,10).map(p=>{const pos=ranked.findIndex(x=>x.id===p.id)+1;return '<button class="ig-reel-row" data-post-open="'+safe(p.id)+'">'+(p.image?'<img src="'+safe(p.image)+'" alt="">':'<span class="ig-thumb"></span>')+'<div><strong>'+safe(String(p.text).slice(0,70))+'</strong><small>'+safe(ago(p.date))+'</small><em>♡ '+p.likes+'　◌ '+p.comments+'　↗ '+p.shares+'</em></div><aside><small>'+pos+' de '+posts.length+'</small><strong>'+compactNumber(p.views||p.impressions)+'</strong><span>Reproducciones</span></aside></button>';}).join(''):'<p class="ig-empty">Sin publicaciones en este periodo.</p>')+'</div></section>';
}
function analyticsAudience(posts,snap){
  const payload=snap?.payload||{};
  const followers=numberOf(payload.followers??payload.followersCount??payload.account?.followersCount);
  const reach=posts.reduce((a,p)=>a+p.reach,0);
  return '<section class="ig-audience"><div class="ig-section-head"><h2>Seguidores</h2><span>'+safe(periodRange().label)+'</span></div><div class="ig-followers"><strong>'+(followers?compactNumber(followers):'—')+'</strong><small>'+(followers?'Seguidores actuales':'La fuente no entregó el total de seguidores')+'</small></div>'+instagramLineChart(analyticsSeries(posts.map(p=>({...p,views:p.reach}))))+
    '<div class="ig-audience-block"><h2>Género <span>ⓘ</span></h2><p class="ig-data-note">Se mostrará aquí cuando Instagram/Zernio entregue la distribución de audiencia. LINK no inventa porcentajes.</p></div>'+
    '<div class="ig-audience-block"><h2>Rango de edad <span>ⓘ</span></h2><p class="ig-data-note">La estructura queda preparada para 13–17, 18–24, 25–34, 35–44, 45–54, 55–64 y 65+.</p></div>'+
    '<div class="ig-audience-block"><h2>Principales ubicaciones <span>ⓘ</span></h2><div class="ig-toggle"><button class="active">Países</button><button>Ciudades</button></div><p class="ig-data-note">Se mostrará únicamente la geografía que entregue la fuente conectada.</p></div>'+
    '<div class="ig-audience-block"><h2>Cuándo están más activos los seguidores <span>ⓘ</span></h2><p class="ig-data-note">Los horarios aparecerán cuando estén disponibles en la API.</p></div></section>';
}
function analyticsComments(posts){
  const events=socialActivityRows().filter(x=>x.activity_type==='comment'&&inPeriod(x.occurred_at));
  return '<section class="ig-comments"><div class="ig-section-head"><h2>Comentarios</h2><span>Todas⌄</span></div><div class="ig-comment-list">'+(events.length?events.map(x=>{const p=x.payload||{};const post=posts.find(z=>z.id===String(p.post_id));return '<article><div class="ig-comment-avatar">'+safe((p.author_name||p.author_username||'?').slice(0,1).toUpperCase())+'</div><div><strong>'+safe(p.author_name||p.author_username||'Usuario')+'</strong><small>'+safe(ago(x.occurred_at))+'</small><p>'+safe(p.text||'Comentario')+'</p></div>'+(post?.image?'<img src="'+safe(post.image)+'" alt="">':'')+'</article>';}).join(''):'<p class="ig-empty">No hay comentarios persistidos en este periodo.</p>')+'</div></section>';
}
function analyticsSection(){
  if(!state.activeAccount) return noAccounts('Analytics');
  const snap=snapshotFor('analytics');
  const posts=filteredPosts();
  const tab=state.analyticsTab||'overview';
  return '<section class="ig-insights"><header class="ig-title"><div><span class="eyebrow">ANALYTICS / '+safe(state.activeAccount.platform.toUpperCase())+'</span><h1>Estadísticas</h1></div><span class="freshness">'+safe(snap?ago(snap.fetched_at):'Memoria de contenido')+'</span></header>'+
    '<nav class="ig-tabs"><button data-analytics-tab="overview" class="'+(tab==='overview'?'active':'')+'">Información general</button><button data-analytics-tab="audience" class="'+(tab==='audience'?'active':'')+'">Público</button><button data-analytics-tab="comments" class="'+(tab==='comments'?'active':'')+'">Comentarios</button></nav>'+
    '<div class="ig-tab-body">'+(tab==='audience'?analyticsAudience(posts,snap):tab==='comments'?analyticsComments(posts):analyticsOverview(posts,snap))+'</div></section>';
}

function automationSuggestions(){
  const suggestions=[];
  const inbox=conversationRows().filter(c=>inPeriod(conversationDate(c)));
  const unread=inbox.filter(c=>Number(c.unreadCount||0)>0).length;
  const posts=filteredPosts();
  const comments=posts.reduce((a,p)=>a+p.comments,0);
  const sourceSnap=sourceSnapshot('automations');
  const payload=sourceSnap?.payload||{};
  const workflowCount=Array.isArray(payload.workflows?.data?.workflows)?payload.workflows.data.workflows.length:0;
  const commentCount=Array.isArray(payload.comment_automations?.data?.automations)?payload.comment_automations.data.automations.length:0;
  if(unread>0) suggestions.push({
    priority:'Alta',
    title:'Responder antes de automatizar',
    why:unread+' conversación(es) sin leer en el periodo.',
    prompt:'Revisa el Inbox de '+state.business.name+', clasifica las conversaciones sin leer por intención (reserva, horario, carta, evento, proveedor u otro) y propón una respuesta breve para cada una. No inventes horarios ni precios que no estén confirmados.'
  });
  if(comments>0&&commentCount===0) suggestions.push({
    priority:'Media',
    title:'Diseñar comentario → respuesta',
    why:comments+' comentario(s) medidos y ninguna automatización detectada.',
    prompt:'Diseña para '+state.business.name+' una automatización comentario → DM que responda solo cuando la intención sea clara. Define disparadores, exclusiones, tono, límites y cuándo derivar a una persona.'
  });
  if(workflowCount===0) suggestions.push({
    priority:'Media',
    title:'Primer workflow útil',
    why:'No hay workflows activos detectados en Zernio.',
    prompt:'Propón el primer workflow Zernio para '+state.business.name+' usando señales reales de Inbox y publicaciones. Debe ahorrar trabajo repetitivo sin responder automáticamente preguntas que requieran información no verificada.'
  });
  const highSkip=posts.filter(p=>p.skipRate>=60).length;
  if(highSkip>=2) suggestions.push({
    priority:'Contenido',
    title:'Experimento de hooks',
    why:highSkip+' reels del periodo superan 60% de skip.',
    prompt:'Crea 5 hooks alternativos de 2 segundos para los reels de '+state.business.name+'. Conserva el tono real del negocio y prioriza escenas del local, comida, artistas o público según el contenido original.'
  });
  if(!suggestions.length) suggestions.push({
    priority:'Explorar',
    title:'Buscar el siguiente ahorro',
    why:'No hay una urgencia dominante con los datos actuales.',
    prompt:'Analiza la actividad reciente de '+state.business.name+' en LINK RRSS y encuentra una sola tarea repetitiva que convenga automatizar. Explica el disparador, la acción, el riesgo y cómo medir si funcionó.'
  });
  return suggestions.slice(0,4);
}
function automationsSection(){
  const source=sourceForActiveAccount()||state.sources[0];
  if(!source) return noAccounts('Automatizaciones');
  const snap=sourceSnapshot('automations');
  const payload=snap?.payload||{};
  const blocks=[['Workflows',payload.workflows],['Comentario → DM',payload.comment_automations],['Secuencias',payload.sequences]];
  const suggestions=automationSuggestions();
  return `
    <section class="section-heading compact"><div><span class="eyebrow">AUTOMATIZACIÓN / DECISIONES</span><h1>Qué conviene automatizar ahora</h1><p>Primero vemos señales reales del negocio; después proponemos flujos y prompts que reduzcan trabajo sin perder control.</p></div><span class="freshness">${safe(snap?ago(snap.fetched_at):'Pendiente')}</span></section>
    <div class="automation-status-grid">${blocks.map(([title,data])=>{
      const arr=data?.data?.data||data?.data?.workflows||data?.data?.sequences||data?.data?.automations||[];
      const count=Array.isArray(arr)?arr.length:(data?.ok?'✓':'—');
      return '<article class="panel automation-card '+(data?.ok===false?'blocked-card':'')+'"><span class="eyebrow">'+safe(title.toUpperCase())+'</span><h2>'+safe(title)+'</h2><strong class="automation-count">'+safe(count)+'</strong><p class="muted">'+(data?.ok===false?safe(data.error?.message||'No disponible'):'detectado en Zernio')+'</p></article>';
    }).join('')}</div>
    <section class="panel automation-advisor">
      <div class="panel-head"><div><span class="eyebrow">RECOMENDADOR</span><h2>Siguientes automatizaciones</h2></div><small>Basadas en Inbox + contenido + Zernio</small></div>
      <div class="automation-prompts">${suggestions.map(s=>'<article><div><span class="priority-pill">'+safe(s.priority)+'</span><strong>'+safe(s.title)+'</strong><p>'+safe(s.why)+'</p></div><div class="prompt-box"><code>'+safe(s.prompt)+'</code><button data-copy-prompt="'+safe(s.prompt)+'">Copiar prompt</button></div></article>').join('')}</div>
    </section>`;
}


function activitySection(){
  const allRows=socialActivityRows();
  const rows=allRows.filter(x=>state.activityType==='all'||x.activity_type===state.activityType);
  const typeLabel={message:'Mensaje',comment:'Comentario',publication:'Publicación',engagement:'Interacción'};
  const counts=allRows.reduce((a,x)=>(a[x.activity_type]=(a[x.activity_type]||0)+1,a),{});
  return `
    <section class="section-heading compact"><div><span class="eyebrow">ACTIVIDAD / ZERNIO + REDES</span><h1>Qué está pasando afuera</h1><p>Mensajes, comentarios, publicaciones e interacción social. No registramos clics internos de la app como si fueran actividad del negocio.</p></div><span class="freshness">${safe(ago(state.workspace?.last_full_sync_at))}</span></section>
    <div class="activity-filter">
      ${[['all','Todo'],['message','Mensajes'],['comment','Comentarios'],['publication','Publicaciones'],['engagement','Interacción']].map(([id,label])=>'<button data-activity-type="'+id+'" class="'+(state.activityType===id?'active':'')+'">'+label+(id!=='all'&&counts[id]?' · '+counts[id]:'')+'</button>').join('')}
    </div>
    <section class="social-activity-feed">
      ${rows.length?rows.map(x=>{
        const p=x.payload||{};
        const title=x.activity_type==='message'?(p.participant_name||'Mensaje recibido'):x.activity_type==='comment'?(p.author_name||p.author_username||'Comentario'):x.activity_type==='publication'?'Publicación detectada':'Interacción actualizada';
        const text=x.activity_type==='message'?p.message:x.activity_type==='comment'?p.text:x.activity_type==='publication'?p.text:('♥ '+numberOf(p.metrics?.likes)+' · ◌ '+numberOf(p.metrics?.comments)+' · ↗ '+numberOf(p.metrics?.shares)+' · alcance '+compactNumber(p.metrics?.reach));
        return '<article class="social-event '+safe(x.activity_type)+'"><span class="event-dot"></span><div><div class="event-meta"><span>'+safe(typeLabel[x.activity_type]||x.activity_type)+'</span><small>'+safe(ago(x.occurred_at))+'</small></div><strong>'+safe(title)+'</strong><p>'+safe(String(text||'Sin texto').slice(0,260))+'</p>'+(p.unread_count?'<span class="event-unread">'+p.unread_count+' sin leer</span>':'')+'</div>'+(p.url?'<a href="'+safe(p.url)+'" target="_blank" rel="noreferrer">↗</a>':'')+'</article>';
      }).join(''):'<div class="memory-state"><div class="memory-icon">·</div><div><span class="eyebrow">SIN EVENTOS</span><h2>No hay actividad en este periodo.</h2><p>Cambia el filtro o espera la próxima señal de Zernio/Instagram.</p></div></div>'}
    </section>
    <p class="activity-note">Las identidades de personas se muestran solo cuando la plataforma/Zernio las entrega. Los likes agregados pueden venir sin identidad individual.</p>`;
}

function noAccounts(title){return `<section class="empty-apparatus small"><span class="eyebrow">${safe(title.toUpperCase())}</span><h1>Primero conecta una cuenta.</h1><p>Ve a Conexiones y añade una fuente Zernio. LINK detectará automáticamente las cuentas disponibles.</p><button class="primary" data-section-jump="connections">Ir a Conexiones</button></section>`;}

function artifactStatusLabel(status='active'){
  return ({active:'Activo',attention:'Requiere atención',building:'En construcción',paused:'Pausado'})[status]||status;
}
function artifactHref(artifact){
  const route=artifact?.route||'#';
  if(!route.startsWith('/?')||route.includes('business='))return route;
  try{
    const u=new URL(route,location.origin);
    if(state.business?.id)u.searchParams.set('business',state.business.id);
    return u.pathname+u.search;
  }catch{return route;}
}
function artifactsSection(){
  if(!state.canManage){
    return `<section class="empty-apparatus small"><span class="eyebrow">ESPACIO LINKDOT</span><h1>Artefactos internos de LINK.</h1><p>Este espacio muestra trabajo persistente, SubLinkDots y fuentes de verdad solo a miembros autorizados.</p><button class="primary" id="admin-empty">Administrar</button></section>`;
  }
  const w=state.dotWorkspace;
  if(!w){
    return `<section class="empty-apparatus small"><span class="eyebrow">LINKDOT MAR</span><h1>El espacio todavía no está disponible.</h1><p>No se encontró la definición persistente de LINKRRSS · MAR.</p></section>`;
  }
  const total=state.dotArtifacts.length;
  const specific=state.dotArtifacts.filter(a=>a.business_id===state.business?.id).length;
  const attention=state.dotArtifacts.filter(a=>a.status==='attention'||a.status==='building').length;
  const subdotBlocks=state.dotSubdots.map((s,index)=>{
    const artifacts=state.dotArtifacts.filter(a=>a.subdot_id===s.id);
    return `<article class="dot-lane">
      <header class="dot-lane-head">
        <div class="subdot-node"><span>${String(index+1).padStart(2,'0')}</span></div>
        <div><span class="eyebrow">LINKSUBDOT</span><h2>${safe(s.name)}</h2><p>${safe(s.responsibility)}</p></div>
        <b>${artifacts.length}</b>
      </header>
      <div class="artifact-grid">
        ${artifacts.length?artifacts.map(a=>`<a class="artifact-card status-${safe(a.status)}" href="${safe(artifactHref(a))}">
          <div class="artifact-card-top"><span>${safe((a.artifact_type||'artefacto').toUpperCase())}</span><i>${safe(artifactStatusLabel(a.status))}</i></div>
          <h3>${safe(a.name)}</h3>
          <p>${safe(a.description||'')}</p>
          <div class="artifact-work"><span>TRABAJO ESPECÍFICO</span><strong>${safe(a.work_definition)}</strong></div>
          <footer><span>${safe(a.source_table?'Persistente · '+a.source_table:'Persistente')}</span><b>Abrir →</b></footer>
        </a>`).join(''):`<div class="artifact-empty"><span>SIN ARTEFACTOS</span><p>Este SubLinkDot ya tiene responsabilidad definida; todavía no tiene un artefacto operativo asociado en este negocio.</p></div>`}
      </div>
    </article>`;
  }).join('');
  return `<section class="dot-workspace">
    <header class="dot-workspace-hero">
      <div class="linkdot-node"><small>LINKDOT</small><strong>MAR</strong><span>Marketing & RRSS</span></div>
      <div class="dot-workspace-copy">
        <span class="eyebrow">ESPACIO DE TRABAJO / LINKRRSS</span>
        <h1>MAR trabaja aquí.</h1>
        <p>${safe(w.description||'')}</p>
        <div class="workspace-flow"><span>Atención</span><i>→</i><span>Artefactos</span><i>→</i><span>Identidad contactable</span><i>→</i><strong>BEL</strong></div>
      </div>
    </header>
    <div class="workspace-stats">
      <article><strong>${state.dotSubdots.length}</strong><span>SubLinkDots</span></article>
      <article><strong>${total}</strong><span>Artefactos visibles</span></article>
      <article><strong>${specific}</strong><span>Específicos de ${safe(state.business?.name||'negocio')}</span></article>
      <article><strong>${attention}</strong><span>Por completar</span></article>
    </div>
    <div class="dot-lanes">${subdotBlocks}</div>
  </section>`;
}

function bodySection(){
  if(!state.business) return '<section class="empty-apparatus"><h1>No hay negocios en LINK WORLD.</h1></section>';
  if(state.section==='artifacts') return artifactsSection();
  if(state.section==='connections') return connectionsSection();
  if(state.section==='inbox') return inboxSection();
  if(state.section==='content') return contentSection();
  if(state.section==='studio') return studioSection({state});
  if(state.section==='operation') return operationSection({state});
  if(state.section==='calendar') return calendarSection();
  if(state.section==='analytics') return analyticsSection();
  if(state.section==='automations') return automationsSection();
  if(state.section==='activity') return activitySection();
  return homeSection();
}

function renderApp(){
  setSidebarCollapsed(isSidebarCollapsed());
  $('#app').innerHTML=`
    <div class="app-shell">
      ${sidebar()}
      <div class="mobile-scrim" id="mobile-scrim"></div>
      <main class="main">
        ${topbar()}
        ${sectionNav()}
        ${['artifacts','inbox'].includes(state.section)?'':accountStrip()}
        ${['connections','artifacts','inbox'].includes(state.section)?'':periodControls()}
        <div class="content">${bodySection()}</div>
      </main>
    </div>
    <div id="modal-root"></div>
    <div id="toast" class="toast hidden"></div>`;
  createIcons({icons:{Home,MessageCircle,FileText,ChartNoAxesCombined,PlugZap,Workflow,Activity,Search,Plus,ChevronDown,RefreshCw,ArrowLeft,Instagram,Facebook,Youtube,Music2,Globe2,CircleAlert,CircleCheck,KeyRound,X,Send,ShieldCheck,CalendarDays,Info}});
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
    state.section=btn.dataset.section;
    state.panelRefreshAt.delete([state.business?.id,state.activeAccount?.id||'source',state.section].join(':'));
    syncUrl(); renderApp(); persistWorkspace();
  });
  document.querySelectorAll('[data-section-jump]').forEach(btn=>btn.onclick=()=>{
    state.section=btn.dataset.sectionJump;
    state.panelRefreshAt.delete([state.business?.id,state.activeAccount?.id||'source',state.section].join(':'));
    renderApp();persistWorkspace();
  });
  document.querySelectorAll('[data-account]').forEach(btn=>btn.onclick=()=>{
    state.activeAccount=state.accounts.find(x=>x.id===btn.dataset.account);
    state.panelRefreshAt.clear();
    state.selectedConversationId=null;
    renderApp();persistWorkspace();
  });
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
  $('#new-post')?.addEventListener('click',openPostComposer);
  document.querySelectorAll('[data-draft-approve]').forEach(btn=>btn.onclick=()=>openPublicationDraftApproval(btn.dataset.draftApprove));
  document.querySelectorAll('[data-draft-cancel]').forEach(btn=>btn.onclick=()=>cancelPublicationDraft(btn.dataset.draftCancel));
  $('#refresh')?.addEventListener('click',()=>maybeAutoSync(true));
  $('#logout')?.addEventListener('click',()=>db.auth.signOut().then(()=>loadBase()));
  $('#back-world')?.addEventListener('click',()=>{location.href=LINK_WORLD_URL+(state.business?('?business='+encodeURIComponent(state.business.id)):'');});
  $('#mobile-menu')?.addEventListener('click',()=>document.body.classList.add('side-open'));
  $('#close-mobile')?.addEventListener('click',()=>document.body.classList.remove('side-open'));
  $('#mobile-scrim')?.addEventListener('click',()=>document.body.classList.remove('side-open'));
  $('#sidebar-collapse')?.addEventListener('click',toggleSidebar);
  document.querySelectorAll('[data-source-sync]').forEach(btn=>btn.onclick=()=>syncSource(btn.dataset.sourceSync));
  document.querySelectorAll('[data-source-connect]').forEach(btn=>btn.onclick=()=>openNetworkModal(btn.dataset.sourceConnect));

  document.querySelectorAll('[data-period]').forEach(btn=>btn.onclick=()=>{
    state.period=btn.dataset.period;state.periodOffset=0;renderApp();
    if(state.period==='history') loadHistoryIfNeeded();
  });
  document.querySelectorAll('[data-period-shift]').forEach(btn=>btn.onclick=()=>{
    const delta=Number(btn.dataset.periodShift||0);
    state.periodOffset=state.periodOffset+delta;
    renderApp();
  });
  document.querySelectorAll('[data-period-now]').forEach(btn=>btn.onclick=()=>{state.periodOffset=0;renderApp();});
  document.querySelectorAll('[data-post-open]').forEach(el=>{
    el.onclick=()=>openPostDetail(el.dataset.postOpen);
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPostDetail(el.dataset.postOpen);}};
  });
  document.querySelectorAll('[data-calendar-day]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();jumpToCalendarDay(btn.dataset.calendarDay);});
  document.querySelectorAll('[data-calendar-month]').forEach(btn=>btn.onclick=()=>jumpToCalendarMonth(Number(btn.dataset.calendarMonth)));
  document.querySelectorAll('[data-calendar-month-jump]').forEach(btn=>btn.onclick=()=>{
    const [y,m]=btn.dataset.calendarMonthJump.split('-').map(Number);jumpToCalendarMonth(m-1,y);
  });
  $('#metric-methodology')?.addEventListener('click',openMetricMethodology);
  document.querySelectorAll('[data-analytics-tab]').forEach(btn=>btn.onclick=()=>{state.analyticsTab=btn.dataset.analyticsTab;renderApp();});
  document.querySelectorAll('[data-analytics-sort]').forEach(btn=>btn.onclick=()=>{state.analyticsSort=btn.dataset.analyticsSort;renderApp();});
  document.querySelectorAll('[data-conversation]').forEach(btn=>btn.onclick=()=>{
    const accountId=btn.dataset.conversationAccount;
    if(accountId){
      const account=state.accounts.find(x=>x.id===accountId);
      if(account) state.activeAccount=account;
    }
    state.selectedConversationId=btn.dataset.conversation;
    renderApp();
  });
  document.querySelectorAll('[data-ce-state]').forEach(btn=>btn.onclick=()=>{state.conversationFilter=btn.dataset.ceState||'all';renderApp();});
  $('#ce-channel')?.addEventListener('change',e=>{state.conversationChannel=e.target.value||'all';renderApp();});
  $('#ce-search')?.addEventListener('input',e=>{
    state.conversationQuery=e.target.value||'';
    renderApp();
    const input=$('#ce-search'); if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}
  });
  document.querySelectorAll('[data-ce-prompt]').forEach(btn=>btn.onclick=()=>{
    const box=$('#ce-work-input'); if(box){box.value=btn.dataset.cePrompt||'';box.focus();}
  });
  $('#ce-copy-work')?.addEventListener('click',async()=>{
    const box=$('#ce-work-input'); const value=box?.value?.trim();
    if(!value){toast('Escribe o elige una instrucción primero.');return;}
    try{await navigator.clipboard?.writeText(value);toast('Instrucción copiada.');}
    catch{toast('No se pudo copiar la instrucción.',true);}
  });
  document.querySelectorAll('[data-suggest-reply]').forEach(btn=>btn.onclick=()=>{
    const box=$('#conversation-reply'); if(box){box.value=btn.dataset.suggestReply||'';box.focus();}
  });
  document.querySelectorAll('[data-conversation-status]').forEach(sel=>sel.onchange=()=>saveConversationStatus(sel.dataset.conversationStatus,sel.value));
  document.querySelectorAll('[data-mark-read]').forEach(btn=>btn.onclick=()=>markConversationRead(btn.dataset.markRead));
  document.querySelectorAll('[data-reply-form]').forEach(form=>form.onsubmit=e=>{e.preventDefault();sendConversationReply(form.dataset.replyForm);});
  document.querySelectorAll('[data-copy-prompt]').forEach(btn=>btn.onclick=async()=>{await navigator.clipboard?.writeText(btn.dataset.copyPrompt||'');toast('Prompt copiado.');});
  document.querySelectorAll('[data-game-prompt]').forEach(btn=>btn.onclick=async()=>{
    try{await navigator.clipboard?.writeText(btn.dataset.gamePrompt||'');toast('Prompt del juego copiado para continuar en ChatGPT.');}
    catch{toast('No se pudo copiar el prompt.',true);}
  });
  document.querySelectorAll('[data-activity-type]').forEach(btn=>btn.onclick=()=>{state.activityType=btn.dataset.activityType;renderApp();});
  $('#load-inbox')?.addEventListener('click',loadInbox);
  $('#load-content')?.addEventListener('click',loadContent);
  $('#load-analytics')?.addEventListener('click',loadAnalytics);
  $('#load-automations')?.addEventListener('click',loadAutomations);
  bindOperation({state,db,renderApp,toast,openAdminLoginModal});
  bindNotifications({state,db,renderApp,toast});
  bindStudio({state,db,renderApp,toast});
}


async function loadHistoryIfNeeded(){
  if(!state.canManage||!state.activeAccount||!state.business)return;
  const memory=(state.accountMemory||[]).find(x=>x.account_id===state.activeAccount.id);
  if(memory?.history_backfilled_at||state.historyBackfillRequested.has(state.activeAccount.id))return;
  const source=sourceForActiveAccount(); if(!source)return;
  state.historyBackfillRequested.add(state.activeAccount.id);
  toast('Recuperando historial anterior desde Zernio…');
  try{
    await invokeZernio({action:'history.backfill',source_id:source.id,account_id:state.activeAccount.id,months:12});
    await loadBusiness({restore:false});
    toast('Historial persistente actualizado.');
  }catch(e){
    state.historyBackfillRequested.delete(state.activeAccount.id);
    toast('No se pudo completar todo el historial: '+(e.message||String(e)),true);
  }
}

async function loadCurrentSection(){
  if(state.section==='studio'){
    if(state.canManage&&state.business){try{await loadStudio({state,db});renderApp();}catch(e){toast(e.message||String(e),true);}}
    return;
  }
  if(state.section==='artifacts')return;
  if(!state.canManage||!state.business||!state.sources.length)return;
  const key=[state.business.id,state.activeAccount?.id||'source',state.section].join(':');
  const last=state.panelRefreshAt.get(key)||0;
  if(Date.now()-last>45000){
    state.panelRefreshAt.set(key,Date.now());
    await maybeAutoSync(true);
    return;
  }
  if(state.section==='inbox'&&state.selectedConversationId&&!state.conversationMessages[state.selectedConversationId]){
    await loadConversationMessages(state.selectedConversationId);
  }
  if(state.section==='activity') await loadActivityComments();
}

async function loadConversationMessages(conversationId){
  const source=sourceForActiveAccount();
  if(!source||!state.activeAccount||!conversationId)return;
  state.conversationLoading[conversationId]=true;
  try{
    const out=await invokeZernio({
      action:'zernio.get',
      source_id:source.id,
      path:'/v1/inbox/conversations/'+encodeURIComponent(conversationId)+'/messages',
      query:{accountId:state.activeAccount.external_account_id,limit:100,sortOrder:'asc'}
    });
    state.conversationMessages[conversationId]=out.data||{};
  }catch(e){
    state.conversationMessages[conversationId]={messages:[],error:e.message||String(e)};
    toast('No se pudo abrir el hilo completo: '+(e.message||String(e)),true);
  }finally{
    state.conversationLoading[conversationId]=false;
    renderApp();
  }
}

async function saveConversationStatus(conversationId,status){
  if(!state.canManage||!state.business)return;
  const ui={...(state.workspace?.ui_state||{})};
  ui.conversation_status={...(ui.conversation_status||{}),[conversationId]:status};
  state.workspace={...(state.workspace||{}),ui_state:ui};
  renderApp();
  try{await invokeZernio({action:'workspace.touch',business_id:state.business.id,ui_state:ui});}
  catch{toast('No se pudo guardar el estado.',true);}
}

async function markConversationRead(conversationId){
  const source=sourceForActiveAccount();
  if(!source||!state.activeAccount)return;
  try{
    await invokeZernio({action:'inbox.read',source_id:source.id,conversation_id:conversationId,account_id:state.activeAccount.external_account_id});
    toast('Conversación marcada como leída.');
    state.panelRefreshAt.delete([state.business.id,state.activeAccount.id,'inbox'].join(':'));
    await maybeAutoSync(true);
  }catch(e){toast(e.message||String(e),true);}
}

async function sendConversationReply(conversationId){
  const source=sourceForActiveAccount(),box=$('#conversation-reply');
  const message=box?.value?.trim();
  if(!source||!state.activeAccount||!message)return;
  const form=document.querySelector('[data-reply-form="'+conversationId+'"]');
  const submit=form?.querySelector('button[type="submit"]');
  if(submit)submit.disabled=true;
  try{
    await invokeZernio({
      action:'inbox.send',
      source_id:source.id,
      conversation_id:conversationId,
      account_id:state.activeAccount.external_account_id,
      message,
      idempotency_key:'link-rrss-'+conversationId+'-'+Date.now()
    });
    toast('Respuesta enviada.');
    if(box)box.value='';
    delete state.conversationMessages[conversationId];
    await loadConversationMessages(conversationId);
    await saveConversationStatus(conversationId,'open');
  }catch(e){toast(e.message||String(e),true);}
  finally{if(submit)submit.disabled=false;}
}

async function loadActivityComments(){
  if(!state.activeAccount)return;
  const posts=filteredPosts().slice(0,6);
  const key=state.activeAccount.id+':'+state.period+':'+posts.map(p=>p.id).join(',');
  if(state.activityCommentsLoadedKey===key)return;
  state.activityCommentsLoadedKey=key;
  const source=sourceForActiveAccount();
  if(!source)return;
  const events=[];
  for(const p of posts){
    const platformPostId=String(p.raw?.platforms?.[0]?.platformPostId||p.raw?.platformPostId||p.id||'');
    if(!platformPostId)continue;
    try{
      const out=await invokeZernio({
        action:'zernio.get',
        source_id:source.id,
        path:'/v1/inbox/comments/'+encodeURIComponent(platformPostId),
        query:{accountId:state.activeAccount.external_account_id,limit:50}
      });
      const comments=Array.isArray(out.data)?out.data:(out.data?.comments||out.data?.data||[]);
      if(!Array.isArray(comments))continue;
      for(const c of comments){
        const occurred=c.createdAt||c.createdTime||c.timestamp||c.publishedAt||null;
        if(!occurred)continue;
        events.push({
          activity_type:'comment',
          external_id:String(c.id||c._id||platformPostId+':'+occurred),
          occurred_at:occurred,
          payload:{
            post_id:platformPostId,
            author_name:c.authorName||c.user?.name||c.from?.name||c.username||c.author||'Comentario',
            author_username:c.authorUsername||c.user?.username||c.from?.username||null,
            text:c.text||c.message||c.content||'Comentario',
            url:p.url||null
          }
        });
      }
    }catch{}
  }
  state.liveData.activityComments=events;
  renderApp();
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


async function handleOAuthConsentPage(){
  const root=$('#app');
  const params=new URLSearchParams(location.search);
  const authorizationId=params.get('authorization_id');

  const shell=(inner)=>{ root.innerHTML=`
    <main class="auth-shell">
      <section class="auth-card oauth-consent-card">
        <span class="eyebrow">LINK RRSS · ACCESO SEGURO</span>
        ${inner}
      </section>
    </main>`; };

  if(!authorizationId){
    shell('<h1>Solicitud OAuth incompleta</h1><p>Falta <code>authorization_id</code>. Vuelve a iniciar la conexión desde ChatGPT.</p>');
    return;
  }

  async function requireSession(){
    const {data:{session}}=await db.auth.getSession();
    if(session)return true;

    shell(`
      <h1>Autorizar ChatGPT en LINKRRSS</h1>
      <p>Inicia sesión con tu cuenta LINK. La autorización no entrega a ChatGPT tus credenciales de Zernio ni de Instagram.</p>
      <form id="oauth-login-form">
        <label>Correo<input id="oauth-email" type="email" autocomplete="username" required></label>
        <label>Contraseña<input id="oauth-password" type="password" autocomplete="current-password" required></label>
        <button class="primary wide" type="submit">Entrar y continuar</button>
      </form>
      <div id="oauth-login-error" class="connect-status hidden"></div>
    `);
    $('#oauth-login-form').onsubmit=async e=>{
      e.preventDefault();
      const box=$('#oauth-login-error');
      box.classList.remove('hidden','error'); box.textContent='Verificando…';
      const {error}=await db.auth.signInWithPassword({
        email:$('#oauth-email').value.trim(),
        password:$('#oauth-password').value
      });
      if(error){ box.textContent=error.message; box.classList.add('error'); return; }
      location.reload();
    };
    return false;
  }

  if(!(await requireSession()))return;

  const {data:member,error:memberError}=await db.rpc('link_world_is_member');
  if(memberError || member!==true){
    shell('<h1>Cuenta no autorizada</h1><p>Esta cuenta no pertenece al equipo activo de LINK.</p><button class="auth-secondary" id="oauth-signout">Cerrar sesión</button>');
    $('#oauth-signout').onclick=async()=>{await db.auth.signOut();location.reload();};
    return;
  }

  const {data:details,error}=await db.auth.oauth.getAuthorizationDetails(authorizationId);
  if(error || !details){
    shell('<h1>No se pudo abrir la autorización</h1><p>'+safe(error?.message||'Solicitud OAuth inválida o vencida.')+'</p>');
    return;
  }

  if(!('authorization_id' in details)){
    if(details.redirect_url){ location.href=details.redirect_url; return; }
    shell('<h1>Autorización ya resuelta</h1><p>Vuelve a ChatGPT para continuar.</p>');
    return;
  }

  const client=details.client||details.oauth_client||{};
  const clientName=client.client_name||client.name||'ChatGPT';
  const scope=String(details.scope||'').trim();
  const scopes=scope?scope.split(/\s+/):[];
  shell(`
    <h1>Conectar ${safe(clientName)} con LINKRRSS</h1>
    <p>Esta conexión permitirá que ChatGPT use las herramientas autorizadas de LINKRRSS. Las credenciales de Zernio permanecen guardadas en LINK y nunca se entregan al cliente.</p>
    <div class="security-note">
      <strong>Ruta autorizada</strong><br>
      ChatGPT → LINKRRSS → Zernio → redes conectadas
    </div>
    ${scopes.length?`<div class="oauth-scopes"><small>PERMISOS SOLICITADOS</small><div>${scopes.map(s=>'<span>'+safe(s)+'</span>').join('')}</div></div>`:''}
    <div class="oauth-actions">
      <button class="auth-secondary" id="oauth-deny" type="button">Cancelar</button>
      <button class="primary" id="oauth-approve" type="button">Autorizar LINKRRSS</button>
    </div>
    <div id="oauth-status" class="connect-status hidden"></div>
  `);

  const status=$('#oauth-status');
  const finish=async decision=>{
    $('#oauth-approve').disabled=true; $('#oauth-deny').disabled=true;
    status.classList.remove('hidden','error'); status.textContent=decision==='approve'?'Autorizando…':'Cancelando…';
    const result=decision==='approve'
      ? await db.auth.oauth.approveAuthorization(authorizationId)
      : await db.auth.oauth.denyAuthorization(authorizationId);
    if(result.error){
      status.textContent=result.error.message; status.classList.add('error');
      $('#oauth-approve').disabled=false; $('#oauth-deny').disabled=false;
      return;
    }
    if(result.data?.redirect_url){ location.href=result.data.redirect_url; return; }
    status.textContent='Autorización procesada. Vuelve a ChatGPT.';
  };
  $('#oauth-approve').onclick=()=>finish('approve');
  $('#oauth-deny').onclick=()=>finish('deny');
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

if(bootKaraokeRoute()){
  // LINK Karaoke owns /karaoke, /karaoke/join/:site and /karaoke/board/:site.
}else if(location.pathname==='/oauth/consent'){
  handleOAuthConsentPage().catch(e=>{
    $('#app').innerHTML=`<main class="auth-shell"><section class="auth-card"><h1>No pudimos abrir la autorización LINK.</h1><p>${safe(e.message||String(e))}</p></section></main>`;
  });
}else{
  loadBase().catch(e=>{
    $('#app').innerHTML=`<main class="auth-shell"><section class="auth-card"><h1>No pudimos abrir LINK RRSS.</h1><p>${safe(e.message||String(e))}</p></section></main>`;
  });
}
