import { createClient } from '@supabase/supabase-js';
import { createIcons, Home, MessageCircle, FileText, ChartNoAxesCombined, PlugZap, Workflow, Activity, Search, Plus, ChevronDown, RefreshCw, ArrowLeft, Instagram, Facebook, Youtube, Music2, Globe2, CircleAlert, CircleCheck, KeyRound, X, Send, ShieldCheck } from 'lucide';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LINK_WORLD_URL } from './connection.js';
import './style.css';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
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
  search: ''
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

async function loadBase(){
  const { data:{session} } = await db.auth.getSession();
  state.session=session;
  if(!session){ renderLogin(); return; }

  const { data:member } = await db.rpc('link_world_is_member');
  if(member!==true){ renderDenied(); return; }

  const [b,s]=await Promise.all([
    db.from('link_world_businesses').select('id,slug,name,sector,city,country,summary,updated_at').order('name'),
    db.from('link_world_rrss_status_v').select('*').order('business_name')
  ]);
  if(b.error) throw b.error;
  state.businesses=b.data||[];
  state.statuses=s.data||[];

  const requested=new URLSearchParams(location.search).get('business');
  state.business = state.businesses.find(x=>x.id===requested || x.slug===requested) || state.businesses[0] || null;
  await loadBusiness();
}

async function loadBusiness(){
  if(!state.business){ renderApp(); return; }
  const { id } = state.business;
  const p = await db.from('link_rrss_profiles').select('*').eq('business_id',id).order('created_at');
  state.profiles=p.data||[];
  const profileIds=state.profiles.map(x=>x.id);
  if(profileIds.length){
    const s=await db.from('link_rrss_sources').select('id,profile_id,provider,label,status,external_profile_id,capabilities,last_synced_at,last_error,metadata,created_at').in('profile_id',profileIds).order('created_at');
    state.sources=s.data||[];
  } else state.sources=[];
  const sourceIds=state.sources.map(x=>x.id);
  if(sourceIds.length){
    const a=await db.from('link_rrss_accounts').select('*').in('source_id',sourceIds).order('platform').order('username');
    state.accounts=a.data||[];
  } else state.accounts=[];
  if(!state.activeAccount || !state.accounts.some(x=>x.id===state.activeAccount.id)){
    state.activeAccount=state.accounts[0]||null;
  }
  state.liveData={};
  syncUrl();
  renderApp();
  if(state.section==='home' && state.sources[0]) loadHomeLive();
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
      <button class="new-connection" id="quick-connect"><span>＋</span>Nueva conexión</button>
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
        <button id="logout"><span class="user-dot"></span><span>Sesión LINK</span><small>Salir</small></button>
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
        <span class="health-pill ${statusDot(st.rrss_status)}"><span></span>${safe(statusLabel(st.rrss_status))}</span>
        <button class="icon-btn" id="refresh"><i data-lucide="refresh-cw"></i></button>
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
        <button class="primary" id="create-mission">${st.rrss_status==='mission'?'Ver misión activa':'Generar misión RRSS'}</button>
        <button id="connect-now">Conectar Zernio</button>
      </div>
      <div class="flow-line"><span>Negocio</span><i>→</i><span>Perfil RRSS</span><i>→</i><span>Zernio API</span><i>→</i><span>Cuentas</span><i>→</i><span>Actividad</span></div>
    </section>`;
}

function homeSection(){
  if(!state.profiles.length && !state.sources.length) return emptyMission();
  const healthy=state.accounts.filter(x=>x.status==='connected').length;
  const warnings=state.sources.filter(x=>x.status==='attention'||x.last_error).length+state.accounts.filter(x=>['warning','error'].includes(x.status)).length;
  return `
    <section class="hero">
      <span class="eyebrow">APARATO RRSS / ${safe(state.business.name.toUpperCase())}</span>
      <h1>Todo lo social, en un solo lugar.</h1>
      <p>Zernio mueve las conexiones. LINK ordena la actividad, detecta señales y las devuelve al resto del negocio.</p>
    </section>
    <section class="metric-row">
      <article><strong>${state.sources.length}</strong><span>Fuentes Zernio</span></article>
      <article><strong>${state.accounts.length}</strong><span>Cuentas detectadas</span></article>
      <article><strong>${healthy}</strong><span>Conectadas</span></article>
      <article><strong>${warnings}</strong><span>Alertas</span></article>
    </section>
    <div class="home-grid">
      <section class="panel span2">
        <div class="panel-head"><div><span class="eyebrow">ACTIVIDAD</span><h2>Ahora</h2></div><button data-section-jump="activity">Ver todo</button></div>
        <div id="home-live" class="activity-feed"><div class="skeleton long"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><span class="eyebrow">CONEXIONES</span><h2>Estado</h2></div><button data-section-jump="connections">Gestionar</button></div>
        <div class="connection-mini">${state.sources.map(s=>`<div><span class="status-dot ${s.status==='healthy'?'ok':'warn'}"></span><div><strong>${safe(s.label)}</strong><small>${safe(s.provider)} · ${safe(fmtDate(s.last_synced_at))}</small></div></div>`).join('')||'<p>Sin fuentes.</p>'}</div>
      </section>
    </div>`;
}

function connectionsSection(){
  return `
    <section class="section-heading"><div><span class="eyebrow">INFRAESTRUCTURA</span><h1>Conexiones</h1><p>Una fuente Zernio puede aportar varias cuentas sociales. Las credenciales se guardan en Supabase Vault.</p></div><button class="primary" id="add-source">＋ Agregar Zernio</button></section>
    <div class="source-list">
      ${state.sources.map(s=>`<article class="source-card">
        <div class="source-head"><div class="source-icon"><i data-lucide="key-round"></i></div><div><strong>${safe(s.label)}</strong><small>Zernio · ${safe(s.metadata?.key_preview||'credencial segura')}</small></div><span class="health-pill ${s.status==='healthy'?'ok':'warn'}"><span></span>${safe(s.status)}</span></div>
        <div class="source-meta"><span>Última sincronización <b>${safe(fmtDate(s.last_synced_at))}</b></span><span>Cuentas <b>${state.accounts.filter(a=>a.source_id===s.id).length}</b></span></div>
        ${s.last_error?`<div class="source-error">${safe(s.last_error)}</div>`:''}
        <div class="source-accounts">${state.accounts.filter(a=>a.source_id===s.id).map(a=>`<div><span class="platform-dot">${safe((a.platform||'?')[0].toUpperCase())}</span><div><strong>${safe(a.username?'@'+a.username:(a.display_name||a.platform))}</strong><small>${safe(a.platform)} · ${safe(a.status)}</small></div></div>`).join('')||'<span class="muted">Sin cuentas detectadas.</span>'}</div>
        <button class="sync-source" data-source-sync="${s.id}"><i data-lucide="refresh-cw"></i>Sincronizar</button>
      </article>`).join('') || `<article class="panel"><h2>No hay conexiones todavía.</h2><p>Agrega la API Zernio de este negocio para comenzar.</p></article>`}
    </div>`;
}

function inboxSection(){
  if(!state.activeAccount) return noAccounts('Conversaciones');
  return `
    <section class="section-heading compact"><div><span class="eyebrow">INBOX / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Conversaciones</h1><p>DMs leídos directamente desde Zernio para la cuenta seleccionada.</p></div><button id="load-inbox"><i data-lucide="refresh-cw"></i>Actualizar</button></section>
    <div id="inbox-live" class="conversation-layout"><div class="panel loading-panel">Selecciona Actualizar para consultar Zernio.</div></div>`;
}
function contentSection(){
  if(!state.activeAccount) return noAccounts('Contenido');
  return `
    <section class="section-heading compact"><div><span class="eyebrow">CONTENIDO / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Publicaciones</h1><p>Contenido publicado en la plataforma, incluyendo piezas creadas fuera de LINK cuando Zernio las sincroniza.</p></div><button id="load-content"><i data-lucide="refresh-cw"></i>Actualizar</button></section>
    <div id="content-live" class="content-grid"><div class="panel loading-panel">Consulta pendiente.</div></div>`;
}
function analyticsSection(){
  if(!state.activeAccount) return noAccounts('Analytics');
  return `
    <section class="section-heading compact"><div><span class="eyebrow">ANALYTICS / ${safe(state.activeAccount.platform.toUpperCase())}</span><h1>Rendimiento</h1><p>Las métricas se obtienen desde la API Zernio de la fuente seleccionada.</p></div><button id="load-analytics"><i data-lucide="refresh-cw"></i>Actualizar</button></section>
    <div id="analytics-live" class="analytics-shell"><div class="panel loading-panel">Consulta pendiente.</div></div>`;
}
function automationsSection(){
  const source=sourceForActiveAccount()||state.sources[0];
  if(!source) return noAccounts('Automatizaciones');
  return `
    <section class="section-heading compact"><div><span class="eyebrow">AUTOMATIZACIÓN</span><h1>Flujos</h1><p>Workflows, secuencias y automatizaciones comentario → DM del motor Zernio.</p></div><button id="load-automations"><i data-lucide="refresh-cw"></i>Actualizar</button></section>
    <div id="automation-live" class="automation-grid"><div class="panel loading-panel">Consulta pendiente.</div></div>`;
}
function activitySection(){
  return `
    <section class="section-heading compact"><div><span class="eyebrow">SEÑALES / LINK WORLD</span><h1>Actividad</h1><p>Vista transversal para convertir actividad social en señales útiles para marketing, CRM, ventas y operación.</p></div></section>
    <section class="panel">
      <div class="activity-map">
        <div><b>Red social</b><span>posts · DMs · comentarios · campañas</span></div><i>→</i>
        <div><b>Zernio</b><span>normaliza conexión y eventos</span></div><i>→</i>
        <div><b>LINK RRSS</b><span>interpreta actividad</span></div><i>→</i>
        <div><b>LINK WORLD</b><span>misión · lead · aprendizaje · venta</span></div>
      </div>
      <div class="coming">La capa de señales queda preparada para alimentarse de webhooks Zernio en la siguiente iteración.</div>
    </section>`;
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
        <div class="content">${bodySection()}</div>
      </main>
    </div>
    <div id="modal-root"></div>
    <div id="toast" class="toast hidden"></div>`;
  createIcons({icons:{Home,MessageCircle,FileText,ChartNoAxesCombined,PlugZap,Workflow,Activity,Search,Plus,ChevronDown,RefreshCw,ArrowLeft,Instagram,Facebook,Youtube,Music2,Globe2,CircleAlert,CircleCheck,KeyRound,X,Send,ShieldCheck}});
  bind();
}

function bind(){
  document.querySelectorAll('[data-business]').forEach(btn=>btn.onclick=async()=>{
    state.business=state.businesses.find(x=>x.id===btn.dataset.business);
    state.section='home'; state.activeAccount=null; await loadBusiness();
  });
  document.querySelectorAll('[data-section]').forEach(btn=>btn.onclick=()=>{
    state.section=btn.dataset.section; renderApp();
  });
  document.querySelectorAll('[data-section-jump]').forEach(btn=>btn.onclick=()=>{state.section=btn.dataset.sectionJump;renderApp();});
  document.querySelectorAll('[data-account]').forEach(btn=>btn.onclick=()=>{state.activeAccount=state.accounts.find(x=>x.id===btn.dataset.account);renderApp();});
  $('#business-search')?.addEventListener('input',e=>{state.search=e.target.value;renderApp();$('#business-search')?.focus();});
  $('#quick-connect')?.addEventListener('click',openConnectionModal);
  $('#add-source')?.addEventListener('click',openConnectionModal);
  $('#connect-now')?.addEventListener('click',openConnectionModal);
  $('#create-mission')?.addEventListener('click',createMission);
  $('#refresh')?.addEventListener('click',loadBusiness);
  $('#logout')?.addEventListener('click',()=>db.auth.signOut().then(()=>loadBase()));
  $('#back-world')?.addEventListener('click',()=>{location.href=LINK_WORLD_URL+(state.business?('?business='+encodeURIComponent(state.business.id)):'');});
  $('#mobile-menu')?.addEventListener('click',()=>document.body.classList.add('side-open'));
  $('#close-mobile')?.addEventListener('click',()=>document.body.classList.remove('side-open'));
  $('#mobile-scrim')?.addEventListener('click',()=>document.body.classList.remove('side-open'));
  document.querySelectorAll('[data-source-sync]').forEach(btn=>btn.onclick=()=>syncSource(btn.dataset.sourceSync));
  $('#load-inbox')?.addEventListener('click',loadInbox);
  $('#load-content')?.addEventListener('click',loadContent);
  $('#load-analytics')?.addEventListener('click',loadAnalytics);
  $('#load-automations')?.addEventListener('click',loadAutomations);
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

async function createMission(){
  try{
    const {data,error}=await db.rpc('link_rrss_create_mission',{p_business_id:state.business.id});
    if(error)throw error;
    toast('Misión RRSS creada en LINK WORLD.');
    state.statuses=(await db.from('link_world_rrss_status_v').select('*')).data||state.statuses;
    renderApp();
  }catch(e){toast(e.message||String(e),true);}
}

function openConnectionModal(){
  if(!state.business)return;
  $('#modal-root').innerHTML=`
    <div class="modal-backdrop">
      <section class="modal">
        <button class="modal-close" id="modal-close">×</button>
        <span class="eyebrow">NUEVA FUENTE</span>
        <h2>Conectar Zernio</h2>
        <p>La API se valida en el servidor y se almacena cifrada en Supabase Vault. LINK RRSS no vuelve a mostrarla.</p>
        <form id="connect-form">
          <label>Negocio<input value="${safe(state.business.name)}" disabled></label>
          <label>Nombre de la conexión<input id="source-label" value="Zernio · ${safe(state.business.name)}" required></label>
          <label>API key Zernio<div class="secret-field"><input id="source-key" type="password" placeholder="sk_…" autocomplete="off" required><span><i data-lucide="shield-check"></i>Vault</span></div></label>
          <div class="security-note">La key viaja únicamente al Edge Function autenticado y se guarda como secreto. Nunca entra a <code>localStorage</code>.</div>
          <button class="primary wide" type="submit">Validar y conectar</button>
        </form>
        <div id="connect-status" class="connect-status hidden"></div>
      </section>
    </div>`;
  createIcons({icons:{ShieldCheck}});
  $('#modal-close').onclick=()=>$('#modal-root').innerHTML='';
  $('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))$('#modal-root').innerHTML='';};
  $('#connect-form').onsubmit=async e=>{
    e.preventDefault();
    const status=$('#connect-status');status.classList.remove('hidden');status.textContent='Validando con Zernio…';
    try{
      const out=await invokeZernio({action:'source.create',business_id:state.business.id,label:$('#source-label').value.trim(),api_key:$('#source-key').value.trim()});
      status.textContent=`Conectado. ${out.account_count} cuenta(s) detectada(s).`;
      await loadBusiness();
      setTimeout(()=>{$('#modal-root').innerHTML='';state.section='connections';renderApp();},700);
    }catch(err){status.textContent=err.message||String(err);status.classList.add('error');}
  };
}

async function syncSource(id){
  toast('Sincronizando Zernio…');
  try{await invokeZernio({action:'source.sync',source_id:id});toast('Conexión actualizada.');await loadBusiness();}
  catch(e){toast(e.message||String(e),true);}
}

async function loadHomeLive(){
  const source=state.sources[0];const account=state.accounts[0];
  if(!source||!account)return;
  try{
    const [posts,inbox]=await Promise.all([
      invokeZernio({action:'zernio.get',source_id:source.id,path:`/v1/accounts/${encodeURIComponent(account.external_account_id)}/posts`,query:{limit:4}}).catch(()=>({data:null})),
      invokeZernio({action:'zernio.get',source_id:source.id,path:'/v1/inbox/conversations',query:{accountId:account.external_account_id,platform:account.platform,limit:4,sortOrder:'desc'}}).catch(()=>({data:null}))
    ]);
    const items=[];
    const postRows=posts.data?.posts||posts.data?.data||[];
    const convRows=inbox.data?.data||inbox.data?.conversations||[];
    for(const p of Array.isArray(postRows)?postRows.slice(0,4):[]) items.push({kind:'Publicación',title:p.content||p.caption||p.text||'Contenido publicado',meta:fmtDate(p.publishedAt||p.createdAt||p.scheduledFor)});
    for(const c of Array.isArray(convRows)?convRows.slice(0,4):[]) items.push({kind:'DM',title:c.participantName||c.participantUsername||c.username||'Conversación',meta:fmtDate(c.lastMessageAt||c.updatedAt)});
    $('#home-live').innerHTML=items.length?items.slice(0,6).map(i=>`<div class="activity-row"><span class="activity-type">${safe(i.kind)}</span><div><strong>${safe(i.title)}</strong><small>${safe(i.meta)}</small></div></div>`).join(''):'<div class="muted">Sin actividad disponible todavía.</div>';
  }catch(e){$('#home-live').innerHTML=`<div class="inline-error">${safe(e.message||String(e))}</div>`;}
}

async function loadInbox(){
  const el=$('#inbox-live'),a=state.activeAccount,s=sourceForActiveAccount(); if(!el||!a||!s)return;
  el.innerHTML='<div class="panel loading-panel">Consultando Inbox…</div>';
  try{
    const out=await invokeZernio({action:'zernio.get',source_id:s.id,path:'/v1/inbox/conversations',query:{accountId:a.external_account_id,platform:a.platform,limit:30,sortOrder:'desc'}});
    const rows=out.data?.data||out.data?.conversations||out.data||[];
    if(!Array.isArray(rows)||!rows.length){el.innerHTML='<div class="panel loading-panel">No hay conversaciones visibles para esta cuenta.</div>';return;}
    el.innerHTML=`<div class="conversation-list">${rows.map(c=>`<button class="conversation-item"><span class="conversation-avatar">${safe((c.participantName||c.participantUsername||'?')[0]?.toUpperCase()||'?')}</span><div><strong>${safe(c.participantName||c.participantUsername||c.username||'Contacto')}</strong><p>${safe(c.lastMessage?.text||c.lastMessageText||c.preview||'Conversación')}</p></div><small>${safe(fmtDate(c.lastMessageAt||c.updatedAt))}</small></button>`).join('')}</div><div class="conversation-empty"><i data-lucide="message-circle"></i><strong>Selecciona una conversación</strong><span>El detalle de mensajes se abrirá aquí.</span></div>`;
    createIcons({icons:{MessageCircle}});
  }catch(e){el.innerHTML=`<div class="panel inline-error">${safe(e.message||String(e))}</div>`;}
}

async function loadContent(){
  const el=$('#content-live'),a=state.activeAccount,s=sourceForActiveAccount();if(!el||!a||!s)return;
  el.innerHTML='<div class="panel loading-panel">Consultando publicaciones…</div>';
  try{
    const out=await invokeZernio({action:'zernio.get',source_id:s.id,path:`/v1/accounts/${encodeURIComponent(a.external_account_id)}/posts`,query:{limit:30}});
    const rows=out.data?.posts||out.data?.data||out.data||[];
    if(!Array.isArray(rows)||!rows.length){el.innerHTML='<div class="panel loading-panel">No hay publicaciones visibles.</div>';return;}
    el.innerHTML=rows.map(p=>`<article class="post-card"><div class="post-meta"><span>${safe(a.platform)}</span><small>${safe(fmtDate(p.publishedAt||p.createdAt||p.scheduledFor))}</small></div><p>${safe((p.content||p.caption||p.text||'Sin texto').slice(0,360))}</p><div class="post-state">${safe(p.status||p.state||'publicado')}</div></article>`).join('');
  }catch(e){el.innerHTML=`<div class="panel inline-error">${safe(e.message||String(e))}</div>`;}
}

async function loadAnalytics(){
  const el=$('#analytics-live'),a=state.activeAccount,s=sourceForActiveAccount();if(!el||!a||!s)return;
  el.innerHTML='<div class="panel loading-panel">Consultando analytics…</div>';
  try{
    const out=await invokeZernio({action:'zernio.get',source_id:s.id,path:'/v1/analytics',query:{accountId:a.external_account_id,platform:a.platform}});
    const root=out.data||{};const rows=root.posts||root.data||[];
    const overview=root.overview||{};
    const metrics=[
      ['Posts',overview.totalPosts??(Array.isArray(rows)?rows.length:'—')],
      ['Publicados',overview.publishedPosts??'—'],
      ['Programados',overview.scheduledPosts??'—'],
      ['Acceso',root.hasAnalyticsAccess===false?'Limitado':'Activo']
    ];
    el.innerHTML=`<div class="metric-row">${metrics.map(([k,v])=>`<article><strong>${safe(v)}</strong><span>${safe(k)}</span></article>`).join('')}</div><section class="panel"><div class="panel-head"><div><span class="eyebrow">DATOS CRUDOS</span><h2>Última lectura</h2></div></div><pre class="json-preview">${safe(JSON.stringify(root,null,2).slice(0,12000))}</pre></section>`;
  }catch(e){el.innerHTML=`<div class="panel inline-error">${safe(e.message||String(e))}</div>`;}
}

async function loadAutomations(){
  const el=$('#automation-live'),s=sourceForActiveAccount()||state.sources[0];if(!el||!s)return;
  el.innerHTML='<div class="panel loading-panel">Consultando automatizaciones…</div>';
  try{
    const [wf,ca,seq]=await Promise.all([
      invokeZernio({action:'zernio.get',source_id:s.id,path:'/v1/workflows',query:{limit:50}}).catch(e=>({error:e.message})),
      invokeZernio({action:'zernio.get',source_id:s.id,path:'/v1/comment-automations',query:{limit:50}}).catch(e=>({error:e.message})),
      invokeZernio({action:'zernio.get',source_id:s.id,path:'/v1/sequences',query:{limit:50}}).catch(e=>({error:e.message}))
    ]);
    const blocks=[['Workflows',wf],['Comentario → DM',ca],['Secuencias',seq]];
    el.innerHTML=blocks.map(([title,data])=>`<article class="panel automation-card"><span class="eyebrow">${safe(title.toUpperCase())}</span><h2>${safe(title)}</h2>${data.error?`<p class="inline-error">${safe(data.error)}</p>`:`<pre class="json-preview small">${safe(JSON.stringify(data.data,null,2).slice(0,5000))}</pre>`}</article>`).join('');
  }catch(e){el.innerHTML=`<div class="panel inline-error">${safe(e.message||String(e))}</div>`;}
}

loadBase().catch(e=>{
  $('#app').innerHTML=`<main class="auth-shell"><section class="auth-card"><h1>No pudimos abrir LINK RRSS.</h1><p>${safe(e.message||String(e))}</p></section></main>`;
});
