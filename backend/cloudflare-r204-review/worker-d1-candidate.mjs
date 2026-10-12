// REVIEW-ONLY CANDIDATE. NOT DEPLOYED, NOT DEFAULT, never touches R212. worker.mjs stays byte-identical and is the fallback.
// Behaviour:
//  * env.TENS_D1_QUEUE !== 'SCHEMA_VERIFIED_V1'  -> every request is delegated unchanged to worker.mjs (today's behaviour).
//  * flag set -> the five research routes use the atomic D1 queue. A schema probe must pass first; if D1 errors or the schema
//    is not ready the routes answer 503 QUEUE_STORE_NOT_READY. There is NEVER a fallback into the shared KV index for new writes.
//  * Legacy rollover (old queue untouched, nothing stranded): /internal/claim asks the legacy queue first (oldest jobs), then D1;
//    complete/fail for a job id that exists in D1 go to D1, any other id goes to the legacy handler with its own claimToken check;
//    status reads D1 first, then the legacy handler. All new jobs are written to D1 only.
//  * PRR, share, telemetry, business and health routes are always delegated to worker.mjs untouched.
import legacy from './worker.mjs';
import {handleResearchRoute,status as d1Status,jobIdOk} from './d1-research-queue.mjs';

const UI_ORIGIN='https://asktens.com',FLAG='SCHEMA_VERIFIED_V1';
// Public verification key copied from worker.mjs PUBLIC_KEY (public, not a secret). tests/worker-d1-candidate.test.cjs fails on drift.
const PUBLIC_KEY={kty:'EC',x:'uHEtdyAVwZZ2PyDvpEkZwLHLPQmag4n-y6TN5X2bCeY',y:'quhnScSGxi54tujXAPs57oWbTnobsSW7XyE9EEUCLaw',crv:'P-256'};
const enc=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const fromB64=s=>Uint8Array.from(atob(String(s).replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-String(s).length%4)%4)),c=>c.charCodeAt(0));
const json=(data,status=200,origin=null)=>new Response(JSON.stringify({...data,providerWrite:false,productionMutation:false}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin',...(origin?{'access-control-allow-origin':origin}:{})}});
async function bodyText(r,max=524288){const n=Number(r.headers.get('content-length')||0);if(n>max)throw Error('BODY_TOO_LARGE');const t=await r.text();if(enc.encode(t).length>max)throw Error('BODY_TOO_LARGE');return t}
// Same signed message as worker.mjs verifyInternal; replay protection is done by the shared D1 nonce table instead of per-isolate memory.
export async function verifySignature(r,text,publicKey=PUBLIC_KEY){
 const ts=Number(r.headers.get('x-tens-timestamp')),nonce=String(r.headers.get('x-tens-nonce')||''),sig=String(r.headers.get('x-tens-signature')||'');
 if(!Number.isFinite(ts)||Math.abs(Date.now()-ts)>120000||!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)||!sig)return false;
 const digest=hex(await crypto.subtle.digest('SHA-256',enc.encode(String(text))));
 const msg=enc.encode(ts+'\n'+nonce+'\n'+r.method+'\n'+new URL(r.url).pathname+'\n'+digest);
 try{const key=await crypto.subtle.importKey('jwk',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromB64(sig),msg)}catch{return false}
}
// Browser sends a 32-hex per-tab token on POST /api/research. Only its SHA-256 is stored, to cap active jobs per tab.
async function sessionHash(request){
 const t=String(request.headers.get('x-tens-public-session')||'');
 if(!/^[a-f0-9]{32}$/.test(t))return false;
 return hex(await crypto.subtle.digest('SHA-256',enc.encode('tens-public-session-v1:'+t)));
}
export const REQUIRED_JOB_COLUMNS=['claim_token','claim_expires_at','claim_count','session_hash'];
let readyDb=null; // cache only positive proof, per isolate, per binding object
export async function schemaReady(db){
 if(readyDb===db)return true;
 try{
  const cols=(await db.prepare('PRAGMA table_info(research_jobs)').all()).results.map(c=>c.name);
  const nonce=(await db.prepare('PRAGMA table_info(internal_nonces)').all()).results.map(c=>c.name);
  if(!REQUIRED_JOB_COLUMNS.every(c=>cols.includes(c))||!['nonce','created_at'].every(c=>nonce.includes(c)))return false;
  readyDb=db;return true;
 }catch{return false}
}
const ROUTES=new Set(['/api/research','/api/research/status','/internal/claim','/internal/complete','/internal/fail']);
const isResearchRoute=(request,p)=>ROUTES.has(p)&&(p==='/api/research/status'?request.method==='GET':request.method==='POST');
const notReady=(request)=>json({error:'QUEUE_STORE_NOT_READY'},503,request.headers.get('origin')===UI_ORIGIN?UI_ORIGIN:null);

async function legacyClaimFirst(request,env){
 const res=await legacy.fetch(request.clone(),env);
 if(res.status!==200)return res;
 let body;try{body=await res.clone().json()}catch{return res}
 return body?.state==='CLAIMED'?res:null; // EMPTY -> continue to D1
}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url),p=u.pathname;
 if(env?.TENS_D1_QUEUE!==FLAG||!isResearchRoute(request,p))return legacy.fetch(request,env,ctx);
 if(!env.DB||!(await schemaReady(env.DB)))return notReady(request);
 const hctx={uiOrigin:UI_ORIGIN,json,bodyText,verifyInternal:(r,t)=>verifySignature(r,t),sessionHash};
 try{
  if(p==='/api/research/status'){
   if(request.headers.get('origin')!==UI_ORIGIN)return json({error:'ORIGIN_NOT_ALLOWED'},403);
   const id=u.searchParams.get('jobId');
   if(jobIdOk(id)){const s=await d1Status(env.DB,id);if(s)return json(s,200,UI_ORIGIN)}
   return legacy.fetch(request,env,ctx); // legacy jobs (KV/DB row) and 400/404 handling stay as before
  }
  if(p==='/api/research')return await handleResearchRoute(request,env,hctx);
  // internal routes: verify the signature here once, before looking at any body-derived id
  const text=await bodyText(request.clone()).catch(()=>null);
  if(text===null)return json({error:'INVALID_BODY'},400);
  if(!(await verifySignature(request,text)))return json({error:'UNAUTHORIZED'},401);
  if(p==='/internal/claim'){
   const lg=await legacyClaimFirst(request,env);if(lg)return lg;
   return await handleResearchRoute(request.clone(),env,hctx);
  }
  let b={};try{b=text?JSON.parse(text):{}}catch{return json({error:'INVALID_JSON'},400)}
  if(jobIdOk(b?.jobId)&&await d1Status(env.DB,b.jobId))return await handleResearchRoute(request.clone(),env,hctx);
  return legacy.fetch(request,env,ctx); // legacy-queue job: legacy handler re-verifies signature and enforces its own claimToken
 }catch{return notReady(request)}
}};
