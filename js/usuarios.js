// =====================================================================
// Gestión de usuarios — solo accesible para role = 'editor'
// (las políticas RLS de `profiles` también lo exigen en el servidor,
// así que aunque alguien fuerce esta URL sin ser editor, no podrá leer
// ni modificar la lista completa de usuarios).
// =====================================================================

const ETIQUETAS_ROL = {
  autor: 'Autor',
  revisor: 'Revisor',
  editor_area: 'Editor de área',
  editor: 'Editor en jefe'
};

async function verificarAccesoYcargar() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  const { data: perfil } = await db.from('profiles').select('role').eq('id', session.user.id).single();
  if (!perfil || perfil.role !== 'editor') {
    document.querySelector('.contenedor').innerHTML =
      '<div class="aviso aviso-error">Solo el editor en jefe puede gestionar usuarios.</div>';
    return;
  }

  cargarUsuarios();
}

async function cargarUsuarios() {
  const cont = document.getElementById('lista-usuarios');
  const { data: usuarios, error } = await db
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { cont.innerHTML = `<div class="aviso aviso-error">Error al cargar: ${error.message}</div>`; return; }
  if (!usuarios.length) { cont.innerHTML = '<p class="vacio">No hay usuarios registrados.</p>'; return; }

  cont.innerHTML = '';
  usuarios.forEach((u) => {
    const areasMarcadas = u.areas_asignadas || [];
    cont.insertAdjacentHTML('beforeend', `
      <div class="tarjeta" id="usuario-${u.id}">
        <div class="tarjeta-cabecera">
          <div>
            <div class="titulo-manuscrito">${u.nombre_completo}</div>
            <div class="folio">${u.email}</div>
          </div>
          <span class="estado estado-en_revision">${ETIQUETAS_ROL[u.role] || u.role}</span>
        </div>

        <label>Rol</label>
        <select id="rol-${u.id}" onchange="alCambiarRol('${u.id}')">
          ${Object.entries(ETIQUETAS_ROL).map(([valor, etiqueta]) =>
            `<option value="${valor}" ${valor === u.role ? 'selected' : ''}>${etiqueta}</option>`
          ).join('')}
        </select>

        <div id="areas-wrap-${u.id}" class="${u.role === 'editor_area' ? '' : 'oculto'}">
          <label>Áreas que gestiona</label>
          <div class="areas-checkbox">
            ${AREAS_TEMATICAS.map(area => `
              <label>
                <input type="checkbox" value="${area}" ${areasMarcadas.includes(area) ? 'checked' : ''}
                       class="area-check-${u.id}">
                ${area}
              </label>
            `).join('')}
          </div>
        </div>

        <button class="secundario" onclick="guardarCambios('${u.id}')">Guardar cambios</button>
      </div>
    `);
  });
}

function alCambiarRol(userId) {
  const rol = document.getElementById(`rol-${userId}`).value;
  document.getElementById(`areas-wrap-${userId}`).classList.toggle('oculto', rol !== 'editor_area');
}

async function guardarCambios(userId) {
  const rol = document.getElementById(`rol-${userId}`).value;
  let areas = null;
  if (rol === 'editor_area') {
    areas = Array.from(document.querySelectorAll(`.area-check-${userId}:checked`)).map(el => el.value);
    if (!areas.length) {
      mostrarAviso('aviso-usuarios', 'Selecciona al menos un área para un editor de área.', 'error');
      return;
    }
  }

  const { error } = await db
    .from('profiles')
    .update({ role: rol, areas_asignadas: areas })
    .eq('id', userId);

  if (error) {
    mostrarAviso('aviso-usuarios', 'Error al guardar: ' + error.message, 'error');
    return;
  }

  mostrarAviso('aviso-usuarios', 'Cambios guardados.', 'ok');
  cargarUsuarios();
}

verificarAccesoYcargar();
