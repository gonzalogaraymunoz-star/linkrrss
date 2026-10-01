import './notifications.css';
let realtimeChannel=null;

const esc=(value='')=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const ago=value=>{
  if(!value)return '';
  const ms=Date.now()-new Date(value).getTime();
  if(ms<60000)return 'Ahora';
  if(ms<3600000)return 'Hace '+Math.max(1,Math.round(ms/60000))+' min';
  if(ms<86400000)return 'Hace '+Math.round(ms/3600000)+' h';
  return new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
};

export async function loadNotifications({db,state}){
  if(!state.canManage||!state.business){
    state.notifications=[];
    return;
  }
  const {data,error}=await db.from('link_rrss_notifications')
    .select('*')
    .eq('business_id',state.business.id)
    .order('created_at',{ascending:false})
    .limit(100);
  if(error) throw error;
  state.notifications=data||[];
}

export function notificationBell(state){
  if(!state.canManage)return '';
  const unread=(state.notifications||[]).filter(n=>!n.is_read).length;
  return '<button class="icon-btn notification-bell '+(unread?'has-alerts':'')+'" id="notification-bell" title="Alertas de mensajes" aria-label="Alertas">'+
    '<span class="notification-bell-icon">♢</span>'+
    (unread?'<b>'+Math.min(unread,99)+'</b>':'')+
  '</button>';
}

function browserAlert(state,row){
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return;
  const n=new Notification((state.business?.name||'LINK')+' · '+(row.title||'Nuevo mensaje'),{
    body:row.body||'Nuevo mensaje recibido',
    tag:'link-rrss-'+row.id
  });
  n.onclick=()=>{window.focus();n.close();};
}

export function startNotificationRealtime({db,state,renderApp,toast}){
  if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null;}
  if(!state.canManage||!state.business)return;
  realtimeChannel=db.channel('rrss-alerts-'+state.business.id)
    .on('postgres_changes',{
      event:'INSERT',
      schema:'public',
      table:'link_rrss_notifications',
      filter:'business_id=eq.'+state.business.id
    },payload=>{
      const row=payload.new;
      if(!row)return;
      if(!(state.notifications||[]).some(n=>n.id===row.id)){
        state.notifications=[row,...(state.notifications||[])].slice(0,100);
      }
      browserAlert(state,row);
      toast('Nuevo mensaje · '+(row.title||'Instagram'));
      renderApp();
    })
    .subscribe();
}

function openConversationFromNotification(row,state,renderApp){
  const conv=(state.persistentConversations||[]).find(c=>c.id===row.conversation_id);
  state.section='inbox';
  if(conv?.external_conversation_id)state.selectedConversationId=conv.external_conversation_id;
  document.querySelector('#modal-root').innerHTML='';
  renderApp();
}

export function openNotificationCenter({db,state,renderApp,toast}){
  const root=document.querySelector('#modal-root');
  if(!root)return;
  const rows=state.notifications||[];
  const unread=rows.filter(n=>!n.is_read).length;
  const browserStatus=typeof Notification==='undefined'?'unavailable':Notification.permission;
  root.innerHTML='<div class="modal-backdrop"><section class="modal notification-center">'+
    '<button class="modal-close" id="modal-close">×</button>'+
    '<span class="eyebrow">ALERTAS / '+esc((state.business?.name||'NEGOCIO').toUpperCase())+'</span>'+
    '<div class="notification-title-row"><div><h2>Mensajes nuevos</h2><p>'+unread+' sin revisar · cada DM nuevo queda registrado.</p></div>'+
    (browserStatus==='granted'
      ?'<span class="notification-enabled">Avisos activos</span>'
      :browserStatus==='unavailable'
        ?'<span class="notification-muted">Navegador sin soporte</span>'
        :'<button class="primary" id="enable-browser-alerts">Activar avisos</button>')+
    '</div>'+
    '<div class="notification-list">'+
      (rows.length?rows.map(n=>'<button class="notification-row '+(!n.is_read?'unread':'')+'" data-notification="'+esc(n.id)+'">'+
        '<span class="notification-dot"></span><div><strong>'+esc(n.title||'Nuevo mensaje')+'</strong><p>'+esc(String(n.body||'Nuevo mensaje recibido').slice(0,180))+'</p><small>'+esc(ago(n.created_at))+'</small></div><b>→</b>'+
      '</button>').join(''):'<div class="notification-empty">No hay alertas todavía.</div>')+
    '</div>'+
    (unread?'<button class="auth-secondary wide" id="mark-all-notifications">Marcar todas como revisadas</button>':'')+
  '</section></div>';

  document.querySelector('#modal-close').onclick=()=>root.innerHTML='';
  root.querySelector('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))root.innerHTML='';};

  document.querySelector('#enable-browser-alerts')?.addEventListener('click',async()=>{
    if(typeof Notification==='undefined')return;
    const permission=await Notification.requestPermission();
    if(permission==='granted')toast('Avisos del navegador activados.');
    else toast('El navegador no autorizó los avisos.',true);
    openNotificationCenter({db,state,renderApp,toast});
  });

  document.querySelectorAll('[data-notification]').forEach(btn=>btn.onclick=async()=>{
    const row=(state.notifications||[]).find(n=>n.id===btn.dataset.notification);
    if(!row)return;
    if(!row.is_read){
      const {error}=await db.from('link_rrss_notifications')
        .update({is_read:true,read_at:new Date().toISOString()})
        .eq('id',row.id);
      if(!error){
        row.is_read=true;
        row.read_at=new Date().toISOString();
      }
    }
    openConversationFromNotification(row,state,renderApp);
  });

  document.querySelector('#mark-all-notifications')?.addEventListener('click',async()=>{
    const ids=(state.notifications||[]).filter(n=>!n.is_read).map(n=>n.id);
    if(!ids.length)return;
    const now=new Date().toISOString();
    const {error}=await db.from('link_rrss_notifications')
      .update({is_read:true,read_at:now})
      .in('id',ids);
    if(error){toast(error.message||String(error),true);return;}
    state.notifications.forEach(n=>{if(ids.includes(n.id)){n.is_read=true;n.read_at=now;}});
    renderApp();
    openNotificationCenter({db,state,renderApp,toast});
  });
}

export function bindNotifications(ctx){
  document.querySelector('#notification-bell')?.addEventListener('click',()=>openNotificationCenter(ctx));
}
