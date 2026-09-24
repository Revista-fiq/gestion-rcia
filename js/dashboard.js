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

  if (perfil.role === 'editor') {
    document.getElementById('nav-usuarios').classList.remove('oculto');
  }

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

  } else if (perfil.role === 'editor_area') {
    // Reutiliza la misma vista/consulta que el editor en jefe: las políticas
    // de seguridad (RLS) en Supabase ya restringen los resultados solo a
    // las áreas asignadas a este usuario, así que no hace falta duplicar código.
    const areas = (perfil.areas_asignadas || []).join(', ') || 'sin área asignada — contacta al editor en jefe';
    document.getElementById('titulo-panel').textContent = 'Panel editorial de área';
    document.getElementById('subtitulo-panel').textContent = `Área(s) a tu cargo: ${areas}`;
    document.getElementById('titulo-lista-editor').textContent = 'Manuscritos de tu área';
    document.getElementById('vista-editor').classList.remove('oculto');
    cargarVistaEditor();
  }
}

function mostrarAvisoGeneral(msg, tipo) {
  document.querySelector('.contenedor').insertAdjacentHTML(
    'afterbegin', `<div class="aviso aviso-${tipo}">${msg}</div>`
  );
}

// Lista compacta del historial de versiones de un manuscrito (envío
// original + correcciones), usada tanto en la vista de autor como editor.
async function renderVersiones(manuscriptId) {
  const { data: versiones } = await db
    .from('manuscript_versions')
    .select('*')
    .eq('manuscript_id', manuscriptId)
    .order('numero_version', { ascending: true });

  if (!versiones || !versiones.length) return '';

  return `
    <details style="margin-top:10px; font-size:13px;">
      <summary style="cursor:pointer; color:var(--gris-texto);">Historial de versiones (${versiones.length})</summary>
      <div style="margin-top:8px;">
        ${versiones.map(v => `
          <div style="padding:4px 0; border-bottom:1px solid var(--gris-borde);">
            v${v.numero_version} · ${formatoFecha(v.fecha)}
            — <a href="${v.archivo_url}" target="_blank">ver archivo</a>
            ${v.notas ? ` · ${v.notas}` : ''}
          </div>
        `).join('')}
      </div>
    </details>
  `;
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

    const bloqueCorreccion = m.estado === 'en_correccion' ? `
      <div class="confidencial" style="margin-top:14px;">
        <label class="field-label">Subir versión corregida</label>
        <input type="file" id="nueva-version-${m.id}" accept=".doc,.docx">
        <button class="secundario" onclick="subirVersionCorregida('${m.id}')">Subir corrección</button>
      </div>
    ` : '';

    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta">
        <div class="tarjeta-cabecera">
          <div>
            <div class="folio">${m.folio} · ${m.area_tematica}</div>
            <div class="titulo-manuscrito">${escaparHTML(m.titulo)}</div>
          </div>
          ${chipEstado(m.estado)}
        </div>
        <div class="bitacora">
          ${bitacora.map(b => `
            <div class="bitacora-item">
              <div>${ETIQUETAS_ESTADO[b.estado_nuevo] || b.estado_nuevo}</div>
              <div class="bitacora-fecha">${formatoFecha(b.fecha)}</div>
              ${b.notas ? `<div style="font-size:12px; color:var(--gris-texto);">${b.notas}</div>` : ''}
            </div>
          `).join('')}
        </div>
        ${await renderVersiones(m.id)}
        ${bloqueCorreccion}
      </div>
    `);
  }
}

async function subirVersionCorregida(manuscriptId) {
  const input = document.getElementById(`nueva-version-${manuscriptId}`);
  const file = input.files[0];
  if (!file) { alert('Selecciona el archivo corregido (.docx) antes de subir.'); return; }

  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  try {
    const ruta = `${session.user.id}/${manuscriptId}/${Date.now()}_${sanitizarNombreArchivo(file.name)}`;
    const { error: errUpload } = await db.storage.from(BUCKETS.manuscritos).upload(ruta, file);
    if (errUpload) throw new Error(errUpload.message);

    const { data: urlData } = db.storage.from(BUCKETS.manuscritos).getPublicUrl(ruta);

    const { data: versiones } = await db
      .from('manuscript_versions')
      .select('numero_version')
      .eq('manuscript_id', manuscriptId)
      .order('numero_version', { ascending: false })
      .limit(1);
    const siguienteVersion = (versiones && versiones[0] ? versiones[0].numero_version : 1) + 1;

    const { error: errVersion } = await db.from('manuscript_versions').insert({
      manuscript_id: manuscriptId,
      numero_version: siguienteVersion,
      archivo_url: urlData.publicUrl,
      subido_por: session.user.id,
      notas: 'Corrección subida por el autor.'
    });
    if (errVersion) throw new Error(errVersion.message);

    // Actualiza el archivo activo y limpia el anonimizado anterior (ya no
    // corresponde a esta versión — el editor deberá volver a anonimizar
    // antes de reenviar a revisión).
    const { error: errUpdate } = await db.from('manuscripts').update({
      archivo_manuscrito_url: urlData.publicUrl,
      archivo_anonimizado_url: null
    }).eq('id', manuscriptId);
    if (errUpdate) throw new Error(errUpdate.message);

    await db.from('status_log').insert({
      manuscript_id: manuscriptId,
      estado_anterior: 'en_correccion',
      estado_nuevo: 'en_correccion',
      notas: `Versión ${siguienteVersion} subida por el autor con correcciones.`,
      changed_by: session.user.id
    });

    alert('Versión corregida subida correctamente. El editor la revisará para continuar el proceso.');
    cargarVistaAutor(session.user.id);

  } catch (err) {
    alert('Error al subir la corrección: ' + err.message);
  }
}

// ---------------------------------------------------------------------
// VISTA REVISOR (usa la vista ciega — solo entrega el archivo anonimizado)
// ---------------------------------------------------------------------
async function cargarVistaRevisor(userId) {
  const cont = document.getElementById('lista-manuscritos-revisor');

  const { data: asignaciones, error } = await db.rpc('rcia_mis_asignaciones');

  if (error) { cont.innerHTML = `<div class="aviso aviso-error">Error al cargar: ${error.message}</div>`; return; }
  if (!asignaciones.length) { cont.innerHTML = '<p class="vacio">No tienes manuscritos asignados por el momento.</p>'; return; }

  cont.innerHTML = '';
  for (const a of asignaciones) {
    const m = a.manuscripts_blind;
    if (!m) continue;

    // archivo_manuscrito_url aquí YA es el anonimizado (así lo entrega
    // la vista manuscripts_blind desde la Fase 3); si es null, el editor
    // todavía no lo ha preparado.
    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta">
        <div class="tarjeta-cabecera">
          <div>
            <div class="folio">${escaparHTML(m.folio)}</div>
            <div class="titulo-manuscrito">${escaparHTML(m.titulo)}</div>
          </div>
          <span class="estado estado-${a.estado === 'entregada' ? 'aceptado' : 'en_revision'}">
            ${a.estado === 'entregada' ? 'Dictamen entregado' : a.estado === 'declinada' ? 'Asignación declinada' : 'Pendiente de dictamen'}
          </span>
        </div>
        <p style="font-size:13px; color:var(--gris-texto);">${escaparHTML(m.resumen || '')}</p>
        ${m.archivo_manuscrito_url
          ? `<a href="${escaparHTML(m.archivo_manuscrito_url)}" target="_blank" rel="noopener noreferrer" class="boton secundario"
               style="text-decoration:none; display:inline-block;">Ver manuscrito (versión anonimizada)</a>`
          : `<span style="font-size:13px; color:var(--gris-texto);">El editor aún no ha subido la versión anonimizada.</span>`
        }
        ${['pendiente', 'aceptada'].includes(a.estado) && m.archivo_manuscrito_url ? `
          <a href="evaluacion.html?a=${a.id}" class="boton"
             style="text-decoration:none; display:inline-block; margin-left:8px;">Capturar dictamen</a>
        ` : a.estado === 'entregada' ? `
          <span style="font-size:13px; color:var(--gris-texto); margin-left:8px;">Ya enviaste tu evaluación, gracias.</span>
        ` : ''}
      </div>
    `);
  }
}

// ---------------------------------------------------------------------
// VISTA EDITOR / EDITOR DE ÁREA
// (RLS ya limita las filas devueltas al área del editor de área)
// ---------------------------------------------------------------------
async function cargarVistaEditor() {
  const cont = document.getElementById('lista-manuscritos-editor');

  const { data: manuscritos, error } = await db
    .from('manuscripts')
    .select('*, profiles!manuscripts_autor_correspondencia_id_fkey(nombre_completo)')
    .order('created_at', { ascending: false });

  if (error) { cont.innerHTML = `<div class="aviso aviso-error">Error al cargar: ${error.message}</div>`; return; }
  if (!manuscritos.length) { cont.innerHTML = '<p class="vacio">Aún no se han recibido manuscritos.</p>'; return; }

  const { data: revisores } = await db.from('profiles').select('*').eq('role', 'revisor').eq('activo', true);
  const { data: editoresArea } = await db.from('profiles').select('*').eq('role', 'editor_area');

  // Se guardan para armar el correo de aviso al asignar editor de área.
  cacheManuscritos = Object.fromEntries(manuscritos.map(m => [m.id, m]));
  cacheEditoresArea = editoresArea || [];

  cont.innerHTML = '';
  for (const m of manuscritos) {
    // Editores de área cuya área asignada coincide con la de este
    // manuscrito (los demás igual pueden elegirse, pero se marcan aparte).
    const editoresAreaLista = editoresArea || [];
    const editorAreaActual = editoresAreaLista.find(e => e.id === m.editor_area_asignado_id);

    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta">
        <div class="tarjeta-cabecera">
          <div>
            <div class="folio">${m.folio} · ${m.profiles?.nombre_completo || 'Autor'} · ${m.area_tematica}</div>
            <div class="titulo-manuscrito">${escaparHTML(m.titulo)}</div>
          </div>
          ${chipEstado(m.estado)}
        </div>

        <label>Archivo original (con datos de autoría)</label>
        <a href="${escaparHTML(m.archivo_manuscrito_url)}" target="_blank" rel="noopener noreferrer" class="boton secundario"
           style="text-decoration:none; display:inline-block; margin-top:0;">Ver archivo original</a>

        <label>Manuscrito anonimizado (esto es lo único que ve el revisor)</label>
        ${m.archivo_anonimizado_url
          ? `<a href="${m.archivo_anonimizado_url}" target="_blank" class="boton secundario"
               style="text-decoration:none; display:inline-block; margin-top:0;">Ver archivo anonimizado</a>`
          : `<div class="aviso aviso-error" style="margin:6px 0;">Falta subir el archivo anonimizado — el manuscrito no podrá pasar a revisión hasta entonces.</div>`
        }
        <input type="file" id="anon-${m.id}" accept=".doc,.docx,.pdf" style="margin-top:8px;">
        <button class="secundario" onclick="subirAnonimizado('${m.id}')">Subir / reemplazar anonimizado</button>

        <label>Editor de área responsable de anonimizar/dar seguimiento${editorAreaActual ? ` — actual: ${editorAreaActual.nombre_completo}` : ''}</label>
        <div style="display:flex; gap:8px;">
          <select id="sel-editorarea-${m.id}" style="flex:1;">
            <option value="">Sin asignar</option>
            ${editoresAreaLista.map(e => `
              <option value="${e.id}" ${m.editor_area_asignado_id === e.id ? 'selected' : ''}>
                ${e.nombre_completo}${(e.areas_asignadas || []).includes(m.area_tematica) ? '' : ' (otra área)'}
              </option>
            `).join('') || '<option disabled>Sin editores de área registrados</option>'}
          </select>
          <button class="secundario" style="margin-top:0;" onclick="asignarEditorArea('${m.id}')">Asignar</button>
        </div>

        <label>Cambiar estado</label>
        <select onchange="cambiarEstado('${m.id}', this.value, this)">
          ${Object.keys(ETIQUETAS_ESTADO).map(e =>
            `<option value="${e}" ${e === m.estado ? 'selected' : ''}>${ETIQUETAS_ESTADO[e]}</option>`
          ).join('')}
        </select>

        <label>Asignar revisor (opcional)</label>
        <div style="display:flex; gap:8px;">
          <select id="sel-revisor-${m.id}" style="flex:1;">
            <option value="">Sin seleccionar</option>
            ${revisores?.map(r => `<option value="${r.id}">${r.nombre_completo}</option>`).join('') || '<option disabled>Sin revisores registrados</option>'}
          </select>
          <button class="secundario" style="margin-top:0;" onclick="asignarRevisor('${m.id}')">Asignar</button>
        </div>

        ${await renderVersiones(m.id)}
        ${await renderDictamenes(m.id)}
      </div>
    `);
  }
}

async function subirAnonimizado(manuscriptId) {
  const input = document.getElementById(`anon-${manuscriptId}`);
  const file = input.files[0];
  if (!file) { alert('Selecciona el archivo ya anonimizado (sin autores, afiliaciones ni agradecimientos).'); return; }

  try {
    const ruta = `${manuscriptId}/${Date.now()}_manuscrito-anonimo.${file.name.split(".").pop().toLowerCase()}`;
    const { error: errUpload } = await db.storage.from(BUCKETS.manuscritosAnonimizados).upload(ruta, file);
    if (errUpload) throw new Error(errUpload.message);

    const { data: urlData } = db.storage.from(BUCKETS.manuscritosAnonimizados).getPublicUrl(ruta);

    const { error: errUpdate } = await db.from('manuscripts')
      .update({ archivo_anonimizado_url: urlData.publicUrl })
      .eq('id', manuscriptId);
    if (errUpdate) throw new Error(errUpdate.message);

    alert('Archivo anonimizado guardado.');
    cargarVistaEditor();

  } catch (err) {
    alert('Error al subir el archivo anonimizado: ' + err.message);
  }
}

async function cambiarEstado(manuscriptId, nuevoEstado, selectEl) {
  const { error } = await db.from('manuscripts').update({ estado: nuevoEstado }).eq('id', manuscriptId);
  if (error) {
    // El error más probable aquí es el candado de anonimización (Fase 3):
    // el mensaje de la base de datos ya es legible para el editor.
    alert(error.message.includes('anonimizado')
      ? error.message
      : 'Error al actualizar: ' + error.message);
    cargarVistaEditor(); // recarga para que el <select> vuelva a mostrar el estado real
  }
}

async function asignarRevisor(manuscriptId) {
  const reviewerId = document.getElementById(`sel-revisor-${manuscriptId}`).value;
  if (!reviewerId) { alert('Selecciona un revisor de la lista antes de asignar.'); return; }

  const { error } = await db.from('review_assignments').insert({
    manuscript_id: manuscriptId,
    reviewer_id: reviewerId
  });

  if (error) { alert('Error al asignar: ' + error.message); return; }
  alert('Revisor asignado.');
}

// Datos del último listado del panel editor (para armar el correo de aviso)
let cacheManuscritos = {};
let cacheEditoresArea = [];

const URL_SISTEMA = 'https://revista-fiq.github.io/gestion-rcia/';

// Aviso SEMIAUTOMÁTICO: muestra una ventana con el correo ya redactado y
// botones para abrirlo en Outlook web (Microsoft 365 UADY), en la app de
// correo del equipo (mailto) o copiarlo. Son enlaces que el usuario
// presiona directamente, así no dependen de que Windows tenga una app de
// correo predeterminada ni los bloquea el navegador.
// (El envío 100% automático queda para la Fase 4, con Microsoft Graph.)
function abrirCorreoAsignacionEditorArea(manuscrito, editor) {
  const asunto = `RCIA-UADY · Asignación de manuscrito ${manuscrito.folio}`;
  const cuerpo = [
    `Estimado(a) ${editor.nombre_completo}:`,
    '',
    'Se le ha asignado como editor(a) de área responsable del siguiente manuscrito recibido por la Revista de Ciencia e Ingeniería Aplicada de la UADY (RCIA-UADY):',
    '',
    `Folio: ${manuscrito.folio}`,
    `Título: ${manuscrito.titulo}`,
    `Área temática: ${manuscrito.area_tematica}`,
    '',
    'Le solicitamos, por favor:',
    '1. Revisar el manuscrito original y preparar la versión anonimizada (sin autores, afiliaciones, agradecimientos ni metadatos del archivo).',
    '2. Subir el archivo anonimizado en el sistema de gestión editorial.',
    '3. Dar seguimiento al proceso de revisión por pares.',
    '',
    `Puede ingresar al sistema con su cuenta en: ${URL_SISTEMA}`,
    '',
    'Muchas gracias por su apoyo.',
    '',
    'Atentamente,',
    'Editor en jefe — RCIA-UADY'
  ].join('\n');

  const para = encodeURIComponent(editor.email);
  const asuntoUrl = encodeURIComponent(asunto);
  const cuerpoUrl = encodeURIComponent(cuerpo);
  const urlOutlookWeb = `https://outlook.office.com/mail/deeplink/compose?to=${para}&subject=${asuntoUrl}&body=${cuerpoUrl}`;
  const urlMailto = `mailto:${para}?subject=${asuntoUrl}&body=${cuerpoUrl}`;

  document.getElementById('modal-correo')?.remove();
  const fondo = document.createElement('div');
  fondo.id = 'modal-correo';
  fondo.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px;';
  fondo.innerHTML = `
    <div style="background:#fff; border-radius:10px; max-width:640px; width:100%; max-height:90vh; overflow:auto; padding:20px;">
      <h3 style="margin-top:0;">Aviso para ${editor.nombre_completo}</h3>
      <p style="font-size:13px; margin:4px 0;"><strong>Para:</strong> ${editor.email}</p>
      <p style="font-size:13px; margin:4px 0 10px;"><strong>Asunto:</strong> ${asunto}</p>
      <textarea id="modal-correo-texto" readonly
        style="width:100%; height:240px; font-size:13px; box-sizing:border-box;"></textarea>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">
        <a class="boton" href="${urlOutlookWeb}" target="_blank" rel="noopener"
           style="text-decoration:none; display:inline-block; margin-top:0;">Abrir en Outlook web</a>
        <a class="boton secundario" href="${urlMailto}"
           style="text-decoration:none; display:inline-block; margin-top:0;">Abrir en app de correo</a>
        <button type="button" class="secundario" style="margin-top:0;" id="modal-correo-copiar">Copiar texto</button>
        <button type="button" class="secundario" style="margin-top:0;" id="modal-correo-cerrar">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(fondo);
  document.getElementById('modal-correo-texto').value = cuerpo;

  document.getElementById('modal-correo-copiar').addEventListener('click', async () => {
    const texto = `Para: ${editor.email}\nAsunto: ${asunto}\n\n${cuerpo}`;
    try {
      await navigator.clipboard.writeText(texto);
      document.getElementById('modal-correo-copiar').textContent = 'Copiado ✓';
    } catch {
      const area = document.getElementById('modal-correo-texto');
      area.select();
      document.execCommand('copy');
      document.getElementById('modal-correo-copiar').textContent = 'Copiado ✓';
    }
  });
  document.getElementById('modal-correo-cerrar').addEventListener('click', () => fondo.remove());
}

async function asignarEditorArea(manuscriptId) {
  const select = document.getElementById(`sel-editorarea-${manuscriptId}`);
  const editorAreaId = select.value || null;

  const { error } = await db.from('manuscripts')
    .update({ editor_area_asignado_id: editorAreaId })
    .eq('id', manuscriptId);

  if (error) { alert('Error al asignar: ' + error.message); return; }

  if (!editorAreaId) {
    alert('Asignación de editor de área quitada.');
    cargarVistaEditor();
    return;
  }

  const manuscrito = cacheManuscritos[manuscriptId];
  const editor = cacheEditoresArea.find(e => e.id === editorAreaId);

  await cargarVistaEditor();

  if (manuscrito && editor?.email) {
    abrirCorreoAsignacionEditorArea(manuscrito, editor);
  } else {
    alert('Editor de área asignado. (No se encontró su correo para preparar el aviso; avísale por tu cuenta.)');
  }
}

iniciarPanel();

async function renderDictamenes(manuscriptId) {
  const {data: asignaciones, error} = await db.from('review_assignments')
    .select('id, estado, reviews(*)').eq('manuscript_id', manuscriptId);
  if (error) return '<p>No se pudieron cargar los dictámenes.</p>';
  if (!asignaciones?.length) return '<p>Sin revisores asignados.</p>';
  return '<h3>Evaluaciones</h3>' + asignaciones.map((a, i) => {
    const encabezado = `<p>Revisor ${i + 1}: ${escaparHTML(a.estado)}</p>`;
    return encabezado + (a.reviews || []).map(r => `<details>
      <summary>${escaparHTML(r.decision)} · ${r.puntaje_total ?? '—'}/32</summary>
      ${(r.criterios || []).map(c => `<p><strong>${escaparHTML(c.titulo)}: ${escaparHTML(c.puntaje)}/4</strong><br>${escaparHTML(c.comentario)}</p>`).join('')}
      <p><strong>Comentario privado al editor:</strong> ${escaparHTML(r.comentarios_editor || 'Sin comentarios')}</p>
      <p>Segunda revisión: ${escaparHTML(r.necesita_segunda_revision || 'No aplica')}.
      Disponibilidad: ${escaparHTML(r.dispuesto_segunda_revision || 'No aplica')}.</p>
    </details>`).join('');
  }).join('');
}
