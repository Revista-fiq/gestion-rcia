// Antecedentes incorporados por el editor responsable y carta de aceptación.
const antecedentesEnCurso = new Set();
async function renderAntecedentes(m) {
  const {data, error} = await db.from('editorial_antecedents')
    .select('id,tipo,visibilidad,fecha_documento,ruta,assignment_id').eq('manuscript_id', m.id).order('created_at');
  if (error) return rolPanelActual === 'editor' ? '<p class="aviso aviso-error">Para incorporar antecedentes, ejecuta schema_fase8_antecedentes.sql en Supabase.</p>' : '';
  let asignacionesRegistradas = [];
  if (rolPanelActual === 'editor' || rolPanelActual === 'editor_area') {
    const resultado = await db.from('review_assignments').select('id,reviewer_id').eq('manuscript_id',m.id);
    asignacionesRegistradas = resultado.data || [];
  }
  const lista = (data || []).map(d => {
    const asignacion = asignacionesRegistradas.find(a => a.id === d.assignment_id);
    const revisor = asignacion && revisoresPanelActual.find(r => r.id === asignacion.reviewer_id);
    const nombre = revisor ? ' · Revisor: ' + escaparHTML(revisor.nombre_completo) : '';
    const etiqueta = d.tipo === 'dictamen' ? 'Dictamen previo' : 'Versión corregida';
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKETS.antecedentes}/${d.ruta}`;
    return `<li><a href="${escaparHTML(url)}" target="_blank" rel="noopener">${etiqueta}</a>${nombre} · Fecha del documento: ${escaparHTML(d.fecha_documento)}${rolPanelActual !== 'autor' ? (d.visibilidad === 'editor' ? ' · Solo equipo editorial' : ' · Compartido con el autor') : ''}</li>`;
  }).join('');
  let formulario = '';
  if (rolPanelActual === 'editor' && !['aceptado','publicado'].includes(m.estado)) {
    const {data: asignaciones, error: errAsignacion} = await db.from('review_assignments')
      .select('id,reviewer_id,estado').eq('manuscript_id',m.id).in('estado',['pendiente','aceptada']);
    const opciones = (asignaciones || []).map(a => {
      const r = revisoresPanelActual.find(r => r.id === a.reviewer_id);
      return `<option value="asignacion:${a.id}">${escaparHTML(r ? r.nombre_completo + ' (' + r.email + ')' : a.reviewer_id)}</option>`;
    }).join('');
    const nuevos = (revisoresPanelActual || []).filter(r => !asignacionesRegistradas.some(a => a.reviewer_id === r.id))
      .map(r => `<option value="revisor:${r.id}">${escaparHTML(r.nombre_completo)} (${escaparHTML(r.email)}) · evaluación previa</option>`).join('');
    formulario = `<details><summary>Adjuntar dictamen previo / versión corregida</summary>
      <p>Carga cada dictamen recibido por separado y luego la versión corregida. Registra la fecha del documento original. No se generarán puntuaciones ni dictámenes de formulario ficticios.</p>
      <label for="tipo-ant-${m.id}">Documento</label><select id="tipo-ant-${m.id}" onchange="ajustarTipoAntecedente('${m.id}')"><option value="dictamen">Dictamen previo de un revisor</option><option value="version_corregida">Versión corregida del manuscrito</option></select>
      <div id="campos-dictamen-${m.id}"><label for="revisor-ant-${m.id}">Revisor que realizó esta evaluación</label><select id="revisor-ant-${m.id}"><option value="">Seleccionar revisor</option>${opciones}${nuevos}</select><p>Si el revisor no tenía asignación, se registra su participación ya concluida, sin enviarle una nueva invitación. Debe tener una cuenta de revisor activa.</p>
      ${errAsignacion ? '<p>No se pudieron cargar las asignaciones. Recarga antes de continuar.</p>' : ''}
      <label><input type="checkbox" id="visible-ant-${m.id}"> Compartir este documento con el autor</label>
      <p>Por defecto es confidencial para el equipo editorial. Antes de compartirlo, retira nombres de revisores y comentarios privados.</p></div>
      <label for="fecha-ant-${m.id}">Fecha del documento original</label><input type="date" id="fecha-ant-${m.id}">
      <label for="archivo-ant-${m.id}">Archivo PDF o Word</label><input type="file" id="archivo-ant-${m.id}" accept=".pdf,.doc,.docx">
      <p>La versión corregida será visible para el autor y pasará a ser el archivo vigente. Si requiere otra revisión, habrá que cargar una nueva copia anonimizada.</p>
      <button type="button" id="guardar-ant-${m.id}" onclick="guardarAntecedente('${m.id}')">Registrar antecedente</button>
    </details>`;
  }
  return lista || formulario ? `<div style="margin:18px 0;padding:16px;border:1px solid #cbd5e1;border-radius:8px;"><h3>Antecedentes de evaluación externa</h3>${lista ? '<ul>'+lista+'</ul>' : '<p>No hay documentos previos incorporados.</p>'}${formulario}</div>` : '';
}
function ajustarTipoAntecedente(mid) {
  document.getElementById('campos-dictamen-'+mid).hidden = document.getElementById('tipo-ant-'+mid).value !== 'dictamen';
}
async function guardarAntecedente(mid) {
  if (rolPanelActual !== 'editor' || antecedentesEnCurso.has(mid)) return;
  const clase = document.getElementById('tipo-ant-'+mid).value;
  const seleccion = clase === 'dictamen' ? document.getElementById('revisor-ant-'+mid).value : '';
  const [origen, identificador] = seleccion.split(':');
  const aid = origen === 'asignacion' ? identificador : null;
  const revisorId = origen === 'revisor' ? identificador : null;
  const fecha = document.getElementById('fecha-ant-'+mid).value;
  const file = document.getElementById('archivo-ant-'+mid).files[0];
  const visible = clase === 'version_corregida' || document.getElementById('visible-ant-'+mid).checked;
  if (!file || !fecha || (clase === 'dictamen' && !aid && !revisorId)) { alert('Selecciona archivo, fecha y el revisor cuando corresponda.'); return; }
  if (!/\.(pdf|doc|docx)$/i.test(file.name) || file.size > 25*1024*1024) { alert('Usa PDF o Word, de hasta 25 MB.'); return; }
  const m=cacheManuscritos[mid];
  if (!m || !confirm(`¿Incorporar ${file.name} a ${m.folio}?\n${clase === 'dictamen' ? 'La participación del revisor quedará registrada como entregada.' : 'Se guardará una nueva versión y sustituirá al archivo vigente.'}\n${visible ? 'El autor podrá leer este archivo.' : 'Solo lo podrá leer el equipo editorial autorizado.'}`)) return;
  const boton=document.getElementById('guardar-ant-'+mid);
  antecedentesEnCurso.add(mid);boton.disabled=true;
  let ruta=null, registrado=false;
  try {
    const {data, error} = await db.auth.getUser();
    if (error || data.user?.id !== usuarioPanelActual) throw new Error('La cuenta activa cambió. Recarga el panel.');
    // Nombre neutro: no revela al autor el nombre del revisor en la ruta.
    ruta=`${mid}/${crypto.randomUUID()}.${file.name.split('.').pop().toLowerCase()}`;
    const carga=await db.storage.from(BUCKETS.antecedentes).upload(ruta,file);
    if(carga.error)throw carga.error;
    const resultado=await db.rpc('rcia_registrar_antecedente',{mid,aid:aid || null,clase,visible_autor:visible,fecha,ruta_archivo:ruta,revisor_id:revisorId || null});
    if(resultado.error)throw resultado.error;
    registrado=true;
    await cargarVistaEditor();
    alert('Antecedente incorporado. Puedes consultarlo en el expediente. No es necesario que el revisor vuelva a llenar el formulario.');
  } catch(error) {
    if(ruta && !registrado) await db.storage.from(BUCKETS.antecedentes).remove([ruta]);
    alert('No se pudo completar la carga: '+error.message+' Comprueba el expediente antes de repetirla.');
  } finally {antecedentesEnCurso.delete(mid);boton.disabled=false;}
}
function textoCartaAceptacion({folio,titulo,autor,fecha}) {
  const fechaTexto=new Date(fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
  return `REVISTA DE CIENCIA E INGENIERÍA APLICADA DE LA UADY
RCIA-UADY
Facultad de Ingeniería Química
Universidad Autónoma de Yucatán

CARTA DE ACEPTACIÓN

Mérida, Yucatán, a ${fechaTexto}

Folio: ${folio}
Asunto: Aceptación de manuscrito para publicación

${autor}
En representación de las personas autoras
Presente.

Por este medio, le comunicamos que el manuscrito titulado:

«${titulo}»

ha sido aceptado para publicación en la Revista de Ciencia e Ingeniería Aplicada de la UADY, tras concluir la evaluación por pares y la revisión de las modificaciones realizadas en atención a los dictámenes recibidos.

El manuscrito continuará con las etapas de corrección de estilo, edición y preparación de pruebas. Durante este proceso, podrán solicitarse ajustes de presentación que no alteren su contenido científico. Las pruebas se remitirán al autor de correspondencia para su revisión y aprobación.

La asignación de volumen, número y fecha de publicación se comunicará oportunamente, de acuerdo con la programación editorial de la revista.

Agradecemos la confianza depositada en RCIA-UADY para la difusión de su trabajo y la colaboración de todas las personas autoras durante el proceso de evaluación.

Atentamente,

Luis Antonio Chel Guerrero
Editor responsable
Revista de Ciencia e Ingeniería Aplicada de la UADY
Facultad de Ingeniería Química
Universidad Autónoma de Yucatán

Contacto: revista.fiq@correo.uady.mx`;
}
async function abrirCartaAceptacion(mid) {
  try {
    const {data:m,error}=await db.from('manuscripts').select('id,folio,titulo,estado,fecha_aceptacion,profiles!manuscripts_autor_correspondencia_id_fkey(nombre_completo)').eq('id',mid).single();
    if(error)throw new Error('No se pudieron leer los datos de aceptación. Comprueba que ejecutaste schema_fase8_antecedentes.sql.');
    if(!['aceptado','publicado'].includes(m.estado))throw new Error('El manuscrito aún no está aceptado.');
    if(!m.fecha_aceptacion)throw new Error('No hay fecha de aceptación registrada. Contacta al editor responsable para revisar el historial; no cambies el estado solo para generar una fecha nueva.');
    document.getElementById('modal-aceptacion')?.remove();
    const fondo=document.createElement('div');fondo.id='modal-aceptacion';
    fondo.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
    fondo.innerHTML=`<div role="dialog" aria-modal="true" aria-label="Carta de aceptación" style="background:white;padding:24px;border-radius:10px;max-width:800px;width:100%;max-height:90vh;overflow:auto;">
      <h2>Carta de aceptación · ${escaparHTML(m.folio)}</h2>
      <p>Revisa el nombre, título y fecha. Puedes ajustar el texto antes de copiarlo o imprimirlo. No se envía automáticamente ni se guarda una copia de los cambios en el sistema.</p>
      <label for="texto-carta-aceptacion">Texto de la carta</label><textarea id="texto-carta-aceptacion" style="width:100%;height:48vh;box-sizing:border-box;font-size:15px;line-height:1.5;"></textarea>
      <div style="display:flex;flex-wrap:wrap;gap:10px;"><button type="button" id="copiar-carta">Copiar carta</button><button type="button" id="imprimir-carta">Imprimir / Guardar como PDF</button><button type="button" id="cerrar-carta" class="secundario">Cerrar</button></div>
      <p>Para PDF, selecciona «Guardar como PDF» en la ventana de impresión. La carta no incorpora firma digital.</p>
    </div>`;
    document.body.appendChild(fondo);
    const campo=document.getElementById('texto-carta-aceptacion');
    campo.value=textoCartaAceptacion({folio:m.folio,titulo:m.titulo,autor:m.profiles?.nombre_completo || '[Nombre del autor de correspondencia]',fecha:m.fecha_aceptacion});
    document.getElementById('cerrar-carta').onclick=()=>fondo.remove();
    document.getElementById('copiar-carta').onclick=async()=>{
      try {await navigator.clipboard.writeText(campo.value);document.getElementById('copiar-carta').textContent='Carta copiada';}
      catch {campo.focus();campo.select();alert('Copia el texto seleccionado con Ctrl+C.');}
    };
    document.getElementById('imprimir-carta').onclick=()=>{
      const ventana=window.open('','_blank');
      if(!ventana){alert('Permite ventanas emergentes para imprimir la carta.');return;}
      ventana.opener=null;
      ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Carta ${escaparHTML(m.folio)}</title><style>@page{size:letter;margin:20mm}body{font-family:Georgia,serif;font-size:11pt;line-height:1.4;color:#111}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}button{padding:10px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Imprimir / Guardar como PDF</button><pre>${escaparHTML(campo.value)}</pre></body></html>`);
      ventana.document.close();
      ventana.focus();
      ventana.print();
    };
  } catch(error){alert(error.message);}
}
