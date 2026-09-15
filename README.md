# Gestión Editorial RCIA-UADY

Sistema interno de recepción, asignación de revisores, seguimiento y
publicación de manuscritos para la Revista de Ciencia e Ingeniería
Aplicada de la UADY. Independiente del sitio público de la revista;
enlazado desde ahí.

## Estado

Fase 1 completada: esquema de base de datos + app funcional (login,
envío, seguimiento, asignación, dictamen). **Pendiente antes de usarse:**

1. Crear el proyecto en [supabase.com](https://supabase.com) con el
   correo institucional `revista.fiq@correo.uady.mx`.
2. Ejecutar `schema_rcia_gestion.sql` en el SQL Editor de Supabase.
3. Crear los 4 buckets de Storage (Storage → New bucket), **públicos**
   para lectura:
   - `manuscritos`
   - `cartas-presentacion`
   - `declaraciones-conflicto`
   - `material-suplementario`
4. Copiar la **Project URL** y la **anon public key** (Project
   Settings → API) y pegarlas en `js/supabase-client.js`.
5. Publicar este repo en GitHub Pages (Settings → Pages → rama `main`,
   carpeta raíz).
6. Dar de alta manualmente al primer usuario con rol `editor`
   (después de que se registre, cambiar su fila en `profiles`:
   `role = 'editor'` desde el Table Editor de Supabase).
7. Dar de alta a los revisores de la misma forma (`role = 'revisor'`)
   una vez que se registren.

## Estructura

```
index.html              Login / registro (rol autor por defecto)
dashboard.html           Panel — vista distinta según rol
nuevo-manuscrito.html     Formulario de envío (autor)
css/style.css             Tema visual, consistente con el sitio público
js/supabase-client.js     Credenciales de Supabase (completar)
js/auth.js                 Login, registro, cierre de sesión
js/dashboard.js            Carga y acciones por rol
js/submit.js                Envío de manuscrito + subida de archivos
schema_rcia_gestion.sql    Esquema completo (tablas, RLS, triggers)
```

## Pendiente — Fase 2

- Cálculo automático de `fecha_limite` por etapa (5 días / 6–10
  semanas / 4–6 semanas / 2 semanas) según los tiempos publicados en
  el sitio.
- Edge Function con Resend para acuse de recibo automático y alertas
  de plazo vencido.
- Políticas de Storage por bucket (actualmente de lectura pública;
  falta restringir subida solo al autor correspondiente).
