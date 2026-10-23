# Reenviar invitaciones pendientes

1. Confirma que las fases 4, 7, 9 y 11 están instaladas. Conserva la versión actual del worker de correo.
2. Ejecuta completo `schema_fase12_reenviar_invitacion.sql` en el SQL Editor de Supabase. No ejecutes de nuevo el esquema inicial ni las fases anteriores.
3. Integra esta propuesta y espera la publicación en GitHub Pages. Recarga el panel editorial sin caché.
4. En «Revisores asignados», junto a una asignación pendiente, pulsa «Reenviar invitación». La confirmación del registro muestra el correo vigente de `profiles.email`.
5. Comprueba en la cola y en el proveedor de correo el evento `review_assignment` con clave `resend:<UUID>`. Confirma la recepción con una cuenta de prueba. El registro de la solicitud no prueba la entrega del correo.

El reenvío conserva el manuscrito, la asignación, los plazos y el acceso. Solo está disponible mientras la invitación esté pendiente y el proceso editorial siga abierto. No crea cuentas ni correos de acceso de Supabase Auth. Si el correo fue corregido, comprueba también Authentication → Users.

Solo pueden solicitarlo editores activos autorizados para el manuscrito y sin exclusión por conflicto. Se verifica que el revisor siga activo y sin exclusión. Se registra quién lo solicitó y cuándo. Hay un intervalo mínimo de cinco minutos entre solicitudes por asignación; los reintentos con la misma clave no crean otra notificación.

Se reutiliza la firma de `rcia_enqueue_mail` y el evento documentados en la fase 11. El destinatario se obtiene del perfil al procesar el correo mediante `rcia_email_context`; no se conserva el correo incorrecto. La implementación real de fase 9 y el worker no están versionados en este repositorio: las pruebas locales usan un contrato mínimo de la cola y no acreditan su integración en producción.

Validación local: `npm install` y `npm test`. Falta comprobar el SQL y el worker reales, los permisos y el envío con cuentas de prueba. Para retirar la interfaz puede revertirse el commit web sin borrar las solicitudes históricas.
