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

No enviar contraseñas en este aviso. El control anterior **Marcar constancia enviada** sigue disponible para los PDF enviados manualmente; publicar para descarga no lo marca automáticamente. No equivale a comprobar que el revisor haya descargado el documento.

## Alcance y controles

- Bucket privado `constancias-revision`, PDF hasta 10 MB. Descarga autenticada, sin URLs públicas ni claves de servicio en el navegador.
- Solo el editor en jefe activo y sin conflicto prepara y valida; la interfaz vuelve a comprobar su contraseña. La autorización del servidor se basa en el rol y el conflicto, no en la casilla del navegador.
- Solo el revisor destinatario activo, el jefe autorizado y el editor asociado asignado pueden leer una constancia publicada. Los autores y otros revisores no tienen acceso.
- Se registra quién carga y valida, fechas, destinatario, folio, título y huella del archivo. La firma es una imagen autorizada; no es una firma criptográfica.
- Un PDF ya descargado no se puede retirar del equipo del destinatario. No se publica la imagen de firma aislada ni el membrete en el repositorio.
- No modifica dictámenes, invitaciones, estados editoriales ni envía correo automático. No registra todavía un acuse de descarga.

Referencia técnica: https://supabase.com/docs/guides/storage/serving/downloads
