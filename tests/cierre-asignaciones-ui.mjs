import {chromium} from 'file:///C:/Users/cguerrer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.setContent('<main class="contenedor"><div id="lista-manuscritos-revisor"></div><div id="editor"></div></main>');
 await page.addStyleTag({path:'css/style.css'});
 await page.addScriptTag({path:'js/cierre-asignaciones.js'});
 await page.addScriptTag({content:readFileSync('js/dashboard.js','utf8').replace('iniciarPanel();','')});
 await page.evaluate(()=>{
  rolPanelActual='editor_area';usuarioPanelActual='area';
  window.escaparHTML=s=>String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  window.cargarVistaEditor=async()=>{window.recargado=true;};window.calls=[];
  window.m={id:'m',folio:'RCIA-010-2026',estado:'en_revision',editor_area_asignado_id:'area'};
  window.asignaciones=[{id:'a1',reviewer_id:'r1',estado:'pendiente'},{id:'a2',reviewer_id:'r2',estado:'entregada'},{id:'a3',reviewer_id:'r3',estado:'cerrada'}];
  window.revisores=[{id:'r1',nombre_completo:'Revisora original'},{id:'r2',nombre_completo:'Revisora sustituta <nombre>'}];
  window.db={auth:{getUser:async()=>({data:{user:{id:'area'}}})},rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='rcia_cierres_del_manuscrito')return {data:[]};
    if(name==='rcia_mis_asignaciones')return {data:[{id:'a1',estado:'cerrada',manuscripts_blind:{id:'m',folio:'RCIA-010-2026',titulo:'Artículo de prueba',resumen:'Resumen',archivo_manuscrito_url:'https://example.test/old.pdf'}}]};
    return {data:{cerrada:true}};
  }};
 });
 await page.evaluate(async()=>{const c=await cargarCierresAsignaciones(m,asignaciones,revisores);document.getElementById('editor').innerHTML=renderCierreAsignacion(asignaciones[0],m,c);});
 await page.getByRole('button',{name:'Cerrar asignación',exact:true}).click();
 assert.equal(await page.locator('#sustituta-cierre option').count(),2); // placeholder + entregada, no cerrada
 assert.equal(await page.locator('nombre').count(),0);
 await page.getByRole('button',{name:'Confirmar cierre'}).click();
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='rcia_cerrar_asignacion').length),0);
 await page.selectOption('#sustituta-cierre','a2');
 await page.fill('#nota-cierre','La revisora no pudo acceder y fue sustituida por otra revisora.');
 await page.check('#confirmar-cierre');
 await page.screenshot({path:'tmp/cierre-asignacion-preview.png',fullPage:true});
 await page.getByRole('button',{name:'Confirmar cierre'}).click();
 await page.waitForSelector('dialog',{state:'detached'});
 const call=await page.evaluate(()=>calls.find(c=>c.name==='rcia_cerrar_asignacion'));
 assert.equal(call.args.aid,'a1');assert.equal(call.args.sustituta,'a2');assert.equal(call.args.motivo_cierre,'sustitucion');
 await page.evaluate(async()=>{document.getElementById('editor').innerHTML='';rolPanelActual='revisor';usuarioPanelActual='r1';await cargarVistaRevisor('r1');});
 assert((await page.locator('#lista-manuscritos-revisor').innerText()).includes('Asignación cerrada por el equipo editorial'));
 assert.equal(await page.getByRole('button',{name:'Aceptar invitación'}).count(),0);
 assert.equal(await page.getByRole('link',{name:'Ver manuscrito (versión anonimizada)'}).count(),0);
 assert.equal(await page.getByRole('link',{name:'Capturar dictamen'}).count(),0);
 assert(!(await page.locator('#lista-manuscritos-revisor').innerText()).includes('sustituta'));
 assert.deepEqual(errors,[]);
 console.log('PASS: formulario de cierre, sustituto válido, confirmación requerida, observaciones, datos de RPC y panel cerrado sin enlaces ni identidad de otros revisores.');
} finally {await browser.close();}
