-- Fase 13: estados de seguimiento. Requiere fases 4, 7, 8 y 11.
-- No modifica decisiones editoriales, dictámenes ni el worker de correo.
-- Ejecutar completo; no ejecutar nuevamente el esquema inicial.
begin;
do $$ begin
 if to_regclass('public.editorial_antecedents') is null
 or to_regprocedure('public.rcia_sin_conflicto(uuid)') is null
 or to_regprocedure('public.rcia_responder_invitacion(uuid,boolean,text)') is null then
  raise exception 'Comprueba las fases 7, 8 y 11 antes de instalar la fase 13.';
 end if;
end $$;
alter table public.manuscripts add column if not exists dictamenes_requeridos integer not null default 2
 check(dictamenes_requeridos between 1 and 10);

-- Ni el autor ni un revisor pueden reducir el umbral por API.
create or replace function public.rcia_proteger_umbral_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new; end if;
 if (tg_op='INSERT' and new.dictamenes_requeridos=2)
 or (tg_op='UPDATE' and new.dictamenes_requeridos is not distinct from old.dictamenes_requeridos) then return new; end if;
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.activo
 and (p.role='editor' or (p.role='editor_area' and new.area_tematica=any(p.areas_asignadas))))
 or not public.rcia_sin_conflicto(new.id) then
  raise exception 'Solo un editor autorizado puede definir los dictámenes requeridos.';
 end if;
 return new;
end $$;
drop trigger if exists rcia_proteger_umbral_revision on public.manuscripts;
create trigger rcia_proteger_umbral_revision before insert or update on public.manuscripts
for each row execute function public.rcia_proteger_umbral_revision();

-- Se conserva el search_path de las funciones heredadas de bitácora.
-- Todas las consultas propias usan nombres calificados.
create or replace function public.rcia_actualizar_estado_revision(mid uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare m public.manuscripts; aceptadas integer; completos integer; pendientes integer;
 destino public.manuscript_status; razon text; logid uuid;
begin
 select * into m from public.manuscripts where id=mid for update;
 if not found or m.estado not in ('recibido','acuse_enviado','en_revision') then return; end if;
 if nullif(btrim(m.archivo_anonimizado_url),'') is null or not exists(
 select 1 from public.profiles p where p.id=m.editor_area_asignado_id and p.activo
 and p.role='editor_area' and m.area_tematica=any(p.areas_asignadas)
 and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=m.id and x.user_id=p.id)) then return; end if;

 select count(*) filter(where a.estado='aceptada' and p.activo and p.role='revisor' and x.user_id is null),
 count(*) filter(where a.estado='entregada' and x.user_id is null and (
 exists(select 1 from public.reviews r where r.assignment_id=a.id)
 or exists(select 1 from public.editorial_antecedents e where e.assignment_id=a.id and e.manuscript_id=m.id and e.tipo='dictamen'))),
 count(*) filter(where a.estado in ('pendiente','aceptada'))
 into aceptadas,completos,pendientes
 from public.review_assignments a join public.profiles p on p.id=a.reviewer_id
 left join public.manuscript_exclusions x on x.manuscript_id=m.id and x.user_id=p.id
 where a.manuscript_id=m.id;

 if completos>=m.dictamenes_requeridos and pendientes=0 then
  destino:='dictamen_emitido';
  razon:='Automático: dictámenes requeridos completos ('||completos||'/'||m.dictamenes_requeridos||'), sin invitaciones pendientes. Decisión editorial pendiente.';
 elsif aceptadas>0 or completos>0 then
  destino:='en_revision';
  razon:='Automático: revisión iniciada con aceptación de revisor o dictamen documentado.';
 else return; end if;
 if destino=m.estado then return; end if;
 update public.manuscripts set estado=destino where id=m.id;
 -- Reutiliza la entrada del trigger vigente, sin reemplazar su función.
 select id into logid from public.status_log where manuscript_id=m.id
 and estado_anterior=m.estado and estado_nuevo=destino and fecha>=transaction_timestamp()
 order by fecha desc,id limit 1;
 if logid is null then
  insert into public.status_log(manuscript_id,estado_anterior,estado_nuevo,changed_by,notas)
  values(m.id,m.estado,destino,auth.uid(),razon);
 else
  update public.status_log set notas=concat_ws(E'\n',nullif(notas,''),razon) where id=logid;
 end if;
end $$;

-- Serializa entregas del mismo manuscrito antes del bloqueo compartido
-- de la validación antigua. Evita que dos entregas omitan el cierre.
create or replace function public.rcia_bloquear_manuscrito_dictamen() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.manuscripts m join public.review_assignments a on a.manuscript_id=m.id
 where a.id=new.assignment_id for update of m;
 return new;
end $$;
drop trigger if exists aa_rcia_bloquear_manuscrito_dictamen on public.reviews;
create trigger aa_rcia_bloquear_manuscrito_dictamen before insert on public.reviews
for each row execute function public.rcia_bloquear_manuscrito_dictamen();

-- Serializa invitaciones nuevas con la última entrega del manuscrito.
create or replace function public.rcia_bloquear_manuscrito_invitacion() returns trigger
language plpgsql security definer set search_path='' as $$
declare estado_actual public.manuscript_status;
begin
 select estado into estado_actual from public.manuscripts where id=new.manuscript_id for update;
 if new.estado in ('pendiente','aceptada') and estado_actual in ('dictamen_emitido','aceptado','publicado','rechazado','desistido') then
  raise exception 'El expediente ya completó o cerró la revisión. El editor debe reabrirlo antes de invitar a otro revisor.';
 end if;
 return new;
end $$;
drop trigger if exists aa_rcia_bloquear_manuscrito_invitacion on public.review_assignments;
create trigger aa_rcia_bloquear_manuscrito_invitacion before insert on public.review_assignments
for each row execute function public.rcia_bloquear_manuscrito_invitacion();

create or replace function public.rcia_estado_desde_asignacion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.rcia_actualizar_estado_revision(new.manuscript_id);
 return null;
end $$;
create or replace function public.rcia_estado_desde_dictamen() returns trigger
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
 select manuscript_id into mid from public.review_assignments where id=new.assignment_id;
 if mid is not null then perform public.rcia_actualizar_estado_revision(mid); end if;
 return null;
end $$;
create or replace function public.rcia_estado_desde_manuscrito() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.rcia_actualizar_estado_revision(new.id);
 return null;
end $$;
-- Diferidos: el BEFORE INSERT de fase 4 marca entregada la asignación
-- antes de que exista la fila del dictamen. Aquí se evalúa al confirmar.
drop trigger if exists rcia_estado_asignacion on public.review_assignments;
create constraint trigger rcia_estado_asignacion after insert or update on public.review_assignments
deferrable initially deferred for each row execute function public.rcia_estado_desde_asignacion();
drop trigger if exists rcia_estado_dictamen on public.reviews;
create constraint trigger rcia_estado_dictamen after insert on public.reviews
deferrable initially deferred for each row execute function public.rcia_estado_desde_dictamen();
drop trigger if exists rcia_estado_antecedente on public.editorial_antecedents;
create constraint trigger rcia_estado_antecedente after insert on public.editorial_antecedents
deferrable initially deferred for each row execute function public.rcia_estado_desde_asignacion();
drop trigger if exists rcia_estado_preparacion on public.manuscripts;
create constraint trigger rcia_estado_preparacion after update on public.manuscripts
deferrable initially deferred for each row
when(old.editor_area_asignado_id is distinct from new.editor_area_asignado_id
 or old.archivo_anonimizado_url is distinct from new.archivo_anonimizado_url
 or old.dictamenes_requeridos is distinct from new.dictamenes_requeridos)
execute function public.rcia_estado_desde_manuscrito();

revoke all on function public.rcia_actualizar_estado_revision(uuid) from public,anon,authenticated;
revoke all on function public.rcia_proteger_umbral_revision() from public,anon,authenticated;
revoke all on function public.rcia_bloquear_manuscrito_dictamen() from public,anon,authenticated;
revoke all on function public.rcia_bloquear_manuscrito_invitacion() from public,anon,authenticated;
revoke all on function public.rcia_estado_desde_asignacion() from public,anon,authenticated;
revoke all on function public.rcia_estado_desde_dictamen() from public,anon,authenticated;
revoke all on function public.rcia_estado_desde_manuscrito() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
-- No actualiza expedientes históricos durante la instalación.
