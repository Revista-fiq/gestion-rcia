// =====================================================================
// Envío de manuscritos
// Sube archivos a Storage antes de crear el registro en `manuscripts`.
// Requiere que los buckets de BUCKETS (ver supabase-client.js) existan.
// =====================================================================

async function subirArchivo(bucket, userId, file) {
  if (!file) return null;
  const ruta = `${userId}/${Date.now()}_${file.name}`;
  const { error } = await db.storage.from(bucket).upload(ruta, file);
  if (error) throw new Error(`Error al subir ${file.name}: ${error.message}`);
  const { data } = db.storage.from(bucket).getPublicUrl(ruta);
  return data.publicUrl;
}

document.getElementById('btn-enviar')?.addEventListener('click', async () => {
  const boton = document.getElementById('btn-enviar');
  const aviso = 'aviso-envio';

  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  const titulo = document.getElementById('titulo').value.trim();
  const titulo_en = document.getElementById('titulo_en').value.trim();
  const resumen = document.getElementById('resumen').value.trim();
  const tipo = document.getElementById('tipo').value;
  const area = document.getElementById('area').value.trim();
  const coautoresTexto = document.getElementById('coautores').value.trim();

  const archivoManuscrito = document.getElementById('archivo_manuscrito').files[0];
  const archivoCarta = document.getElementById('archivo_carta').files[0];
  const archivoConflictos = document.getElementById('archivo_conflictos').files[0];
  const archivoSuplementario = document.getElementById('archivo_suplementario').files[0];

  if (!titulo || !titulo_en || !resumen || !area || !archivoManuscrito || !archivoCarta || !archivoConflictos) {
    mostrarAviso(aviso, 'Completa todos los campos obligatorios (*).', 'error');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Enviando…';

  try {
    const coautores = coautoresTexto
      ? coautoresTexto.split('\n').filter(Boolean).map(linea => {
          const [nombre, orcid, institucion] = linea.split(',').map(s => s?.trim());
          return { nombre, orcid, institucion };
        })
      : [];

    const [urlManuscrito, urlCarta, urlConflictos, urlSuplementario] = await Promise.all([
      subirArchivo(BUCKETS.manuscritos, session.user.id, archivoManuscrito),
      subirArchivo(BUCKETS.cartas, session.user.id, archivoCarta),
      subirArchivo(BUCKETS.conflictos, session.user.id, archivoConflictos),
      subirArchivo(BUCKETS.suplementario, session.user.id, archivoSuplementario)
    ]);

    const { error } = await db.from('manuscripts').insert({
      titulo,
      titulo_en,
      resumen,
      tipo,
      area_tematica: area,
      autor_correspondencia_id: session.user.id,
      coautores,
      archivo_manuscrito_url: urlManuscrito,
      archivo_carta_url: urlCarta,
      archivo_conflictos_url: urlConflictos,
      archivo_material_suplementario_url: urlSuplementario
    });

    if (error) throw new Error(error.message);

    mostrarAviso(aviso, 'Manuscrito enviado. Recibirás tu folio y acuse por correo en un máximo de 5 días hábiles.', 'ok');
    setTimeout(() => window.location.href = 'dashboard.html', 2000);

  } catch (err) {
    mostrarAviso(aviso, err.message, 'error');
    boton.disabled = false;
    boton.textContent = 'Enviar manuscrito';
  }
});
