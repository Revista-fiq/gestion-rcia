-- Conflictos de interés por manuscrito. Ejecutar completo antes de publicar el panel.
-- No bloquea ninguna cuenta hasta que el editor responsable la seleccione.
begin;
create table public.manuscript_exclusions (
 manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 primary key(manuscript_id,user_id)
);
alter table public.manuscript_exclusions enable row level security;
revoke all on public.manuscript_exclusions from anon,authenticated;
grant select on public.manuscript_exclusions to authenticated;

create function public.rcia_sin_conflicto(mid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.manuscript_exclusions x
 where x.manuscript_id=mid and x.user_id=auth.uid());
$$;
create policy exclusions_read on public.manuscript_exclusions for select to authenticated
using (public.current_role_name()='editor' and public.rcia_sin_conflicto(manuscript_id));

create function public.rcia_conflicto_asignacion(aid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select public.rcia_sin_conflicto(a.manuscript_id)
 from public.review_assignments a where a.id=aid),false);
$$;
create policy rcia_conflicto_limite on public.manuscripts as restrictive for all to authenticated using (public.rcia_sin_conflicto(id)) with check (public.rcia_sin_conflicto(id));
create policy rcia_conflicto_limite on public.manuscript_versions as restrictive for all to authenticated using (public.rcia_sin_conflicto(manuscript_id)) with check (public.rcia_sin_conflicto(manuscript_id));
create policy rcia_conflicto_limite on public.review_assignments as restrictive for all to authenticated using (public.rcia_sin_conflicto(manuscript_id)) with check (public.rcia_sin_conflicto(manuscript_id));
create policy rcia_conflicto_limite on public.status_log as restrictive for all to authenticated using (public.rcia_sin_conflicto(manuscript_id)) with check (public.rcia_sin_conflicto(manuscript_id));
create policy rcia_conflicto_limite on public.reviews as restrictive for all to authenticated
using (public.rcia_conflicto_asignacion(assignment_id)) with check (public.rcia_conflicto_asignacion(assignment_id));

create function public.rcia_guardar_exclusion(mid uuid, uid uuid, bloquear boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if bloquear is null or auth.uid() is null or not exists(
 select 1 from public.profiles where id=auth.uid() and role='editor' and activo)
 or not public.rcia_sin_conflicto(mid) then raise exception 'Solo el editor responsable autorizado puede cambiar exclusiones.'; end if;
 if uid=auth.uid() then raise exception 'No puedes excluir tu propia cuenta desde este panel.'; end if;
 perform 1 from public.manuscripts where id=mid for update;
 if not found then raise exception 'Manuscrito no encontrado.'; end if;
 if bloquear then
   if not exists(select 1 from public.profiles where id=uid and role='editor_area') then
     raise exception 'Selecciona la cuenta de editor de área de la persona.';
   end if;
   insert into public.manuscript_exclusions(manuscript_id,user_id,created_by)
   values(mid,uid,auth.uid()) on conflict do nothing;
   update public.manuscripts set editor_area_asignado_id=null
   where id=mid and editor_area_asignado_id=uid;
 else
   delete from public.manuscript_exclusions where manuscript_id=mid and user_id=uid;
 end if;
end $$;

-- Impide volver a asignar la cuenta excluida, incluso desde una pestaña antigua.
create function public.rcia_validar_editor_sin_conflicto() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.manuscript_exclusions x
 where x.manuscript_id=new.id and x.user_id=new.editor_area_asignado_id) then
 raise exception 'Ese editor está excluido por conflicto de interés.'; end if;
 return new;
end $$;
create trigger rcia_validar_editor_sin_conflicto before insert or update of editor_area_asignado_id
on public.manuscripts for each row execute function public.rcia_validar_editor_sin_conflicto();

-- Relación exacta entre documentos y manuscritos, incluyendo versiones anteriores.
create function public.rcia_documentos_vinculados(bucket text,ruta text)
returns table(mid uuid) language sql stable security definer set search_path='' as $$
 select m.id from public.manuscripts m where
 (bucket='manuscritos-anonimizados' and split_part(ruta,'/',1)=m.id::text)
 or ('https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/'||bucket||'/'||ruta)
 in(m.archivo_manuscrito_url,m.archivo_carta_url,m.archivo_conflictos_url,m.archivo_material_suplementario_url,m.archivo_anonimizado_url)
 union select v.manuscript_id from public.manuscript_versions v where v.archivo_url=
 ('https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/'||bucket||'/'||ruta)
 union select a.manuscript_id from public.reviews r join public.review_assignments a on a.id=r.assignment_id
 where r.archivo_anotado_url=('https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/'||bucket||'/'||ruta);
$$;
revoke all on function public.rcia_documentos_vinculados(text,text) from public,anon,authenticated;
create function public.rcia_archivo_sin_conflicto(bucket text,ruta text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when not exists(select 1 from public.manuscript_exclusions where user_id=auth.uid()) then true
 else exists(select 1 from public.rcia_documentos_vinculados(bucket,ruta))
 and not exists(select 1 from public.rcia_documentos_vinculados(bucket,ruta) d
 where not public.rcia_sin_conflicto(d.mid)) end;
$$;
create policy rcia_conflicto_archivo on storage.objects as restrictive for select to authenticated
using(public.rcia_archivo_sin_conflicto(bucket_id,name));
create policy rcia_conflicto_archivo_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'manuscritos-anonimizados' or public.rcia_archivo_sin_conflicto(bucket_id,name));
create policy rcia_conflicto_archivo_update on storage.objects as restrictive for update to authenticated
using(public.rcia_archivo_sin_conflicto(bucket_id,name)) with check(public.rcia_archivo_sin_conflicto(bucket_id,name));
create policy rcia_conflicto_archivo_delete on storage.objects as restrictive for delete to authenticated
using(public.rcia_archivo_sin_conflicto(bucket_id,name));

create or replace function public.rcia_mis_asignaciones()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', a.id, 'estado', a.estado, 'fecha_limite', a.fecha_limite,
   'manuscripts_blind', jsonb_build_object(
      'id', m.id, 'folio', m.folio, 'titulo', m.titulo, 'resumen', m.resumen,
      'tipo', m.tipo, 'area_tematica', m.area_tematica,
      'archivo_manuscrito_url', case when a.estado <> 'declinada'
        then m.archivo_anonimizado_url else null end
   )) order by a.fecha_asignacion desc), '[]'::jsonb)
 from public.review_assignments a
 join public.manuscripts m on m.id = a.manuscript_id
 join public.profiles p on p.id = a.reviewer_id
 where public.rcia_sin_conflicto(m.id) and a.reviewer_id = auth.uid() and p.role = 'revisor' and p.activo;
$$;

create or replace function public.rcia_puede_leer_anonimo(ruta text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
   select 1 from public.manuscripts m
   join public.review_assignments a on a.manuscript_id = m.id
   join public.profiles p on p.id = a.reviewer_id
   where public.rcia_sin_conflicto(m.id) and a.reviewer_id = auth.uid() and p.role = 'revisor' and p.activo
     and a.estado in ('pendiente','aceptada','entregada')
     and m.archivo_anonimizado_url =
       'https://qrdvsojttyuxnozyovbp.supabase.co/storage/v1/object/public/manuscritos-anonimizados/' || ruta
 );
$$;
revoke all on function public.rcia_sin_conflicto(uuid) from public,anon;
grant execute on function public.rcia_sin_conflicto(uuid) to authenticated;
revoke all on function public.rcia_conflicto_asignacion(uuid) from public,anon;
grant execute on function public.rcia_conflicto_asignacion(uuid) to authenticated;
revoke all on function public.rcia_guardar_exclusion(uuid,uuid,boolean) from public,anon;
grant execute on function public.rcia_guardar_exclusion(uuid,uuid,boolean) to authenticated;
revoke all on function public.rcia_archivo_sin_conflicto(text,text) from public,anon;
grant execute on function public.rcia_archivo_sin_conflicto(text,text) to authenticated;
revoke all on function public.rcia_validar_editor_sin_conflicto() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;