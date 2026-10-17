// REVIEW-ONLY, NOT DEPLOYED. Atomic D1 queue for /api/research and /internal/{claim,complete,fail}.
// Replaces the shared KV index read-modify-write in worker.mjs (queue:index:v1) which loses concurrent updates.
// Every state transition is ONE conditional SQL statement, so D1/SQLite serializes it.
// Needs columns from d1-queue-migration.sql. Preserves the public response shapes of worker.mjs.
export const MAX_ACTIVE=50,TTL_MS=86400000,CLAIM_MS=600000,MAX_QUESTION=1200,MAX_RESULT_CHARS=500000,NONCE_MS=300000;
export const jobIdOk=x=>/^R20[23]WEB_[A-Za-z0-9_-]{20,80}$/.test(String(x||''));
export function resultOk(x){return !!x&&x.protocol==='TENS_R202_PUBLIC_RESULT_1'&&x.state==='COMPLETE'&&x.providerWrite===false&&x.productionMutation===false&&typeof x.assignmentId==='string'&&typeof x.checkpointHash==='string'&&Array.isArray(x.verified)&&Array.isArray(x.unknowns)&&Array.isArray(x.sources)}
// Offline candidate guard. Structural attestations are NOT independent proof of source custody.
const HEX64=/^[a-f0-9]{64}$/i, EVIDENCE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/;
function safeHttpsSourceUrl(raw){
 if(typeof raw!=='string')return false;
 try{
  const u=new URL(raw),h=u.hostname.toLowerCase().replace(/\.+$/,'');
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&
   h.includes('.')&&h!=='localhost'&&!/\.(localhost|local|internal|lan|home|corp|test|invalid)$/.test(h)&&
   !/^(\d+\.){3}\d+$/.test(h)&&!h.startsWith('[');
 }catch{return false}
}
// Every cited public source must have a complete content hash, distinct ID, and safe URL syntax.
// This cannot establish true public accessibility, original-byte custody or the truth of a finding.
export function sourceProblem(r){
 if(!r||!Array.isArray(r.sources)||!Array.isArray(r.verified))return 'RESULT_MALFORMED';
 const ids=new Set();
 for(const x of r.sources){
  if(!x||typeof x.evidenceId!=='string'||!EVIDENCE_ID.test(x.evidenceId)||x.preservationVerified!==true)return 'SOURCE_NOT_PRESERVED';
  if(ids.has(x.evidenceId))return 'SOURCE_DUPLICATE';
  if(typeof x.contentHash!=='string'||!HEX64.test(x.contentHash))return 'SOURCE_HASH_MISSING';
  if(x.sourceKind!=='PUBLIC_WEB'&&x.sourceKind!=='ARCHIVED_PUBLIC_RECORD')return 'SOURCE_KIND_INVALID';
  if(x.sourceKind==='PUBLIC_WEB'&&!safeHttpsSourceUrl(x.url))return 'SOURCE_NOT_PUBLIC';
  if(x.url!==undefined&&x.url!==null&&!safeHttpsSourceUrl(x.url))return 'SOURCE_URL_UNSAFE';
  ids.add(x.evidenceId);
 }
 for(const v of r.verified){
  if(!Array.isArray(v?.evidenceRefs)||!v.evidenceRefs.length||!v.evidenceRefs.every(i=>typeof i==='string'&&ids.has(i)))return 'VERIFIED_UNCITED';
 }
 // A COMPLETE result may be evidence-free only when it makes no verified claim.
 // Never persist orphan source cards or an explicit contradictory answer.
 if(r.sources.length>0&&r.verified.length===0)return 'SOURCE_UNCITED';
 if(r.answer==='VERIFIED'&&r.verified.length===0)return 'ANSWER_CONFLICT';
 if(r.answer==='UNKNOWN'&&r.verified.length>0)return 'ANSWER_CONFLICT';
 return '';
}
const changes=r=>Number(r?.meta?.changes??r?.changes??0);

export const MAX_PER_SESSION=3;
export async function enqueue(db,{id,question,now=Date.now(),maxActive=MAX_ACTIVE,sessionHash=null,perSession=MAX_PER_SESSION}){
 const r=await db.prepare("INSERT INTO research_jobs(id,question,state,result_json,error_code,created_at,updated_at,session_hash) SELECT ?1,?2,'QUEUED',NULL,NULL,?3,?3,?6 WHERE (SELECT COUNT(*) FROM research_jobs WHERE state IN ('QUEUED','RUNNING') AND created_at>?4)<?5 AND (?6 IS NULL OR (SELECT COUNT(*) FROM research_jobs WHERE session_hash=?6 AND state IN ('QUEUED','RUNNING') AND created_at>?4)<?7)").bind(id,question,now,now-TTL_MS,maxActive,sessionHash,perSession).run();
 if(changes(r)===1)return {state:'QUEUED',jobId:id};
 if(sessionHash){const c=await db.prepare("SELECT COUNT(*) AS n FROM research_jobs WHERE session_hash=?1 AND state IN ('QUEUED','RUNNING') AND created_at>?2").bind(sessionHash,now-TTL_MS).first();if(Number(c?.n)>=perSession)return {error:'SESSION_QUEUE_BUSY'}}
 return {error:'RESEARCH_QUEUE_BUSY'};
}
// Optional exact-ID scope protects disposable test work from claims/expiry on foreign rows.
const validJobScope=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=32&&
 new Set(ids).size===ids.length&&ids.every(jobIdOk);
const scopeClause=ids=>ids===null?'':' AND id IN ('+ids.map(()=>'?').join(',')+')';
export async function expireStale(db,now=Date.now(),scopeJobIds=null){
 if(scopeJobIds!==null&&!validJobScope(scopeJobIds))throw new Error('INVALID_JOB_SCOPE');
 const r=await db.prepare("UPDATE research_jobs SET state='FAILED',error_code='EXPIRED_UNCLAIMED',claim_token=NULL,claim_expires_at=NULL,updated_at=?1 WHERE state IN ('QUEUED','RUNNING') AND created_at<=?2 AND (state='QUEUED' OR claim_expires_at<=?1)"+scopeClause(scopeJobIds)).bind(now,now-TTL_MS,...(scopeJobIds||[])).run();
 return changes(r);
}
export async function claim(db,{now=Date.now(),token=crypto.randomUUID(),scopeJobIds=null}={}){
 if(scopeJobIds!==null&&!validJobScope(scopeJobIds))return {state:'REFUSED',error:'INVALID_JOB_SCOPE'};
 await expireStale(db,now,scopeJobIds);
 const row=await db.prepare("UPDATE research_jobs SET state='RUNNING',claim_token=?1,claim_expires_at=?2,claim_count=claim_count+1,updated_at=?3 WHERE id=(SELECT id FROM research_jobs WHERE (state='QUEUED' OR (state='RUNNING' AND claim_expires_at<=?3))"+scopeClause(scopeJobIds)+" ORDER BY created_at ASC,id ASC LIMIT 1) AND (state='QUEUED' OR (state='RUNNING' AND claim_expires_at<=?3)) RETURNING id,question,claim_token,claim_expires_at,claim_count").bind(token,now+CLAIM_MS,now,...(scopeJobIds||[])).first();
 if(!row)return {state:'EMPTY',retryAfterMs:5000};
 return {state:'CLAIMED',jobId:row.id,question:row.question,claimToken:row.claim_token,claimExpiresAt:row.claim_expires_at,reclaimed:Number(row.claim_count)>1};
}
// A lease must still be valid at commit time, even if no other worker has reclaimed it. A reclaimed job also rotates its token.
export async function complete(db,{jobId,claimToken,result,now=Date.now()}){
 if(!jobIdOk(jobId)||!resultOk(result))return {status:400,error:'RESULT_SCHEMA_REJECTED'};
 const payload=JSON.stringify(result);if(payload.length>MAX_RESULT_CHARS)return {status:413,error:'RESULT_TOO_LARGE'};
 const sp=sourceProblem(result);if(sp)return {status:400,error:'RESULT_NOT_SOURCE_BACKED_'+sp};
 if(typeof claimToken!=='string'||!claimToken)return {status:409,error:'JOB_STATE_CONFLICT'};
 const r=await db.prepare("UPDATE research_jobs SET state='COMPLETE',result_json=?1,error_code=NULL,claim_token=NULL,claim_expires_at=NULL,updated_at=?2 WHERE id=?3 AND state='RUNNING' AND claim_token=?4 AND claim_expires_at>?2").bind(payload,now,jobId,claimToken).run();
 return changes(r)===1?{status:200,state:'COMPLETE_ACCEPTED'}:{status:409,error:'JOB_STATE_CONFLICT'};
}
export async function fail(db,{jobId,claimToken,errorCode,now=Date.now()}){
 if(!jobIdOk(jobId))return {status:400,error:'JOB_ID_INVALID'};
 if(typeof claimToken!=='string'||!claimToken)return {status:409,error:'JOB_STATE_CONFLICT'};
 const r=await db.prepare("UPDATE research_jobs SET state='FAILED',result_json=NULL,error_code=?1,claim_token=NULL,claim_expires_at=NULL,updated_at=?2 WHERE id=?3 AND state='RUNNING' AND claim_token=?4 AND claim_expires_at>?2").bind(String(errorCode||'R203_LOCAL_HOLD').slice(0,120),now,jobId,claimToken).run();
 return changes(r)===1?{status:200,state:'FAILURE_ACCEPTED'}:{status:409,error:'JOB_STATE_CONFLICT'};
}
// Pass {now} to lazily expire THIS job only (exact-id scope) so an abandoned job is never reported QUEUED past TTL. Omitted now = pure read.
// Pass {sessionHash} (string) to require the job's stored session_hash to match BEFORE any expiry write or data read; mismatch/absent => null (same as not found).
export async function exists(db,id){return !!(jobIdOk(id)&&await db.prepare('SELECT 1 AS x FROM research_jobs WHERE id=?').bind(id).first())}
export async function status(db,id,{now,sessionHash}={}){
 if(sessionHash!==undefined){
  if(typeof sessionHash!=='string'||!/^[a-f0-9]{64}$/.test(sessionHash)||!jobIdOk(id))return null;
  const own=await db.prepare('SELECT session_hash FROM research_jobs WHERE id=?').bind(id).first();
  if(!own||own.session_hash!==sessionHash)return null;
 }
 if(now!==undefined&&jobIdOk(id))await expireStale(db,now,[id]);
 const row=await db.prepare('SELECT id,state,result_json,error_code,created_at,updated_at FROM research_jobs WHERE id=?').bind(id).first();
 if(!row)return null;let result=null;if(row.result_json){try{result=JSON.parse(row.result_json)}catch{}}
 return {jobId:row.id,state:row.state,result,errorCode:row.error_code||null,createdAt:row.created_at,updatedAt:row.updated_at};
}
// Cross-isolate replay protection (the in-memory seenNonces map in worker.mjs is per isolate only).
export async function consumeNonce(db,nonce,now=Date.now(),{pruneExpired=true}={}){
 // The disposable acceptance harness must never prune unrelated historical nonces.
 if(pruneExpired)await db.prepare('DELETE FROM internal_nonces WHERE created_at<?').bind(now-NONCE_MS).run();
 const r=await db.prepare('INSERT OR IGNORE INTO internal_nonces(nonce,created_at) VALUES(?,?)').bind(String(nonce),now).run();
 return changes(r)===1;
}

/**
 * Route handler for the five contract routes. Returns a Response, or null when the path is not one of them.
 * ctx supplies worker.mjs primitives so no signing material lives here:
 *  { uiOrigin, verifyInternal(request,text,env)->Promise<boolean>, bodyText(request,max), json(data,status,origin) }
 * Wiring (NOT done): in worker.mjs fetch(), call this first for these paths; drop readQueue/writeQueue/addQueue/markQueue use.
 */
export async function handleResearchRoute(request,env,ctx){
 const u=new URL(request.url),p=u.pathname,m=request.method,{uiOrigin,json}=ctx,origin=request.headers.get('origin');
 const isPublic=(p==='/api/research'&&m==='POST')||(p==='/api/research/status'&&m==='GET');
 const isInternal=['/internal/claim','/internal/complete','/internal/fail'].includes(p)&&m==='POST';
 if(!isPublic&&!isInternal)return null;
 if(!env?.DB)return json({error:'QUEUE_STORE_UNAVAILABLE'},503,isPublic?uiOrigin:null);
 if(isPublic){
  if(origin!==uiOrigin)return json({error:'ORIGIN_NOT_ALLOWED'},403);
  if(p==='/api/research'){
   let b;try{b=JSON.parse(await ctx.bodyText(request,8192)||'{}')}catch{return json({error:'INVALID_JSON'},400,uiOrigin)}
   const q=String(b?.question||'').trim();if(!q||q.length>MAX_QUESTION)return json({error:'QUESTION_INVALID'},400,uiOrigin);
   // fail closed: a resolver is mandatory and must yield a 64-hex hash; no anonymous (NULL session_hash) enqueue
   const sessionHash=typeof ctx.sessionHash==='function'?await ctx.sessionHash(request):false;
   if(typeof sessionHash!=='string'||!/^[a-f0-9]{64}$/.test(sessionHash))return json({error:'SESSION_REQUIRED'},400,uiOrigin);
   const id='R203WEB_'+crypto.randomUUID().replace(/-/g,''),r=await enqueue(env.DB,{id,question:q,sessionHash});
   return r.error?json({error:r.error},r.error==='SESSION_QUEUE_BUSY'?429:503,uiOrigin):json({jobId:id,state:'QUEUED'},202,uiOrigin);
  }
  const id=u.searchParams.get('jobId');
  if([...u.searchParams.keys()].some(k=>k!=='jobId')||!jobIdOk(id))return json({error:'JOB_ID_INVALID'},400,uiOrigin);
  // fail closed: the public status route needs a session resolver and a matching token; no resolver => uniform 404, no read, no expiry write
  const sh=typeof ctx.sessionHash==='function'?await ctx.sessionHash(request):false;
  const s=sh===false||sh==null?null:await status(env.DB,id,{now:Date.now(),sessionHash:sh});return s?json(s,200,uiOrigin):json({error:'NOT_FOUND'},404,uiOrigin);
 }
 let text;try{text=await ctx.bodyText(request)}catch{return json({error:'INVALID_BODY'},400)}
 if(!(await ctx.verifyInternal(request,text,env)))return json({error:'UNAUTHORIZED'},401);
 if(!(await consumeNonce(env.DB,request.headers.get('x-tens-nonce'))))return json({error:'UNAUTHORIZED'},401);
 let b={};if(text){try{b=JSON.parse(text)}catch{return json({error:'INVALID_JSON'},400)}}
 if(p==='/internal/claim')return json(await claim(env.DB));
 const r=p==='/internal/complete'?await complete(env.DB,b):await fail(env.DB,b);
 return r.error?json({error:r.error},r.status):json({state:r.state});
}
