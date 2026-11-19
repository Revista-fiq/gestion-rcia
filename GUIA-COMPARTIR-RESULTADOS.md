# Compartir resultados con el autor

## Activación
1. En Supabase → SQL Editor, abrir una consulta nueva.
2. Pegar TODO el contenido de schema_resultados_autor.sql y ejecutarlo.
3. Recargar el panel de la revista. No es necesario volver a desplegar cia-mail-worker ni cambiar secretos.
El script requiere las fases de conflictos, antecedentes y correo ya instaladas. No envía dictámenes históricos al ejecutarse. Puede ejecutarse de nuevo sin duplicar registros.

## Uso por el editor responsable y el editor de área asignado
En la tarjeta del manuscrito, debajo de Evaluaciones, abrir «Preparar / compartir resultados».
El borrador incluye recomendaciones y observaciones para el autor de los formularios entregados.
No incorpora los campos privados al editor, datos de identidad, disponibilidad del revisor ni archivos adjuntos.
Revisar el texto: los nombres, firmas o alusiones personales escritos dentro de las observaciones deben retirarse manualmente.
Para dictámenes recibidos como PDF o Word, consultar el documento previo en el expediente y copiar aquí solamente las observaciones anonimizadas. Esta función no comparte ni anonimiza archivos Word/PDF.
Marcar la confirmación de anonimato y compartir. Se conserva la copia enviada, su fecha y el editor que la compartió. Una nueva comunicación conserva las anteriores.
El autor verá las comunicaciones en su panel. El aviso usa el correo automático existente y enlaza al portal; no incluye el dictamen en el correo.
Si el correo está deshabilitado o no se pudo generar un aviso, la aplicación lo indica. Compartido en el portal no significa correo entregado.
Cambiar a «En corrección», «Aceptado» u otro estado sigue siendo una decisión independiente.
No usar el cambio de estado solo para provocar otro correo.

## Alcance y comprobación
El editor de área debe ser el asignado al manuscrito. Se respetan los bloqueos por conflicto de interés y los perfiles inactivos.
Los autores no obtienen acceso a las filas privadas de evaluación.
Los reintentos con la misma solicitud o con el mismo último texto no generan una segunda copia ni otro aviso.
Pruebas locales: permisos de ambos roles, acceso del autor, rechazo de cuentas ajenas/inactivas/excluidas, anonimato de campos, texto sin HTML ejecutable, instalación repetida y compatibilidad con el aviso existente.
La base de datos de producción se activa únicamente al ejecutar el SQL anterior. Verificar posteriormente con un manuscrito de prueba, sin compartir observaciones de un envío real por accidente.
