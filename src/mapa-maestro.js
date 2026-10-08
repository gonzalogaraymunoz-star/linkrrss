/* Mapa Maestro visual shell. Preserves all LINKRRSS live handlers and data. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;
  const labels = {
    home:['La escucha del ecosistema.','Una misma inteligencia de conversaciones, un contexto distinto para cada negocio.'],
    artifacts:['Artefactos en movimiento.','Herramientas compartidas, asociadas al negocio y a sus evidencias.'],
    inbox:['Una conversación. Un contexto.','Escuchar, comprender y movilizar cada interacción sin perder su origen.'],
    content:['Contenido con propósito.','Publicaciones, campañas y piezas vinculadas a la célula activa.'],
    studio:['La red que nos conecta.','Comunidades, expresiones y artefactos del ecosistema.'],
    operation:['De la escucha a la acción.','Responsables, tareas y evidencia para el siguiente movimiento.'],
    calendar:['El tiempo de la comunicación.','Planificación por negocio, cuentas y compromisos.'],
    analytics:['Interpretar para aprender.','Métricas y señales reales para decidir mejor.'],
    connections:['Conexiones del organismo.','Cuentas, proveedores y canales vinculados a la célula.'],
    automations:['Movimiento programado.','Procesos de comunicación y seguimiento de LINK RRSS.'],
    activity:['Memoria de las señales.','Un registro de lo que ocurrió, cambió y requiere atención.']
  };
  const stageTargets={MAR:'inbox',VENTA:'inbox',CIERRE:'operation',BOARDING:'operation',OPERAR:'operation',POSTVENTA:'analytics'};
  let pendingConversation = new URLSearchParams(location.search).get('conversation_id');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = [
    '<svg viewBox="0 0 1050 315" role="img" aria-label="Diagrama interactivo de LINK ID, canales, seis etapas de Concha y negocio activo">',
    '<path class="stroke" stroke="#e5e9e4" d="M0 161H1045" stroke-dasharray="1 7"/>',
    '<path class="stroke" stroke="#e6d8ce" d="M77 162 C155 162 174 68 278 68 S386 120 441 136"/>',
    '<path class="stroke" stroke="#cbdce6" d="M77 162 C155 162 174 225 278 225 S387 208 441 187"/>',
    '<circle cx="77" cy="162" r="56" fill="#fff9f5" stroke="#edc7ad"/>',
    '<circle cx="77" cy="162" r="3" fill="#e79565"/><text class="node" x="77" y="181" text-anchor="middle">LINK ID</text><text class="micro" x="77" y="199" text-anchor="middle">IDENTIDAD</text>',
    '<text class="micro" x="77" y="85" text-anchor="middle">ENTRADA</text><text class="micro" x="278" y="20" text-anchor="middle">CANALES</text>',
    '<circle cx="277" cy="68" r="18" fill="#fff" stroke="#d5ded7"/><text class="micro" x="277" y="72" text-anchor="middle">IG</text>',
    '<circle cx="277" cy="225" r="18" fill="#fff" stroke="#d5ded7"/><text class="micro" x="277" y="229" text-anchor="middle">WA</text>',
    '<circle cx="542" cy="160" r="134" fill="none" stroke="#efede6"/><circle cx="542" cy="160" r="101" fill="none" stroke="#f2d6c4"/>',
    '<path class="stroke" stroke="#e6ae88" d="M542 59 A101 101 0 0 1 629 110"/><path class="stroke" stroke="#e6ae88" d="M643 160 A101 101 0 0 1 590 249"/><path class="stroke" stroke="#e6ae88" d="M492 249 A101 101 0 0 1 441 160"/><path class="stroke" stroke="#e6ae88" d="M455 110 A101 101 0 0 1 542 59"/>',
    ...[['MAR',542,59],['VENTA',629,109],['CIERRE',629,211],['BOARDING',542,261],['OPERAR',455,211],['POSTVENTA',455,109]].map(([t,x,y])=>'<g class="stage" data-stage="'+t+'" tabindex="0" role="button" aria-label="Abrir etapa '+t+'"><circle cx="'+x+'" cy="'+y+'" r="28" fill="#fff9f4" stroke="#edc6a9"/><text class="micro" x="'+x+'" y="'+(y+3)+'" text-anchor="middle" style="font-size:'+(t.length>6?8:10)+'px">'+t+'</text></g>'),
    '<circle cx="542" cy="160" r="65" fill="#fbfcfa" stroke="#e0e7e0"/><text class="node" x="542" y="148" text-anchor="middle" style="letter-spacing:2px">CONCHA</text><text class="micro" x="542" y="170" text-anchor="middle">6 ETAPAS</text><text class="micro" x="542" y="186" text-anchor="middle">1 ECOSISTEMA</text>',
    '<path class="stroke" stroke="#b9d4e2" d="M655 139 C728 136 720 84 823 84"/><path class="stroke" stroke="#b9d4e2" d="M655 182 C724 184 730 236 823 236"/>',
    '<circle cx="831" cy="84" r="26" fill="#f3f9fc" stroke="#b2d5e6"/><text class="micro" x="831" y="88" text-anchor="middle">RRSS</text>',
    '<circle cx="831" cy="236" r="26" fill="#f3f9fc" stroke="#b2d5e6"/><text class="micro" x="831" y="240" text-anchor="middle">DATOS</text>',
    '<path class="stroke" stroke="#afc8b9" d="M857 84 C914 84 909 160 953 160"/><path class="stroke" stroke="#afc8b9" d="M857 236 C914 236 909 160 953 160"/>',
    '<circle cx="967" cy="160" r="52" fill="#f5f9f5" stroke="#9dbba9"/><circle class="pulse-dot" cx="967" cy="160" r="4" fill="#6f987e"/>',
    '<text class="node" x="967" y="185" text-anchor="middle" id="mapa-cell" style="font-size:11px">CÉLULA</text><text class="micro" x="967" y="203" text-anchor="middle">NEGOCIO</text>',
    '<text class="micro" x="967" y="83" text-anchor="middle">CONTEXTO ACTIVO</text>',
    '</svg>'
  ].join('');
  function currentSection(shell){
    return shell.querySelector('.section-nav [data-section].active')?.dataset.section || new URLSearchParams(location.search).get('section') || 'home';
  }
  function decorate(){
    const shell=app.querySelector('.app-shell');
    if(!shell){document.body.classList.remove('mapa-view-home');return;}
    if(shell.dataset.mapaDecorated==='1'){tryConversation();return;}
    shell.dataset.mapaDecorated='1';
    const sidebar=shell.querySelector('.sidebar'),nav=shell.querySelector('.section-nav'),content=shell.querySelector('.content');
    if(!sidebar||!nav||!content)return;
    const top=sidebar.querySelector('.side-top');
    const heading=document.createElement('div');
    heading.className='mapa-side-eyebrow';
    heading.textContent='LINK WORLD';
    if(top)top.prepend(heading);
    const label=document.createElement('div');
    label.className='mapa-side-label';
    label.textContent='MESAS / CAPACIDADES';
    const before=sidebar.querySelector('.new-connection') || sidebar.querySelector('.side-search') || sidebar.querySelector('.side-label');
    sidebar.insertBefore(label,before);
    sidebar.insertBefore(nav,before);
    nav.querySelectorAll('[data-section]').forEach((btn,i)=>{
      btn.dataset.mapNumber=String(i+1).padStart(2,'0');
      btn.title=btn.textContent.trim();
    });
    const section=currentSection(shell);
    document.body.classList.toggle('mapa-view-home',section==='home');
    const selected=shell.querySelector('.business-item.active .business-copy strong')?.textContent?.trim() || shell.querySelector('.crumb strong')?.textContent?.trim() || 'LINK';
    const head=document.createElement('header');
    head.className='mapa-page-heading';
    head.innerHTML='<div><div class="mapa-ol">LINK WORLD / DIMENSIÓN RRSS / '+esc(section.toUpperCase())+'</div><h1>'+esc((labels[section]||labels.home)[0])+'</h1><p>'+esc((labels[section]||labels.home)[1])+'</p></div><div class="mapa-folio">LINK RRSS<br>MAPA MAESTRO / '+esc(selected.toUpperCase())+'<br>ECOSISTEMA EN MOVIMIENTO</div>';
    content.prepend(head);
    if(section==='home'){
      const map=document.createElement('section');
      map.className='mapa-map';
      map.innerHTML='<div class="mapa-map-top"><span class="mapa-map-overline">MAPA DE MOVIMIENTO / RRSS</span><div class="mapa-map-legend"><span>CONCHA</span><span>ARTEFACTO</span><span>CÉLULA</span></div></div>'+svg+'<div class="mapa-map-bottom"><span>De la señal al contexto; del contexto a la acción verificable.</span><button type="button" data-mapa-inbox>Explorar conversaciones ↗</button></div>';
      content.insertBefore(map,head.nextSibling);
      const cell=map.querySelector('#mapa-cell');
      if(cell)cell.textContent=selected.toUpperCase().slice(0,12);
      map.querySelector('[data-mapa-inbox]')?.addEventListener('click',()=>nav.querySelector('[data-section="inbox"]')?.click());
      map.querySelectorAll('[data-stage]').forEach(btn=>{
        const go=()=>nav.querySelector('[data-section="'+stageTargets[btn.dataset.stage]+'"]')?.click();
        btn.addEventListener('click',go);
        btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});
      });
    }
    tryConversation();
  }
  function tryConversation(){
    if(!pendingConversation)return;
    const section=app.querySelector('.section-nav [data-section].active')?.dataset.section;
    if(section!=='inbox')return;
    const btn=Array.from(app.querySelectorAll('[data-conversation]')).find(x=>x.dataset.conversation===pendingConversation);
    if(btn){pendingConversation=null;btn.click();}
  }
  let scheduled=false;
  const schedule=()=>{
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{scheduled=false;decorate();});
  };
  const observer=new MutationObserver(schedule);
  observer.observe(app,{childList:true,subtree:true});
  decorate();
})();
