# Activar la etapa de revisión — RCIA-UADY

## Qué incluye

- Restaura `js/evaluacion.js`, que faltaba en el repositorio publicado.
- Conserva los ocho criterios y los umbrales de la ficha propuesta, sus filtros éticos, comentarios por criterio, comentario privado y segunda revisión.
- El revisor abre el manuscrito anonimizado desde su panel o desde la ficha.
- La recomendación se calcula también en la base de datos. Registrar el dictamen y marcar la asignación como entregada es una sola operación; los duplicados se rechazan.
- El editor de área consulta los dictámenes desde su panel. La recomendación del revisor no cambia automáticamente la decisión editorial del manuscrito.
- Los archivos pasan a ser privados y se abren con enlaces temporales. Se conserva el formato de las referencias ya guardadas.
- Mantiene el inicio de sesión existente. Continúa asignando los roles en `profiles` desde Supabase; no se implementa la autenticación institucional pendiente ni se envían correos.

## Estado de entrega

Preparado y probado localmente sobre `Revista-fiq/gestion-rcia`. Los cambios se entregan en una propuesta de revisión dentro del repositorio institucional. La activación requiere aplicar la migración en Supabase y después integrar esta propuesta en main; no hay conexión administrativa a Supabase en esta sesión.

## Instalación

1. En Supabase, confirma que ya están instaladas las fases 2 y 3: `profiles.areas_asignadas`, `manuscripts.archivo_anonimizado_url`, la tabla `manuscript_versions` y las políticas de Storage de la fase 3b. Las pruebas usan esos scripts de tu copia local como referencia; no se pudo inspeccionar el esquema vivo. No vuelvas a ejecutar el esquema inicial.
2. En el SQL Editor del proyecto **qrdvsojttyuxnozyovbp**, ejecuta completo **schema_fase4_revision.sql**, una sola vez. La operación es transaccional: si falla, no deja cambios parciales. Si encuentra dictámenes duplicados, se detiene sin borrar ninguno; hay que revisarlos antes de continuar. Si falta algún objeto de las fases anteriores, conserva el error para ajustar la migración al esquema real.
3. Después de comprobar que la migración terminó correctamente, integra la propuesta de revisión en `main`. Esto publica juntos **evaluacion.html**, **js/dashboard.js**, **js/supabase-client.js** y **js/evaluacion.js**. No se modifican `auth.js` ni `index.html`. Si usas el paquete ZIP, sustituye esos cuatro archivos respetando las carpetas.
4. Espera la actualización de GitHub Pages y recarga el sitio sin caché. Ejecuta los pasos 2 y 3 en la misma ventana de mantenimiento: el código anterior no funciona con los nuevos permisos de lectura.

La migración vuelve privados los cinco buckets editoriales. Los enlaces del panel abren URLs temporales; los enlaces públicos antiguos compartidos fuera del sistema dejarán de permitir descarga. No cambia los archivos ni sus referencias almacenadas.

## Prueba con tus correos

Usa cuentas distintas para autor, revisor y editor de área, preferentemente en perfiles de navegador distintos. Asigna `role = revisor` y `activo = true` a la cuenta revisora. El editor de área debe tener las áreas correspondientes en `areas_asignadas`.

1. Como editor de área, carga una copia realmente anonimizada y asigna el revisor.
2. Como revisor, abre el panel: debe aparecer el folio asignado y el botón para evaluar. Comprueba la descarga desde el panel y desde la ficha.
3. Puntúa los ocho criterios, escribe comentarios y envía. Con todos los puntajes en 4 debe recomendar aceptar con 32/32. Si no requiere segunda revisión, la disponibilidad se establece en «No aplica».
4. Recarga el panel: debe indicar «Dictamen entregado». Intentar enviar de nuevo no debe crear otra fila.
5. Como editor de área, revisa «Evaluaciones» y confirma puntajes y comentarios privados.
6. Como otro revisor, comprueba que no aparece ese manuscrito ni se abre la ficha usando el identificador de la primera cuenta. Como autor, no debe haber acceso a comentarios privados.
7. Con otro manuscrito de prueba, desmarca un filtro ético: debe guardar rechazo con 0 puntos sin exigir los ocho criterios.

El anonimato del contenido requiere que el editor retire autoría, afiliaciones y metadatos del documento. El sistema restringe el acceso y utiliza un nombre neutro para nuevas cargas anonimizadas; no transforma el contenido del archivo. Los nombres históricos ya almacenados se conservan.

## Validación realizada

- Pruebas ejecutadas con un PostgreSQL local (PGlite): aislamiento de autoría y archivos, asignaciones propias, bloqueo de cambios de rol, puntajes inválidos, entrega atómica, duplicados, filtros éticos y confidencialidad por rol.
- Pruebas de lógica de la ficha: carga, enlace al archivo, siete límites de puntaje, segunda revisión y bloqueo de doble clic.
- Comprobación de sintaxis de los tres archivos JavaScript modificados/agregados.
- Pendiente: prueba en navegador con las cuentas reales y las políticas actualmente instaladas en Supabase. Las pruebas locales no sustituyen esta comprobación.

Para repetir las pruebas en la copia completa: `npm install`, `npm test`. Los scripts bajo tests/fixtures son referencias de pruebas, no instrucciones para reinstalar la base de producción.
