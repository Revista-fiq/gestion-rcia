# Cierre editorial de asignaciones

El editor en jefe o el editor de área asignado pueden cerrar una asignación pendiente o aceptada que no tenga dictamen. Se conserva quién tomó la decisión, cuándo, el estado anterior, motivo, observaciones y la asignación sustituta cuando corresponda. No modifica la cuenta del revisor ni registra una declinación en su nombre.

## Activación

1. Ejecutar `schema_cierre_asignaciones_1_estado.sql` por separado en Supabase y esperar a que termine correctamente.
2. Ejecutar `schema_cierre_asignaciones_2_funciones.sql` completo en una consulta nueva. Requiere las fases 7, 8, 9, 11, 12 y 13 previamente instaladas. No reinstalar esas fases.
3. Recargar el portal con Ctrl+F5.

Los pasos se separan porque PostgreSQL exige confirmar un nuevo valor de enumeración antes de usarlo: https://www.postgresql.org/docs/17/sql-altertype.html

La instalación no cierra ninguna asignación existente. Se puede repetir sin duplicar cierres ni modificar sus auditorías. No hace falta desplegar el worker de correo.

## Uso

1. Abrir el manuscrito y localizar al revisor en **Revisores asignados**.
2. Pulsar **Cerrar asignación**.
3. Elegir **Sustitución de revisor**, **Falta de respuesta** o **Retiro por decisión editorial**.
4. Para una sustitución, seleccionar al revisor que ya está asignado al mismo manuscrito. Si no está asignado, cancelar, asignarlo primero y después cerrar la asignación anterior.
5. Escribir observaciones, marcar la confirmación y pulsar **Confirmar cierre**.

El estado pasa a **Asignación cerrada por el equipo editorial**, con el motivo y la nota visibles para el equipo editorial autorizado. En una sustitución, se muestra **Asignación cerrada por sustitución**. El revisor únicamente ve que la asignación está cerrada; no ve observaciones internas ni nombres de otros revisores.

## Caso pendiente del RCIA-010-2026

Cerrar la asignación de **María José Rivas Arreola** con motivo **Sustitución de revisor** y seleccionar como sustituta a **Cintya Valerio Cárdenas**, que ya entregó su evaluación.

Observación propuesta:

> La revisora no pudo acceder al sistema y fue sustituida por Cintya Valerio Cárdenas. Sustitución confirmada por la coordinación editorial.

Las evaluaciones de Judith Zavala Arcos y Cintya Valerio Cárdenas se conservan. No se renumeran los revisores para no alterar las referencias de dictámenes anteriores.

## Efectos

- La asignación cerrada deja de contar como pendiente, pero no cuenta como dictamen recibido.
- Si están recibidos los dictámenes requeridos, no queda otra invitación pendiente y se cumplen las condiciones de la fase 13 (editor de área y archivo anonimizado), el manuscrito puede pasar a **Dictamen emitido**. Esto no acepta ni rechaza automáticamente el artículo.
- No se pueden cerrar asignaciones entregadas, con dictamen previo incorporado, ya declinadas ni expedientes con decisión final.
- Se impiden nuevas respuestas, dictámenes y reenvíos de invitación para la asignación cerrada. Se retiran las invitaciones pendientes de la cola de correo sin borrar el historial. Un mensaje que el transporte ya hubiese enviado no puede retirarse.
- El acceso al manuscrito anonimizado se retira para esa asignación. Un enlace temporal ya emitido puede durar hasta 60 segundos y un archivo ya descargado no puede retirarse.
- El cierre no envía un nuevo correo de sustitución ni fabrica una respuesta de la revisora. Cualquier comunicación sobre el cambio se decide por separado.
- No hay botón para reabrir: el historial del cierre queda protegido. Si hubo un error, debe revisarse antes de hacer una corrección administrativa.
