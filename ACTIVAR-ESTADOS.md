# Activar los estados automáticos de revisión

La fase 13 agrega seguimiento; no acepta ni rechaza artículos. El cambio de firmas está publicado en el formulario, los modelos y politica-firmas.html y no requiere SQL.

## Reglas

- Asignar un editor o invitar revisores no inicia por sí solo la revisión externa.
- Una aceptación inicia «En revisión» si hay editor de área activo y autorizado, sin exclusión, y archivo anonimizado. Un dictamen documentado también acredita el inicio.
- «Dictamen emitido» requiere el número configurado de dictámenes con evidencia y ninguna asignación pendiente o aceptada sin entregar. Inicialmente son dos, como decisión operativa de RCIA, no como requisito de Latindex. El editor puede ajustar entre 1 y 10 por expediente en el panel.
- Las declinaciones no cuentan como dictámenes. Una marca entregada sin fila de reviews ni antecedente documental tampoco cuenta. Los dictámenes históricos documentados conservan su valor si después se desactiva su cuenta, salvo exclusión por conflicto.
- No retrocede ni modifica expedientes en dictamen_emitido, en_correccion, aceptado, publicado, rechazado o desistido. La segunda ronda sigue siendo un proceso manual; no se crean nuevas asignaciones ni rondas.
- Para invitar otro revisor tras dictamen_emitido o en un expediente cerrado, el editor debe reabrirlo explícitamente. La inserción se serializa con las entregas para que una invitación simultánea no deje oculto un trabajo pendiente.
- Aceptar, rechazar, solicitar correcciones, publicar y desistir siguen siendo decisiones humanas. Los correos de esos eventos se conservan; no se agrega un nuevo tipo al worker.

## Instalación

1. Revisa los triggers vivos con VERIFICAR-ESTADOS.sql (solo lectura). Comprueba las fases 4, 7, 8 y 11 y los avisos existentes. Si hay otra automatización que cambie estados, hay que contrastarla antes de instalar esta.
2. Ejecuta completo schema_fase13_estados.sql en el SQL Editor del proyecto de RCIA. Es transaccional y puede repetirse. No reinstales el esquema inicial ni las fases anteriores.
3. Recarga el panel. El campo «Dictámenes requeridos para completar la revisión» solo aparece cuando la columna existe y el expediente sigue en recibido, acuse_enviado o en_revision.
4. Con un expediente de prueba, asigna editor de área y carga un anonimizado; invita dos revisores. Comprueba que asignar no cambie el estado. Acepta con el primero: debe pasar a en_revision. Entrega ambos: debe pasar a dictamen_emitido. Si hay otra invitación pendiente, aún no debe completarse; cuando esta se decline, vuelve a evaluarse.
5. Comprueba la bitácora y los avisos habituales de respuesta y recepción de dictamen, sin mensajes duplicados. Verifica que la recomendación del revisor no cambie a aceptado/rechazado el manuscrito.

La instalación no cambia estados históricos. Los expedientes existentes se evalúan en su siguiente aceptación, entrega o cambio de preparación/umbral; revisa los demás manualmente antes de sincronizarlos. No cambies estados para intentar provocar correos.

## Validación y límites

Pruebas locales con PGlite: esquema base y fases 4, 7, 8 y 11 del repositorio, instalación repetible de fase 13, aceptación, archivos/editor faltantes, entrega diferida, umbral, declinación pendiente, rechazo ético, evidencia externa, bitácora y permisos. npm test incluye estos casos.

La fase 9 y el worker reales no están versionados: las pruebas usan un contrato mínimo de cola. No acreditan la instalación en producción, el envío real ni concurrencia entre sesiones de PostgreSQL independientes. No se sustituyen las funciones de bitácora o correo existentes. Se serializan entregas por manuscrito antes del bloqueo del validador anterior; las transiciones se evalúan al confirmar la transacción, cuando el dictamen ya existe.

Para desactivar solo la automatización sin borrar datos:

```sql
begin;
drop trigger if exists rcia_estado_asignacion on public.review_assignments;
drop trigger if exists rcia_estado_dictamen on public.reviews;
drop trigger if exists rcia_estado_antecedente on public.editorial_antecedents;
drop trigger if exists rcia_estado_preparacion on public.manuscripts;
drop trigger if exists aa_rcia_bloquear_manuscrito_dictamen on public.reviews;
drop trigger if exists aa_rcia_bloquear_manuscrito_invitacion on public.review_assignments;
commit;
```

El historial y el umbral se conservan. El bloqueo de permisos del umbral puede mantenerse.
