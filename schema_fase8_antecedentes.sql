-- Fase 8: antecedentes externos y fecha de aceptación. Requiere fase 7.
-- Ejecutar completo una vez; no acepta manuscritos ni envía correos.
begin;
alter table public.manuscripts add column if not exists fecha_aceptacion date;
create table public.editorial_antecedents (
 id uuid primary key default gen_random_uuid(),
 manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
 assignment_id uuid references public.review_assignments(id),
 tipo text not null check(tipo in ('dictamen','version_corregida')),
 visibilidad text not null default 'editor' check(visibilidad in ('editor','autor')),
 fecha_documento date not null,
 ruta text not null unique,
 registrado_por uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check(tipo <> 'version_corregida' or (assignment_id is null and visibilidad='autor')),
 check(tipo <> 'dictamen' or assignment_id is not null)
);
create unique index antecedente_por_asignacion on public.editorial_antecedents(assignment_id) where tipo='dictamen';
alter table public.editorial_antecedents enable row level security;
revoke all on public.editorial_antecedents from anon,authenticated;
grant select on public.editorial_antecedents to authenticated;
create policy antecedentes_select on public.editorial_antecedents for select to authenticated using (
 public.rcia_sin_conflicto(manuscript_id) and exists (
 select 1 from public.manuscripts m where m.id=manuscript_id and (
 public.current_role_name() in ('editor','editor_area')
 or (m.autor_correspondencia_id=auth.uid() and visibilidad='autor'))));
insert into storage.buckets(id,name,public) values('antecedentes-editoriales','antecedentes-editoriales',false)
on conflict(id) do update set public=false;

create function public.rcia_puede_cargar_antecedente(ruta text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.manuscripts m join public.profiles p on p.id=auth.uid()
 where m.id::text=split_part(ruta,'/',1) and p.role='editor' and p.activo
 and public.rcia_sin_conflicto(m.id));
$$;
create function public.rcia_puede_leer_antecedente(ruta_archivo text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.editorial_antecedents d
 join public.manuscripts m on m.id=d.manuscript_id
 join public.profiles p on p.id=auth.uid()
 where d.ruta=ruta_archivo and p.activo and public.rcia_sin_conflicto(m.id)
 and (p.role='editor'
 or (p.role='editor_area' and m.area_tematica=any(coalesce(p.areas_asignadas,array[]::text[])))
 or (p.role='autor' and m.autor_correspondencia_id=p.id and d.visibilidad='autor')));
$$;
create policy antecedentes_upload on storage.objects for insert to authenticated with check(
 bucket_id='antecedentes-editoriales' and public.rcia_puede_cargar_antecedente(name));
create policy antecedentes_read on storage.objects for select to authenticated using(
 bucket_id='antecedentes-editoriales' and public.rcia_puede_leer_antecedente(name));
-- Solo permite retirar una carga que falló antes de registrarse.
create policy antecedentes_cleanup on storage.objects for delete to authenticated using(
 bucket_id='antecedentes-editoriales' and public.rcia_puede_cargar_antecedente(name)
 and not exists(select 1 from public.editorial_antecedents d where d.ruta=name));

create function public.rcia_registrar_antecedente(mid uuid, aid uuid, clase text, visible_autor boolean, fecha date, ruta_archivo text, revisor_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.manuscripts; a public.review_assignments; nuevo uuid; version integer; enlace text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='editor' and activo)
 or not public.rcia_sin_conflicto(mid) then raise exception 'Solo el editor responsable autorizado puede incorporar antecedentes.'; end if;
 select * into strict m from public.manuscripts where id=mid for update;
 if clase is null or clase not in ('dictamen','version_corregida') or fecha is null
 or fecha > (now() at time zone 'America/Merida')::date or visible_autor is null then
 raise exception 'Indica tipo y fecha válida del documento.'; end if;
 if m.estado in ('aceptado','publicado') then raise exception 'Incorpora los antecedentes antes de registrar la aceptación.'; end if;
 if split_part(ruta_archivo,'/',1) is distinct from mid::text or not exists(
 select 1 from storage.objects where bucket_id='antecedentes-editoriales' and name=ruta_archivo) then
 raise exception 'No se encontró el archivo cargado para este manuscrito.'; end if;
 if clase='dictamen' then
 if aid is null then
   if revisor_id is null or not exists(select 1 from public.profiles where id=revisor_id and role='revisor' and activo)
   or not public.rcia_sin_conflicto(mid) or exists(select 1 from public.manuscript_exclusions where manuscript_id=mid and user_id=revisor_id) then
     raise exception 'Selecciona un revisor activo y sin conflicto para registrar su dictamen previo.';
   end if;
   if exists(select 1 from public.review_assignments where manuscript_id=mid and reviewer_id=revisor_id) then
     raise exception 'Este revisor ya tiene una asignación. Selecciónala en la lista de asignaciones existentes.';
   end if;
   -- Se registra una evaluación ya realizada, sin enviar una invitación nueva.
   insert into public.review_assignments(manuscript_id,reviewer_id,estado,fecha_respuesta)
   values(mid,revisor_id,'entregada',now()) returning id into aid;
 else
 select * into strict a from public.review_assignments where id=aid and manuscript_id=mid for update;
 if a.estado not in ('pendiente','aceptada') or exists(select 1 from public.reviews where assignment_id=aid) then
 raise exception 'La asignación ya tiene dictamen o está declinada; no se sobrescribe.'; end if;
 end if;
 elsif aid is not null then raise exception 'La versión corregida no corresponde a una asignación individual.';
 end if;
 insert into public.editorial_antecedents(manuscript_id,assignment_id,tipo,visibilidad,fecha_documento,ruta,registrado_por)
 values(mid,aid,clase,case when clase='version_corregida' or visible_autor then 'autor' else 'editor' end,fecha,ruta_archivo,auth.uid())
 returning id into nuevo;
 if clase='dictamen' then
 update public.review_assignments set estado='entregada',fecha_respuesta=now() where id=aid;
 else
 select coalesce(max(numero_version),0)+1 into version from public.manuscript_versions where manuscript_id=mid;
 enlace:='https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/antecedentes-editoriales/'||ruta_archivo;
 insert into public.manuscript_versions(manuscript_id,numero_version,archivo_url,subido_por,notas)
 values(mid,version,enlace,auth.uid(),'Versión corregida recibida fuera del portal. Fecha del documento: '||fecha::text);
 update public.manuscripts set archivo_manuscrito_url=enlace,archivo_anonimizado_url=null where id=mid;
 end if;
 insert into public.status_log(manuscript_id,estado_anterior,estado_nuevo,changed_by,notas)
 values(mid,m.estado,m.estado,auth.uid(),case when clase='dictamen' then 'Dictamen recibido fuera del portal e incorporado al expediente.' else 'Versión corregida recibida fuera del portal e incorporada al expediente.' end);
 return nuevo;
end $$;

create function public.rcia_fecha_aceptacion() returns trigger language plpgsql set search_path='' as $$
begin
 if new.estado='aceptado' and old.estado is distinct from new.estado then
 if exists(select 1 from public.editorial_antecedents where manuscript_id=new.id) then
 if not exists(select 1 from public.editorial_antecedents where manuscript_id=new.id and tipo='dictamen')
 or not exists(select 1 from public.editorial_antecedents where manuscript_id=new.id and tipo='version_corregida')
 or exists(select 1 from public.review_assignments where manuscript_id=new.id and estado in ('pendiente','aceptada')) then
 raise exception 'Completa los dictámenes previos, cierra las asignaciones pendientes e incorpora la versión corregida antes de aceptar.';
 end if;
end if;
new.fecha_aceptacion:=(now() at time zone 'America/Merida')::date;
 elsif new.fecha_aceptacion is distinct from old.fecha_aceptacion then
 raise exception 'La fecha de aceptación se registra al cambiar el estado a Aceptado.';
 end if;
 return new;
end $$;
create trigger rcia_fecha_aceptacion before update on public.manuscripts
for each row execute function public.rcia_fecha_aceptacion();

-- Mantiene el anonimizado obligatorio para revisión; permite aceptación de una versión final importada.
create or replace function public.exigir_anonimizado_antes_de_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.estado is distinct from old.estado and new.estado not in ('recibido','acuse_enviado','rechazado','desistido')
 and new.archivo_anonimizado_url is null then
 if new.estado not in ('aceptado','publicado') or not exists(
 select 1 from public.editorial_antecedents d where d.manuscript_id=new.id and d.tipo='version_corregida'
 and new.archivo_manuscrito_url='https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/antecedentes-editoriales/'||d.ruta) then
 raise exception 'Falta el archivo anonimizado para revisión o la versión corregida del expediente externo para aceptación.';
 end if;
 end if;
 return new;
end $$;

create or replace function public.rcia_documentos_vinculados(bucket text,ruta text)
returns table(mid uuid) language sql stable security definer set search_path='' as $$
 select m.id from public.manuscripts m where
 (bucket='manuscritos-anonimizados' and split_part(ruta,'/',1)=m.id::text)
 or ('https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/'||bucket||'/'||ruta)
 in(m.archivo_manuscrito_url,m.archivo_carta_url,m.archivo_conflictos_url,m.archivo_material_suplementario_url,m.archivo_anonimizado_url)
 union select v.manuscript_id from public.manuscript_versions v where v.archivo_url=
 ('https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/'||bucket||'/'||ruta)
 union select a.manuscript_id from public.reviews r join public.review_assignments a on a.id=r.assignment_id
 where r.archivo_anotado_url=('https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/'||bucket||'/'||ruta)
 union select d.manuscript_id from public.editorial_antecedents d where bucket='antecedentes-editoriales' and d.ruta=$2;
$$;
revoke all on function public.rcia_puede_cargar_antecedente(text) from public,anon;
grant execute on function public.rcia_puede_cargar_antecedente(text) to authenticated;
revoke all on function public.rcia_puede_leer_antecedente(text) from public,anon;
grant execute on function public.rcia_puede_leer_antecedente(text) to authenticated;
revoke all on function public.rcia_registrar_antecedente(uuid,uuid,text,boolean,date,text,uuid) from public,anon;
grant execute on function public.rcia_registrar_antecedente(uuid,uuid,text,boolean,date,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
