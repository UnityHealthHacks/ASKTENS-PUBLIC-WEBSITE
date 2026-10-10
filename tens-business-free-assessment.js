(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('freeAssessmentForm'),business=$('freeBusinessType'),outcome=$('freeOutcome'),problem=$('freeProblem'),out=$('freeAssessmentResult'),proceed=$('freeAssessmentProceed');
if(!form||!problem||!out)return;
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const baseById={ACCOUNTING:'Accounting',AUDIT:'Auditing & forensic review',CONSTRUCTION:'Construction & engineering',PROPERTY:'Property management',LEGAL:'Legal operations',HEALTHCARE_ADMIN:'Healthcare administration',MANUFACTURING:'Manufacturing',LOGISTICS:'Logistics & transportation',MARINA:'Marinas & boat clubs',RESTAURANT:'Restaurants & food service',GOVERNMENT:'Government & municipal operations',GENERAL_BUSINESS:'Small & midsize business'};
function explicitUnbuiltEndpointWork(input){
 const q=String(input||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const device=/\b(?:computers?|laptops?|desktops?|pcs?|macs?|endpoints?|devices?|workstations?|servers?|printers?|tablets?|computadoras?|ordenadores?|portatiles?|dispositivos?|equipos?|servidores?|impresoras?)\b/i;
 const action=/\b(?:repair|repairs|fix|fixing|troubleshoot|troubleshooting|remote|remotely|control|clean|remove|reset|reinstall|update|upgrade|patch|install|configure|manage|login|log in|log into|support|reparar|reparacion|reparaciones|arreglar|instalar|actualizar|configurar|administrar|gestionar|controlar|limpiar|eliminar|restablecer|soporte)\b/i;
 const specialized=/\b(?:remove (?:a |the )?(?:virus|malware)|virus removal|malware removal|reset passwords?|reinstall (?:windows|software)|update software|upgrade software|patch (?:systems?|software)|remote (?:into|access|control)|take control|log ?in|reparacion(?:es)?|soporte tecnico)\b/i;
 const documentTarget=/\b(?:fix|repair|correct|update|clean|manage|arreglar|corregir|actualizar)\s+(?:(?:our|the|all|these|my|mis|los|las|nuestros?)\s+)?(?:invoices?|documents?|records?|spreadsheets?|reports?|contracts?|billing|facturas?|documentos?|registros?|informes?|contratos?)\b/i;
 const noDeviceButMalwareWork=/\b(?:virus|malware|ransomware|spyware)\s+(?:removal|cleaning|cleanup|repair|elimination)\b|\b(?:remove|clean|eliminate)\s+(?:the\s+|a\s+)?(?:virus|malware|ransomware|spyware)\b/i;
 if(!device.test(q)&&!noDeviceButMalwareWork.test(q))return null;
 if(!action.test(q)&&!noDeviceButMalwareWork.test(q))return null;
 const d='(?:computers?|laptops?|desktops?|pcs?|macs?|endpoints?|devices?|workstations?|servers?|printers?|tablets?|computadoras?|ordenadores?|portatiles?|dispositivos?|equipos?|servidores?|impresoras?)';
 const a='(?:repair|repairs|fix|fixing|troubleshoot|troubleshooting|remote|remotely|control|clean|remove|reset|reinstall|update|upgrade|patch|install|configure|manage|login|log|support|reparar|reparacion|reparaciones|arreglar|instalar|actualizar|configurar|administrar|gestionar|controlar|limpiar|eliminar|restablecer|soporte)';
 const directed=new RegExp('\\b'+a+'\\b(?:\\s+\\w+){0,7}\\s+'+d+'\\b|\\b'+d+'\\b(?:\\s+\\w+){0,4}\\s+'+a+'\\b','i').test(q);
 const specializedWithDevice=(specialized.test(q)||noDeviceButMalwareWork.test(q))&&(device.test(q)||noDeviceButMalwareWork.test(q));
 if(!directed&&!specializedWithDevice)return null;
 const docContext=/\b(?:compare|reconcile|review|summarize|track|audit|organize|analyze|check|preparar|revisar|comparar|conciliar|resumir)\b(?:\s+\w+){0,7}\s+(?:invoices?|documents?|records?|spreadsheets?|reports?|contracts?|billing|payments?|facturas?|documentos?|registros?|informes?|contratos?|pagos?)\b/i;
 if((documentTarget.test(q)||docContext.test(q))&&!specializedWithDevice){
  // Remove a documentary target ("fix invoices") before looking for a
  // second, actual device-change command ("and repair the laptops").
  const withoutDoc=q.replace(documentTarget,' ');
  const explicitDeviceAction=new RegExp('\\b(?:repair|fix|troubleshoot|reset|remote|control|reinstall|install|configure|reparar|arreglar|configurar|controlar)\\b(?:\\s+\\w+){0,6}\\s+'+d+'\\b','i');
  if(!explicitDeviceAction.test(withoutDoc))return null;
 }
 const row=(window.TENS_RESEARCHED_BUSINESS_CAPABILITIES?.rows||[]).find(r=>r.id==='ENDPOINT_DEVICE_MANAGEMENT');
 return {label:row?.label||'Endpoint / Device Monitoring & Repair',decision:'FAIL_UNTIL_ISOLATED_ARM_BUILT',
  note:'Customer-computer repair, remote control and technical changes are not offered. An isolated, separately tested customer-device capability is required first.'};
}
function readinessFor(input,meta){
 const blocked=explicitUnbuiltEndpointWork(input);
 if(blocked)return {label:blocked.label,decision:blocked.decision,note:'Customer-computer repair and control are not offered. An isolated, separately tested customer-computer capability is required first.'};
 const rows=window.TENS_BUSINESS_READINESS?.rows||[],q=norm(input);
 let best=null,bestScore=0;
 for(const row of rows){const words=norm(row.label).split(' ').filter(x=>x.length>3),score=words.filter(w=>q.includes(w)).length;if(score>bestScore){bestScore=score;best=row}}
 if(!best&&baseById[meta?.industryId])best=rows.find(r=>r.label===baseById[meta.industryId]);
 return best||{label:meta?.industryLabel||'Business workflow',decision:'PASS_WITH_ONBOARDING',note:'TENS may be able to help, but this workflow needs its own setup and acceptance testing first.'};
}
function statusLabel(d){const es=(window.TENS_I18N?.lang?.()||'en')==='es';return d==='PASS_NOW'?(es?'Listo ahora':'Ready now'):d==='PASS_WITH_BOUNDARIES'?(es?'Puede ayudar con límites':'Can help with limits'):(d==='FAIL'||String(d).startsWith('FAIL_'))?(es?'Aún no está listo':'Not ready yet'):(es?'Requiere configuración':'Setup required')}
function render(){
 const b=business?.value.trim()||'',goal=outcome?.value.trim()||'',issue=problem.value.trim(),text=[b,goal,issue].filter(Boolean).join(' — ');
 if(!issue){out.innerHTML='<strong>Tell TENS what is going wrong first.</strong>';if(proceed)proceed.hidden=true;return}
 const language=window.TENS_I18N?.lang?.()||'en',meta=window.TENS_BUSINESS_CAPABILITIES?.answer(text,language);
 if(!meta||meta.state!=='BUSINESS_CAPABILITY_READY'){out.innerHTML='<strong>TENS cannot confirm a fit yet.</strong><br>Add a little more detail about the problem and the result you need.';if(proceed)proceed.hidden=true;return}
 const readiness=readinessFor(text,meta);
 if(String(readiness.decision||'').startsWith('FAIL')){
  out.innerHTML='<div class="trialbadge">'+esc(statusLabel(readiness.decision))+'</div><h3>This exact task is not available</h3><p>'+esc(readiness.note)+'</p><p>TENS may still help organize related records or prepare a review, but it cannot control, repair, or change customer devices under the current beta.</p>';
  if(proceed){proceed.hidden=true;proceed.onclick=null}
  return;
 }
 const caps=(meta.capabilities||[]).slice(0,4),needs=(meta.requires||[]).slice(0,3),blocked=(meta.blocked||[]).slice(0,2);
 out.innerHTML=
  '<div class="trialbadge">'+esc(statusLabel(readiness.decision))+'</div>'+
  '<h3>Your free TENS fit check</h3>'+
  '<p><strong>What TENS sees:</strong> '+esc(meta.plainAnswer)+'</p>'+
  (goal?'<p><strong>Your goal:</strong> '+esc(goal)+'</p>':'')+
  '<p><strong>What TENS could start with:</strong></p><ul>'+caps.map(x=>'<li>'+esc(x.description)+'</li>').join('')+'</ul>'+
  '<p><strong>What TENS would need from you:</strong></p><ul>'+needs.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
  '<p><strong>What still needs a person or special approval:</strong></p><ul>'+blocked.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
  '<p class="trialnote">'+esc(readiness.note)+'</p>'+
  '<div class="trialoffer"><strong>Next step if you want TENS to continue:</strong><br><span>If private records or system access are needed, TENS will first show you a one-time diagnostic fee before access begins. After the diagnostic, TENS gives you a plain-English findings summary, a realistic time range, and the price to finish. You choose whether to proceed. Billing is not active on this beta page yet.</span></div>';
 if(proceed){proceed.hidden=false;proceed.onclick=()=>{
  // One-time, tab-local handoff. Never place the entered problem in a URL or send it.
  try{sessionStorage.setItem('tens_business_quote_draft_v1',JSON.stringify({
    createdAt:Date.now(),business:b.slice(0,180),goal:goal.slice(0,240),problem:issue.slice(0,3000)
  }))}catch{}
  location.href='pricing.html?from=preview'
 }}
}
form.addEventListener('submit',e=>{e.preventDefault();render()});
})();