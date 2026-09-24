// Actualiza únicamente la contraseña de la sesión actual; nunca la guarda en perfiles.
const formularioPassword = document.getElementById('form-password');
const botonPassword = document.getElementById('guardar-password');
const actualPassword = document.getElementById('password-actual');
const nuevaPassword = document.getElementById('password-nueva');
const confirmarPassword = document.getElementById('password-confirmar');
let usuarioPassword = null;
let guardandoPassword = false;

function avisoPassword(texto, tipo = 'info') {
  const aviso = document.getElementById('aviso-password');
  aviso.className = 'aviso aviso-' + tipo;
  aviso.textContent = texto;
}

async function iniciarPassword() {
  try {
    const { data, error } = await db.auth.getUser();
    if (error || !data?.user) {
      window.location.href = 'index.html';
      return;
    }
    usuarioPassword = data.user.id;
    document.getElementById('cuenta-password').textContent = 'Cuenta: ' + (data.user.email || '');
    formularioPassword.hidden = false;
  } catch {
    avisoPassword('No se pudo comprobar tu sesión. Recarga la página para intentarlo de nuevo.', 'error');
  }
}

formularioPassword.addEventListener('submit', async event => {
  event.preventDefault();
  if (guardandoPassword || !usuarioPassword) return;
  if (!actualPassword.value || nuevaPassword.value.length < 8) {
    avisoPassword('Escribe tu contraseña actual y una nueva de al menos 8 caracteres.', 'error');
    return;
  }
  if (nuevaPassword.value !== confirmarPassword.value) {
    avisoPassword('Las nuevas contraseñas no coinciden.', 'error');
    confirmarPassword.focus();
    return;
  }
  if (actualPassword.value === nuevaPassword.value) {
    avisoPassword('La nueva contraseña debe ser diferente de la actual.', 'error');
    return;
  }
  guardandoPassword = true;
  botonPassword.disabled = true;
  avisoPassword('Guardando nueva contraseña…');
  try {
    // Detectar una sesión cerrada o cambiada en otra pestaña.
    const { data, error: errorUsuario } = await db.auth.getUser();
    if (errorUsuario || data?.user?.id !== usuarioPassword) {
      formularioPassword.reset();
      formularioPassword.hidden = true;
      avisoPassword('Tu sesión cambió o caducó. Vuelve al panel e inicia sesión de nuevo.', 'error');
      return;
    }
    const { error } = await db.auth.updateUser({
      password: nuevaPassword.value,
      current_password: actualPassword.value
    });
    if (error) {
      const mensajes = {
        same_password: 'La nueva contraseña debe ser diferente de la actual.',
        weak_password: 'La nueva contraseña no cumple los requisitos de seguridad. Elige una más larga y combina letras, números y símbolos.',
        invalid_credentials: 'La contraseña actual no es correcta.',
        reauthentication_needed: 'Para cambiar la contraseña, cierra sesión y vuelve a entrar con tu contraseña actual.',
        session_not_found: 'Tu sesión caducó. Vuelve a iniciar sesión.',
        over_request_rate_limit: 'Se hicieron demasiados intentos. Espera unos minutos antes de reintentar.'
      };
      avisoPassword(mensajes[error.code] || 'No se pudo cambiar la contraseña. Comprueba la contraseña actual; si el problema continúa, vuelve a iniciar sesión y contacta a la revista.', 'error');
      return;
    }
    formularioPassword.reset();
    formularioPassword.hidden = true;
    avisoPassword('Contraseña actualizada correctamente. En tu próximo acceso utiliza la nueva contraseña. Puedes volver al panel.', 'ok');
  } catch {
    avisoPassword('No se pudo confirmar el cambio por un problema de conexión. Antes de repetirlo, comprueba el acceso con la nueva contraseña.', 'error');
  } finally {
    guardandoPassword = false;
    botonPassword.disabled = false;
  }
});

iniciarPassword();
