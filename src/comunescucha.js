const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const dateLabel = v => {
  if(!v) return '—';
  const d=new Date(v);
  if(Number.isNaN(d.getTime())) return '—';
  const now=Date.now(), diff=now-d.getTime();
  if(diff<60000) return 'Ahora';
  if(diff<3600000) return 'Hace '+Math.max(1,Math.round(diff/60000))+' min';
  if(diff<86400000) return 'Hace '+Math.round(diff/3600000)+' h';
  return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short'});
};

const attentionLabels={
  por_responder:'Por responder',
  entendiendo:'Entendiendo',
  listo_para_resolver:'Listo para resolver',
  requiere_humano:'Requiere humano',
  esperando_cliente:'Esperando cliente',
  seguimiento:'Seguimiento',
  error:'Error'
};

const intentLabels={
  commercial_inquiry:'Consulta comercial',
  payment_or_confirmation:'Pago / confirmación',
  operation_request:'Operación',
  supplier_or_operator:'Proveedor / operador',
  post_sale:'Postventa',
  general_contact:'Contacto general'
};

function arr(value){
  if(Array.isArray(value)) return value;
  if(value && typeof value==='object') return Object.entries(value).filter(([,v])=>v!==null&&v!==''&&v!==false).map(([k,v])=>({key:k,value:v}));
  return [];
}
function textOf(v){
  if(v===null||v===undefined) return '';
  if(typeof v==='string') return v;
  if(typeof v==='number'||typeof v==='boolean') return String(v);
  return JSON.stringify(v);
}
function normalizeMessages(payload){
  const list=Array.isArray(payload)?payload:(payload?.data||payload?.messages||[]);
  if(!Array.isArray(list)) return [];
  return list.map(m=>({
    outgoing:Boolean(m.outgoing??m.isOutgoing??m.direction==='outgoing'??m.fromMe),
    text:m.text||m.message||m.content||m.body||'[Adjunto]',
    date:m.createdAt||m.createdTime||m.timestamp||m.sentAt||m.platform_created_at||m.created_at||null
  })).sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));
}
function platformMark(platform=''){
  const p=String(platform).toLowerCase();
  return p==='whatsapp'?'WA':p==='instagram'?'IG':p==='facebook'?'FB':p==='tiktok'?'TT':p.slice(0,2).toUpperCase()||'RR';
}
function statusFromWorkspace(state,row){
  const external=row.external_conversation_id;
  const saved=state.workspace?.ui_state?.conversation_status?.[external];
  if(saved) return saved;
  if(row.attention_state==='por_responder') return 'pending';
  if(row.source_status==='closed'||row.attention_state==='esperando_cliente') return 'resolved';
  return 'open';
}
function statusLabel(status){
  return ({pending:'Por responder',open:'En curso',resolved:'Resuelta'})[status]||status;
}
function chips(values=[],kind=''){
  const list=arr(values).slice(0,6);
  return list.map(v=>{
    const label=typeof v==='object' && v && 'key' in v ? (v.key+': '+textOf(v.value)) : textOf(v);
    return '<span class="ce-chip '+kind+'">'+esc(label)+'</span>';
  }).join('');
}
function filteredRows(state){
  let rows=(state.conversationControl||[]).filter(r=>r.business_id===state.business?.id);
  const q=String(state.conversationQuery||'').trim().toLowerCase();
  const channel=state.conversationChannel||'all';
  const attention=state.conversationFilter||'all';
  if(channel!=='all') rows=rows.filter(r=>String(r.platform||'').toLowerCase()===channel);
  if(attention!=='all') rows=rows.filter(r=>r.attention_state===attention);
  if(q){
    rows=rows.filter(r=>{
      const hay=[
        r.participant_name,r.participant_username,r.last_message,r.request_summary,r.intent_label,
        r.context_md,r.summary_md,r.source_digest_md,r.specialist_name,r.next_apparatus_key,
        ...(Array.isArray(r.products)?r.products:[])
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return rows;
}
function topStats(rows){
  const count=k=>rows.filter(r=>r.attention_state===k).length;
  return {
    total:rows.length,
    reply:count('por_responder'),
    understanding:count('entendiendo'),
    ready:count('listo_para_resolver'),
    human:count('requiere_humano')
  };
}
function conversationCard(row,selected){
  const products=Array.isArray(row.products)?row.products:[];
  const unread=Number(row.unread_count||0);
  return '<button class="ce-conversation-card '+(selected?'active':'')+'" data-conversation="'+esc(row.external_conversation_id)+'" data-conversation-account="'+esc(row.account_id)+'">'+
    '<span class="ce-avatar">'+(row.participant_picture?'<img src="'+esc(row.participant_picture)+'" alt="">':esc((row.participant_name||row.participant_username||'?').slice(0,1).toUpperCase()))+'</span>'+
    '<span class="ce-card-copy">'+
      '<span class="ce-card-line"><strong>'+esc(row.participant_name||row.participant_username||'Contacto')+'</strong><small>'+esc(dateLabel(row.last_activity_at))+'</small></span>'+
      '<span class="ce-card-meta"><b>'+esc(platformMark(row.platform))+'</b> '+esc(row.platform||'RRSS')+(unread?'<em>'+unread+'</em>':'')+'</span>'+
      '<p>'+esc(row.request_summary||row.last_message||'Conversación')+'</p>'+
      '<span class="ce-card-tags">'+chips(products.slice(0,3),'product')+'</span>'+
    '</span>'+
    '<span class="ce-attention '+esc(row.attention_state||'seguimiento')+'">'+esc(attentionLabels[row.attention_state]||'Seguimiento')+'</span>'+
  '</button>';
}
function emptyPanel(){
  return '<section class="ce-thread-empty"><div class="ce-orbit"><span></span><b>CE</b></div><strong>Selecciona una conversación</strong><p>ComunEscucha ya ordenó la bandeja. Abre un contacto para ver el hilo, la interpretación y el especialista asignado.</p></section>';
}
function threadMarkup(state,row){
  if(!row) return emptyPanel();
  const id=String(row.external_conversation_id);
  const messages=normalizeMessages(state.conversationMessages?.[id]);
  const loading=state.conversationLoading?.[id];
  const status=statusFromWorkspace(state,row);
  const quick=[
    ['Qué está pidiendo','Resume la solicitud actual y dime qué falta para resolverla.'],
    ['Preparar respuesta','Prepara una respuesta con el criterio del especialista del negocio.'],
    ['Pedir dato faltante','Identifica el dato mínimo que falta y redacta una sola pregunta.'],
    ['Resolver','Indica qué aparato debe resolver esta solicitud y qué necesita para hacerlo.']
  ];
  return '<section class="ce-thread">'+
    '<header class="ce-thread-head">'+
      '<div class="ce-thread-person"><span class="ce-avatar large">'+(row.participant_picture?'<img src="'+esc(row.participant_picture)+'" alt="">':esc((row.participant_name||row.participant_username||'?').slice(0,1).toUpperCase()))+'</span><div><strong>'+esc(row.participant_name||row.participant_username||'Contacto')+'</strong><small>'+esc(row.platform||'RRSS')+' · '+esc(row.account_username||'cuenta')+'</small></div></div>'+
      '<div class="ce-thread-actions"><span class="ce-listener">ComunEscucha</span><label>Estado<select data-conversation-status="'+esc(id)+'"><option value="pending" '+(status==='pending'?'selected':'')+'>Por responder</option><option value="open" '+(status==='open'?'selected':'')+'>En curso</option><option value="resolved" '+(status==='resolved'?'selected':'')+'>Resuelta</option></select></label>'+(Number(row.unread_count||0)>0?'<button data-mark-read="'+esc(id)+'">Marcar leído</button>':'')+'</div>'+
    '</header>'+
    '<div class="ce-message-thread">'+
      (loading?'<div class="ce-loading">Recuperando hilo…</div>':messages.length
        ? messages.map(m=>'<div class="ce-message '+(m.outgoing?'outgoing':'incoming')+'"><p>'+esc(m.text)+'</p><small>'+esc(dateLabel(m.date))+'</small></div>').join('')
        : '<div class="ce-loading"><strong>Hilo guardado</strong><span>'+esc(row.last_message||'Sin vista previa')+'</span><small>LINK abrirá el historial completo al seleccionar esta conversación.</small></div>')+
    '</div>'+
    '<div class="ce-workbench">'+
      '<div class="ce-workbench-head"><div><span class="eyebrow">MESA DE TRABAJO</span><strong>Trabaja esta conversación con LINK</strong></div><span class="ce-specialist-mini">'+esc(row.specialist_name||'Especialista pendiente')+'</span></div>'+
      '<div class="ce-quick-actions">'+quick.map(([label,prompt])=>'<button data-ce-prompt="'+esc(prompt)+'">'+esc(label)+'</button>').join('')+'</div>'+
      '<textarea id="ce-work-input" rows="2" placeholder="Escribe qué quieres resolver con esta conversación…"></textarea>'+
      '<div class="ce-workbench-note"><span>Esta caja prepara el trabajo del especialista; no envía nada al cliente todavía.</span><button id="ce-copy-work">Copiar instrucción</button></div>'+
    '</div>'+
    '<form class="ce-reply" data-reply-form="'+esc(id)+'">'+
      '<label>Respuesta al cliente<textarea id="conversation-reply" rows="3" placeholder="Revisa o escribe la respuesta final…"></textarea></label>'+
      '<div><small>Salida: '+esc(row.platform||'RRSS')+' mediante Zernio · requiere aprobación humana</small><button class="primary" type="submit">Enviar respuesta</button></div>'+
    '</form>'+
  '</section>';
}
function intelligenceMarkup(row){
  if(!row) return '<aside class="ce-intelligence empty"><span class="eyebrow">INTELIGENCIA</span><p>Selecciona una conversación.</p></aside>';
  const profile=row.response_profile||{};
  const products=Array.isArray(row.products)?row.products:[];
  const missing=Array.isArray(row.missing_data)?row.missing_data:[];
  const questions=Array.isArray(row.unresolved_questions)?row.unresolved_questions:[];
  const extracted=row.extracted_data&&typeof row.extracted_data==='object'?Object.entries(row.extracted_data).slice(0,8):[];
  const apparatus=row.suggested_apparatus_name||row.next_apparatus_key||'Por decidir';
  const mode=row.suggested_apparatus_mode||'draft';
  return '<aside class="ce-intelligence">'+
    '<div class="ce-side-title"><div><span class="eyebrow">COMUNESCUCHA</span><h2>Lo que entendió LINK</h2></div><span class="ce-analysis-state '+esc(row.analysis_state||'queued')+'">'+esc(row.analysis_state==='ready'?'Listo':row.analysis_state==='manual_review'?'Revisar':'Procesando')+'</span></div>'+
    '<section class="ce-info-card">'+
      '<span class="ce-info-label">CONTACTO</span>'+
      '<div class="ce-contact-line"><span class="ce-avatar">'+esc((row.participant_name||row.participant_username||'?').slice(0,1).toUpperCase())+'</span><div><strong>'+esc(row.participant_name||row.participant_username||'Contacto')+'</strong><small>'+esc(row.platform||'RRSS')+' · '+esc(row.business_name||'Negocio')+'</small></div></div>'+
    '</section>'+
    '<section class="ce-info-card accent">'+
      '<span class="ce-info-label">SOLICITUD DETECTADA</span>'+
      '<strong class="ce-big">'+esc(row.intent_label||intentLabels[row.intent_key]||'Por interpretar')+'</strong>'+
      '<p>'+esc(row.request_summary||row.last_message||'Aún sin resumen especializado.')+'</p>'+
      '<div class="ce-chip-row">'+chips(products,'product')+'</div>'+
    '</section>'+
    '<section class="ce-info-grid">'+
      '<div><span class="ce-info-label">ESTADO</span><strong>'+esc(attentionLabels[row.attention_state]||'Seguimiento')+'</strong></div>'+
      '<div><span class="ce-info-label">PRIORIDAD</span><strong>'+esc(String(row.priority??50))+'/100</strong></div>'+
      '<div><span class="ce-info-label">IDIOMA</span><strong>'+esc(row.language||'Detectar')+'</strong></div>'+
      '<div><span class="ce-info-label">ETAPA</span><strong>'+esc(row.commercial_stage||'unknown')+'</strong></div>'+
    '</section>'+
    '<section class="ce-info-card">'+
      '<span class="ce-info-label">ENCONTRADO EN LA CONVERSACIÓN</span>'+
      '<div class="ce-chip-row evidence">'+(extracted.length?extracted.map(([k,v])=>'<span class="ce-chip evidence">'+esc(k)+': '+esc(textOf(v))+'</span>').join(''):'<span class="ce-muted">Sin datos estructurados todavía.</span>')+'</div>'+
    '</section>'+
    ((missing.length||questions.length)?'<section class="ce-info-card warning"><span class="ce-info-label">PENDIENTE</span><div class="ce-chip-row">'+chips(missing,'missing')+chips(questions,'missing')+'</div></section>':'')+
    '<section class="ce-info-card specialist">'+
      '<span class="ce-info-label">ESPECIALISTA DEL NEGOCIO</span>'+
      '<strong class="ce-big">'+esc(row.specialist_name||'Sin asignar')+'</strong>'+
      '<p>'+esc(profile.goal||'Resolver la solicitud usando el criterio y conocimiento verificado del negocio.')+'</p>'+
      '<div class="ce-specialist-meta"><span>Tono</span><b>'+esc(profile.tone||'definido por negocio')+'</b><span>Autonomía</span><b>'+esc(row.autonomy_policy?.outbound_message==='human_approval_required'?'Aprobación humana':'Configurable')+'</b></div>'+
    '</section>'+
    '<section class="ce-info-card apparatus">'+
      '<span class="ce-info-label">APARATO SUGERIDO</span>'+
      '<div class="ce-apparatus-row"><span>↗</span><div><strong>'+esc(apparatus)+'</strong><small>'+esc(row.suggested_apparatus_kind||'resolución')+' · '+esc(mode)+'</small></div></div>'+
      '<p>'+esc(row.next_action||'Interpretar la solicitud y elegir el siguiente paso.')+'</p>'+
    '</section>'+
  '</aside>';
}

export function comunEscuchaSection({state}){
  if(!state.canManage){
    return '<section class="section-heading compact"><div><span class="eyebrow">COMUNESCUCHA</span><h1>Conversaciones</h1><p>La memoria social es privada. Entra en modo Administración para leer, clasificar y responder.</p></div></section>';
  }
  const all=(state.conversationControl||[]).filter(r=>r.business_id===state.business?.id);
  const rows=filteredRows(state);
  const stats=topStats(all);
  const selected=all.find(r=>String(r.external_conversation_id)===String(state.selectedConversationId))||null;
  const channels=[...new Set(all.map(r=>String(r.platform||'').toLowerCase()).filter(Boolean))].sort();
  const tabs=[
    ['all','Todas',stats.total],
    ['por_responder','Por responder',stats.reply],
    ['entendiendo','Entendiendo',stats.understanding],
    ['listo_para_resolver','Listas',stats.ready],
    ['requiere_humano','Humano',stats.human],
    ['esperando_cliente','Esperando',all.filter(r=>r.attention_state==='esperando_cliente').length]
  ];

  return '<section class="comunescucha-page">'+
    '<header class="ce-hero">'+
      '<div><span class="eyebrow">LINKRRSS / COMUNESCUCHA</span><h1>Conversaciones</h1><p>Escucha, ordena y enruta conversaciones de '+esc(state.business?.name||'este negocio')+'. La conversación original sigue siendo la evidencia.</p></div>'+
      '<div class="ce-pulse"><span></span><div><strong>ComunEscucha activo</strong><small>evento → ficha → especialista</small></div></div>'+
    '</header>'+
    '<div class="ce-toolbar">'+
      '<label class="ce-search"><span>⌕</span><input id="ce-search" value="'+esc(state.conversationQuery||'')+'" placeholder="Buscar nombre, teléfono, palabra, tour o solicitud"></label>'+
      '<select id="ce-channel"><option value="all">Todos los canales</option>'+channels.map(c=>'<option value="'+esc(c)+'" '+(state.conversationChannel===c?'selected':'')+'>'+esc(c[0].toUpperCase()+c.slice(1))+'</option>').join('')+'</select>'+
      '<span class="ce-business-pill">'+esc(state.business?.name||'Negocio')+'</span>'+
    '</div>'+
    '<div class="ce-tabbar">'+tabs.map(([key,label,count])=>'<button data-ce-state="'+esc(key)+'" class="'+((state.conversationFilter||'all')===key?'active':'')+'"><span>'+esc(label)+'</span><b>'+count+'</b></button>').join('')+'</div>'+
    '<div class="comunescucha-shell">'+
      '<aside class="ce-list">'+
        '<div class="ce-list-head"><div><strong>'+rows.length+' conversaciones</strong><small>ordenadas por atención y actividad</small></div><span>'+stats.reply+' por responder</span></div>'+
        '<div class="ce-list-scroll">'+(rows.length?rows.map(r=>conversationCard(r,selected?.conversation_id===r.conversation_id)).join(''):'<div class="ce-list-empty">No hay conversaciones con estos filtros.</div>')+'</div>'+
      '</aside>'+
      threadMarkup(state,selected)+
      intelligenceMarkup(selected)+
    '</div>'+
    '<footer class="ce-flow"><span><b>1</b>Mensaje</span><i>→</i><span><b>2</b>ComunEscucha</span><i>→</i><span><b>3</b>Especialista</span><i>→</i><span><b>4</b>Aparato</span><i>→</i><span><b>5</b>Respuesta</span><i>→</i><span><b>6</b>Feedback</span></footer>'+
  '</section>';
}
