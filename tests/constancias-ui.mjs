import {chromium} from 'file:///C:/Users/cguerrer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.type()==='prompt'?d.accept('2026-11-25'):d.accept());
 await page.route('http://localhost/**',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));
 await page.goto('http://localhost/');await page.setContent('<main id="panel"></main><div id="mis-constancias"></div>');
 await page.evaluate(()=>{
  window.rolPanelActual='editor';window.usuarioPanelActual='chief';
  window.escaparHTML=s=>String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  window.formatoFecha=()=> '25 nov 2026';window.cargarVistaEditor=async()=>{};
  window.calls=[];window.passwordOK=false;
  window.items=[{assignment_id:'a1',id:'c1',revisor:'Cintya <Valerio>',folio:'RCIA-007-2026',titulo:'Título 007',correo:'r@test',ruta:'a1/file.pdf',sha256:null},
   {assignment_id:'a2',id:'c2',revisor:'Cintya <Valerio>',folio:'RCIA-010-2026',titulo:'Título 010',correo:'r@test',ruta:'a2/file.pdf',sha256:null}];
  window.db={auth:{getUser:async()=>({data:{user:{id:usuarioPanelActual,email:'chief@test'}}}),
    signInWithPassword:async()=>passwordOK?{data:{user:{id:'chief'}}}:{error:{message:'bad'}}},
   rpc:async(name,args)=>{calls.push({name,args});return ['rcia_listar_constancias','rcia_seguimiento_constancias'].includes(name)?{data:items}:{data:'ok'};},
   storage:{from:()=>({download:async()=>({data:new Blob(['%PDF-1.4\n%%EOF'],{type:'application/pdf'})})})}};
 });
 await page.addScriptTag({path:'js/constancias.js'});
 await page.evaluate(async()=>document.getElementById('panel').innerHTML=await renderConstanciasDescarga({id:'m1'}));
 assert.equal(await page.getByRole('button',{name:'Revisar y validar constancia'}).count(),2);
 assert.equal(await page.locator('valerio').count(),0); // escaped reviewer name
 await page.getByRole('button',{name:'Revisar y validar constancia'}).first().click();
 await page.getByRole('button',{name:'Validar y publicar constancia'}).click();
 assert((await page.locator('[data-error]').innerText()).includes('marca la confirmación'));
 assert.equal(await page.evaluate(()=>calls.filter(x=>x.name==='rcia_validar_constancia').length),0);
 await page.locator('[data-confirmar]').check();await page.locator('input[type=password]').fill('wrong');
 await page.getByRole('button',{name:'Validar y publicar constancia'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-error]').textContent.includes('contraseña'));
 assert.equal(await page.evaluate(()=>calls.filter(x=>x.name==='rcia_validar_constancia').length),0);
 await page.evaluate(()=>passwordOK=true);await page.locator('input[type=password]').fill('test-only');
 await page.getByRole('button',{name:'Validar y publicar constancia'}).click();await page.waitForSelector('dialog',{state:'detached'});
 assert.equal(await page.evaluate(()=>calls.filter(x=>x.name==='rcia_validar_constancia').length),1);
 assert.equal(await page.evaluate(()=>calls.find(x=>x.name==='rcia_validar_constancia').args.aid),'a1');
 await page.evaluate(async()=>{rolPanelActual='revisor';usuarioPanelActual='reviewer';document.getElementById('panel').innerHTML='';items.forEach(x=>{x.validado_en='2026-11-25';x.seguimiento_activo=true;});await cargarMisConstancias();});
 assert.equal(await page.getByRole('button',{name:'Descargar constancia PDF'}).count(),2);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar constancia PDF'}).nth(1).click();
 assert((await downloaded).suggestedFilename().includes('RCIA-010-2026'));
 await page.waitForFunction(()=>calls.some(x=>x.name==='rcia_registrar_descarga_constancia'));
 assert.equal(await page.evaluate(()=>calls.find(x=>x.name==='rcia_registrar_descarga_constancia').args.cid),'c2');
 assert.equal(await page.getByRole('button',{name:'Validar y publicar constancia'}).count(),0);
 await page.evaluate(async()=>{rolPanelActual='editor';usuarioPanelActual='chief';document.getElementById('mis-constancias').innerHTML='';document.getElementById('panel').innerHTML=await renderConstanciasDescarga({id:'m1'});});
 assert((await page.locator('#panel').innerText()).includes('Sin descargas registradas'));
 await page.getByRole('button',{name:'Registrar aviso enviado'}).first().click();
 await page.waitForFunction(()=>calls.some(x=>x.name==='rcia_registrar_aviso_constancia'));
 assert.equal(await page.evaluate(()=>calls.find(x=>x.name==='rcia_registrar_aviso_constancia').args.fecha),'2026-11-25');
 assert.equal(await page.evaluate(()=>calls.filter(x=>x.name==='rcia_registrar_descarga_constancia').length),1);
 await page.screenshot({path:'tmp/constancias-revisor-preview.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: vista previa, confirmación, contraseña, validación única, nombres escapados y dos descargas separadas para el mismo revisor.');
} finally {await browser.close();}
