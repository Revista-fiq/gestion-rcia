import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('js/auth.js','utf8');
async function fixture({role='autor',activo=true,session=null,errorPerfil=false}={}) {
 const elements=new Map(); const classes=new Map();const calls={signup:[],signin:0,signout:0};
 function el(id){
  if(!elements.has(id)){
   const set=new Set(['oculto']);classes.set(id,set);
   elements.set(id,{value:'',disabled:false,listeners:{},classList:{add:c=>set.add(c),remove:c=>set.delete(c),toggle:(c,b)=>b?set.add(c):set.delete(c)},
    addEventListener(k,fn){this.listeners[k]=fn;},replaceChildren(n){this.message=n.textContent;}});
  }return elements.get(id);
 }
 const radios=[el('radio-autor'),el('radio-editorial')];radios[0].value='autor';radios[1].value='editorial';
 const location={href:'index.html'};
 const ctx=vm.createContext({console,window:{location},alert:()=>{},prompt:()=> 'Nombre',
 document:{getElementById:el,querySelectorAll:()=>radios,createElement:()=>({})},
 db:{auth:{getSession:async()=>({data:{session}}),signInWithPassword:async()=>{calls.signin++;return {data:{user:{id:'u'}}};},
 signOut:async()=>{calls.signout++;return {};},signUp:async data=>{calls.signup.push(data);return {data:{session:{user:{id:'u'}}}};}},
 from:()=>({select:()=>({eq:()=>({single:async()=>({data:errorPerfil?null:{role,activo},error:errorPerfil?{}:null})})})})}});
 vm.runInContext(source,ctx);await new Promise(r=>setImmediate(r));
 el('email').value=' persona@example.test ';el('password').value='password123';
 return {ctx,el,calls,location,classes};
}
for(const role of ['revisor','editor_area','editor']){
 const f=await fixture({role});vm.runInContext("seleccionarAcceso('editorial')",f.ctx);
 assert(f.classes.get('btn-registro').has('oculto'));
 await f.el('btn-login').listeners.click();assert.equal(f.location.href,'dashboard.html');
 assert.equal(f.calls.signup.length,0);
}
{
 const f=await fixture();await f.el('btn-login').listeners.click();assert.equal(f.calls.signin,0);
 vm.runInContext("seleccionarAcceso('editorial')",f.ctx);
 await f.el('btn-registro').listeners.click();assert.equal(f.calls.signup.length,0);
 await f.el('btn-login').listeners.click();assert.equal(f.location.href,'index.html');
 assert(f.el('aviso-login').message.includes('rol de autor'));
 assert(!f.classes.get('acciones-cuenta').has('oculto'));
}
{
 const f=await fixture();vm.runInContext("seleccionarAcceso('autor')",f.ctx);
 assert(!f.classes.get('btn-registro').has('oculto'));
 await f.el('btn-registro').listeners.click();assert.equal(f.calls.signup.length,1);
 assert.equal(f.calls.signup[0].email,'persona@example.test');
 assert.equal(f.calls.signup[0].options.data.role,undefined);
}
{
 const f=await fixture({role:'editor_area',activo:false});vm.runInContext("seleccionarAcceso('editorial')",f.ctx);
 await f.el('btn-login').listeners.click();assert.equal(f.calls.signout,1);
 assert.equal(f.location.href,'index.html');assert(f.el('aviso-login').message.includes('inactivo'));
}
{
 const f=await fixture({role:'editor_area',session:{user:{id:'u'}}});assert.equal(f.location.href,'dashboard.html');
}
{
 const f=await fixture({errorPerfil:true});vm.runInContext("seleccionarAcceso('editorial')",f.ctx);
 await f.el('btn-login').listeners.click();assert.equal(f.location.href,'index.html');
 assert(f.el('aviso-login').message.includes('perfil'));
 assert(!f.el('btn-login').disabled);
}
// El archivo también se carga desde páginas sin formulario de acceso.
{
 const ctx=vm.createContext({document:{getElementById:()=>null,querySelectorAll:()=>[]}});
 vm.runInContext(source,ctx);
}
console.log('OK: selección, registro solo de autores, roles reales, aviso de discrepancia, perfil inactivo, sesión existente y uso compartido.');
