-- Ejecutar completo una vez antes de recibir nuevos envíos con la casilla.
begin;
alter table public.manuscripts add column if not exists condiciones_publicacion jsonb;
create or replace function public.rcia_validar_condiciones_publicacion()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if new.condiciones_publicacion is distinct from old.condiciones_publicacion then
     raise exception 'No se puede modificar la aceptación registrada.';
   end if;
   return new;
 end if;
 if new.condiciones_publicacion->>'version' is distinct from 'CC-BY-4.0-RCIA-2026-10-16'
 or new.condiciones_publicacion->'aceptado' is distinct from 'true'::jsonb
 or auth.uid() is null or auth.uid() is distinct from new.autor_correspondencia_id then
   raise exception 'El autor de correspondencia debe aceptar las condiciones de publicación y confirmar la autorización de los coautores.';
 end if;
 new.condiciones_publicacion := jsonb_build_object(
   'version','CC-BY-4.0-RCIA-2026-10-16',
   'aceptado',true,
   'aceptado_por',auth.uid(),
   'aceptado_en',now(),
   'licencia_url','https://creativecommons.org/licenses/by/4.0/deed.es',
   'texto',$texto$He leído y acepto las condiciones de publicación de RCIA-UADY. Si el manuscrito es aceptado, su versión publicada se distribuirá bajo la licencia Creative Commons Atribución 4.0 Internacional (CC BY 4.0). Los autores conservarán sus derechos de autor y autorizarán a la revista a publicar y depositar el artículo en repositorios académicos, incluido Zenodo.

Como autor de correspondencia, confirmo que cuento con la conformidad y autorización de todos los coautores para aceptar estas condiciones.$texto$
 );
 return new;
end $$;
drop trigger if exists rcia_condiciones_publicacion on public.manuscripts;
create trigger rcia_condiciones_publicacion before insert or update on public.manuscripts
for each row execute function public.rcia_validar_condiciones_publicacion();
notify pgrst,'reload schema';
commit;
-- Los manuscritos anteriores conservan NULL: no se presume aceptación retroactiva.
