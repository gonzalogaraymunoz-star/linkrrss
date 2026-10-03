import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './connection.js';
import './karaoke.css';

const db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const CONTROL_ID='00000000-0000-0000-0000-000000000001';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const safe=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeHandle=(v='')=>String(v||'').trim().replace(/^@/,'').toLowerCase();
const igHandleOk=v=>/^[a-z0-9._]{1,30}$/.test(normalizeHandle(v));
const uid=()=>crypto.randomUUID();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nowIso=()=>new Date().toISOString();
const fmtTime=v=>v?new Intl.DateTimeFormat('es-CL',{hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'—';
const fmtDate=v=>v?new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

const state={
  mode:null,
  slug:'caracol',
  session:null,
  site:null,
  sites:[],
  account:null,
  joins:[],
  singers:[],
  requests:[],
  sources:[],
  tab:'requests',
  syncing:false,
  sessionAuth:null,
  canManage:false,
  timer:null,
  channels:[],
  boardTimer:null,
  resultTimer:null,
  notice:'',
  error:''
};

function pathnameParts(){
  return location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

export function bootKaraokeRoute(){
  const parts=pathnameParts();
  if(parts[0]!=='karaoke') return false;
  if(parts[1]==='join'){
    state.mode='join'; state.slug=parts[2]||'caracol';
    bootPublicJoin().catch(showFatal);
  }else if(parts[1]==='board'){
    state.mode='board'; state.slug=parts[2]||'caracol';
    bootBoard().catch(showFatal);
  }else{
    state.mode='admin';
    state.slug=new URLSearchParams(location.search).get('site')||'caracol';
    bootAdmin().catch(showFatal);
  }
  return true;
}

function showFatal(error){
  console.error(error);
  const root=$('#app');
  if(root) root.innerHTML=`<main class="karaoke-shell public"><section class="karaoke-fatal"><span>LINK KARAOKE</span><h1>No pudimos abrir el karaoke.</h1><p>${safe(error?.message||String(error))}</p><button onclick="location.reload()">Reintentar</button></section></main>`;
}

function toast(message,error=false){
  let box=$('#karaoke-toast');
  if(!box){
    box=document.createElement('div');
    box.id='karaoke-toast';
    document.body.append(box);
  }
  box.className=error?'show error':'show';
  box.textContent=message;
  clearTimeout(box._t);
  box._t=setTimeout(()=>box.className='',3600);
}

async function invokeZernio(body){
  const {data,error}=await db.functions.invoke('link-rrss-zernio',{body});
  if(error) throw error;
  if(!data?.ok) throw new Error(data?.error||'Zernio no respondió correctamente.');
  return data;
}

async function loadSiteBySlug(slug){
  const {data,error}=await db.from('link_karaoke_sites').select('*').eq('slug',slug).eq('active',true).maybeSingle();
  if(error) throw error;
  if(!data) throw new Error('Este sitio de karaoke no existe o está desactivado.');
  return data;
}

async function loadOpenSession(siteId){
  const {data,error}=await db.from('link_karaoke_sessions')
    .select('*').eq('site_id',siteId).eq('status','open')
    .order('opened_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;
  return data||null;
}

async function bootPublicJoin(){
  state.site=await loadSiteBySlug(state.slug);
  state.session=await loadOpenSession(state.site.id);
  renderJoin();
}

function renderJoin(){
  const root=$('#app');
  const ig='@'+state.site.instagram_username;
  if(!state.session){
    const instagramQr='https://www.instagram.com/caracol_barrestaurant?stkn=emU3ZTJta3BtYnIx&utm_source=qr';
    root.innerHTML=`<main class="karaoke-shell public join-page"><section class="join-card">
      <div class="karaoke-wordmark">CARACOL <b>Karaoke</b></div>
      <span class="pill">KARAOKE · ${safe(state.site.name)}</span>
      <h1>¿Quieres cantar?</h1>
      <p class="join-lead">Hazlo en dos pasos. Síguenos en Instagram y escríbenos por mensaje la canción que quieres cantar.</p>
      <div class="join-steps"><span>1</span><p><b>Sigue a ${safe(ig)}</b><small>Abre nuestro Instagram desde el botón.</small></p><span>2</span><p><b>Escríbenos tu canción por DM</b><small>Ejemplo: El Rey — Vicente Fernández.</small></p></div>
      <a class="karaoke-primary anchor" href="${instagramQr}" target="_blank" rel="noopener">Abrir Instagram <span>↗</span></a>
      <div class="dm-example"><span>DM</span><p>“Quiero cantar: canción — artista”</p></div>
      <small class="join-foot">Cuando la noche esté abierta, esta misma página también te permitirá entrar a la cola del karaoke.</small>
    </section></main>`;
    return;
  }
  root.innerHTML=`<main class="karaoke-shell public join-page">
    <section class="join-card">
      <div class="karaoke-wordmark">LINK <b>Karaoke</b></div>
      <div class="join-live"><i></i> EN VIVO · ${safe(state.site.name)}</div>
      <h1>Entra al karaoke.</h1>
      <p class="join-lead">Te reconocemos por tu Instagram. Después pides tu canción por DM y aparece en la cola.</p>
      <form id="karaoke-join-form">
        <label>Tu Instagram
          <div class="handle-input"><span>@</span><input id="join-instagram" name="instagram" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="tuusuario" required maxlength="30"></div>
        </label>
        <label>Nombre artístico <em>opcional</em>
          <input id="join-artistic" name="artistic" placeholder="Cómo quieres que te anuncien" maxlength="60">
        </label>
        <label class="privacy-choice"><input id="join-public" type="checkbox" checked><span><b>Quiero aparecer en la comunidad</b><small>Mostraremos tu nombre artístico y un enlace a tu Instagram en la pantalla del karaoke.</small></span></label>
        <button class="karaoke-primary" type="submit">Entrar al karaoke <span>→</span></button>
        <p id="join-error" class="form-error"></p>
      </form>
      <div class="join-steps"><span>1</span><p><b>Entras con tu @</b><small>Una identidad, todas tus canciones.</small></p><span>2</span><p><b>Sigues a ${safe(ig)}</b><small>Así quedas dentro de la comunidad.</small></p><span>3</span><p><b>Mandas tu canción por DM</b><small>LINK la recibe y la pone en solicitudes.</small></p></div>
    </section>
  </main>`;
  $('#karaoke-join-form').onsubmit=submitJoin;
}

async function submitJoin(e){
  e.preventDefault();
  const button=e.currentTarget.querySelector('button[type="submit"]');
  const err=$('#join-error');
  const handle=normalizeHandle($('#join-instagram').value);
  const artistic=$('#join-artistic').value.trim();
  if(!igHandleOk(handle)){
    err.textContent='Escribe un usuario de Instagram válido.';
    return;
  }
  button.disabled=true; button.innerHTML='Ingresando…';
  err.textContent='';
  const payload={
    site_id:state.site.id,
    session_id:state.session.id,
    instagram_username:handle,
    artistic_name:artistic||null,
    public_profile:$('#join-public').checked,
    status:'pending'
  };
  const {error}=await db.from('link_karaoke_join_intents').insert(payload);
  if(error && error.code!=='23505'){
    err.textContent=error.message||'No pudimos registrarte.';
    button.disabled=false;button.innerHTML='Entrar al karaoke <span>→</span>';
    return;
  }
  await renderJoinSuccess(handle,artistic,error?.code==='23505');
}

async function renderJoinSuccess(handle,artistic,already=false){
  const root=$('#app');
  const profile='https://instagram.com/'+encodeURIComponent(state.site.instagram_username);
  const {data:community}=await db.from('link_karaoke_public_profiles')
    .select('singer_id,artistic_name,public_avatar_url,instagram_username,instagram_url,updated_at')
    .eq('site_id',state.site.id).order('updated_at',{ascending:false}).limit(12);
  const communityMarkup=(community||[]).length
    ? '<div class="public-community"><div class="public-community-head"><span>COMUNIDAD</span><small>'+community.length+' perfiles recientes</small></div><div class="public-community-grid">'+community.map(p=>'<a href="'+safe(p.instagram_url||'#')+'" target="_blank" rel="noopener" class="'+(p.instagram_url?'':'disabled')+'"><div>'+(p.public_avatar_url?'<img src="'+safe(p.public_avatar_url)+'" alt="">':safe((p.artistic_name||'?')[0].toUpperCase()))+'</div><b>'+safe(p.artistic_name)+'</b>'+(p.instagram_username?'<small>@'+safe(p.instagram_username)+'</small>':'<small>Perfil privado</small>')+'</a>').join('')+'</div></div>'
    : '';
  root.innerHTML=`<main class="karaoke-shell public join-page"><section class="join-card success">
    <div class="karaoke-wordmark">LINK <b>Karaoke</b></div>
    <div class="success-mark">✓</div>
    <span class="pill">${already?'YA ESTÁS DENTRO':'INGRESO LISTO'}</span>
    <h1>${safe(artistic||'@'+handle)}, ahora pide tu canción.</h1>
    <p>Abre <b>@${safe(state.site.instagram_username)}</b>, síguenos y manda por DM el nombre de la canción. LINK reconocerá tu @ automáticamente.</p>
    <a class="karaoke-primary anchor" href="${profile}" target="_blank" rel="noopener">Abrir Instagram <span>↗</span></a>
    <div class="dm-example"><span>DM</span><p>“El Rey — Vicente Fernández”</p></div>
    <small class="join-foot">Puedes pedir más de una canción. Cada mensaje nuevo queda asociado a tu misma ficha.</small>
    ${communityMarkup}
  </section></main>`;
}

async function bootAdmin(){
  const {data:{session}}=await db.auth.getSession();
  state.sessionAuth=session||null;
  if(!session){
    renderAdminLogin();
    return;
  }
  const {data:member,error}=await db.rpc('link_world_is_member');
  if(error) throw error;
  state.canManage=member===true;
  if(!state.canManage){
    renderAccessDenied();
    return;
  }
  await loadAdminSites();
  await loadAdminSite();
  renderAdmin();
  bindAdminRealtime();
  if(state.account&&!state.session){
    setTimeout(()=>invokeZernio({action:'sync.business',business_id:state.site.business_id,trigger:'karaoke_app_open'}).catch(e=>console.warn('karaoke open sync',e)),80);
  }
  scheduleAdminSync(600);
}

function renderAdminLogin(){
  $('#app').innerHTML=`<main class="karaoke-shell admin auth">
    <section class="karaoke-login"><div class="karaoke-wordmark">LINK <b>Karaoke</b></div><span>CONTROL DEL LOCAL</span>
    <h1>Entra con tu cuenta LINK.</h1><p>El Inbox de Instagram y la operación del karaoke son privados.</p>
    <form id="karaoke-login"><input id="karaoke-email" type="email" placeholder="Correo" required><input id="karaoke-password" type="password" placeholder="Clave" required>
    <button class="karaoke-primary" type="submit">Entrar</button><p class="form-error" id="karaoke-login-error"></p></form>
    <a href="/?business=caracol">Volver a LINK RRSS</a></section></main>`;
  $('#karaoke-login').onsubmit=async e=>{
    e.preventDefault();
    const b=e.currentTarget.querySelector('button');b.disabled=true;b.textContent='Entrando…';
    const {error}=await db.auth.signInWithPassword({email:$('#karaoke-email').value.trim(),password:$('#karaoke-password').value});
    if(error){$('#karaoke-login-error').textContent=error.message;b.disabled=false;b.textContent='Entrar';return;}
    location.reload();
  };
}

function renderAccessDenied(){
  $('#app').innerHTML=`<main class="karaoke-shell admin auth"><section class="karaoke-login"><div class="karaoke-wordmark">LINK <b>Karaoke</b></div><h1>Acceso restringido.</h1><p>Tu sesión existe, pero no pertenece a LINK CONTROL CENTRAL.</p><button id="karaoke-signout">Cerrar sesión</button></section></main>`;
  $('#karaoke-signout').onclick=async()=>{await db.auth.signOut();location.reload();};
}

async function loadAdminSites(){
  const {data,error}=await db.from('link_karaoke_sites').select('*').order('name');
  if(error) throw error;
  state.sites=data||[];
  state.site=state.sites.find(x=>x.slug===state.slug)||state.sites[0]||null;
  if(!state.site) throw new Error('No hay sitios LINK Karaoke configurados.');
  state.slug=state.site.slug;
}

async function loadAdminSite(){
  state.session=await loadOpenSession(state.site.id);
  const {data:account,error:accountError}=await db.from('link_rrss_accounts').select('id,source_id,external_account_id,platform,username,display_name,status,metadata,last_synced_at').eq('id',state.site.instagram_account_id).maybeSingle();
  if(accountError) throw accountError;
  state.account=account||null;

  if(!state.session){
    state.joins=[];state.singers=[];state.requests=[];state.sources=[];
    return;
  }
  const [joins,singers,requests]=await Promise.all([
    db.from('link_karaoke_join_intents').select('*').eq('session_id',state.session.id).order('created_at',{ascending:false}),
    db.from('link_karaoke_singers').select('*').eq('site_id',state.site.id).order('last_seen_at',{ascending:false}),
    db.from('link_karaoke_requests').select('*').eq('session_id',state.session.id).order('requested_at',{ascending:true})
  ]);
  if(joins.error) throw joins.error;
  if(singers.error) throw singers.error;
  if(requests.error) throw requests.error;
  state.joins=joins.data||[];
  state.singers=singers.data||[];
  state.requests=requests.data||[];
}

function adminHeader(){
  const live=!!state.session;
  return `<header class="karaoke-admin-head">
    <div class="karaoke-wordmark">LINK <b>Karaoke</b></div>
    <div class="admin-site-select"><small>SITIO</small><select id="karaoke-site-select">${state.sites.map(s=>`<option value="${safe(s.slug)}" ${s.id===state.site.id?'selected':''}>${safe(s.name)}</option>`).join('')}</select></div>
    <div class="admin-head-actions">
      <span class="sync-indicator ${state.syncing?'working':''}"><i></i>${state.syncing?'Sincronizando':'Instagram conectado'}</span>
      ${live?'<button id="karaoke-sync">↻ Sincronizar</button>':''}
      <a href="/?business=${encodeURIComponent(state.site.business_id)}&section=inbox">LINK RRSS ↗</a>
    </div>
  </header>`;
}

function renderAdmin(){
  const root=$('#app');
  if(!state.session){
    root.innerHTML=`<main class="karaoke-shell admin">${adminHeader()}<section class="night-closed">
      <span class="eyebrow">LOCAL / ${safe(state.site.name.toUpperCase())}</span><h1>La noche todavía no está abierta.</h1>
      <p>Al abrirla, LINK sincroniza el Inbox de Instagram, reconoce a quienes entren por QR y comienza a formar la cola.</p>
      <div class="night-flow"><b>QR</b><i>→</i><b>Instagram</b><i>→</i><b>DM</b><i>→</i><b>Solicitud</b><i>→</i><b>Escenario</b></div>
      <button class="karaoke-primary" id="open-karaoke-night">Abrir karaoke ahora</button>
      <a class="subtle-link" href="/karaoke/board/${safe(state.site.slug)}" target="_blank">Abrir pantalla pública ↗</a>
    </section></main>`;
    bindAdminCommon();
    $('#open-karaoke-night').onclick=openNight;
    return;
  }

  const tabs=[['requests','Pedidos'],['stage','Escenario'],['community','Comunidad'],['ranking','Ranking'],['local','Local']];
  root.innerHTML=`<main class="karaoke-shell admin">${adminHeader()}
    <nav class="karaoke-tabs">${tabs.map(([id,label])=>`<button data-karaoke-tab="${id}" class="${state.tab===id?'active':''}">${label}${id==='requests'?'<span>'+pendingRequests().length+'</span>':''}</button>`).join('')}</nav>
    <section class="karaoke-admin-body">${adminSection()}</section>
  </main>`;
  bindAdminCommon();
  bindAdminSection();
}

function adminSection(){
  if(state.tab==='requests') return requestsSection();
  if(state.tab==='community') return communitySection();
  if(state.tab==='ranking') return rankingSection();
  if(state.tab==='local') return localSection();
  return stageSection();
}

function singerFor(id){return state.singers.find(s=>s.id===id)||null;}
function requestSinger(r){return singerFor(r.singer_id);}
function pendingRequests(){return state.requests.filter(r=>r.status==='pending');}
function queuedRequests(){return state.requests.filter(r=>r.status==='queued').sort((a,b)=>(a.queue_position||9999)-(b.queue_position||9999)||new Date(a.requested_at)-new Date(b.requested_at));}
function currentRequest(){return state.requests.find(r=>r.status==='on_stage')||null;}
function completedRequests(){return state.requests.filter(r=>r.status==='completed');}

function stageSection(){
  const current=currentRequest();
  const queued=queuedRequests();
  return `<div class="stage-grid">
    <section class="stage-now">
      <div class="stage-label"><i></i> CANTANDO AHORA</div>
      ${current?stageCurrentMarkup(current):`<div class="stage-empty"><div>🎤</div><h2>Escenario libre.</h2><p>Elige a alguien de la cola para comenzar.</p></div>`}
    </section>
    <section class="queue-panel"><div class="panel-title"><div><span>COLA</span><h2>Próximos</h2></div><strong>${queued.length}</strong></div>
      <div class="queue-list">${queued.length?queued.map((r,i)=>queueItem(r,i)).join(''):'<div class="empty-line">Todavía no hay canciones en cola.</div>'}</div>
      ${pendingRequests().length?'<button class="wide-secondary" data-go-tab="requests">'+pendingRequests().length+' solicitud(es) esperando →</button>':''}
    </section>
  </div>`;
}

function stageCurrentMarkup(r){
  const s=requestSinger(r);
  return `<div class="current-performer">
    <div class="performer-avatar">${safe((s?.artistic_name||s?.instagram_username||'?')[0].toUpperCase())}</div>
    <span class="performer-name">${safe(s?.artistic_name||'Cantante')}</span>
    <a href="https://instagram.com/${encodeURIComponent(s?.instagram_username||'')}" target="_blank" rel="noopener">@${safe(s?.instagram_username||'')}</a>
    <h1>${safe(r.song_title)}</h1><p>${safe(r.song_artist||'')}</p>
    <div class="finish-performance"><label>Nota <input id="host-score" type="number" min="0" max="10" step="0.1" value="8.0"></label><button class="finish-btn" data-finish="${r.id}">Finalizar canción</button></div>
  </div>`;
}

function queueItem(r,i){
  const s=requestSinger(r);
  return `<article class="queue-item"><b>${i+1}</b><div><strong>${safe(s?.artistic_name||s?.instagram_username||'Cantante')}</strong><span>${safe(r.song_title)}${r.song_artist?' · '+safe(r.song_artist):''}</span></div>
    <div class="queue-actions"><button title="Subir" data-move="${r.id}" data-dir="-1">↑</button><button title="Bajar" data-move="${r.id}" data-dir="1">↓</button><button class="start" data-start="${r.id}">Cantar</button></div></article>`;
}

function requestsSection(){
  const pending=pendingRequests();
  const joinsWaiting=state.joins.filter(j=>j.status==='pending'||j.status==='matched');
  return `<section class="requests-panel">
    <div class="section-title"><div><span>INSTAGRAM → KARAOKE</span><h1>Solicitudes</h1><p>Lee los DMs de Caracol en LINKRRSS y carga aquí las canciones en orden de llegada.</p></div><button id="karaoke-sync-requests">↻ Buscar mensajes</button></div>
    ${pending.length?'<div class="request-cards">'+pending.map(requestCard).join('')+'</div>':'<div class="big-empty"><div>✓</div><h2>No hay solicitudes pendientes.</h2><p>Pulsa Buscar mensajes para cargar los nuevos pedidos de Instagram.</p></div>'}
    ${joinsWaiting.length?'<div class="waiting-joins"><span>ESPERANDO DM</span>'+joinsWaiting.map(j=>`<article><b>@${safe(j.instagram_username)}</b><small>${j.conversation_id?'Conversación detectada · esperando canción':'Entró por QR · todavía sin conversación'}</small></article>`).join('')+'</div>':''}
  </section>`;
}

function requestCard(r){
  const s=requestSinger(r);
  return `<article class="request-card"><div class="request-person"><div class="mini-avatar">${safe((s?.artistic_name||s?.instagram_username||'?')[0].toUpperCase())}</div><div><b>${safe(s?.artistic_name||s?.participant_name||'Cantante')}</b><a href="https://instagram.com/${encodeURIComponent(s?.instagram_username||'')}" target="_blank" rel="noopener">@${safe(s?.instagram_username||'')}</a></div><small>${safe(fmtTime(r.requested_at))}</small></div>
    <div class="request-song"><span>QUIERE CANTAR</span><h2>${safe(r.song_title)}</h2><p>${safe(r.song_artist||'Artista no indicado')}</p></div>
    <div class="request-actions"><button data-edit-request="${r.id}">Editar</button><button data-cancel-request="${r.id}">Descartar</button><button class="karaoke-primary compact" data-queue-request="${r.id}">Añadir a la cola →</button></div></article>`;
}

function singerStats(singerId){
  const done=completedRequests().filter(r=>r.singer_id===singerId&&r.host_score!==null);
  const scores=done.map(r=>Number(r.host_score)).filter(Number.isFinite);
  return {
    performances:done.length,
    average:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null,
    best:scores.length?Math.max(...scores):null
  };
}

function communitySection(){
  return `<section><div class="section-title"><div><span>COMUNIDAD</span><h1>La gente del karaoke</h1><p>Una persona, una identidad LINK. Sus canciones quedan en la misma ficha.</p></div><strong class="community-count">${state.singers.length}</strong></div>
    <div class="community-grid">${state.singers.length?state.singers.map(singerCard).join(''):'<div class="big-empty"><h2>La comunidad empieza con el primer QR.</h2></div>'}</div></section>`;
}

function singerCard(s){
  const st=singerStats(s.id);
  return `<article class="singer-card"><div class="singer-top"><div class="singer-avatar">${s.profile_picture?'<img src="'+safe(s.profile_picture)+'" alt="">':safe((s.artistic_name||s.instagram_username||'?')[0].toUpperCase())}</div><span class="presence-dot"></span></div>
    <h2>${safe(s.artistic_name)}</h2><a href="https://instagram.com/${encodeURIComponent(s.instagram_username)}" target="_blank" rel="noopener">@${safe(s.instagram_username)} ↗</a>
    <div class="singer-stats"><div><b>${st.performances}</b><small>presentaciones</small></div><div><b>${st.average===null?'—':st.average.toFixed(1)}</b><small>promedio</small></div><div><b>${st.best===null?'—':st.best.toFixed(1)}</b><small>mejor nota</small></div></div></article>`;
}

function rankingRows(){
  return state.singers.map(s=>({s,...singerStats(s.id)})).filter(x=>x.performances>0).sort((a,b)=>(b.average||0)-(a.average||0)||(b.best||0)-(a.best||0));
}

function rankingSection(){
  const rows=rankingRows();
  return `<section><div class="section-title"><div><span>RESULTADOS DE LA NOCHE</span><h1>Ranking</h1><p>Ordenado por promedio de presentaciones completadas.</p></div></div>
    <div class="ranking-list">${rows.length?rows.map((x,i)=>`<article><span class="rank">${i+1}</span><div class="mini-avatar">${safe((x.s.artistic_name||'?')[0].toUpperCase())}</div><div class="rank-name"><b>${safe(x.s.artistic_name)}</b><small>@${safe(x.s.instagram_username)}</small></div><div><b>${x.average.toFixed(1)}</b><small>promedio</small></div><div><b>${x.best.toFixed(1)}</b><small>mejor</small></div><div><b>${x.performances}</b><small>canciones</small></div></article>`).join(''):'<div class="big-empty"><h2>El ranking aparece después de la primera evaluación.</h2></div>'}</div>
  </section>`;
}

function localSection(){
  const joinUrl=location.origin+'/karaoke/join/'+state.site.slug;
  const boardUrl=location.origin+'/karaoke/board/'+state.site.slug;
  const settings=state.site.settings||{};
  return `<section><div class="section-title"><div><span>LOCAL</span><h1>${safe(state.site.name)}</h1><p>Entrada, pantalla pública y automatizaciones de este sitio.</p></div><button id="close-karaoke-night">Cerrar noche</button></div>
    <div class="local-grid">
      <article class="qr-card"><span>QR DE INGRESO</span><div class="qr-wrap"><img id="karaoke-qr" alt="QR de ingreso"></div><h2>Escanea para entrar</h2><p>${safe(joinUrl)}</p><div><button data-copy="${safe(joinUrl)}">Copiar enlace</button><a href="${safe(joinUrl)}" target="_blank">Abrir ↗</a></div></article>
      <article class="local-card"><span>INSTAGRAM</span><h2>@${safe(state.site.instagram_username)}</h2><p>${safe(state.account?.status==='connected'?'Conectado a Zernio y LINK RRSS. Los DMs se recuperan automáticamente.':'Revisar conexión en LINK RRSS.')}</p><a href="/?business=${encodeURIComponent(state.site.business_id)}&section=connections">Ver conexión ↗</a></article>
      <article class="local-card"><span>PANTALLA PÚBLICA</span><h2>Modo proyector</h2><p>Muestra quién canta, quién viene y la comunidad. No expone mensajes privados.</p><a href="${safe(boardUrl)}" target="_blank">Abrir pantalla ↗</a><button data-copy="${safe(boardUrl)}">Copiar enlace</button></article>
      <article class="local-card settings-card"><span>AUTOMATIZACIONES</span>
        <label><div><b>Bienvenida automática</b><small>Cuando el @ del QR aparece en Instagram, LINK responde por DM.</small></div><input type="checkbox" data-site-setting="auto_welcome" ${settings.auto_welcome!==false?'checked':''}></label>
        <label><div><b>Confirmar canción</b><small>Después de detectar la canción, confirma que quedó en solicitudes.</small></div><input type="checkbox" data-site-setting="auto_confirm_request" ${settings.auto_confirm_request!==false?'checked':''}></label>
      </article>
    </div></section>`;
}

function bindAdminCommon(){
  $('#karaoke-site-select')?.addEventListener('change',e=>{
    const u=new URL(location.href);u.searchParams.set('site',e.target.value);location.href=u.toString();
  });
  $('#karaoke-sync')?.addEventListener('click',()=>syncAndIngest(true));
  if('Notification' in window&&Notification.permission==='default') Notification.requestPermission().catch(()=>null);
  $$('[data-karaoke-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.karaokeTab;renderAdmin();});
  $$('[data-go-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.goTab;renderAdmin();});
}

function bindAdminSection(){
  $$('[data-queue-request]').forEach(b=>b.onclick=()=>queueRequest(b.dataset.queueRequest));
  $$('[data-cancel-request]').forEach(b=>b.onclick=()=>cancelRequest(b.dataset.cancelRequest));
  $$('[data-edit-request]').forEach(b=>b.onclick=()=>editRequest(b.dataset.editRequest));
  $$('[data-start]').forEach(b=>b.onclick=()=>startRequest(b.dataset.start));
  $$('[data-finish]').forEach(b=>b.onclick=()=>finishRequest(b.dataset.finish));
  $$('[data-move]').forEach(b=>b.onclick=()=>moveRequest(b.dataset.move,Number(b.dataset.dir)));
  $('#karaoke-sync-requests')?.addEventListener('click',()=>syncAndIngest(true));
  $('#close-karaoke-night')?.addEventListener('click',closeNight);
  $$('[data-copy]').forEach(b=>b.onclick=async()=>{await navigator.clipboard.writeText(b.dataset.copy);toast('Enlace copiado.');});
  $$('[data-site-setting]').forEach(input=>input.onchange=()=>saveSiteSetting(input.dataset.siteSetting,input.checked));
  if(state.tab==='local') drawQr();
}

async function drawQr(){
  const img=$('#karaoke-qr'); if(!img)return;
  try{img.src=await QRCode.toDataURL(location.origin+'/karaoke/join/'+state.site.slug,{width:280,margin:1,errorCorrectionLevel:'M'});}
  catch(e){console.warn(e);}
}

async function openNight(){
  const button=$('#open-karaoke-night');button.disabled=true;button.textContent='Abriendo…';
  const title='Karaoke '+state.site.name.replace(/^Karaoke\s+/i,'')+' · '+new Intl.DateTimeFormat('es-CL',{dateStyle:'medium'}).format(new Date());
  const {data,error}=await db.from('link_karaoke_sessions').insert({site_id:state.site.id,title,status:'open',public_display:true,opened_at:nowIso()}).select().single();
  if(error){toast(error.message,true);button.disabled=false;button.textContent='Abrir karaoke ahora';return;}
  state.session=data;
  await loadAdminSite();
  renderAdmin();
  bindAdminRealtime();
  scheduleAdminSync(300);
  toast('Karaoke abierto. Buscando mensajes de Instagram…');
}

async function closeNight(){
  if(!state.session)return;
  if(!confirm('¿Cerrar la noche de karaoke? La cola quedará guardada y el QR dejará de aceptar nuevos ingresos.'))return;
  const {error}=await db.from('link_karaoke_sessions').update({status:'closed',closed_at:nowIso(),updated_at:nowIso()}).eq('id',state.session.id);
  if(error){toast(error.message,true);return;}
  stopTimersAndChannels();
  await loadAdminSite();
  renderAdmin();
  toast('Noche cerrada.');
}

async function saveSiteSetting(key,value){
  const settings={...(state.site.settings||{}),[key]:value};
  const {error}=await db.from('link_karaoke_sites').update({settings,updated_at:nowIso()}).eq('id',state.site.id);
  if(error){toast(error.message,true);return;}
  state.site={...state.site,settings};
  toast('Configuración guardada.');
}

async function queueRequest(id){
  const max=Math.max(0,...queuedRequests().map(r=>Number(r.queue_position)||0));
  const {error}=await db.from('link_karaoke_requests').update({status:'queued',queue_position:max+1,updated_at:nowIso()}).eq('id',id);
  if(error){toast(error.message,true);return;}
  await refreshAdminData();toast('Añadido a la cola.');
}

async function cancelRequest(id){
  const {error}=await db.from('link_karaoke_requests').update({status:'cancelled',queue_position:null,updated_at:nowIso()}).eq('id',id);
  if(error){toast(error.message,true);return;}
  await refreshAdminData();
}

async function editRequest(id){
  const r=state.requests.find(x=>x.id===id);if(!r)return;
  const song=prompt('Canción',r.song_title);if(song===null||!song.trim())return;
  const artist=prompt('Artista',r.song_artist||'');if(artist===null)return;
  const {error}=await db.from('link_karaoke_requests').update({song_title:song.trim(),song_artist:artist.trim()||null,updated_at:nowIso()}).eq('id',id);
  if(error){toast(error.message,true);return;}
  await refreshAdminData();
}

async function startRequest(id){
  const current=currentRequest();
  if(current&&current.id!==id){toast('Primero finaliza la canción que está en escenario.',true);return;}
  const {error}=await db.from('link_karaoke_requests').update({status:'on_stage',started_at:nowIso(),updated_at:nowIso()}).eq('id',id);
  if(error){toast(error.message,true);return;}
  await refreshAdminData();
}

async function finishRequest(id){
  const score=clamp(Number($('#host-score')?.value||0),0,10);
  const {error}=await db.from('link_karaoke_requests').update({status:'completed',host_score:score,completed_at:nowIso(),queue_position:null,updated_at:nowIso()}).eq('id',id);
  if(error){toast(error.message,true);return;}
  const r=state.requests.find(x=>x.id===id),s=r?singerFor(r.singer_id):null;
  if(s){
    const {error:interactionError}=await db.from('link_interactions').insert({
      person_id:s.person_id,business_id:state.site.business_id,
      action_type:'karaoke_performance_completed',channel:'instagram',source:'link_karaoke',
      confidence:'observed',metadata:{site_id:state.site.id,session_id:state.session.id,request_id:id,score}
    });
    if(interactionError)console.warn('interaction',interactionError);
  }
  await refreshAdminData();toast('Presentación guardada.');
}

async function moveRequest(id,dir){
  const queue=queuedRequests();
  const i=queue.findIndex(x=>x.id===id),j=i+dir;
  if(i<0||j<0||j>=queue.length)return;
  const a=queue[i],b=queue[j],ap=a.queue_position||i+1,bp=b.queue_position||j+1;
  await db.from('link_karaoke_requests').update({queue_position:bp,updated_at:nowIso()}).eq('id',a.id);
  await db.from('link_karaoke_requests').update({queue_position:ap,updated_at:nowIso()}).eq('id',b.id);
  await refreshAdminData();
}

async function refreshAdminData(){
  if(!state.site)return;
  await loadAdminSite();
  renderAdmin();
}

function scheduleAdminSync(delay=5000){
  clearTimeout(state.timer);
  if(!state.session)return;
  state.timer=setTimeout(async()=>{
    await syncAndIngest(false).catch(e=>console.warn(e));
    scheduleAdminSync(3000);
  },delay);
}

async function syncAndIngest(manual=false){
  if(state.syncing||!state.session||!state.site||!state.account)return;
  state.syncing=true;renderAdmin();
  try{
    await invokeZernio({action:'sync.business',business_id:state.site.business_id,trigger:manual?'linkdot_karaoke_manual':'linkdot_karaoke'});
    await sleep(700);
    const {data,error}=await db.functions.invoke('linkdot-karaoke',{body:{site_slug:state.site.slug}});
    if(error)throw error;
    await loadAdminSite();
    renderAdmin();
    const n=Number(data?.created||0);
    if(n>0)toast('LINKDOT Karaoke recuperó '+n+' canción(es).');
    else if(manual)toast('LINKDOT Karaoke revisó LINKRRSS. Sin canciones nuevas.');
  }catch(e){
    console.error(e);toast('LINKDOT Karaoke: '+(e.message||String(e)),true);
  }finally{
    state.syncing=false;renderAdmin();scheduleAdminSync(3000);
  }
}

async function ingestCurrentSession(){
  if(!state.session||!state.account)return {created:0,matched:0};

  const {data:conversations,error:convError}=await db.from('link_rrss_conversations')
    .select('*').eq('account_id',state.account.id)
    .gte('last_message_at',state.session.opened_at)
    .order('last_message_at',{ascending:true}).limit(1000);
  if(convError)throw convError;
  if(!conversations?.length)return {created:0,matched:0};

  const convIds=conversations.map(x=>x.id);
  const {data:messages,error:msgError}=await db.from('link_rrss_messages')
    .select('*').in('conversation_id',convIds)
    .gte('platform_created_at',state.session.opened_at)
    .eq('direction','incoming')
    .order('platform_created_at',{ascending:true});
  if(msgError)throw msgError;

  const msgIds=(messages||[]).map(m=>m.id);
  let used=new Set();
  if(msgIds.length){
    const {data:usedRows}=await db.from('link_karaoke_request_sources').select('source_message_id').in('source_message_id',msgIds);
    used=new Set((usedRows||[]).map(x=>x.source_message_id));
  }

  const byConv=new Map(conversations.map(x=>[x.id,x]));
  let created=0;
  for(const message of messages||[]){
    if(used.has(message.id)||!isLikelySong(message.message))continue;
    const conv=byConv.get(message.conversation_id);
    if(!conv||!normalizeHandle(conv.participant_username))continue;
    const singer=await ensureSingerFromConversation(conv);
    const parsed=parseSong(message.message);
    if(!parsed.title)continue;
    const request=await createSongRequestFromDm(singer,conv,message,parsed);
    if(!request)continue;
    used.add(message.id);created++;
  }
  return {created,matched:conversations.length};
}

async function ensureSingerFromConversation(conv){
  const handle=normalizeHandle(conv.participant_username);
  let person=null;
  const {data:identifier}=await db.from('link_person_identifiers').select('person_id')
    .eq('identifier_type','social').eq('provider','instagram').eq('normalized_value',handle).maybeSingle();
  if(identifier?.person_id){
    const {data}=await db.from('link_persons').select('*').eq('id',identifier.person_id).maybeSingle();
    person=data||null;
  }
  if(!person){
    const code='LNK-PER-KARAOKE-'+uid().replaceAll('-','').slice(0,16).toUpperCase();
    const {data,error}=await db.from('link_persons').insert({
      universal_code:code,qr_token:uid(),display_name:conv.participant_name||handle,
      status:'provisional',primary_business_id:state.site.business_id,
      metadata:{source:'linkrrss_instagram_dm',instagram_username:handle,site_id:state.site.id}
    }).select().single();
    if(error)throw error;
    person=data;
    const {error:idError}=await db.from('link_person_identifiers').insert({
      person_id:person.id,identifier_type:'social',provider:'instagram',
      identifier_value:handle,normalized_value:handle
    });
    if(idError&&idError.code!=='23505')throw idError;
  }

  let {data:singer}=await db.from('link_karaoke_singers').select('*')
    .eq('site_id',state.site.id).eq('person_id',person.id).maybeSingle();
  if(!singer){
    const {data,error}=await db.from('link_karaoke_singers').insert({
      site_id:state.site.id,person_id:person.id,instagram_username:handle,
      participant_name:conv.participant_name||null,artistic_name:conv.participant_name||handle,
      profile_picture:conv.participant_picture||null,public_profile:true,
      first_joined_at:conv.last_message_at||nowIso(),last_seen_at:nowIso(),
      metadata:{source:'linkrrss_instagram_dm',conversation_id:conv.id}
    }).select().single();
    if(error)throw error;
    singer=data;
  }else{
    const {data}=await db.from('link_karaoke_singers').update({
      participant_name:conv.participant_name||singer.participant_name,
      profile_picture:conv.participant_picture||singer.profile_picture,
      last_seen_at:nowIso(),updated_at:nowIso()
    }).eq('id',singer.id).select().single();
    singer=data||singer;
  }
  return singer;
}

async function createSongRequestFromDm(singer,conv,message,parsed){
  const {data:already}=await db.from('link_karaoke_request_sources').select('request_id').eq('source_message_id',message.id).maybeSingle();
  if(already)return null;
  const {data,error}=await db.from('link_karaoke_requests').insert({
    site_id:state.site.id,session_id:state.session.id,singer_id:singer.id,
    song_title:parsed.title,song_artist:parsed.artist,status:'pending',
    requested_at:message.platform_created_at||message.created_at||nowIso()
  }).select().single();
  if(error)throw error;
  const {error:sourceError}=await db.from('link_karaoke_request_sources').insert({
    request_id:data.id,conversation_id:conv.id,source_message_id:message.id,
    external_conversation_id:conv.external_conversation_id,
    external_message_id:message.external_message_id,raw_message:message.message,
    source_kind:'linkrrss_instagram_dm'
  });
  if(sourceError){
    await db.from('link_karaoke_requests').delete().eq('id',data.id);
    if(sourceError.code==='23505')return null;
    throw sourceError;
  }
  return data;
}

async function sendDm(externalConversationId,message,idempotencyKey){
  return invokeZernio({
    action:'inbox.send',
    source_id:state.account.source_id,
    conversation_id:externalConversationId,
    account_id:state.account.external_account_id,
    message,
    idempotency_key:idempotencyKey
  });
}

async function ensureSinger(join,conv){
  const handle=normalizeHandle(join.instagram_username);
  let person=null;
  const {data:identifier}=await db.from('link_person_identifiers').select('person_id').eq('identifier_type','social').eq('provider','instagram').eq('normalized_value',handle).maybeSingle();
  if(identifier?.person_id){
    const {data}=await db.from('link_persons').select('*').eq('id',identifier.person_id).maybeSingle();
    person=data||null;
  }
  let newPerson=false;
  if(!person){
    const code='LNK-PER-KARAOKE-'+uid().replaceAll('-','').slice(0,16).toUpperCase();
    const {data,error}=await db.from('link_persons').insert({
      universal_code:code,qr_token:uid(),display_name:join.artistic_name||conv.participant_name||handle,
      status:'provisional',primary_business_id:state.site.business_id,
      metadata:{source:'link_karaoke',instagram_username:handle,site_id:state.site.id}
    }).select().single();
    if(error)throw error;
    person=data;newPerson=true;
    const {error:idError}=await db.from('link_person_identifiers').insert({
      person_id:person.id,identifier_type:'social',provider:'instagram',
      identifier_value:handle,normalized_value:handle
    });
    if(idError&&idError.code!=='23505')throw idError;
  }

  let {data:singer}=await db.from('link_karaoke_singers').select('*').eq('site_id',state.site.id).eq('person_id',person.id).maybeSingle();
  const artistic=join.artistic_name||singer?.artistic_name||conv.participant_name||handle;
  let newSinger=false;
  if(!singer){
    const {data,error}=await db.from('link_karaoke_singers').insert({
      site_id:state.site.id,person_id:person.id,instagram_username:handle,
      participant_name:conv.participant_name||null,artistic_name:artistic,
      profile_picture:conv.participant_picture||null,public_profile:join.public_profile,
      first_joined_at:join.created_at,last_seen_at:nowIso(),
      metadata:{source:'instagram_dm',conversation_id:conv.id}
    }).select().single();
    if(error)throw error;
    singer=data;
    newSinger=true;
  }else{
    const {data}=await db.from('link_karaoke_singers').update({
      participant_name:conv.participant_name||singer.participant_name,
      artistic_name:join.artistic_name||singer.artistic_name,
      profile_picture:conv.participant_picture||singer.profile_picture,
      public_profile:join.public_profile,last_seen_at:nowIso(),updated_at:nowIso()
    }).eq('id',singer.id).select().single();
    singer=data||singer;
  }

  if(join.public_profile){
    const {error:publicProfileError}=await db.from('link_karaoke_public_profiles').upsert({
      singer_id:singer.id,site_id:state.site.id,artistic_name:singer.artistic_name,
      public_avatar_url:singer.profile_picture||null,instagram_username:handle,
      instagram_url:'https://instagram.com/'+handle,updated_at:nowIso()
    },{onConflict:'singer_id'});
    if(publicProfileError)console.warn('public profile',publicProfileError);
  }else{
    const {error:privateProfileError}=await db.from('link_karaoke_public_profiles').delete().eq('singer_id',singer.id);
    if(privateProfileError)console.warn('private profile',privateProfileError);
  }

  if(newSinger||join.status==='pending'||!join.conversation_id){
    const {error:joinInteractionError}=await db.from('link_interactions').insert({
      person_id:person.id,business_id:state.site.business_id,action_type:'karaoke_join',
      channel:'instagram',source:'link_karaoke',confidence:'observed',
      metadata:{site_id:state.site.id,session_id:state.session.id,join_intent_id:join.id||null,instagram_username:handle}
    });
    if(joinInteractionError)console.warn('interaction',joinInteractionError);
  }
  await ensureLead(person,singer,join,conv);
  return singer;
}

async function ensureLead(person,singer,join,conv){
  const ext='zernio:'+conv.external_conversation_id;
  const {data:existing}=await db.from('sales_leads').select('id').eq('business_id',state.site.business_id).eq('external_ref',ext).maybeSingle();
  let leadId=existing?.id||null;
  if(!leadId){
    const {data,error}=await db.from('sales_leads').insert({
      control_id:CONTROL_ID,business_id:state.site.business_id,
      source:'karaoke_qr_instagram_dm',source_page:'@'+state.site.instagram_username,
      source_cta:'karaoke_song_request',full_name:singer.artistic_name||conv.participant_name||join.instagram_username,
      message:'Ingreso por QR de karaoke + Instagram DM',stage:'qualified',score:40,
      external_ref:ext,last_contact_at:conv.last_message_at||nowIso(),
      metadata:{
        created_by:'link_karaoke',classification:'karaoke_participant',intent_type:'karaoke',
        conversation_id:conv.id,external_conversation_id:conv.external_conversation_id,
        participant_username:join.instagram_username,site_id:state.site.id,session_id:state.session.id
      }
    }).select('id').single();
    if(!error)leadId=data?.id||null;
    else console.warn('lead',error);
  }
  if(leadId){
    const {error:leadLinkError}=await db.from('link_person_leads').upsert({
      person_id:person.id,lead_id:leadId,business_id:state.site.business_id,relation_type:'lead'
    },{onConflict:'lead_id'});
    if(leadLinkError)console.warn('lead link',leadLinkError);
  }
}

function isLikelySong(text){
  const t=String(text||'').trim();
  if(t.length<2)return false;
  if(!/[a-záéíóúñ0-9]/i.test(t))return false;
  const low=t.toLowerCase().replace(/[¿?¡!.,]/g,' ').replace(/\s+/g,' ').trim();
  if(/^(hola|holi|hello|hi|hey|buenas|buenas noches|buenas tardes|gracias|ok|oki|dale|si|sí|no|listo)$/.test(low))return false;
  if(/\b(horario|abren|cierran|reserva|reservar|mesa|personas|karaoke hoy|qué días|que dias|cuando hay|cuándo hay|precio|carta|menu|menú)\b/.test(low))return false;
  return true;
}

function parseSong(text){
  let raw=String(text||'').trim().replace(/^["“”']|["“”']$/g,'');
  raw=raw.replace(/^(quiero cantar|quiero pedir|canción|cancion|tema)\s*[:\-–—]?\s*/i,'').trim();
  const parts=raw.split(/\s+[—–-]\s+/);
  if(parts.length>=2)return {title:parts[0].trim().slice(0,140),artist:parts.slice(1).join(' — ').trim().slice(0,120)||null};
  return {title:raw.slice(0,140),artist:null};
}

async function createSongRequest(singer,join,conv,message,parsed){
  const {data,error}=await db.from('link_karaoke_requests').insert({
    site_id:state.site.id,session_id:state.session.id,singer_id:singer.id,
    song_title:parsed.title,song_artist:parsed.artist,status:'pending',
    requested_at:message.platform_created_at||message.created_at||nowIso()
  }).select().single();
  if(error){console.warn(error);return null;}
  const {error:sourceError}=await db.from('link_karaoke_request_sources').insert({
    request_id:data.id,conversation_id:conv.id,source_message_id:message.id,
    external_conversation_id:conv.external_conversation_id,
    external_message_id:message.external_message_id,raw_message:message.message,
    source_kind:'instagram_dm'
  });
  if(sourceError){
    await db.from('link_karaoke_requests').delete().eq('id',data.id);
    if(sourceError.code==='23505')return null;
    throw sourceError;
  }
  await db.from('link_karaoke_join_intents').update({status:'converted',converted_at:join.converted_at||nowIso()}).eq('id',join.id);
  const {error:requestInteractionError}=await db.from('link_interactions').insert({
    person_id:singer.person_id,business_id:state.site.business_id,action_type:'karaoke_song_request',
    channel:'instagram',source:'link_karaoke',confidence:'observed',
    metadata:{site_id:state.site.id,session_id:state.session.id,request_id:data.id,source_message_id:message.id}
  });
  if(requestInteractionError)console.warn('interaction',requestInteractionError);
  return data;
}

function bindAdminRealtime(){
  for(const c of state.channels)db.removeChannel(c);
  state.channels=[];
  if(!state.session)return;
  const requests=db.channel('karaoke-requests-'+state.session.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'link_karaoke_requests',filter:'session_id=eq.'+state.session.id},()=>refreshAdminData().catch(()=>null))
    .subscribe();
  const joins=db.channel('karaoke-joins-'+state.session.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'link_karaoke_join_intents',filter:'session_id=eq.'+state.session.id},()=>{
      setTimeout(()=>syncAndIngest(false),2500);
    }).subscribe();
  state.channels=[requests,joins];
}

function stopTimersAndChannels(){
  clearTimeout(state.timer);state.timer=null;
  clearTimeout(state.boardTimer);state.boardTimer=null;
  clearTimeout(state.resultTimer);state.resultTimer=null;
  for(const c of state.channels)db.removeChannel(c);
  state.channels=[];
}

async function bootBoard(){
  state.site=await loadSiteBySlug(state.slug);
  state.session=await loadOpenSession(state.site.id);
  await loadBoardData();
  renderBoard();
  bindBoardRealtime();
}

async function loadBoardData(){
  if(!state.session){state.requests=[];state.singers=[];return;}
  const {data:requests,error}=await db.from('link_karaoke_requests').select('*').eq('session_id',state.session.id).order('requested_at');
  if(error)throw error;
  state.requests=requests||[];
  const singerIds=[...new Set(state.requests.map(r=>r.singer_id))];
  if(!singerIds.length){state.singers=[];return;}
  const {data:profiles,error:profilesError}=await db.from('link_karaoke_public_profiles').select('*').in('singer_id',singerIds);
  if(profilesError)throw profilesError;
  state.singers=(profiles||[]).map(p=>({
    id:p.singer_id,artistic_name:p.artistic_name,instagram_username:p.instagram_username,
    profile_picture:p.public_avatar_url,instagram_url:p.instagram_url
  }));
}

function renderBoard(){
  const root=$('#app');
  if(!state.session){
    root.innerHTML=`<main class="karaoke-board closed"><div class="board-brand">LINK <b>Karaoke</b></div><section><span>${safe(state.site.name)}</span><h1>Nos vemos en el próximo karaoke.</h1><p>Escanea el QR cuando la noche esté abierta.</p></section></main>`;
    state.boardTimer=setTimeout(()=>bootBoard().catch(()=>null),15000);
    return;
  }
  const current=currentRequest(),queue=queuedRequests(),recent=completedRequests().sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at)).slice(0,3);
  const currentSinger=current?requestSinger(current):null;
  const latest=recent[0]||null;
  const latestAge=latest?.completed_at?Date.now()-new Date(latest.completed_at).getTime():Infinity;
  const showResult=!current&&latest&&latest.host_score!==null&&latestAge>=0&&latestAge<14000;
  const latestSinger=showResult?requestSinger(latest):null;
  clearTimeout(state.resultTimer);
  if(showResult) state.resultTimer=setTimeout(async()=>{await loadBoardData();renderBoard();},Math.max(500,14200-latestAge));
  root.innerHTML=`<main class="karaoke-board">
    ${showResult?`<div class="board-result-card"><span>FICHA FINAL</span><h2>${safe(latestSinger?.artistic_name||'Cantante')}</h2><p>${safe(latest.song_title)}</p><strong>${Number(latest.host_score).toFixed(1)}</strong><small>NOTA DEL ANFITRIÓN</small></div>`:''}
    <header><div class="board-brand">LINK <b>Karaoke</b></div><div class="board-live"><i></i> EN VIVO · ${safe(state.site.name)}</div></header>
    <section class="board-main">
      <div class="board-now"><span>CANTANDO AHORA</span>${current?`<h1>${safe(currentSinger?.artistic_name||'Cantante')}</h1><h2>${safe(current.song_title)}</h2><p>${safe(current.song_artist||'')}</p>`:'<h1>Escenario libre</h1><h2>La próxima canción está por comenzar.</h2>'}</div>
      <div class="board-next"><span>DESPUÉS</span>${queue.length?queue.slice(0,5).map((r,i)=>{const s=requestSinger(r);return `<article><b>${i+1}</b><div><h3>${safe(s?.artistic_name||'Cantante')}</h3><p>${safe(r.song_title)}</p></div></article>`}).join(''):'<p class="board-empty">La cola está esperando nuevas canciones.</p>'}</div>
    </section>
    <footer><div><b>${state.singers.length}</b><span>personas en la comunidad</span></div>${recent.length?'<div class="recent-scores">'+recent.map(r=>{const s=requestSinger(r);return '<span>'+safe(s?.artistic_name||'Cantante')+' · <b>'+Number(r.host_score||0).toFixed(1)+'</b></span>'}).join('')+'</div>':'<div>Escanea el QR para entrar</div>'}</footer>
  </main>`;
}

function bindBoardRealtime(){
  for(const c of state.channels)db.removeChannel(c);
  state.channels=[];
  if(!state.session)return;
  const channel=db.channel('karaoke-board-'+state.session.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'link_karaoke_requests',filter:'session_id=eq.'+state.session.id},async()=>{
      await loadBoardData();renderBoard();
    }).subscribe();
  state.channels=[channel];
  state.boardTimer=setInterval(async()=>{await loadBoardData();renderBoard();},30000);
}

window.addEventListener('beforeunload',stopTimersAndChannels);
