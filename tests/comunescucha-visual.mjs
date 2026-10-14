import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { comunEscuchaSection } from '../src/comunescucha.js';

const css=['src/comunescucha.css','src/panel-fold.css','src/comunescucha-ux.css']
  .map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
const row={
  business_id:'biz-demo',account_id:'acct-ig',conversation_id:'conv-1',
  external_conversation_id:'ig-thread-1',participant_name:'Contacto de prueba',
  platform:'instagram',account_username:'demo',attention_state:'por_responder',
  request_summary:'Consulta por un servicio',last_message:'Hola, ¿tienen disponibilidad?',
  last_activity_at:new Date().toISOString(),products:['Tour'],
  specialist_name:'LINK MAR',next_action:'Preparar respuesta',
  response_profile:{goal:'Ayudar al cliente con datos verificados.'}
};
const state={
  canManage:true,business:{id:'biz-demo',name:'Negocio demo'},
  activeAccount:{id:'acct-ig'},conversationControl:[row],
  selectedConversationId:'ig-thread-1',workspace:{ui_state:{}},
  conversationMessages:{'ig-thread-1':{messages:[
    {direction:'incoming',message:'Hola, ¿tienen disponibilidad?',createdAt:new Date().toISOString()},
    {direction:'outgoing',message:'Gracias por escribirnos.',createdAt:new Date().toISOString()}
  ]}},
  conversationLoading:{},conversationTranslations:{},translationLoading:{},
  conversationDrafts:{'biz-demo:acct-ig:ig-thread-1':'Borrador no enviado'},
  conversationWorkDrafts:{},ceWorkbenchOpen:false,ceAnalysisOpen:false,
  ceDeepSearchOpen:false,ceMobileIntelligenceOpen:false
};
const html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#FBF9F9;color:#1B1C1C;font-family:Arial,sans-serif}button,input,textarea,select{font:inherit}'+css+'</style></head><body>'+
  '<main style="max-width:1500px;margin:auto">'+comunEscuchaSection({state})+'</main></body></html>';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
mkdirSync('test-artifacts',{recursive:true});
try{
  const desktop=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await desktop.setContent(html);
  const list=await desktop.locator('.ce-list').boundingBox();
  const thread=await desktop.locator('.ce-thread').boundingBox();
  const intel=await desktop.locator('.ce-intelligence').boundingBox();
  assert.ok(list&&thread&&intel,'los tres paneles deben ser visibles en escritorio');
  assert.ok(list.x+list.width<=thread.x+8,'bandeja a la izquierda');
  assert.ok(thread.x+thread.width<=intel.x+8,'inteligencia a la derecha');
  assert.ok(thread.width>300,'hilo central utilizable');
  await desktop.screenshot({path:'test-artifacts/comunescucha-escritorio.png',fullPage:true});

  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await mobile.setContent(html);
  assert.equal(await mobile.locator('.ce-list').isVisible(),false,'en móvil se abre el chat seleccionado');
  assert.equal(await mobile.locator('.ce-thread').isVisible(),true);
  assert.equal(await mobile.locator('.ce-intelligence').isVisible(),false);
  assert.equal(await mobile.locator('#conversation-reply').inputValue(),'Borrador no enviado');
  await mobile.screenshot({path:'test-artifacts/comunescucha-movil-chat.png',fullPage:true});

  await mobile.locator('.comunescucha-shell').evaluate(el=>el.classList.add('ce-mobile-intelligence'));
  assert.equal(await mobile.locator('.ce-intelligence').isVisible(),true,'inteligencia móvil visible');
  await mobile.screenshot({path:'test-artifacts/comunescucha-movil-inteligencia.png',fullPage:true});

  await mobile.locator('.comunescucha-shell').evaluate(el=>{
    el.classList.remove('ce-mobile-intelligence','ce-mobile-thread');
  });
  assert.equal(await mobile.locator('.ce-list').isVisible(),true,'retorno a bandeja móvil');
  await mobile.screenshot({path:'test-artifacts/comunescucha-movil-bandeja.png',fullPage:true});
  console.log('Visual QA OK: tres paneles, chat móvil, inteligencia y retorno a bandeja.');
}finally{
  await browser.close();
}
