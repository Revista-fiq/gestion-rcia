-- Compartir resultados revisados con el autor. Requiere fases 7, 8 y 9.
-- Ejecutar completo. No comparte dictámenes históricos ni genera correos al instalar.
begin;
create table if not exists public.rcia_resultados_autor (
 id uuid primary key,
 manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
 texto text not null check(length(texto) between 20 and 60000),
 creado_por uuid not null references public.profiles(id),
 creado_en timestamptz not null default now()
);
alter table public.rcia_resultados_autor enable row level security;
revoke all on public.rcia_resultados_autor from public,anon,authenticated;

create or replace function public.rcia_editor_resultados(mid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.manuscripts m join public.profiles p on p.id=auth.uid()
 where m.id=mid and p.activo and public.rcia_sin_conflicto(m.id)
 and (p.role='editor' or (p.role='editor_area' and m.editor_area_asignado_id=p.id)));
$$;

create or replace function public.rcia_leer_resultados(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare editorial boolean;
begin
 editorial:=public.rcia_editor_resultados(mid);
 if not editorial and not exists(
 select 1 from public.manuscripts m join public.profiles p on p.id=auth.uid()
 where m.id=mid and m.autor_correspondencia_id=p.id and p.role='autor' and p.activo
 and public.rcia_sin_conflicto(mid)) then raise exception 'No tienes acceso a estos resultados.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'texto',r.texto,'fecha',r.creado_en)
 || case when editorial then jsonb_build_object('compartido_por',p.nombre_completo) else '{}'::jsonb end
 order by r.creado_en desc,r.id),'[]'::jsonb)
 from public.rcia_resultados_autor r join public.profiles p on p.id=r.creado_por where r.manuscript_id=mid);
end $$;

-- Conserva los eventos admitidos por las migraciones anteriores.
do $$
declare c record;
begin
 for c in select conname,pg_get_expr(conbin,conrelid) expr from pg_constraint
 where conrelid='public.rcia_mail_queue'::regclass and contype='c'
 and pg_get_expr(conbin,conrelid) like '%event_type%'
 loop
 if position('review_results' in c.expr)=0 then
 execute format('alter table public.rcia_mail_queue drop constraint %I',c.conname);
 execute format('alter table public.rcia_mail_queue add constraint %I check ((%s) or event_type=''review_results'')',c.conname,c.expr);
 end if;
 end loop;
end $$;

create or replace function public.rcia_compartir_resultados(mid uuid, solicitud uuid, contenido text, anonimizado boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.manuscripts; r public.rcia_resultados_autor; nuevo uuid; hay_aviso boolean;
begin
 select * into strict m from public.manuscripts where id=mid for update;
 if not public.rcia_editor_resultados(mid) then raise exception 'Solo el editor responsable o el editor de área asignado pueden compartir resultados.'; end if;
 if anonimizado is distinct from true or solicitud is null or contenido is null
 or length(btrim(contenido)) not between 20 and 60000 then
 raise exception 'Revisa el texto y confirma que no contiene identidades ni comentarios confidenciales.'; end if;
 if not exists(select 1 from public.profiles where id=m.autor_correspondencia_id and role='autor' and activo)
 then raise exception 'El autor de correspondencia debe tener un perfil de autor activo.'; end if;
 select * into r from public.rcia_resultados_autor where id=solicitud;
 if found then
 if r.manuscript_id<>mid or r.texto<>btrim(contenido) or r.creado_por<>auth.uid() then
 raise exception 'La solicitud ya se utilizó para otro contenido.'; end if;
 nuevo:=r.id;
 else
 -- No duplica un mismo texto si se reintenta después de recargar la página.
 select * into r from public.rcia_resultados_autor where manuscript_id=mid order by creado_en desc,id limit 1;
 if found and r.texto=btrim(contenido) then nuevo:=r.id;
 else
 if not exists(select 1 from public.review_assignments a where a.manuscript_id=mid and a.estado='entregada'
 and (exists(select 1 from public.reviews v where v.assignment_id=a.id)
 or exists(select 1 from public.editorial_antecedents e where e.assignment_id=a.id and e.tipo='dictamen')))
 then raise exception 'Aún no hay dictámenes registrados para compartir.'; end if;
 insert into public.rcia_resultados_autor(id,manuscript_id,texto,creado_por)
 values(solicitud,mid,btrim(contenido),auth.uid()) returning id into nuevo;
 perform public.rcia_enqueue_mail('results:'||nuevo,'review_results',mid,null,m.autor_correspondencia_id,'autor',nuevo::text);
 end if;
 end if;
 select exists(select 1 from public.rcia_mail_queue where event_key='results:'||nuevo
 and recipient_id=m.autor_correspondencia_id and status in ('pending','processing','accepted')) into hay_aviso;
 return jsonb_build_object('id',nuevo,'aviso_generado',hay_aviso);
end $$;

-- Envía un aviso genérico compatible con el worker actual, sin incluir el dictamen.
-- Conserva la validación vigente de todos los demás eventos.
do $$
begin
 if to_regprocedure('public.rcia_email_context_pre_resultados(uuid)') is null then
 alter function public.rcia_email_context(uuid) rename to rcia_email_context_pre_resultados;
 end if;
end $$;
create or replace function public.rcia_email_context(qid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.rcia_mail_queue;
begin
 select * into q from public.rcia_mail_queue where id=qid;
 if not found then return null; end if;
 if q.event_type<>'review_results' then return public.rcia_email_context_pre_resultados(qid); end if;
 return (select jsonb_build_object('email',p.email,'folio',m.folio,'titulo',m.titulo,
 'event_type','decision','event_state','Dictámenes disponibles: consulte los resultados de evaluación en su panel')
 from public.manuscripts m join public.profiles p on p.id=m.autor_correspondencia_id
 where m.id=q.manuscript_id and p.id=q.recipient_id and p.role='autor' and p.activo
 and q.recipient_role='autor' and q.status='processing'
 and exists(select 1 from public.rcia_mail_settings where enabled)
 and not exists(select 1 from public.manuscript_exclusions x where x.manuscript_id=m.id and x.user_id=p.id)
 and exists(select 1 from public.rcia_resultados_autor r where r.manuscript_id=m.id and r.id::text=q.event_state));
end $$;
revoke all on function public.rcia_email_context_pre_resultados(uuid) from public,anon,authenticated;
revoke all on function public.rcia_email_context(uuid) from public,anon,authenticated;
grant execute on function public.rcia_email_context(uuid) to service_role;
revoke all on function public.rcia_editor_resultados(uuid) from public,anon,authenticated;
revoke all on function public.rcia_leer_resultados(uuid) from public,anon;
revoke all on function public.rcia_compartir_resultados(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.rcia_leer_resultados(uuid),public.rcia_compartir_resultados(uuid,uuid,text,boolean) to authenticated;
commit;
