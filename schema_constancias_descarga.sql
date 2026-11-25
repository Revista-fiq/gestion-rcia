-- Piloto: PDF preparado -> borrador privado -> validación del jefe -> descarga.
-- Requiere fases 7 y 8. No envía correos ni modifica dictámenes.
begin;
create table if not exists public.rcia_constancias (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null unique references public.review_assignments(id),
 ruta text not null unique,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 ronda integer not null default 1 check(ronda=1),
 revisor_id uuid not null references public.profiles(id),
 nombre_revisor text not null,
 folio text not null,
 titulo text not null,
 cargado_por uuid not null references public.profiles(id),
 cargado_en timestamptz not null default now(),
 validado_por uuid references public.profiles(id),
 validado_en timestamptz,
 check ((validado_por is null) = (validado_en is null))
);
alter table public.rcia_constancias enable row level security;
revoke all on public.rcia_constancias from public,anon,authenticated;

-- La elegibilidad también reconoce dictámenes anteriores incorporados al portal.
create or replace function public.rcia_constancia_elegible(aid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.review_assignments a where a.id=aid and a.estado='entregada'
 and (exists(select 1 from public.reviews r where r.assignment_id=a.id)
 or exists(select 1 from public.editorial_antecedents e where e.assignment_id=a.id and e.tipo='dictamen')));
$$;
revoke all on function public.rcia_constancia_elegible(uuid) from public,anon,authenticated;

create or replace function public.rcia_constancia_acceso(aid uuid, publicar boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.review_assignments a
 join public.manuscripts m on m.id=a.manuscript_id
 join public.profiles p on p.id=auth.uid()
 where a.id=aid and p.activo and public.rcia_sin_conflicto(m.id)
 and (p.role='editor' or (not publicar and
 (p.role='editor_area' and m.editor_area_asignado_id=p.id
 or p.role='revisor' and a.reviewer_id=p.id))));
$$;
revoke all on function public.rcia_constancia_acceso(uuid,boolean) from public,anon,authenticated;

create or replace function public.rcia_constancia_carga(ruta_archivo text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.review_assignments a
 where a.id::text=split_part(ruta_archivo,'/',1)
 and ruta_archivo ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.]pdf$'
 and public.rcia_constancia_acceso(a.id,true) and public.rcia_constancia_elegible(a.id)
 and not exists(select 1 from public.rcia_constancias c where c.assignment_id=a.id and c.validado_en is not null));
$$;
create or replace function public.rcia_constancia_lectura(ruta_archivo text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rcia_constancias c
 join public.review_assignments a on a.id=c.assignment_id
 where c.ruta=ruta_archivo and c.revisor_id=a.reviewer_id
 and public.rcia_constancia_acceso(c.assignment_id,false)
 and (public.rcia_constancia_acceso(c.assignment_id,true) or c.validado_en is not null));
$$;
revoke all on function public.rcia_constancia_carga(text),public.rcia_constancia_lectura(text) from public,anon;
-- Las políticas restrictivas también se evalúan para anon: sin auth.uid(), devuelven false.
grant execute on function public.rcia_constancia_carga(text),public.rcia_constancia_lectura(text) to authenticated,anon;

-- Integra la ruta privada al límite de conflictos ya existente (fase 7),
-- sin ampliar los permisos de lectura del bucket.
create or replace function public.rcia_archivo_sin_conflicto(bucket text,ruta text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when bucket='constancias-revision' then exists(
 select 1 from public.review_assignments a where a.id::text=split_part(ruta,'/',1)
 and public.rcia_sin_conflicto(a.manuscript_id))
 when not exists(select 1 from public.manuscript_exclusions where user_id=auth.uid()) then true
 else exists(select 1 from public.rcia_documentos_vinculados(bucket,ruta))
 and not exists(select 1 from public.rcia_documentos_vinculados(bucket,ruta) d
 where not public.rcia_sin_conflicto(d.mid)) end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('constancias-revision','constancias-revision',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

drop policy if exists constancias_upload on storage.objects;
create policy constancias_upload on storage.objects for insert to authenticated
with check(bucket_id='constancias-revision' and public.rcia_constancia_carga(name));
drop policy if exists constancias_read on storage.objects;
create policy constancias_read on storage.objects for select to authenticated
using(bucket_id='constancias-revision' and public.rcia_constancia_lectura(name));
-- Mantiene el bloqueo de originales al revisor y añade solo su constancia validada.
drop policy if exists rcia_storage_revisor_limite on storage.objects;
create policy rcia_storage_revisor_limite on storage.objects as restrictive
for select to authenticated using (
 public.current_role_name()<>'revisor'
 or (bucket_id='manuscritos-anonimizados' and public.rcia_puede_leer_anonimo(name))
 or (bucket_id='constancias-revision' and public.rcia_constancia_lectura(name))
);
-- Límites restrictivos: otras políticas amplias no deben dar acceso a este bucket.
drop policy if exists constancias_limite_read on storage.objects;
create policy constancias_limite_read on storage.objects as restrictive for select to public
using(bucket_id<>'constancias-revision' or (auth.uid() is not null and public.rcia_constancia_lectura(name)));
drop policy if exists constancias_limite_insert on storage.objects;
create policy constancias_limite_insert on storage.objects as restrictive for insert to public
with check(bucket_id<>'constancias-revision' or (auth.uid() is not null and public.rcia_constancia_carga(name)));
drop policy if exists constancias_limite_update on storage.objects;
create policy constancias_limite_update on storage.objects as restrictive for update to public
using(bucket_id<>'constancias-revision') with check(bucket_id<>'constancias-revision');
drop policy if exists constancias_limite_delete on storage.objects;
create policy constancias_limite_delete on storage.objects as restrictive for delete to public
using(bucket_id<>'constancias-revision');

create or replace function public.rcia_preparar_constancia(aid uuid,ruta_archivo text,huella text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.review_assignments; c public.rcia_constancias; nuevo uuid;
begin
 select * into strict a from public.review_assignments where id=aid for update;
 if not public.rcia_constancia_acceso(aid,true) then raise exception 'Solo el editor en jefe autorizado puede preparar constancias.'; end if;
 select * into c from public.rcia_constancias where assignment_id=aid for update;
 if c.validado_en is not null then
   if c.ruta=ruta_archivo and c.sha256=huella then return c.id; end if;
   raise exception 'Esta constancia ya está publicada; no se puede sobrescribir.';
 end if;
 if not public.rcia_constancia_carga(ruta_archivo) or split_part(ruta_archivo,'/',1) is distinct from aid::text
 or huella is null or huella !~ '^[0-9a-f]{64}$'
 or not exists(select 1 from storage.objects where bucket_id='constancias-revision' and name=ruta_archivo)
 then raise exception 'Comprueba el PDF cargado y la evaluación entregada.'; end if;
 insert into public.rcia_constancias(assignment_id,ruta,sha256,revisor_id,nombre_revisor,folio,titulo,cargado_por)
 select aid,ruta_archivo,huella,a.reviewer_id,p.nombre_completo,m.folio,m.titulo,auth.uid()
 from public.manuscripts m join public.profiles p on p.id=a.reviewer_id where m.id=a.manuscript_id
 on conflict(assignment_id) do update set ruta=excluded.ruta,sha256=excluded.sha256,
 revisor_id=excluded.revisor_id,nombre_revisor=excluded.nombre_revisor,folio=excluded.folio,titulo=excluded.titulo,
 cargado_por=excluded.cargado_por,cargado_en=now()
 returning id into nuevo;
 return nuevo;
end $$;

create or replace function public.rcia_validar_constancia(aid uuid,ruta_esperada text,huella_esperada text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.review_assignments; c public.rcia_constancias;
begin
 select * into strict a from public.review_assignments where id=aid for update;
 if not public.rcia_constancia_acceso(aid,true) then raise exception 'Solo el editor en jefe autorizado puede validar constancias.'; end if;
 select * into strict c from public.rcia_constancias where assignment_id=aid for update;
 if c.ruta is distinct from ruta_esperada or c.sha256 is distinct from huella_esperada
 then raise exception 'El borrador cambió. Recarga y revisa el PDF antes de validar.'; end if;
 if c.revisor_id<>a.reviewer_id or not public.rcia_constancia_elegible(aid)
 then raise exception 'La asignación cambió o no tiene un dictamen entregado.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='constancias-revision' and name=c.ruta)
 then raise exception 'No se encuentra el PDF de la constancia.'; end if;
 if c.validado_en is null then
 update public.rcia_constancias set validado_en=now(),validado_por=auth.uid() where id=c.id;
 end if;
 return c.id;
end $$;

-- Una llamada por manuscrito en edición; sin parámetro, solo constancias propias publicadas.
create or replace function public.rcia_listar_constancias(mid uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if mid is null then
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'assignment_id',c.assignment_id,
 'ruta',c.ruta,'folio',c.folio,'titulo',c.titulo,'revisor',c.nombre_revisor,'ronda',c.ronda,
 'validado_en',c.validado_en) order by c.folio,c.id),'[]'::jsonb)
 from public.rcia_constancias c join public.review_assignments a on a.id=c.assignment_id
 join public.profiles p on p.id=auth.uid()
 where p.role='revisor' and p.activo and c.revisor_id=p.id and a.reviewer_id=p.id
 and c.validado_en is not null and public.rcia_sin_conflicto(a.manuscript_id));
 end if;
 if not exists(select 1 from public.manuscripts m join public.profiles p on p.id=auth.uid()
 where m.id=mid and p.activo and public.rcia_sin_conflicto(mid)
 and (p.role='editor' or (p.role='editor_area' and m.editor_area_asignado_id=p.id)))
 then raise exception 'Sin autorización para consultar estas constancias.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'revisor',p.nombre_completo,
 'correo',p.email,'folio',m.folio,'titulo',m.titulo,'id',c.id,'ronda',coalesce(c.ronda,1),
 'ruta',case when public.rcia_constancia_acceso(a.id,true) or c.validado_en is not null then c.ruta end,
 'sha256',case when public.rcia_constancia_acceso(a.id,true) then c.sha256 end,
 'validado_en',c.validado_en,'validado_por',v.nombre_completo)
 order by a.fecha_asignacion,a.id),'[]'::jsonb)
 from public.review_assignments a join public.manuscripts m on m.id=a.manuscript_id
 join public.profiles p on p.id=a.reviewer_id
 left join public.rcia_constancias c on c.assignment_id=a.id and c.revisor_id=a.reviewer_id
 left join public.profiles v on v.id=c.validado_por
 where a.manuscript_id=mid and public.rcia_constancia_elegible(a.id));
end $$;
revoke all on function public.rcia_preparar_constancia(uuid,text,text),
 public.rcia_validar_constancia(uuid,text,text),public.rcia_listar_constancias(uuid) from public,anon;
grant execute on function public.rcia_preparar_constancia(uuid,text,text),
 public.rcia_validar_constancia(uuid,text,text),public.rcia_listar_constancias(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
