[Reading 26 lines from start (total: 26 lines, 0 remaining)]

(() => {
'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const humanType=t=>String(t||'finding').toLowerCase().replace(/_/g,' ');
const answerText=v=>typeof v==='string'?v:typeof v==='number'?String(v):JSON.stringify(v);
const unknownReason=r=>{r=String(r||'').toUpperCase();if(r.includes('CONFLICT'))return 'CONFLICTING_EVIDENCE';if(r.includes('INDEPENDENT')||r.includes('PROVENANCE'))return 'PROVENANCE_UNRESOLVED';if(r.includes('SOURCE')||r.includes('INSUFFICIENT')||r.includes('MISSING'))return 'SOURCE_UNAVAILABLE';return 'SCOPE_LIMITATION'};
function sourceId(id){return 'SRC_'+String(id||'UNKNOWN').replace(/[^A-Za-z0-9._:-]/g,'_')}
function transform(x){
 const result=x.result;if(!result||result.protocol!=='TENS_R202_PUBLIC_RESULT_1'||result.providerWrite!==false||result.productionMutation!==false)throw new Error('R202_PUBLIC_RESULT_INVALID');
 const sources=(result.sources||[]).filter(s=>s&&s.evidenceId&&s.url&&s.preservationVerified===true).map(s=>{let host='Public web source';try{host=new URL(s.url).hostname}catch{}return{id:sourceId(s.evidenceId),occurrenceId:'OCC_'+sourceId(s.evidenceId),label:host,recordType:'Public web evidence',provenanceStatus:'verified',publicSafe:true,url:s.url,contentHash:s.contentHash||null}});
 const smap=new Map(sources.map(s=>[s.id,s]));
 const verified=(result.verified||[]).map((v,i)=>{const ids=(v.evidenceRefs||[]).map(sourceId).filter(id=>smap.has(id));return{id:'V_'+result.assignmentId+'_'+i,title:'Verified '+humanType(v.type),text:(String(v.statement||'Verified finding').replace(/^[A-Za-z ]+ requested:\s*/i,'')+' — '+answerText(v.evidenceAnswer)+'.'),classification:'VERIFIED',sourceIds:ids,limitations:['Verified only from evidence preserved and admitted for this R202 assignment.'],provenanceStatus:'verified'}});
 const unknown=(result.unknowns||[]).map((u,i)=>({id:'U_'+result.assignmentId+'_'+i,title:'Unresolved '+humanType(u.type),text:String(u.statement||'This point remains unresolved.'),classification:'UNKNOWN',unknownReason:unknownReason(u.reason),sourceIds:[],limitations:['R202 did not satisfy its verification requirements for this point.'],provenanceStatus:'unresolved'}));
 const limited=unknown.length>0,answer=result.answer==='UNKNOWN'?'TENS could not verify an answer from the evidence admitted for this assignment.':answerText(result.answer);
 return {plainAnswer:answer,scopeLabel:'Live R202 public research — proof-bound evidence',verified,inference:[],unknown,sources,limitations:['R202 returns only proof-bound conclusions from preserved evidence.','UNKNOWN means the available evidence did not satisfy the verification rules; it is not proof that the underlying fact is false.'],actions:limited?['Refine the question or try again as additional public evidence becomes available.']:['Open the supporting source records to inspect the evidence trail.'],prrProposal:null,audit:{searchEventId:result.assignmentId,indexVersion:'TENS_R202_LIVE',adapterVersion:'PENDING_ADAPTER_STAMP',rulesetVersion:'TENS_R202_TRUTH_CONTRACT',environment:'PRODUCTION',resultState:limited?'COMPLETE_WITH_LIMITATIONS':'COMPLETE'}};
}
const provider=Object.freeze({version:'3.0.0-r202-live',scopeLabel:'Live R202 public research — proof-bound evidence',async search(query,options={}){
 if(!window.TENS_API||window.TENS_API.error)throw new Error(window.TENS_API?.error||'TENS_API_NOT_READY');const emit=typeof options.emitStatus==='function'?options.emitStatus:()=>{};
 emit({eventType:'R202_QUEUE',message:'Sending the question to the R202 evidence engine…'});
 const start=await window.TENS_API.fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:String(query||'').trim()})});
 if(start.status!==202)throw new Error('R202_QUEUE_REJECTED_'+start.status);const queued=await start.json();if(!queued.jobId)throw new Error('R202_JOB_ID_MISSING');
 for(let i=0;i<150;i++){await sleep(i<5?500:900);const res=await window.TENS_API.fetch('/api/research/status?jobId='+encodeURIComponent(queued.jobId));if(!res.ok)throw new Error('R202_STATUS_'+res.status);const state=await res.json();if(state.state==='COMPLETE'){emit({eventType:'R202_COMPLETE',message:'R202 completed the proof-bound evidence review.'});return transform(state)}if(state.state==='FAILED')throw new Error('R202_RESEARCH_HOLD_'+String(state.errorCode||'UNKNOWN'));if(i===6)emit({eventType:'R202_WORKING',message:'R202 is investigating the evidence and checking corroboration…'})}
 throw new Error('R202_RESEARCH_TIMEOUT');
}});
window.TENS_PUBLIC_PROVIDER=provider;
})();

[executed on device: lifestyle (c844dcf9-13d5-4dc5-b408-fe14e91c4186)]