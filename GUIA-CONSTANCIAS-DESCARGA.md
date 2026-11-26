# Constancias de revisión: prueba de descarga

En esta etapa se cargan PDF ya preparados. El portal no genera automáticamente el documento ni envía avisos. Cada constancia corresponde a una asignación y a la primera ronda. No reutilizarla para una segunda ronda: esa función requiere una ampliación posterior.

## Activar

1. Ejecutar completo `schema_constancias_descarga.sql` en SQL Editor de Supabase. Requiere las fases 7 y 8 existentes. Se puede repetir y no elimina datos.
2. Recargar el portal con Ctrl+F5. No es necesario modificar ni desplegar la función de correo.
3. Entrar como editor en jefe. Dentro de un manuscrito con dictamen entregado aparece **Constancias para descargar**. Incluye dictámenes del formulario y antecedentes externos incorporados al expediente.

## Prueba con una constancia

1. En RCIA-007-2026, localizar a Cintya Valerio Cárdenas.
2. Abrir **Cargar constancia PDF**, seleccionar el PDF de esa persona y ese manuscrito y pulsar **Guardar borrador privado**. Todavía no lo puede descargar la revisora.
3. Pulsar **Revisar y validar constancia**, abrir la vista previa y comprobar nombre, manuscrito, fecha, ronda y firma.
4. Marcar la confirmación, escribir la contraseña de la cuenta de editor en jefe y pulsar **Validar y publicar constancia**.
5. Comprobar que aparezca **Disponible para el revisor**. La fecha de validación del portal es independiente de la fecha de emisión impresa en el PDF.
6. Enviar manualmente el aviso. Al entrar con su cuenta, la revisora verá **Mis constancias de revisión**, con el folio y **Descargar constancia PDF**.
7. Repetir con las demás constancias después de comprobar esta primera descarga. Las constancias 007 y 010 de Cintya son independientes y ambas fueron confirmadas por la coordinación editorial.

Una constancia validada no se puede sustituir ni eliminar desde el portal. Si el PDF es incorrecto, no validarlo; se puede sustituir el borrador antes de publicar. Si se corta la conexión, recargar y revisar su estado antes de repetir: publicar de nuevo el mismo borrador no duplica la constancia.

## Aviso de correo sugerido

**Asunto:** Constancia de revisión disponible — [FOLIO]

Estimada/o [NOMBRE]:

Le agradecemos su colaboración en la evaluación del manuscrito [FOLIO]. Su constancia ya está disponible en el portal de gestión editorial: https://revista-fiq.github.io/gestion-rcia/

Ingrese con su cuenta habitual y seleccione **Mis constancias de revisión → Descargar constancia PDF**. Si tiene alguna dificultad, por favor comuníquenoslo.

Saludos cordiales,
Luis Antonio Chel Guerrero
Editor en jefe · RCIA-UADY

No enviar contraseñas en este aviso. El control anterior **Marcar constancia enviada** se sustituye por el seguimiento descrito a continuación. Los registros anteriores se conservan en **Historial de constancias enviadas como PDF**.

## Seguimiento de publicación, aviso y descarga

Ejecutar `schema_constancias_seguimiento.sql` después del script de descarga y recargar con Ctrl+F5. El script incorpora los siete avisos enviados por Outlook el 25/11/2026 para las constancias publicadas de la tanda 006, 007, 009 y 010. Devuelve la relación de registros para comprobarla; no envía mensajes nuevos ni crea descargas ficticias.

- **Pendiente de validación:** falta cargar o validar el documento.
- **Disponible para el revisor:** el editor en jefe publicó la constancia.
- **Aviso enviado:** consta la fecha del correo de disponibilidad. Para futuros avisos manuales, usar **Registrar aviso enviado** después de enviarlos; ese botón no envía correo.
- **Descarga registrada:** el portal recibió el PDF y comenzó la descarga en el navegador del revisor. No confirma que lo haya guardado o leído. Las vistas previas y descargas de los editores no cuentan como descarga del revisor.

Los estados se muestran por separado: una descarga no demuestra que se haya enviado un correo, ni el envío del correo demuestra una descarga. El registro empieza al activar este cambio; las descargas anteriores son desconocidas. Si falla el registro, el PDF sigue descargándose y se informa al revisor de la falta de registro.

## Alcance y controles

- Bucket privado `constancias-revision`, PDF hasta 10 MB. Descarga autenticada, sin URLs públicas ni claves de servicio en el navegador.
- Solo el editor en jefe activo y sin conflicto prepara y valida; la interfaz vuelve a comprobar su contraseña. La autorización del servidor se basa en el rol y el conflicto, no en la casilla del navegador.
- Solo el revisor destinatario activo, el jefe autorizado y el editor asociado asignado pueden leer una constancia publicada. Los autores y otros revisores no tienen acceso.
- Se registra quién carga y valida, fechas, destinatario, folio, título y huella del archivo. La firma es una imagen autorizada; no es una firma criptográfica.
- Un PDF ya descargado no se puede retirar del equipo del destinatario. No se publica la imagen de firma aislada ni el membrete en el repositorio.
- No modifica dictámenes, invitaciones ni estados editoriales, ni envía correo automático. El seguimiento de descarga es un evento del portal, no un acuse firmado del destinatario.

Referencia técnica: https://supabase.com/docs/guides/storage/serving/downloads
