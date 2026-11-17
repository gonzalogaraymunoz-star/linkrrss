import {LAMA_BUSINESS_ID,listIntakeRequests} from './intake-client.js';
import {intakeSession,intakeReviewMarkup,bindIntakeReview} from './intake-review.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Scoped intake permission never becomes global administration permission.
export async function openIntakePortal(db,initial){
 const state={business:{id:LAMA_BUSINESS_ID},intakeReviews:{},selectedConversationId:null};let rows=initial,selected=null;
 const render=()=>{
  const row=selected?{business_id:LAMA_BUSINESS_ID,account_id:'e73576fe-3532-4dc6-b344-fa24f99f34dd',platform:'whatsapp',conversation_id:selected.source_conversation_id,external_conversation_id:selected.source_conversation_id}:null;
  if(row){state.selectedConversationId=row.external_conversation_id;const s=intakeSession(state,row);s.requests=rows;}
  document.querySelector('#app').innerHTML='<main style="max-width:960px;margin:30px auto;padding:20px"><h1>Captación LAMA</h1><p>Acceso limitado a captación. No concede administración global, no envía WhatsApp, no cobra ni confirma reservas.</p><button data-portal-refresh>Actualizar bandeja</button><p>'+rows.length+' solicitudes guardadas. Las automáticas esperan revisión humana.</p>'+rows.map(r=>'<button data-portal-open="'+esc(r.id)+'" style="display:block;margin:8px 0">'+esc(r.review?.intake_auto_v1?.fields?.service?.value||r.review?.intake_draft_v1?.fields?.service?.value||'Solicitud sin servicio definido')+' · '+esc(r.review?.human_reviewed?'Revisada':'Pendiente de revisión')+' · '+esc(r.created_at)+'</button>').join('')+(row?intakeReviewMarkup(state,row):'<p>Sin solicitud seleccionada. No se importa el historial ni se crea un cliente de prueba.</p>')+'</main>';
  document.querySelector('[data-portal-refresh]').onclick=async()=>{rows=await listIntakeRequests(db);render()};
  document.querySelectorAll('[data-portal-open]').forEach(b=>b.onclick=()=>{selected=rows.find(r=>r.id===b.dataset.portalOpen);render()});
  if(row){document.querySelector('[data-intake-load]')?.remove();document.querySelector('[data-intake-new]')?.remove();bindIntakeReview({state,row,db,render});}
 };
 render();
}
