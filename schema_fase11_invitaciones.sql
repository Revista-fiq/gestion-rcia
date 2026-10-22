-- Requiere fases 4, 7 y 9. Desplegar primero el worker actualizado.
begin;
alter table public.review_assignments add column if not exists respuesta_invitacion text check(respuesta_invitacion in ('aceptada','declinada'));
alter table public.review_assignments add column if not exists fecha_respuesta_invitacion timestamptz;
alter table public.review_assignments add column if not exists motivo_declinacion text;
alter table public.rcia_mail_queue drop constraint rcia_mail_queue_event_type_check;
alter table public.rcia_mail_queue add constraint rcia_mail_queue_event_type_check check(event_type in ('author_receipt','new_submission','area_assignment','review_assignment','review_received','decision','review_response'));
create or replace function public.rcia_responder_invitacion(aid uuid, aceptar boolean, motivo text default null)
returns text language plpgsql security definer set search_path='' as $$
declare a public.review_assignments; m public.manuscripts; p record; respuesta text;
begin
 if aceptar is null or auth.uid() is null then raise exception 'Respuesta no válida.'; end if;
 select * into strict a from public.review_assignments where id=aid for update;
 if a.reviewer_id<>auth.uid() or not exists(select 1 from public.profiles where id=auth.uid() and role='revisor' and activo)
 or not public.rcia_sin_conflicto(a.manuscript_id) then raise exception 'No tienes acceso a esta invitación.'; end if;
 select * into strict m from public.manuscripts where id=a.manuscript_id;
 if m.estado in ('aceptado','publicado','rechazado','desistido') then raise exception 'El proceso editorial de este manuscrito está cerrado.'; end if;
 respuesta:=case when aceptar then 'aceptada' else 'declinada' end;
 if a.respuesta_invitacion=respuesta then return respuesta; end if;
 if a.estado<>'pendiente' then raise exception 'La invitación ya tiene respuesta o dictamen. Contacta al editor si necesitas cambiarla.'; end if;
 if length(coalesce(motivo,''))>1000 then raise exception 'El motivo admite hasta 1000 caracteres.'; end if;
 update public.review_assignments set estado=respuesta::public.assignment_status,
 respuesta_invitacion=respuesta,fecha_respuesta_invitacion=now(),fecha_respuesta=now(),
 motivo_declinacion=case when aceptar then null else nullif(btrim(motivo),'') end where id=aid;
 for p in select id,role::text as role from public.profiles where activo and
 (role='editor' or (role='editor_area' and id=m.editor_area_asignado_id)) loop
 perform public.rcia_enqueue_mail('response:'||aid,'review_response',m.id,aid,p.id,p.role,respuesta);
 end loop;
 return respuesta;
end $$;
revoke all on function public.rcia_responder_invitacion(uuid,boolean,text) from public,anon;
grant execute on function public.rcia_responder_invitacion(uuid,boolean,text) to authenticated;
-- Candado adicional: también protege el envío por URL directa o API.
create or replace function public.rcia_exigir_invitacion_aceptada() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.review_assignments;
begin
 select * into strict a from public.review_assignments where id=new.assignment_id for update;
 if a.estado<>'aceptada' then raise exception 'Primero acepta la invitación desde tu panel de revisor.'; end if;
 return new;
end $$;
create trigger aaa_rcia_exigir_invitacion_aceptada before insert on public.reviews
for each row execute function public.rcia_exigir_invitacion_aceptada();
create or replace function public.rcia_email_context(qid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',p.email,'folio',m.folio,'titulo',m.titulo,'event_type',q.event_type,'event_state',q.event_state)
 from public.rcia_mail_queue q join public.manuscripts m on m.id=q.manuscript_id
 join public.profiles p on p.id=q.recipient_id
 where q.id=qid and q.status='processing' and p.activo and p.role::text=q.recipient_role
 and exists(select 1 from public.rcia_mail_settings where enabled)
 and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=m.id and x.user_id=p.id)
 and (
 (q.event_type in ('author_receipt','decision') and m.autor_correspondencia_id=p.id and p.role='autor'
  and (q.event_type<>'decision' or m.estado::text=q.event_state))
 or (q.event_type='new_submission' and p.role='editor')
 or (q.event_type='area_assignment' and m.editor_area_asignado_id=p.id and p.role='editor_area')
 or (q.event_type='review_assignment' and exists(select 1 from public.review_assignments a where a.id=q.assignment_id
   and a.manuscript_id=m.id and a.reviewer_id=p.id and a.estado in ('pendiente','aceptada')))
 or (q.event_type='review_response' and exists(select 1 from public.review_assignments a where a.id=q.assignment_id and a.manuscript_id=m.id and a.respuesta_invitacion=q.event_state) and (p.role='editor' or (p.role='editor_area' and m.editor_area_asignado_id=p.id)))
 or (q.event_type='review_received' and exists(select 1 from public.review_assignments a where a.id=q.assignment_id and a.manuscript_id=m.id and a.estado='entregada')
   and (p.role='editor' or (p.role='editor_area' and m.editor_area_asignado_id=p.id)))
 );
$$;

notify pgrst,'reload schema';
commit;

