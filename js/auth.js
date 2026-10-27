// La selección orienta el acceso. Los roles y permisos siguen en Supabase.
function mostrarAviso(idContenedor, mensaje, tipo = 'info') {
  const contenedor = document.getElementById(idContenedor);
  const aviso = document.createElement('div');
  aviso.className = 'aviso aviso-' + tipo;
  aviso.textContent = mensaje;
  contenedor.replaceChildren(aviso);
}

let tipoAcceso = null;
let accesoEnCurso = false;
function seleccionarAcceso(tipo) {
  if (accesoEnCurso || !['autor', 'editorial'].includes(tipo)) return;
  tipoAcceso = tipo;
  document.getElementById('guia-autor').classList.toggle('oculto', tipo !== 'autor');
  document.getElementById('guia-editorial').classList.toggle('oculto', tipo !== 'editorial');
  document.getElementById('btn-registro').classList.toggle('oculto', tipo !== 'autor');
  document.getElementById('btn-login').disabled = false;
}
document.querySelectorAll('input[name="tipo-acceso"]').forEach(input => {
  input.addEventListener('change', () => seleccionarAcceso(input.value));
});

function bloquearAcceso(bloquear) {
  accesoEnCurso = bloquear;
  document.getElementById('btn-login').disabled = bloquear || !tipoAcceso;
  document.getElementById('btn-registro').disabled = bloquear;
  document.querySelectorAll('input[name="tipo-acceso"]').forEach(input => input.disabled = bloquear);
}

async function abrirPanelVerificado(usuario) {
  const { data: perfil, error } = await db.from('profiles').select('role, activo').eq('id', usuario.id).single();
  if (error || !perfil) throw new Error('No se pudo comprobar tu perfil. Reintenta el acceso; si continúa, contacta a la revista.');
  if (!perfil.activo) {
    document.getElementById('acciones-cuenta').classList.add('oculto');
    const { error: salidaError } = await db.auth.signOut();
    if (salidaError) throw new Error('Tu perfil está inactivo y no se pudo cerrar la sesión. Contacta a la revista.');
    throw new Error('Tu perfil está inactivo. Contacta a la revista para revisar tu cuenta; no crees otra.');
  }
  if (!['autor', 'revisor', 'editor_area', 'editor'].includes(perfil.role)) throw new Error('El rol de tu cuenta requiere revisión por la revista.');
  const esEditorial = perfil.role !== 'autor';
  const coincide = !tipoAcceso || (tipoAcceso === 'editorial') === esEditorial;
  if (!coincide) {
    mostrarAviso('aviso-login', esEditorial
      ? 'Tu cuenta ya tiene un rol de revisor o editor. Puedes abrir su panel; no necesitas registrarte de nuevo.'
      : 'Esta cuenta tiene rol de autor. Si recibiste una invitación como revisor o editor, comprueba que usaste el correo indicado y contacta a la revista para revisar tu cuenta. No crees otra.', 'info');
    document.getElementById('acciones-cuenta').classList.remove('oculto');
    return;
  }
  window.location.href = 'dashboard.html';
}

// Con una sesión vigente, comprobar el perfil sin alterar el rol.
async function redirigirSiHaySesion() {
  if (!document.getElementById('btn-login')) return;
  bloquearAcceso(true);
  try {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) throw new Error('No se pudo comprobar la sesión. Vuelve a iniciar sesión.');
    if (session) {
      document.getElementById('acciones-cuenta').classList.remove('oculto');
      await abrirPanelVerificado(session.user);
    }
  } catch (error) { mostrarAviso('aviso-login', error.message, 'error'); }
  finally { bloquearAcceso(false); }
}
redirigirSiHaySesion();

document.getElementById('btn-login')?.addEventListener('click', async () => {
  if (accesoEnCurso) return;
  if (!tipoAcceso) { mostrarAviso('aviso-login', 'Selecciona Autor o autora, o Revisores y editores.', 'error'); return; }
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) { mostrarAviso('aviso-login', 'Ingresa correo y contraseña.', 'error'); return; }
  bloquearAcceso(true);
  document.getElementById('acciones-cuenta').classList.add('oculto');
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error || !data?.user) throw new Error('No se pudo iniciar sesión. Comprueba tu correo y contraseña vigente. Si no la recuerdas o no la recibiste, contacta a la revista; no crees otra cuenta.');
    document.getElementById('password').value = '';
    document.getElementById('acciones-cuenta').classList.remove('oculto');
    await abrirPanelVerificado(data.user);
  } catch (error) { mostrarAviso('aviso-login', error.message, 'error'); }
  finally { bloquearAcceso(false); }
});

document.getElementById('btn-registro')?.addEventListener('click', async () => {
  if (accesoEnCurso) return;
  if (tipoAcceso !== 'autor') { mostrarAviso('aviso-login', 'Los revisores y editores deben usar su cuenta habilitada por la revista.', 'info'); return; }
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || password.length < 6) { mostrarAviso('aviso-login', 'Ingresa un correo y una contraseña de al menos 6 caracteres.', 'error'); return; }
  bloquearAcceso(true);
  try {
    const { data: { session }, error: sesionError } = await db.auth.getSession();
    if (sesionError) throw new Error('No se pudo comprobar tu sesión. Recarga la página.');
    if (session) {
      document.getElementById('acciones-cuenta').classList.remove('oculto');
      throw new Error('Ya tienes una sesión abierta. Usa el panel de esa cuenta o cierra sesión; no crees otra.');
    }
    const nombre = prompt('Nombre completo (como aparecerá en tus manuscritos):');
    if (!nombre?.trim()) return;
    // El trigger y RLS mantienen el rol inicial autor. No se envía ningún rol.
    const { data, error } = await db.auth.signUp({ email, password, options: { data: { nombre_completo: nombre.trim() } } });
    if (error) throw new Error(error.message);
    document.getElementById('password').value = '';
    if (data.session) window.location.href = 'dashboard.html';
    else mostrarAviso('aviso-login', 'Si se requiere confirmar el correo, revisa tu bandeja y correo no deseado. Si ya tenías cuenta, utiliza Iniciar sesión.', 'ok');
  } catch (error) { mostrarAviso('aviso-login', error.message, 'error'); }
  finally { bloquearAcceso(false); }
});

async function cerrarSesion() {
  const { error } = await db.auth.signOut();
  if (error) { alert('No se pudo cerrar la sesión. Reintenta antes de usar otra cuenta.'); return; }
  window.location.href = 'index.html';
}
document.getElementById('btn-otra-cuenta')?.addEventListener('click', cerrarSesion);
