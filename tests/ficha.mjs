import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const elements=new Map();
function el(id){if(!elements.has(id)) elements.set(id,{value:'',checked:true,disabled:false,style:{},dataset:{},classList:{toggle(){}},listeners:{},addEventListener(t,f){this.listeners[t]=f},appendChild(){},scrollIntoView(){}}); return elements.get(id)}
let saved, calls=0;
const a={id:'a',estado:'pendiente',manuscripts_blind:{folio:'TEST',titulo:'Título',archivo_manuscrito_url:'https://example.test/anon.pdf'}};
const context=vm.createContext({URLSearchParams,window:{location:{search:'?a=a'}},document:{getElementById:el,createElement:()=>el(Math.random()),querySelectorAll:()=>[]},alert:()=>{},db:{auth:{getSession:async()=>({data:{session:{user:{id:'r'}}}})},rpc:async()=>({data:[a]}),from:()=>({insert:async data=>{saved=data;calls++;return {error:null}}})}});
vm.runInContext(readFileSync('js/evaluacion.js','utf8'),context);
await new Promise(r=>setImmediate(r));
assert.equal(el('archivoAnonimo').hidden,false);
assert.equal(el('archivoAnonimo').href,'https://example.test/anon.pdf');
for(const [score,decision] of [[13,'rechazar'],[14,'revision_mayor'],[19,'revision_mayor'],[20,'revision_menor'],[27,'revision_menor'],[28,'aceptar'],[32,'aceptar']]) assert.equal(vm.runInContext(`recomendacion(${score}).decision`,context),decision);
el('necesitaSegundaRevision').value='No';el('necesitaSegundaRevision').listeners.change();assert.equal(el('dispuestoSegundaRevision').value,'No aplica');
for(let i=1;i<=8;i++) el('c'+i).value='4';
await el('btnEnviar').listeners.click();assert.equal(saved.puntaje_total,32);assert.equal(saved.decision,'aceptar');assert.equal(calls,1);
await el('btnEnviar').listeners.click();assert.equal(calls,1);
console.log('OK: carga de ficha, enlace anónimo, siete límites de recomendación, segunda revisión y bloqueo de doble clic.');
