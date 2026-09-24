-- =====================================================================
-- RCIA-UADY — CORRECCIÓN — Políticas de Storage
-- Ejecuta esto en una sola consulta. No depende de la Fase 2 ni requiere
-- pasos separados.
--
-- Motivo: storage.objects tiene RLS activado por defecto en Supabase, y
-- nunca se crearon políticas para ningún bucket. Resultado: ninguna
-- subida de archivo funciona todavía, para ningún rol (error "new row
-- violates row-level security policy"). Esto se descubrió al probar el
-- envío real de un manuscrito.
--
-- Buckets con archivos "identificables" (los sube el autor, ruta
-- <user_id>/... o <user_id>/<manuscript_id>/...):
--   manuscritos, cartas-presentacion, declaraciones-conflicto,
--   material-suplementario
-- Bucket con el archivo ya anonimizado (lo sube el editor/editor de
-- área, ruta <manuscript_id>/...):
--   manuscritos-anonimizados
-- =====================================================================

-- ---------------------------------------------------------------
-- Subir archivos: el autor solo a su propia carpeta
-- ---------------------------------------------------------------
create policy storage_autor_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('manuscritos', 'cartas-presentacion', 'declaraciones-conflicto', 'material-suplementario')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leer esos mismos archivos: el propio autor, el editor en jefe, o el
-- editor de área si el manuscrito de ese autor cae en su área asignada
create policy storage_autor_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('manuscritos', 'cartas-presentacion', 'declaraciones-conflicto', 'material-suplementario')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or current_role_name() = 'editor'
      or (
        current_role_name() = 'editor_area'
        and exists (
          select 1 from manuscripts m
          where m.autor_correspondencia_id::text = (storage.foldername(name))[1]
            and m.area_tematica = any (current_user_areas())
        )
      )
    )
  );

-- ---------------------------------------------------------------
-- Archivo anonimizado: solo lo sube el editor en jefe o el editor de
-- área (si el manuscrito es de su área)
-- ---------------------------------------------------------------
create policy storage_anonimizado_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'manuscritos-anonimizados'
    and (
      current_role_name() = 'editor'
      or (
        current_role_name() = 'editor_area'
        and exists (
          select 1 from manuscripts m
          where m.id::text = (storage.foldername(name))[1]
            and m.area_tematica = any (current_user_areas())
        )
      )
    )
  );

-- Leer el anonimizado: editor, editor de área de esa área, o el
-- revisor que tenga una asignación vigente sobre ese manuscrito
-- (nunca el autor: mantiene el doble ciego)
create policy storage_anonimizado_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'manuscritos-anonimizados'
    and (
      current_role_name() = 'editor'
      or (
        current_role_name() = 'editor_area'
        and exists (
          select 1 from manuscripts m
          where m.id::text = (storage.foldername(name))[1]
            and m.area_tematica = any (current_user_areas())
        )
      )
      or exists (
        select 1 from review_assignments ra
        where ra.manuscript_id::text = (storage.foldername(name))[1]
          and ra.reviewer_id = auth.uid()
      )
    )
  );

-- =====================================================================
-- FIN
-- =====================================================================
