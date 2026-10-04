import './studio.css';

const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function loadStudio({state,db}){
  if(!state.canManage||!state.business)return;
  const {data,error}=await db.from('link_rrss_studio_projects').select('*').eq('business_id',state.business.id).neq('status','archived').order('updated_at',{ascending:false});
  if(error)throw error;
  state.studioProjects=data||[];
}

export function studioSection({state}){
  if(!state.canManage)return '<section class="empty-apparatus small"><span class="eyebrow">LINK STUDIO</span><h1>Mesa audiovisual interna.</h1><p>Inicia sesión como miembro LINK para trabajar aquí.</p></section>';
  const rows=state.studioProjects||[];
  const cards=rows.length?rows.map(p=>`<article class="studio-project"><div><span>${esc(p.aspect_ratio)} · ${esc(p.channel||'sin canal')}</span><i>${esc(p.status)}</i></div><h3>${esc(p.name)}</h3><p>${esc(p.brief||'Proyecto audiovisual editable.')}</p><footer><small>${esc(p.intent)}</small><b>Proyecto persistente</b></footer></article>`).join(''):'<div class="studio-empty"><b>Todavía no hay proyectos.</b><span>El primer pedido crea una mesa editable y persistente para este negocio.</span></div>';
  return `<section class="link-studio">
    <header class="studio-hero"><div><span class="eyebrow">LINKDOT MAR · LINKSUBDOT VIDEO</span><h1>LINK Studio</h1><p>Pide el resultado. El SubDot se ocupa del montaje.</p></div><span class="studio-state">Motor nativo LINK</span></header>
    <div class="studio-intents">
      <button data-studio-intent="reel"><b>Crear Reel</b><span>9:16 listo para revisión</span></button>
      <button data-studio-intent="edit"><b>Editar video</b><span>Cortar, ordenar y montar</span></button>
      <button data-studio-intent="screen_recording"><b>Grabar pantalla</b><span>Preparar captura y montaje</span></button>
      <button data-studio-intent="adapt"><b>Adaptar contenido</b><span>Reencuadrar para otro canal</span></button>
    </div>
    <div class="studio-flow"><span>Material</span><i>→</i><span>Montaje</span><i>→</i><span>Marca</span><i>→</i><span>Revisión MAR</span><i>→</i><strong>Publicación</strong></div>
    <section class="studio-projects"><header><div><span class="eyebrow">PROYECTOS</span><h2>${esc(state.business?.name||'Negocio')}</h2></div><b>${rows.length}</b></header><div class="studio-grid">${cards}</div></section>
    <aside class="studio-boundary"><b>Contrato de motor</b><span>LINK Studio conserva su propio estado y datos. Recordly se trata como referencia/adaptador externo: no se incorpora código AGPL al núcleo de LINKRRSS.</span></aside>
  </section>`;
}

export function bindStudio({state,db,renderApp,toast}){
  document.querySelectorAll('[data-studio-intent]').forEach(btn=>btn.onclick=async()=>{
    const intent=btn.dataset.studioIntent;
    const labels={reel:'Nuevo Reel',edit:'Edición de video',screen_recording:'Grabación de pantalla',adapt:'Adaptación de contenido'};
    btn.disabled=true;
    const {error}=await db.from('link_rrss_studio_projects').insert({
      business_id:state.business.id,name:labels[intent],intent,
      aspect_ratio:intent==='reel'?'9:16':'16:9',
      brief:'Mesa creada por LINK Studio. Añade material y MAR dirigirá la siguiente versión.',
      editor_state:{timeline:[],version:1},brand_contract:{business_id:state.business.id}
    });
    if(error){toast(error.message||String(error),true);btn.disabled=false;return;}
    await loadStudio({state,db});toast('Proyecto creado en LINK Studio.');renderApp();
  });
}
