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
  sources:[{evidenceId:'E1',preservationVerified:true,publicSafe:true,url:SRC_URL,label:'County permit',contentHash:'a'.repeat(64),sourceKind:'PUBLIC_WEB'}]},over);
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
 const {result}=await ask(completeState({sources:[{evidenceId:'E1',preservationVerified:false,publicSafe:true,url:SRC_URL,contentHash:'a'.repeat(64),sourceKind:'PUBLIC_WEB'}]}));
 assert.equal(result.tensState,'REJECTED');assert.equal(result.verified.length,0);
});
test('a missing or nonliteral public release flag is rejected at the browser provider boundary',async()=>{
 for(const flag of [false,null,'true','ABSENT']){
  const source={...completeState().result.sources[0]};
  if(flag==='ABSENT')delete source.publicSafe;else source.publicSafe=flag;
  await assert.rejects(ask(completeState({sources:[source]})),/PUBLIC_RELEASE_NOT_ATTESTED/);
 }
});
test('backend FAILED and queue rejection surface as errors, not answers',async()=>{
 await assert.rejects(ask({state:'FAILED',errorCode:'X'}),/TENS_RESEARCH_HOLD_X/);
 await assert.rejects(ask({},{startStatus:503}),/TENS_QUEUE_REJECTED_503/);
});

test('public evidence URL guard refuses insecure, relative and credential-bearing links',()=>{
 const window={location:{href:'https://asktens.com/results.html'}};
 vm.runInNewContext(load('tens-evidence-guard.js'),{window,URL});
 const guard=window.TENS_EVIDENCE_GUARD;
 const base={id:'SRC_Record_1',occurrenceId:'OCC_Record_1',label:'Public agency record',recordType:'PUBLIC_WEB',provenanceStatus:'verified',publicSafe:true,url:'https://agency.gov/report.pdf'};
 function accepts(url){const errors=[];guard.validateResult({sources:[]});const r={...base,url};const audit={searchEventId:'EVT_SAMPLE',indexVersion:'IDX_1',adapterVersion:'ADAPTER_1',rulesetVersion:'RULESET_1',environment:'PRODUCTION',resultState:'COMPLETE'};const result={audit,sources:[r],verified:[{id:'VER_1',title:'Finding',text:'Record',classification:'VERIFIED',sourceIds:[r.id],limitations:['Source limits'],provenanceStatus:'verified'}],inference:[],unknown:[],limitations:['Bounded'],actions:[]};return guard.validateResult(result).valid}
 assert.equal(accepts('https://agency.gov/report.pdf'),true);
 for(const url of ['http://agency.gov/report.pdf','/source','https://name:pass@agency.gov/source','https://agency.gov/report.pdf#credential','https://agency.gov:8443/report','javascript:alert(1)','https://localhost/source'])assert.equal(accepts(url),false,url);
});

test('results page evidence anchors do not send the question URL as referrer',()=>{
 const html=load('results.html');
 const anchors=[...html.matchAll(/target="_blank" rel="noopener noreferrer"/g)];
 assert(anchors.length>=3,'all evidence/share anchors must refuse referrer data');
 assert(!html.includes('target="_blank" rel="noopener"'),'no legacy referrer-leaking evidence anchor');
});

test('public archived record keeps its independently approved clickable source URL',async()=>{
 const x=completeState();
 x.result.sources[0].sourceKind='ARCHIVED_PUBLIC_RECORD';
 const {result}=await ask(x);
 assert.equal(result.tensState,'VALIDATED');
 assert.equal(result.sources[0].url,SRC_URL);
 assert.equal(result.verified[0].sourceIds[0],result.sources[0].id);
});
test('an archive lacking a public document URL cannot be presented as verified',async()=>{
 const x=completeState();
 x.result.sources[0].sourceKind='ARCHIVED_PUBLIC_RECORD';
 delete x.result.sources[0].url;
 await assert.rejects(ask(x),/PUBLIC_ARCHIVE_NOT_LINKABLE/);
});

test('uncited backend summary cannot replace the source-grounded plain-language answer',async()=>{
 const marker='Unsupported secret approval for $9,000,000';
 const {result}=await ask(completeState({answer:marker}));
 assert.equal(result.tensState,'VALIDATED');
 assert.match(result.plainAnswer,/permit record is on file/i);
 assert.doesNotMatch(result.plainAnswer,/secret approval|9,000,000/i);
 assert.ok(result.verified[0].sourceIds.length===1);
});
test('contradictory UNKNOWN result with a verified finding fails closed',async()=>{
 await assert.rejects(ask(completeState({answer:'UNKNOWN'})),/PUBLIC_ANSWER_CONFLICT/);
});
test('a free-form claimed answer with no cited findings fails closed',async()=>{
 await assert.rejects(ask(completeState({answer:'This claim is unsupported',verified:[],sources:[],
   unknowns:[{type:'UNRESOLVED',statement:'No source established this claim.',reason:'NOT_ESTABLISHED'}]})),/PUBLIC_ANSWER_UNCITED/);
});
test('partially missing citations are rejected, not silently removed',async()=>{
 const altered=completeState();
 altered.result.verified[0].evidenceRefs=['E1','MISSING_OTHER_RECORD'];
 const {result}=await ask(altered);
 assert.equal(result.tensState,'REJECTED');
 assert.equal(result.verified.length,0);
});

test('private or unrecognized source kind cannot be relabeled public web evidence',async()=>{
 const src={...completeState().result.sources[0],sourceKind:'PRIVATE_DRIVE'};
 await assert.rejects(ask(completeState({sources:[src]})),/PUBLIC_SOURCE_KIND_INVALID/);
});
test('explicitly unreleased public-access flag cannot become a public result',async()=>{
 const src={...completeState().result.sources[0],publicAccess:false};
 await assert.rejects(ask(completeState({sources:[src]})),/PUBLIC_SOURCE_NOT_RELEASED/);
});
test('source with absent or malformed SHA-256 cannot support a verified answer',async()=>{
 for(const h of [undefined,'not-a-hash',null]){
  const src={...completeState().result.sources[0],contentHash:h};
  await assert.rejects(ask(completeState({sources:[src]})),/PUBLIC_SOURCE_HASH_MISSING/);
 }
});
