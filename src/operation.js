import './operation.css';

const money = (value=0) => new Intl.NumberFormat('es-CL', {
  style:'currency', currency:'CLP', maximumFractionDigits:0
}).format(Number(value)||0);

const esc = (value='') => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const shortDate = value => {
  if(!value) return 'Sin fecha';
  try { return new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
  catch { return String(value); }
};

const monthLabel = value => {
  if(!value) return 'Periodo';
  try { return new Intl.DateTimeFormat('es-CL',{month:'long',year:'numeric'}).format(new Date(value+'T12:00:00')); }
  catch { return value; }
};

function bounds(state){
  const now=new Date();
  const offset=Number(state.periodOffset||0);
  if(state.period==='history') return {start:new Date(0),end:new Date(8640000000000000)};
  if(state.period==='day'){
    const start=new Date(now);start.setDate(start.getDate()+offset);start.setHours(0,0,0,0);
    const end=new Date(start);end.setHours(23,59,59,999);return {start,end};
  }
  if(state.period==='week'){
    const end=new Date(now);end.setDate(end.getDate()+offset*7);end.setHours(23,59,59,999);
    const start=new Date(end);start.setDate(start.getDate()-6);start.setHours(0,0,0,0);return {start,end};
  }
  if(state.period==='year'){
    const start=new Date(now.getFullYear()+offset,0,1);const end=new Date(now.getFullYear()+offset,11,31,23,59,59,999);return {start,end};
  }
  const start=new Date(now.getFullYear(),now.getMonth()+offset,1);
  const end=new Date(now.getFullYear(),now.getMonth()+offset+1,0,23,59,59,999);
  return {start,end};
}

function activePlan(state){
  const plans=[...(state.operationPlans||[])];
  if(!plans.length) return null;
  const range=bounds(state);
  const overlapping=plans.find(p=>{
    const a=new Date(p.period_start+'T00:00:00');
    const b=new Date(p.period_end+'T23:59:59');
    return a<=range.end && b>=range.start;
  });
  return overlapping || plans.find(p=>p.status==='active') || plans[0];
}

function taskRows(state,plan){
  if(!plan) return [];
  const range=bounds(state);
  return (state.operationTasks||[])
    .filter(t=>t.plan_id===plan.id)
    .filter(t=>{
      if(state.period==='history' || !t.planned_at) return true;
      const d=new Date(t.planned_at);
      return d>=range.start && d<=range.end;
    })
    .sort((a,b)=>{
      const av=a.planned_at?new Date(a.planned_at).getTime():Number.MAX_SAFE_INTEGER;
      const bv=b.planned_at?new Date(b.planned_at).getTime():Number.MAX_SAFE_INTEGER;
      return av-bv;
    });
}

function postRows(state){
  const range=bounds(state);
  return (state.persistentPosts||[]).filter(p=>{
    if(state.activeAccount && p.account_id!==state.activeAccount.id) return false;
    const value=p.published_at||p.scheduled_for||p.created_at;
    if(!value) return false;
    if(state.period==='history') return true;
    const d=new Date(value);
    return d>=range.start && d<=range.end;
  });
}

function postMetrics(post={}){
  const m=post.metrics||{};
  const n=x=>Number(x)||0;
  return {
    reach:n(m.reach),
    interactions:n(m.likes)+n(m.comments)+n(m.shares)+n(m.saves)
  };
}

function taskStatusLabel(status){
  return ({
    planned:'Planificada',
    in_progress:'En proceso',
    awaiting_proof:'Falta comprobante',
    verified:'Comprobada',
    cancelled:'Cancelada'
  })[status]||status;
}

function taskStatusTone(status){
  return status==='verified'?'verified':status==='awaiting_proof'?'proof':status==='in_progress'?'progress':status==='cancelled'?'cancelled':'planned';
}

function countDeliverable(posts,type){
  const normalized=String(type||'').toLowerCase();
  if(normalized==='reel') return posts.filter(p=>String(p.media_type||p.raw?.media_type||'').toLowerCase().includes('reel')).length;
  if(normalized==='story') return posts.filter(p=>String(p.media_type||p.raw?.media_type||'').toLowerCase().includes('stor')).length;
  if(normalized==='post') return posts.filter(p=>{
    const t=String(p.media_type||p.raw?.media_type||'').toLowerCase();
    return !t.includes('reel') && !t.includes('stor');
  }).length;
  return 0;
}

function taskList(tasks,mode='direction'){
  if(!tasks.length) return '<div class="op-empty">Todavía no hay tareas en este periodo.</div>';
  return '<div class="op-task-list">'+tasks.map(t=>{
    const hasProof=!!(t.linked_post_id||t.proof_url);
    return '<article class="op-task '+taskStatusTone(t.status)+'">'+
      '<div class="op-task-main"><span class="op-status-dot"></span><div><div class="op-task-meta">'+
      '<span>'+esc(t.content_type||'tarea')+'</span>'+(t.channel?'<span>'+esc(t.channel)+'</span>':'')+
      '</div><strong>'+esc(t.title)+'</strong><small>'+esc(shortDate(t.planned_at))+'</small></div></div>'+
      '<div class="op-task-side"><span class="op-proof '+(hasProof?'ok':'missing')+'">'+(hasProof?'Evidencia':'Sin evidencia')+'</span>'+
      '<b>'+esc(taskStatusLabel(t.status))+'</b>'+
      (mode!=='client' && t.status!=='cancelled'
        ? '<button data-operation-proof="'+esc(t.id)+'">'+(hasProof?'Ver / cambiar':'Comprobar')+'</button>'
        : '')+
      '</div></article>';
  }).join('')+'</div>';
}

function directionView(state,plan,tasks,posts){
  const activeTasks=tasks.filter(t=>t.status!=='cancelled');
  const verified=activeTasks.filter(t=>t.status==='verified'&&(t.linked_post_id||t.proof_url)).length;
  const waiting=activeTasks.filter(t=>t.status==='awaiting_proof'||(t.status!=='verified'&&!t.linked_post_id&&!t.proof_url)).length;
  const compliance=activeTasks.length?Math.round((verified/activeTasks.length)*100):0;
  const margin=(Number(plan.client_fee_clp)||0)-(Number(plan.operator_fee_clp)||0);
  const totalReach=posts.reduce((a,p)=>a+postMetrics(p).reach,0);
  return '<div class="op-grid">'+
    '<section class="op-economics span2">'+
      '<div><span>Cliente</span><strong>'+money(plan.client_fee_clp)+'</strong></div>'+
      '<div><span>Operación</span><strong>'+money(plan.operator_fee_clp)+'</strong></div>'+
      '<div><span>Margen LINK*</span><strong>'+money(margin)+'</strong><small>*antes de otros costos e impuestos</small></div>'+
    '</section>'+
    '<section class="op-card"><span class="op-eyebrow">ENCARGADA</span><h3>'+esc(plan.operator_name||'Por asignar')+'</h3><p>Produce y publica con sus herramientas habituales. LINK comprueba y estudia.</p><button id="edit-operation-plan">Editar ficha</button></section>'+
    '<section class="op-card"><span class="op-eyebrow">CUMPLIMIENTO</span><strong class="op-big">'+compliance+'%</strong><p>'+verified+' comprobadas · '+waiting+' requieren evidencia</p></section>'+
    '<section class="op-card"><span class="op-eyebrow">SEÑAL SOCIAL</span><strong class="op-big">'+new Intl.NumberFormat('es-CL',{notation:'compact'}).format(totalReach)+'</strong><p>alcance del periodo en publicaciones guardadas</p></section>'+
    '<section class="op-panel span3"><div class="op-panel-head"><div><span class="op-eyebrow">TRABAJO</span><h3>Qué se hizo y qué falta comprobar</h3></div><button class="primary" id="new-operation-task">＋ Nueva tarea</button></div>'+taskList(tasks,'direction')+'</section>'+
  '</div>';
}

function operatorView(state,plan,tasks,posts){
  const verified=tasks.filter(t=>t.status==='verified'&&(t.linked_post_id||t.proof_url)).length;
  const pending=tasks.filter(t=>!['verified','cancelled'].includes(t.status)).length;
  return '<div class="op-grid">'+
    '<section class="op-card span2 op-operator-hero"><span class="op-eyebrow">MI TRABAJO / '+esc(monthLabel(plan.period_start).toUpperCase())+'</span><h3>'+esc(plan.operator_name||'Encargada de contenido')+'</h3><p>'+esc(plan.objective||'Producir, publicar y comprobar el trabajo social del negocio.')+'</p><div><strong>'+verified+'</strong><span>comprobadas</span><strong>'+pending+'</strong><span>pendientes</span></div></section>'+
    '<section class="op-panel span3"><div class="op-panel-head"><div><span class="op-eyebrow">AGENDA</span><h3>Trabajo del periodo</h3></div><button class="primary" id="new-operation-task">＋ Nueva tarea</button></div>'+taskList(tasks,'operator')+'</section>'+
  '</div>';
}

function clientView(state,plan,tasks,posts){
  const verified=tasks.filter(t=>t.status==='verified'&&(t.linked_post_id||t.proof_url)).length;
  const totalReach=posts.reduce((a,p)=>a+postMetrics(p).reach,0);
  const totalInteractions=posts.reduce((a,p)=>a+postMetrics(p).interactions,0);
  const deliverables=Array.isArray(plan.deliverables)?plan.deliverables:[];
  return '<div class="op-grid">'+
    '<section class="op-card op-client-hero span3"><span class="op-eyebrow">RESUMEN PARA CLIENTE</span><h3>'+esc(monthLabel(plan.period_start))+'</h3><p>Qué se hizo, qué quedó comprobado y qué resultado social dejó el periodo.</p></section>'+
    '<section class="op-client-metrics span3">'+
      '<div><strong>'+posts.length+'</strong><span>Publicaciones detectadas</span></div>'+
      '<div><strong>'+verified+'</strong><span>Acciones comprobadas</span></div>'+
      '<div><strong>'+new Intl.NumberFormat('es-CL',{notation:'compact'}).format(totalReach)+'</strong><span>Alcance</span></div>'+
      '<div><strong>'+new Intl.NumberFormat('es-CL',{notation:'compact'}).format(totalInteractions)+'</strong><span>Interacciones</span></div>'+
    '</section>'+
    '<section class="op-panel span2"><div class="op-panel-head"><div><span class="op-eyebrow">COBERTURA</span><h3>Contenido contratado</h3></div></div><div class="op-deliverables">'+
      deliverables.map(d=>{
        const actual=countDeliverable(posts,d.type);
        return '<div><span>'+esc(d.label||d.type)+'</span><strong>'+actual+(d.target!==null&&d.target!==undefined?' / '+Number(d.target):'')+'</strong><small>'+(d.target===null||d.target===undefined?'Meta por definir':'avance del periodo')+'</small></div>';
      }).join('')+
    '</div></section>'+
    '<section class="op-panel"><div class="op-panel-head"><div><span class="op-eyebrow">COMPROBACIÓN</span><h3>Trabajo validado</h3></div></div>'+taskList(tasks.filter(t=>t.status==='verified'),'client')+'</section>'+
  '</div>';
}

export function operationSection({state}){
  if(!state.canManage){
    return '<section class="op-access"><span class="op-eyebrow">OPERACIÓN SOCIAL</span><h1>La operación es privada.</h1><p>Entra en Administración para ver tareas, costos, encargada y comprobantes.</p><button class="primary" id="admin-operation-access">Administrar</button></section>';
  }
  const plan=activePlan(state);
  if(!plan){
    return '<section class="op-access"><span class="op-eyebrow">OPERACIÓN SOCIAL</span><h1>Este negocio aún no tiene un plan operativo.</h1><p>Crea el primer periodo para empezar a medir trabajo, comprobantes y resultados.</p><button class="primary" id="create-operation-plan">Crear plan</button></section>';
  }
  const tasks=taskRows(state,plan);
  const posts=postRows(state);
  const view=state.operationView||'direction';
  const content=view==='operator'?operatorView(state,plan,tasks,posts):view==='client'?clientView(state,plan,tasks,posts):directionView(state,plan,tasks,posts);
  return '<section class="op-heading"><div><span class="op-eyebrow">OPERACIÓN SOCIAL / '+esc(state.business?.name||'NEGOCIO')+'</span><h1>Trabajo que se puede comprobar.</h1><p>La persona produce y publica. LINK conserva evidencia, resultados y aprendizaje.</p></div><div class="op-plan-chip"><strong>'+esc(monthLabel(plan.period_start))+'</strong><span>'+esc(plan.status)+'</span></div></section>'+
    '<nav class="op-view-tabs">'+
      '<button data-operation-view="operator" class="'+(view==='operator'?'active':'')+'">Encargada</button>'+
      '<button data-operation-view="direction" class="'+(view==='direction'?'active':'')+'">Dirección LINK</button>'+
      '<button data-operation-view="client" class="'+(view==='client'?'active':'')+'">Cliente</button>'+
    '</nav>'+content;
}

async function refreshOperation(db,state,renderApp){
  if(!state.business)return;
  const [plans,tasks]=await Promise.all([
    db.from('link_rrss_operation_plans').select('*').eq('business_id',state.business.id).order('period_start',{ascending:false}),
    db.from('link_rrss_operation_tasks').select('*').eq('business_id',state.business.id).order('planned_at',{ascending:true})
  ]);
  if(plans.error) throw plans.error;
  if(tasks.error) throw tasks.error;
  state.operationPlans=plans.data||[];
  state.operationTasks=tasks.data||[];
  renderApp();
}

function closeModal(){const root=document.querySelector('#modal-root');if(root)root.innerHTML='';}

function openTaskModal(ctx){
  const {state,db,renderApp,toast}=ctx;
  const plan=activePlan(state);
  if(!plan)return;
  const root=document.querySelector('#modal-root');
  const accounts=state.accounts||[];
  root.innerHTML='<div class="modal-backdrop"><section class="modal compact-modal op-modal"><button class="modal-close" id="modal-close">×</button><span class="op-eyebrow">NUEVA TAREA</span><h2>Qué tiene que ocurrir</h2><p>La tarea solo contará como comprobada cuando tenga evidencia.</p><form id="operation-task-form">'+
    '<label>Acción<input id="op-task-title" required placeholder="Ej: Publicar reel de karaoke"></label>'+
    '<label>Tipo<select id="op-task-type"><option value="reel">Reel</option><option value="post">Publicación</option><option value="story">Story</option><option value="community">Comunidad / mensajes</option><option value="other">Otra acción</option></select></label>'+
    '<label>Cuenta<select id="op-task-account"><option value="">Cualquier cuenta</option>'+accounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.username?'@'+a.username:(a.display_name||a.platform))+'</option>').join('')+'</select></label>'+
    '<label>Fecha y hora<input id="op-task-date" type="datetime-local"></label>'+
    '<button class="primary wide" type="submit">Guardar tarea</button></form></section></div>';
  document.querySelector('#modal-close').onclick=closeModal;
  root.querySelector('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();};
  document.querySelector('#operation-task-form').onsubmit=async e=>{
    e.preventDefault();
    const title=document.querySelector('#op-task-title').value.trim();
    const contentType=document.querySelector('#op-task-type').value;
    const accountId=document.querySelector('#op-task-account').value||null;
    const plannedRaw=document.querySelector('#op-task-date').value;
    const account=accounts.find(a=>a.id===accountId)||null;
    const payload={
      plan_id:plan.id,
      business_id:state.business.id,
      account_id:accountId,
      title,
      content_type:contentType,
      channel:account?.platform||null,
      planned_at:plannedRaw?new Date(plannedRaw).toISOString():null,
      status:'planned',
      created_by:state.session?.user?.id||null
    };
    const {error}=await db.from('link_rrss_operation_tasks').insert(payload);
    if(error){toast(error.message||String(error),true);return;}
    closeModal();
    await refreshOperation(db,state,renderApp);
    toast('Tarea guardada. Aún no cuenta como comprobada.');
  };
}

function openPlanModal(ctx){
  const {state,db,renderApp,toast}=ctx;
  const plan=activePlan(state);if(!plan)return;
  const deliverables=Array.isArray(plan.deliverables)?plan.deliverables:[];
  const target=type=>deliverables.find(x=>x.type===type)?.target;
  const root=document.querySelector('#modal-root');
  root.innerHTML='<div class="modal-backdrop"><section class="modal compact-modal op-modal"><button class="modal-close" id="modal-close">×</button><span class="op-eyebrow">PLAN OPERATIVO</span><h2>'+esc(monthLabel(plan.period_start))+'</h2><form id="operation-plan-form">'+
    '<label>Encargada<input id="op-operator-name" value="'+esc(plan.operator_name||'')+'" placeholder="Nombre de la encargada"></label>'+
    '<label>Cobro cliente (CLP)<input id="op-client-fee" type="number" min="0" step="1000" value="'+Number(plan.client_fee_clp||0)+'"></label>'+
    '<label>Pago operación (CLP)<input id="op-operator-fee" type="number" min="0" step="1000" value="'+Number(plan.operator_fee_clp||0)+'"></label>'+
    '<label>Objetivo<textarea id="op-objective" rows="3">'+esc(plan.objective||'')+'</textarea></label>'+
    '<div class="op-target-grid"><label>Reels<input id="op-target-reel" type="number" min="0" value="'+(target('reel')??'')+'" placeholder="—"></label><label>Posts<input id="op-target-post" type="number" min="0" value="'+(target('post')??'')+'" placeholder="—"></label><label>Stories<input id="op-target-story" type="number" min="0" value="'+(target('story')??'')+'" placeholder="—"></label></div>'+
    '<button class="primary wide" type="submit">Guardar plan</button></form></section></div>';
  document.querySelector('#modal-close').onclick=closeModal;
  root.querySelector('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();};
  document.querySelector('#operation-plan-form').onsubmit=async e=>{
    e.preventDefault();
    const readTarget=id=>{const v=document.querySelector(id).value;return v===''?null:Number(v);};
    const patch={
      operator_name:document.querySelector('#op-operator-name').value.trim()||null,
      client_fee_clp:Number(document.querySelector('#op-client-fee').value||0),
      operator_fee_clp:Number(document.querySelector('#op-operator-fee').value||0),
      objective:document.querySelector('#op-objective').value.trim()||null,
      deliverables:[
        {type:'reel',label:'Reels',target:readTarget('#op-target-reel')},
        {type:'post',label:'Publicaciones',target:readTarget('#op-target-post')},
        {type:'story',label:'Stories',target:readTarget('#op-target-story')}
      ],
      updated_at:new Date().toISOString()
    };
    const {error}=await db.from('link_rrss_operation_plans').update(patch).eq('id',plan.id);
    if(error){toast(error.message||String(error),true);return;}
    closeModal();await refreshOperation(db,state,renderApp);toast('Plan operativo actualizado.');
  };
}

function openProofModal(taskId,ctx){
  const {state,db,renderApp,toast}=ctx;
  const task=(state.operationTasks||[]).find(t=>t.id===taskId);if(!task)return;
  const posts=(state.persistentPosts||[]).filter(p=>!task.account_id||p.account_id===task.account_id).slice(0,40);
  const root=document.querySelector('#modal-root');
  root.innerHTML='<div class="modal-backdrop"><section class="modal compact-modal op-modal"><button class="modal-close" id="modal-close">×</button><span class="op-eyebrow">COMPROBAR TRABAJO</span><h2>'+esc(task.title)+'</h2><p>Selecciona una publicación detectada o pega un enlace a una captura/archivo. Sin evidencia no se puede verificar.</p><form id="operation-proof-form">'+
    '<label>Publicación detectada<select id="op-proof-post"><option value="">No enlazar publicación</option>'+posts.map(p=>'<option value="'+esc(p.id)+'" '+(task.linked_post_id===p.id?'selected':'')+'>'+esc(shortDate(p.published_at||p.created_at)+' · '+String(p.content||p.media_type||'Publicación').slice(0,70))+'</option>').join('')+'</select></label>'+
    '<label>URL de evidencia<input id="op-proof-url" type="url" value="'+esc(task.proof_url||'')+'" placeholder="Publicación, captura, Drive, Canva…"></label>'+
    '<label>Nota<textarea id="op-proof-note" rows="3" placeholder="Qué demuestra esta evidencia">'+esc(task.proof_note||'')+'</textarea></label>'+
    '<button class="primary wide" type="submit">Verificar con evidencia</button>'+
    (task.status!=='awaiting_proof'?'<button class="auth-secondary wide" id="operation-awaiting-proof" type="button">Marcar como ejecutada, falta comprobante</button>':'')+
    '</form></section></div>';
  document.querySelector('#modal-close').onclick=closeModal;
  root.querySelector('.modal-backdrop').onclick=e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();};
  document.querySelector('#operation-awaiting-proof')?.addEventListener('click',async()=>{
    const {error}=await db.from('link_rrss_operation_tasks').update({status:'awaiting_proof',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',task.id);
    if(error){toast(error.message||String(error),true);return;}
    closeModal();await refreshOperation(db,state,renderApp);toast('Quedó ejecutada, pero no cuenta como comprobada.');
  });
  document.querySelector('#operation-proof-form').onsubmit=async e=>{
    e.preventDefault();
    const postId=document.querySelector('#op-proof-post').value||null;
    const proofUrl=document.querySelector('#op-proof-url').value.trim()||null;
    const note=document.querySelector('#op-proof-note').value.trim()||null;
    if(!postId&&!proofUrl){toast('Necesitas una publicación o una URL de evidencia.',true);return;}
    const patch={
      linked_post_id:postId,
      proof_type:postId?'rrss_post':'url',
      proof_url:proofUrl,
      proof_note:note,
      status:'verified',
      completed_at:task.completed_at||new Date().toISOString(),
      verified_at:new Date().toISOString(),
      verified_by:state.session?.user?.id||null,
      updated_at:new Date().toISOString()
    };
    const {error}=await db.from('link_rrss_operation_tasks').update(patch).eq('id',task.id);
    if(error){toast(error.message||String(error),true);return;}
    closeModal();await refreshOperation(db,state,renderApp);toast('Trabajo comprobado.');
  };
}

async function createPlan(ctx){
  const {state,db,renderApp,toast}=ctx;
  if(!state.business)return;
  const now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth(),1);
  const end=new Date(now.getFullYear(),now.getMonth()+1,0);
  const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const payload={
    business_id:state.business.id,
    period_start:iso(start),
    period_end:iso(end),
    status:'active',
    client_fee_clp:0,
    operator_fee_clp:0,
    objective:'Cobertura social LINK: producir, publicar, comprobar y estudiar.',
    deliverables:[
      {type:'reel',label:'Reels',target:null},
      {type:'post',label:'Publicaciones',target:null},
      {type:'story',label:'Stories',target:null}
    ],
    created_by:state.session?.user?.id||null
  };
  const {error}=await db.from('link_rrss_operation_plans').insert(payload);
  if(error){toast(error.message||String(error),true);return;}
  await refreshOperation(db,state,renderApp);toast('Plan operativo creado.');
}

export function bindOperation(ctx){
  const {state,renderApp}=ctx;
  document.querySelector('#admin-operation-access')?.addEventListener('click',ctx.openAdminLoginModal);
  document.querySelector('#create-operation-plan')?.addEventListener('click',()=>createPlan(ctx));
  document.querySelector('#new-operation-task')?.addEventListener('click',()=>openTaskModal(ctx));
  document.querySelector('#edit-operation-plan')?.addEventListener('click',()=>openPlanModal(ctx));
  document.querySelectorAll('[data-operation-proof]').forEach(btn=>btn.onclick=()=>openProofModal(btn.dataset.operationProof,ctx));
  document.querySelectorAll('[data-operation-view]').forEach(btn=>btn.onclick=()=>{
    state.operationView=btn.dataset.operationView;
    renderApp();
  });
}
