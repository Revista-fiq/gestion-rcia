// Piloto de constancias: los PDF se preparan fuera del portal y se validan aquí.
// No usa URLs públicas, no envía correos ni marca envíos manuales.
const constanciasPanel = new Map();
const constanciasOcupadas = new Set();
const BUCKET_CONSTANCIAS = 'constancias-revision';

async function consultarSeguimientoConstancias(mid) {
  const args = mid ? {mid} : {};
  const resultado = await db.rpc('rcia_seguimiento_constancias', args);
  // Compatibilidad mientras se activa el nuevo script en Supabase.
  if (resultado.error && ['PGRST202','42883'].includes(resultado.error.code)) {
    return db.rpc('rcia_listar_constancias', args);
  }
  return resultado;
}

function estadoSeguimientoConstancia(c) {
  if (!c.seguimiento_activo) return '<p>Seguimiento de avisos y descargas pendiente de activar.</p>';
  const aviso = c.aviso_enviado
    ? 'Aviso enviado el ' + escaparHTML(c.aviso_enviado) + '.'
    : 'Aviso sin registrar.' + (rolPanelActual === 'editor'
      ? ' <button type="button" class="secundario" onclick="registrarAvisoConstancia(\''+c.assignment_id+'\',this)">Registrar aviso enviado</button>' : '');
  const descarga = c.primera_descarga
    ? 'Descarga registrada el ' + escaparHTML(formatoFecha(c.primera_descarga)) + '.'
    : 'Sin descargas registradas desde la activación del seguimiento.';
  return '<p>'+aviso+'</p><p>'+descarga+'</p>';
}

async function registrarAvisoConstancia(aid,boton) {
  const c=constanciasPanel.get(aid);
  if(rolPanelActual!=='editor'||!c?.validado_en||boton.disabled)return;
  const fecha=prompt('Fecha en que enviaste el aviso de disponibilidad (AAAA-MM-DD):','');
  if(fecha===null)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)){alert('Escribe la fecha como AAAA-MM-DD.');return;}
  if(!confirm('¿Confirmas que ya enviaste a '+c.revisor+' el aviso para '+c.folio+' el '+fecha+'? Este botón solo registra el aviso; no envía correo.'))return;
  boton.disabled=true;
  try {
    await identidadConstancias();
    const {error}=await db.rpc('rcia_registrar_aviso_constancia',{cid:c.id,fecha});
    if(error)throw error;
    await cargarVistaEditor();
  }catch(error){alert('No se pudo confirmar el registro del aviso: '+error.message);}
  finally{boton.disabled=false;}
}

async function identidadConstancias() {
  const {data,error}=await db.auth.getUser();
  if(error || data?.user?.id!==usuarioPanelActual) throw new Error('La cuenta activa cambió. Recarga el panel.');
  return data.user;
}

async function renderConstanciasDescarga(m) {
  if(rolPanelActual!=='editor' && !(rolPanelActual==='editor_area' && m.editor_area_asignado_id===usuarioPanelActual))return '';
  const {data,error}=await consultarSeguimientoConstancias(m.id);
  if(error)return '<p>La descarga de constancias aún no está disponible. El editor en jefe debe comprobar la activación de schema_constancias_descarga.sql.</p>';
  if(!data?.length)return '';
  return '<section style="margin:18px 0;padding:18px;border:2px solid #164d70;border-radius:8px;"><h3>Constancias para descargar</h3><p>Primera ronda. Cada PDF queda privado hasta que el editor en jefe lo revise y valide. El aviso por correo se envía manualmente. La descarga registrada indica que el portal entregó el PDF al navegador del revisor; no confirma que lo haya abierto o guardado.</p>'+
    data.map(c=>{
      constanciasPanel.set(c.assignment_id,{...c,mid:m.id});
      const aid=c.assignment_id;
      const nombre=escaparHTML(c.revisor);
      let control='';
      if(c.validado_en) {
        control='<p><strong>Disponible para el revisor</strong> · Validada por '+escaparHTML(c.validado_por||'Editor en jefe')+' el '+escaparHTML(formatoFecha(c.validado_en))+'.</p>'+
          estadoSeguimientoConstancia(c)+'<button type="button" class="secundario" onclick="descargarConstancia(\''+aid+'\',this)">Descargar PDF</button>';
      } else if(rolPanelActual==='editor') {
        control=(c.id?'<p><strong>Borrador cargado; todavía no disponible para el revisor.</strong></p><button type="button" onclick="revisarConstancia(\''+aid+'\',this)">Revisar y validar constancia</button>':'<p>Pendiente de cargar PDF y validar.</p>')+
          '<details style="margin-top:12px;"><summary>'+(c.id?'Sustituir borrador PDF':'Cargar constancia PDF')+'</summary><p>Selecciona la constancia de <strong>'+nombre+'</strong>, correspondiente a <strong>'+escaparHTML(c.folio)+'</strong>. Máximo 10 MB.</p>'+
          '<label for="pdf-constancia-'+aid+'">Constancia firmada en PDF</label><input type="file" id="pdf-constancia-'+aid+'" accept="application/pdf,.pdf">'+
          '<button type="button" class="secundario" onclick="prepararConstancia(\''+aid+'\',this)">Guardar borrador privado</button></details>';
      } else control='<p>Pendiente de validación por el editor en jefe.</p>';
      return '<div style="padding:16px 0;border-top:1px solid #cbd5e1;"><strong>'+nombre+'</strong> · '+escaparHTML(c.correo||'')+'<br>'+escaparHTML(c.folio)+' · Primera ronda'+control+'</div>';
    }).join('')+'</section>';
}

async function cargarMisConstancias() {
  const cont=document.getElementById('mis-constancias');
  if(!cont)return;
  const {data,error}=await consultarSeguimientoConstancias();
  if(error){cont.textContent='No se pudo consultar la disponibilidad de constancias. Contacta a la revista si el problema persiste.';return;}
  if(!data?.length){cont.textContent='Aquí podrás descargar tus constancias después de la validación del editor en jefe.';return;}
  cont.innerHTML=data.map(c=>{
    constanciasPanel.set(c.assignment_id,c);
    return '<div class="tarjeta"><strong>'+escaparHTML(c.folio)+' · Primera ronda</strong><p>'+escaparHTML(c.titulo)+'</p><p>Constancia de '+escaparHTML(c.revisor)+'</p><button type="button" onclick="descargarConstancia(\''+c.assignment_id+'\',this)">Descargar constancia PDF</button></div>';
  }).join('');
}

async function huellaPDF(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function prepararConstancia(aid,boton) {
  if(rolPanelActual!=='editor'||constanciasOcupadas.has(aid))return;
  const c=constanciasPanel.get(aid),file=document.getElementById('pdf-constancia-'+aid)?.files[0];
  if(!c||!file){alert('Selecciona el PDF de esta constancia.');return;}
  if(!file.name.toLowerCase().endsWith('.pdf')||file.size>10485760||file.size<5){alert('Selecciona un PDF de hasta 10 MB.');return;}
  if(await file.slice(0,5).text()!=='%PDF-'){alert('El archivo no tiene una cabecera PDF válida.');return;}
  if(!confirm('¿Cargar este PDF para '+c.revisor+' — '+c.folio+'? Aún no será visible para el revisor.'))return;
  constanciasOcupadas.add(aid);boton.disabled=true;
  try {
    await identidadConstancias();
    const ruta=aid+'/'+crypto.randomUUID()+'.pdf',huella=await huellaPDF(file);
    const {error:upload}=await db.storage.from(BUCKET_CONSTANCIAS).upload(ruta,file,{contentType:'application/pdf',upsert:false,cacheControl:'0'});
    if(upload)throw upload;
    const {error}=await db.rpc('rcia_preparar_constancia',{aid,ruta_archivo:ruta,huella});
    if(error)throw error;
    await cargarVistaEditor();
    alert('Borrador guardado. Usa «Revisar y validar constancia» para habilitar la descarga.');
  } catch(error){alert('No se pudo confirmar la carga: '+error.message+' Recarga el panel para comprobar si se guardó antes de reintentar.');}
  finally{boton.disabled=false;constanciasOcupadas.delete(aid);}
}

async function obtenerPDFConstancia(c) {
  await identidadConstancias();
  const {data,error}=await db.storage.from(BUCKET_CONSTANCIAS).download(c.ruta);
  if(error)throw error;
  if(c.sha256 && await huellaPDF(data)!==c.sha256)throw new Error('El PDF no coincide con el borrador registrado. No se puede validar.');
  return data;
}
async function descargarConstancia(aid,boton) {
  const c=constanciasPanel.get(aid);if(!c?.ruta||boton.disabled)return;
  boton.disabled=true;
  try {
    const blob=await obtenerPDFConstancia(c),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;
    a.download='Constancia_'+c.folio+'_'+c.revisor.replace(/[^\p{L}\p{N}]+/gu,'_')+'.pdf';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    if(rolPanelActual==='revisor' && c.seguimiento_activo) {
      try {
        const {error:registro}=await db.rpc('rcia_registrar_descarga_constancia',{cid:c.id,peticion:crypto.randomUUID()});
        if(registro)throw registro;
      } catch(error) {
        alert('Se inició la descarga del PDF, pero no se pudo registrar en el seguimiento. No necesitas volver a descargarlo si ya lo tienes.');
      }
    }
  }catch(error){alert('No se pudo descargar la constancia: '+error.message);}
  finally{boton.disabled=false;}
}

async function revisarConstancia(aid,boton) {
  const c=constanciasPanel.get(aid);if(rolPanelActual!=='editor'||!c?.ruta||boton.disabled)return;
  boton.disabled=true;
  try {
    const blob=await obtenerPDFConstancia(c),url=URL.createObjectURL(blob);
    const dialog=document.createElement('dialog');dialog.style.cssText='width:min(900px,94vw);max-height:92vh;overflow:auto;border:1px solid #164d70;border-radius:8px;';
    dialog.innerHTML='<h2>Validar constancia</h2><p><strong>'+escaparHTML(c.revisor)+' · '+escaparHTML(c.folio)+'</strong><br>Primera ronda</p>'+
      '<iframe title="Vista previa de la constancia" style="width:100%;height:46vh;border:1px solid #cbd5e1;"></iframe>'+
      '<p><a target="_blank" rel="noopener">Abrir PDF para revisarlo</a></p>'+
      '<label><input type="checkbox" data-confirmar> He revisado el PDF: nombre, manuscrito, fecha, primera ronda y firma son correctos.</label>'+
      '<label for="clave-validar-constancia">Confirma tu contraseña de editor en jefe</label><input id="clave-validar-constancia" type="password" autocomplete="current-password">'+
      '<p>Al validar, el revisor podrá descargarlo. No se enviará correo ni se marcará un envío manual.</p><p data-error role="alert"></p>'+
      '<button type="button" data-validar>Validar y publicar constancia</button> <button type="button" class="secundario" data-cerrar>Cancelar</button>';
    dialog.querySelector('iframe').src=url;dialog.querySelector('a').href=url;
    const cerrar=dialog.querySelector('[data-cerrar]'),validar=dialog.querySelector('[data-validar]'),clave=dialog.querySelector('input[type=password]'),aviso=dialog.querySelector('[data-error]');
    let enviando=false;
    dialog.addEventListener('cancel',e=>{if(enviando)e.preventDefault();});
    dialog.addEventListener('close',()=>{clave.value='';URL.revokeObjectURL(url);dialog.remove();},{once:true});
    cerrar.onclick=()=>dialog.close();
    validar.onclick=async()=>{
      if(enviando)return;
      if(!dialog.querySelector('[data-confirmar]').checked||!clave.value){aviso.textContent='Revisa el PDF, marca la confirmación e introduce tu contraseña.';return;}
      enviando=true;validar.disabled=true;cerrar.disabled=true;aviso.textContent='Validando…';
      try {
        const user=await identidadConstancias();
        const password=clave.value;clave.value='';
        const {data:login,error:loginError}=await db.auth.signInWithPassword({email:user.email,password});
        if(loginError||login.user?.id!==usuarioPanelActual)throw new Error('No se pudo confirmar tu contraseña.');
        const {error}=await db.rpc('rcia_validar_constancia',{aid,ruta_esperada:c.ruta,huella_esperada:c.sha256});
        if(error)throw error;
        dialog.close();await cargarVistaEditor();
        alert('Constancia disponible en el panel del revisor. Ya puedes enviarle tu aviso por correo.');
      }catch(error){aviso.textContent='No se pudo confirmar la publicación: '+error.message+' Si hubo un corte de conexión, cierra esta ventana y recarga para comprobar el estado.';}
      finally{enviando=false;validar.disabled=false;cerrar.disabled=false;}
    };
    document.body.append(dialog);dialog.showModal();
  }catch(error){alert('No se pudo abrir la constancia: '+error.message);}
  finally{boton.disabled=false;}
}
