import {LAMA_BUSINESS_ID,FIELD_KEYS,unknownFields,readSelectedSources,saveReviewedDraft,listIntakeRequests,submitIntakeToCRM} from './intake-client.js';
const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={service:'Servicio / tramo',date:'Fecha solicitada',pax:'Pasajeros',language:'Idioma',pickup:'Recogida'};
export const intakeSessionKey=row=>[row.business_id,row.account_id,row.conversation_id].join(':');
export function intakeSession(state,row){state.intakeReviews??={};return state.intakeReviews[intakeSessionKey(row)]??={messages:[],selected:[],fields:unknownFields(),snapshot:null,requestKey:null,expectedDraftRevision:null,requestKind:'tour_request',status:'',busy:false,loaded:false,requests:[],directReviewed:false,requestReviewed:false,newReviewed:false,crmReviewed:false,inboxId:null,leadId:null};}
const optionSources=(s,f)=>s.snapshot.sources.map((m,i)=>'<option value="'+esc(m.message_id)+'" '+(f.source_message_ids.includes(m.message_id)?'selected':'')+'>'+esc((i+1)+'. '+(m.text||'[Adjunto pendiente]').slice(0,100))+'</option>').join('');
export function intakeReviewMarkup(state,row){
 if(row?.business_id!==LAMA_BUSINESS_ID||row.platform!=='whatsapp')return '';
 const s=intakeSession(state,row),disabled=s.busy?'disabled':'';
 const requests=s.requests.filter(r=>r.source_conversation_id===row.conversation_id);
 return '<section class="ce-info-card ce-intake-review" data-intake-review><h3>Captación LAMA → CRM</h3><p>Revisión de mensajes guardados. No envía respuestas ni cobros y no confirma reservas.</p><button type="button" data-intake-load '+disabled+'>Leer mensajes y captaciones</button><p role="status">'+esc(s.status)+'</p>'+
 (requests.length?'<details><summary>Solicitudes de este chat ('+requests.length+')</summary>'+requests.map(r=>'<button type="button" data-intake-open="'+esc(r.id)+'" '+disabled+'>'+esc((r.review?.intake_draft_v1||r.review?.intake_auto_v1)?.request_kind)+' · '+esc(r.review?.machine_generated&&!r.review?.human_reviewed?'Automática, pendiente de revisión':'Revisada')+' · '+esc(r.status==='converted'?'En CRM':r.review?.intake_needs_review?'Revisar cambios':'Borrador')+' · '+esc(r.created_at)+'</button>').join('')+'</details>':'')+
 '<button type="button" data-intake-new '+disabled+'>Nueva solicitud independiente</button>'+
 (s.loaded?'<p>Hasta 50 mensajes recientes guardados; no garantiza historial completo. Adjuntos y audios pendientes no equivalen a datos verificados.</p><div class="ce-intake-sources">'+s.messages.map(m=>'<label><input type="checkbox" data-intake-source value="'+esc(m.id)+'" '+(s.selected.includes(m.id)?'checked':'')+' '+disabled+'><span>'+esc(m.direction)+' · '+esc(m.platform_created_at||m.created_at)+'<br>'+esc(m.message||'[Sin texto: adjunto pendiente]')+(m.attachments?.length?'<br>Adjunto pendiente de lectura':'')+'</span></label>').join('')+'</div><button type="button" data-intake-snapshot '+(s.busy||!s.selected.length?'disabled':'')+'>Revisar selección</button>':'')+
 (s.snapshot?'<p>Revisión de fuente '+esc(s.snapshot.source_revision)+'. Solo mensajes seleccionados; datos propuestos, no reserva confirmada.</p><label>Tipo<select data-intake-kind>'+[['tour_request','Solicitud de tour'],['confirmation_request','Solicitud de confirmación'],['other_request','Otra solicitud']].map(([v,l])=>'<option value="'+v+'" '+(s.requestKind===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
 FIELD_KEYS.map(key=>{const f=s.fields[key];return '<fieldset data-intake-field="'+key+'"><legend>'+labels[key]+'</legend><select data-intake-field-state>'+[['unknown','Desconocido'],['proposed','Propuesto'],['conflict','En conflicto']].map(([v,l])=>'<option value="'+v+'" '+(f.state===v?'selected':'')+'>'+l+'</option>').join('')+'</select><input type="text" maxlength="600" aria-label="'+labels[key]+'" data-intake-value value="'+esc(f.value??'')+'"><label>Mensajes fuente<select multiple size="3" data-intake-field-sources>'+optionSources(s,f)+'</select></label></fieldset>'}).join('')+
 '<label><input type="checkbox" data-intake-direct '+(s.directReviewed?'checked':'')+'>Revisé que es un chat directo de LAMA</label><label><input type="checkbox" data-intake-real '+(s.requestReviewed?'checked':'')+'>Estos mensajes forman una solicitud real, no un saludo o prueba</label>'+
 (s.expectedDraftRevision===null?'<label><input type="checkbox" data-intake-new-reviewed '+(s.newReviewed?'checked':'')+'>Es una solicitud independiente, no la repetición de una ya captada</label>':'')+
 '<button type="button" data-intake-save '+disabled+'>Guardar borrador revisado</button>':'')+
 (s.inboxId&&!s.leadId&&!s.snapshot&&!s.dirty?'<p>Borrador guardado: '+esc(s.inboxId)+'</p><label><input type="checkbox" data-intake-crm-reviewed '+(s.crmReviewed?'checked':'')+'>Revisé esta captación para incorporarla al CRM como consulta, sin confirmar reserva</label>'+(s.leadChoices?.length?'<label>Varias oportunidades abiertas: selecciona la correcta<select data-intake-existing><option value="">Selecciona</option>'+s.leadChoices.map(id=>'<option value="'+esc(id)+'">'+esc(id)+'</option>').join('')+'</select></label>':'')+'<button type="button" data-intake-submit '+disabled+'>Incorporar al CRM</button>':'')+
 (s.leadId?'<p>Registrada en CRM. Oportunidad: '+esc(s.leadId)+'. Sin cobro ni reserva confirmada.</p>':'')+'</section>';
}
function collect(root,s){
 s.selected=[...root.querySelectorAll('[data-intake-source]:checked')].map(x=>x.value);
 const kind=root.querySelector('[data-intake-kind]');if(kind)s.requestKind=kind.value;
 for(const el of root.querySelectorAll('[data-intake-field]')){const key=el.dataset.intakeField,state=el.querySelector('[data-intake-field-state]').value;s.fields[key]=state==='unknown'?{state,value:null,source_message_ids:[]}:{state,value:el.querySelector('[data-intake-value]').value,source_message_ids:[...el.querySelector('[data-intake-field-sources]').selectedOptions].map(x=>x.value)};}
 for(const [key,selector] of Object.entries({directReviewed:'direct',requestReviewed:'real',newReviewed:'new-reviewed',crmReviewed:'crm-reviewed'})){const el=root.querySelector('[data-intake-'+selector+']');if(el)s[key]=el.checked;}
 const existing=root.querySelector('[data-intake-existing]');if(existing)s.existingLeadId=existing.value||null;
}
const errors={identity_review_required:'La identidad necesita revisión: falta un nombre de persona verificado. La captación queda guardada; no se creó cliente ni venta. Revisa el contacto antes de intentar incorporarlo al CRM.',source_changed:'Llegó o cambió información. Vuelve a leer y revisar los mensajes.',draft_changed:'Otra revisión cambió este borrador. Ábrelo nuevamente.',duplicate_request:'La misma selección y datos ya están captados. Abre la solicitud existente; no se duplicó.',new_request_review_required:'Confirma que esta es una solicitud independiente.',request_not_editable:'La solicitud ya no es editable.',revision_history_limit:'Límite de revisiones alcanzado; no se descartó historia.',unresolved_conflict:'Hay datos en conflicto. Resuélvelos revisando fuentes antes de pasar al CRM.',multiple_leads:'Hay varias oportunidades abiertas de esta misma identidad. Selecciona la correcta.'};
export function bindIntakeReview({state,row,db,render,root=document}){
 if(row?.business_id!==LAMA_BUSINESS_ID)return;const panel=root.querySelector('[data-intake-review]');if(!panel)return;
 const s=intakeSession(state,row),key=intakeSessionKey(row);const redraw=()=>{if(state.business?.id===row.business_id&&state.selectedConversationId===row.external_conversation_id)render()};
 panel.addEventListener('input',e=>{collect(panel,s);if(e.target.closest('[data-intake-field]')){s.dirty=true;s.crmReviewed=false;}});panel.addEventListener('change',e=>{collect(panel,s);if(e.target.matches('[data-intake-source]')){s.snapshot=null;s.dirty=true;s.crmReviewed=false;s.directReviewed=false;s.requestReviewed=false;redraw()}});
 panel.addEventListener('click',async e=>{
 const action=e.target.closest('[data-intake-load],[data-intake-new],[data-intake-open],[data-intake-snapshot],[data-intake-save],[data-intake-submit]');if(!action||s.busy)return;collect(panel,s);s.busy=true;s.status='Revisando…';redraw();
 try{
  if(action.hasAttribute('data-intake-load')){
   const {data,error}=await db.from('link_rrss_messages').select('id,conversation_id,message,direction,platform_created_at,created_at,attachments').eq('conversation_id',row.conversation_id).order('platform_created_at',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).limit(51);if(error)throw error;
   s.messages=(data||[]).slice(0,50).reverse();s.loaded=true;s.requests=await listIntakeRequests(db);s.status=(data?.length>50?'Hay mensajes anteriores no mostrados. ':'')+'Selecciona mensajes de una solicitud o abre una captación existente.';
  }else if(action.hasAttribute('data-intake-new')){
   s.requestKey=crypto.randomUUID();s.expectedDraftRevision=null;s.inboxId=null;s.leadId=null;s.snapshot=null;s.selected=[];s.fields=unknownFields();s.directReviewed=false;s.requestReviewed=false;s.newReviewed=false;s.crmReviewed=false;s.status='Nueva solicitud independiente. Selecciona sus mensajes; no se mezclan captaciones anteriores.';
  }else if(action.hasAttribute('data-intake-open')){
   const r=s.requests.find(x=>x.id===action.dataset.intakeOpen);if(!r)throw Error('Captación no disponible');
   const auto=r.review.intake_auto_v1;const d=r.review.intake_draft_v1||(auto?{request_key:r.external_ref.replace('linkrrss-request:',''),draft_revision:0,request_kind:auto.request_kind,fields:Object.fromEntries(Object.entries(auto.fields).map(([k,f])=>[k,{state:f.state,value:f.value,source_message_ids:[...new Set(f.evidence.map(e=>e.message_id))]}])),message_ids:[...new Set([auto.anchor_message_id,...Object.values(auto.fields).flatMap(f=>f.evidence.map(e=>e.message_id))])]}:null);if(!d)throw Error('Formato no compatible');s.requestKey=d.request_key;s.expectedDraftRevision=d.draft_revision;s.requestKind=d.request_kind;s.fields=structuredClone(d.fields);s.inboxId=r.id;s.leadId=r.lead_id;s.selected=[...d.message_ids];s.directReviewed=false;s.requestReviewed=false;s.crmReviewed=false;
   if(r.status==='received'){s.snapshot=await readSelectedSources(db,row.conversation_id,d.message_ids,d.request_key);s.messages=s.snapshot.sources.map(m=>({id:m.message_id,message:m.text,direction:m.direction,platform_created_at:m.original_at,attachments:m.attachments}));s.loaded=true;s.status='Revisa esta misma solicitud y sus fuentes. Un cambio requiere guardar antes de incorporar al CRM.';}
   else{s.snapshot=null;s.status='Solicitud ya registrada en CRM; no se duplica ni se modifica desde aquí.';}
  }else if(action.hasAttribute('data-intake-snapshot')){
   s.requestKey??=crypto.randomUUID();s.snapshot=await readSelectedSources(db,row.conversation_id,s.selected,s.requestKey);s.directReviewed=false;s.requestReviewed=false;s.status='Revisa cada campo y sus mensajes fuente. Desconocido no significa completo.';
  }else if(action.hasAttribute('data-intake-save')){
   const out=await saveReviewedDraft(db,{snapshot:s.snapshot,requestKey:s.requestKey,requestKind:s.requestKind,fields:s.fields,expectedDraftRevision:s.expectedDraftRevision,directChatReviewed:s.directReviewed,requestReviewed:s.requestReviewed,newRequestReviewed:s.newReviewed});
   if(out.ok){s.dirty=false;s.inboxId=out.inbox_id;s.expectedDraftRevision=out.draft_revision;s.status='Borrador guardado. Revisa antes de incorporar al CRM.';s.snapshot=null;s.crmReviewed=false;s.requests=await listIntakeRequests(db);}
   else{s.status=errors[out.code]||'No se guardó: '+out.code;if(['source_changed','draft_changed'].includes(out.code))s.snapshot=null;}
  }else if(action.hasAttribute('data-intake-submit')){
   if(s.dirty||s.snapshot)throw Error('Guarda la revisión antes de incorporar al CRM');
   const out=await submitIntakeToCRM(db,{inboxId:s.inboxId,draftRevision:s.expectedDraftRevision,reviewed:s.crmReviewed,existingLeadId:s.existingLeadId});
   if(out.ok){s.leadId=out.lead_id;s.snapshot=null;s.status='Captación incorporada al CRM, conservando persona y fuentes. Sin cobro ni confirmación de reserva.';s.requests=await listIntakeRequests(db);}
   else{s.status=errors[out.code]||'No se incorporó: '+out.code;s.leadChoices=out.lead_ids||[];}
  }
 }catch(error){s.status='No se completó: '+String(error.message||error)+'. Verifica el estado antes de repetir; no hay reintentos automáticos.';}
 finally{s.busy=false;if(state.intakeReviews?.[key]===s)redraw();}
 });
}
