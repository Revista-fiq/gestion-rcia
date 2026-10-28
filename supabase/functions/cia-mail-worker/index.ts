// @ts-nocheck
// Reemplazar index.ts de la función de correo EXISTENTE; conservar su nombre,
// Secrets, programación y autenticación. No se incluyen valores secretos.
class MailError extends Error {
  constructor(code, kind='failed', retryAfter=60) {super(code);this.code=code;this.kind=kind;this.retryAfter=retryAfter;}
}
const env = name => {const v=globalThis.Deno?.env.get(name);if(!v)throw new MailError('missing_'+name);return v;};
const emailValid = value => typeof value==='string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value) && value.length<255;
function createGraphSender(get=env, request=fetch, timing={tokenTimeout:3000,sendTimeout:5000}) {
  let cached=null;
  return async function sendMail(to, subject, text, cc=[]) {
    const mode=get('RCIA_MAIL_MODE');
    if(!['test','live'].includes(mode))throw new MailError('mail_disabled');
    if(!emailValid(to))throw new MailError('invalid_recipient');
    if(!Array.isArray(cc) || cc.length>1 || cc.some(email=>!emailValid(email)))throw new MailError('invalid_cc');
    const copies=cc.filter(email=>email.toLowerCase()!==to.toLowerCase());
    // La restricción de pruebas también cubre CC; no puede enviar copias reales.
    if(mode==='test' && [to,...copies].some(email=>email.toLowerCase()!==get('RCIA_TEST_RECIPIENT').toLowerCase()))throw new MailError('test_recipient_only');
    if(typeof subject!=='string' || /[\r\n]/.test(subject)||subject.length>255)throw new MailError('invalid_subject');
    const sender='revista.fiq@correo.uady.mx';
    const tenant=get('MS_GRAPH_TENANT_ID'),client=get('MS_GRAPH_CLIENT_ID');
    if(!/^[\da-f-]{36}$/i.test(tenant)||!/^[\da-f-]{36}$/i.test(client))throw new MailError('invalid_app_ids');
    if(!cached || cached.until<Date.now()) {
      let r;
      try { r=await request(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:client,client_secret:get('MS_GRAPH_CLIENT_SECRET'),scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),
        signal:AbortSignal.timeout(timing.tokenTimeout)
      });}catch {throw new MailError('token_unavailable','pending');}
      if(!r.ok)throw new MailError('token_http_'+r.status,r.status===429||r.status>=500?'pending':'failed');
      const token=await r.json();
      if(!token.access_token || !Number.isFinite(Number(token.expires_in)))throw new MailError('invalid_token_response');
      cached={token:token.access_token,until:Date.now()+Math.max(0,Number(token.expires_in)-120)*1000};
    }
    const message={subject,body:{contentType:'Text',content:text},toRecipients:[{emailAddress:{address:to}}]};
    if(copies.length)message.ccRecipients=copies.map(address=>({emailAddress:{address}}));
    let result;
    try { result=await request(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,{
      method:'POST',headers:{Authorization:`Bearer ${cached.token}`,'Content-Type':'application/json'},
      body:JSON.stringify({message,saveToSentItems:true}),signal:AbortSignal.timeout(timing.sendTimeout)
    });}catch {throw new MailError('send_outcome_unknown','uncertain');}
    if(result.status===202)return {status:'accepted'}; // No equivale a entrega confirmada.
    if(result.status===401)cached=null;
    if(result.status===429) {
      const h=result.headers.get('retry-after');const n=Number(h);
      const wait=Number.isFinite(n)&&n>0?n:Math.ceil((Date.parse(h)-Date.now())/1000);
      throw new MailError('graph_throttled','pending',Number.isFinite(wait)?Math.min(86400,Math.max(60,wait)):60);
    }
    if(result.status>=500)throw new MailError('graph_outcome_unknown','uncertain');
    throw new MailError('graph_http_'+result.status);
  };
}
const sendGraph=createGraphSender();
async function workerAuthorized(req,get=env) {
  let expected;try{expected=get('RCIA_MAIL_WORKER_SECRET');}catch{return false;}
  if(expected.length<32)return false;
  const actual=req.headers.get('x-rcia-worker-secret')||'';
  const bytes=new TextEncoder();
  const [a,b]=await Promise.all([actual,expected].map(v=>crypto.subtle.digest('SHA-256',bytes.encode(v))));
  let difference=0;const aa=new Uint8Array(a),bb=new Uint8Array(b);for(let i=0;i<aa.length;i++)difference|=aa[i]^bb[i];
  return difference===0;
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function rpc(name,args) {
  const key=env('SUPABASE_SERVICE_ROLE_KEY');
  const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new MailError('database_http_'+r.status);
  const t=await r.text();return t?JSON.parse(t):null;
}
const PORTAL='https://revista-fiq.github.io/gestion-rcia/';
function editorialMessage(p) {
 const notices={
  author_receipt:['Envío registrado','Confirmamos la recepción de su manuscrito en el sistema de gestión editorial. El equipo revisará el envío y dará seguimiento al proceso. Este acuse no constituye una aceptación para publicación.'],
  new_submission:['Nuevo manuscrito','Se ha recibido un nuevo manuscrito. Le solicitamos ingresar al panel editorial para revisar la documentación y coordinar su atención.'],
  area_assignment:['Seguimiento editorial','Agradeceremos contar con su apoyo para coordinar la evaluación del manuscrito indicado. En su panel podrá revisar la documentación, verificar la versión anonimizada y asignar revisores. Si no le es posible atenderlo o identifica un conflicto de interés, le agradeceremos comunicárnoslo respondiendo a este correo.'],
  review_assignment:['Invitación a evaluar un manuscrito','Nos gustaría contar con su colaboración para evaluar el manuscrito indicado, considerando su experiencia en el área. Puede consultar la versión anonimizada y confirmar su disponibilidad mediante Aceptar invitación o Declinar invitación en su panel. Si requiere acordar un plazo, puede responder a este correo.'],
  review_response:['Respuesta a invitación de revisión',p.event_state==='aceptada' ? 'El revisor aceptó la invitación. Consulte la asignación en su panel editorial.' : 'El revisor declinó la invitación. Consulte el motivo, si lo indicó, y asigne otro revisor desde su panel editorial.'],
  review_received:['Evaluación registrada','Se ha incorporado una evaluación al expediente del manuscrito indicado. Le solicitamos consultar el dictamen en el panel editorial y dar seguimiento a la decisión correspondiente.'],
  review_receipt:['Acuse de recepción de su evaluación','Confirmamos que su dictamen quedó guardado correctamente en el sistema de gestión editorial. Agradecemos su colaboración como revisor. No necesita volver a enviarlo ni solicitar confirmación de recepción. Este mensaje es un acuse de recepción; no es una constancia de participación ni una decisión de aceptación del artículo.'],
  decision:['Actualización de su envío','Se ha actualizado el estado de su manuscrito. Consulte el seguimiento en el portal y las indicaciones del equipo editorial.']
 };
 if(!notices[p.event_type])throw new Error('unknown_event');
 const [subject,notice]=notices[p.event_type];
 const states={en_correccion:'Correcciones solicitadas',aceptado:'Aceptado',rechazado:'Rechazado',publicado:'Publicado',desistido:'Desistido'};
 let receiptDate='';
 if(p.event_type==='review_receipt' && p.fecha_entrega){
  const date=new Date(p.fecha_entrega);
  if(!Number.isNaN(date.getTime()))receiptDate='Fecha de registro: '+new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'long',timeStyle:'short'}).format(date)+' (hora del centro de México)';
 }
 return {subject:`RCIA-UADY · ${p.folio} · ${subject}`,text:['REVISTA DE CIENCIA E INGENIERÍA APLICADA DE LA UADY','RCIA-UADY · Facultad de Ingeniería Química','Universidad Autónoma de Yucatán','',`Asunto: ${subject}`,'',notice,'',`Folio: ${p.folio}`,`Título: ${p.titulo}`,
 p.event_type==='decision'?`Estado: ${states[p.event_state]||p.event_state}`:'',
 receiptDate,p.event_type==='review_receipt' && p.review_id?`Identificador del dictamen: ${p.review_id}`:'',
 p.event_type==='review_receipt' && p.cc_email?'Copia al editor de área asignado para su seguimiento.':'',
 '',`Portal: ${PORTAL}`,'','Este mensaje no contiene dictámenes ni archivos confidenciales.',
 'Agradecemos su colaboración.','', 'Atentamente,','Coordinación editorial','Revista de Ciencia e Ingeniería Aplicada de la UADY','Contacto: revista.fiq@correo.uady.mx'].filter(v=>v!==undefined).join('\n')};
}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 if(!await workerAuthorized(req))return json({error:'unauthorized'},401);
 try {
  if(env('RCIA_MAIL_MODE')!=='live')return json({status:'disabled'});
  let processed=0;
  for(let i=0;i<5;i++){
   const rows=await rpc('rcia_claim_email',{});if(!rows?.length)break;
   const row=rows[0];
   const info=await rpc('rcia_email_context',{qid:row.id});
   let status='suppressed',code='recipient_or_event_no_longer_valid',delay=60;
   if(info){
    try {const m=editorialMessage(info);await sendGraph(info.email,m.subject,m.text,info.event_type==='review_receipt' && info.cc_email?[info.cc_email]:[]);status='accepted';code=null;}
    catch(e){status=e.kind||'failed';code=e.code||'internal_error';delay=e.retryAfter||60;}
   }
   await rpc('rcia_finish_email',{qid:row.id,claim:row.claim_token,result_status:status,result_code:code,retry_seconds:delay});
   processed++;
  }
  return json({processed});
 }catch(e){return json({error:e.code||'internal_error'},502);}
});
