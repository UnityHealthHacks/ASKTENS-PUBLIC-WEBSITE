'use strict';
// Offline, fake transport. Proves the invoker's fail-closed and no-token-leak behavior only; nothing about Cloudflare.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const file=path.resolve(__dirname,'../tools/d1-acceptance-invoke.mjs');
const TOKEN='S3cretTokenValue_'+'z'.repeat(30),NOW=Date.parse('2026-10-14T23:00:00Z');
let I;test.before(async()=>{I=await import(pathToFileURL(file).href)});
const cfg=(mode='readonly',o={})=>{const c={accountId:'a'.repeat(32),observedAccountId:'a'.repeat(32),protectedAccountIds:['b'.repeat(32)],databaseId:'3fe4cf59-ccc9-4306-a3ad-4bcbd67a8a42',expectedDatabaseId:'3fe4cf59-ccc9-4306-a3ad-4bcbd67a8a42',protectedDatabaseIds:['11111111-2222-3333-4444-555555555555'],workerName:'tens-r212-d1-isolated-test-20261014',workersDevSubdomain:'owner-sub',consentExpiresAt:new Date(NOW+1800e3).toISOString(),...o};if(!('consent' in o))c.consent=I.consentPhrase(mode,c);return c};
const rep=(o={})=>({protocol:'TENS_D1_ACCEPTANCE_REPORT_1',mode:'readonly',status:'NOT_RUN_NO_REAL_D1_PROOF',realD1Proof:false,production:false,network:false,migrationsApplied:false,otherTablesTouched:false,scenarios:[],...o});
const resp=(status,body,headers)=>({status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
function spy(res){const calls=[];return {calls,transport:async(u,i)=>{calls.push([u,i]);return typeof res==='function'?res(u,i):res}}}
const go=(mode,c,t,...rest)=>{const tok=rest.length?rest[0]:TOKEN;let asked=0;return I.invoke({config:c,mode,getToken:()=>{asked++;return tok},transport:t.transport,now:NOW}).then(r=>({r,asked}))};

test('valid readonly: one POST to the exact pinned host, token only in header, report relayed, never proof',async()=>{
 const t=spy(resp(200,rep()));const {r}=await go('readonly',cfg(),t);
 assert.equal(t.calls.length,1);assert.equal(t.calls[0][0],'https://tens-r212-d1-isolated-test-20261014.owner-sub.workers.dev/readonly');
 assert.equal(t.calls[0][1].redirect,'manual');assert.equal(t.calls[0][1].method,'POST');assert.equal(t.calls[0][1].body,'');
 assert.deepEqual(r.problems,[]);assert.equal(r.realD1Proof,false);assert.equal(r.independentWitness,'REQUIRED_NOT_PROVIDED');assert.match(r.receiptSha256,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(r).includes(TOKEN));
});
test('wrong or unobserved account, protected account/database, mismatched db, bad worker name/consent: no token read, no request',async()=>{
 const bad={accountMismatch:{observedAccountId:'c'.repeat(32)},unobserved:{observedAccountId:undefined},protAcct:{protectedAccountIds:['a'.repeat(32)]},noAcctDeny:{protectedAccountIds:[]},dbMismatch:{expectedDatabaseId:'aaaaaaaa-ccc9-4306-a3ad-4bcbd67a8a42'},protDb:{protectedDatabaseIds:['3FE4CF59-ccc9-4306-a3ad-4bcbd67a8a42']},noDbDeny:{protectedDatabaseIds:[]},prodWorker:{workerName:'tens-api'},badWorker:{workerName:'x'},hostInject:{workersDevSubdomain:'evil.example.com/x'},noConsent:{consent:undefined},wrongConsent:{consent:'yes'},expired:{consentExpiresAt:new Date(NOW-1).toISOString()},tooLong:{consentExpiresAt:new Date(NOW+7200e3).toISOString()}};
 for(const [k,o] of Object.entries(bad)){const t=spy(resp(200,rep()));const {r,asked}=await go('readonly',cfg('readonly',o),t);assert.equal(t.calls.length,0,k);assert.equal(asked,0,k);assert.equal(r.sent,false,k);assert.ok(r.problems.length,k)}
});
test('consent is bound to the mode, so a readonly consent cannot authorize preflight and vice versa',async()=>{
 const c=cfg('readonly');const t=spy(resp(200,rep()));const {r}=await go('preflight',c,t);assert.ok(r.problems.includes('OWNER_CONSENT_PHRASE_MISSING_OR_WRONG'));assert.equal(t.calls.length,0);
});
test('mutate and unknown modes are refused before anything happens',async()=>{
 for(const m of ['mutate','mutation','x']){const t=spy(resp(200,rep()));const {r,asked}=await go(m,cfg(),t);assert.equal(t.calls.length,0);assert.equal(asked,0);assert.ok(r.problems[0].match(/MUTATION_NOT_SUPPORTED|MODE_UNKNOWN/))}
});
test('malformed tokens are rejected without any request',async()=>{
 for(const tok of ['short','a b'+'c'.repeat(40),'x'.repeat(300),'',null,undefined]){const t=spy(resp(200,rep()));const {r}=await go('readonly',cfg(),t,tok);assert.equal(t.calls.length,0);assert.deepEqual(r.problems,['TOKEN_FORMAT_REJECTED'])}
});
test('redirect is refused and not followed',async()=>{const t=spy(resp(302,''));const {r}=await go('readonly',cfg(),t);assert.equal(t.calls.length,1);assert.deepEqual(r.problems,['REDIRECT_REFUSED'])});
test('401/403/503 and non-JSON are failures; no report body is relayed',async()=>{
 for(const [s,b] of [[401,{code:'UNAUTHENTICATED',realD1Proof:false}],[403,{code:'CONFIGURATION_REFUSED',problems:['x'],realD1Proof:false,protocol:'TENS_D1_ACCEPTANCE_REPORT_1'}],[503,'oops']]){const {r}=await go('readonly',cfg(),spy(resp(s,b)));assert.ok(r.problems.length,String(s));assert.ok(r.problems.some(x=>x==='HTTP_'+s||x==='REPLY_NOT_JSON'||x.startsWith('REPORT_')))}
});
test('a reply claiming PASS, real proof, effects or mutation scenarios is rejected, not relayed',async()=>{
 for(const o of [{realD1Proof:true},{status:'PASS_REAL_D1_WITNESSED_NONPRODUCTION'},{production:true},{mutation:true},{scenarios:[{name:'x',ok:true}]},{mode:'mutate'},{protocol:'OTHER'}]){const {r}=await go('readonly',cfg(),spy(resp(200,rep(o))));assert.ok(r.problems.length,JSON.stringify(o));assert.equal(r.realD1Proof,false);assert.ok(!r.report||!('scenarios' in r.report))}
});
test('token echoed by a hostile reply or error is scrubbed from the receipt',async()=>{
 let {r}=await go('readonly',cfg(),spy(resp(200,rep({echo:'tok '+TOKEN}))));assert.ok(!JSON.stringify(r).includes(TOKEN));
 ({r}=await go('readonly',cfg(),{transport:async()=>{throw new Error('boom Bearer '+TOKEN+' '+TOKEN)}}));assert.ok(!JSON.stringify(r).includes(TOKEN));assert.ok(r.problems[0].startsWith('TRANSPORT_ERROR'));
});
test('source: no argv/env token path, no logging of the token, no git-tracked secrets, no mutation route',()=>{
 const s=fs.readFileSync(file,'utf8').split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
 assert.ok(!/process\.env/.test(s));assert.ok(!/console\.(log|error)\([^)]*\b(tok|getToken)\b/.test(s));assert.ok(!/\/mutate'|\/mutation'/.test(s.replace(/'mutate'|'mutation'/g,'')));
 assert.match(s,/--token-stdin/);assert.match(s,/flag:'wx'/);
});
