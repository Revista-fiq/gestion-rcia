import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();const file=p=>readFileSync(p,'utf8');
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth,storage to authenticated;
grant select,insert,update on storage.objects to authenticated;`);
await db.exec(file('schema_rcia_gestion.sql'));
await db.exec("alter type user_role add value 'editor_area'");
for(const p of ['tests/fixtures/fase2.sql','tests/fixtures/fase3.sql','tests/fixtures/storage.sql','schema_fase4_revision.sql'])await db.exec(file(p));
// La columna existe en producción; su migración de origen no está versionada.
await db.exec('alter table manuscripts add column editor_area_asignado_id uuid references profiles');
for(const p of ['schema_fase7_conflictos.sql','schema_fase8_antecedentes.sql'])await db.exec(file(p));
// Contrato mínimo de correo para cargar fase 11. No valida el worker real.
await db.exec(`create table rcia_mail_settings(enabled boolean); insert into rcia_mail_settings values(true);
create table rcia_mail_queue(id uuid default gen_random_uuid(),event_key text,event_type text,
 manuscript_id uuid,assignment_id uuid,recipient_id uuid,recipient_role text,event_state text,status text default 'pending',
 constraint rcia_mail_queue_event_type_check check(event_type in ('review_assignment')));
create function rcia_enqueue_mail(k text,ev text,mid uuid,aid uuid,pid uuid,expected_role text,state text default null)
 returns void language sql as $$ insert into public.rcia_mail_queue(event_key,event_type,manuscript_id,assignment_id,recipient_id,recipient_role,event_state)
 values(k,ev,mid,aid,pid,expected_role,state) $$;`);
await db.exec(file('schema_fase11_invitaciones.sql'));
await db.exec(file('schema_fase13_estados.sql'));
await db.exec(file('schema_fase13_estados.sql'));
await db.exec('grant select,insert,update on all tables in schema public to authenticated');
const ids=Array.from({length:8},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
const [autor,editor,area,otraArea,r1,r2,r3,r4]=ids;
await db.query(`insert into auth.users select unnest($1::uuid[])`,[ids]);
await db.query(`insert into profiles(id,role,nombre_completo,email,areas_asignadas) values
($1,'autor','Autor','autor@test',null),($2,'editor','Editor','editor@test',null),
($3,'editor_area','Área','area@test',array['Biotecnología']),($4,'editor_area','Otra','otra@test',array['Alimentos']),
($5,'revisor','R1','r1@test',null),($6,'revisor','R2','r2@test',null),($7,'revisor','R3','r3@test',null),($8,'revisor','R4','r4@test',null)`,ids);
async function as(user,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec("reset role;select set_config('request.jwt.claim.sub','',false)");}}
let seq=0;
async function manuscript({anon=true,assigned=true}={}){
 return (await db.query(`insert into manuscripts(folio,titulo,tipo,area_tematica,autor_correspondencia_id,archivo_manuscrito_url,archivo_anonimizado_url,editor_area_asignado_id)
 values($1,'Ensayo','articulo_original','Biotecnología',$2,'original.docx',$3,$4) returning id`,['TEST-'+(++seq),autor,anon?'anon.pdf':null,assigned?area:null])).rows[0].id;
}
async function assign(m,r){return (await db.query('insert into review_assignments(manuscript_id,reviewer_id) values($1,$2) returning id',[m,r])).rows[0].id;}
const state=async m=>(await db.query('select estado from manuscripts where id=$1',[m])).rows[0].estado;
const response=(r,a,accept=true)=>as(r,()=>db.query('select rcia_responder_invitacion($1,$2,null)',[a,accept]));
async function submit(r,a,ethical=true){return as(r,()=>db.query(`insert into reviews(assignment_id,decision,filtro_etica,filtro_plagio,filtro_interes,criterios,puntaje_total,necesita_segunda_revision,dispuesto_segunda_revision)
 values($1,'rechazar',$2,true,true,$3,0,'No','No aplica')`,[a,ethical,JSON.stringify(Array.from({length:8},(_,i)=>({num:i+1,puntaje:4})))]));}
const m=await manuscript();const a1=await assign(m,r1),a2=await assign(m,r2),a3=await assign(m,r3);
assert.equal(await state(m),'recibido');
await response(r1,a1);assert.equal(await state(m),'en_revision');
assert.equal((await db.query("select count(*)::int as n from status_log where manuscript_id=$1 and estado_nuevo='en_revision'",[m])).rows[0].n,1);
await response(r1,a1);assert.equal(await state(m),'en_revision');
await response(r2,a2);await submit(r1,a1);assert.equal(await state(m),'en_revision');
await as(r2,()=>assert.rejects(db.query(`insert into reviews(assignment_id,decision,filtro_etica,filtro_plagio,filtro_interes,criterios) values($1,'rechazar',true,true,true,'[]')`,[a2])));
assert.equal((await db.query('select estado from review_assignments where id=$1',[a2])).rows[0].estado,'aceptada');
await submit(r2,a2);assert.equal(await state(m),'en_revision'); // Tercera invitación pendiente.
await response(r3,a3,false);assert.equal(await state(m),'dictamen_emitido');
const log=(await db.query("select notas from status_log where manuscript_id=$1 and estado_nuevo='dictamen_emitido'",[m])).rows;
assert.equal(log.length,1);assert(log[0].notas.includes('Automático'));
await assert.rejects(assign(m,r4)); // Reabrir explícitamente antes de otra invitación.
assert.equal((await db.query('select count(*)::int as n from reviews')).rows[0].n,2);
await as(r1,()=>assert.rejects(db.query('select rcia_actualizar_estado_revision($1)',[m])));

const missing=await manuscript({anon:false});const am=await assign(missing,r1);
await response(r1,am);assert.equal(await state(missing),'recibido');
await db.query("update manuscripts set archivo_anonimizado_url='anon.pdf' where id=$1",[missing]);assert.equal(await state(missing),'en_revision');
const noeditor=await manuscript({assigned:false});const ae=await assign(noeditor,r1);
await response(r1,ae);assert.equal(await state(noeditor),'recibido');
await db.query('update manuscripts set editor_area_asignado_id=$1 where id=$2',[area,noeditor]);assert.equal(await state(noeditor),'en_revision');

const configurable=await manuscript();const ac=await assign(configurable,r1);
await db.query("update manuscripts set estado='en_correccion' where id=$1",[configurable]);
await as(autor,()=>assert.rejects(db.query('update manuscripts set dictamenes_requeridos=1 where id=$1',[configurable])));
await db.query("update manuscripts set estado='recibido' where id=$1",[configurable]);
await as(otraArea,async()=>assert.equal((await db.query('update manuscripts set dictamenes_requeridos=1 where id=$1 returning id',[configurable])).rows.length,0));
await as(area,()=>db.query('update manuscripts set dictamenes_requeridos=1 where id=$1',[configurable]));
await response(r1,ac);await submit(r1,ac,false);assert.equal(await state(configurable),'dictamen_emitido');
assert.equal((await db.query('select estado from manuscripts where id=$1',[configurable])).rows[0].estado,'dictamen_emitido'); // Rechazo ético no rechaza automáticamente el manuscrito.

for(const estado of ['en_correccion','aceptado','publicado','rechazado','desistido']){
 const cerrado=await manuscript();const ax=await assign(cerrado,r4);
 await db.query('update manuscripts set estado=$1 where id=$2',[estado,cerrado]);
 if(estado==='en_correccion'){await response(r4,ax);await submit(r4,ax);}else await response(r4,ax).then(()=>assert.fail('Debe rechazar proceso cerrado'),()=>{});
 assert.equal(await state(cerrado),estado);
}
// Una marca entregada sin dictamen ni antecedente no completa la revisión.
const vacio=await manuscript();await db.query('update manuscripts set dictamenes_requeridos=1 where id=$1',[vacio]);
const av=await assign(vacio,r1);await db.query("update review_assignments set estado='entregada' where id=$1",[av]);assert.equal(await state(vacio),'recibido');
await db.query(`insert into editorial_antecedents(manuscript_id,assignment_id,tipo,fecha_documento,ruta,registrado_por)
 values($1,$2,'dictamen',current_date,$3,$4)`,[vacio,av,vacio+'/dictamen.pdf',editor]);
assert.equal(await state(vacio),'dictamen_emitido');
console.log('OK: fases reales 4/7/8/11/13, aceptación, entrega diferida, umbral, pendientes, bitácora, permisos y estados humanos.');
await db.close();
