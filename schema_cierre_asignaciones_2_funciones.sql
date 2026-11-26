-- PASO 2. Requiere paso 1 confirmado y fases 7, 8, 9, 11, 12 y 13 existentes.
-- No cierra asignaciones históricas durante la instalación.
begin;
do $$ begin
 if to_regprocedure('public.rcia_actualizar_estado_revision(uuid)') is null
 or to_regprocedure('public.rcia_reenviar_invitacion(uuid,uuid)') is null
 or not exists(select 1 from pg_enum where enumtypid='public.assignment_status'::regtype and enumlabel='cerrada')
 then raise exception 'Ejecuta el paso 1 por separado y comprueba las fases 12 y 13.'; end if;
end $$;
create table if not exists public.rcia_cierres_asignacion (
 assignment_id uuid primary key references public.review_assignments(id),
 motivo text not null check(motivo in ('sustitucion','sin_respuesta','retiro_editorial')),
 observaciones text not null check(length(btrim(observaciones)) between 10 and 2000),
 estado_anterior public.assignment_status not null check(estado_anterior in ('pendiente','aceptada')),
 sustituta_id uuid references public.review_assignments(id),
 cerrado_por uuid not null references public.profiles(id),
 cerrado_en timestamptz not null default now(),
 check((motivo='sustitucion')=(sustituta_id is not null)),
 check(sustituta_id is distinct from assignment_id)
);
alter table public.rcia_cierres_asignacion enable row level security;
revoke all on public.rcia_cierres_asignacion from public,anon,authenticated;

create or replace function public.rcia_puede_cerrar_asignacion(mid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.manuscripts m join public.profiles p on p.id=auth.uid()
 where m.id=mid and p.activo and public.rcia_sin_conflicto(mid)
 and (p.role='editor' or (p.role='editor_area' and m.editor_area_asignado_id=p.id)));
$$;
revoke all on function public.rcia_puede_cerrar_asignacion(uuid) from public,anon,authenticated;

create or replace function public.rcia_proteger_cierre_asignacion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.estado='cerrada' then raise exception 'Se conserva el historial de la asignación cerrada.'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.estado='cerrada' and new is distinct from old then
  raise exception 'La asignación cerrada conserva su historial y no puede reabrirse ni modificarse.';
 end if;
 if new.estado='cerrada' and not exists(select 1 from public.rcia_cierres_asignacion where assignment_id=new.id)
 then raise exception 'Utiliza Cerrar asignación para registrar motivo, observaciones y responsable.'; end if;
 return new;
end $$;
drop trigger if exists rcia_proteger_cierre on public.review_assignments;
create trigger rcia_proteger_cierre before insert or update or delete on public.review_assignments
for each row execute function public.rcia_proteger_cierre_asignacion();
revoke all on function public.rcia_proteger_cierre_asignacion() from public,anon,authenticated;

create or replace function public.rcia_cerrar_asignacion(aid uuid,motivo_cierre text,nota text,sustituta uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare a public.review_assignments; m public.manuscripts; previo public.rcia_cierres_asignacion; mid uuid;
begin
 select manuscript_id into strict mid from public.review_assignments where id=aid;
 -- Mismo orden de bloqueo que una entrega: manuscrito antes de asignación.
 select * into strict m from public.manuscripts where id=mid for update;
 if not public.rcia_puede_cerrar_asignacion(mid) then raise exception 'Solo el editor en jefe o el editor de área asignado, activos y sin conflicto, pueden cerrar esta asignación.'; end if;
 select * into strict a from public.review_assignments where id=aid for update;
 nota:=btrim(nota);
 select * into previo from public.rcia_cierres_asignacion where assignment_id=aid;
 if found then
  if previo.motivo is not distinct from motivo_cierre and previo.observaciones is not distinct from nota
  and previo.sustituta_id is not distinct from sustituta then
   return jsonb_build_object('cerrada',true,'repetida',true);
  end if;
  raise exception 'La asignación ya fue cerrada; no se modifica su historial.';
 end if;
 if m.estado in ('aceptado','publicado','rechazado','desistido') then raise exception 'El proceso editorial ya está cerrado.'; end if;
 if a.estado not in ('pendiente','aceptada') or exists(select 1 from public.reviews where assignment_id=aid)
 or exists(select 1 from public.editorial_antecedents where assignment_id=aid and tipo='dictamen')
 then raise exception 'Solo se cierran asignaciones pendientes o aceptadas sin dictamen registrado.'; end if;
 if motivo_cierre is null or motivo_cierre not in ('sustitucion','sin_respuesta','retiro_editorial')
 or nota is null or length(nota) not between 10 and 2000
 then raise exception 'Selecciona un motivo y escribe observaciones de 10 a 2000 caracteres.'; end if;
 if motivo_cierre='sustitucion' then
  if sustituta is null or sustituta=aid or not exists(
   select 1 from public.review_assignments b join public.profiles p on p.id=b.reviewer_id
   where b.id=sustituta and b.manuscript_id=mid and b.reviewer_id<>a.reviewer_id
   and b.estado in ('pendiente','aceptada','entregada') and p.activo and p.role='revisor'
   and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=mid and x.user_id=p.id))
  then raise exception 'Selecciona otra asignación vigente del mismo manuscrito como sustituta.'; end if;
 elsif sustituta is not null then raise exception 'El revisor sustituto solo corresponde al motivo Sustitución.'; end if;
 insert into public.rcia_cierres_asignacion(assignment_id,motivo,observaciones,estado_anterior,sustituta_id,cerrado_por)
 values(aid,motivo_cierre,nota,a.estado,sustituta,auth.uid());
 -- No se fabrica una respuesta de invitación ni una entrega del revisor.
 update public.review_assignments set estado='cerrada' where id=aid;
 update public.rcia_mail_queue set status='suppressed',last_code='assignment_closed',finished_at=now()
 where assignment_id=aid and status='pending' and event_type in ('review_assignment','review_response');
 -- Fase 13 cuenta solo pendiente/aceptada como pendientes. Una cerrada no suma dictamen.
 perform public.rcia_actualizar_estado_revision(mid);
 return jsonb_build_object('cerrada',true,'repetida',false);
end $$;

create or replace function public.rcia_cierres_del_manuscrito(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.rcia_puede_cerrar_asignacion(mid) then raise exception 'Sin autorización para consultar el historial editorial de cierre.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('assignment_id',c.assignment_id,'motivo',c.motivo,
 'observaciones',c.observaciones,'estado_anterior',c.estado_anterior,'sustituta_id',c.sustituta_id,
 'cerrado_por',p.nombre_completo,'cerrado_en',c.cerrado_en,'nombre_revisor',r.nombre_completo,
 'nombre_sustituto',s.nombre_completo) order by c.cerrado_en),'[]'::jsonb)
 from public.rcia_cierres_asignacion c join public.review_assignments a on a.id=c.assignment_id
 join public.profiles p on p.id=c.cerrado_por join public.profiles r on r.id=a.reviewer_id
 left join public.review_assignments b on b.id=c.sustituta_id left join public.profiles s on s.id=b.reviewer_id
 where a.manuscript_id=mid);
end $$;
revoke all on function public.rcia_cerrar_asignacion(uuid,text,text,uuid),public.rcia_cierres_del_manuscrito(uuid) from public,anon;
grant execute on function public.rcia_cerrar_asignacion(uuid,text,text,uuid),public.rcia_cierres_del_manuscrito(uuid) to authenticated;

-- Conserva la implementación viva de las funciones existentes y añade límites.
do $$ begin
 if to_regprocedure('public.rcia_responder_invitacion_antes_cierre(uuid,boolean,text)') is null then
  alter function public.rcia_responder_invitacion(uuid,boolean,text) rename to rcia_responder_invitacion_antes_cierre;
 end if;
 if to_regprocedure('public.rcia_reenviar_invitacion_antes_cierre(uuid,uuid)') is null then
  alter function public.rcia_reenviar_invitacion(uuid,uuid) rename to rcia_reenviar_invitacion_antes_cierre;
 end if;
 if to_regprocedure('public.rcia_mis_asignaciones_antes_cierre()') is null then
  alter function public.rcia_mis_asignaciones() rename to rcia_mis_asignaciones_antes_cierre;
 end if;
 if to_regprocedure('public.rcia_email_context_antes_cierre(uuid)') is null then
  alter function public.rcia_email_context(uuid) rename to rcia_email_context_antes_cierre;
 end if;
end $$;

create or replace function public.rcia_responder_invitacion(aid uuid,aceptar boolean,motivo text default null)
returns text language plpgsql security definer set search_path='' as $$
declare a public.review_assignments; mid uuid;
begin
 select manuscript_id into strict mid from public.review_assignments where id=aid;
 perform 1 from public.manuscripts where id=mid for update;
 select * into strict a from public.review_assignments where id=aid for update;
 if a.estado='cerrada' then raise exception 'Esta asignación fue cerrada por el equipo editorial.'; end if;
 return public.rcia_responder_invitacion_antes_cierre(aid,aceptar,motivo);
end $$;
create or replace function public.rcia_reenviar_invitacion(aid uuid,solicitud uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.review_assignments; mid uuid;
begin
 select manuscript_id into strict mid from public.review_assignments where id=aid;
 perform 1 from public.manuscripts where id=mid for update;
 select * into strict a from public.review_assignments where id=aid for update;
 if a.estado='cerrada' then raise exception 'No se reenvían invitaciones de asignaciones cerradas.'; end if;
 return public.rcia_reenviar_invitacion_antes_cierre(aid,solicitud);
end $$;
create or replace function public.rcia_mis_asignaciones() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when item->>'estado'='cerrada'
 then jsonb_set(item,'{manuscripts_blind,archivo_manuscrito_url}','null'::jsonb) else item end order by pos),'[]'::jsonb)
 from jsonb_array_elements(public.rcia_mis_asignaciones_antes_cierre()) with ordinality x(item,pos);
$$;
create or replace function public.rcia_email_context(qid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from public.rcia_mail_queue q join public.review_assignments a on a.id=q.assignment_id
 where q.id=qid and a.estado='cerrada' and q.event_type in ('review_assignment','review_response')) then return null; end if;
 return public.rcia_email_context_antes_cierre(qid);
end $$;
revoke all on function public.rcia_responder_invitacion_antes_cierre(uuid,boolean,text),public.rcia_reenviar_invitacion_antes_cierre(uuid,uuid),
 public.rcia_mis_asignaciones_antes_cierre(),public.rcia_email_context_antes_cierre(uuid) from public,anon,authenticated,service_role;
revoke all on function public.rcia_responder_invitacion(uuid,boolean,text),public.rcia_reenviar_invitacion(uuid,uuid),public.rcia_mis_asignaciones() from public,anon;
grant execute on function public.rcia_responder_invitacion(uuid,boolean,text),public.rcia_reenviar_invitacion(uuid,uuid),public.rcia_mis_asignaciones() to authenticated;
revoke all on function public.rcia_email_context(uuid) from public,anon,authenticated;
grant execute on function public.rcia_email_context(uuid) to service_role;
notify pgrst,'reload schema';
commit;
