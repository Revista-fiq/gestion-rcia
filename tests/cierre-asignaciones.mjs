import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();const file=p=>readFileSync(p,'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
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
await db.exec(file('schema_fase9_correos.sql'));
await db.exec('update rcia_mail_settings set enabled=true');
await db.exec(file('schema_fase11_invitaciones.sql'));
await db.exec(file('schema_fase13_estados.sql'));
await db.exec(file('schema_fase13_estados.sql'));
await db.exec(file('schema_fase14_acuse_revisor.sql'));
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

await db.exec(file('schema_fase12_reenviar_invitacion.sql'));
await db.exec(file('schema_cierre_asignaciones_1_estado.sql'));
await db.exec(file('schema_cierre_asignaciones_2_funciones.sql'));
await db.exec(file('schema_cierre_asignaciones_2_funciones.sql'));
// Verificar el candado incluso si hay una política heredada que permite UPDATE al jefe.
await db.exec("create policy test_editor_update on review_assignments for update to authenticated using(public.current_role_name()='editor') with check(public.current_role_name()='editor')");
const m=await manuscript(),a1=await assign(m,r1),a2=await assign(m,r2),a3=await assign(m,r3);
const nota='La revisora no pudo acceder y fue sustituida por el revisor asignado.';
const close=(aid=a3,why='sustitucion',text=nota,sub=a2)=>db.query('select rcia_cerrar_asignacion($1,$2,$3,$4) r',[aid,why,text,sub]);
await response(r1,a1);await response(r2,a2);await submit(r1,a1);await submit(r2,a2);
assert.equal(await state(m),'en_revision');
await db.query("update profiles set areas_asignadas=array['Biotecnología'] where id=$1",[otraArea]);
for(const user of [autor,r1,r2,r3,otraArea])await as(user,()=>assert.rejects(close()));
await as(editor,()=>assert.rejects(close(a1))); // entregada no se puede cerrar.
await as(editor,()=>assert.rejects(close(a3,'sustitucion',nota,null)));
await as(editor,()=>assert.rejects(close(a3,'sustitucion',nota,a3)));
await as(editor,()=>assert.rejects(close(a3,'sustitucion','corto',a2)));
await as(editor,()=>assert.rejects(db.query("update review_assignments set estado='cerrada' where id=$1",[a3])));
const other=await manuscript(),foreign=await assign(other,r4);
await as(editor,()=>assert.rejects(close(a3,'sustitucion',nota,foreign)));
await as(editor,()=>db.query('select rcia_guardar_exclusion($1,$2,true)',[m,area]));
await as(area,()=>assert.rejects(close()));
await as(editor,()=>db.query('select rcia_guardar_exclusion($1,$2,false)',[m,area]));
await db.query('update manuscripts set editor_area_asignado_id=$1 where id=$2',[area,m]);
await db.query('update profiles set activo=false where id=$1',[area]);
await as(area,()=>assert.rejects(close()));
await db.query('update profiles set activo=true where id=$1',[area]);
const mailCount=(await db.query('select count(*) n from rcia_mail_queue')).rows[0].n;
const result=await as(area,()=>close());assert(result.rows[0].r.cerrada);
assert.equal(await state(m),'dictamen_emitido');
const original=(await db.query('select * from review_assignments where id=$1',[a3])).rows[0];
assert.equal(original.estado,'cerrada');assert.equal(original.respuesta_invitacion,null);assert.equal(original.fecha_respuesta_invitacion,null);
assert.equal((await db.query('select count(*) n from reviews')).rows[0].n,2);
assert.equal((await db.query('select count(*) n from rcia_mail_queue')).rows[0].n,mailCount);
assert.equal((await db.query("select count(*) n from rcia_mail_queue where assignment_id=$1 and status='pending' and event_type='review_assignment'",[a3])).rows[0].n,0);
assert((await as(area,()=>close())).rows[0].r.repetida);
await as(editor,()=>assert.rejects(close(a3,'sin_respuesta','Un motivo diferente al registrado.',null)));
await as(r3,()=>assert.rejects(db.query('select rcia_responder_invitacion($1,true,null)',[a3])));
await as(editor,()=>assert.rejects(db.query('select rcia_reenviar_invitacion($1,gen_random_uuid())',[a3])));
await assert.rejects(submit(r3,a3));
await as(editor,()=>assert.rejects(db.query("update review_assignments set estado='pendiente' where id=$1",[a3])));
await assert.rejects(db.query('delete from review_assignments where id=$1',[a3]));
const own=(await as(r3,()=>db.query('select rcia_mis_asignaciones() r'))).rows[0].r.find(x=>x.id===a3);
assert.equal(own.estado,'cerrada');assert.equal(own.manuscripts_blind.archivo_manuscrito_url,null);
assert(!JSON.stringify(own).includes(nota));assert(!JSON.stringify(own).includes('sustituta'));
for(const user of [autor,r1,r3,otraArea])await as(user,()=>assert.rejects(db.query('select rcia_cierres_del_manuscrito($1)',[m])));
const audit=(await as(area,()=>db.query('select rcia_cierres_del_manuscrito($1) r',[m]))).rows[0].r[0];
assert.equal(audit.cerrado_por,'Área');assert.equal(audit.estado_anterior,'pendiente');assert.equal(audit.sustituta_id,a2);
await as(area,()=>assert.rejects(db.query('update rcia_cierres_asignacion set observaciones=$1',[nota])));
await as(r3,()=>assert.rejects(db.query('select rcia_mis_asignaciones_antes_cierre()')));
await db.query("update rcia_mail_queue set status='processing' where assignment_id=$1 and event_type='review_assignment'",[a3]);
const qid=(await db.query("select id from rcia_mail_queue where assignment_id=$1 and event_type='review_assignment' limit 1",[a3])).rows[0]?.id;
if(qid)assert.equal((await db.query('select rcia_email_context($1) r',[qid])).rows[0].r,null);
// Una invitación aceptada también puede cerrarse; conservar la respuesta auténtica.
const acc=await manuscript(),ax=await assign(acc,r4);
await response(r4,ax);await as(editor,()=>close(ax,'retiro_editorial','Retiro acordado por el equipo editorial.',null));
assert.equal((await db.query('select respuesta_invitacion from review_assignments where id=$1',[ax])).rows[0].respuesta_invitacion,'aceptada');
await response(r4,ax).then(()=>assert.fail('No debe aceptar de nuevo'),()=>{});
await assert.rejects(submit(r4,ax));
assert.equal(await state(acc),'en_revision'); // Cerrar no crea el dictamen faltante.
console.log('PASS: cierre auditado, sustituto del mismo manuscrito, permisos exactos, inactividad/conflicto, idempotencia, dictámenes intactos, conteo de pendientes y privacidad del revisor; sin avisos nuevos.');
await db.close();

