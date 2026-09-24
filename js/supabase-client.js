// =====================================================================
// Conexión a Supabase
// =====================================================================
const SUPABASE_URL = 'https://qrdvsojttyuxnozyovbp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyZHZzb2p0dHl1eG5venlvdmJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Mjg4MTMsImV4cCI6MjEwNTAwNDgxM30.tjcnLuR9Vafy3G2YYE51SrXH6wiOO0ALIFHvBMeVJAY';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Nombres de los buckets de Storage
const BUCKETS = {
  manuscritos: 'manuscritos',
  manuscritosAnonimizados: 'manuscritos-anonimizados',
  cartas: 'cartas-presentacion',
  conflictos: 'declaraciones-conflicto',
  suplementario: 'material-suplementario'
};

// Limpia un nombre de archivo antes de usarlo como parte de una ruta en
// Storage: Supabase rechaza acentos y varios caracteres especiales en la
// clave del objeto (error "Invalid key"). Quita acentos/diacríticos,
// cambia espacios y símbolos por guiones, y conserva la extensión.
function sanitizarNombreArchivo(nombre) {
  const sinAcentos = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // quita las marcas diacríticas (acentos, diéresis)
  return sinAcentos
    .replace(/[^a-zA-Z0-9.\-]+/g, '_') // todo lo que no sea letra/número/punto/guion → "_"
    .replace(/_+/g, '_'); // colapsa guiones bajos repetidos
}

// Áreas temáticas oficiales de RCIA-UADY (alcance temático del sitio público)
const AREAS_TEMATICAS = [
  'Ingeniería Química y Bioquímica',
  'Ciencia e Ingeniería de Alimentos',
  'Biotecnología y Bioprocesos',
  'Ciencias Ambientales',
  'Ciencia de Materiales',
  'Ingeniería de Procesos',
  'Ingeniería Industrial',
  'Energías Renovables',
  'Nanotecnología'
];

function escaparHTML(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Las URLs históricas siguen siendo referencias; cada apertura requiere RLS.
function referenciaStorage(valor) {
  const url = new URL(valor, window.location.href);
  if (url.origin !== new URL(SUPABASE_URL).origin) return null;
  const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
  if (!match || !Object.values(BUCKETS).includes(match[1])) return null;
  return {bucket: match[1], ruta: decodeURIComponent(match[2])};
}

document.addEventListener('click', async event => {
  const enlace = event.target.closest('a[href]');
  if (!enlace) return;
  const ref = referenciaStorage(enlace.href);
  if (!ref) return;
  event.preventDefault();
  const ventana = window.open('about:blank', '_blank');
  if (ventana) ventana.opener = null;
  try {
    const {data, error} = await db.storage.from(ref.bucket).createSignedUrl(ref.ruta, 60);
    if (error || !data?.signedUrl) throw error || new Error('Archivo no disponible');
    if (ventana) ventana.location.replace(data.signedUrl);
    else window.location.assign(data.signedUrl);
  } catch (error) {
    if (ventana) ventana.close();
    alert('No se pudo abrir el archivo. Comprueba tu sesión y que la asignación siga vigente.');
  }
});
