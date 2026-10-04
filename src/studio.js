import './studio.css';

const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function loadStudio({state,db}){
  if(!state.canManage||!state.business)return;
  const {data,error}=await db.from('link_rrss_studio_projects').select('*').eq('business_id',state.business.id).neq('status','archived').order('updated_at',{ascending:false});
  if(error)throw error;
  state.studioProjects=data||[];
}

export function studioSection({state}){
  if(!state.canManage)return '<section class="empty-apparatus small"><span class="eyebrow">MAR</span><h1>Producción de LINKRRSS.</h1><p>Inicia sesión como miembro LINK para trabajar aquí.</p></section>';
  const rows=state.studioProjects||[];
  const cards=rows.length?rows.map(p=>{
    const d=p.editor_state||{}; const result=d.copy||d.result||'MAR está preparando el resultado.';
    return `<article class="studio-project"><div><span>${esc(p.channel||'LINKRRSS')}</span><i>${esc(p.status)}</i></div><h3>${esc(p.name)}</h3><p>${esc(p.brief||'Pedido a MAR')}</p>${p.status==='review'? `<blockquote>${esc(result)}</blockquote>`:''}<footer><small>${esc(p.updated_at?new Date(p.updated_at).toLocaleString('es-CL'):'')}</small><b>${p.status==='review'?'Listo para revisar':'En proceso'}</b></footer></article>`;
  }).join(''):'<div class="studio-empty"><b>Aún no hay pedidos.</b><span>Escribe lo que necesitas como se lo pedirías a una persona.</span></div>';
  return `<section class="link-studio">
    <header class="studio-hero mar-simple"><div><span class="eyebrow">LINKDOT MAR · ${esc(state.business?.name||'LINKRRSS')}</span><h1>¿Qué hacemos?</h1><p>Dime el resultado que necesitas. MAR organiza el resto del ecosistema.</p></div></header>
    <form class="mar-request" id="mar-request">
      <textarea id="mar-instruction" rows="4" placeholder="Ej: Con estas fotos haz una publicación para este sábado. Que se vea natural y déjala lista para revisar." required></textarea>
      <div class="mar-request-actions"><label class="mar-attach">＋ Adjuntar material<input id="mar-files" type="file" accept="image/*,video/*,audio/*" multiple hidden></label><span id="mar-file-count">Sin archivos adjuntos</span><button type="submit">Enviar a MAR</button></div>
    </form>
    <div class="mar-promise"><span>MAR entiende</span><i>→</i><span>coordina LINKRRSS</span><i>→</i><span>te muestra el resultado</span></div>
    <section class="studio-projects"><header><div><span class="eyebrow">TRABAJOS RECIENTES</span><h2>${esc(state.business?.name||'Negocio')}</h2></div><b>${rows.length}</b></header><div class="studio-grid">${cards}</div></section>
  </section>`;
}

export function bindStudio({state,db,renderApp,toast}){
  const files=document.querySelector('#mar-files'), count=document.querySelector('#mar-file-count'), form=document.querySelector('#mar-request');
  if(files)files.onchange=()=>{const n=files.files?.length||0;count.textContent=n?`${n} archivo${n===1?'':'s'} listo${n===1?'':'s'}`:'Sin archivos adjuntos';};
  if(!form)return;
  form.onsubmit=async(e)=>{
    e.preventDefault(); const instruction=document.querySelector('#mar-instruction')?.value?.trim(); if(!instruction)return;
    const submit=form.querySelector('button[type=submit]');submit.disabled=true;
    const attached=[...(files?.files||[])].map(f=>({name:f.name,type:f.type,size:f.size,status:'pending_ingestion'}));
    const {data,error}=await db.from('link_rrss_studio_projects').insert({
      business_id:state.business.id,name:instruction.slice(0,72),intent:'adapt',status:'draft',aspect_ratio:'9:16',
      brief:instruction,editor_state:{request:instruction,automation_mode:'instruction_only',attachments:attached,pipeline:['MAR entiende','recupera contexto','coordina SubDots','produce','presenta resultado','aprobación','publicación','métricas']},
      brand_contract:{business_id:state.business.id},source_adapter:'mar'
    }).select('id').single();
    if(error){toast(error.message||String(error),true);submit.disabled=false;return;}
    if(attached.length){
      const rows=attached.map((a,i)=>({project_id:data.id,asset_type:a.type.startsWith('video/')?'video':a.type.startsWith('audio/')?'audio':'image',name:a.name,original_name:a.name,mime_type:a.type,size_bytes:a.size,ingestion_status:'pending',sort_order:(i+1)*10,metadata:{source:'browser_attachment',needs_ingestion:true}}));
      const {error:ae}=await db.from('link_rrss_studio_assets').insert(rows); if(ae)toast('Pedido guardado; material pendiente de absorción.',true);
    }
    await loadStudio({state,db});toast('MAR recibió el pedido.');renderApp();
  };
}
