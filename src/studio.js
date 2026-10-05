import './studio.css';

const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v||0);
const plural=(v,s,p)=>n(v)===1?s:p;

export async function loadStudio(){ return; }

function connectionState(state){
  const accounts=state.accounts||[];
  const sources=state.sources||[];
  const profiles=state.profiles||[];
  const conversations=state.conversationControl||[];
  const posts=state.persistentPosts||[];
  const drafts=state.publicationDrafts||[];
  const plans=state.operationPlans||[];
  const tasks=state.operationTasks||[];
  const artifacts=state.dotArtifacts||[];
  const subdots=state.dotSubdots||[];
  const connected=accounts.filter(a=>String(a.status||'').toLowerCase()==='connected'||a.connected===true);
  const unread=conversations.reduce((sum,c)=>sum+n(c.unread_count),0);
  const ready=conversations.filter(c=>c.attention_state==='listo_para_resolver').length;
  const waiting=conversations.filter(c=>c.attention_state==='esperando_cliente').length;
  const pendingTasks=tasks.filter(t=>!['done','completed','closed'].includes(String(t.status||'').toLowerCase())).length;
  return {accounts,sources,profiles,conversations,posts,drafts,plans,tasks,artifacts,subdots,connected,unread,ready,waiting,pendingTasks};
}

function statCard(value,label,note,tone=''){
  return '<article class="eco-stat '+tone+'"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span><small>'+esc(note||'')+'</small></article>';
}

function routeCard(section,kicker,title,description,meta,accent=''){
  return '<button class="eco-route '+accent+'" data-eco-section="'+esc(section)+'">'+
    '<span class="eco-route-kicker">'+esc(kicker)+'</span>'+
    '<div><strong>'+esc(title)+'</strong><p>'+esc(description)+'</p></div>'+
    '<footer><small>'+esc(meta)+'</small><b>→</b></footer>'+
  '</button>';
}

function accountRows(data){
  if(!data.accounts.length) return '<div class="eco-empty">Todavía no hay cuentas sociales conectadas para este negocio.</div>';
  return data.accounts.map(a=>{
    const platform=String(a.platform||'canal').toUpperCase();
    const status=String(a.status||'').toLowerCase();
    const ok=status==='connected'||a.connected===true;
    return '<div class="eco-account">'+
      '<span class="eco-platform">'+esc(platform.slice(0,2))+'</span>'+
      '<div><strong>'+esc(a.display_name||a.username||platform)+'</strong><small>'+esc(a.username||platform)+'</small></div>'+
      '<span class="eco-status '+(ok?'ok':'warn')+'">'+(ok?'Conectado':esc(a.status||'Configurar'))+'</span>'+
    '</div>';
  }).join('');
}

function artifactRows(data){
  const rows=data.artifacts.slice(0,6);
  if(!rows.length) return '<div class="eco-empty">Este negocio aún no tiene artefactos LINKDOT visibles desde aquí.</div>';
  return rows.map(a=>'<div class="eco-artifact"><div><span>'+esc(a.artifact_type||a.kind||'ARTEFACTO')+'</span><strong>'+esc(a.name||a.title||'Artefacto LINK')+'</strong></div><small>'+esc(a.status||'activo')+'</small></div>').join('');
}

export function studioSection({state}){
  if(!state.canManage) return '<section class="empty-apparatus small"><span class="eyebrow">ECOSISTEMA</span><h1>Mapa de conexiones LINK.</h1><p>Inicia sesión como miembro LINK para ver cómo se conecta este negocio con el resto del sistema.</p></section>';
  const d=connectionState(state);
  const business=state.business?.name||'Negocio';
  const workspace=state.dotWorkspace;
  return '<section class="eco-page">'+
    '<header class="eco-hero">'+
      '<div><span class="eyebrow">LINK WORLD / '+esc(business)+'</span><h1>Conexiones del ecosistema</h1><p>Un sumario operativo de cómo '+esc(business)+' entra, conversa, produce, opera, mide y deja memoria dentro de LINK.</p></div>'+
      '<div class="eco-health"><i></i><div><strong>'+esc(d.connected.length)+'/'+esc(d.accounts.length)+' cuentas activas</strong><small>'+(d.unread?esc(d.unread)+' mensajes sin leer':'Sin alertas de inbox')+'</small></div></div>'+
    '</header>'+

    '<section class="eco-stats">'+
      statCard(d.accounts.length,'cuentas',d.connected.length+' conectadas','acid')+
      statCard(d.conversations.length,'conversaciones',d.ready+' listas para resolver')+
      statCard(d.posts.length,'publicaciones',d.drafts.length+' borradores')+
      statCard(d.pendingTasks,'tareas abiertas',d.plans.length+' planes operativos')+
      statCard(d.subdots.length,'SubDOTs',workspace?'workspace activo':'sin workspace')+
      statCard(d.artifacts.length,'artefactos','mesas y salidas LINK')+
    '</section>'+

    '<section class="eco-map">'+
      '<div class="eco-map-head"><div><span class="eyebrow">FLUJO DEL NEGOCIO</span><h2>Desde la señal hasta la acción</h2></div><small>Haz clic en cualquier bloque para entrar.</small></div>'+
      '<div class="eco-flow">'+
        routeCard('connections','01 · ENTRADA','Conexiones','Cuentas, perfiles, Zernio y canales que alimentan LINK.',d.accounts.length+' '+plural(d.accounts.length,'cuenta','cuentas'),'source')+
        '<span class="eco-arrow">→</span>'+
        routeCard('inbox','02 · ESCUCHA','ComunEscucha','Convierte conversaciones en intención, contexto, faltantes y próximo paso.',d.conversations.length+' conversaciones','listen')+
        '<span class="eco-arrow">→</span>'+
        routeCard('content','03 · CONTENIDO','Contenido','Memoria editorial, publicaciones, borradores y piezas por autorizar.',d.posts.length+' publicaciones','content')+
        '<span class="eco-arrow">→</span>'+
        routeCard('operation','04 · EJECUCIÓN','Operación','Planes, responsables, tareas y evidencia de ejecución.',d.pendingTasks+' tareas abiertas','operate')+
        '<span class="eco-arrow">→</span>'+
        routeCard('analytics','05 · MEDICIÓN','Analytics','Resultados, señales y aprendizaje para decidir la siguiente acción.','Abrir métricas','measure')+
      '</div>'+
    '</section>'+

    '<div class="eco-columns">'+
      '<section class="eco-panel">'+
        '<header><div><span class="eyebrow">CANALES</span><h2>Fuentes conectadas</h2></div><button data-eco-section="connections">Administrar →</button></header>'+
        '<div class="eco-account-list">'+accountRows(d)+'</div>'+
      '</section>'+
      '<section class="eco-panel">'+
        '<header><div><span class="eyebrow">LINKDOT</span><h2>Capacidad instalada</h2></div><button data-eco-section="artifacts">Ver artefactos →</button></header>'+
        '<div class="eco-dot-summary">'+
          '<div class="eco-dot-node"><span>DOT</span><strong>'+esc(workspace?.name||'LINKRRSS')+'</strong><small>'+esc(workspace?.status||'activo')+'</small></div>'+
          '<div class="eco-dot-copy"><strong>'+d.subdots.length+' SubDOTs conectados</strong><p>Las conversaciones, contenido y operación no son pantallas aisladas: son capacidades del mismo aparato social.</p></div>'+
        '</div>'+
        '<div class="eco-artifact-list">'+artifactRows(d)+'</div>'+
      '</section>'+
    '</div>'+

    '<section class="eco-router">'+
      '<div><span class="eyebrow">RUTAS RÁPIDAS</span><h2>Entrar al ecosistema desde aquí</h2></div>'+
      '<div class="eco-router-actions">'+
        '<button data-eco-section="inbox">Conversaciones <b>'+d.conversations.length+'</b></button>'+
        '<button data-eco-section="content">Contenido <b>'+d.posts.length+'</b></button>'+
        '<button data-eco-section="operation">Operación <b>'+d.pendingTasks+'</b></button>'+
        '<button data-eco-section="calendar">Calendario</button>'+
        '<button data-eco-section="analytics">Analytics</button>'+
        '<button data-eco-section="connections">Conexiones <b>'+d.accounts.length+'</b></button>'+
        '<button data-eco-section="artifacts">Artefactos <b>'+d.artifacts.length+'</b></button>'+
      '</div>'+
    '</section>'+
  '</section>';
}

export function bindStudio({state,renderApp}){
  document.querySelectorAll('[data-eco-section]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.section=btn.dataset.ecoSection;
      renderApp();
      try{
        const u=new URL(location.href);
        u.searchParams.set('section',state.section);
        history.replaceState({},'',u);
      }catch{}
      window.scrollTo({top:0,behavior:'smooth'});
    });
  });
}
