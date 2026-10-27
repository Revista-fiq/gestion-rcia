-- Solo lectura. Ejecutar en el SQL Editor de Supabase para conocer
-- los triggers reales antes de automatizar estados o agregar avisos.
select
 c.relname as tabla,
 t.tgname as trigger,
 t.tgenabled as habilitado,
 pg_get_triggerdef(t.oid) as definicion_trigger,
 pg_get_functiondef(t.tgfoid) as funcion
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
 and c.relname in ('manuscripts','review_assignments','reviews')
 and not t.tgisinternal
order by c.relname,t.tgname;
