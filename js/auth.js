// =====================================================================
// Autenticación
// Nota: los registros nuevos entran siempre con rol 'autor' — esto está
// forzado también a nivel de base de datos (política RLS de INSERT en
// `profiles`), así que aunque alguien manipule el formulario no puede
// autoasignarse otro rol. Revisor / editor de área / editor se asignan
// desde el panel "Gestión de usuarios" (solo visible para el editor).
// =====================================================================

function mostrarAviso(idContenedor, mensaje, tipo = 'info') {
  const el = document.getElementById(idContenedor);
  el.innerHTML = `<div class="aviso aviso-${tipo}">${mensaje}</div>`;
}

// Redirige al dashboard si ya hay una sesión activa.
// Solo aplica en index.html (donde existe el formulario de login);
// en las demás páginas este archivo también se carga (por el botón
// "Cerrar sesión"), así que ahí NO debe ejecutarse o provoca un bucle
// de redirección hacia sí misma.
async function redirigirSiHaySesion() {
  if (!document.getElementById('btn-login')) return;
  const { data: { session } } = await db.auth.getSession();
  if (session) window.location.href = 'dashboard.html';
}
redirigirSiHaySesion();

document.getElementById('btn-login')?.addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    mostrarAviso('aviso-login', 'Ingresa correo y contraseña.', 'error');
    return;
  }

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    mostrarAviso('aviso-login', 'Correo o contraseña incorrectos.', 'error');
    return;
  }
  window.location.href = 'dashboard.html';
});

document.getElementById('btn-registro')?.addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password || password.length < 6) {
    mostrarAviso('aviso-login', 'Ingresa un correo y una contraseña de al menos 6 caracteres.', 'error');
    return;
  }

  const nombre = prompt('Nombre completo (como aparecerá en tus manuscritos):');
  if (!nombre) return;

  // El perfil (rol "autor" por defecto, forzado también por RLS) lo crea
  // automáticamente un trigger en la base de datos apenas se crea la
  // cuenta — aquí solo mandamos el nombre como metadato para que el
  // trigger lo use al crear esa fila.
  const { error } = await db.auth.signUp({
    email,
    password,
    options: { data: { nombre_completo: nombre } }
  });
  if (error) {
    mostrarAviso('aviso-login', error.message, 'error');
    return;
  }

  mostrarAviso('aviso-login', 'Cuenta creada. Revisa tu correo para confirmar el registro.', 'ok');
});

async function cerrarSesion() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}
