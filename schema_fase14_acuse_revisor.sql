-- Fase 14. Desplegar PRIMERO el worker actualizado en la función existente.
-- Requiere fase 11 y la cola/worker de fase 9. No cambia dictámenes históricos.
begin;
do $$ declare regla text; begin
 if to_regprocedure('public.rcia_enqueue_mail(text,text,uuid,uuid,uuid,text,text)') is null
 or to_regprocedure('public.rcia_email_context(uuid)') is null then
  raise exception 'Faltan las funciones de correo existentes. No reinstales otras fases.';
 end if;
 select pg_get_expr(conbin,conrelid) into regla from pg_constraint
 where conrelid='public.rcia_mail_queue'::regclass and conname='rcia_mail_queue_event_type_check';
 if regla is null then raise exception 'No se encontró la restricción de eventos de la cola.'; end if;
 if position('review_receipt' in regla)=0 then
  alter table public.rcia_mail_queue drop constraint rcia_mail_queue_event_type_check;
  execute format('alter table public.rcia_mail_queue add constraint rcia_mail_queue_event_type_check check ((%s) or event_type=%L)',regla,'review_receipt');
 end if;
 -- Conserva la implementación viva; no reemplaza sus reglas para otros avisos.
 if to_regprocedure('public.rcia_email_context_before_fase14(uuid)') is null then
  alter function public.rcia_email_context(uuid) rename to rcia_email_context_before_fase14;
 end if;
end $$;

create or replace function public.rcia_contexto_acuse_revision(qid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',btrim(p.email),'folio',m.folio,'titulo',m.titulo,
  'event_type','review_receipt','event_state',q.event_state,'review_id',r.id,'fecha_entrega',r.fecha_entrega,
  'cc_id',case when ed.id is not null then ed.id else null end,
  'cc_email',case when ed.id is not null then btrim(ed.email) else null end)
 from public.rcia_mail_queue q
 join public.review_assignments a on a.id=q.assignment_id and a.manuscript_id=q.manuscript_id and a.reviewer_id=q.recipient_id
 join public.reviews r on r.assignment_id=a.id and q.event_key='review-receipt:'||r.id::text
 join public.manuscripts m on m.id=a.manuscript_id
 join public.profiles p on p.id=a.reviewer_id and p.activo and p.role='revisor'
 left join public.profiles ed on ed.id=m.editor_area_asignado_id and ed.activo and ed.role='editor_area'
  and m.area_tematica=any(ed.areas_asignadas)
  and btrim(ed.email) ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
  and length(btrim(ed.email))<255 and lower(btrim(ed.email))<>lower(btrim(p.email))
  and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=m.id and x.user_id=ed.id)
 where q.id=qid and q.event_type='review_receipt' and q.recipient_role='revisor'
  and q.status::text in ('pending','processing','accepted','uncertain') and a.estado='entregada'
  and btrim(p.email) ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
  and length(btrim(p.email))<255
  and exists(select 1 from public.rcia_mail_settings where enabled)
  and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=m.id and x.user_id=p.id);
$$;

create or replace function public.rcia_email_context(qid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.rcia_mail_queue; contexto jsonb;
begin
 select * into q from public.rcia_mail_queue where id=qid;
 if not found then return null; end if;
 if q.event_type='review_receipt' then
  if q.status::text<>'processing' then return null; end if;
  return public.rcia_contexto_acuse_revision(qid);
 end if;
 contexto:=public.rcia_email_context_before_fase14(qid);
 if contexto is null then return null; end if;
 -- El editor de área recibe el mismo acuse en CC, no otro aviso duplicado.
 if q.event_type='review_received' and q.recipient_role='editor_area'
 and q.event_key not like 'review-receipt-fallback:%' and exists(
  select 1 from public.rcia_mail_queue ac
  where ac.assignment_id=q.assignment_id and ac.manuscript_id=q.manuscript_id and ac.event_type='review_receipt'
  and public.rcia_contexto_acuse_revision(ac.id)->>'cc_id'=q.recipient_id::text
 ) then return null; end if;
 return contexto;
end $$;

create or replace function public.rcia_encolar_acuse_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.review_assignments;
begin
 select * into strict a from public.review_assignments where id=new.assignment_id;
 perform public.rcia_enqueue_mail('review-receipt:'||new.id,'review_receipt',a.manuscript_id,a.id,a.reviewer_id,'revisor',null);
 return new;
end $$;
drop trigger if exists rcia_acuse_revision on public.reviews;
create trigger rcia_acuse_revision after insert on public.reviews
for each row execute function public.rcia_encolar_acuse_revision();

-- Si el acuse falla de forma definitiva, conserva el aviso editorial del área.
-- No reintenta envíos de resultado incierto: podrían haber sido aceptados.
create or replace function public.rcia_resguardar_aviso_area(aid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare dato record;
begin
 select m.id as mid,ed.id as pid,r.id as rid into dato
 from public.review_assignments a join public.reviews r on r.assignment_id=a.id
 join public.manuscripts m on m.id=a.manuscript_id
 join public.profiles ed on ed.id=m.editor_area_asignado_id and ed.activo and ed.role='editor_area'
 where a.id=aid and m.area_tematica=any(ed.areas_asignadas)
 and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=m.id and x.user_id=ed.id)
 and exists(select 1 from public.rcia_mail_queue q where q.event_key='review-receipt:'||r.id::text
  and q.event_type='review_receipt' and q.status::text='failed')
 and not exists(select 1 from public.rcia_mail_queue q where q.assignment_id=a.id
  and q.recipient_id=ed.id and q.event_type='review_received' and q.status::text in ('pending','processing','accepted'));
 if found then
  perform public.rcia_enqueue_mail('review-receipt-fallback:'||dato.rid,'review_received',dato.mid,aid,dato.pid,'editor_area',null);
 end if;
end $$;
create or replace function public.rcia_resguardar_aviso_area_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.rcia_resguardar_aviso_area(new.assignment_id);
 return new;
end $$;
drop trigger if exists rcia_resguardo_aviso_area on public.rcia_mail_queue;
create trigger rcia_resguardo_aviso_area after update of status on public.rcia_mail_queue
for each row when(new.status is distinct from old.status and new.event_type in ('review_receipt','review_received')
 and new.status::text in ('failed','suppressed'))
execute function public.rcia_resguardar_aviso_area_trigger();

revoke all on function public.rcia_email_context_before_fase14(uuid) from public,anon,authenticated,service_role;
revoke all on function public.rcia_contexto_acuse_revision(uuid) from public,anon,authenticated,service_role;
revoke all on function public.rcia_encolar_acuse_revision() from public,anon,authenticated,service_role;
revoke all on function public.rcia_resguardar_aviso_area(uuid) from public,anon,authenticated,service_role;
revoke all on function public.rcia_resguardar_aviso_area_trigger() from public,anon,authenticated,service_role;
revoke all on function public.rcia_email_context(uuid) from public,anon,authenticated;
grant execute on function public.rcia_email_context(uuid) to service_role;
notify pgrst,'reload schema';
commit;
-- Sin reenvíos retroactivos. Solo nuevas filas válidas de reviews.
