import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const file = p => readFileSync(p, 'utf8').replace(/^\uFEFF/,'');
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth,storage to authenticated;
grant select,insert,update on storage.objects to authenticated;`);
await db.exec(file('schema_rcia_gestion.sql'));
await db.exec("alter type user_role add value 'editor_area'");
await db.exec(file('tests/fixtures/fase2.sql'));
await db.exec(file('tests/fixtures/fase3.sql'));
await db.exec(file('tests/fixtures/storage.sql'));
await db.exec(file('schema_fase4_revision.sql'));
await db.exec('grant select,insert,update on all tables in schema public to authenticated');
const ids = Array.from({length:7},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
const [autor,revisor,otro,editor,man,asig,asig2]=ids;
await db.exec(`insert into auth.users values('${autor}'),('${revisor}'),('${otro}'),('${editor}');
insert into profiles(id,role,nombre_completo,email,areas_asignadas) values
('${autor}','autor','Autor','a@example.test',null),('${revisor}','revisor','Revisor','r@example.test',null),
('${otro}','revisor','Otro','o@example.test',null),('${editor}','editor_area','Editor','e@example.test',array['Química']);
insert into manuscripts(id,folio,titulo,tipo,area_tematica,autor_correspondencia_id,archivo_manuscrito_url,archivo_anonimizado_url)
values('${man}','TEST','Ensayo','articulo_original','Química','${autor}','original.docx',
'https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/manuscritos-anonimizados/${man}/anon.pdf');
insert into review_assignments(id,manuscript_id,reviewer_id) values('${asig}','${man}','${revisor}'),('${asig2}','${man}','${otro}');
insert into storage.objects(bucket_id,name) values('manuscritos-anonimizados','${man}/anon.pdf'),('manuscritos-anonimizados','${man}/viejo.pdf'),('manuscritos','${autor}/original.docx');`);
async function as(user, fn){
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
 try {return await fn();} finally {await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");}
}

await db.exec(file('schema_fase6_corregir_perfiles.sql'));
await db.exec('alter table manuscripts add column editor_area_asignado_id uuid references profiles(id)');
await db.exec(file('schema_fase7_conflictos.sql'));
await db.exec(file('schema_fase8_antecedentes.sql'));
await db.exec('create role service_role');
await db.exec(file('schema_fase9_correos.sql'));
await db.exec('update rcia_mail_settings set enabled=true');
const chief='10000000-0000-0000-0000-000000000001';
await db.exec(`insert into auth.users values('${chief}');insert into profiles(id,role,nombre_completo,email) values('${chief}','editor','Editor','chief@test');`);
const ruta=man+'/dictamen.pdf',privado=man+'/privado.pdf',final=man+'/final.docx';
for(const name of [ruta,privado,final])await as(chief,()=>db.query("insert into storage.objects(bucket_id,name) values('antecedentes-editoriales',$1)",[name]));
const register=(aid,clase,visible,path)=>db.query('select rcia_registrar_antecedente($1,$2,$3,$4,$5,$6)',[man,aid,clase,visible,'2026-09-01',path]);
await as(editor,()=>assert.rejects(register(asig,'dictamen',true,ruta)));
await as(chief,()=>register(asig,'dictamen',true,ruta));
assert.equal((await db.query('select estado from review_assignments where id=$1',[asig])).rows[0].estado,'entregada');
assert.equal((await db.query('select * from reviews')).rows.length,0);
await as(chief,()=>assert.rejects(register(asig,'dictamen',true,ruta)));
await as(chief,()=>assert.rejects(db.query("update manuscripts set estado='aceptado' where id=$1",[man])));
await as(chief,()=>register(asig2,'dictamen',false,privado));
await as(chief,()=>register(null,'version_corregida',true,final));
assert.equal((await db.query('select * from manuscript_versions')).rows.length,1);
assert.equal((await db.query('select archivo_anonimizado_url from manuscripts')).rows[0].archivo_anonimizado_url,null);
await as(autor,async()=>{
 assert.equal((await db.query('select * from editorial_antecedents')).rows.length,2);
 const files=(await db.query("select name from storage.objects where bucket_id='antecedentes-editoriales' order by name")).rows.map(x=>x.name);
 assert.deepEqual(files,[ruta,final].sort());
});
await as(revisor,async()=>assert.equal((await db.query('select * from editorial_antecedents')).rows.length,0));
await as(chief,()=>db.query('select rcia_guardar_exclusion($1,$2,true)',[man,editor]));
await as(editor,async()=>{
 assert.equal((await db.query('select * from editorial_antecedents')).rows.length,0);
 assert.equal((await db.query("select * from storage.objects where bucket_id='antecedentes-editoriales'")).rows.length,0);
});
const previo='20000000-0000-0000-0000-000000000001';
await db.exec(`insert into auth.users values('${previo}');insert into profiles(id,role,nombre_completo,email) values('${previo}','revisor','Revisor previo','previo@test');`);
const archivoPrevio=man+'/historico.pdf';
await as(chief,()=>db.query("insert into storage.objects(bucket_id,name) values('antecedentes-editoriales',$1)",[archivoPrevio]));
const registrarPrevio=uid=>db.query('select rcia_registrar_antecedente($1,null,$2,false,$3,$4,$5)',[man,'dictamen','2026-09-01',archivoPrevio,uid]);
await as(chief,()=>assert.rejects(registrarPrevio(autor)));
await as(revisor,()=>assert.rejects(registrarPrevio(previo)));
const mailsAntes=(await db.query('select count(*) n from rcia_mail_queue')).rows[0].n;
await as(chief,()=>registrarPrevio(previo));
assert.equal((await db.query('select count(*) n from rcia_mail_queue')).rows[0].n,mailsAntes);
assert.equal((await db.query('select estado from review_assignments where reviewer_id=$1',[previo])).rows[0].estado,'entregada');
await as(chief,()=>assert.rejects(registrarPrevio(previo)));
assert.equal((await db.query('select * from reviews')).rows.length,0);
await as(chief,()=>db.query("update manuscripts set estado='aceptado' where id=$1",[man]));
const accepted=(await db.query('select fecha_aceptacion from manuscripts')).rows[0].fecha_aceptacion;assert(accepted);
await as(chief,()=>assert.rejects(db.query("update manuscripts set fecha_aceptacion='2000-01-01' where id=$1",[man])));
await as(chief,()=>assert.rejects(register(null,'version_corregida',true,final)));
assert.deepEqual((await db.query('select fecha_aceptacion from manuscripts')).rows[0].fecha_aceptacion,accepted);
console.log('PASS: external import, assignment closure, no fake review, final version history, private/author files, conflict exclusion, acceptance guard and fixed date.');

await db.exec(file('schema_constancias_enviadas.sql'));
await db.exec(file('schema_constancias_enviadas.sql'));
const marca=()=>db.query("select rcia_marcar_constancia_enviada($1,current_date)",[asig]);
for(const uid of [autor,revisor,editor])await as(uid,()=>assert.rejects(marca()));
await as(chief,marca);await as(chief,marca);
assert.equal((await db.query('select count(*) n from rcia_constancias_enviadas')).rows[0].n,1);
await as(chief,()=>assert.rejects(db.query("select rcia_marcar_constancia_enviada($1,current_date+1)",[asig])));
await as(autor,()=>assert.rejects(db.query('select rcia_estado_constancias($1)',[man])));
await as(chief,()=>db.query('select rcia_guardar_exclusion($1,$2,false)',[man,editor]));
await db.query('update manuscripts set editor_area_asignado_id=$1 where id=$2',[editor,man]);
assert.equal((await as(editor,()=>db.query('select rcia_estado_constancias($1) r',[man]))).rows[0].r.length,3);
await as(editor,()=>assert.rejects(db.query('insert into rcia_constancias_enviadas(assignment_id,fecha_envio,registrado_por) values($1,current_date,$2)',[asig2,editor])));
console.log('PASS: registro manual solo jefe, lectura asociado asignado, privacidad, fechas e idempotencia.');
// Descarga privada y validación: probar también frente a políticas heredadas amplias.
const mailsAntesConstancias=(await db.query('select count(*) n from rcia_mail_queue')).rows[0].n;
await db.exec('alter table storage.buckets add column file_size_limit bigint; alter table storage.buckets add column allowed_mime_types text[]; grant delete on storage.objects to authenticated');
await db.exec(file('schema_constancias_descarga.sql'));
await db.exec(file('schema_constancias_descarga.sql'));
await db.exec('create policy legacy_wide on storage.objects for all to authenticated using(true) with check(true)');
const pdf=asig+'/30000000-0000-0000-0000-000000000001.pdf';
const pdf2=asig+'/30000000-0000-0000-0000-000000000002.pdf';
const hash='a'.repeat(64), hash2='b'.repeat(64);
const upload=(path)=>db.query("insert into storage.objects(bucket_id,name) values('constancias-revision',$1)",[path]);
const prep=(aid=asig,path=pdf,h=hash)=>db.query('select rcia_preparar_constancia($1,$2,$3)',[aid,path,h]);
const approve=(path=pdf,h=hash)=>db.query('select rcia_validar_constancia($1,$2,$3)',[asig,path,h]);
const own=()=>db.query('select rcia_listar_constancias() r');
const list=()=>db.query('select rcia_listar_constancias($1) r',[man]);
const visible=()=>db.query("select name from storage.objects where bucket_id='constancias-revision'");
assert.equal((await db.query("select public from storage.buckets where id='constancias-revision'")).rows[0].public,false);
for(const uid of [autor,revisor,otro,editor]) {
 await as(uid,()=>assert.rejects(upload(pdf)));
 await as(uid,()=>assert.rejects(prep()));
 await as(uid,()=>assert.rejects(approve()));
}
await as(chief,()=>assert.rejects(prep())); // file absent
await as(chief,()=>upload(pdf));
await as(chief,()=>assert.rejects(prep(asig2,pdf))); // cross-assignment
await as(chief,()=>prep());await as(chief,()=>prep());
assert.equal((await db.query('select count(*) n from rcia_constancias')).rows[0].n,1);
for(const uid of [autor,revisor,otro,editor]) assert.equal((await as(uid,visible)).rows.length,0);
assert.equal((await as(revisor,own)).rows[0].r.length,0);
assert.equal((await as(editor,list)).rows[0].r[0].ruta,null);
assert.equal((await as(chief,visible)).rows.length,1);
await as(chief,()=>upload(pdf2));
await as(chief,()=>prep(asig,pdf2,hash2));
await as(chief,()=>assert.rejects(approve())); // stale preview
await as(chief,()=>approve(pdf2,hash2));
const stamp=(await db.query('select validado_en from rcia_constancias')).rows[0].validado_en;
await as(chief,()=>approve(pdf2,hash2));
assert.deepEqual((await db.query('select validado_en from rcia_constancias')).rows[0].validado_en,stamp);
assert.equal((await as(revisor,own)).rows[0].r.length,1);
assert.equal((await as(otro,own)).rows[0].r.length,0);
assert.equal((await as(autor,own)).rows[0].r.length,0);
assert.deepEqual((await as(revisor,visible)).rows.map(x=>x.name),[pdf2]);
assert.equal((await as(otro,visible)).rows.length,0);
assert.equal((await as(editor,visible)).rows.length,1);
await as(chief,()=>assert.rejects(prep())); // immutable
await as(chief,()=>assert.rejects(upload(asig+'/30000000-0000-0000-0000-000000000003.pdf')));
for(const uid of [chief,revisor,editor]) {
 await as(uid,async()=>{
  assert.equal((await db.query("delete from storage.objects where bucket_id='constancias-revision' returning name")).rows.length,0);
  assert.equal((await db.query("update storage.objects set name='changed.pdf' where bucket_id='constancias-revision' returning name")).rows.length,0);
  await assert.rejects(db.query('update rcia_constancias set validado_en=now()'));
 });
}
await db.query('update profiles set activo=false where id=$1',[revisor]);
assert.equal((await as(revisor,own)).rows[0].r.length,0);
assert.equal((await as(revisor,visible)).rows.length,0);
await db.query('update profiles set activo=true where id=$1',[revisor]);
await as(chief,()=>db.query('select rcia_guardar_exclusion($1,$2,true)',[man,editor]));
assert.equal((await as(editor,visible)).rows.length,0);
await as(editor,()=>assert.rejects(list()));
// Sin avisos ni marcas de envío adicionales por publicar una constancia.
assert.equal((await db.query('select count(*) n from rcia_mail_queue')).rows[0].n,mailsAntesConstancias);
assert.equal((await db.query('select count(*) n from rcia_constancias_enviadas')).rows[0].n,1);
console.log('PASS: PDF privado, validación exclusiva, borrador oculto, aislamiento por revisor, borrador obsoleto, idempotencia, inmutabilidad, cuentas inactivas y conflictos; sin correo automático.');
const man2='40000000-0000-0000-0000-000000000001',a3='40000000-0000-0000-0000-000000000002';
await db.query(`insert into manuscripts(id,folio,titulo,tipo,area_tematica,autor_correspondencia_id,archivo_manuscrito_url,archivo_anonimizado_url)
values($1,'TEST-2','Otro manuscrito','articulo_original','Química',$2,'original.docx','anon.pdf')`,[man2,autor]);
await db.query('insert into review_assignments(id,manuscript_id,reviewer_id) values($1,$2,$3)',[a3,man2,revisor]);
const third=a3+'/30000000-0000-0000-0000-000000000003.pdf';
await as(chief,()=>assert.rejects(upload(third))); // pending, no evidence
await as(revisor,()=>db.query(`insert into reviews(assignment_id,decision,filtro_etica,filtro_plagio,filtro_interes,criterios,puntaje_total,necesita_segunda_revision,dispuesto_segunda_revision)
values($1,'rechazar',false,true,true,null,0,'No','No aplica')`,[a3]));
await as(chief,()=>upload(third));await as(chief,()=>prep(a3,third,hash));
await as(chief,()=>db.query('select rcia_validar_constancia($1,$2,$3)',[a3,third,hash]));
assert.equal((await as(revisor,own)).rows[0].r.length,2);
assert.deepEqual((await as(revisor,own)).rows[0].r.map(x=>x.folio).sort(),['TEST','TEST-2']);
assert.equal((await as(otro,own)).rows[0].r.length,0);
await as(revisor,()=>assert.rejects(list()));
await db.exec('grant usage on schema storage,auth to anon; grant select on storage.objects to anon; create policy legacy_anon on storage.objects for select to anon using(true); set role anon');
try {
 await assert.rejects(db.query('select rcia_listar_constancias()'));
 const anonVisible=await db.query("select name from storage.objects where bucket_id='constancias-revision'");
 assert.equal(anonVisible.rows.length,0);
}finally{await db.exec('reset role');}
console.log('PASS: dictamen del formulario, asignación sin dictamen bloqueada, dos constancias para la misma persona y acceso anónimo denegado.');
await db.close();



