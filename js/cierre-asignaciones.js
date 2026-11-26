const motivosCierreAsignacion = {
  sustitucion: 'Sustitución de revisor',
  sin_respuesta: 'Falta de respuesta',
  retiro_editorial: 'Retiro por decisión editorial'
};
const contextoCierres = new Map();

function etiquetaEstadoAsignacion(estado) {
  return {pendiente:'Pendiente de dictamen',aceptada:'Asignación aceptada',entregada:'Evaluación registrada',
    declinada:'Asignación declinada',cerrada:'Asignación cerrada por el equipo editorial'}[estado] || estado;
}

async function cargarCierresAsignaciones(m,asignaciones,revisores) {
  const autorizado=rolPanelActual==='editor'||(rolPanelActual==='editor_area'&&m.editor_area_asignado_id===usuarioPanelActual);
  if(!autorizado)return {disponible:false,registros:new Map()};
  const {data,error}=await db.rpc('rcia_cierres_del_manuscrito',{mid:m.id});
  if(error)return {disponible:false,registros:new Map()};
  for(const a of asignaciones)contextoCierres.set(a.id,{asignacion:a,manuscrito:m,asignaciones,revisores});
  return {disponible:true,registros:new Map((data||[]).map(c=>[c.assignment_id,c]))};
}

function renderCierreAsignacion(a,m,cierres) {
  const c=cierres.registros.get(a.id);
  if(c)return '<div style="margin:8px 0 16px;padding:12px;border-left:3px solid #64748b;">'+
    '<strong>'+(c.motivo==='sustitucion'?'Asignación cerrada por sustitución':escaparHTML(motivosCierreAsignacion[c.motivo]||c.motivo))+'</strong>'+
    '<p style="white-space:pre-wrap;">'+escaparHTML(c.observaciones)+'</p>'+
    (c.nombre_sustituto?'<p>Sustituida por: '+escaparHTML(c.nombre_sustituto)+'.</p>':'')+
    '<p>Cerrada por '+escaparHTML(c.cerrado_por)+' el '+escaparHTML(formatoFecha(c.cerrado_en))+'. Se conserva el historial.</p></div>';
  if(!['pendiente','aceptada'].includes(a.estado)||['aceptado','publicado','rechazado','desistido'].includes(m.estado))return '';
  if(!cierres.disponible)return '';
  return ' <button type="button" class="secundario" onclick="abrirCierreAsignacion(\''+a.id+'\')">Cerrar asignación</button>';
}

function abrirCierreAsignacion(aid) {
  const ctx=contextoCierres.get(aid);if(!ctx)return;
  const {asignacion:a,manuscrito:m,asignaciones,revisores}=ctx;
  if(!['pendiente','aceptada'].includes(a.estado))return;
  if(!(rolPanelActual==='editor'||(rolPanelActual==='editor_area'&&m.editor_area_asignado_id===usuarioPanelActual)))return;
  const nombre=id=>revisores.find(r=>r.id===id)?.nombre_completo||'Revisor registrado';
  const opciones=asignaciones.filter(b=>b.id!==aid&&['pendiente','aceptada','entregada'].includes(b.estado));
  const dialog=document.createElement('dialog');dialog.style.cssText='width:min(680px,94vw);max-height:90vh;overflow:auto;border:1px solid #64748b;border-radius:8px;';
  dialog.innerHTML='<h2>Cerrar asignación</h2><p><strong>'+escaparHTML(m.folio)+' · '+escaparHTML(nombre(a.reviewer_id))+'</strong></p>'+
    '<p>El cierre retira esta asignación de los pendientes y conserva su historial. No registra una declinación ni un dictamen del revisor.</p>'+
    '<label for="motivo-cierre">Motivo</label><select id="motivo-cierre">'+Object.entries(motivosCierreAsignacion).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select>'+
    '<div data-campo-sustituto><label for="sustituta-cierre">Revisor que la sustituye (ya asignado a este manuscrito)</label><select id="sustituta-cierre"><option value="">Seleccionar</option>'+opciones.map(b=>'<option value="'+b.id+'">'+escaparHTML(nombre(b.reviewer_id))+' — '+escaparHTML(etiquetaEstadoAsignacion(b.estado))+'</option>').join('')+'</select></div>'+
    '<label for="nota-cierre">Observaciones editoriales (10 a 2000 caracteres)</label><textarea id="nota-cierre" rows="4" minlength="10" maxlength="2000" placeholder="Describe el motivo del cierre y, si corresponde, la sustitución."></textarea>'+
    '<p>Estas observaciones solo serán visibles para el equipo editorial autorizado. El revisor verá que su asignación está cerrada, sin la identidad de otros revisores.</p>'+
    '<label><input type="checkbox" id="confirmar-cierre"> Confirmo el cierre de esta asignación sin dictamen. No se podrá reabrir desde el panel.</label>'+
    '<p data-error role="alert"></p><button type="button" data-guardar>Confirmar cierre</button> <button type="button" class="secundario" data-cancelar>Cancelar</button>';
  const motivo=dialog.querySelector('#motivo-cierre'),sustituta=dialog.querySelector('#sustituta-cierre'),nota=dialog.querySelector('#nota-cierre');
  const guardar=dialog.querySelector('[data-guardar]'),cancelar=dialog.querySelector('[data-cancelar]'),aviso=dialog.querySelector('[data-error]');
  let guardando=false;
  motivo.onchange=()=>{dialog.querySelector('[data-campo-sustituto]').hidden=motivo.value!=='sustitucion';};
  cancelar.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',e=>{if(guardando)e.preventDefault();});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  guardar.onclick=async()=>{
    if(guardando)return;
    const texto=nota.value.trim();
    if(!dialog.querySelector('#confirmar-cierre').checked||texto.length<10||texto.length>2000||(motivo.value==='sustitucion'&&!sustituta.value)){
      aviso.textContent='Selecciona el sustituto si corresponde, escribe las observaciones y confirma el cierre.';return;
    }
    guardando=true;guardar.disabled=true;cancelar.disabled=true;aviso.textContent='Registrando cierre…';
    try {
      const {data:identidad,error:sesionError}=await db.auth.getUser();
      if(sesionError||identidad?.user?.id!==usuarioPanelActual)throw new Error('La cuenta activa cambió. Recarga el panel.');
      const {data,error}=await db.rpc('rcia_cerrar_asignacion',{aid,motivo_cierre:motivo.value,nota:texto,sustituta:motivo.value==='sustitucion'?sustituta.value:null});
      if(error)throw error;
      if(!data?.cerrada)throw new Error('No se pudo confirmar el cierre.');
      dialog.close();await cargarVistaEditor();
      alert('Asignación cerrada y retirada de los pendientes. Se conserva el historial. Si los dictámenes requeridos están completos, el expediente puede pasar a «Dictamen emitido»; la decisión editorial sigue a cargo del editor.');
    }catch(error){aviso.textContent='No se pudo confirmar el cierre: '+error.message+' Si hubo un corte de conexión, recarga el panel antes de repetir.';}
    finally{guardando=false;guardar.disabled=false;cancelar.disabled=false;}
  };
  document.body.append(dialog);dialog.showModal();
}
