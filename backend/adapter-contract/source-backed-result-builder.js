'use strict';
// REVIEW-ONLY, PURE, DETACHED. No network, fs, clock or R210/R212 import. Does NOT verify sources itself.
// It converts ALREADY INDEPENDENTLY VERIFIED records (explicit attestations below) into the exact
// TENS_R202_PUBLIC_RESULT_1 shape the worker and browser accept, and refuses anything not explicitly attested.
// A URL string is never evidence of preservation or reachability: syntax is checked only as an extra safety gate.
const crypto=require('crypto');
const PROTOCOL='TENS_R202_PUBLIC_RESULT_1';
const sha=v=>crypto.createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v)}
const text=v=>typeof v==='string'?v.trim():'';
const normQ=q=>text(q).toLowerCase().replace(/\s+/g,' ');
const HEX64=/^[a-f0-9]{64}$/i,ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/;
const UNKNOWN_REASONS=new Set(['NOT_ESTABLISHED','NO_INDEX_MATCH','SOURCE_UNAVAILABLE','PROVENANCE_UNRESOLVED','CONFLICTING_EVIDENCE','SCOPE_LIMITATION']);
function publicHttps(u){try{const x=new URL(u);const h=x.hostname.toLowerCase().replace(/\.+$/,'');return x.protocol==='https:'&&!x.username&&!x.password&&!x.hash&&h.includes('.')&&h!=='localhost'&&!/\.(localhost|local|internal|lan|home|corp|test|invalid)$/.test(h)&&!/^(\d+\.){3}\d+$/.test(h)&&!h.startsWith('[')}catch{return false}}

/** Why a source record is not admissible, or '' if it carries every explicit attestation. */
function sourceProblem(s){
 if(!s||typeof s!=='object')return 'SOURCE_MALFORMED';
 if(!ID.test(String(s.evidenceId||'')))return 'SOURCE_ID_INVALID';
 if(!text(s.label)||!text(s.recordType))return 'SOURCE_LABEL_MISSING';
 if(s.readStatus!=='READ_COMPLETE')return 'SOURCE_NOT_READ_COMPLETE';
 if(!HEX64.test(String(s.contentHash||'')))return 'SOURCE_HASH_MISSING';
 const p=s.preservation;
 if(!p||p.verified!==true||p.independent!==true||!text(p.verifier)||p.contentHashMatchesPreservedBytes!==true)return 'SOURCE_PRESERVATION_NOT_ATTESTED';
 if(s.publicAccess!==true||(s.publicSafe!==undefined&&s.publicSafe!==true))return 'SOURCE_NOT_ATTESTED_PUBLIC'; // publicSafe is never accepted from input as proof; see releaseProblem
 const archived=s.sourceKind==='ARCHIVED_PUBLIC_RECORD';
 if(!archived&&s.sourceKind!=='PUBLIC_WEB')return 'SOURCE_KIND_INVALID';
 if(!archived&&!publicHttps(s.url))return 'SOURCE_URL_UNSAFE';
 if(s.url&&!publicHttps(s.url))return 'SOURCE_URL_UNSAFE';
 return '';
}
const numbersIn=t=>(String(t).match(/\d[\d,]*(?:\.\d+)?/g)||[]).map(n=>n.replace(/,/g,''));
function releaseProblem(s,verify){
 if(!verify)return 'RELEASE_ATTESTATION_VERIFIER_MISSING';
 const a=s.releaseAttestation;
 if(!a||typeof a!=='object')return 'RELEASE_ATTESTATION_MISSING';
 if(a.evidenceId!==s.evidenceId||String(a.contentHash||'').toLowerCase()!==String(s.contentHash).toLowerCase()||!text(a.scope)||a.revoked===true)return 'RELEASE_ATTESTATION_MISMATCH';
 let ok=false;try{ok=verify({evidenceId:s.evidenceId,contentHash:String(s.contentHash).toLowerCase(),scope:a.scope,attestation:a})===true}catch{ok=false}
 return ok?'':'RELEASE_ATTESTATION_UNVERIFIED';
}
/** Why a finding is not admissible, or ''. `sources` is a Map of admitted evidenceId -> source. */
function findingProblem(f,sources,qHash){
 if(!f||typeof f!=='object')return 'FINDING_MALFORMED';
 if(!text(f.statement)||!text(f.directQuote))return 'FINDING_TEXT_MISSING';
 const v=f.verification;
 if(!v||v.state!=='COMPLETE_VERIFIED'||v.basis!=='DIRECT_SOURCE_STATEMENT'||v.groundingRatio!==1||v.numbersGrounded!==true)return 'FINDING_NOT_VERIFIED';
 const rel=f.relevance;
 if(!rel||rel.state!=='RELEVANT'||rel.questionSha256!==qHash)return 'FINDING_RELEVANCE_NOT_ATTESTED';
 if(!Array.isArray(f.evidenceRefs)||!f.evidenceRefs.length||!f.evidenceRefs.every(id=>sources.has(id)))return 'FINDING_UNCITED';
 // Numeric grounding must compare complete tokens, not substrings:
 // '$500' MUST NOT match a quoted '$1,500' and '2026' MUST NOT match '12026'.
 // numbersIn() normalizes thousands separators consistently on both sides.
 const quotedNumericTokens=new Set(numbersIn(f.directQuote));
 if(!numbersIn(f.statement).every(n=>quotedNumericTokens.has(n)))return 'FINDING_NUMBER_NOT_IN_QUOTE'; // cheap re-check, not a substitute for independent attestation
 return '';
}
/**
 * @param {{jobId:string,question:string,assignmentId?:string}} job
 * @param {{sources:object[],findings:object[],unknowns?:object[],noMatch?:boolean}} bundle already-verified evidence
 * @returns {{ok:true,result:object,dropped:object[]}|{ok:false,reason:string}}
 */
// A public-release attestation is a SEPARATE governed record from publicAccess (reachable) and preservation (bytes kept).
// It is bound to evidenceId+contentHash+scope and verified by an INJECTED verifier. With no verifier nothing is admitted
// (honest UNKNOWN). publicSafe:true is emitted only for a source the verifier accepted; it is never copied from input.
function build(job,bundle,opts){
 const verifyRelease=opts&&typeof opts.verifyReleaseAttestation==='function'?opts.verifyReleaseAttestation:null;
 if(!job||!text(job.jobId)||!text(job.question))return {ok:false,reason:'JOB_REQUIRED'};
 if(!bundle||!Array.isArray(bundle.sources)||!Array.isArray(bundle.findings))return {ok:false,reason:'BUNDLE_REQUIRED'};
 const qHash=sha(normQ(job.question)),dropped=[];
 const admitted=new Map();
 for(const s of bundle.sources){let p=sourceProblem(s);if(!p)p=releaseProblem(s,verifyRelease);if(p)dropped.push({kind:'source',id:s&&s.evidenceId||null,reason:p});else if(admitted.has(s.evidenceId))dropped.push({kind:'source',id:s.evidenceId,reason:'SOURCE_DUPLICATE'});else admitted.set(s.evidenceId,s)}
 const kept=[];
 for(const f of bundle.findings){const p=findingProblem(f,admitted,qHash);if(p)dropped.push({kind:'finding',id:f&&f.id||null,reason:p});else kept.push(f)}
 const used=new Set(kept.flatMap(f=>f.evidenceRefs));
 const sources=[...admitted.values()].filter(s=>used.has(s.evidenceId)).map(s=>({evidenceId:s.evidenceId,preservationVerified:true,publicSafe:true,sourceKind:s.sourceKind,label:s.label.trim(),recordType:s.recordType.trim(),contentHash:s.contentHash.toLowerCase(),...(s.url?{url:s.url}:{}),...(text(s.documentDate)?{documentDate:s.documentDate.trim()}:{}),...(text(s.authority)?{authority:s.authority.trim()}:{})}));
 const verified=kept.map(f=>({type:text(f.type)||'RECORD',statement:f.statement.trim(),evidenceRefs:[...f.evidenceRefs],evidenceAnswer:text(f.evidenceAnswer)||f.directQuote.trim()}));
 const unknowns=(Array.isArray(bundle.unknowns)?bundle.unknowns:[]).filter(u=>u&&text(u.statement)&&UNKNOWN_REASONS.has(u.reason)).map(u=>({type:text(u.type)||'UNRESOLVED',statement:u.statement.trim(),reason:u.reason}));
 // Nothing admissible -> honest UNKNOWN, never a claim. Dropped items are surfaced as gaps, not hidden.
 if(!verified.length){
  if(!unknowns.length)unknowns.push({type:'NO_ADMISSIBLE_EVIDENCE',statement:bundle.noMatch?'No admitted evidence matched this question.':'No independently verified, source-backed finding could be established for this question.',reason:bundle.noMatch?'NO_INDEX_MATCH':(dropped.length?'PROVENANCE_UNRESOLVED':'NOT_ESTABLISHED')});
 }
 const assignmentId=text(job.assignmentId)||('ASSIGN_'+sha(job.jobId).slice(0,24));
 const body={protocol:PROTOCOL,state:'COMPLETE',providerWrite:false,productionMutation:false,assignmentId,answer:verified.length?'VERIFIED':'UNKNOWN',verified,unknowns,sources};
 const result={...body,checkpointHash:sha(body)};
 const bad=selfCheck(result);if(bad)return {ok:false,reason:'SELF_CHECK_'+bad};
 return {ok:true,result,dropped};
}
/** Structural re-check of what we emit (same invariants as worker resultOk + browser guard). */
function selfCheck(r){
 if(r.protocol!==PROTOCOL||r.state!=='COMPLETE'||r.providerWrite!==false||r.productionMutation!==false)return 'ENVELOPE';
 const ids=new Set(r.sources.map(s=>s.evidenceId));
 if(r.sources.some(s=>s.preservationVerified!==true||s.publicSafe!==true||!HEX64.test(s.contentHash)))return 'SOURCE';
 if(r.verified.some(v=>!v.evidenceRefs.length||!v.evidenceRefs.every(i=>ids.has(i))))return 'CITATION';
 if(r.answer==='VERIFIED'&&!r.verified.length)return 'EMPTY_VERIFIED';
 if(r.answer==='UNKNOWN'&&(r.verified.length||r.sources.length))return 'UNKNOWN_WITH_CLAIMS';
 return '';
}
/** Adapter hook for claim-adapter.processOne: getBundle(job,proof) must return already-verified evidence or null. */
function asAdapterBuilder(getBundle,opts){
 return (job,proof)=>{const b=typeof getBundle==='function'?getBundle(job,proof):null;if(!b)return null;const r=build(job,b,opts);return r.ok?r.result:null};
}
module.exports={build,asAdapterBuilder,sourceProblem,releaseProblem,findingProblem,selfCheck,PROTOCOL,normQ,sha};
