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
