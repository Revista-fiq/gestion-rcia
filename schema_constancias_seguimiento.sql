-- Ejecutar después de schema_constancias_descarga.sql.
-- No envía correos. Conserva el historial anterior de PDF enviados manualmente.
begin;
create table if not exists public.rcia_constancia_avisos (
 constancia_id uuid primary key references public.rcia_constancias(id),
 fecha_envio date not null,
 origen text not null,
 registrado_por uuid references public.profiles(id),
 registrado_en timestamptz not null default now()
);
create table if not exists public.rcia_constancia_descargas (
 solicitud uuid primary key,
 constancia_id uuid not null references public.rcia_constancias(id),
 usuario_id uuid not null references public.profiles(id),
 fecha timestamptz not null default now()
);
create index if not exists rcia_constancia_descargas_por_documento on public.rcia_constancia_descargas(constancia_id,fecha);
alter table public.rcia_constancia_avisos enable row level security;
alter table public.rcia_constancia_descargas enable row level security;
revoke all on public.rcia_constancia_avisos,public.rcia_constancia_descargas from public,anon,authenticated;

create or replace function public.rcia_seguimiento_constancias(mid uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;
begin
 -- Reutiliza la comprobación de roles, asignación, publicación y conflictos.
 base:=public.rcia_listar_constancias(mid);
 return (select coalesce(jsonb_agg(item || jsonb_build_object(
 'seguimiento_activo',true,'aviso_enviado',v.fecha_envio,'aviso_origen',v.origen,
 'primera_descarga',d.primera,'ultima_descarga',d.ultima,'descargas',coalesce(d.total,0)) order by pos),'[]'::jsonb)
 from jsonb_array_elements(base) with ordinality x(item,pos)
 left join public.rcia_constancia_avisos v on v.constancia_id=(item->>'id')::uuid
 left join lateral(select min(fecha) primera,max(fecha) ultima,count(*) total
 from public.rcia_constancia_descargas where constancia_id=(item->>'id')::uuid) d on true);
end $$;

create or replace function public.rcia_registrar_aviso_constancia(cid uuid,fecha date) returns void
language plpgsql security definer set search_path='' as $$
declare c public.rcia_constancias;
begin
 select * into strict c from public.rcia_constancias where id=cid for update;
 if not public.rcia_constancia_acceso(c.assignment_id,true) then raise exception 'Solo el editor en jefe autorizado puede registrar el aviso.'; end if;
 if c.validado_en is null then raise exception 'Primero valida y publica la constancia.'; end if;
 if fecha is null or fecha>(now() at time zone 'America/Merida')::date
 or fecha<(c.validado_en at time zone 'America/Merida')::date
 then raise exception 'La fecha debe estar entre la publicación de la constancia y el día de hoy.'; end if;
 if exists(select 1 from public.rcia_constancia_avisos where constancia_id=cid and fecha_envio<>fecha)
 then raise exception 'Ya existe un aviso registrado con otra fecha.'; end if;
 insert into public.rcia_constancia_avisos(constancia_id,fecha_envio,origen,registrado_por)
 values(cid,fecha,'Correo enviado manualmente; confirmado por el editor en jefe',auth.uid())
 on conflict(constancia_id) do nothing;
end $$;

create or replace function public.rcia_registrar_descarga_constancia(cid uuid,peticion uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.rcia_constancias;
begin
 select * into strict c from public.rcia_constancias where id=cid;
 if peticion is null or c.validado_en is null or c.revisor_id is distinct from auth.uid()
 or not exists(select 1 from public.profiles where id=auth.uid() and role='revisor' and activo)
 or not public.rcia_constancia_lectura(c.ruta)
 then raise exception 'Solo el revisor destinatario puede registrar la descarga de su constancia publicada.'; end if;
 if exists(select 1 from public.rcia_constancia_descargas where solicitud=peticion and (constancia_id<>cid or usuario_id<>auth.uid()))
 then raise exception 'La solicitud ya corresponde a otra descarga.'; end if;
 insert into public.rcia_constancia_descargas(solicitud,constancia_id,usuario_id)
 values(peticion,cid,auth.uid()) on conflict(solicitud) do nothing;
end $$;
revoke all on function public.rcia_seguimiento_constancias(uuid),public.rcia_registrar_aviso_constancia(uuid,date),
 public.rcia_registrar_descarga_constancia(uuid,uuid) from public,anon;
grant execute on function public.rcia_seguimiento_constancias(uuid),public.rcia_registrar_aviso_constancia(uuid,date),
 public.rcia_registrar_descarga_constancia(uuid,uuid) to authenticated;

-- Siete avisos enviados desde revista.fiq por Outlook el 25/11/2026,
-- confirmados por las respuestas de envío. No son descargas ni envíos de PDF adjuntos.
-- Se incorporan únicamente si existe la constancia publicada para la asignación exacta.
insert into public.rcia_constancia_avisos(constancia_id,fecha_envio,origen)
select id,date '2026-11-25','Aviso enviado por Outlook desde revista.fiq@correo.uady.mx; confirmado en la coordinación editorial del 25/11/2026'
from public.rcia_constancias where validado_en is not null and assignment_id in (
 'f868d575-8519-4410-8f35-0cb0eb497d40'::uuid,
 'd6d47ca0-3e0a-48d3-a8f7-9406a45f3a92'::uuid,
 'df2f0b42-3904-45a4-8d2e-c08e43bf5bde'::uuid,
 '2d388b44-898b-4b76-9e9c-88ae84b61c49'::uuid,
 '01944bd4-bd5d-46c2-bcbd-c7b095f607cc'::uuid,
 '0375e845-1f47-4f11-ac31-4f1b612bd4b6'::uuid,
 '2d62faf1-8bc4-42d5-9b24-ba8c4e8831c3'::uuid)
on conflict(constancia_id) do nothing;
notify pgrst,'reload schema';
commit;

select c.folio,c.nombre_revisor,v.fecha_envio as aviso_enviado
from public.rcia_constancia_avisos v join public.rcia_constancias c on c.id=v.constancia_id
order by c.folio,c.nombre_revisor;
