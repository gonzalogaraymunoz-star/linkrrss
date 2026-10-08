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
  const sectionNames={home:'INICIO',artifacts:'ARTEFACTOS',inbox:'CONVERSACIONES',content:'CONTENIDO',studio:'ECOSISTEMA',operation:'OPERACIÓN',calendar:'CALENDARIO',analytics:'ANALÍTICAS',connections:'CONEXIONES',automations:'AUTOMATIZACIONES',activity:'ACTIVIDAD'};
  const stageTargets={MAR:'marketing',VENTA:'ventas',CIERRE:'cierre',BOARDING:'onboarding',OPERACIONES:'entrega',POSTVENTA:'postventa'};
  let pendingConversation = new URLSearchParams(location.search).get('conversation_id');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = [
    "<svg viewBox=\"0 0 1050 315\" role=\"img\" aria-label=\"Ruta de una señal: LINKRRSS capta, LINK ID identifica, MAR interpreta y la Concha recorre las seis etapas del negocio\">",
    "<defs><marker id=\"mapa-arrow-blue\" markerWidth=\"7\" markerHeight=\"7\" refX=\"6\" refY=\"3\" orient=\"auto\"><path d=\"M0 0L6 3L0 6\" fill=\"none\" stroke=\"#7fa9bb\" stroke-width=\"1.2\"/></marker><marker id=\"mapa-arrow-orange\" markerWidth=\"7\" markerHeight=\"7\" refX=\"6\" refY=\"3\" orient=\"auto\"><path d=\"M0 0L6 3L0 6\" fill=\"none\" stroke=\"#dcaa88\" stroke-width=\"1.2\"/></marker></defs>",
    "<path d=\"M154 163H261\" stroke=\"#9ebcc8\" stroke-width=\"1.6\" fill=\"none\" marker-end=\"url(#mapa-arrow-blue)\"/>",
    "<path d=\"M376 163H482\" stroke=\"#9ebcc8\" stroke-width=\"1.6\" fill=\"none\" marker-end=\"url(#mapa-arrow-blue)\"/>",
    "<path d=\"M594 163H670\" stroke=\"#dcaa88\" stroke-width=\"1.6\" fill=\"none\" marker-end=\"url(#mapa-arrow-orange)\"/>",
    "<path d=\"M895 163H919\" stroke=\"#abc6b3\" stroke-width=\"1.6\" fill=\"none\"/>",
    "<text class=\"micro\" x=\"209\" y=\"142\" text-anchor=\"middle\">REGISTRA</text><text class=\"micro\" x=\"430\" y=\"142\" text-anchor=\"middle\">IDENTIFICA</text><text class=\"micro\" x=\"635\" y=\"142\" text-anchor=\"middle\">ACTIVA</text>",
    "<text class=\"micro\" x=\"99\" y=\"54\" text-anchor=\"middle\">01 · ARTEFACTO</text>",
    "<g class=\"map-node\" data-map-action=\"inbox\" tabindex=\"0\" role=\"button\" aria-label=\"Abrir conversaciones LINK RRSS\"><circle cx=\"99\" cy=\"163\" r=\"55\" fill=\"#f1f9fc\" stroke=\"#add0e0\" stroke-width=\"1.4\"/><circle cx=\"99\" cy=\"129\" r=\"4\" fill=\"#5a9ac1\"/><text class=\"node\" x=\"99\" y=\"161\" text-anchor=\"middle\" style=\"font-size:13px\">LINKRRSS</text><text class=\"micro\" x=\"99\" y=\"183\" text-anchor=\"middle\">ESCUCHA</text><text class=\"micro\" x=\"99\" y=\"196\" text-anchor=\"middle\">IG · WA · CANALES</text></g>",
    "<text class=\"micro\" x=\"319\" y=\"54\" text-anchor=\"middle\">02 · ADUANA</text>",
    "<g class=\"map-node\" data-map-action=\"linkid\" tabindex=\"0\" role=\"button\" aria-label=\"Abrir LINK ID, la aduana de identidad\"><circle cx=\"319\" cy=\"163\" r=\"57\" fill=\"#fff9f5\" stroke=\"#e8b89f\" stroke-width=\"1.4\"/><circle cx=\"319\" cy=\"128\" r=\"4\" fill=\"#e9a078\"/><text class=\"node\" x=\"319\" y=\"163\" text-anchor=\"middle\" style=\"font-size:14px\">LINK ID</text><text class=\"micro\" x=\"319\" y=\"183\" text-anchor=\"middle\">IDENTIDAD</text><text class=\"micro\" x=\"319\" y=\"197\" text-anchor=\"middle\">SIN DUPLICADOS</text></g>",
    "<text class=\"micro\" x=\"542\" y=\"54\" text-anchor=\"middle\">03 · PRIMERA ETAPA</text>",
    "<g class=\"map-node\" data-map-action=\"mar\" tabindex=\"0\" role=\"button\" aria-label=\"Abrir MAR: escucha y oportunidad\"><circle cx=\"542\" cy=\"163\" r=\"53\" fill=\"#fff9f3\" stroke=\"#efc4a6\" stroke-width=\"1.4\"/><circle cx=\"542\" cy=\"131\" r=\"4\" fill=\"#e99c6b\"/><text class=\"node\" x=\"542\" y=\"164\" text-anchor=\"middle\" style=\"font-size:14px\">MAR</text><text class=\"micro\" x=\"542\" y=\"183\" text-anchor=\"middle\">INTERPRETA</text></g>",
    "<text class=\"micro\" x=\"786\" y=\"21\" text-anchor=\"middle\">04 · CICLO DE LA CONCHA</text>",
    "<circle cx=\"786\" cy=\"163\" r=\"112\" fill=\"none\" stroke=\"#f0e3d9\"/><circle cx=\"786\" cy=\"163\" r=\"92\" fill=\"none\" stroke=\"#eccdb8\" stroke-dasharray=\"2 5\"/>",
    "<circle cx=\"786\" cy=\"163\" r=\"56\" fill=\"#fbfcfa\" stroke=\"#dce8df\"/><text class=\"node\" x=\"786\" y=\"154\" text-anchor=\"middle\" style=\"font-size:15px\">CICLO</text><text class=\"micro\" x=\"786\" y=\"174\" text-anchor=\"middle\">6 ETAPAS</text><text class=\"micro\" x=\"786\" y=\"188\" text-anchor=\"middle\">UNA IDENTIDAD</text>",
    ...[['MAR',786,64],['VENTA',870,113],['CIERRE',870,213],['BOARDING',786,264],['OPERACIONES',702,213],['POSTVENTA',702,113]].map(([t,x,y])=>'<g class="stage" data-stage="'+t+'" tabindex="0" role="button" aria-label="Abrir etapa '+t+'"><circle cx="'+x+'" cy="'+y+'" r="24" fill="#fffaf6" stroke="#e9c3a9"/><text class="micro" x="'+x+'" y="'+(y+3)+'" text-anchor="middle" style="font-size:'+(t.length>7?7:9)+'px">'+t+'</text></g>'),
    "<text class=\"micro\" x=\"973\" y=\"54\" text-anchor=\"middle\">05 · CONTEXTO</text>",
    "<circle cx=\"973\" cy=\"163\" r=\"52\" fill=\"#f5f9f5\" stroke=\"#9dbca6\" stroke-width=\"1.4\"/><circle class=\"pulse-dot\" cx=\"973\" cy=\"133\" r=\"4\" fill=\"#79a48b\"/><text class=\"node\" x=\"973\" y=\"164\" text-anchor=\"middle\" id=\"mapa-cell\" style=\"font-size:11px\">CÉLULA</text><text class=\"micro\" x=\"973\" y=\"184\" text-anchor=\"middle\">NEGOCIO</text>",
    "</svg>",
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
    // La navegación nace dentro del menú: no mover nodos después de vincular eventos.
    nav.querySelectorAll('[data-section]').forEach((btn,i)=>{
      btn.dataset.mapNumber=String(i+1).padStart(2,'0');
      btn.title=btn.textContent.trim();
    });
    const section=currentSection(shell);
    document.body.classList.toggle('mapa-view-home',section==='home');
    const selected=shell.querySelector('.business-item.active .business-copy strong')?.textContent?.trim() || shell.querySelector('.crumb strong')?.textContent?.trim() || 'LINK';
    const head=document.createElement('header');
    head.className='mapa-page-heading';
    head.innerHTML='<div><div class="mapa-ol">LINK WORLD / DIMENSIÓN RRSS / '+esc(sectionNames[section]||section.toUpperCase())+'</div><h1>'+esc((labels[section]||labels.home)[0])+'</h1><p>'+esc((labels[section]||labels.home)[1])+'</p></div><div class="mapa-folio">LINK RRSS<br>MAPA MAESTRO / '+esc(selected.toUpperCase())+'<br>ECOSISTEMA EN MOVIMIENTO</div>';
    content.prepend(head);
    if(section==='home'){
      const map=document.createElement('section');
      map.className='mapa-map';
      map.innerHTML='<div class="mapa-map-top"><span class="mapa-map-overline">RUTA DE ENTRADA / MAR</span><div class="mapa-map-legend"><span>ESCUCHA</span><span>ADUANA</span><span>CONCHA</span></div></div>'+svg+'<div class="mapa-map-bottom"><span>LINKRRSS capta → LINK ID identifica → MAR interpreta → el ciclo avanza.</span><button type="button" data-mapa-inbox>Explorar conversaciones ↗</button></div>';
      content.insertBefore(map,head.nextSibling);
      const cell=map.querySelector('#mapa-cell');
      if(cell)cell.textContent=selected.toUpperCase().slice(0,12);
      map.querySelector('[data-mapa-inbox]')?.addEventListener('click',()=>nav.querySelector('[data-section="inbox"]')?.click());
      const goToWorld=(dimension)=>{const u=new URL('https://link-world-9h0.pages.dev/');u.searchParams.set('dimension',dimension);const business=new URLSearchParams(location.search).get('business');if(business)u.searchParams.set('business',business);location.assign(u.toString());};
      const linkIdUrl=()=>goToWorld('personas');
      const openMapAction=(name)=>{if(name==='linkid')return linkIdUrl();nav.querySelector('[data-section="inbox"]')?.click();};
      map.querySelectorAll('[data-map-action]').forEach(node=>{
        const go=()=>openMapAction(node.dataset.mapAction);
        node.addEventListener('click',go);
        node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});
      });
      map.querySelectorAll('[data-stage]').forEach(btn=>{
        const go=()=>goToWorld(stageTargets[btn.dataset.stage]);
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
  // Se activa exactamente una vez por render real de la app.
  // No observar el árbol completo: evita bucles, trabajo inútil y bloqueos al plegar mesas.
  document.addEventListener('linkrrss:rendered',decorate);
  decorate();
})();
