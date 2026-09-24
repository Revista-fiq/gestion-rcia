-- =====================================================================
-- RCIA-UADY — FASE 2 — PASO 2 de 2
-- Ejecuta esto SOLO después de que schema_fase2_paso1_enum.sql haya
-- terminado sin error, en una consulta nueva y separada.
--
-- Agrega:
--   1) Rol "editor de área" (permisos casi completos, filtrado a sus
--      áreas temáticas asignadas)
--   2) Columnas para la ficha de evaluación de revisores
--   3) Corrección de seguridad: el autorregistro ya no puede
--      autoasignarse un rol distinto de "autor"
-- =====================================================================

-- Áreas que gestiona un editor de área (también sirve para anotar la
-- especialidad de un revisor a futuro, si se quiere usar para sugerir
-- asignaciones)
alter table profiles add column if not exists areas_asignadas text[];

-- Datos de la ficha de evaluación de 8 criterios
alter table reviews add column if not exists filtro_etica boolean;
alter table reviews add column if not exists filtro_plagio boolean;
alter table reviews add column if not exists filtro_interes boolean;
alter table reviews add column if not exists criterios jsonb;
alter table reviews add column if not exists puntaje_total integer;
alter table reviews add column if not exists necesita_segunda_revision text;
alter table reviews add column if not exists dispuesto_segunda_revision text;

-- Función auxiliar: áreas asignadas al usuario que hace la consulta
create or replace function current_user_areas()
returns text[] as $$
  select areas_asignadas from profiles where id = auth.uid();
$$ language sql stable security definer;

-- ---------------------------------------------------------------
-- Corrección de seguridad: el autorregistro público solo puede
-- crear su propio perfil como 'autor'. Los demás roles (revisor,
-- editor_area, editor) se asignan exclusivamente desde el panel
-- "Gestión de usuarios" (solo visible para el editor en jefe).
-- Sin esto, cualquiera podía editar la petición del navegador y
-- registrarse directamente como editor.
-- ---------------------------------------------------------------
drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid() and role = 'autor');

-- El editor en jefe puede modificar el perfil de cualquier usuario
-- (para promoverlo/degradarlo y asignar áreas)
create policy profiles_update_by_editor on profiles
  for update using (current_role_name() = 'editor');

-- El editor de área también necesita ver la lista completa de
-- perfiles (para elegir revisores al asignar)
create policy profiles_select_editor_area on profiles
  for select using (current_role_name() = 'editor_area');

-- ---------------------------------------------------------------
-- Permisos del editor de área: igual que el editor en jefe, pero
-- limitado a los manuscritos cuya área temática esté en su lista
-- de áreas asignadas.
-- ---------------------------------------------------------------

create policy manuscripts_select_editor_area on manuscripts
  for select using (
    current_role_name() = 'editor_area'
    and area_tematica = any (current_user_areas())
  );

create policy manuscripts_update_editor_area on manuscripts
  for update using (
    current_role_name() = 'editor_area'
    and area_tematica = any (current_user_areas())
  );

create policy assignments_select_editor_area on review_assignments
  for select using (
    current_role_name() = 'editor_area'
    and exists (
      select 1 from manuscripts m
      where m.id = review_assignments.manuscript_id
        and m.area_tematica = any (current_user_areas())
    )
  );

create policy assignments_insert_editor_area on review_assignments
  for insert with check (
    current_role_name() = 'editor_area'
    and exists (
      select 1 from manuscripts m
      where m.id = manuscript_id
        and m.area_tematica = any (current_user_areas())
    )
  );

create policy reviews_select_editor_area on reviews
  for select using (
    current_role_name() = 'editor_area'
    and exists (
      select 1 from review_assignments ra
      join manuscripts m on m.id = ra.manuscript_id
      where ra.id = reviews.assignment_id
        and m.area_tematica = any (current_user_areas())
    )
  );

create policy status_log_select_editor_area on status_log
  for select using (
    current_role_name() = 'editor_area'
    and exists (
      select 1 from manuscripts m
      where m.id = status_log.manuscript_id
        and m.area_tematica = any (current_user_areas())
    )
  );

-- =====================================================================
-- FIN DE LA FASE 2
-- =====================================================================
