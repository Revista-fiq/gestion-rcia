// =====================================================================
// Autenticación
// Nota: los registros nuevos entran siempre con rol 'autor'.
// El editor asciende manualmente a alguien a 'revisor' o 'editor'
// desde el panel (o directo en la tabla profiles).
// =====================================================================

function mostrarAviso(idContenedor, mensaje, tipo = 'info') {
  const el = document.getElementById(idContenedor);
  el.innerHTML = `<div class="aviso aviso-${tipo}">${mensaje}</div>`;
}

// Redirige al dashboard si ya hay una sesión activa
async function redirigirSiHaySesion() {
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

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) {
    mostrarAviso('aviso-login', error.message, 'error');
    return;
  }

  // Crea el perfil asociado (rol autor por defecto)
  if (data.user) {
    await db.from('profiles').insert({
      id: data.user.id,
      role: 'autor',
      nombre_completo: nombre,
      email
    });
  }

  mostrarAviso('aviso-login', 'Cuenta creada. Revisa tu correo para confirmar el registro.', 'ok');
});

async function cerrarSesion() {
  await db.auth.signOut();
  window.location.href = 'index.html';
}
