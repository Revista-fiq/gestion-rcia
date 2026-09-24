import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source=readFileSync('js/password.js','utf8');
async function setup({user={id:'a',email:'test@example.test'},error=null,throwUpdate=false}={}){
 const els={};let calls=0,payload;
 const element=id=>els[id]??=( {value:'',hidden:true,disabled:false,textContent:'',focus(){},addEventListener(type,fn){this[type]=fn},reset(){['password-actual','password-nueva','password-confirmar'].forEach(id=>element(id).value='')}} );
 let active=user;
 const context=vm.createContext({document:{getElementById:element},window:{location:{}},db:{auth:{getUser:async()=>({data:{user:active}}),updateUser:async p=>{calls++;payload=p;if(throwUpdate)throw Error('network');return {error}}}}});
 vm.runInContext(source,context);await new Promise(r=>setImmediate(r));
 element('password-actual').value='Temporal123';element('password-nueva').value='Privada456';element('password-confirmar').value='Privada456';
 return {els,element,context,get calls(){return calls},get payload(){return payload},switchUser(u){active=u},submit:()=>element('form-password').submit({preventDefault(){}})};
}
let t=await setup();t.element('password-confirmar').value='Otra';await t.submit();assert.equal(t.calls,0);assert.match(t.element('aviso-password').textContent,/no coinciden/);
t=await setup();t.element('password-nueva').value='short';await t.submit();assert.equal(t.calls,0);
t=await setup();await t.submit();assert.equal(t.calls,1);assert.equal(t.payload.current_password,'Temporal123');assert.equal(t.payload.password,'Privada456');assert.equal(t.element('password-nueva').value,'');assert.match(t.element('aviso-password').textContent,/correctamente/);
t=await setup({user:null});assert.equal(t.context.window.location.href,'index.html');await t.submit();assert.equal(t.calls,0);
t=await setup();t.switchUser({id:'b'});await t.submit();assert.equal(t.calls,0);assert.equal(t.element('form-password').hidden,true);
t=await setup({error:{code:'invalid_credentials'}});await t.submit();assert.match(t.element('aviso-password').textContent,/no es correcta/);assert.equal(t.element('guardar-password').disabled,false);
t=await setup({throwUpdate:true});await t.submit();assert.match(t.element('aviso-password').textContent,/No se pudo confirmar/);assert.equal(t.element('guardar-password').disabled,false);
console.log('OK: validación, confirmación, éxito, sesión ausente/cambiada, error de credenciales y fallo de red. Sin modificar cuentas reales.');

