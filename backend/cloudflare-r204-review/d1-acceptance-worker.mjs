// REVIEW-ONLY, NOT DEPLOYED, NOT ROUTED. Staging Worker entrypoint for d1-acceptance-harness.mjs.
// Trust comes only from owner-set Worker configuration (env), never from the request body, the marker row or navigator.userAgent.
// Mutation is compiled out (MUTATION_ENABLED=false): enabling it needs a separate code change plus an independent provider-side witness.
// Config equality below is a configuration check, NOT proof that the binding really is that D1 database or account; the report never claims real D1 proof.
import {run,STATUS} from './d1-acceptance-harness.mjs';

export const MUTATION_ENABLED=false;
export const BINDING='ACCEPTANCE_DB';
export const FORBIDDEN_BINDINGS=['DB','TENS_PUBLIC_JOBS','TENS_STATE','TENS_R212_STATE'];
export const PROTECTED_DB_NAMES=['tens-research-jobs','tens-state'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64=/^[a-f0-9]{64}$/;
const enc=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const out=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'}});
const refuse=(status,code,extra={})=>out(status,{protocol:'TENS_D1_ACCEPTANCE_REPORT_1',status:STATUS.REFUSED,code,realD1Proof:false,production:false,mutation:false,...extra});
function timingEqual(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}

/** Pure env validation. Returns {problems,approval}. Touches no binding. */
export function checkEnv(env){
 const p=[];let approval=null;
 if(!env||typeof env!=='object')return {problems:['ENV_MISSING'],approval};
 for(const b of FORBIDDEN_BINDINGS)if(env[b]!==undefined)p.push('FORBIDDEN_BINDING_PRESENT:'+b);
 if(!HEX64.test(String(env.ACCEPTANCE_AUTH_SHA256||'')))p.push('AUTH_HASH_NOT_CONFIGURED');
 if(!UUID.test(String(env.EXPECTED_D1_UUID||'')))p.push('EXPECTED_D1_UUID_NOT_CONFIGURED');
 if(!/^[a-f0-9]{32}$/.test(String(env.EXPECTED_ACCOUNT_ID||'')))p.push('EXPECTED_ACCOUNT_ID_NOT_CONFIGURED');
 if(!HEX64.test(String(env.PROTECTED_DB_UUIDS_SHA256||'')) && !String(env.PROTECTED_DB_UUIDS||'').trim())p.push('PROTECTED_DB_DENYLIST_NOT_CONFIGURED');
 try{approval=JSON.parse(String(env.APPROVAL_JSON||''))}catch{p.push('APPROVAL_JSON_INVALID')}
 if(approval){
  if(approval.databaseId!==env.EXPECTED_D1_UUID)p.push('APPROVAL_DATABASE_ID_MISMATCH');
  if(PROTECTED_DB_NAMES.includes(String(approval.databaseName||'').toLowerCase()))p.push('PROTECTED_DATABASE_NAME');
  const deny=String(env.PROTECTED_DB_UUIDS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(deny.includes(String(env.EXPECTED_D1_UUID).toLowerCase()))p.push('EXPECTED_UUID_IS_PROTECTED');
  if(deny.length)approval.productionDatabaseIds=[...new Set([...(approval.productionDatabaseIds||[]),...deny])];
  if(approval.mutationsApproved!==false)approval.mutationsApproved=false; // never forwarded as true from this entrypoint
 }
 const b=env[BINDING];
 if(!b||typeof b.prepare!=='function'||typeof b.batch!=='function')p.push('ACCEPTANCE_BINDING_ABSENT');
 return {problems:p,approval};
}

export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'')||'/';
  const routes={'/preflight':'preflight','/readonly':'readonly'};
  if(path==='/mutate'||path==='/mutation')return refuse(403,'MUTATION_DISABLED_IN_THIS_ENTRYPOINT');
  if(!(path in routes))return refuse(404,'UNKNOWN_ROUTE');
  if(request.method!=='POST')return refuse(405,'POST_ONLY');
  // 1. authenticate BEFORE reading config detail or touching any binding
  const cfg=checkEnv(env);
  if(!HEX64.test(String(env&&env.ACCEPTANCE_AUTH_SHA256||'')))return refuse(503,'NOT_CONFIGURED');
  const h=String(request.headers.get('authorization')||''),tok=h.startsWith('Bearer ')?h.slice(7).trim():'';
  if(!tok||!timingEqual(await sha(tok),env.ACCEPTANCE_AUTH_SHA256))return refuse(401,'UNAUTHENTICATED');
  // 2. body is never used for trust or config; a body is rejected rather than ignored
  const body=await request.text();if(body.length)return refuse(400,'BODY_NOT_ALLOWED');
  const mode=routes[path];
  if(mode==='preflight')return out(200,await run({mode:'preflight',config:cfg.approval?{approval:cfg.approval}:null}).then(r=>({...r,envProblems:cfg.problems,bindingTouched:false})));
  // 3. readonly only if every external configuration check passes
  if(cfg.problems.length)return refuse(403,'CONFIGURATION_REFUSED',{problems:cfg.problems});
  if(env.ACCEPTANCE_MAX_MODE!=='readonly')return refuse(403,'READONLY_NOT_AUTHORIZED_BY_CONFIGURATION');
  const rep=await run({mode:'readonly',db:env[BINDING],config:{approval:cfg.approval}});
  rep.realD1Proof=false;
  return out(200,rep);
 }
};
