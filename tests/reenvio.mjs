import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const db = new PGlite();
const file = p => readFileSync(p,'utf8');
// Contrato mínimo de fase 9: el SQL y worker reales no están en el repo.
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated;
create type user_role as enum('autor','revisor','editor','editor_area');
create type assignment_status as enum('pendiente','aceptada','declinada','entregada');
create table profiles(id uuid primary key,role user_role,activo boolean default true,email text,areas_asignadas text[]);
create table manuscripts(id uuid primary key,area_tematica text,estado text);
create table review_assignments(id uuid primary key,manuscript_id uuid references manuscripts,reviewer_id uuid references profiles,
 estado assignment_status default 'pendiente',respuesta_invitacion text);
create table manuscript_exclusions(manuscript_id uuid,user_id uuid);
create function rcia_sin_conflicto(mid uuid) returns boolean language sql as $$
 select not exists(select 1 from public.manuscript_exclusions where manuscript_id=mid and user_id=auth.uid()) $$;
create table rcia_mail_settings(enabled boolean); insert into rcia_mail_settings values(true);
create table rcia_mail_queue(event_key text unique,event_type text,manuscript_id uuid,assignment_id uuid,recipient_id uuid,recipient_role text,event_state text);
create function rcia_enqueue_mail(k text,e text,m uuid,a uuid,p uuid,r text,s text) returns void language sql as $$
 insert into public.rcia_mail_queue values(k,e,m,a,p,r,s) on conflict do nothing $$;`);
await db.exec(file('schema_fase12_reenviar_invitacion.sql'));
await db.exec(file('schema_fase12_reenviar_invitacion.sql')); // Instalación repetible.
const ids=Array.from({length:12},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
const [editor,area,otraArea,revisor,autor,man,aid,req1,req2,req3,req4,req5]=ids;
await db.query(`insert into profiles(id,role,email,areas_asignadas) values
($1,'editor','editor@test',null),($2,'editor_area','area@test',array['Química']),
($3,'editor_area','otra@test',array['Alimentos']),($4,'revisor','mal@test',null),($5,'autor','autor@test',null)`,ids.slice(0,5));
await db.query("insert into manuscripts values($1,'Química','en_revision')",[man]);
await db.query('insert into review_assignments(id,manuscript_id,reviewer_id) values($1,$2,$3)',[aid,man,revisor]);
async function as(uid,fn){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 await db.exec('set role authenticated');
 try{return await fn();}finally{await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");}
}
const resend=(req=req1)=>db.query('select rcia_reenviar_invitacion($1,$2) as data',[aid,req]);
for(const u of [revisor,autor,otraArea]) await as(u,()=>assert.rejects(resend()));
await db.query('insert into manuscript_exclusions values($1,$2)',[man,editor]);
await as(editor,()=>assert.rejects(resend()));
await db.exec('delete from manuscript_exclusions');
await db.query('update profiles set email=$1 where id=$2',['corregido@test',revisor]);
const result=await as(editor,()=>resend());
assert.equal(result.rows[0].data.email,'corregido@test');
assert.equal((await as(editor,()=>resend())).rows[0].data.repetida,true);
assert.equal((await db.query('select * from rcia_mail_queue')).rows.length,1);
assert.equal((await db.query('select estado from review_assignments')).rows[0].estado,'pendiente');
await as(area,()=>assert.rejects(resend(req2))); // Cooldown compartido entre editores.
await as(area,()=>assert.rejects(resend(req1))); // No reutilizar claves de otro editor.
await db.exec("update rcia_invitation_resends set requested_at=now()-interval '6 minutes'");
await as(area,()=>resend(req2));
for(const estado of ['aceptada','declinada','entregada']) {
 await db.query('update review_assignments set estado=$1',[estado]);
 await as(editor,()=>assert.rejects(resend(req3)));
}
await db.exec("update review_assignments set estado='pendiente'; update rcia_invitation_resends set requested_at=now()-interval '6 minutes'");
for(const estado of ['aceptado','publicado','rechazado','desistido']) {
 await db.query('update manuscripts set estado=$1',[estado]);
 await as(editor,()=>assert.rejects(resend(req3)));
}
await db.exec("update manuscripts set estado='en_revision'; update rcia_mail_settings set enabled=false");
await as(editor,()=>assert.rejects(resend(req3)));
await db.exec('update rcia_mail_settings set enabled=true');
await db.query('update profiles set activo=false where id=$1',[revisor]);
await as(editor,()=>assert.rejects(resend(req3)));
await db.query('update profiles set activo=true where id=$1',[revisor]);
await db.query('update profiles set email=$1 where id=$2',[' ',revisor]);
await as(editor,()=>assert.rejects(resend(req3)));
await db.query('update profiles set email=$1 where id=$2',['corregido@test',revisor]);
await db.query('insert into manuscript_exclusions values($1,$2)',[man,revisor]);
await as(editor,()=>assert.rejects(resend(req3)));
await db.exec('delete from manuscript_exclusions');
await db.query('update profiles set activo=false where id=$1',[editor]);
await as(editor,()=>assert.rejects(resend(req3)));
await db.query('update profiles set activo=true where id=$1',[editor]);
await as(editor,()=>assert.rejects(db.query('select * from rcia_invitation_resends')));
// Un fallo en la cola revierte también el registro de la solicitud.
await db.exec(`create or replace function rcia_enqueue_mail(k text,e text,m uuid,a uuid,p uuid,r text,s text) returns void
 language plpgsql as $$ begin raise exception 'cola no disponible'; end $$;`);
await as(editor,()=>assert.rejects(resend(req4)));
assert.equal((await db.query('select * from rcia_invitation_resends where request_id=$1',[req4])).rows.length,0);
await db.close();

// Una respuesta de red perdida conserva la misma clave en el reintento.
const alerts=[], calls=[];
let loseResponse=true;
const ctx=vm.createContext({console,Set,Map,crypto:{randomUUID:()=>req5},
 document:{},confirm:()=>true,alert:s=>alerts.push(s),
 db:{auth:{getUser:async()=>({data:{user:{id:editor}}})},rpc:async(name,args)=>{
 calls.push({name,args}); if(loseResponse){loseResponse=false;throw new Error('sin conexión');}
 return {data:{registrada:true,email:'corregido@test'}};
 }}});
vm.runInContext(file('js/dashboard.js').replace(/^iniciarPanel\(\);$/m,''),ctx);
vm.runInContext(`rolPanelActual='editor'; usuarioPanelActual='${editor}';`,ctx);
ctx.aid=aid;ctx.boton={disabled:false};
await vm.runInContext('reenviarInvitacion(aid,boton)',ctx);
assert.equal(ctx.boton.disabled,false);
await vm.runInContext('reenviarInvitacion(aid,boton)',ctx);
assert.equal(calls.length,2);
assert.equal(calls[0].args.solicitud,calls[1].args.solicitud);
assert(alerts.at(-1).includes('corregido@test'));
console.log('OK: permisos, conflictos, correo corregido, idempotencia, cooldown, estados, rollback y reintento de red.');
