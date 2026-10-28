# Avisos por correo de RCIA-UADY

Actualización: 14 de octubre de 2026. Complemento de las guías anteriores; sustituye sus instrucciones de enviar manualmente los avisos indicados aquí.

| Acción en el portal | Quién recibe el aviso automático |
| --- | --- |
| Registrar un manuscrito | Autor: acuse. Editor responsable: aviso de nuevo envío. |
| Asignar editor de área | Editor de área asignado. |
| Asignar revisor | Revisor asignado. |
| Entregar un dictamen | Editor responsable y editor de área asignado. |
| Cambiar a En corrección | Autor. |
| Cambiar a aceptado, rechazado, publicado o desistido | Autor. |

Los primeros cinco recorridos fueron comprobados con el manuscrito de prueba RCIA-014-2026. Los demás cambios de estado están contemplados en la configuración y no fueron probados en esa sesión.

## Cómo proceder

Realiza la acción una sola vez y comprueba su resultado en el panel. El sistema procesa los avisos cada minuto; la recepción puede tardar unos minutos más. No hace falta enviar otro mensaje manual para anunciar la misma acción.

Si el correo no llega, revisa la carpeta de correo no deseado y avisa al editor responsable indicando el folio y la acción realizada. No vuelvas a subir el manuscrito, entregar el dictamen o cambiar repetidamente el estado para provocar otro correo.

## Comunicación que sigue a cargo del equipo

- Acordar plazos e instrucciones particulares y enviar recordatorios.
- Comunicar al autor las observaciones detalladas que corresponda, preservando el anonimato del revisor y los comentarios confidenciales.
- Preparar y enviar la carta de aceptación firmada cuando corresponda. El aviso de estado no la sustituye.

Los correos automáticos incluyen información del evento y el enlace al portal; no adjuntan manuscritos ni dictámenes. Los movimientos anteriores a la activación no generan avisos retroactivos.

## Acceso al portal

El envío editorial automático es independiente de los correos de registro, invitación y recuperación de contraseña. La integración de esos correos sigue pendiente. Se conserva el procedimiento de acceso vigente; no se cambia la contraseña de las cuentas existentes.

## Estados de seguimiento (fase 13)

La fase 13 debe instalarse en Supabase según ACTIVAR-ESTADOS.md. Tras instalarla, la primera aceptación válida inicia «En revisión» cuando hay editor de área y manuscrito anonimizado. Al completarse los dictámenes requeridos y quedar resueltas las invitaciones adicionales, pasa a «Dictamen emitido». Se requieren dos por defecto, ajustables por el editor en cada expediente.

Esas transiciones se registran en la bitácora y no son decisiones de aceptación o rechazo. No agregan otro correo a los avisos de respuesta y dictamen ya existentes. Correcciones, aceptación, rechazo, publicación y desistimiento conservan su decisión editorial manual y sus avisos configurados. La instalación no actualiza retrospectivamente todos los expedientes.


## Acuse de recepción al revisor (fase 14)

Una vez desplegado el worker actualizado y aplicada la fase 14, cada nuevo dictamen válido genera un acuse al revisor, con copia CC al editor de área activo y autorizado. La copia sustituye el aviso independiente de recepción al área; el editor responsable conserva su aviso habitual. Si el acuse falla definitivamente, el sistema conserva o genera el aviso editorial del área como respaldo. No reintenta resultados inciertos ni genera constancias.

El acuse confirma el registro del dictamen, no la aceptación del artículo. Incluye folio, fecha e identificador, sin comentarios ni archivos. La instalación no envía acuses de evaluaciones anteriores. Consultar ACTIVAR-ACUSE-REVISOR.md: publicar los archivos en GitHub no activa la función Edge ni la migración.

