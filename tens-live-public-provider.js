(() => {
'use strict';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const humanType=t=>String(t||'finding').toLowerCase().replace(/_/g,' ');
const answerText=v=>typeof v==='string'?v:typeof v==='number'?String(v):JSON.stringify(v);
const unknownReason=r=>{r=String(r||'').toUpperCase();if(r.includes('CONFLICT'))return 'CONFLICTING_EVIDENCE';if(r.includes('INDEPENDENT')||r.includes('PROVENANCE'))return 'PROVENANCE_UNRESOLVED';if(r.includes('SOURCE')||r.includes('INSUFFICIENT')||r.includes('MISSING')||r.includes('NO_DIRECT'))return 'SOURCE_UNAVAILABLE';return 'SCOPE_LIMITATION'};
function sourceId(id){return 'SRC_'+String(id||'UNKNOWN').replace(/[^A-Za-z0-9._:-]/g,'_')}

const EVENT_QUERY_ES={
 CONSTRUCTION:/(?:constru(?:ir|ido|ida|idos|idas|y[oó]|yeron)|construcci[oó]n|edific(?:ar|ado|ada|[oó])|erig(?:ir|ido|ida|i[oó]))/i,
 OPENING:/(?:abri[oó]|abrieron|abiert[oa]|inaugur(?:ar|[oó]|aron|ado|ada))/i,
 EXECUTION:/(?:ejecut(?:ar|ado|ada|[oó])|firm(?:ar|ado|ada|[oó])|entr[oó] en vigor|vigente)/i,
 TRANSFER:/(?:transfir(?:i[oó]|ieron)|transferid[oa]|adquir(?:i[oó]|ido|ida)|compr(?:[oó]|ado|ada)|vendi[oó]|vendid[oa])/i,
 AWARD:/(?:adjudic(?:ar|[oó]|ado|ada)|otorg(?:ar|[oó]|ado|ada))/i,
 COMPLETION:/(?:complet(?:[oó]|ado|ada)|termin(?:[oó]|ado|ada))/i
};
const EVENT_SOURCE={
 CONSTRUCTION:/\b(?:built|build|constructed|construct|construction|erected|erect)\b|constru(?:ir|ido|ida|idos|idas|y[oó]|yeron)|construcci[oó]n/i,
 OPENING:/\b(?:opened|opening|inaugurated|inauguration)\b|abri[oó]|abrieron|inaugur(?:[oó]|aron|ado|ada)/i,
 EXECUTION:/\b(?:executed|signed|effective|entered into)\b|ejecut(?:ado|ada|[oó])|firm(?:ado|ada|[oó])|entr[oó] en vigor|vigente/i,
 TRANSFER:/\b(?:transferred|transfer|acquired|purchased|sold|conveyed)\b|transfir(?:i[oó]|ieron)|transferid[oa]|adquir(?:i[oó]|ido|ida)|compr(?:[oó]|ado|ada)|vendi[oó]|vendid[oa]/i,
 AWARD:/\b(?:awarded|award|selected)\b|adjudic(?:[oó]|ado|ada)|otorg(?:[oó]|ado|ada)/i,
 COMPLETION:/\b(?:completed|completion|finished)\b|complet(?:[oó]|ado|ada)|termin(?:[oó]|ado|ada)/i
};
const CATEGORY_ES={
 ENGINEERING:{re:/(?:engineering|engineer|design|technical|structural|mechanical|electrical|inspection|repair|construction|ingenier[ií]a|dise[nñ]o|t[eé]cnic|estructural|mec[aá]nic|el[eé]ctric|inspecci[oó]n|reparaci[oó]n|construcci[oó]n)/i,label:'ingeniería'},
 CONTRACT:{re:/(?:contract|agreement|purchase order|procurement|contrato|acuerdo|orden de compra|adquisici[oó]n)/i,label:'contratos'},
 FINANCE:{re:/(?:funding|budget|grant|cost|invoice|payment|reimbursement|financiamiento|presupuesto|costo|factura|pago|reembolso)/i,label:'finanzas'},
 OWNERSHIP:{re:/(?:owner|ownership|owned|deed|transfer|propietari|propiedad|due[nñ]o|escritura|transferencia)/i,label:'propiedad'},
 REGULATORY:{re:/(?:permit|regulatory|approval|compliance|permiso|regulaci[oó]n|aprobaci[oó]n|cumplimiento)/i,label:'regulación'}
};
const MONEY=/(?:\$\s?\d[\d,.]*(?:\s?(?:million|billion|thousand|m|b|k))?|\b\d[\d,.]*\s?(?:dollars?|usd|million dollars?|billion dollars?)\b)/i;
const DATE_TOKEN=/(?:\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+(?:18|19|20)\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:18|19|20)\d{2}\s*[-–—]\s*(?:(?:18|19|20)?\d{2})\b|\b(?:18|19|20)\d{2}\b)/gi;

function esIntent(query=''){
 const q=String(query||'');
 let eventClass=null;for(const [k,re] of Object.entries(EVENT_QUERY_ES))if(re.test(q)){eventClass=k;break}
 const range=q.match(/(?:desde|de|entre)?\s*((?:18|19|20)\d{2})\s*(?:-|–|—|a|hasta|y)\s*((?:18|19|20)\d{2})/i);
 const categories=Object.entries(CATEGORY_ES).filter(([,x])=>x.re.test(q)).map(([k])=>k);
 const inventory=/(?:lista|inventario|todos?|todas?|registros?|documentos?|informaci[oó]n|materiales?|archivos?)/i.test(q)&&Boolean(range||categories.length);
 const amount=/cu[aá]nt[oa]s?|importe|monto|costo|precio|presupuesto|factura|pago|reembolso/i.test(q);
 const ownership=/qui[eé]n.*(?:due[nñ]o|propietari|posee)|propietari[oa]|due[nñ]o/i.test(q);
 const status=/(?:estado actual|situaci[oó]n actual|actualmente|hoy|ahora)/i.test(q);
 const temporal=!inventory&&(Boolean(eventClass)||/cu[aá]ndo|qu[eé]\s+(?:a[nñ]o|fecha)|fecha\s+de/i.test(q));
 return{type:inventory?'INVENTORY':temporal?'TEMPORAL_EVENT':amount?'AMOUNT':ownership?'IDENTITY_ROLE':status?'CURRENT_STATUS':'GENERAL',eventClass,categories,range:range?{start:Math.min(+range[1],+range[2]),end:Math.max(+range[1],+range[2])}:null};
}
function eventSubject(query,eventClass){
 let q=String(query||'').replace(/[¿?]/g,' ').replace(/\s+/g,' ').trim();
 q=q.replace(/^(?:cu[aá]ndo|en qu[eé] a[nñ]o|qu[eé] fecha)\s+/i,'');
 q=q.replace(/^(?:se\s+|fue\s+|fueron\s+)?/i,'');
 const re=EVENT_QUERY_ES[eventClass];if(re)q=q.replace(re,' ');
 q=q.replace(/^(?:se\s+|fue\s+|fueron\s+)/i,'').replace(/\s+/g,' ').trim();
 return q||'el elemento consultado';
}
function positions(text,re){
 const flags=(re.flags.includes('g')?re.flags:re.flags+'g').replace('y',''),rx=new RegExp(re.source,flags),out=[];let m;
 while((m=rx.exec(text))){out.push({index:m.index,text:m[0]});if(rx.lastIndex===m.index)rx.lastIndex++}
 return out;
}
function dateNearEvent(statement,eventClass){
 const text=String(statement||''),dates=positions(text,DATE_TOKEN);if(!dates.length)return '';
 const ev=EVENT_SOURCE[eventClass],eps=ev?positions(text,ev):[];if(!eps.length)return dates[0].text;
 return dates.slice().sort((a,b)=>Math.min(...eps.map(e=>Math.abs(e.index-a.index)))-Math.min(...eps.map(e=>Math.abs(e.index-b.index))))[0].text;
}
function cleanSubjectForAmount(query){
 return String(query||'').replace(/[¿?]/g,' ').replace(/cu[aá]nt[oa]s?|cu[aá]nto|importe|monto|costo|cost[oó]|precio|fue|era|es|del|de la|de los|de las/gi,' ').replace(/\s+/g,' ').trim()||'el elemento consultado';
}
function spanishVerifiedStatement(statement,query){
 const src=String(statement||''),intent=esIntent(query);
 if(intent.type==='TEMPORAL_EVENT'&&intent.eventClass){
  const date=dateNearEvent(src,intent.eventClass),subject=eventSubject(query,intent.eventClass);
  if(date){
   if(intent.eventClass==='CONSTRUCTION')return subject+' se construyó en '+date+'.';
   if(intent.eventClass==='OPENING')return subject+' abrió o fue inaugurado en '+date+'.';
   if(intent.eventClass==='EXECUTION')return 'La evidencia preservada sitúa la firma o entrada en vigor relacionada con '+subject+' en '+date+'.';
   if(intent.eventClass==='TRANSFER')return 'La evidencia preservada sitúa la transferencia relacionada con '+subject+' en '+date+'.';
   if(intent.eventClass==='AWARD')return 'La evidencia preservada sitúa la adjudicación relacionada con '+subject+' en '+date+'.';
   if(intent.eventClass==='COMPLETION')return subject+' se completó en '+date+'.';
  }
 }
 if(intent.type==='AMOUNT'){const m=src.match(MONEY);if(m)return 'El importe verificado relacionado con '+cleanSubjectForAmount(query)+' es '+m[0]+'.'}
 if(intent.type==='IDENTITY_ROLE'){
  let m=src.match(/\bowned by\s+([^.;]+)/i);if(m)return 'La evidencia preservada identifica a '+m[1].trim()+' como propietario de '+eventSubject(query,null)+'.';
  m=src.match(/\btransferred to\s+([^.;]+)/i);if(m)return 'La evidencia preservada registra una transferencia a '+m[1].trim()+'.';
 }
 if(intent.type==='CURRENT_STATUS'){
  const subject=String(query||'').replace(/[¿?]/g,' ').replace(/cu[aá]l|qu[eé]|es|el|la|estado|situaci[oó]n|actual|actualmente|hoy|ahora/gi,' ').replace(/\s+/g,' ').trim()||'el elemento consultado';
  if(/\bactive\b|\bactivo\b/i.test(src))return 'La evidencia preservada indica que '+subject+' está activo.';
  if(/\bpending\b|\bpendiente\b/i.test(src))return 'La evidencia preservada indica que '+subject+' está pendiente.';
  if(/\bclosed\b|\bcerrad[oa]\b/i.test(src))return 'La evidencia preservada indica que '+subject+' está cerrado.';
  if(/\bopen\b|\babiert[oa]\b/i.test(src))return 'La evidencia preservada indica que '+subject+' está abierto.';
  if(/\bcompleted?\b|\bcompletad[oa]\b/i.test(src))return 'La evidencia preservada indica que '+subject+' está completado.';
 }
 if(intent.type==='INVENTORY'){
  const dates=positions(src,DATE_TOKEN),date=dates[0]?.text||'',cat=intent.categories[0]&&CATEGORY_ES[intent.categories[0]]?.label;
  if(date&&cat)return 'Elemento verificado de '+cat+' fechado en '+date+'. Consulte el registro de respaldo para revisar el detalle fuente.';
 }
 return 'La evidencia preservada contiene una declaración verificada relacionada con esta pregunta. Consulte el registro de respaldo para revisar el texto fuente original.';
}
function spanishUnknownText(u,query){
 const type=String(u?.type||''),intent=esIntent(query);
 if(type==='NO_DIRECT_MATCH_IN_ADMITTED_EVIDENCE'&&intent.range){
  const cat=intent.categories[0]&&CATEGORY_ES[intent.categories[0]]?.label;
  return 'TENS no verificó ningún elemento'+(cat?' de '+cat:'')+' fechado entre '+intent.range.start+' y '+intent.range.end+' en la evidencia admitida para esta investigación.';
 }
 if(type==='NO_ADMISSIBLE_EVIDENCE')return 'TENS no encontró evidencia admisible que establezca una respuesta a esta pregunta.';
 if(type==='INSUFFICIENT_VERIFIED_EVIDENCE')return 'TENS encontró evidencia para revisar, pero no fue suficiente para establecer una respuesta verificada.';
 if(type==='KNOWN_EVIDENCE_GAP'){
  const src=String(u?.statement||'').replace(/\s+/g,' ').trim(),agency=String(u?.agencyKey||'').toUpperCase();
  const coast=src.match(/^The underlying U\.S\. Coast Guard determination, finding, and related correspondence concerning the navigation obstruction associated with (.+?), as cited by current PD&E materials\.$/i);
  if(coast){const subject=coast[1].replace(/ on County Road /i,' en County Road ').replace(/ in Sarasota County, Florida/i,', condado de Sarasota, Florida');return 'Sigue faltando la fuente primaria subyacente de la Guardia Costera de EE. UU.: la determinación, el hallazgo y la correspondencia relacionada sobre la obstrucción a la navegación asociada con '+subject+', citados por los materiales actuales de PD&E.';}
  if(agency==='USCG')return 'Sigue faltando la fuente primaria subyacente de la Guardia Costera de EE. UU. descrita para este punto; TENS aún no la ha verificado directamente.';
  if(agency==='USACE')return 'Sigue faltando la fuente primaria subyacente del Cuerpo de Ingenieros del Ejército de EE. UU. descrita para este punto; TENS aún no la ha verificado directamente.';
  return 'La evidencia admitida todavía no contiene el registro fuente necesario para resolver este punto.';
 }
 return 'Este punto sigue sin resolverse con la evidencia actualmente admitida.';
}
function transform(x,language='en',query=''){
 const lang=String(language||'en').toLowerCase()==='es'?'es':'en';
 const result=x.result,protocol=String(result?.protocol||'');if(!result||!/^TENS_R\d+_PUBLIC_RESULT_1$/.test(protocol)||result.providerWrite!==false||result.productionMutation!==false)throw new Error('PUBLIC_RESULT_INVALID');
 const sources=(result.sources||[]).filter(s=>s&&s.evidenceId&&s.preservationVerified===true&&(s.url||s.sourceKind==='ARCHIVED_PUBLIC_RECORD')).map(s=>{
  const archived=s.sourceKind==='ARCHIVED_PUBLIC_RECORD';let host=lang==='es'?'Fuente web pública':'Public web source';if(!archived){try{host=new URL(s.url).hostname}catch{}}
  const derived=String(s.authority||'')==='TENS_VERIFIED_DERIVED_CASE_SUMMARY',recordType=lang==='es'?(derived?'Resumen de caso derivado y verificado':(archived?'Registro público archivado':'Evidencia web pública')):(derived?'Verified derived case summary':String(s.recordType||(archived?'Archived public record':'Public web evidence')));return{id:sourceId(s.evidenceId),occurrenceId:'OCC_'+sourceId(s.evidenceId),label:String(s.label||host),recordType,provenanceStatus:'verified',publicSafe:true,url:archived?'':String(s.url||''),contentHash:s.contentHash||null,sourceKind:derived?'DERIVED_CASE_SUMMARY':(archived?'ARCHIVED_PUBLIC_RECORD':'PUBLIC_WEB'),authority:String(s.authority||'')};
 });
 const smap=new Map(sources.map(s=>[s.id,s]));
 const verified=(result.verified||[]).map((v,i)=>{
  const ids=(v.evidenceRefs||[]).map(sourceId).filter(id=>smap.has(id)),statement=lang==='es'?spanishVerifiedStatement(v.statement,query):String(v.statement||'Verified finding').replace(/^[A-Za-z ]+ requested:\s*/i,''),evidenceLabel=lang==='es'?'Declaración directa de evidencia preservada':answerText(v.evidenceAnswer);
  return{id:'V_'+result.assignmentId+'_'+i,title:lang==='es'?'Hallazgo verificado':'Verified '+humanType(v.type),text:statement+' — '+evidenceLabel+'.',classification:'VERIFIED',sourceIds:ids,limitations:[lang==='es'?'Verificado únicamente a partir de evidencia preservada y admitida para esta investigación.':'Verified only from evidence preserved and admitted for this assignment.'],provenanceStatus:'verified'};
 });
 const unknown=(result.unknowns||[]).map((u,i)=>({id:'U_'+result.assignmentId+'_'+i,title:lang==='es'?'Punto sin resolver':'Unresolved '+humanType(u.type),text:lang==='es'?spanishUnknownText(u,query):String(u.statement||'This point remains unresolved.'),classification:'UNKNOWN',unknownReason:unknownReason(u.reason),sourceIds:[],limitations:[lang==='es'?'TENS no cumplió sus requisitos de verificación para este punto.':'TENS did not satisfy its verification requirements for this point.'],provenanceStatus:'unresolved'}));
 const limited=unknown.length>0;
 let answer;
 if(result.answer==='UNKNOWN')answer=lang==='es'?'TENS no pudo verificar una respuesta con la evidencia admitida para esta investigación.':'TENS could not verify an answer from the evidence admitted for this assignment.';
 else if(lang==='es')answer=verified[0]?.text?.replace(/\s+—\s+Declaración directa de evidencia preservada\.$/,'')||(verified.length===1?'TENS encontró 1 hallazgo verificado relevante para esta pregunta.':`TENS encontró ${verified.length} hallazgos verificados relevantes para esta pregunta.`);
 else answer=answerText(result.answer);
 const proposal=result.prrProposal&&result.prrProposal.state==='AWAITING_HUMAN_APPROVAL'&&result.prrProposal.providerWrite===false&&result.prrProposal.automaticRelease===false&&result.prrProposal.humanApprovalRequired===true?result.prrProposal:null;
 return {plainAnswer:answer,scopeLabel:lang==='es'?'Investigación pública de TENS — evidencia sujeta a verificación':'Live TENS public research — proof-bound evidence',verified,inference:[],unknown,sources,limitations:lang==='es'?['TENS devuelve únicamente conclusiones respaldadas por evidencia preservada.','DESCONOCIDO significa que la evidencia disponible no cumplió las reglas de verificación; no prueba que el hecho subyacente sea falso.']:['TENS returns only proof-bound conclusions from preserved evidence.','UNKNOWN means the available evidence did not satisfy the verification rules; it is not proof that the underlying fact is false.'],actions:proposal?(lang==='es'?['TENS encontró una brecha de evidencia que coincide con un borrador de solicitud de registros pendiente de aprobación. Revise el borrador antes de cualquier envío.']:['TENS found an evidence gap that matches a draft public-records request awaiting approval. Review the draft before any submission.']):limited?(lang==='es'?['Aclare la pregunta o inténtelo de nuevo cuando haya más evidencia pública disponible.']:['Refine the question or try again as additional public evidence becomes available.']):(lang==='es'?['Abra los registros de respaldo para revisar la ruta de evidencia.']:['Open the supporting source records to inspect the evidence trail.']),prrProposal:proposal,presentationLanguage:lang,audit:{searchEventId:result.assignmentId,indexVersion:'TENS_LIVE_PUBLIC',adapterVersion:'PUBLIC_ADAPTER',rulesetVersion:'TENS_TRUTH_CONTRACT',environment:'PRODUCTION',resultState:limited?'COMPLETE_WITH_LIMITATIONS':'COMPLETE'}};
}
const provider=Object.freeze({version:'4.2.0-live-proof-i18n',scopeLabel:'Live TENS public research — proof-bound evidence',async search(query,options={}){
 if(!window.TENS_API||window.TENS_API.error)throw new Error(window.TENS_API?.error||'TENS_API_NOT_READY');
 const emit=typeof options.emitStatus==='function'?options.emitStatus:()=>{},lang=String(options.language||'en').toLowerCase()==='es'?'es':'en',original=String(query||'').trim();
 emit({eventType:'TENS_QUEUE',message:lang==='es'?'Enviando la pregunta al motor de evidencia de TENS…':'Sending the question to the TENS evidence engine…'});
 const start=await window.TENS_API.fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:original})});
 if(start.status!==202)throw new Error('TENS_QUEUE_REJECTED_'+start.status);
 const queued=await start.json();if(!queued.jobId)throw new Error('TENS_JOB_ID_MISSING');
 for(let i=0;i<150;i++){
  await sleep(i<5?500:900);
  const res=await window.TENS_API.fetch('/api/research/status?jobId='+encodeURIComponent(queued.jobId));if(!res.ok)throw new Error('TENS_STATUS_'+res.status);
  const state=await res.json();
  if(state.state==='COMPLETE'){emit({eventType:'TENS_COMPLETE',message:lang==='es'?'TENS completó la revisión de evidencia.':'TENS completed the proof-bound evidence review.'});return transform(state,lang,original)}
  if(state.state==='FAILED')throw new Error('TENS_RESEARCH_HOLD_'+String(state.errorCode||'UNKNOWN'));
  if(i===6)emit({eventType:'TENS_WORKING',message:lang==='es'?'TENS está investigando la evidencia y comprobando la corroboración…':'TENS is investigating the evidence and checking corroboration…'});
 }
 throw new Error('TENS_RESEARCH_TIMEOUT');
}});
window.TENS_PUBLIC_PROVIDER=provider;
})();
