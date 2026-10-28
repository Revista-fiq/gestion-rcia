# Acuse al revisor con copia al editor de área

## Qué cambia

Cada nueva entrega válida de un dictamen genera un acuse al revisor con folio, título, fecha e identificador. El editor de área vigente recibe una copia CC si está activo, autorizado para el área y sin exclusión por conflicto. No incluye comentarios, puntuaciones, archivos ni nombres de autores. No genera constancias y no introduce rondas nuevas.

El editor responsable conserva su aviso habitual. El aviso independiente de recepción al editor de área se sustituye por la copia del acuse, para no enviarle dos mensajes por la misma entrega. Los demás correos usan la función de contexto anterior, que se conserva sin modificar sus reglas.

Si el editor de área no es elegible para la copia, el revisor recibe el acuse sin CC. Si el acuse tiene un fallo definitivo, se conserva o se encola un aviso editorial de respaldo para el área, sin volver a enviar el acuse. Un resultado incierto no se reintenta automáticamente porque Graph podría haber aceptado ya el mensaje.

## Orden de instalación

1. Guarda una copia del código actual de la función Edge que envía los correos.
2. En esa MISMA función existente, sustituye todo index.ts por el contenido de `supabase/functions/cia-mail-worker/index.ts` de este repositorio y despliega. El enlace compartido identifica la función como `cia-mail-worker`, aunque el comentario del código anterior decía `rcia-mail-worker`: conserva el nombre que aparece en tu panel y su endpoint actual. No crees otra función y no cambies `hyper-action`.
3. Conserva los Secrets, la programación, el remitente institucional y las opciones de autenticación actuales. Este código sigue usando Microsoft Graph y `x-rcia-worker-secret`; no necesita otra contraseña ni otro proveedor.
4. Después del despliegue del worker, ejecuta completo `schema_fase14_acuse_revisor.sql` en el SQL Editor de Supabase. La migración es transaccional y repetible; no reinstales las fases anteriores. Conserva el contexto anterior como función privada `rcia_email_context_before_fase14` y mantiene los eventos de la cola existentes.
5. Comprueba un dictamen NUEVO de prueba con cuentas distintas. El revisor debe recibir el acuse, el área aparecer como CC y el editor responsable recibir su aviso habitual. El área no debe recibir además otro aviso independiente por esa misma entrega. Comprueba Enviados en el buzón institucional y la recepción en ambos buzones, incluido correo no deseado.
6. Verifica que el dictamen esté guardado y que los avisos de asignación, respuesta y decisión sigan funcionando. El cambio no requiere volver a subir el HTML del sitio público ni modificar los roles.

El worker nuevo es compatible con la base anterior a fase 14: primero debe desplegarse y después ejecutarse el SQL. Publicar estos archivos en GitHub no despliega la función Edge ni aplica el SQL.

## Comprobación de la cola (solo lectura)

```sql
select q.id, m.folio, q.event_type, q.recipient_role, q.status,
       q.event_key
from public.rcia_mail_queue q
join public.manuscripts m on m.id=q.manuscript_id
where q.event_type='review_receipt'
order by m.folio, q.id;
```

`accepted` significa que Microsoft Graph aceptó la solicitud, no que confirmó su entrega final. No cambies una fila `uncertain` a pendiente sin revisar el resultado en Enviados. Un mensaje suprimido por un perfil inactivo o por conflicto no demuestra que se haya perdido el dictamen.

La instalación no envía acuses retroactivos. Para un dictamen anterior hay que identificarlo y autorizar su envío puntual; no se deben volver a insertar dictámenes para provocar correos.

## Validación y límites

`npm test` incluye pruebas sin envíos reales. Se comprueban CC real en el cuerpo de Graph, filtro de destinatarios en modo de prueba, autenticación del worker, límites de reintento, privacidad, perfiles inactivos, exclusiones, instalación repetible, contexto original de fase 11, acuse único y respaldo editorial por fallo en los dos órdenes posibles de procesamiento.

Las pruebas locales representan el contrato de la cola y usan la función `rcia_enqueue_mail` proporcionada y el contexto de fase 11. No sustituyen la prueba con la versión viva de la fase 9, `rcia_claim_email` y `rcia_finish_email`, ni confirman el despliegue o la recepción en producción.

Para detener solo los nuevos acuses puede retirarse el trigger `rcia_acuse_revision` de `public.reviews`. No borres la función de contexto anterior ni reviertas el worker mientras haya eventos `review_receipt` pendientes o en proceso. Mantener el worker actualizado es compatible con detener la generación de acuses nuevos.

Referencia Graph: https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
