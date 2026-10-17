'use strict';
// Synthetic end-to-end contract test for the public Q&A path:
// tens-api-config -> live provider -> evidence adapter -> evidence guard -> validated search.
// The API is a local mock of POST /api/research (202 {jobId}) and GET /api/research/status. No network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'..');
const load=f=>fs.readFileSync(path.join(dir,f),'utf8');
const SRC_URL='https://www.example.gov/records/midnight-pass-permit.pdf';
function completeState(over={}){
 const result=Object.assign({protocol:'TENS_R204_PUBLIC_RESULT_1',providerWrite:false,productionMutation:false,assignmentId:'ASSIGN_1',answer:'Verified answer',
  verified:[{type:'RECORD',statement:'Question requested: A permit record is on file.',evidenceRefs:['E1'],evidenceAnswer:'permit on file'}],unknowns:[],
  sources:[{evidenceId:'E1',preservationVerified:true,url:SRC_URL,label:'County permit',contentHash:'a'.repeat(64),sourceKind:'PUBLIC_WEB'}]},over);
 return {state:'COMPLETE',result,audit:{searchEventId:'EVT1',indexVersion:'1',rulesetVersion:'1',resultState:'COMPLETE'}};
}
async function ask(statusBody,{startStatus=202}={}){
 const calls=[];
 const fetchMock=async(url,opt={})=>{
  calls.push({url:String(url),method:opt.method||'GET'});
  if((opt.method||'GET')==='POST')return {status:startStatus,ok:startStatus<300,json:async()=>({jobId:'JOB1'})};
  return {status:200,ok:true,json:async()=>statusBody};
 };
 const store=new Map();
 const win={location:{href:'https://asktens.com/results.html'}};
 const sandbox={window:win,globalThis:null,document:{querySelector:()=>({content:'https://api.asktens.com'})},
  location:{hostname:'asktens.com',origin:'https://asktens.com'},URL,Headers,fetch:fetchMock,setTimeout:(f)=>{f();return 0},
  crypto:{getRandomValues:b=>{b.fill(7);return b}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))}};
 sandbox.globalThis=sandbox;
 vm.createContext(sandbox);
 for(const f of ['tens-api-config.js','tens-evidence-guard.js','tens-evidence-adapter.js','tens-live-public-provider.js','tens-public-validation-runtime.js'])vm.runInContext(load(f),sandbox,{filename:f});
 assert.equal(win.TENS_API.error||'',''); assert.ok(win.TENS_VALIDATED_PUBLIC_SEARCH.ready());
 const result=await win.TENS_VALIDATED_PUBLIC_SEARCH.search('What does the record establish about Midnight Pass?',{language:'en'});
 return {result,calls};
}
test('source-backed answer is VALIDATED with a reachable public source link',async()=>{
 const {result,calls}=await ask(completeState());
 assert.equal(result.tensState,'VALIDATED');
 assert.equal(result.verified.length,1);
 assert.deepEqual(result.verified[0].sourceIds,result.sources.map(s=>s.id));
 assert.equal(result.sources[0].url,SRC_URL);
 assert.equal(calls[0].url,'https://api.asktens.com/api/research');assert.equal(calls[0].method,'POST');
 assert.match(calls[1].url,/^https:\/\/api\.asktens\.com\/api\/research\/status\?jobId=JOB1$/);
});
test('VERIFIED is a status marker, not the displayed answer; use the preserved, cited finding text',async()=>{
 const {result}=await ask(completeState({answer:'VERIFIED'}));
 assert.equal(result.tensState,'VALIDATED');
 assert.equal(result.verified.length,1);
 assert.match(result.plainAnswer,/permit record is on file/i);
 assert.notEqual(result.plainAnswer,'VERIFIED');
 assert.deepEqual(result.verified[0].sourceIds,result.sources.map(s=>s.id));
});
test('VERIFIED marker without an admitted source cannot appear as a successful answer',async()=>{
 const {result}=await ask(completeState({answer:'VERIFIED',sources:[]}));
 assert.equal(result.tensState,'REJECTED');
 assert.equal(result.verified.length,0);
 assert.notEqual(result.plainAnswer,'VERIFIED');
});
test('no-match is reported as UNKNOWN, never as a finding',async()=>{
 const {result}=await ask(completeState({answer:'UNKNOWN',verified:[],sources:[],unknowns:[{type:'NO_ADMISSIBLE_EVIDENCE',statement:'x',reason:'NO_INDEX_MATCH'}]}));
 assert.equal(result.verified.length,0);assert.equal(result.unknown.length,1);
 assert.match(result.plainAnswer,/could not verify/i);
});
test('verified finding citing a missing source is blocked',async()=>{
 const {result}=await ask(completeState({sources:[]}));
 assert.equal(result.tensState,'REJECTED');assert.equal(result.verified.length,0);
});
test('unpreserved source is not presented as verified',async()=>{
 const {result}=await ask(completeState({sources:[{evidenceId:'E1',preservationVerified:false,url:SRC_URL,contentHash:'a'.repeat(64)}]}));
 assert.equal(result.tensState,'REJECTED');assert.equal(result.verified.length,0);
});
test('backend FAILED and queue rejection surface as errors, not answers',async()=>{
 await assert.rejects(ask({state:'FAILED',errorCode:'X'}),/TENS_RESEARCH_HOLD_X/);
 await assert.rejects(ask({},{startStatus:503}),/TENS_QUEUE_REJECTED_503/);
});
