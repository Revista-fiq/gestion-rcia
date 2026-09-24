-- Corrige la resolución de profiles desde funciones con search_path restringido.
-- Ejecutar completo en Supabase SQL Editor. No cambia datos, folios ni roles.
begin;
create or replace function public.current_role_name()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_user_areas()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select p.areas_asignadas from public.profiles p where p.id = auth.uid();
$$;
notify pgrst, 'reload schema';
commit;

