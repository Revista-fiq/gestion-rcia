// Copias editoriales revisadas para el autor; no expone las filas privadas de reviews.
function borradorResultados(asignaciones) {
 const decisiones={aceptar:'Aceptar',revision_menor:'Revisiones menores',revision_mayor:'Revisiones mayores',rechazar:'Rechazar'};
 let numero=0;
 return asignaciones.filter(a=>a.estado==='entregada').flatMap(a=>(a.reviews||[]).map(r=>{
  numero++;
  return ['Evaluación '+numero,
   'Recomendación del revisor: '+(decisiones[r.decision]||'Consultar observaciones'),
   ...(r.criterios||[]).map(c=>String(c.titulo||'Criterio')+'\n'+String(c.comentario||'Sin observaciones.')),
   r.comentarios_autor||''].filter(Boolean).join('\n\n');
 })).join('\n\n────────────────────\n\n');
}
async function renderResultadosAutor(m) {
 const editorial=['editor','editor_area'].includes(rolPanelActual);
 const permitido=rolPanelActual==='editor'||(rolPanelActual==='editor_area'&&m.editor_area_asignado_id===usuarioPanelActual);
 const {data,error}=await db.rpc('rcia_leer_resultados',{mid:m.id});
 if(error) {
  if(!editorial)return '';
  if(!permitido)return '';
  return '<p class="aviso aviso-info">Resultados para el autor: falta activar esta opción con schema_resultados_autor.sql si aún no se ha instalado. Si ya se instaló, recarga y comprueba los permisos.</p>';
 }
 const lista=(data||[]).map(r=>'<details style="margin:12px 0;"><summary>Resultados compartidos · '+escaparHTML(formatoFecha(r.fecha))+'</summary>'+
 (editorial?'<p>Compartidos por: '+escaparHTML(r.compartido_por||'Equipo editorial')+'</p>':'')+
 '<div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;border:1px solid #cbd5e1;">'+escaparHTML(r.texto)+'</div></details>').join('');
 if(!lista&&!permitido)return '';
 return '<section style="margin:18px 0;padding:16px;border:2px solid #496b8a;border-radius:8px;"><h3>Resultados de evaluación para el autor</h3>'+
 (lista||'<p>Todavía no se han compartido resultados con el autor.</p>')+
 (permitido?'<button type="button" class="secundario" onclick="prepararResultadosAutor(\''+m.id+'\',this)">Preparar / compartir resultados</button><p>El autor solo verá el texto revisado que se comparta aquí. Esta acción no cambia el estado del manuscrito.</p>':'')+'</section>';
}
async function prepararResultadosAutor(mid,boton) {
 const m=cacheManuscritos[mid];
 if(!m || !(rolPanelActual==='editor'||(rolPanelActual==='editor_area'&&m.editor_area_asignado_id===usuarioPanelActual)))return;
 boton.disabled=true;
 try {
  const {data,error}=await db.from('review_assignments')
   .select('id,estado,reviews(decision,criterios,comentarios_autor)').eq('manuscript_id',mid).order('fecha_asignacion');
  if(error)throw error;
  const {data:previos,error:errorPrevios}=await db.from('editorial_antecedents').select('id').eq('manuscript_id',mid).eq('tipo','dictamen');
  if(errorPrevios)throw errorPrevios;
  if(!(data||[]).some(a=>a.estado==='entregada'&&a.reviews?.length)&&!previos?.length)throw new Error('Aún no hay dictámenes registrados para compartir.');
  const {data:historial,error:errorHistorial}=await db.rpc('rcia_leer_resultados',{mid});
  if(errorHistorial)throw errorHistorial;
  document.getElementById('modal-resultados')?.remove();
  const fondo=document.createElement('div');fondo.id='modal-resultados';
  fondo.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
  fondo.innerHTML='<div role="dialog" aria-modal="true" aria-labelledby="titulo-resultados" style="background:white;padding:24px;border-radius:10px;max-width:850px;width:100%;max-height:90vh;overflow:auto;">'+
   '<h2 id="titulo-resultados">Compartir resultados · '+escaparHTML(m.folio)+'</h2><p>'+escaparHTML(m.titulo)+'</p>'+
   '<p>Revise el texto que recibirá el autor. Se excluyen automáticamente los campos privados, las identidades y los archivos adjuntos. Retire también cualquier nombre, firma o dato identificable escrito dentro de las observaciones.</p>'+
   (previos?.length?'<p><strong>Hay dictámenes adjuntos previos:</strong> consulte esos documentos en el expediente e incorpore aquí únicamente las observaciones anonimizadas. Los archivos no se adjuntan automáticamente.</p>':'')+
   (historial?.length?'<p>Ya existen resultados compartidos. Este envío añadirá una nueva comunicación; las anteriores se conservarán.</p>':'')+
   '<label for="texto-resultados">Texto que verá el autor</label><textarea id="texto-resultados" maxlength="60000" style="width:100%;height:40vh;box-sizing:border-box;font-size:16px;line-height:1.5;"></textarea>'+
   '<label style="display:block;margin:14px 0;"><input type="checkbox" id="confirmar-resultados"> He revisado que el texto no contiene nombres o correos de revisores, firmas ni comentarios confidenciales.</label>'+
   '<p id="estado-resultados" role="status"></p><button type="button" id="compartir-resultados">Compartir con el autor y generar aviso</button> <button type="button" class="secundario" id="cerrar-resultados">Cerrar</button></div>';
  document.body.appendChild(fondo);
  const campo=document.getElementById('texto-resultados');
  campo.value=borradorResultados(data||[]);
  campo.focus();
  const enviar=document.getElementById('compartir-resultados'),cerrar=document.getElementById('cerrar-resultados'),estado=document.getElementById('estado-resultados'),check=document.getElementById('confirmar-resultados');
  let solicitud=null,ultimoTexto=null,pendiente=false;
  campo.oninput=()=>{check.checked=false;};
  cerrar.onclick=()=>{if(!pendiente)fondo.remove();};
  enviar.onclick=async()=>{
   const contenido=campo.value.trim();
   if(pendiente)return;
   if(!check.checked||contenido.length<20){estado.textContent='Incluye los resultados y confirma la revisión del anonimato.';return;}
   if(!confirm('¿Compartir estos resultados con el autor de '+m.folio+'? Quedarán disponibles en su panel.'))return;
   pendiente=true;enviar.disabled=true;cerrar.disabled=true;campo.disabled=true;check.disabled=true;
   try {
    const {data:identidad,error:sesionError}=await db.auth.getUser();
    if(sesionError||identidad?.user?.id!==usuarioPanelActual)throw new Error('La cuenta activa cambió. Recarga el panel.');
    if(contenido!==ultimoTexto||!solicitud){solicitud=crypto.randomUUID();ultimoTexto=contenido;}
    const {data:resultado,error:fallo}=await db.rpc('rcia_compartir_resultados',{mid,solicitud,contenido,anonimizado:true});
    if(fallo)throw fallo;
    if(!resultado?.id)throw new Error('No se pudo confirmar el registro.');
    // El resultado ya se guardó: no ofrecer reenvío si falla la recarga posterior.
    fondo.remove();
    alert(resultado.aviso_generado?'Resultados disponibles para el autor. El aviso por correo quedó registrado; esto no confirma su recepción.':'Resultados disponibles para el autor. No hay un aviso de correo pendiente o aceptado: revise la configuración o el registro de correos antes de notificarlo por otro medio.');
    await cargarVistaEditor();
   }catch(error){estado.textContent='No se pudo completar la operación: '+error.message+' Si hubo un fallo de conexión, puedes reintentar con el mismo texto sin duplicar el envío.';}
   finally{pendiente=false;enviar.disabled=false;cerrar.disabled=false;campo.disabled=false;check.disabled=false;}
  };
 }catch(error){alert('No se pudieron preparar los resultados: '+error.message);}
 finally{boton.disabled=false;}
}
