'use strict';
// Offline. Fake bindings only. Proves fail-closed entrypoint behavior, not anything about Cloudflare.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'../backend/cloudflare-r204-review');
const TOKEN='t'.repeat(40),UUIDX='3fe4cf59-ccc9-4306-a3ad-4bcbd67a8a42',PROT='11111111-2222-3333-4444-555555555555';
let W;test.before(async()=>{W=await import(pathToFileURL(path.join(dir,'d1-acceptance-worker.mjs')).href)});
const now=Date.now();
function db(log){const f=()=>({bind:f,all:async()=>{log.push('all');return {results:[]}},run:async()=>{log.push('run');return {meta:{changes:0}}},first:async()=>{log.push('first');return null}});return {prepare:(s)=>{log.push('prepare:'+s.slice(0,30));return f()},batch:async()=>{log.push('batch')}}}
function env(o={},log=[]){return {ACCEPTANCE_DB:db(log),EXPECTED_D1_UUID:UUIDX,EXPECTED_ACCOUNT_ID:'a'.repeat(32),PROTECTED_DB_UUIDS:PROT,ACCEPTANCE_AUTH_SHA256:crypto.createHash('sha256').update(TOKEN).digest('hex'),ACCEPTANCE_MAX_MODE:'readonly',
 APPROVAL_JSON:JSON.stringify({schema:'TENS_D1_ACCEPTANCE_APPROVAL_V1',environment:'NONPRODUCTION_DISPOSABLE',databaseId:UUIDX,databaseName:'tens-r212-disposable-test',productionDatabaseIds:[PROT],approvedBy:'owner',approvalNonce:'n'.repeat(20),approvedAt:new Date(now-3600e3).toISOString(),expiresAt:new Date(now+3600e3).toISOString()}),...o}}
const call=(e,p,{method='POST',tok=TOKEN,body}={})=>W.default.fetch(new Request('https://x.invalid'+p,{method,body,headers:tok?{authorization:'Bearer '+tok}:{}}),e);
const j=async r=>({s:r.status,b:await r.json()});

test('unauthenticated, wrong-token, wrong-method, unknown-route never touch the binding',async()=>{
 const log=[];const e=env({},log);
 for(const [p,o,s] of [['/readonly',{tok:null},401],['/readonly',{tok:'x'.repeat(40)},401],['/readonly',{tok:'short'},401],['/readonly',{method:'GET'},405],['/nope',{},404]]){const r=await j(await call(e,p,o));assert.equal(r.s,s,p+JSON.stringify(o));assert.equal(r.b.realD1Proof,false)}
 assert.deepEqual(log,[]);
});
test('unconfigured auth hash fails closed with 503',async()=>{const r=await j(await call(env({ACCEPTANCE_AUTH_SHA256:undefined}),'/readonly'));assert.equal(r.s,503)});
test('preflight authenticated: no D1 I/O, NOT_RUN, never proof',async()=>{
 const log=[];const r=await j(await call(env({},log),'/preflight'));assert.equal(r.s,200);assert.equal(r.b.status,'NOT_RUN_NO_REAL_D1_PROOF');assert.equal(r.b.realD1Proof,false);assert.equal(r.b.bindingTouched,false);assert.deepEqual(log,[]);
});
test('readonly needs explicit ACCEPTANCE_MAX_MODE=readonly',async()=>{const log=[];const r=await j(await call(env({ACCEPTANCE_MAX_MODE:undefined},log),'/readonly'));assert.equal(r.s,403);assert.equal(r.b.code,'READONLY_NOT_AUTHORIZED_BY_CONFIGURATION');assert.deepEqual(log,[])});
test('mutate is disabled even with every config and token',async()=>{
 const log=[];for(const p of ['/mutate','/mutation']){const r=await j(await call(env({ACCEPTANCE_MAX_MODE:'mutate'},log),p));assert.equal(r.s,403);assert.equal(r.b.code,'MUTATION_DISABLED_IN_THIS_ENTRYPOINT')}
 assert.equal(W.MUTATION_ENABLED,false);assert.deepEqual(log,[]);
});
test('request body, query and headers cannot supply config or mode',async()=>{
 const log=[];const e=env({},log);
 let r=await j(await call(e,'/readonly',{body:JSON.stringify({approval:{databaseId:'x'},mode:'mutate'})}));assert.equal(r.s,400);
 r=await j(await call(e,'/readonly?mode=mutate&databaseId=zzz'));assert.ok(r.s===200||r.s===403);assert.notEqual(r.b.mode,'mutate');assert.ok(!log.some(l=>/INSERT|UPDATE|DELETE/.test(l)));
});
test('configuration refusals: forbidden/production bindings, id mismatch, protected names and ids, missing pieces',async()=>{
 const bad={prodDB:{DB:{}},kv:{TENS_PUBLIC_JOBS:{}},state:{TENS_STATE:{}},noBinding:{ACCEPTANCE_DB:undefined},mismatch:{EXPECTED_D1_UUID:'aaaaaaaa-ccc9-4306-a3ad-4bcbd67a8a42'},prodName:{APPROVAL_JSON:JSON.stringify({databaseId:UUIDX,databaseName:'TENS-Research-Jobs'})},protectedId:{PROTECTED_DB_UUIDS:UUIDX},noDeny:{PROTECTED_DB_UUIDS:''},noAcct:{EXPECTED_ACCOUNT_ID:'x'},badApproval:{APPROVAL_JSON:'{'}};
 for(const [k,o] of Object.entries(bad)){const log=[];const r=await j(await call(env(o,log),'/readonly'));assert.equal(r.s,403,k);assert.equal(r.b.code,'CONFIGURATION_REFUSED',k);assert.equal(r.b.realD1Proof,false);assert.deepEqual(log,[],k)}
});
test('marker row and navigator.userAgent cannot create trust or a PASS',async()=>{
 const had=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Cloudflare-Workers'},configurable:true});
 try{const log=[];const r=await j(await call(env({},log),'/readonly'));assert.equal(r.s,200);assert.equal(r.b.realD1Proof,false);assert.notEqual(r.b.status,'PASS_REAL_D1_WITNESSED_NONPRODUCTION');
  assert.ok(r.b.reasons.includes('MARKER_NOT_EXACTLY_ONE_ROW')||r.b.status==='HOLD');assert.ok(!log.some(l=>/INSERT|UPDATE|DELETE|batch/.test(l)))}
 finally{if(had)Object.defineProperty(globalThis,'navigator',had);else delete globalThis.navigator}
});
test('mutationsApproved from env is forced false; source has no network/secret/mutation path',()=>{
 const {problems,approval}=W.checkEnv(env({APPROVAL_JSON:JSON.stringify({databaseId:UUIDX,databaseName:'d',mutationsApproved:true})}));assert.equal(approval.mutationsApproved,false);assert.ok(Array.isArray(problems));
 const s=fs.readFileSync(path.join(dir,'d1-acceptance-worker.mjs'),'utf8').split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
 assert.ok(!/(?<!async )fetch\(|process\.env|mode:'mutate'|mutate'\s*,|INSERT|DELETE|ALTER/i.test(s.replace(/'\/mutate'/g,'').replace(/\/mutation/g,'')));
 assert.ok(!fs.existsSync(path.join(dir,'wrangler.toml')));
});
