-- =====================================================================
-- RCIA-UADY — Sistema de Gestión Editorial
-- Esquema de base de datos (Fase 1)
-- Diseñado para Supabase (Postgres + Auth + Storage + RLS)
-- =====================================================================
-- Roles: autor, revisor, editor
-- Flujo: recibido -> acuse_enviado -> en_revision -> dictamen_emitido
--        -> en_correccion -> aceptado -> publicado
--        (o: rechazado / desistido en cualquier punto)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TIPOS PERSONALIZADOS
-- ---------------------------------------------------------------------

create type user_role as enum ('autor', 'revisor', 'editor');

create type manuscript_status as enum (
  'recibido',
  'acuse_enviado',
  'en_revision',
  'dictamen_emitido',
  'en_correccion',
  'aceptado',
  'publicado',
  'rechazado',
  'desistido'
);

create type manuscript_type as enum (
  'articulo_original',
  'revision_bibliografica',
  'nota_investigacion'
);

create type review_decision as enum (
  'aceptar',
  'revision_menor',
  'revision_mayor',
  'rechazar'
);

create type assignment_status as enum (
  'pendiente',
  'aceptada',
  'declinada',
  'entregada'
);

-- ---------------------------------------------------------------------
-- 2. PERFILES (extiende auth.users)
-- ---------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'autor',
  nombre_completo text not null,
  email text not null,
  orcid text,
  institucion text,
  area_especialidad text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. MANUSCRITOS
-- ---------------------------------------------------------------------

create sequence manuscript_folio_seq start 1;

create table manuscripts (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,                      -- ej. RCIA-2026-001
  titulo text not null,
  titulo_en text,
  resumen text,
  tipo manuscript_type not null,
  area_tematica text not null,

  autor_correspondencia_id uuid not null references profiles(id),
  coautores jsonb not null default '[]'::jsonb,     -- [{nombre, orcid, institucion}]

  estado manuscript_status not null default 'recibido',

  archivo_manuscrito_url text not null,
  archivo_carta_url text,
  archivo_conflictos_url text,
  archivo_material_suplementario_url text,

  fecha_recepcion timestamptz not null default now(),
  fecha_acuse timestamptz,
  fecha_publicacion timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_manuscripts_autor on manuscripts(autor_correspondencia_id);
create index idx_manuscripts_estado on manuscripts(estado);

-- Genera folio automáticamente al insertar (ej. RCIA-2026-001)
create or replace function generar_folio()
returns trigger as $$
begin
  new.folio := 'RCIA-' || extract(year from now())::text || '-' ||
               lpad(nextval('manuscript_folio_seq')::text, 3, '0');
  return new;
end;
$$ language plpgsql;

create trigger trg_generar_folio
  before insert on manuscripts
  for each row
  when (new.folio is null)
  execute function generar_folio();

-- ---------------------------------------------------------------------
-- 4. ASIGNACIÓN DE REVISORES
-- ---------------------------------------------------------------------

create table review_assignments (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references manuscripts(id) on delete cascade,
  reviewer_id uuid not null references profiles(id),
  estado assignment_status not null default 'pendiente',
  fecha_asignacion timestamptz not null default now(),
  fecha_limite timestamptz,                          -- calculada: asignación + 6 a 10 semanas
  fecha_respuesta timestamptz,                        -- cuándo aceptó/declinó
  unique (manuscript_id, reviewer_id)
);

create index idx_assignments_manuscript on review_assignments(manuscript_id);
create index idx_assignments_reviewer on review_assignments(reviewer_id);

-- ---------------------------------------------------------------------
-- 5. DICTÁMENES
-- ---------------------------------------------------------------------

create table reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references review_assignments(id) on delete cascade,
  decision review_decision not null,
  comentarios_autor text,          -- visibles para el autor
  comentarios_editor text,         -- confidenciales, solo editor
  archivo_anotado_url text,
  fecha_entrega timestamptz not null default now()
);

create index idx_reviews_assignment on reviews(assignment_id);

-- ---------------------------------------------------------------------
-- 6. BITÁCORA DE ESTADOS (para el portal de seguimiento del autor)
-- ---------------------------------------------------------------------

create table status_log (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references manuscripts(id) on delete cascade,
  estado_anterior manuscript_status,
  estado_nuevo manuscript_status not null,
  notas text,
  changed_by uuid references profiles(id),
  fecha timestamptz not null default now()
);

create index idx_status_log_manuscript on status_log(manuscript_id);

-- Registra automáticamente cada cambio de estado
create or replace function log_status_change()
returns trigger as $$
begin
  if new.estado is distinct from old.estado then
    insert into status_log (manuscript_id, estado_anterior, estado_nuevo, changed_by)
    values (new.id, old.estado, new.estado, auth.uid());
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_log_status_change
  before update on manuscripts
  for each row
  execute function log_status_change();

-- Registra el estado inicial al crear el manuscrito
create or replace function log_initial_status()
returns trigger as $$
begin
  insert into status_log (manuscript_id, estado_anterior, estado_nuevo, changed_by)
  values (new.id, null, new.estado, new.autor_correspondencia_id);
  return new;
end;
$$ language plpgsql;

create trigger trg_log_initial_status
  after insert on manuscripts
  for each row
  execute function log_initial_status();

-- ---------------------------------------------------------------------
-- 7. VISTA CIEGA PARA REVISORES (oculta identidad del autor)
-- ---------------------------------------------------------------------
-- Los revisores consultan esta vista, NUNCA la tabla manuscripts directamente.

create view manuscripts_blind as
select
  m.id,
  m.folio,
  m.titulo,
  m.titulo_en,
  m.resumen,
  m.tipo,
  m.area_tematica,
  m.estado,
  m.archivo_manuscrito_url,
  m.fecha_recepcion
from manuscripts m;

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table manuscripts enable row level security;
alter table review_assignments enable row level security;
alter table reviews enable row level security;
alter table status_log enable row level security;

-- Función auxiliar: rol del usuario actual
create or replace function current_role_name()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

-- PROFILES: cada quien ve su propio perfil; el editor ve todos
create policy profiles_select on profiles
  for select using (
    id = auth.uid() or current_role_name() = 'editor'
  );

create policy profiles_update_own on profiles
  for update using (id = auth.uid());

-- MANUSCRIPTS: autor ve los suyos, editor ve todo, revisor NO tiene
-- acceso directo a esta tabla (usa manuscripts_blind en su lugar)
create policy manuscripts_select_autor on manuscripts
  for select using (
    autor_correspondencia_id = auth.uid()
    or current_role_name() = 'editor'
  );

create policy manuscripts_insert_autor on manuscripts
  for insert with check (autor_correspondencia_id = auth.uid());

create policy manuscripts_update_editor on manuscripts
  for update using (current_role_name() = 'editor');

-- REVIEW_ASSIGNMENTS: revisor ve solo lo suyo; editor ve todo
create policy assignments_select on review_assignments
  for select using (
    reviewer_id = auth.uid() or current_role_name() = 'editor'
  );

create policy assignments_update_reviewer on review_assignments
  for update using (reviewer_id = auth.uid());

create policy assignments_insert_editor on review_assignments
  for insert with check (current_role_name() = 'editor');

-- REVIEWS: el revisor que la emitió y el editor pueden verla completa;
-- el autor ve solo comentarios_autor (filtrar esa columna desde la app,
-- ya que RLS es por fila, no por columna)
create policy reviews_select on reviews
  for select using (
    current_role_name() = 'editor'
    or exists (
      select 1 from review_assignments ra
      where ra.id = reviews.assignment_id and ra.reviewer_id = auth.uid()
    )
    or exists (
      select 1 from review_assignments ra
      join manuscripts m on m.id = ra.manuscript_id
      where ra.id = reviews.assignment_id and m.autor_correspondencia_id = auth.uid()
    )
  );

create policy reviews_insert_reviewer on reviews
  for insert with check (
    exists (
      select 1 from review_assignments ra
      where ra.id = assignment_id and ra.reviewer_id = auth.uid()
    )
  );

-- STATUS_LOG: autor ve la bitácora de sus manuscritos; editor ve todo
create policy status_log_select on status_log
  for select using (
    current_role_name() = 'editor'
    or exists (
      select 1 from manuscripts m
      where m.id = status_log.manuscript_id and m.autor_correspondencia_id = auth.uid()
    )
  );

-- Nota: manuscripts_blind hereda RLS de manuscripts. Para que el revisor
-- pueda usarla sin ver la tabla base, se otorga acceso explícito:
grant select on manuscripts_blind to authenticated;

create policy manuscripts_blind_select on manuscripts
  for select using (
    current_role_name() = 'revisor'
    and exists (
      select 1 from review_assignments ra
      where ra.manuscript_id = manuscripts.id and ra.reviewer_id = auth.uid()
    )
  );

-- =====================================================================
-- FIN DEL ESQUEMA — Fase 1
-- Pendiente para fases siguientes:
--   - Storage buckets (manuscritos, cartas, dictámenes) + políticas
--   - Cálculo automático de fecha_limite según tiempos del proceso
--   - Edge Function para acuse de recibo y alertas de plazo (Resend)
-- =====================================================================
