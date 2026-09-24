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
await as(revisor,async()=>{
 assert.equal((await db.query('select * from manuscripts')).rows.length,0);
 const rows=(await db.query('select rcia_mis_asignaciones() as data')).rows[0].data;
 assert.equal(rows.length,1); assert.equal(rows[0].id,asig);
 assert(!JSON.stringify(rows).includes(autor));
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 await assert.rejects(db.exec("update profiles set role='editor' where id=auth.uid()"));
 assert.equal((await db.query("update review_assignments set estado='entregada' returning id")).rows.length,0);
});
const criteria=score=>Array.from({length:8},(_,i)=>({num:i+1,puntaje:score,titulo:'Criterio',comentario:'Comentario'}));
async function submit(a,score=4,ethical=true){return db.query(`insert into reviews(assignment_id,decision,filtro_etica,filtro_plagio,filtro_interes,criterios,puntaje_total,necesita_segunda_revision,dispuesto_segunda_revision,comentarios_editor)
 values($1,'rechazar',$2,true,true,$3,0,'No','Sí','PRIVADO') returning *`,[a,ethical,JSON.stringify(criteria(score))]);}
await as(otro,()=>assert.rejects(submit(asig)));
await as(revisor,()=>assert.rejects(submit(asig,5)));
assert.equal((await db.query('select estado from review_assignments where id=$1',[asig])).rows[0].estado,'pendiente');
await as(revisor,async()=>{
 const r=(await submit(asig)).rows[0]; assert.equal(r.puntaje_total,32);assert.equal(r.decision,'aceptar');assert.equal(r.dispuesto_segunda_revision,'No aplica');
 await assert.rejects(submit(asig));
});
assert.equal((await db.query('select estado from review_assignments where id=$1',[asig])).rows[0].estado,'entregada');
await as(autor,async()=>assert.equal((await db.query('select * from reviews')).rows.length,0));
await as(editor,async()=>assert.equal((await db.query('select * from reviews')).rows[0].comentarios_editor,'PRIVADO'));
await as(otro,async()=>{const r=(await submit(asig2,4,false)).rows[0];assert.equal(r.decision,'rechazar');assert.equal(r.puntaje_total,0)});
await db.exec(`update review_assignments set estado='declinada' where id='${asig2}'`);
await as(otro,async()=>{assert.equal((await db.query('select * from storage.objects')).rows.length,0);await assert.rejects(submit(asig2));});
console.log('OK: aislamiento de asignaciones y autoría, archivo vigente, roles, validación, entrega atómica, duplicados, ética, confidencialidad y editor de área.');
await db.close();
