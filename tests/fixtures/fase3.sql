-- =====================================================================
-- RCIA-UADY — Sistema de Gestión Editorial — FASE 3
-- Agrega:
--   1) Archivo anonimizado obligatorio antes de enviar a revisión
--      (candado automático a nivel de base de datos)
--   2) Historial de versiones del manuscrito (envío original +
--      correcciones del autor), sin perder el folio
--   3) Corrección de un error real: faltaba la política que permite
--      INSERTAR en `status_log` — sin ella, el registro automático
--      del historial pudo estar fallando en silencio desde la Fase 1.
--
-- Se ejecuta en una sola consulta (no requiere pasos separados, a
-- diferencia de la Fase 2).
-- =====================================================================

-- ---------------------------------------------------------------
-- 1) Archivo anonimizado
-- ---------------------------------------------------------------

alter table manuscripts add column if not exists archivo_anonimizado_url text;

-- La vista ciega ahora entrega el archivo YA anonimizado (no el
-- original) bajo el mismo nombre de columna que ya usaba la app,
-- así el código del panel de revisor no necesita cambiar.
create or replace view manuscripts_blind as
select
  m.id, m.folio, m.titulo, m.titulo_en, m.resumen, m.tipo, m.area_tematica,
  m.estado, m.archivo_anonimizado_url as archivo_manuscrito_url, m.fecha_recepcion
from manuscripts m;

-- CREATE OR REPLACE VIEW normalmente conserva las opciones ya
-- aplicadas, pero lo reafirmamos por seguridad (ver Fase 1).
alter view manuscripts_blind set (security_invoker = true);

-- Candado: no se puede pasar a un estado de revisión/publicación sin
-- haber subido antes el archivo anonimizado. Se permite moverse a
-- rechazado/desistido sin él (un rechazo de primer filtro no necesita
-- pasar por revisión ciega). Solo se evalúa cuando el ESTADO realmente
-- cambia — así, subir una nueva versión (que borra el anonimizado
-- anterior) sin cambiar de estado no queda bloqueado por error.
create or replace function exigir_anonimizado_antes_de_revision()
returns trigger as $$
begin
  if new.estado is distinct from old.estado
     and new.estado not in ('recibido', 'acuse_enviado', 'rechazado', 'desistido')
     and new.archivo_anonimizado_url is null then
    raise exception 'No se puede cambiar el manuscrito a "%" sin antes subir el archivo anonimizado.', new.estado;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_exigir_anonimizado
  before update on manuscripts
  for each row
  execute function exigir_anonimizado_antes_de_revision();

-- Bucket de Storage para las copias anonimizadas (separado del
-- bucket de manuscritos originales, que solo debería ver el editor)
insert into storage.buckets (id, name, public)
values ('manuscritos-anonimizados', 'manuscritos-anonimizados', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- 2) Historial de versiones (envío original + correcciones)
-- ---------------------------------------------------------------

create table if not exists manuscript_versions (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references manuscripts(id) on delete cascade,
  numero_version integer not null,
  archivo_url text not null,
  subido_por uuid references profiles(id),
  notas text,
  fecha timestamptz not null default now(),
  unique (manuscript_id, numero_version)
);

create index if not exists idx_manuscript_versions_manuscript on manuscript_versions(manuscript_id);
alter table manuscript_versions enable row level security;

create policy versions_select on manuscript_versions
  for select using (
    current_role_name() = 'editor'
    or exists (
      select 1 from manuscripts m
      where m.id = manuscript_id and m.autor_correspondencia_id = auth.uid()
    )
    or exists (
      select 1 from review_assignments ra
      where ra.manuscript_id = manuscript_versions.manuscript_id and ra.reviewer_id = auth.uid()
    )
    or (
      current_role_name() = 'editor_area'
      and exists (
        select 1 from manuscripts m
        where m.id = manuscript_id and m.area_tematica = any (current_user_areas())
      )
    )
  );

create policy versions_insert_autor on manuscript_versions
  for insert with check (
    exists (
      select 1 from manuscripts m
      where m.id = manuscript_id and m.autor_correspondencia_id = auth.uid()
    )
  );

-- El autor puede actualizar el archivo de su propio manuscrito
-- (y limpiar el anonimizado anterior) solo mientras está en
-- "en_correccion" — fuera de esa ventana no tiene permiso de UPDATE.
create policy manuscripts_update_autor_correccion on manuscripts
  for update using (
    autor_correspondencia_id = auth.uid()
    and estado = 'en_correccion'
  );

-- ---------------------------------------------------------------
-- 3) Corrección: política de INSERT faltante en status_log
-- ---------------------------------------------------------------
-- Sin esto, los triggers que registran la bitácora (y la nueva
-- inserción manual al subir una versión corregida) se rechazan por
-- RLS aunque el resto de la operación luzca correcta.

create policy status_log_insert on status_log
  for insert with check (
    exists (
      select 1 from manuscripts m
      where m.id = manuscript_id
        and (
          m.autor_correspondencia_id = auth.uid()
          or current_role_name() = 'editor'
          or (
            current_role_name() = 'editor_area'
            and m.area_tematica = any (current_user_areas())
          )
        )
    )
  );

-- =====================================================================
-- FIN DE LA FASE 3
-- =====================================================================
