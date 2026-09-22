// =====================================================================
// Envío de manuscritos
// Sube archivos a Storage antes de crear el registro en `manuscripts`.
// =====================================================================

// Rellena el <select> de área temática con la lista oficial + "Otra"
const selectArea = document.getElementById('area');
const inputAreaOtra = document.getElementById('area_otra');
if (selectArea) {
  AREAS_TEMATICAS.forEach((area) => {
    const opt = document.createElement('option');
    opt.value = area;
    opt.textContent = area;
    // inserta antes de la opción "Otra", que ya está en el HTML como última
    selectArea.insertBefore(opt, selectArea.lastElementChild);
  });

  selectArea.addEventListener('change', () => {
    const esOtra = selectArea.value === '__otra__';
    inputAreaOtra.classList.toggle('oculto', !esOtra);
    if (!esOtra) inputAreaOtra.value = '';
  });
}

async function subirArchivo(bucket, userId, file) {
  if (!file) return null;
  const ruta = `${userId}/${Date.now()}_${sanitizarNombreArchivo(file.name)}`;
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
  const coautoresTexto = document.getElementById('coautores').value.trim();

  // Área temática: si eligió "Otra", usa el texto libre; si no, el valor del select
  const areaSeleccionada = selectArea.value;
  const area = areaSeleccionada === '__otra__' ? inputAreaOtra.value.trim() : areaSeleccionada;

  const archivoManuscrito = document.getElementById('archivo_manuscrito').files[0];
  const archivoCarta = document.getElementById('archivo_carta').files[0];
  const archivoConflictos = document.getElementById('archivo_conflictos').files[0];
  const archivoSuplementario = document.getElementById('archivo_suplementario').files[0];

  if (!titulo || !titulo_en || !resumen || !area || !archivoManuscrito || !archivoCarta || !archivoConflictos) {
    mostrarAviso(aviso, 'Completa todos los campos obligatorios (*), incluyendo el área temática.', 'error');
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

    const { data: nuevoManuscrito, error } = await db.from('manuscripts').insert({
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
    }).select().single();

    if (error) throw new Error(error.message);

    // Registra la versión 1 del manuscrito (el envío original) en el
    // historial de versiones, para que quede junto a las correcciones futuras.
    await db.from('manuscript_versions').insert({
      manuscript_id: nuevoManuscrito.id,
      numero_version: 1,
      archivo_url: urlManuscrito,
      subido_por: session.user.id,
      notas: 'Envío original.'
    });

    mostrarAviso(aviso, 'Manuscrito enviado. Recibirás tu folio y acuse por correo en un máximo de 5 días hábiles.', 'ok');
    setTimeout(() => window.location.href = 'dashboard.html', 2000);

  } catch (err) {
    mostrarAviso(aviso, err.message, 'error');
    boton.disabled = false;
    boton.textContent = 'Enviar manuscrito';
  }
});
