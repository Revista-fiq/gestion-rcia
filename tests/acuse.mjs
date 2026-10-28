import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create table profiles(id uuid primary key,role text,activo boolean default true,email text,areas_asignadas text[]);
create table manuscripts(id uuid primary key,folio text,titulo text,estado text default 'en_revision',area_tematica text,
 autor_correspondencia_id uuid,editor_area_asignado_id uuid);
create table review_assignments(id uuid primary key,manuscript_id uuid,reviewer_id uuid,estado text default 'entregada',respuesta_invitacion text);
create table reviews(id uuid primary key default gen_random_uuid(),assignment_id uuid unique,fecha_entrega timestamptz default now());
create table manuscript_exclusions(manuscript_id uuid,user_id uuid);
create table rcia_mail_settings(enabled boolean);insert into rcia_mail_settings values(true);
create table rcia_mail_queue(id uuid primary key default gen_random_uuid(),event_key text,event_type text,manuscript_id uuid,assignment_id uuid,
 recipient_id uuid,recipient_role text,event_state text,status text default 'pending',unique(event_key,recipient_id),
 constraint rcia_mail_queue_event_type_check check(event_type in ('author_receipt','new_submission','area_assignment','review_assignment','review_received','decision','review_response')));
create function rcia_enqueue_mail(k text,ev text,mid uuid,aid uuid,pid uuid,expected_role text,state text default null) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.rcia_mail_settings where enabled) then return;end if;
 if not exists(select 1 from public.profiles where id=pid and activo and role::text=expected_role)
 or exists(select 1 from public.manuscript_exclusions where manuscript_id=mid and user_id=pid) then return;end if;
 insert into public.rcia_mail_queue(event_key,event_type,manuscript_id,assignment_id,recipient_id,recipient_role,event_state)
 values(k,ev,mid,aid,pid,expected_role,state) on conflict(event_key,recipient_id) do nothing;end $$;
grant usage on schema public to service_role,authenticated,anon;`);
// Conservar y probar el contexto existente de fase 11, no un reemplazo ficticio.
const fase11=readFileSync('schema_fase11_invitaciones.sql','utf8');
const start=fase11.indexOf('create or replace function public.rcia_email_context');
const end=fase11.indexOf('$$;',start)+3;
await db.exec(fase11.slice(start,end));
await db.exec(readFileSync('schema_fase14_acuse_revisor.sql','utf8'));
await db.exec(readFileSync('schema_fase14_acuse_revisor.sql','utf8'));
const ids=Array.from({length:8},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
const [autor,revisor,area,editor,m,asig,asig2,asig3]=ids;
await db.query(`insert into profiles(id,role,email,areas_asignadas) values
($1,'autor','autor@example.test',null),($2,'revisor','corregido@example.test',null),
($3,'editor_area','area@example.test',array['Química']),($4,'editor','editor@example.test',null)`,ids.slice(0,4));
await db.query("insert into manuscripts(id,folio,titulo,area_tematica,autor_correspondencia_id,editor_area_asignado_id) values($1,'RCIA-TEST','Ensayo','Química',$2,$3)",[m,autor,area]);
async function setup(aid){
 await db.query('insert into review_assignments(id,manuscript_id,reviewer_id) values($1,$2,$3)',[aid,m,revisor]);
 await db.query("select rcia_enqueue_mail($1,'review_received',$2,$3,$4,'editor_area',null)",['original:'+aid,m,aid,area]);
 await db.query("select rcia_enqueue_mail($1,'review_received',$2,$3,$4,'editor',null)",['original:'+aid,m,aid,editor]);
 const rid=(await db.query('insert into reviews(assignment_id) values($1) returning id',[aid])).rows[0].id;
 const rows=(await db.query('select * from rcia_mail_queue where assignment_id=$1',[aid])).rows;
 return {rid,receipt:rows.find(q=>q.event_type==='review_receipt'),area:rows.find(q=>q.recipient_id===area),editor:rows.find(q=>q.recipient_id===editor)};
}
const context=async qid=>(await db.query('select rcia_email_context($1) as data',[qid])).rows[0].data;
const status=(qid,state)=>db.query('update rcia_mail_queue set status=$2 where id=$1',[qid,state]);
const a=await setup(asig);await status(a.receipt.id,'processing');
const payload=await context(a.receipt.id);
assert.equal(payload.email,'corregido@example.test');assert.equal(payload.cc_email,'area@example.test');assert.equal(payload.review_id,a.rid);assert(payload.fecha_entrega);
await status(a.area.id,'processing');assert.equal(await context(a.area.id),null);await status(a.area.id,'suppressed');
await status(a.editor.id,'processing');assert.equal((await context(a.editor.id)).email,'editor@example.test');
await status(a.editor.id,'accepted');
await status(a.receipt.id,'failed');
let fallback=(await db.query("select * from rcia_mail_queue where event_key=$1",['review-receipt-fallback:'+a.rid])).rows;
assert.equal(fallback.length,1);assert.equal(fallback[0].recipient_id,area);
await status(fallback[0].id,'processing');assert.equal((await context(fallback[0].id)).email,'area@example.test');
await status(fallback[0].id,'accepted');await status(a.receipt.id,'pending');await status(a.receipt.id,'failed');
assert.equal((await db.query("select * from rcia_mail_queue where event_key=$1",['review-receipt-fallback:'+a.rid])).rows.length,1);
await assert.rejects(db.query('insert into reviews(assignment_id) values($1)',[asig]));
assert.equal((await db.query("select * from rcia_mail_queue where assignment_id=$1 and event_type='review_receipt'",[asig])).rows.length,1);

// Orden inverso: el aviso del área todavía estaba processing al fallar el acuse.
const b=await setup(asig2);await status(b.receipt.id,'processing');await status(b.area.id,'processing');assert.equal(await context(b.area.id),null);
await status(b.receipt.id,'failed');assert.equal((await db.query("select * from rcia_mail_queue where event_key=$1",['review-receipt-fallback:'+b.rid])).rows.length,0);
await status(b.area.id,'suppressed');assert.equal((await db.query("select * from rcia_mail_queue where event_key=$1",['review-receipt-fallback:'+b.rid])).rows.length,1);

const c=await setup(asig3);await status(c.receipt.id,'processing');
await db.query('insert into manuscript_exclusions values($1,$2)',[m,area]);assert.equal((await context(c.receipt.id)).cc_email,null);
await db.exec('delete from manuscript_exclusions');
await db.query("update profiles set email='incorrecto' where id=$1",[area]);assert.equal((await context(c.receipt.id)).cc_email,null);
await db.query("update profiles set email='corregido@example.test' where id=$1",[area]);assert.equal((await context(c.receipt.id)).cc_email,null);
await db.query("update profiles set email='area@example.test',activo=false where id=$1",[area]);assert.equal((await context(c.receipt.id)).cc_email,null);
await db.query('update profiles set activo=true where id=$1',[area]);
await db.query('update profiles set activo=false where id=$1',[revisor]);assert.equal(await context(c.receipt.id),null);
await db.query('update profiles set activo=true where id=$1',[revisor]);
await db.query('insert into manuscript_exclusions values($1,$2)',[m,revisor]);assert.equal(await context(c.receipt.id),null);
await db.exec('delete from manuscript_exclusions');
await status(c.area.id,'processing');await status(c.area.id,'suppressed');await status(c.receipt.id,'uncertain');
assert.equal((await db.query("select * from rcia_mail_queue where event_key=$1",['review-receipt-fallback:'+c.rid])).rows.length,0);
assert.equal((await db.query("select * from rcia_mail_queue where event_type='review_receipt' and recipient_id=$1",[autor])).rows.length,0);
for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(context(c.receipt.id));await db.exec('reset role');}
await status(c.receipt.id,'processing');await db.exec('set role service_role');assert.equal((await context(c.receipt.id)).email,'corregido@example.test');await db.exec('reset role');
await db.exec('update rcia_mail_settings set enabled=false');assert.equal(await context(c.receipt.id),null);
await db.close();

// Ninguna petición real: Graph y las RPC se sustituyen por respuestas locales.
const source=readFileSync('supabase/functions/cia-mail-worker/index.ts','utf8');
const config={RCIA_MAIL_MODE:'live',RCIA_MAIL_WORKER_SECRET:'x'.repeat(40),SUPABASE_SERVICE_ROLE_KEY:'test-only-service-key',SUPABASE_URL:'https://db.example.test',MS_GRAPH_TENANT_ID:'00000000-0000-0000-0000-000000000001',MS_GRAPH_CLIENT_ID:'00000000-0000-0000-0000-000000000002',MS_GRAPH_CLIENT_SECRET:'test-only-client-secret',RCIA_TEST_RECIPIENT:'test@example.test'};
let handler;const api={};
const ctx=vm.createContext({console,URLSearchParams,AbortSignal,Response,Request,TextEncoder,Uint8Array,crypto:webcrypto,Intl,Date,fetch:async()=>{throw Error('red no autorizada')},Deno:{env:{get:n=>config[n]},serve:fn=>handler=fn},api});
vm.runInContext(source+'\napi.createGraphSender=createGraphSender;api.editorialMessage=editorialMessage;',ctx);
const sent=[];const request=async(url,options)=>{
 if(url.includes('oauth2'))return new Response(JSON.stringify({access_token:'test-token',expires_in:3600}),{status:200});
 sent.push(JSON.parse(options.body));return new Response(null,{status:202});
};
const send=api.createGraphSender(n=>config[n],request);
await send('reviewer@example.test','Acuse','Texto',['area@example.test']);
assert.equal(sent[0].message.toRecipients[0].emailAddress.address,'reviewer@example.test');assert.equal(sent[0].message.ccRecipients[0].emailAddress.address,'area@example.test');
await send('reviewer@example.test','Acuse','Texto',['REVIEWER@example.test']);assert.equal(sent[1].message.ccRecipients,undefined);
await assert.rejects(send('reviewer@example.test','Acuse','Texto',['bad\n@example.test']));
const testSend=api.createGraphSender(n=>({...config,RCIA_MAIL_MODE:'test'})[n],request);
await assert.rejects(testSend('test@example.test','Acuse','Texto',['real@example.test']));
const mssg=api.editorialMessage({...payload,comentarios_editor:'CONFIDENCIAL'});
assert(mssg.text.includes('guardado correctamente'));assert(mssg.text.includes('Fecha de registro:'));assert(!mssg.text.includes('CONFIDENCIAL'));
for(const ev of ['author_receipt','new_submission','area_assignment','review_assignment','review_received','review_response','decision'])assert(api.editorialMessage({...payload,event_type:ev,event_state:'aceptada'}).subject.includes('RCIA-UADY'));
assert.equal((await handler(new Request('https://worker.example.test',{method:'GET'}))).status,405);
assert.equal((await handler(new Request('https://worker.example.test',{method:'POST'}))).status,401);
const uncertain=api.createGraphSender(n=>config[n],async(url,options)=>{if(url.includes('oauth2'))return request(url,options);throw Error('timeout');});
await assert.rejects(uncertain('reviewer@example.test','Acuse','Texto'),e=>e.kind==='uncertain');
const throttled=api.createGraphSender(n=>config[n],async(url,options)=>url.includes('oauth2')?request(url,options):new Response(null,{status:429,headers:{'retry-after':'120'}}));
await assert.rejects(throttled('reviewer@example.test','Acuse','Texto'),e=>e.kind==='pending' && e.retryAfter===120);
// Recorrido completo de la función Edge: reserva, contexto, Graph y finish.
let fullHandler;let claims=0;let finished=null;let envelope=null;
const mockFetch=async(url,options)=>{
 if(url.includes('/rcia_claim_email'))return new Response(JSON.stringify(claims++===0?[{id:'qid',claim_token:'claim'}]:[]));
 if(url.includes('/rcia_email_context'))return new Response(JSON.stringify(payload));
 if(url.includes('/rcia_finish_email')){finished=JSON.parse(options.body);return new Response('null');}
 if(url.includes('/oauth2/'))return new Response(JSON.stringify({access_token:'test-token',expires_in:3600}));
 if(url.includes('/sendMail')){envelope=JSON.parse(options.body);return new Response(null,{status:202});}
 throw Error('Petición inesperada');
};
const full=vm.createContext({URLSearchParams,AbortSignal,Response,Request,TextEncoder,Uint8Array,crypto:webcrypto,Intl,Date,
 fetch:mockFetch,Deno:{env:{get:n=>config[n]},serve:fn=>fullHandler=fn}});
vm.runInContext(source,full);
const result=await fullHandler(new Request('https://worker.example.test',{method:'POST',headers:{'x-rcia-worker-secret':config.RCIA_MAIL_WORKER_SECRET}}));
assert.equal(result.status,200);assert.equal((await result.json()).processed,1);
assert.equal(envelope.message.ccRecipients[0].emailAddress.address,'area@example.test');
assert.equal(finished.result_status,'accepted');assert.equal(finished.claim,'claim');
console.log('OK: acuse, CC real, privacidad, contexto heredado, duplicados, respaldo por fallo, modo prueba y errores Graph.');
