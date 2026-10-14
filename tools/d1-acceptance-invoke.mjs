#!/usr/bin/env node
// REVIEW-ONLY, OWNER-LOCAL. One-shot invoker for the staging d1-acceptance-worker (preflight/readonly ONLY; there is no mutate path here).
// The bearer token is read from stdin only (never argv, env, files in git, or logs), kept in memory, sent once over HTTPS to one exact
// pinned workers.dev host, and scrubbed from every output. Redirects are refused so the token cannot be forwarded elsewhere.
// This tool cannot verify the Cloudflare account or database; it checks owner-supplied pins against each other. It never reports real D1 proof.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const MODES=['preflight','readonly'];
export const PROTECTED_NAMES=['tens-api','tens-research-jobs','tens-state'];
const HEX32=/^[a-f0-9]{32}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,WORKER=/^[a-z0-9][a-z0-9-]{2,62}$/,SUB=/^[a-z0-9][a-z0-9-]{0,62}$/;
const sha=s=>createHash('sha256').update(s).digest('hex');
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
export const consentPhrase=(mode,c)=>`INVOKE ${mode} ${c.workerName} ${c.accountId}`;

/** Pure. Reasons the owner config or requested mode may not be used. Touches nothing. */
export function validateConfig(c,mode,{now=Date.now()}={}){
 const p=[];
 if(!MODES.includes(mode))return [mode==='mutate'||mode==='mutation'?'MUTATION_NOT_SUPPORTED_BY_THIS_TOOL':'MODE_UNKNOWN'];
 if(!c||typeof c!=='object')return ['CONFIG_MISSING'];
 if(!HEX32.test(String(c.accountId||'')))p.push('ACCOUNT_ID_INVALID');
 if(!HEX32.test(String(c.observedAccountId||''))||c.observedAccountId!==c.accountId)p.push('ACCOUNT_MISMATCH_OR_UNOBSERVED');
 if(Array.isArray(c.protectedAccountIds)&&c.protectedAccountIds.includes(c.accountId))p.push('ACCOUNT_IS_PROTECTED');
 if(!Array.isArray(c.protectedAccountIds)||!c.protectedAccountIds.length)p.push('PROTECTED_ACCOUNT_DENYLIST_REQUIRED');
 if(!UUID.test(String(c.databaseId||''))||!UUID.test(String(c.expectedDatabaseId||''))||c.databaseId!==c.expectedDatabaseId)p.push('DATABASE_ID_MISMATCH');
 if(Array.isArray(c.protectedDatabaseIds)&&c.protectedDatabaseIds.map(x=>String(x).toLowerCase()).includes(String(c.databaseId).toLowerCase()))p.push('DATABASE_IS_PROTECTED');
 if(!Array.isArray(c.protectedDatabaseIds)||!c.protectedDatabaseIds.length)p.push('PROTECTED_DATABASE_DENYLIST_REQUIRED');
 if(!WORKER.test(String(c.workerName||''))||PROTECTED_NAMES.includes(c.workerName))p.push('WORKER_NAME_REFUSED');
 if(!SUB.test(String(c.workersDevSubdomain||'')))p.push('SUBDOMAIN_INVALID');
 if(c.consent!==consentPhrase(mode,c))p.push('OWNER_CONSENT_PHRASE_MISSING_OR_WRONG');
 const t=Date.parse(c.consentExpiresAt);if(!(t>now)||!(t-now<=3600e3))p.push('CONSENT_WINDOW_INVALID');
 return p;
}
/** The only URL this tool will ever send a token to. */
export function targetUrl(c,mode){return `https://${c.workerName}.${c.workersDevSubdomain}.workers.dev/${mode}`}

const SCRUB=(s,tok)=>{let t=String(s);if(tok)t=t.split(tok).join('[REDACTED]');return t.replace(/Bearer\s+\S+/gi,'******')};
/** Validates the Worker's reply. Anything that claims real proof or a mutation is rejected rather than relayed. */
export function checkReport(r,mode){
 const p=[];
 if(!r||typeof r!=='object')return ['REPORT_NOT_JSON_OBJECT'];
 if(r.protocol!=='TENS_D1_ACCEPTANCE_REPORT_1')p.push('REPORT_PROTOCOL_UNEXPECTED');
 if(r.realD1Proof!==false)p.push('REPORT_CLAIMS_OR_OMITS_REAL_PROOF_FLAG');
 if(r.mode!==undefined&&r.mode!==mode)p.push('REPORT_MODE_MISMATCH');
 // HTTP success is not permission to turn HOLD/REFUSED/FAIL into a green audit.
 if(r.status!=='NOT_RUN_NO_REAL_D1_PROOF')p.push('REPORT_STATUS_NOT_SAFE_NONPROOF');
 if(r.production===true||r.network===true||r.migrationsApplied===true||r.otherTablesTouched===true||r.mutation===true)p.push('REPORT_CLAIMS_FORBIDDEN_EFFECT');
 if(Array.isArray(r.scenarios)&&r.scenarios.length)p.push('REPORT_CONTAINS_MUTATION_SCENARIOS');
 const expectedReason=mode==='readonly'?'READ_ONLY_CLASSIFICATION_ONLY':'PREFLIGHT_ONLY_NO_BINDING_ACCESSED';
 if(!Array.isArray(r.reasons)||r.reasons.length!==1||r.reasons[0]!==expectedReason)p.push('REPORT_REASONS_UNEXPECTED_FOR_MODE');
 if(mode==='readonly'){
  const c=r.classification;
  if(!c||typeof c!=='object'||Array.isArray(c))p.push('READONLY_CLASSIFICATION_MISSING');
  else{
   if(c.marker!=='MATCHES_OWNER_APPROVAL')p.push('READONLY_MARKER_NOT_MATCHED');
   if(!Array.isArray(c.reasons)||c.reasons.length)p.push('READONLY_CLASSIFICATION_REASONS_NOT_CLEAR');
   if(!Array.isArray(c.missingColumns)||c.missingColumns.length)p.push('READONLY_SCHEMA_GAPS_OR_UNKNOWN');
   if(c.foreignActiveJobs!==0)p.push('READONLY_ACTIVE_JOBS_NOT_ZERO');
   if(!Array.isArray(c.jobColumns)||!['id','question','state','result_json','error_code','created_at','updated_at','claim_token','claim_expires_at','session_hash','claim_count'].every(x=>c.jobColumns.includes(x)))p.push('READONLY_JOB_COLUMNS_UNVERIFIED');
   if(!Array.isArray(c.nonceColumns)||!['nonce','created_at'].every(x=>c.nonceColumns.includes(x)))p.push('READONLY_NONCE_COLUMNS_UNVERIFIED');
  }
 }
 if(mode==='preflight'){
  if(r.bindingTouched!==false)p.push('PREFLIGHT_BINDING_ACCESS_NOT_REFUTED');
  if(!Array.isArray(r.envProblems)||r.envProblems.length)p.push('PREFLIGHT_ENVIRONMENT_PROBLEMS');
  if(!Array.isArray(r.approvalProblems)||r.approvalProblems.length)p.push('PREFLIGHT_APPROVAL_PROBLEMS');
 }
 return p;
}

/** transport(url,init)->Response-like. getToken()->string, called only after all validation passes. */
export async function invoke({config,mode,getToken,transport=globalThis.fetch,now=Date.now()}){
 const out={protocol:'TENS_D1_ACCEPTANCE_INVOKE_RECEIPT_1',mode,sent:false,httpStatus:null,realD1Proof:false,independentWitness:'REQUIRED_NOT_PROVIDED',problems:[],report:null,at:new Date(now).toISOString()};
 const pre=validateConfig(config,mode,{now});
 if(pre.length){out.problems=pre;return finish(out)}
 if(typeof getToken!=='function'||typeof transport!=='function'){out.problems=['TOKEN_SOURCE_OR_TRANSPORT_MISSING'];return finish(out)}
 let tok=await getToken();
 if(typeof tok!=='string'||tok.length<32||tok.length>200||/\s/.test(tok)){tok=null;out.problems=['TOKEN_FORMAT_REJECTED'];return finish(out)}
 try{
  out.sent=true;
  const res=await transport(targetUrl(config,mode),{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+tok},body:''});
  out.httpStatus=res.status;
  if(res.status>=300&&res.status<400){out.problems=['REDIRECT_REFUSED']}
  else{
   let body=null;try{body=JSON.parse(SCRUB(await res.text(),tok))}catch{out.problems.push('REPLY_NOT_JSON')}
   if(body){const bad=checkReport(body,mode);if(res.status===200&&!bad.length)out.report=body;else{out.problems.push(...bad);if(res.status!==200)out.problems.push('HTTP_'+res.status);out.report={code:body.code||null,status:body.status||null}}}
  }
 }catch(e){out.problems=['TRANSPORT_ERROR:'+SCRUB(e&&e.message||e,tok).slice(0,80)]}
 finally{tok=null}
 return finish(out);
}
function finish(o){o.receiptSha256=sha(stable({...o,receiptSha256:undefined}));return o}

async function readStdinLine(){let s='';for await(const c of process.stdin){s+=c;if(s.includes('\n'))break}return s.split(/\r?\n/)[0].trim()}
async function main(argv){
 const a=argv.slice(2),get=k=>{const i=a.indexOf(k);return i>=0?a[i+1]:null};
 const mode=get('--mode'),cfgPath=get('--config'),receipt=get('--receipt');
 if(!a.includes('--token-stdin')||!cfgPath||!mode){console.error('usage: <token on stdin> node tools/d1-acceptance-invoke.mjs --token-stdin --mode preflight|readonly --config owner-config.json [--receipt new-file.json]');return 2}
 if(a.some(x=>/^--(token|bearer|auth)(=|$)/.test(x))){console.error('Refused: tokens are accepted on stdin only.');return 2}
 const r=await invoke({config:JSON.parse(readFileSync(cfgPath,'utf8')),mode,getToken:readStdinLine});
 const text=JSON.stringify(r,null,1);console.log(text);
 if(receipt)writeFileSync(receipt,text+'\n',{flag:'wx'});
 return r.problems.length?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv).then(c=>process.exit(c),e=>{console.error('ERROR',String(e&&e.message||e).slice(0,100));process.exit(1)});
