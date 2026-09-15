// =====================================================================
// Conexión a Supabase
// Reemplaza estos dos valores cuando el proyecto exista
// (Supabase → Project Settings → API)
// =====================================================================
const SUPABASE_URL = 'https://qrdvsojttyuxnozyovbp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyZHZzb2p0dHl1eG5venlvdmJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Mjg4MTMsImV4cCI6MjEwNTAwNDgxM30.tjcnLuR9Vafy3G2YYE51SrXH6wiOO0ALIFHvBMeVJAY';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Nombres de los buckets de Storage (se crean en Fase 2)
const BUCKETS = {
  manuscritos: 'manuscritos',
  cartas: 'cartas-presentacion',
  conflictos: 'declaraciones-conflicto',
  suplementario: 'material-suplementario'
};
