(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('freeAssessmentForm'),business=$('freeBusinessType'),outcome=$('freeOutcome'),problem=$('freeProblem'),out=$('freeAssessmentResult'),proceed=$('freeAssessmentProceed');
if(!form||!problem||!out)return;
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const baseById={ACCOUNTING:'Accounting',AUDIT:'Auditing & forensic review',CONSTRUCTION:'Construction & engineering',PROPERTY:'Property management',LEGAL:'Legal operations',HEALTHCARE_ADMIN:'Healthcare administration',MANUFACTURING:'Manufacturing',LOGISTICS:'Logistics & transportation',MARINA:'Marinas & boat clubs',RESTAURANT:'Restaurants & food service',GOVERNMENT:'Government & municipal operations',GENERAL_BUSINESS:'Small & midsize business'};
function readinessFor(input,meta){
 const rows=window.TENS_BUSINESS_READINESS?.rows||[],q=norm(input);
 let best=null,bestScore=0;
 for(const row of rows){const words=norm(row.label).split(' ').filter(x=>x.length>3),score=words.filter(w=>q.includes(w)).length;if(score>bestScore){bestScore=score;best=row}}
 if(!best&&baseById[meta?.industryId])best=rows.find(r=>r.label===baseById[meta.industryId]);
 return best||{label:meta?.industryLabel||'Business workflow',decision:'PASS_WITH_ONBOARDING',note:'TENS may be able to help, but this workflow needs its own setup and acceptance testing first.'};
}
function statusLabel(d){const es=(window.TENS_I18N?.lang?.()||'en')==='es';return d==='PASS_NOW'?(es?'Listo ahora':'Ready now'):d==='PASS_WITH_BOUNDARIES'?(es?'Puede ayudar con límites':'Can help with limits'):d==='FAIL'?(es?'No compatible actualmente':'Not currently supported'):(es?'Requiere configuración':'Setup required')}
function render(){
 const b=business?.value.trim()||'',goal=outcome?.value.trim()||'',issue=problem.value.trim(),text=[b,goal,issue].filter(Boolean).join(' — ');
 if(!issue){out.innerHTML='<strong>Tell TENS what is going wrong first.</strong>';return}
 const language=window.TENS_I18N?.lang?.()||'en',meta=window.TENS_BUSINESS_CAPABILITIES?.answer(text,language);
 if(!meta||meta.state!=='BUSINESS_CAPABILITY_READY'){out.innerHTML='<strong>TENS cannot confirm a fit yet.</strong><br>Add a little more detail about the problem and the result you need.';return}
 const readiness=readinessFor(b+' '+issue,meta),caps=(meta.capabilities||[]).slice(0,4),needs=(meta.requires||[]).slice(0,3),blocked=(meta.blocked||[]).slice(0,2);
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
 if(proceed){proceed.hidden=false;proceed.onclick=()=>{location.href='pricing.html'}}
}
form.addEventListener('submit',e=>{e.preventDefault();render()});
})();