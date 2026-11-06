'use strict';
// AG182 negative tests: NO Cloudflare use, no credentials, no provider side effects.
const {test}=require('node:test');const assert=require('node:assert/strict');
const path=require('node:path');const {pathToFileURL}=require('node:url');
let I;
test.before(async()=>{I=await import(pathToFileURL(path.resolve(__dirname,'../tools/d1-acceptance-invoke.mjs')).href)});
const token='X'.repeat(45),now=Date.parse('2026-10-14T23:05:00Z');
function config(){const c={accountId:'a'.repeat(32),observedAccountId:'a'.repeat(32),protectedAccountIds:['b'.repeat(32)],databaseId:'3fe4cf59-ccc9-4306-a3ad-4bcbd67a8a42',expectedDatabaseId:'3fe4cf59-ccc9-4306-a3ad-4bcbd67a8a42',protectedDatabaseIds:['11111111-2222-3333-4444-555555555555'],workerName:'tens-r212-d1-isolated-test-20261014',workersDevSubdomain:'example',consentExpiresAt:new Date(now+900000).toISOString()};c.consent='INVOKE readonly '+c.workerName+' '+c.accountId;return c}
const report=(status)=>({protocol:'TENS_D1_ACCEPTANCE_REPORT_1',mode:'readonly',status,realD1Proof:false,production:false,network:false,migrationsApplied:false,otherTablesTouched:false,scenarios:[],reasons:['READ_ONLY_CLASSIFICATION_ONLY'],classification:{marker:'MATCHES_OWNER_APPROVAL',reasons:[],missingColumns:[],foreignActiveJobs:0,jobColumns:['id','question','state','result_json','error_code','created_at','updated_at','claim_token','claim_expires_at','session_hash','claim_count'],nonceColumns:['nonce','created_at']}});
test('rejects a 200/HOLD report as a FAILED engineering acceptance, never exit green',async()=>{
 const calls=[];const r=await I.invoke({config:config(),mode:'readonly',now,getToken:()=>token,transport:async(u,i)=>{calls.push(u);return {status:200,text:async()=>JSON.stringify(report('HOLD'))}}});
 assert.equal(calls.length,1);assert.ok(r.problems.includes('REPORT_STATUS_NOT_SAFE_NONPROOF'),'HOLD must never be a successful receipt');assert.equal(r.report?.status,'HOLD');
});
test('rejects an HTTP 200 response that omits the status field',async()=>{
 const x=report(undefined);delete x.status;
 const r=await I.invoke({config:config(),mode:'readonly',now,getToken:()=>token,transport:async()=>({status:200,text:async()=>JSON.stringify(x)})});
 assert.ok(r.problems.includes('REPORT_STATUS_NOT_SAFE_NONPROOF'),'Missing result state is not engineering success');
});
test('rejects a read-only classification report that identifies an unsafe schema',async()=>{
 const x={...report('NOT_RUN_NO_REAL_D1_PROOF'),classification:{marker:'MISSING',reasons:['MARKER_NOT_EXACTLY_ONE_ROW'],foreignActiveJobs:0,missingColumns:[]}};
 const r=await I.invoke({config:config(),mode:'readonly',now,getToken:()=>token,transport:async()=>({status:200,text:async()=>JSON.stringify(x)})});
 assert.ok(r.problems.includes('READONLY_MARKER_NOT_MATCHED')&&r.problems.includes('READONLY_CLASSIFICATION_REASONS_NOT_CLEAR'),'Bad D1 classification cannot be a green report');
});

test('rejects eleven unrelated columns when the names needed by the real queue are missing',async()=>{
 const x=report('NOT_RUN_NO_REAL_D1_PROOF');
 x.classification.jobColumns=Array.from({length:11},(_,i)=>'not_an_app_column_'+i);
 const r=await I.invoke({config:config(),mode:'readonly',now,getToken:()=>token,transport:async()=>({status:200,text:async()=>JSON.stringify(x)})});
 assert.ok(r.problems.includes('READONLY_JOB_COLUMNS_UNVERIFIED'));
});
test('preflight safe response is accepted but a preflight that reports a binding touch is refused',async()=>{
 const c=config();c.consent='INVOKE preflight '+c.workerName+' '+c.accountId;
 const good={protocol:'TENS_D1_ACCEPTANCE_REPORT_1',mode:'preflight',status:'NOT_RUN_NO_REAL_D1_PROOF',realD1Proof:false,production:false,network:false,migrationsApplied:false,otherTablesTouched:false,scenarios:[],reasons:['PREFLIGHT_ONLY_NO_BINDING_ACCESSED'],bindingTouched:false,envProblems:[],approvalProblems:[]};
 const transport=x=>async()=>({status:200,text:async()=>JSON.stringify(x)});
 const a=await I.invoke({config:c,mode:'preflight',now,getToken:()=>token,transport:transport(good)});
 assert.deepEqual(a.problems,[]);
 assert.equal(a.realD1Proof,false);
 const bad=await I.invoke({config:c,mode:'preflight',now,getToken:()=>token,transport:transport({...good,bindingTouched:true})});
 assert.ok(bad.problems.includes('PREFLIGHT_BINDING_ACCESS_NOT_REFUTED'));
});