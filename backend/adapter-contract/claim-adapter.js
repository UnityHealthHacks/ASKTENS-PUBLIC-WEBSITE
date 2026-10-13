'use strict';
// REVIEW-ONLY executable contract: bounded worker claim -> guarded R212 research -> validated completion.
// Pure and dependency-injected. It binds to NOTHING: no network, no Cloudflare, no signing keys, no R212 runtime.
// A deployment would supply `queue` (signed /internal/claim|complete|fail client) and `runner` (R212 runJob).
// Fail-closed: without a verified activation proof and a source-backed result builder it never claims or completes.
const RESULT_PROTOCOL='TENS_R202_PUBLIC_RESULT_1'; // protocol the existing worker.mjs resultOk() accepts
const MAX_RESULT_BYTES=500000;                      // same cap as worker.mjs /internal/complete

function resultOk(x){
 return !!x&&x.protocol===RESULT_PROTOCOL&&x.state==='COMPLETE'&&x.providerWrite===false&&x.productionMutation===false&&
  typeof x.assignmentId==='string'&&typeof x.checkpointHash==='string'&&Array.isArray(x.verified)&&Array.isArray(x.unknowns)&&Array.isArray(x.sources);
}
// Stricter than the worker: every verified finding must cite a preserved, public, hashed source.
function sourceBackedProblems(r){
 const errs=[];if(!resultOk(r))return ['RESULT_SCHEMA'];
 if(JSON.stringify(r).length>MAX_RESULT_BYTES)errs.push('RESULT_TOO_LARGE');
 const ids=new Map();
 for(const s of r.sources){
  if(!s||typeof s.evidenceId!=='string'||s.preservationVerified!==true)errs.push('SOURCE_NOT_PRESERVED');
  else{
   if(!(s.sourceKind==='ARCHIVED_PUBLIC_RECORD'||/^https:\/\//.test(String(s.url||''))))errs.push('SOURCE_NOT_PUBLIC');
   if(!/^[a-f0-9]{64}$/i.test(String(s.contentHash||'')))errs.push('SOURCE_HASH_MISSING');
   ids.set(s.evidenceId,s);
  }
 }
 if(r.verified.length&&!r.sources.length)errs.push('VERIFIED_WITHOUT_SOURCE');
 for(const v of r.verified){if(!Array.isArray(v?.evidenceRefs)||!v.evidenceRefs.length||!v.evidenceRefs.every(id=>ids.has(id)))errs.push('VERIFIED_UNCITED')}
 return [...new Set(errs)];
}

/**
 * @param {object} d
 * @param {{claim():Promise<object>,complete(o):Promise<object>,fail(o):Promise<object>}} d.queue
 * @param {{runJob(input):Promise<object>}} d.runner   guarded R212 research (returns PUBLIC_RESEARCH_PASS or PUBLIC_RESEARCH_HOLD)
 * @param {(job,proof)=>object|null} d.buildResult     turns a PASS proof into a TENS_R202 result; must return null if it cannot be source-backed
 * @param {object} d.activationProof                   verbatim proof from R212; NEVER synthesized here
 * @param {object} d.namespace                         customer/tenant/case namespace required by the runner
 */
async function processOne(d){
 const {queue,runner,buildResult,activationProof,namespace}=d||{};
 if(!queue||!runner||typeof buildResult!=='function')return {state:'UNBOUND_HOLD',reason:'ADAPTER_NOT_BOUND',claimed:false};
 if(!activationProof||activationProof.state!=='R212_PUBLIC_RESEARCH_ACTIVATION_PROOF_READY')return {state:'UNBOUND_HOLD',reason:'ACTIVATION_PROOF_REQUIRED',claimed:false};
 const c=await queue.claim();
 if(!c||c.state!=='CLAIMED')return {state:'IDLE',claimed:false};
 if(!c.jobId||!c.claimToken||!c.question)return {state:'CLAIM_MALFORMED',claimed:false};
 // Only a confirmed queue receipt permits a success label; timeouts/lease reclaims are uncertain.
 const fail=async code=>{
  let ack;
  try{ack=await queue.fail({jobId:c.jobId,claimToken:c.claimToken,errorCode:String(code).slice(0,120)})}
  catch{return {state:'FAILURE_UNCONFIRMED',errorCode:code,claimed:true,jobId:c.jobId}}
  if(ack?.status!==200||ack.state!=='FAILURE_ACCEPTED')return {state:'FAILURE_UNCONFIRMED',errorCode:code,claimed:true,jobId:c.jobId};
  return {state:'FAILED_REPORTED',errorCode:code,claimed:true,jobId:c.jobId};
 };
 let proof;
 try{proof=await runner.runJob({jobId:c.jobId,question:c.question,namespace,activationProof})}
 catch(e){return fail('R212_RUNNER_EXCEPTION')}
 if(!proof||proof.state==='PUBLIC_RESEARCH_HOLD')return fail('R212_HOLD_'+String(proof&&proof.reason||'UNKNOWN'));
 if(proof.state!=='PUBLIC_RESEARCH_PASS'||proof.completionClaimAllowed!==true)return fail('R212_NO_COMPLETION_CLAIM');
 let result;try{result=buildResult({jobId:c.jobId,question:c.question},proof)}catch(e){return fail('RESULT_BUILD_EXCEPTION')}
 if(!result)return fail('NO_SOURCE_BACKED_RESULT');
 const problems=sourceBackedProblems(result);
 if(problems.length)return fail('RESULT_REJECTED_'+problems[0]);
 let ack;
 try{ack=await queue.complete({jobId:c.jobId,claimToken:c.claimToken,result})}
 catch{return {state:'COMPLETION_UNCONFIRMED',claimed:true,jobId:c.jobId}}
 // A 200 HTTP envelope AND a recorded COMPLETE_ACCEPTED body must both be present.
 // Never mark success on 409/stale leases, 503, empty response, or network uncertainty.
 // Do not submit a second mutation automatically: the first may have committed.
 if(ack?.status!==200||ack.state!=='COMPLETE_ACCEPTED')return {state:'COMPLETION_UNCONFIRMED',claimed:true,jobId:c.jobId};
 return {state:'COMPLETED',claimed:true,jobId:c.jobId};
}
module.exports={processOne,sourceBackedProblems,resultOk,RESULT_PROTOCOL};
