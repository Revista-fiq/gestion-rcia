-- Nuevos folios RCIA-006-2026, RCIA-007-2026, etc.
-- Ejecutar completo en SQL Editor. No modifica folios existentes.
-- Año de recepción en America/Merida. Consecutivo continuo, sin reinicio anual.
begin;
lock table public.manuscripts in access exclusive mode;

create or replace function public.generar_folio()
returns trigger language plpgsql set search_path = '' as $$
declare
  consecutivo text;
  anio text := extract(year from current_timestamp at time zone 'America/Merida')::text;
begin
  loop
    consecutivo := nextval('public.manuscript_folio_seq'::regclass)::text;
    new.folio := 'RCIA-' || lpad(consecutivo, greatest(3, length(consecutivo)), '0') || '-' || anio;
    exit when not exists (select 1 from public.manuscripts where folio = new.folio);
  end loop;
  return new;
end;
$$;

-- RESTART es transaccional. No retroceder si ya se consumió el 006 o superior.
do $$
declare
  siguiente bigint;
  existente bigint;
  secuencia bigint;
begin
  select coalesce(max(case
    when folio ~ '^RCIA-[0-9]{4}-[0-9]+$' and substring(folio from 6 for 4)::integer between 2000 and 2099
      then split_part(folio, '-', 3)::bigint
    when folio ~ '^RCIA-[0-9]+-[0-9]{4}$'
      then split_part(folio, '-', 2)::bigint
    else 0 end), 0) + 1 into existente from public.manuscripts;
  select last_value + case when is_called then 1 else 0 end into secuencia from public.manuscript_folio_seq;
  siguiente := greatest(6, existente, secuencia);
  execute format('alter sequence public.manuscript_folio_seq restart with %s', siguiente);
  raise notice 'Siguiente consecutivo: %', siguiente;
end;
$$;
commit;

