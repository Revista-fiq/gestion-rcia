begin;
create table if not exists public.rcia_constancias_enviadas (
 assignment_id uuid primary key references public.review_assignments(id) on delete cascade,
 fecha_envio date not null,
 registrado_en timestamptz not null default now(),
 registrado_por uuid not null references public.profiles(id)
);
alter table public.rcia_constancias_enviadas enable row level security;
revoke all on public.rcia_constancias_enviadas from public,anon,authenticated;

create or replace function public.rcia_estado_constancias(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.manuscripts m join public.profiles p on p.id=auth.uid()
 where m.id=mid and p.activo and public.rcia_sin_conflicto(mid)
 and (p.role='editor' or (p.role='editor_area' and m.editor_area_asignado_id=p.id)))
 then raise exception 'Sin autorización para consultar constancias.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'revisor',p.nombre_completo,
 'fecha_envio',c.fecha_envio,'registrado_en',c.registrado_en,'registrado_por',e.nombre_completo)
 order by p.nombre_completo,a.id),'[]'::jsonb)
 from public.review_assignments a join public.profiles p on p.id=a.reviewer_id
 left join public.rcia_constancias_enviadas c on c.assignment_id=a.id
 left join public.profiles e on e.id=c.registrado_por
 where a.manuscript_id=mid and a.estado='entregada'
 and (exists(select 1 from public.reviews r where r.assignment_id=a.id)
 or exists(select 1 from public.editorial_antecedents r where r.assignment_id=a.id and r.tipo='dictamen')));
end $$;
create or replace function public.rcia_marcar_constancia_enviada(aid uuid, fecha date) returns void
language plpgsql security definer set search_path='' as $$
declare a public.review_assignments;
begin
 select * into strict a from public.review_assignments where id=aid for update;
 if not exists(select 1 from public.profiles where id=auth.uid() and role='editor' and activo)
 or not public.rcia_sin_conflicto(a.manuscript_id) then raise exception 'Solo el editor en jefe autorizado puede registrar el envío.'; end if;
 if a.estado<>'entregada' or not (exists(select 1 from public.reviews where assignment_id=aid)
 or exists(select 1 from public.editorial_antecedents where assignment_id=aid and tipo='dictamen'))
 then raise exception 'No hay evaluación entregada para esta asignación.'; end if;
 if fecha is null or fecha>(now() at time zone 'America/Merida')::date then raise exception 'Indica una fecha de envío válida, no futura.'; end if;
 if exists(select 1 from public.rcia_constancias_enviadas where assignment_id=aid and fecha_envio<>fecha)
 then raise exception 'Ya existe un envío con otra fecha; revise el registro antes de corregirlo.'; end if;
 insert into public.rcia_constancias_enviadas(assignment_id,fecha_envio,registrado_por)
 values(aid,fecha,auth.uid()) on conflict(assignment_id) do nothing;
end $$;
revoke all on function public.rcia_estado_constancias(uuid),public.rcia_marcar_constancia_enviada(uuid,date) from public,anon;
grant execute on function public.rcia_estado_constancias(uuid),public.rcia_marcar_constancia_enviada(uuid,date) to authenticated;
commit;
