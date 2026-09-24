// =====================================================================
// Ficha de evaluación de manuscrito
// Adaptada de la ficha original del Comité de Revisores RCIA-UADY:
// mismos 8 criterios, filtros éticos, y umbrales de decisión —
// ahora guardando en Supabase (tabla `reviews`) en vez de un Sheet.
// =====================================================================

const CRITERIOS = [
  { id: 'c1', num: 1, titulo: 'Título y Resumen (Abstract)', desc: '¿Es específico? ¿El abstract estructura: Objetivo, Métodos, Resultados y Conclusiones?' },
  { id: 'c2', num: 2, titulo: 'Relevancia y Aplicabilidad', desc: '¿Ofrece una solución práctica o avance tecnológico? ¿Es pertinente para la revista?' },
  { id: 'c3', num: 3, titulo: 'Fundamentación Teórica', desc: 'Bibliografía actual (menos de 5 años en su mayoría) y relevante para el campo.' },
  { id: 'c4', num: 4, titulo: 'Metodología y Reproducibilidad', desc: 'Detalle suficiente para replicar el experimento/simulación. Diseño estadístico correcto.' },
  { id: 'c5', num: 5, titulo: 'Resultados y Elementos Gráficos', desc: 'Calidad de figuras/tablas. Los datos justifican lo descrito en el texto.' },
  { id: 'c6', num: 6, titulo: 'Discusión e Interpretación', desc: 'Interpretación de mecanismos (el porqué), contraste con literatura y limitaciones.' },
  { id: 'c7', num: 7, titulo: 'Conclusiones', desc: 'Responden a objetivos, sustentadas estrictamente por los datos (sin especulación).' },
  { id: 'c8', num: 8, titulo: 'Redacción y Estructura', desc: 'Claridad, coherencia, ortografía y cumplimiento del formato de la revista.' },
];

// Folio de la asignación a evaluar, tomado de la URL (evaluacion.html?a=<id>)
const params = new URLSearchParams(window.location.search);
const assignmentId = params.get('a');

let asignacionActual = null;
let manuscritoActual = null;

async function iniciar() {
  if (!assignmentId) {
    document.getElementById('infoFolio').textContent = 'No se especificó ningún manuscrito para evaluar.';
    return;
  }

  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  const { data: lista, error } = await db.rpc('rcia_mis_asignaciones');
  const asignacion = lista?.find(a => a.id === assignmentId);

  if (error || !asignacion || !asignacion.manuscripts_blind) {
    document.getElementById('infoFolio').textContent = 'No se pudo cargar este manuscrito (puede que no tengas acceso).';
    return;
  }

  asignacionActual = asignacion;
  manuscritoActual = asignacion.manuscripts_blind;

  document.getElementById('infoFolio').textContent = `${manuscritoActual.folio} — ${manuscritoActual.titulo}`;
  document.getElementById('infoResumen').textContent = manuscritoActual.resumen || '—';

  if (asignacion.estado === 'declinada' || !manuscritoActual.archivo_manuscrito_url) {
    document.getElementById('infoResumen').textContent = 'Esta asignación no está disponible para evaluación.';
    return;
  }
  const enlace = document.getElementById('archivoAnonimo');
  enlace.href = manuscritoActual.archivo_manuscrito_url;
  enlace.hidden = false;

  if (asignacion.estado === 'entregada') {
    document.getElementById('fichaContenido').innerHTML =
      '<div class="aviso" style="background:var(--green-bg); color:var(--green); border:1px solid #bcd9c8; padding:16px; border-radius:2px;">Ya enviaste tu evaluación para este manuscrito. Gracias por tu colaboración.</div>';
    document.getElementById('fichaContenido').style.display = 'block';
    return;
  }

  renderCriterios();
  document.getElementById('necesitaSegundaRevision').addEventListener('change', () => {
    const no = document.getElementById('necesitaSegundaRevision').value === 'No';
    const dispuesto = document.getElementById('dispuestoSegundaRevision');
    dispuesto.disabled = no;
    if (no) dispuesto.value = 'No aplica';
    else if (dispuesto.value === 'No aplica') dispuesto.value = '';
  });
  document.getElementById('fichaContenido').style.display = 'block';
}

function renderCriterios() {
  const contenedor = document.getElementById('criterios');
  CRITERIOS.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'criterio';
    div.id = 'criterio-' + c.id;
    div.innerHTML = `
      <div class="criterio-head">
        <div>
          <p class="criterio-titulo">${c.num}. ${c.titulo}</p>
          <span class="criterio-desc">${c.desc}</span>
        </div>
        <select class="calc" id="${c.id}" data-num="${c.num}">
          <option value="0">Seleccionar…</option>
          <option value="1">1 · Deficiente</option>
          <option value="2">2 · Regular</option>
          <option value="3">3 · Bueno</option>
          <option value="4">4 · Excelente</option>
        </select>
      </div>
      <textarea id="comentario${c.num}" placeholder="Comentarios para el autor sobre este criterio…"></textarea>
    `;
    contenedor.appendChild(div);
  });

  document.querySelectorAll('.calc').forEach((sel) => {
    sel.addEventListener('change', () => {
      document.getElementById('criterio-' + sel.id).classList.toggle('answered', sel.value !== '0');
    });
  });
}

function recomendacion(total) {
  if (total >= 28) return { decision: 'aceptar', etiqueta: 'ACEPTAR', clase: 'aceptar', mensaje: 'El manuscrito es excelente. Pasar a corrección de estilo.' };
  if (total >= 20) return { decision: 'revision_menor', etiqueta: 'ACEPTAR CON REVISIONES MENORES', clase: 'revision-menor', mensaje: 'Requiere ajustes puntuales indicados en los comentarios.' };
  if (total >= 14) return { decision: 'revision_mayor', etiqueta: 'REVISIONES MAYORES (RECONSIDERAR)', clase: 'revision-mayor', mensaje: 'El trabajo tiene mérito pero requiere cambios sustanciales o reanálisis.' };
  return { decision: 'rechazar', etiqueta: 'RECHAZAR', clase: 'rechazo', mensaje: 'No cumple con los estándares de calidad o alcance de la revista.' };
}

document.getElementById('btnEnviar')?.addEventListener('click', async () => {
  if (!asignacionActual || !['pendiente', 'aceptada'].includes(asignacionActual.estado) || document.getElementById('btnEnviar').disabled) return;
  const resultadoDiv = document.getElementById('resultado');
  const estado = document.getElementById('estadoEnvio');
  estado.textContent = '';
  estado.className = '';

  const etica = document.getElementById('etica').checked;
  const plagio = document.getElementById('plagio').checked;
  const interes = document.getElementById('interes').checked;
  const necesitaSegundaRevision = document.getElementById('necesitaSegundaRevision').value;
  const dispuestoSegundaRevision = document.getElementById('dispuestoSegundaRevision').value;

  // Filtro ético: rechazo inmediato, sin exigir los 8 criterios
  if (!etica || !plagio || !interes) {
    resultadoDiv.style.display = 'block';
    resultadoDiv.className = 'rechazo';
    resultadoDiv.innerHTML = '<div class="decision">⛔ Rechazo inmediato</div><div class="msg">El manuscrito incumple criterios éticos o de originalidad obligatorios.</div>';
    await enviar({
      filtro_etica: etica, filtro_plagio: plagio, filtro_interes: interes,
      criterios: null, puntaje_total: 0, decision: 'rechazar',
      necesita_segunda_revision: necesitaSegundaRevision || null,
      dispuesto_segunda_revision: dispuestoSegundaRevision || null,
    });
    return;
  }

  let total = 0, incompleto = false;
  const detalleCriterios = [];
  CRITERIOS.forEach((c) => {
    const val = parseInt(document.getElementById(c.id).value, 10);
    if (val === 0 || isNaN(val)) incompleto = true;
    total += val || 0;
    detalleCriterios.push({
      num: c.num,
      titulo: c.titulo,
      puntaje: val || 0,
      comentario: document.getElementById('comentario' + c.num).value.trim()
    });
  });

  if (incompleto) { alert('Asigna una calificación a los 8 criterios antes de enviar.'); return; }
  if (!necesitaSegundaRevision) { alert('Indica si el artículo necesitaría una segunda revisión.'); return; }
  if (!dispuestoSegundaRevision || (necesitaSegundaRevision === 'Sí' && dispuestoSegundaRevision === 'No aplica')) { alert('Indica si estarías dispuesto a realizar la segunda revisión.'); return; }

  const { decision, etiqueta, clase, mensaje } = recomendacion(total);
  resultadoDiv.style.display = 'block';
  resultadoDiv.className = clase;
  resultadoDiv.innerHTML = `<div class="puntaje">Puntaje total: ${total} / 32</div><div class="decision">${etiqueta}</div><div class="msg">${mensaje}</div>`;
  resultadoDiv.scrollIntoView({ behavior: 'smooth' });

  await enviar({
    filtro_etica: etica, filtro_plagio: plagio, filtro_interes: interes,
    criterios: detalleCriterios, puntaje_total: total, decision,
    necesita_segunda_revision: necesitaSegundaRevision,
    dispuesto_segunda_revision: dispuestoSegundaRevision,
  });
});

async function enviar(datos) {
  const boton = document.getElementById('btnEnviar');
  const estado = document.getElementById('estadoEnvio');
  boton.disabled = true;

  const comentarioConfidencial = document.getElementById('comentarioConfidencial').value.trim();

  try {
  const { error } = await db.from('reviews').insert({
    assignment_id: assignmentId,
    decision: datos.decision,
    comentarios_editor: comentarioConfidencial || null,
    filtro_etica: datos.filtro_etica,
    filtro_plagio: datos.filtro_plagio,
    filtro_interes: datos.filtro_interes,
    criterios: datos.criterios,
    puntaje_total: datos.puntaje_total,
    necesita_segunda_revision: datos.necesita_segunda_revision,
    dispuesto_segunda_revision: datos.dispuesto_segunda_revision,
  });

  if (error) {
    estado.textContent = 'Error al guardar: ' + error.message;
    estado.className = 'error';
    boton.disabled = false;
    return;
  }

  asignacionActual.estado = 'entregada';
  document.querySelectorAll('#fichaContenido input, #fichaContenido select, #fichaContenido textarea').forEach(el => el.disabled = true);

  estado.textContent = '✓ Evaluación enviada y guardada. Puedes volver al panel.';
  estado.className = 'ok';
  } catch (err) {
    estado.textContent = 'No se pudo confirmar el envío. Recarga el panel para comprobar si se guardó antes de reintentar.';
    estado.className = 'error';
    boton.disabled = false;
  }
}

iniciar().catch(() => { document.getElementById('infoFolio').textContent = 'No se pudo cargar la evaluación. Vuelve al panel e inténtalo de nuevo.'; });
