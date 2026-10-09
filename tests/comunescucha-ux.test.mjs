import test from 'node:test';
import assert from 'node:assert/strict';
import { comunEscuchaSection, comunEscuchaListResults } from '../src/comunescucha.js';

function makeState(overrides={}) {
  const business={id:'biz-demo',name:'Negocio de prueba'};
  const row={
    business_id:business.id,account_id:'account-demo',conversation_id:'c-1',
    external_conversation_id:'external-1',participant_name:'Cliente demo',
    platform:'instagram',attention_state:'por_responder',last_message:'Hola',
    request_summary:'Consulta de producto',last_activity_at:'2026-10-09T12:00:00Z'
  };
  return {
    canManage:true,business,activeAccount:{id:row.account_id},
    conversationControl:[row],selectedConversationId:'external-1',
    workspace:{ui_state:{}},
    conversationMessages:{'external-1':{messages:[{direction:'incoming',text:'Hola',created_at:'2026-10-09T12:00:00Z'}]}},
    conversationLoading:{},conversationTranslations:{},translationLoading:{},
    conversationDrafts:{'biz-demo:account-demo:external-1':'Texto <sin enviar> & prueba'},
    conversationWorkDrafts:{'biz-demo:account-demo:external-1':'Preparar propuesta'},
    ceWorkbenchOpen:true,ceAnalysisOpen:false,ceDeepSearchOpen:false,
    ceMobileIntelligenceOpen:false,...overrides
  };
}

test('tres paneles y controles accesibles',()=>{
  const html=comunEscuchaSection({state:makeState()});
  for(const token of ['ce-list','ce-thread','ce-intelligence','data-ce-back-list',
    'data-ce-open-intelligence','data-ce-close-intelligence','data-ce-fold="focus"',
    'aria-current="true"','ce-mobile-thread']) assert.ok(html.includes(token),token);
});
test('preserva borradores sin introducir HTML del cliente',()=>{
  const html=comunEscuchaSection({state:makeState()});
  assert.match(html,/Texto &lt;sin enviar&gt; &amp; prueba/);
  assert.match(html,/Preparar propuesta/);
  assert.ok(!html.includes('Texto <sin enviar>'));
});
test('los acordeones y formularios cierran correctamente',()=>{
  const html=comunEscuchaSection({state:makeState()});
  const count=token=>(html.match(new RegExp(token,'g'))||[]).length;
  assert.equal(count('<details'),count('</details>'));
  assert.equal(count('<form'),count('</form>'));
});
test('sin selección se muestra la bandeja y estado vacío',()=>{
  const html=comunEscuchaSection({state:makeState({selectedConversationId:null})});
  assert.match(html,/Selecciona una conversación/);
  assert.ok(!html.includes('ce-mobile-thread'));
});
test('en móvil puede abrirse la inteligencia y volver al chat',()=>{
  const html=comunEscuchaSection({state:makeState({ceMobileIntelligenceOpen:true})});
  assert.ok(html.includes('ce-mobile-intelligence'));
  assert.ok(html.includes('data-ce-close-intelligence'));
});
test('los filtros no eliminan la conversación seleccionada del hilo',()=>{
  const html=comunEscuchaSection({state:makeState({conversationFilter:'requiere_humano'})});
  assert.ok(html.includes('No hay conversaciones con estos filtros'));
  assert.ok(html.includes('Cliente demo'));
});
test('sin permisos no expone conversaciones privadas',()=>{
  const html=comunEscuchaSection({state:makeState({canManage:false})});
  assert.ok(!html.includes('Cliente demo'));
  assert.match(html,/modo Administración/);
});

test('filtrado de la bandeja sin reconstruir la vista',()=>{
  const state=makeState({conversationQuery:'cliente demo'});
  const found=comunEscuchaListResults({state});
  assert.equal(found.count,1);
  assert.match(found.html,/Cliente demo/);
  state.conversationQuery='no existe';
  const empty=comunEscuchaListResults({state});
  assert.equal(empty.count,0);
  assert.match(empty.html,/No hay conversaciones/);
});
