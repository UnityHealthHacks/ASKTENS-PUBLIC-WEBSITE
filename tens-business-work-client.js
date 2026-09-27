(()=>{'use strict';
const API=String(window.TENS_BUSINESS_API_BASE||'https://api.asktens.com').replace(/\/$/,''),KEY='tens_business_session_v1',MAX_FILES=8,MAX_BYTES=8*1024*1024;
const $=id=>document.getElementById(id),state=$('businessAccountState'),status=$('businessWorkStatus'),objective=$('workObjective'),files=$('workFiles'),run=$('runBusinessWork');
if(!state||!status||!objective||!files||!run)return;
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function payload(token){try{const p=token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'),pad='='.repeat((4-p.length%4)%4);return JSON.parse(atob(p+pad))}catch{return null}}
function token(){return sessionStorage.getItem(KEY)||''}
(function activate(){const h=new URLSearchParams(location.hash.replace(/^#/,'')),t=h.get('tens_session');if(t){sessionStorage.setItem(KEY,t);history.replaceState(null,'',location.pathname+location.search)}})();
function renderAccount(){const t=token(),p=payload(t);if(!t||!p){state.textContent='No organization session — capability questions remain available.';run.disabled=true;return}state.textContent='Organization session active · '+String(p.tenantId||'account')+' · '+String(p.planId||'plan');run.disabled=false;if(!document.getElementById('endBusinessSession')){const b=document.createElement('button');b.id='endBusinessSession';b.type='button';b.textContent='End session';b.style.marginLeft='10px';b.onclick=()=>{sessionStorage.removeItem(KEY);renderAccount();status.textContent='Organization session ended.'};state.appendChild(b)}}
async function encodeFile(f){const buf=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode(...buf.subarray(i,Math.min(i+0x8000,buf.length)));return{name:f.name,data:btoa(s)}}
function summary(x){const r=x?.result,s=r?.summary||{},d=r?.deliverable||{},lines=['State: '+String(x?.state||'UNKNOWN'),r?'Domain: '+String(r.domain||''):'',r?'Sources reviewed: '+Number(s.sourceCount||0):'',r?'Gaps: '+Number(s.gapCount||0):'',r?'Conflicts: '+Number(s.conflictCount||0):''];for(const src of d.sources||[])lines.push('Evidence: '+src.name+' · '+src.sha256+(src.amounts?.length?' · '+src.amounts.join(', '):''));for(const c of d.conflicts||[])lines.push('Conflict: '+String(c.type||'CONFLICT')+(c.identifier?' · '+c.identifier:'')+(c.amounts?.length?' · '+c.amounts.join(', '):''));for(const g of d.gaps||[])lines.push('Gap: '+String(g.category||g.type||'UNKNOWN'));if(Array.isArray(r?.nextActions)&&r.nextActions.length)lines.push('Next actions: '+r.nextActions.join('; '));return lines.filter(Boolean).join('\n')}
function offerDownload(jobId,result){let b=document.getElementById('downloadTensBusinessResult');if(!b){b=document.createElement('button');b.id='downloadTensBusinessResult';b.type='button';b.textContent='Download TENS result (.json)';status.insertAdjacentElement('afterend',b)}b.onclick=()=>{const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='TENS-'+jobId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}}
async function poll(jobId,t){
 for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,i?1500:500));const res=await fetch(API+'/api/business/status?jobId='+encodeURIComponent(jobId),{headers:{Origin:location.origin,Authorization:'Bearer '+t},cache:'no-store'}),j=await res.json().catch(()=>({}));
  if(res.status===401||res.status===403){status.textContent='Organization session is no longer valid for this job.';return j}
  if(!res.ok){status.textContent='Status check hold: '+String(j.error||res.status);return j}
  status.textContent='TENS job '+jobId+'\n'+summary(j);
  if(j.state==='COMPLETE'){offerDownload(jobId,j.result);return j}if(j.state==='FAILED')return j;
 }
 status.textContent='The job is still running. Keep this page open or return with the same organization session to check status.';return null
}
run.addEventListener('click',async()=>{
 const t=token(),p=payload(t),goal=objective.value.trim(),selected=[...files.files];if(!t||!p){status.textContent='An onboarded organization session is required.';return}if(!goal){status.textContent='Enter the business objective first.';objective.focus();return}if(selected.length>MAX_FILES){status.textContent='Too many files. Level 1 currently accepts up to '+MAX_FILES+' files per job.';return}
 const bytes=selected.reduce((n,f)=>n+f.size,0);if(bytes>MAX_BYTES){status.textContent='Selected files exceed the current 8 MB Level 1 job limit.';return}
 run.disabled=true;status.textContent='Preparing '+selected.length+' file(s) and creating the durable TENS job…';
 try{const encoded=[];for(const f of selected)encoded.push(await encodeFile(f));const res=await fetch(API+'/api/business/jobs',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({objective:goal,files:encoded}),cache:'no-store'}),j=await res.json().catch(()=>({}));if(!res.ok){status.textContent='TENS could not admit this job: '+String(j.error||res.status);return}status.textContent=String(j.immediateFeedback||'TENS accepted the job.')+'\nJob: '+j.jobId+'\n'+String(j.next||'');await poll(j.jobId,t)}
 catch(e){status.textContent='Business-work client hold: '+String(e.message||e)}
 finally{run.disabled=!token()}
});
renderAccount();
window.TENS_BUSINESS_WORK_CLIENT=Object.freeze({api:API,sessionKey:KEY,maxFiles:MAX_FILES,maxBytes:MAX_BYTES});
})();