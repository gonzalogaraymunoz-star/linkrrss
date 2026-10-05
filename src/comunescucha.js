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
  const translating=state.translationLoading?.[id];
  const translateOn=Boolean(state.translateDimension);
  const language=state.translateLanguage||'original';
  const translated=state.conversationTranslations?.[id]||{};
  const languageLabel={original:'Original',es:'Español',pt:'Português',en:'English'}[language]||language;
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
      '<div class="ce-thread-actions"><button class="ce-translate-entry '+(translateOn?'active':'')+'" data-translate-dimension="'+esc(id)+'"><span>文</span>'+(translateOn?'Salir de Translate':'Dimensión Translate')+'</button><span class="ce-listener">ComunEscucha</span><label>Estado<select data-conversation-status="'+esc(id)+'"><option value="pending" '+(status==='pending'?'selected':'')+'>Por responder</option><option value="open" '+(status==='open'?'selected':'')+'>En curso</option><option value="resolved" '+(status==='resolved'?'selected':'')+'>Resuelta</option></select></label>'+(Number(row.unread_count||0)>0?'<button data-mark-read="'+esc(id)+'">Marcar leído</button>':'')+'</div>'+
    '</header>'+
    (translateOn?'<div class="ce-translate-dimension"><div><span class="eyebrow">LINK · TRANSLATE</span><strong>Dimensión de traducción</strong><small>La evidencia original se conserva. Cambia de idioma sin salir del hilo.</small></div><div class="ce-language-tabs">'+['original','es','pt','en'].map(lang=>'<button data-translate-lang="'+lang+'" class="'+(language===lang?'active':'')+'">'+({original:'Original',es:'ES',pt:'PT',en:'EN'}[lang])+'</button>').join('')+'</div><span class="ce-translate-state">'+(translating?'Traduciendo…':languageLabel)+'</span></div>':'')+
    '<div class="ce-message-thread '+(translateOn?'translate-mode':'')+'">'+
      (loading?'<div class="ce-loading">Recuperando hilo…</div>':messages.length
        ? messages.map((m,index)=>{const text=translateOn&&language!=='original'?(translated?.[language]?.[index]||m.text):m.text;return '<div class="ce-message '+(m.outgoing?'outgoing':'incoming')+'"><p>'+esc(text)+'</p>'+(translateOn&&language!=='original'?'<span class="ce-original-peek">Original · '+esc(m.text)+'</span>':'')+'<small>'+esc(dateLabel(m.date))+'</small></div>';}).join('')
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
  const objections=Array.isArray(row.objections)?row.objections:[];
  const extracted=row.extracted_data&&typeof row.extracted_data==='object'?Object.entries(row.extracted_data).slice(0,10):[];
  const apparatus=row.suggested_apparatus_name||row.next_apparatus_key||'Por decidir';
  const mode=row.suggested_apparatus_mode||'draft';
  const who=row.person_name||row.participant_name||row.participant_username||'Contacto';
  const wants=row.request_summary||row.intent_label||intentLabels[row.intent_key]||'Por interpretar';
  const lastChange=row.last_message||'Sin cambio textual reciente registrado.';
  const confidence=row.confidence!==null&&row.confidence!==undefined?Math.round(Number(row.confidence)*100):null;
  const changedMeta=[
    row.source_message_count?row.source_message_count+' mensajes en contexto':null,
    row.last_activity_at?dateLabel(row.last_activity_at):null,
    row.needs_refresh?'requiere nueva lectura':null
  ].filter(Boolean).join(' · ');

  const abstraction=[
    {
      key:'QUIÉN',
      value:who,
      body:(row.platform||'RRSS')+' · '+(row.business_name||'Negocio')+(row.language?' · '+row.language:''),
      tone:'identity'
    },
    {
      key:'QUÉ QUIERE',
      value:row.intent_label||intentLabels[row.intent_key]||'Solicitud detectada',
      body:wants,
      chips:products,
      tone:'intent'
    },
    {
      key:'QUÉ SABEMOS',
      value:extracted.length?extracted.length+' datos estructurados':'Aún sin datos estructurados',
      evidence:extracted,
      tone:'known'
    },
    {
      key:'QUÉ CAMBIÓ',
      value:lastChange,
      body:changedMeta||'Último mensaje incorporado al estado de la conversación.',
      tone:'changed'
    },
    {
      key:'QUÉ ESTÁ EN DUDA',
      value:(objections.length+questions.length)?(objections.length+questions.length)+' punto(s) abierto(s)':'Sin dudas detectadas',
      chips:[...objections,...questions],
      tone:'doubt'
    },
    {
      key:'QUÉ FALTA',
      value:missing.length?missing.length+' dato(s) para avanzar':'Nada crítico detectado',
      chips:missing,
      tone:'missing'
    },
    {
      key:'QUÉ SIGUE',
      value:row.next_action||'Elegir el siguiente paso',
      body:'Destino sugerido: '+apparatus+' · '+(row.suggested_apparatus_kind||'resolución')+' · '+mode,
      tone:'next'
    }
  ];

  return '<aside class="ce-intelligence">'+
    '<div class="ce-side-title"><div><span class="eyebrow">COMUNESCUCHA</span><h2>Abstracción operativa</h2><p>Del hilo humano al estado accionable.</p></div><span class="ce-analysis-state '+esc(row.analysis_state||'queued')+'">'+esc(row.analysis_state==='ready'?'Listo':row.analysis_state==='manual_review'?'Revisar':'Procesando')+'</span></div>'+
    '<section class="ce-abstraction-protocol">'+
      abstraction.map((item,index)=>'<article class="ce-abstraction-step '+esc(item.tone)+'">'+
        '<div class="ce-step-index">'+(index+1)+'</div>'+
        '<div class="ce-step-copy"><span class="ce-info-label">'+esc(item.key)+'</span><strong>'+esc(item.value)+'</strong>'+
          (item.body?'<p>'+esc(item.body)+'</p>':'')+
          (item.evidence?.length?'<div class="ce-chip-row evidence">'+item.evidence.map(([k,v])=>'<span class="ce-chip evidence">'+esc(k)+': '+esc(textOf(v))+'</span>').join('')+'</div>':'')+
          (item.chips?.length?'<div class="ce-chip-row">'+chips(item.chips,item.tone==='missing'||item.tone==='doubt'?'missing':item.tone==='intent'?'product':'')+'</div>':'')+
        '</div>'+
      '</article>').join('')+
    '</section>'+
    '<section class="ce-info-grid">'+
      '<div><span class="ce-info-label">ESTADO</span><strong>'+esc(attentionLabels[row.attention_state]||'Seguimiento')+'</strong></div>'+
      '<div><span class="ce-info-label">PRIORIDAD</span><strong>'+esc(String(row.priority??50))+'/100</strong></div>'+
      '<div><span class="ce-info-label">ETAPA</span><strong>'+esc(row.commercial_stage||'unknown')+'</strong></div>'+
      '<div><span class="ce-info-label">CONFIANZA</span><strong>'+(confidence===null?'—':esc(String(confidence))+'%')+'</strong></div>'+
    '</section>'+
    '<section class="ce-info-card specialist">'+
      '<span class="ce-info-label">ESPECIALISTA DEL NEGOCIO</span>'+
      '<strong class="ce-big">'+esc(row.specialist_name||'Sin asignar')+'</strong>'+
      '<p>'+esc(profile.goal||'Resolver la solicitud usando el criterio y conocimiento verificado del negocio.')+'</p>'+
      '<div class="ce-specialist-meta"><span>Tono</span><b>'+esc(profile.tone||'definido por negocio')+'</b><span>Autonomía</span><b>'+esc(row.autonomy_policy?.outbound_message==='human_approval_required'?'Aprobación humana':'Configurable')+'</b></div>'+
    '</section>'+
    '<section class="ce-info-card apparatus">'+
      '<span class="ce-info-label">HANDOFF</span>'+
      '<div class="ce-apparatus-row"><span>↗</span><div><strong>'+esc(apparatus)+'</strong><small>'+esc(row.suggested_apparatus_kind||'resolución')+' · '+esc(mode)+'</small></div></div>'+
      '<p>'+esc(row.next_action||'Interpretar la solicitud y elegir el siguiente paso.')+'</p>'+
    '</section>'+
  '</aside>';
}

function deepSearchMarkup(state){
  const q=String(state.conversationDeepSearchQuery||'');
  const rows=state.conversationDeepSearchResults||[];
  const loading=Boolean(state.conversationDeepSearchLoading);
  const error=state.conversationDeepSearchError||'';
  return '<section class="ce-deep-search-panel">'+
    '<form id="ce-deep-search-form" class="ce-deep-search-form">'+
      '<div><span class="eyebrow">BUSCADOR TRANSVERSAL</span><strong>Buscar dentro de todas las conversaciones</strong><small>Busca palabras dentro de los mensajes guardados de este negocio.</small></div>'+
      '<label><span>⌕</span><input id="ce-deep-search" value="'+esc(q)+'" placeholder="Ej: Yasmeen, Piedras Rojas, alergia, pago, pickup…"></label>'+
      '<button type="submit">'+(loading?'Buscando…':'Buscar')+'</button>'+
      (q?'<button type="button" id="ce-deep-search-clear" class="ghost">Limpiar</button>':'')+
    '</form>'+
    (error?'<div class="ce-deep-search-error">'+esc(error)+'</div>':'')+
    (q&&!loading?'<div class="ce-deep-search-meta"><strong>'+rows.length+' coincidencia'+(rows.length===1?'':'s')+'</strong><span>en mensajes guardados</span></div>':'')+
    (rows.length?'<div class="ce-deep-search-results">'+rows.map(r=>'<button class="ce-deep-result" data-ce-search-result="'+esc(r.external_conversation_id)+'" data-account-id="'+esc(r.account_id||'')+'">'+
      '<span class="ce-platform-dot">'+esc(platformMark(r.platform))+'</span><div><strong>'+esc(r.participant_name||'Contacto')+'</strong><p>'+esc(r.message||'')+'</p><small>'+esc(dateLabel(r.platform_created_at||r.created_at))+' · '+esc(r.direction||'mensaje')+'</small></div><b>→</b></button>').join('')+'</div>':'')+
  '</section>';
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
  const lastSync=state.lastInboxRefreshAt||state.workspace?.last_full_sync_at||null;
  const refreshLabel=state.inboxRefreshing?'Actualizando…':'Actualizar ahora';
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
      '<label class="ce-search"><span>⌕</span><input id="ce-search" value="'+esc(state.conversationQuery||'')+'" placeholder="Filtrar fichas por nombre, teléfono, tour o estado"></label>'+
      '<select id="ce-channel"><option value="all">Todos los canales</option>'+channels.map(c=>'<option value="'+esc(c)+'" '+(state.conversationChannel===c?'selected':'')+'>'+esc(c[0].toUpperCase()+c.slice(1))+'</option>').join('')+'</select>'+
      '<div class="ce-live-sync">'+
        '<button id="ce-refresh" class="'+(state.inboxRefreshing?'refreshing':'')+'" '+(state.inboxRefreshing?'disabled':'')+'><span>↻</span>'+esc(refreshLabel)+'</button>'+
        '<small><i></i>'+(lastSync?'Última sync '+esc(dateLabel(lastSync)):'Sin sincronizar aún')+' · auto 20 s</small>'+
      '</div>'+
      '<span class="ce-business-pill">'+esc(state.business?.name||'Negocio')+'</span>'+
    '</div>'+
    deepSearchMarkup(state)+
    '<div class="ce-tabbar">'+tabs.map(([key,label,count])=>'<button data-ce-state="'+esc(key)+'" class="'+((state.conversationFilter||'all')===key?'active':'')+'"><span>'+esc(label)+'</span><b>'+count+'</b></button>').join('')+'</div>'+
    '<div class="comunescucha-shell">'+
      '<aside class="ce-list">'+
        '<div class="ce-list-head"><div><strong>'+rows.length+' conversaciones</strong><small>ordenadas por atención y actividad</small></div><span>'+stats.reply+' por responder</span></div>'+
        '<div class="ce-list-scroll">'+(rows.length?rows.map(r=>conversationCard(r,selected?.conversation_id===r.conversation_id)).join(''):'<div class="ce-list-empty">No hay conversaciones con estos filtros.</div>')+'</div>'+
      '</aside>'+
      '<div class="ce-resizer left" data-ce-resizer="left" role="separator" aria-label="Ajustar ancho de lista" title="Arrastra para cambiar el ancho · doble clic para restablecer"></div>'+
      threadMarkup(state,selected)+
      '<div class="ce-resizer right" data-ce-resizer="right" role="separator" aria-label="Ajustar ancho de inteligencia" title="Arrastra para cambiar el ancho · doble clic para restablecer"></div>'+
      intelligenceMarkup(selected)+
    '</div>'+
    '<footer class="ce-flow"><span><b>1</b>Mensaje</span><i>→</i><span><b>2</b>ComunEscucha</span><i>→</i><span><b>3</b>Especialista</span><i>→</i><span><b>4</b>Aparato</span><i>→</i><span><b>5</b>Respuesta</span><i>→</i><span><b>6</b>Feedback</span></footer>'+
  '</section>';
}
