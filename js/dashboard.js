// =====================================================================
// Panel principal — enruta el contenido según profiles.role
// =====================================================================

const ETIQUETAS_ESTADO = {
  recibido: 'Recibido',
  acuse_enviado: 'Acuse enviado',
  en_revision: 'En revisión',
  dictamen_emitido: 'Dictamen emitido',
  en_correccion: 'En corrección',
  aceptado: 'Aceptado',
  publicado: 'Publicado',
  rechazado: 'Rechazado',
  desistido: 'Desistido'
};

function chipEstado(estado) {
  return `<span class="estado estado-${estado}">${ETIQUETAS_ESTADO[estado] || estado}</span>`;
}

function formatoFecha(fechaISO) {
  return new Date(fechaISO).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function iniciarPanel() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  const { data: perfil, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !perfil) {
    mostrarAvisoGeneral('No se encontró tu perfil. Contacta a la revista.', 'error');
    return;
  }

  document.getElementById('nombre-usuario').textContent = perfil.nombre_completo;

  if (perfil.role === 'autor') {
    document.getElementById('titulo-panel').textContent = 'Mis manuscritos';
    document.getElementById('subtitulo-panel').textContent = 'Seguimiento del estado de tus envíos a RCIA-UADY.';
    document.getElementById('vista-autor').classList.remove('oculto');
    cargarVistaAutor(session.user.id);
  } else if (perfil.role === 'revisor') {
    document.getElementById('titulo-panel').textContent = 'Panel de revisor';
    document.getElementById('subtitulo-panel').textContent = 'Manuscritos que tienes asignados para dictamen.';
    document.getElementById('vista-revisor').classList.remove('oculto');
    cargarVistaRevisor(session.user.id);
  } else if (perfil.role === 'editor') {
    document.getElementById('titulo-panel').textContent = 'Panel editorial';
    document.getElementById('subtitulo-panel').textContent = 'Recepción, asignación y seguimiento de todos los manuscritos.';
    document.getElementById('vista-editor').classList.remove('oculto');
    cargarVistaEditor();
  }
}

function mostrarAvisoGeneral(msg, tipo) {
  document.querySelector('.contenedor').insertAdjacentHTML(
    'afterbegin', `<div class="aviso aviso-${tipo}">${msg}</div>`
  );
}

// ---------------------------------------------------------------------
// VISTA AUTOR
// ---------------------------------------------------------------------
async function cargarVistaAutor(userId) {
  const cont = document.getElementById('lista-manuscritos-autor');

  const { data: manuscritos, error } = await db
    .from('manuscripts')
    .select('*')
    .eq('autor_correspondencia_id', userId)
    .order('created_at', { ascending: false });

  if (error) { cont.innerHTML = `<div class="aviso aviso-error">Error al cargar: ${error.message}</div>`; return; }
  if (!manuscritos.length) { cont.innerHTML = '<p class="vacio">Aún no has enviado ningún manuscrito.</p>'; return; }

  cont.innerHTML = '';
  for (const m of manuscritos) {
    const { data: bitacora } = await db
      .from('status_log')
      .select('*')
      .eq('manuscript_id', m.id)
      .order('fecha', { ascending: true });

    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta">
        <div class="tarjeta-cabecera">
          <div>
            <div class="folio">${m.folio}</div>
            <div class="titulo-manuscrito">${m.titulo}</div>
          </div>
          ${chipEstado(m.estado)}
        </div>
        <div class="bitacora">
          ${bitacora.map(b => `
            <div class="bitacora-item">
              <div>${ETIQUETAS_ESTADO[b.estado_nuevo] || b.estado_nuevo}</div>
              <div class="bitacora-fecha">${formatoFecha(b.fecha)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `);
  }
}

// ---------------------------------------------------------------------
// VISTA REVISOR (usa la vista ciega — sin datos de autor)
// ---------------------------------------------------------------------
async function cargarVistaRevisor(userId) {
  const cont = document.getElementById('lista-manuscritos-revisor');

  const { data: asignaciones, error } = await db
    .from('review_assignments')
    .select('*, manuscripts_blind(*)')
    .eq('reviewer_id', userId)
    .order('fecha_asignacion', { ascending: false });

  if (error) { cont.innerHTML = `<div class="aviso aviso-error">Error al cargar: ${error.message}</div>`; return; }
  if (!asignaciones.length) { cont.innerHTML = '<p class="vacio">No tienes manuscritos asignados por el momento.</p>'; return; }

  cont.innerHTML = '';
  for (const a of asignaciones) {
    const m = a.manuscripts_blind;
    if (!m) continue;

    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta">
        <div class="tarjeta-cabecera">
          <div>
            <div class="folio">${m.folio}</div>
            <div class="titulo-manuscrito">${m.titulo}</div>
          </div>
          <span class="estado estado-${a.estado === 'entregada' ? 'aceptado' : 'en_revision'}">
            ${a.estado === 'entregada' ? 'Dictamen entregado' : 'Pendiente de dictamen'}
          </span>
        </div>
        <p style="font-size:13px; color:var(--gris-texto);">${m.resumen || ''}</p>
        <a href="${m.archivo_manuscrito_url}" target="_blank" class="boton secundario"
           style="text-decoration:none; display:inline-block;">Ver manuscrito</a>
        ${a.estado !== 'entregada' ? `
          <button class="secundario" onclick="abrirFormularioDictamen('${a.id}')">Capturar dictamen</button>
        ` : ''}
      </div>
    `);
  }
}

async function abrirFormularioDictamen(assignmentId) {
  const decision = prompt('Dictamen: escribe una opción — aceptar / revision_menor / revision_mayor / rechazar');
  if (!decision) return;
  const comentarios = prompt('Comentarios para el autor:');

  const { error } = await db.from('reviews').insert({
    assignment_id: assignmentId,
    decision,
    comentarios_autor: comentarios
  });

  if (error) { alert('Error al guardar el dictamen: ' + error.message); return; }

  await db.from('review_assignments').update({ estado: 'entregada' }).eq('id', assignmentId);
  location.reload();
}

// ---------------------------------------------------------------------
// VISTA EDITOR
// ---------------------------------------------------------------------
async function cargarVistaEditor() {
  const cont = document.getElementById('lista-manuscritos-editor');

  const { data: manuscritos, error } = await db
    .from('manuscripts')
    .select('*, profiles!manuscripts_autor_correspondencia_id_fkey(nombre_completo)')
    .order('created_at', { ascending: false });

  if (error) { cont.innerHTML = `<div class="aviso aviso-error">Error al cargar: ${error.message}</div>`; return; }
  if (!manuscritos.length) { cont.innerHTML = '<p class="vacio">Aún no se han recibido manuscritos.</p>'; return; }

  const { data: revisores } = await db.from('profiles').select('*').eq('role', 'revisor');

  cont.innerHTML = '';
  for (const m of manuscritos) {
    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta">
        <div class="tarjeta-cabecera">
          <div>
            <div class="folio">${m.folio} · ${m.profiles?.nombre_completo || 'Autor'}</div>
            <div class="titulo-manuscrito">${m.titulo}</div>
          </div>
          ${chipEstado(m.estado)}
        </div>

        <label>Cambiar estado</label>
        <select onchange="cambiarEstado('${m.id}', this.value)">
          ${Object.keys(ETIQUETAS_ESTADO).map(e =>
            `<option value="${e}" ${e === m.estado ? 'selected' : ''}>${ETIQUETAS_ESTADO[e]}</option>`
          ).join('')}
        </select>

        <label>Asignar revisor</label>
        <div style="display:flex; gap:8px;">
          <select id="sel-revisor-${m.id}" style="flex:1;">
            ${revisores?.map(r => `<option value="${r.id}">${r.nombre_completo}</option>`).join('') || '<option disabled>Sin revisores registrados</option>'}
          </select>
          <button class="secundario" style="margin-top:0;" onclick="asignarRevisor('${m.id}')">Asignar</button>
        </div>
      </div>
    `);
  }
}

async function cambiarEstado(manuscriptId, nuevoEstado) {
  const { error } = await db.from('manuscripts').update({ estado: nuevoEstado }).eq('id', manuscriptId);
  if (error) alert('Error al actualizar: ' + error.message);
}

async function asignarRevisor(manuscriptId) {
  const reviewerId = document.getElementById(`sel-revisor-${manuscriptId}`).value;
  if (!reviewerId) return;

  const { error } = await db.from('review_assignments').insert({
    manuscript_id: manuscriptId,
    reviewer_id: reviewerId
  });

  if (error) { alert('Error al asignar: ' + error.message); return; }
  alert('Revisor asignado.');
}

iniciarPanel();
