// REVIEW-ONLY. Fail-closed acceptance harness for the D1 queue candidate against a REAL, owner-provisioned, disposable NONPRODUCTION D1 binding.
// Default = no binding access, no network, no mutation. It never applies migrations, never touches other tables, holds no credentials/signing keys,
// and never upgrades source claims. Until a run is witnessed inside the Cloudflare Workers runtime the report says NOT_RUN_NO_REAL_D1_PROOF.
// Staging-only execution contract: see d1-acceptance-README.md. Nothing here has been executed against Cloudflare.
import * as Q from './d1-research-queue.mjs';

export const STATUS={NOT_RUN:'NOT_RUN_NO_REAL_D1_PROOF',REFUSED:'REFUSED',HOLD:'HOLD',PASSED_UNPROVEN:'SCENARIOS_PASSED_BINDING_NOT_WITNESSED_AS_CLOUDFLARE',FAIL:'FAIL'};
export const APPROVAL_SCHEMA='TENS_D1_ACCEPTANCE_APPROVAL_V1';
export const MARKER_TABLE='tens_acceptance_marker'; // owner-created in the disposable DB: (database_id TEXT, environment TEXT, approval_nonce TEXT)
export const NEVER_PRODUCTION_NAMES=['tens-research-jobs']; // name of the live binding reported by the owner; always refused
const MAX_APPROVAL_MS=4*3600*1000, RUN_ID=/^[a-f0-9]{8}$/, HEX64=/^[a-f0-9]{64}$/;
const REQUIRED_JOB_COLUMNS=['id','question','state','result_json','error_code','created_at','updated_at','claim_token','claim_expires_at','claim_count','session_hash'];
const BASE_TS=1_000_000_000_000; // synthetic clock far earlier than real rows: fixtures sort first and the TTL/nonce prunes cannot reach real rows

async function sha256Hex(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v)}
export const approvalDigest=a=>sha256Hex(stable({...a,approvalDigest:undefined}));

/** Pure, no I/O. Returns reasons the supplied owner approval is unusable for the requested mode. */
export async function checkApproval(cfg,{mode,runId,now}){
 const r=[],a=cfg&&cfg.approval;
 if(!a||a.schema!==APPROVAL_SCHEMA)return ['APPROVAL_MISSING'];
 if(a.environment!=='NONPRODUCTION_DISPOSABLE')r.push('ENVIRONMENT_NOT_NONPRODUCTION_DISPOSABLE');
 if(typeof a.databaseId!=='string'||!/^[A-Za-z0-9-]{8,64}$/.test(a.databaseId))r.push('DATABASE_ID_INVALID');
 if(typeof a.databaseName!=='string'||!a.databaseName||NEVER_PRODUCTION_NAMES.includes(a.databaseName.toLowerCase()))r.push('DATABASE_NAME_REFUSED');
 if(Array.isArray(a.productionDatabaseIds)&&a.productionDatabaseIds.includes(a.databaseId))r.push('DATABASE_ID_IS_PRODUCTION');
 if(!Array.isArray(a.productionDatabaseIds)||!a.productionDatabaseIds.length)r.push('PRODUCTION_ID_DENYLIST_REQUIRED');
 if(typeof a.approvedBy!=='string'||!a.approvedBy)r.push('APPROVER_MISSING');
 if(typeof a.approvalNonce!=='string'||a.approvalNonce.length<16)r.push('APPROVAL_NONCE_INVALID');
 const from=Date.parse(a.approvedAt),to=Date.parse(a.expiresAt);
 if(!(from<=now)||!(to>now)||!(to-from<=MAX_APPROVAL_MS))r.push('APPROVAL_WINDOW_INVALID');
 if(mode==='mutate'){
  if(a.mutationsApproved!==true)r.push('MUTATIONS_NOT_APPROVED');
  if(!RUN_ID.test(String(runId||''))||a.runId!==runId)r.push('RUN_ID_NOT_APPROVED');
  if(!HEX64.test(String(a.approvalDigest||''))||a.approvalDigest!==await approvalDigest(a))r.push('APPROVAL_DIGEST_MISMATCH');
 }
 return r;
}

const rows=async(db,sql,...b)=>{const s=db.prepare(sql);return (await (b.length?s.bind(...b):s).all()).results||[]};

/** Read-only (SELECT / PRAGMA) classification of the supplied binding. */
export async function classifyBinding(db,approval,{now}){
 const out={marker:'MISSING',jobColumns:[],missingColumns:[],nonceColumns:[],foreignActiveJobs:null,tables:[],reasons:[]};
 try{
  out.tables=(await rows(db,"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map(t=>t.name);
  const m=out.tables.includes(MARKER_TABLE)?await rows(db,`SELECT database_id,environment,approval_nonce FROM ${MARKER_TABLE} LIMIT 2`):[];
  if(m.length!==1)out.reasons.push('MARKER_NOT_EXACTLY_ONE_ROW');
  else if(m[0].environment!=='NONPRODUCTION_DISPOSABLE'||m[0].database_id!==approval.databaseId||m[0].approval_nonce!==approval.approvalNonce)out.reasons.push('MARKER_DOES_NOT_MATCH_APPROVAL');
  else out.marker='MATCHES_OWNER_APPROVAL';
  out.jobColumns=(await rows(db,'PRAGMA table_info(research_jobs)')).map(c=>c.name);
  out.nonceColumns=(await rows(db,'PRAGMA table_info(internal_nonces)')).map(c=>c.name);
  out.missingColumns=REQUIRED_JOB_COLUMNS.filter(c=>!out.jobColumns.includes(c));
  if(out.missingColumns.length)out.reasons.push('MIGRATION_NOT_APPLIED_HARNESS_WILL_NOT_APPLY_IT');
  if(!['nonce','created_at'].every(c=>out.nonceColumns.includes(c)))out.reasons.push('NONCE_TABLE_MISSING_COLUMNS');
  if(!out.missingColumns.length)out.foreignActiveJobs=Number((await rows(db,"SELECT COUNT(*) AS n FROM research_jobs WHERE state IN ('QUEUED','RUNNING')"))[0]?.n);
  if(out.foreignActiveJobs>0)out.reasons.push('NON_EMPTY_ACTIVE_QUEUE_CLAIM_WOULD_TOUCH_FOREIGN_ROWS');
 }catch(e){out.reasons.push('READ_ONLY_CLASSIFICATION_FAILED:'+String(e&&e.message||e).slice(0,80))}
 out.classifiedAt=new Date(now).toISOString();
 return out;
}

const ID=(run,n)=>`R203WEB_ACPT${run}${String(n).padStart(8,'0')}`; // matches Q.jobIdOk, never collides with real R203WEB_<32hex>
const GOOD={protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,assignmentId:'ACCEPTANCE_FIXTURE',checkpointHash:'0'.repeat(64),verified:[],unknowns:[{type:'FIXTURE',statement:'Acceptance fixture. Not a research result.',reason:'NOT_ESTABLISHED'}],sources:[]};

async function scenarios(db,run){
 const ids=[],nonces=[],res=[];
 const rec=(name,ok,detail)=>res.push({name,ok:!!ok,detail:detail===undefined?null:detail});
 const mk=async(n,t)=>{const id=ID(run,n);const a=await Q.enqueue(db,{id,question:'acceptance fixture '+n,now:t,maxActive:1000,perSession:1000});if(a?.state==='QUEUED'&&a.jobId===id)ids.push(id);return a};
 const t0=BASE_TS;
 try{
  // atomic concurrent enqueue
  const enq=await Promise.all([1,2,3,4].map(n=>mk(n,t0+n)));
  const cnt=Number((await rows(db,'SELECT COUNT(*) AS n FROM research_jobs WHERE id IN ('+ids.map(()=>'?').join(',')+')',...ids))[0].n);
  rec('concurrent_enqueue_no_lost_update',enq.every(e=>e.state==='QUEUED')&&cnt===4,{cnt});
  // parallel claim: distinct jobs, FIFO set
  const claims=await Promise.all([0,1,2,3,4].map(i=>Q.claim(db,{now:t0+100,token:`${run}-tok-${i}`,scopeJobIds:ids})));
  const got=claims.filter(c=>c.state==='CLAIMED');
  rec('parallel_claim_unique',got.length===4&&new Set(got.map(c=>c.jobId)).size===4&&got.every(c=>ids.includes(c.jobId)),{claimed:got.length});
  const by=Object.fromEntries(got.map(c=>[c.jobId,c]));
  const [a,b,c,d]=ids.map(i=>by[i]);
  // token enforcement + complete once
  rec('wrong_token_rejected',(await Q.complete(db,{jobId:a.jobId,claimToken:'nope',result:GOOD,now:t0+200})).status===409);
  rec('complete_accepted',(await Q.complete(db,{jobId:a.jobId,claimToken:a.claimToken,result:GOOD,now:t0+200})).state==='COMPLETE_ACCEPTED');
  rec('second_complete_rejected',(await Q.complete(db,{jobId:a.jobId,claimToken:a.claimToken,result:GOOD,now:t0+201})).status===409);
  rec('fail_accepted_and_no_result',(await Q.fail(db,{jobId:b.jobId,claimToken:b.claimToken,errorCode:'ACCEPTANCE_FIXTURE',now:t0+200})).state==='FAILURE_ACCEPTED'&&(await rows(db,'SELECT result_json FROM research_jobs WHERE id=?',b.jobId))[0].result_json===null);
  // expired lease cannot complete; reclaim rotates token; old token dead (crash / reentry)
  const late=t0+100+Q.CLAIM_MS+1;
  rec('expired_lease_cannot_complete',(await Q.complete(db,{jobId:c.jobId,claimToken:c.claimToken,result:GOOD,now:late})).status===409);
  const re=await Q.claim(db,{now:late,token:`${run}-tok-re`,scopeJobIds:ids});
  rec('crash_reentry_reclaims_with_new_token',re.state==='CLAIMED'&&re.jobId===c.jobId&&re.claimToken!==c.claimToken&&re.reclaimed===true);
  rec('stale_token_dead_after_reentry',(await Q.complete(db,{jobId:c.jobId,claimToken:c.claimToken,result:GOOD,now:late+1})).status===409);
  rec('reentry_token_completes',(await Q.complete(db,{jobId:re.jobId,claimToken:re.claimToken,result:GOOD,now:late+2})).state==='COMPLETE_ACCEPTED');
  // integrity: forged source result refused and job state unchanged
  const forged={...GOOD,verified:[{evidenceRefs:['X']}]};
  const fr=await Q.complete(db,{jobId:d.jobId,claimToken:d.claimToken,result:forged,now:t0+300});
  rec('forged_result_refused_state_unchanged',fr.status===400&&(await rows(db,'SELECT state FROM research_jobs WHERE id=?',d.jobId))[0].state==='RUNNING',fr);
  await Q.fail(db,{jobId:d.jobId,claimToken:d.claimToken,errorCode:'ACCEPTANCE_FIXTURE',now:t0+301});
  // nonce replay (namespaced; consumeNonce prunes only rows older than the synthetic clock)
  const n1=`acpt-${run}-nonce-1`;
  const first=await Q.consumeNonce(db,n1,t0+400,{pruneExpired:false});if(first===true)nonces.push(n1);
  const second=await Q.consumeNonce(db,n1,t0+401,{pruneExpired:false});
  rec('nonce_replay_rejected',first===true&&second===false);
  // SQL rollback: D1 batch is atomic; a PK conflict in statement 2 must leave statement 1 unwritten
  const rb=ID(run,90),rb2=ID(run,91); // expected rollback rows are NOT cleanup-owned: never delete on a failed transaction
  let threw=false;
  try{await db.batch([db.prepare("INSERT INTO research_jobs(id,question,state,created_at,updated_at) VALUES(?,'rollback fixture','FAILED',?,?)").bind(rb,t0,t0),db.prepare("INSERT INTO research_jobs(id,question,state,created_at,updated_at) VALUES(?,'rollback fixture','FAILED',?,?)").bind(rb2,t0,t0),db.prepare("INSERT INTO research_jobs(id,question,state,created_at,updated_at) VALUES(?,'dup','FAILED',?,?)").bind(rb,t0,t0)])}catch{threw=true}
  const left=Number((await rows(db,'SELECT COUNT(*) AS n FROM research_jobs WHERE id IN (?,?)',rb,rb2))[0].n);
  rec('batch_rollback_leaves_no_partial_rows',threw&&left===0,{threw,left});
 }catch(e){rec('scenario_runner_exception',false,String(e&&e.message||e).slice(0,120))}
 return {res,ids,nonces};
}
/** Deletes ONLY the exact ids/nonces this run created (bound parameters, no LIKE, no unscoped DELETE). */
async function cleanup(db,ids,nonces){
 const out={jobs:0,nonces:0,error:null};
 try{
  if(ids.length){const r=await db.prepare('DELETE FROM research_jobs WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).run();out.jobs=Number(r?.meta?.changes??0)}
  if(nonces.length){const r=await db.prepare('DELETE FROM internal_nonces WHERE nonce IN ('+nonces.map(()=>'?').join(',')+')').bind(...nonces).run();out.nonces=Number(r?.meta?.changes??0)}
  const left=Number((await rows(db,'SELECT COUNT(*) AS n FROM research_jobs WHERE id IN ('+(ids.map(()=>'?').join(',')||"''")+')',...ids))[0].n);
  if(left)out.error='FIXTURE_ROWS_REMAIN:'+left;
 }catch(e){out.error=String(e&&e.message||e).slice(0,100)}
 return out;
}
// A Worker user-agent string (or a marker inside the caller-supplied DB) is not independent
// provider/environment evidence. This module must never self-issue real D1 proof.

/**
 * run({mode, db?, config?, runId?, now?})  mode: 'preflight' (default) | 'readonly' | 'mutate'
 * preflight never touches db. readonly only SELECT/PRAGMA. mutate additionally needs the digest-bound approval for this runId.
 */
export async function run({mode='preflight',db=null,config=null,runId=null,now=Date.now()}={}){
 const rep={protocol:'TENS_D1_ACCEPTANCE_REPORT_1',mode,status:STATUS.NOT_RUN,realD1Proof:false,production:false,network:false,migrationsApplied:false,otherTablesTouched:false,
  signingCredentials:false,sourceClaimUpgrade:false,r212RuntimeAdmission:false,reasons:[],classification:null,scenarios:[],cleanup:null,at:new Date(now).toISOString()};
 const finish=async()=>{rep.receiptSha256=await sha256Hex(stable({...rep,receiptSha256:undefined}));return rep};
 if(!['preflight','readonly','mutate'].includes(mode)){rep.status=STATUS.REFUSED;rep.reasons.push('MODE_UNKNOWN');return finish()}
 if(mode==='preflight'){
  rep.reasons.push('PREFLIGHT_ONLY_NO_BINDING_ACCESSED');
  const r=config?await checkApproval(config,{mode:'readonly',now}):['APPROVAL_NOT_SUPPLIED'];
  rep.approvalProblems=r;return finish();
 }
 const probs=await checkApproval(config,{mode,runId,now});
 if(probs.length){rep.status=STATUS.REFUSED;rep.reasons=probs;return finish()}
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function'){rep.status=STATUS.REFUSED;rep.reasons=['BINDING_NOT_SUPPLIED'];return finish()}
 const a=config.approval;
 rep.classification=await classifyBinding(db,a,{now});
 if(rep.classification.reasons.length){rep.status=STATUS.HOLD;rep.reasons=rep.classification.reasons;return finish()}
 if(mode==='readonly'){rep.reasons.push('READ_ONLY_CLASSIFICATION_ONLY');return finish()}
 // Exact existing fixture IDs/nonces are NOT disposable: refuse replay before any mutation.
 // Separate from this precheck, scenarios tracks ONLY confirmed new enqueues for cleanup.
 const expectedIds=[1,2,3,4,90,91].map(n=>ID(runId,n));
 try{
  const foundIds=await rows(db,'SELECT id FROM research_jobs WHERE id IN ('+expectedIds.map(()=>'?').join(',')+')',...expectedIds);
  const foundNonces=await rows(db,'SELECT nonce FROM internal_nonces WHERE nonce=?',`acpt-${runId}-nonce-1`);
  if(foundIds.length||foundNonces.length){
   rep.status=STATUS.HOLD;rep.reasons.push('EXISTING_RUN_FIXTURE_IDS_OR_NONCES_REPLAY_REFUSED');return finish();
  }
 }catch(e){rep.status=STATUS.HOLD;rep.reasons.push('FIXTURE_REPLAY_CHECK_FAILED');return finish()}
 const {res,ids,nonces}=await scenarios(db,runId);
 rep.scenarios=res;rep.cleanup=await cleanup(db,ids,nonces);
 const allOk=res.length>=13&&res.every(s=>s.ok)&&!rep.cleanup.error;
 // Caller-supplied approval, database marker and browser-like runtime strings cannot attest
 // actual Cloudflare tenancy, production exclusion, original provider identity or custody.
 // Only an independent, separately verified witness may admit real D1 evidence later.
 rep.status=!allOk?STATUS.FAIL:STATUS.PASSED_UNPROVEN;
 rep.realD1Proof=false;
 if(allOk)rep.reasons.push('EXTERNAL_NONPRODUCTION_D1_ATTESTATION_NOT_ESTABLISHED');
 return finish();
}
