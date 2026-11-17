// Adapter for the existing authenticated Supabase client. No send or scheduling operation.
// UI integration must display sources and require explicit direct-chat/request review.
export const LAMA_BUSINESS_ID='766f9317-97e4-43e8-aea0-ff8d7e318edc';
export const FIELD_KEYS=['service','date','pax','language','pickup'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=message=>{throw new Error(message)};
export function selectedSourceData(conversationId,messageIds){
 if(!uuid.test(conversationId))fail('Invalid conversation');
 if(!Array.isArray(messageIds)||messageIds.length<1||messageIds.length>50||messageIds.some(id=>!uuid.test(id))||new Set(messageIds).size!==messageIds.length)fail('Invalid source selection');
 return {business_id:LAMA_BUSINESS_ID,conversation_id:conversationId,message_ids:[...messageIds].sort()};
}
export function unknownFields(){return Object.fromEntries(FIELD_KEYS.map(k=>[k,{state:'unknown',value:null,source_message_ids:[]}]))}
export async function readSelectedSources(client,conversationId,messageIds,requestKey=null){
 const data=selectedSourceData(conversationId,messageIds);
 const {data:result,error}=await client.rpc('link_sales_rrss_intake_v1',{p_action:'draft_snapshot',p_data:{...data,request_key:requestKey}});
 if(error)throw error;
 if(!result?.ok)fail(result?.code||'Source read failed');
 return {...data,...result};
}
export async function saveReviewedDraft(client,{snapshot,requestKey,requestKind,fields,expectedDraftRevision=null,directChatReviewed=false,requestReviewed=false,newRequestReviewed=false}){
 if(!snapshot?.ok||!Number.isSafeInteger(snapshot.source_revision)||snapshot.source_revision<0)fail('Source snapshot required');
 if(!uuid.test(requestKey))fail('Stable request key required');
 if(expectedDraftRevision===null&&!newRequestReviewed)fail('Confirm a new independent request');
 if(!directChatReviewed||!requestReviewed)fail('Review the direct chat and actual request');
 if(!['tour_request','confirmation_request','other_request'].includes(requestKind))fail('Invalid request kind');
 const base=selectedSourceData(snapshot.conversation_id,snapshot.message_ids);
 if(snapshot.business_id!==LAMA_BUSINESS_ID)fail('Wrong business');
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||FIELD_KEYS.some(k=>!Object.hasOwn(fields,k)))fail('Unknown fields must be explicit');
 for(const [key,field] of Object.entries(fields)){
  if(![...FIELD_KEYS,'note'].includes(key)||!field||!['unknown','proposed','conflict'].includes(field.state)||!Array.isArray(field.source_message_ids))fail('Invalid field');
  if(field.state==='unknown'&&(field.value!==null||field.source_message_ids.length))fail('Unknown field has a value');
  if(field.state!=='unknown'&&(field.value==null||!field.source_message_ids.length))fail('Evidence required');
  if(field.source_message_ids.some(id=>!base.message_ids.includes(id)))fail('Evidence outside reviewed selection');
 }
 const {data:result,error}=await client.rpc('link_sales_rrss_intake_v1',{p_action:'draft_save',p_data:{...base,
  request_key:requestKey,request_kind:requestKind,fields:structuredClone(fields),expected_source_revision:snapshot.source_revision,
  expected_draft_revision:expectedDraftRevision,request_review_confirmed:true,direct_chat_review_confirmed:true,new_request_confirmed:newRequestReviewed}});
 if(error)throw error;
 if(!result||typeof result.ok!=='boolean')fail('Invalid server response');
 // Conflicts are data, not success. Caller must show them and reload; never retry silently.
 return result;
}

export async function listIntakeRequests(client){
 const {data,error}=await client.rpc('link_sales_rrss_intake_v1',{p_action:'list',p_data:{business_id:LAMA_BUSINESS_ID}});
 if(error)throw error;if(!data?.ok)fail('No se pudo leer captación');return data.requests||[];
}
export async function submitIntakeToCRM(client,{inboxId,draftRevision,reviewed=false,existingLeadId=null}){
 if(!uuid.test(inboxId)||!Number.isSafeInteger(draftRevision)||!reviewed)fail('Revisión CRM obligatoria');
 const {data,error}=await client.rpc('link_sales_rrss_intake_v1',{p_action:'crm_submit',p_data:{business_id:LAMA_BUSINESS_ID,inbox_id:inboxId,expected_draft_revision:draftRevision,crm_review_confirmed:true,existing_lead_id:existingLeadId}});
 if(error)throw error;if(typeof data?.ok!=='boolean')fail('Respuesta CRM inválida');return data;
}
