-- Requiere fases 4, 7, 9 y 11. Ejecutar antes de publicar el panel.
-- Reutiliza review_assignment y rcia_enqueue_mail: no cambia el worker.
begin;
create table if not exists public.rcia_invitation_resends (
 request_id uuid primary key,
 assignment_id uuid not null references public.review_assignments(id),
 requested_by uuid not null references public.profiles(id),
 requested_at timestamptz not null default now()
);
create index if not exists rcia_invitation_resends_assignment_time
 on public.rcia_invitation_resends(assignment_id,requested_at desc);
alter table public.rcia_invitation_resends enable row level security;
revoke all on public.rcia_invitation_resends from public, anon, authenticated;

create or replace function public.rcia_reenviar_invitacion(aid uuid, solicitud uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 a public.review_assignments;
 m public.manuscripts;
 editor public.profiles;
 revisor public.profiles;
 anterior public.rcia_invitation_resends;
begin
 if auth.uid() is null or solicitud is null then raise exception 'Solicitud no válida.'; end if;
 select * into editor from public.profiles where id=auth.uid() and activo;
 if not found or editor.role not in ('editor','editor_area') then
  raise exception 'Solo el equipo editorial autorizado puede reenviar invitaciones.';
 end if;
 -- Serializa reenvíos y respuestas sobre la misma asignación.
 select * into strict a from public.review_assignments where id=aid for update;
 select * into strict m from public.manuscripts where id=a.manuscript_id for share;
 if not public.rcia_sin_conflicto(m.id)
 or (editor.role='editor_area' and not coalesce(m.area_tematica=any(editor.areas_asignadas),false)) then
  raise exception 'No tienes permiso sobre este manuscrito.';
 end if;
 select * into strict revisor from public.profiles where id=a.reviewer_id;
 if revisor.role<>'revisor' or not revisor.activo or nullif(btrim(revisor.email),'') is null
 or exists(select 1 from public.manuscript_exclusions where manuscript_id=m.id and user_id=revisor.id) then
  raise exception 'Revisa el perfil activo, el correo y los conflictos del revisor.';
 end if;
 -- Reintentar la misma solicitud no crea un segundo correo.
 select * into anterior from public.rcia_invitation_resends where request_id=solicitud;
 if found then
  if anterior.assignment_id<>aid or anterior.requested_by<>auth.uid() then
   raise exception 'La solicitud ya pertenece a otra operación.';
  end if;
  return jsonb_build_object('registrada',true,'repetida',true,'email',revisor.email);
 end if;
 if a.estado<>'pendiente' or a.respuesta_invitacion is not null then
  raise exception 'Solo se reenvían invitaciones pendientes de respuesta.';
 end if;
 if m.estado in ('aceptado','publicado','rechazado','desistido') then
  raise exception 'El proceso editorial de este manuscrito está cerrado.';
 end if;
 if not exists(select 1 from public.rcia_mail_settings where enabled) then
  raise exception 'Los avisos por correo no están habilitados.';
 end if;
 if exists(select 1 from public.rcia_invitation_resends where assignment_id=aid
  and requested_at>now()-interval '5 minutes') then
  raise exception 'Ya se solicitó un reenvío. Espera cinco minutos antes de solicitar otro.';
 end if;
 insert into public.rcia_invitation_resends(request_id,assignment_id,requested_by)
 values(solicitud,aid,auth.uid());
 perform public.rcia_enqueue_mail('resend:'||solicitud,'review_assignment',m.id,aid,revisor.id,'revisor',null);
 return jsonb_build_object('registrada',true,'repetida',false,'email',revisor.email);
end $$;
revoke all on function public.rcia_reenviar_invitacion(uuid,uuid) from public,anon;
grant execute on function public.rcia_reenviar_invitacion(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
