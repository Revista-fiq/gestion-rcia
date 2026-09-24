-- RCIA: acceso ciego y entrega de dictámenes. Ejecutar UNA vez, como postgres.
-- Requiere fases 2 y 3 ya instaladas (profiles.areas_asignadas,
-- manuscripts.archivo_anonimizado_url, manuscript_versions y helpers de roles).
-- Toda la migración se revierte si hay un error. No elimina datos.
begin;

alter table reviews add column if not exists filtro_etica boolean;
alter table reviews add column if not exists filtro_plagio boolean;
alter table reviews add column if not exists filtro_interes boolean;
alter table reviews add column if not exists criterios jsonb;
alter table reviews add column if not exists puntaje_total integer;
alter table reviews add column if not exists necesita_segunda_revision text;
alter table reviews add column if not exists dispuesto_segunda_revision text;

-- No borrar duplicados históricos de forma automática.
do $$ begin
  if exists (select 1 from public.reviews group by assignment_id having count(*) > 1) then
    raise exception 'Hay dictámenes duplicados. Revisarlos antes de instalar esta migración.';
  end if;
end $$;
create unique index if not exists reviews_one_per_assignment on public.reviews(assignment_id);

-- Una política permisiva anterior no debe permitir consultar autoría.
drop policy if exists manuscripts_blind_select on public.manuscripts;
create policy rcia_no_autoria_revisor on public.manuscripts as restrictive
  for select to authenticated using (public.current_role_name() <> 'revisor');
create policy rcia_no_versiones_revisor on public.manuscript_versions as restrictive
  for select to authenticated using (public.current_role_name() <> 'revisor');
revoke all on public.manuscripts_blind from anon, authenticated;

-- RPC con lista explícita de campos ciegos y asignaciones del usuario actual.
create or replace function public.rcia_mis_asignaciones()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', a.id, 'estado', a.estado, 'fecha_limite', a.fecha_limite,
   'manuscripts_blind', jsonb_build_object(
      'id', m.id, 'folio', m.folio, 'titulo', m.titulo, 'resumen', m.resumen,
      'tipo', m.tipo, 'area_tematica', m.area_tematica,
      'archivo_manuscrito_url', case when a.estado <> 'declinada'
        then m.archivo_anonimizado_url else null end
   )) order by a.fecha_asignacion desc), '[]'::jsonb)
 from public.review_assignments a
 join public.manuscripts m on m.id = a.manuscript_id
 join public.profiles p on p.id = a.reviewer_id
 where a.reviewer_id = auth.uid() and p.role = 'revisor' and p.activo;
$$;
revoke all on function public.rcia_mis_asignaciones() from public, anon;
grant execute on function public.rcia_mis_asignaciones() to authenticated;

-- Los autores no reciben filas con comentarios confidenciales.
create policy rcia_reviews_privadas on public.reviews as restrictive
 for select to authenticated using (
   public.current_role_name() in ('editor', 'editor_area')
   or exists(select 1 from public.review_assignments a
     where a.id = reviews.assignment_id and a.reviewer_id = auth.uid())
 );

-- Impedir que el usuario cambie su rol mediante edición directa del perfil.
create or replace function public.rcia_proteger_rol()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is not null and public.current_role_name() <> 'editor'
   and (new.role is distinct from old.role or new.activo is distinct from old.activo
        or new.areas_asignadas is distinct from old.areas_asignadas) then
   raise exception 'Los roles y permisos los administra la revista.';
 end if;
 return new;
end $$;
create trigger rcia_proteger_rol before update on public.profiles
 for each row execute function public.rcia_proteger_rol();

-- El revisor no puede cambiar manuscript_id, reviewer_id ni marcar entregada.
-- Esa transición ocurre exclusivamente dentro de la transacción del dictamen.
drop policy if exists assignments_update_reviewer on public.review_assignments;
create policy rcia_no_update_asignacion_revisor on public.review_assignments as restrictive
 for update to authenticated using (public.current_role_name() <> 'revisor');

create or replace function public.rcia_validar_dictamen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
 a public.review_assignments;
 m public.manuscripts;
 n integer;
 total integer;
begin
 select * into a from public.review_assignments where id = new.assignment_id for update;
 if not found or a.reviewer_id is distinct from auth.uid() then
   raise exception 'No tienes esta asignación.';
 end if;
 if not exists(select 1 from public.profiles where id = auth.uid() and role = 'revisor' and activo) then
   raise exception 'Se requiere un perfil de revisor activo.';
 end if;
 if a.estado not in ('pendiente', 'aceptada') then
   raise exception 'La asignación ya fue entregada o declinada.';
 end if;
 select * into m from public.manuscripts where id = a.manuscript_id for share;
 if nullif(m.archivo_anonimizado_url, '') is null then
   raise exception 'Falta el manuscrito anonimizado.';
 end if;
 if new.filtro_etica is null or new.filtro_plagio is null or new.filtro_interes is null then
   raise exception 'Completa los filtros éticos.';
 end if;
 if not (new.filtro_etica and new.filtro_plagio and new.filtro_interes) then
   new.puntaje_total := 0;
   new.decision := 'rechazar';
   new.criterios := null;
 else
   if jsonb_typeof(new.criterios) is distinct from 'array' then
     raise exception 'Se requieren ocho criterios.';
   end if;
   if jsonb_array_length(new.criterios) <> 8 then raise exception 'Se requieren ocho criterios.'; end if;
   for n in 1..8 loop
     if not exists(select 1 from jsonb_array_elements(new.criterios) c
       where c->>'num' = n::text and c->>'puntaje' in ('1','2','3','4')) then
       raise exception 'Criterio % inválido: usa puntajes de 1 a 4.', n;
     end if;
   end loop;
   select sum((c->>'puntaje')::integer) into total from jsonb_array_elements(new.criterios) c;
   new.puntaje_total := total;
   new.decision := (case when total >= 28 then 'aceptar' when total >= 20 then 'revision_menor'
     when total >= 14 then 'revision_mayor' else 'rechazar' end)::public.review_decision;
   if new.necesita_segunda_revision is null or new.necesita_segunda_revision not in ('Sí','No') then
     raise exception 'Indica si requiere segunda revisión.';
   end if;
   if new.necesita_segunda_revision = 'No' then new.dispuesto_segunda_revision := 'No aplica';
   elsif new.dispuesto_segunda_revision is null or new.dispuesto_segunda_revision not in ('Sí','No') then
     raise exception 'Indica tu disponibilidad para la segunda revisión.';
   end if;
 end if;
 new.fecha_entrega := now();
 update public.review_assignments set estado = 'entregada', fecha_respuesta = now() where id = a.id;
 return new;
end $$;
create trigger rcia_validar_dictamen before insert on public.reviews
 for each row execute function public.rcia_validar_dictamen();

-- Función privada: comprueba la ruta exacta vigente, no toda la carpeta.
create or replace function public.rcia_puede_leer_anonimo(ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
   select 1 from public.manuscripts m
   join public.review_assignments a on a.manuscript_id = m.id
   join public.profiles p on p.id = a.reviewer_id
   where a.reviewer_id = auth.uid() and p.role = 'revisor' and p.activo
     and a.estado in ('pendiente','aceptada','entregada')
     and m.archivo_anonimizado_url =
       'https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/manuscritos-anonimizados/' || ruta
 );
$$;
revoke all on function public.rcia_puede_leer_anonimo(text) from public, anon;
grant execute on function public.rcia_puede_leer_anonimo(text) to authenticated;

-- Las URLs públicas existentes siguen guardadas como referencias, pero
-- el navegador ahora las abre con URLs temporales y comprobación de permisos.
update storage.buckets set public = false where id in
 ('manuscritos', 'manuscritos-anonimizados', 'cartas-presentacion',
  'declaraciones-conflicto', 'material-suplementario');
create policy rcia_storage_revisor_limite on storage.objects as restrictive
 for select to authenticated using (
   public.current_role_name() <> 'revisor'
   or (bucket_id = 'manuscritos-anonimizados' and public.rcia_puede_leer_anonimo(name))
 );
create policy rcia_storage_anonimo_revisor on storage.objects
 for select to authenticated using (
   bucket_id = 'manuscritos-anonimizados' and public.rcia_puede_leer_anonimo(name)
 );

notify pgrst, 'reload schema';
commit;
