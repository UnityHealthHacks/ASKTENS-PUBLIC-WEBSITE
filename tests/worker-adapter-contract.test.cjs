'use strict';
// Synthetic, in-memory only. No network, no Cloudflare, no keys, no R212 runtime. Proves the adapter CONTRACT, not a real answer.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {processOne}=require('../backend/adapter-contract/claim-adapter.js');
const HASH='a'.repeat(64);
const proofOk={state:'R212_PUBLIC_RESEARCH_ACTIVATION_PROOF_READY'}; // fixture only; real proof must come from R212
function fakeQueue(jobs){
 const log=[];const rows=new Map(jobs.map(j=>[j.id,{...j,state:'QUEUED'}]));
 return {log,rows,
  async claim(){log.push('claim');const r=[...rows.values()].find(x=>x.state==='QUEUED');if(!r)return {state:'EMPTY'};r.state='RUNNING';r.claimToken='T_'+r.id;return {state:'CLAIMED',jobId:r.id,question:r.question,claimToken:r.claimToken}},
  async complete(o){const r=rows.get(o.jobId);assert.equal(o.claimToken,r.claimToken);r.state='COMPLETE';r.result=o.result},
  async fail(o){const r=rows.get(o.jobId);assert.equal(o.claimToken,r.claimToken);r.state='FAILED';r.errorCode=o.errorCode}};
}
const passProof={state:'PUBLIC_RESEARCH_PASS',completionClaimAllowed:true};
const goodResult=()=>({protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,assignmentId:'ASSIGN_1',checkpointHash:'c',
 verified:[{statement:'s',evidenceRefs:['E1']}],unknowns:[],sources:[{evidenceId:'E1',preservationVerified:true,url:'https://example.gov/r.pdf',contentHash:HASH}]});
const mk=(over={})=>{const q=fakeQueue([{id:'R203WEB_'+'x'.repeat(24),question:'q'}]);return {q,d:{queue:q,runner:{runJob:async()=>passProof},buildResult:()=>goodResult(),activationProof:proofOk,namespace:{},...over}}};

test('unbound adapter never claims a job (job stays QUEUED)',async()=>{
 const {q,d}=mk({runner:undefined});const r=await processOne(d);
 assert.equal(r.state,'UNBOUND_HOLD');assert.deepEqual(q.log,[]);assert.equal([...q.rows.values()][0].state,'QUEUED');
});
test('missing or forged-looking activation proof never claims',async()=>{
 for(const p of [undefined,{},{state:'NOPE'}]){const {q,d}=mk({activationProof:p});assert.equal((await processOne(d)).reason,'ACTIVATION_PROOF_REQUIRED');assert.deepEqual(q.log,[])}
});
test('empty queue is idle',async()=>{const q=fakeQueue([]);assert.equal((await processOne({queue:q,runner:{},buildResult(){},activationProof:proofOk})).state,'IDLE')});
test('source-backed PASS completes with claim token',async()=>{
 const {q,d}=mk();const r=await processOne(d);assert.equal(r.state,'COMPLETED');assert.equal([...q.rows.values()][0].state,'COMPLETE');
});
test('R212 HOLD is reported as FAILED with reason, never as an answer',async()=>{
 const {q,d}=mk({runner:{runJob:async()=>({state:'PUBLIC_RESEARCH_HOLD',reason:'PRESERVATION_NOT_VERIFIED'})}});
 await processOne(d);const row=[...q.rows.values()][0];assert.equal(row.state,'FAILED');assert.equal(row.errorCode,'R212_HOLD_PRESERVATION_NOT_VERIFIED');assert.equal(row.result,undefined);
});
test('runner exception and NOOP pass fail closed',async()=>{
 let m=mk({runner:{runJob:async()=>{throw new Error('x')}}});await processOne(m.d);assert.equal([...m.q.rows.values()][0].errorCode,'R212_RUNNER_EXCEPTION');
 m=mk({runner:{runJob:async()=>({state:'PUBLIC_RESEARCH_NOOP_PASS',completionClaimAllowed:true})}});await processOne(m.d);assert.equal([...m.q.rows.values()][0].errorCode,'R212_NO_COMPLETION_CLAIM');
});
test('no result builder output means NO_SOURCE_BACKED_RESULT (worker proof alone has verifiedAnswerAllowed:false)',async()=>{
 const m=mk({buildResult:()=>null});await processOne(m.d);assert.equal([...m.q.rows.values()][0].errorCode,'NO_SOURCE_BACKED_RESULT');
});
test('uncited, unpreserved, hashless or non-https results are rejected',async()=>{
 const cases={uncited:r=>{r.verified[0].evidenceRefs=['NOPE']},unpres:r=>{r.sources[0].preservationVerified=false},hashless:r=>{r.sources[0].contentHash=''},http:r=>{r.sources[0].url='http://x.gov/a'},nosrc:r=>{r.sources=[]}};
 for(const [k,f] of Object.entries(cases)){const m=mk({buildResult:()=>{const r=goodResult();f(r);return r}});await processOne(m.d);const row=[...m.q.rows.values()][0];assert.equal(row.state,'FAILED',k);assert.match(row.errorCode,/^RESULT_REJECTED_/,k)}
});
test('UNKNOWN-only result with no verified findings may complete honestly',async()=>{
 const m=mk({buildResult:()=>({...goodResult(),verified:[],sources:[],unknowns:[{statement:'u',reason:'NO_INDEX_MATCH'}]})});
 assert.equal((await processOne(m.d)).state,'COMPLETED');
});

// Characterization of the reviewed R204 worker.mjs queue index: read-modify-write on ONE KV key.
test('KNOWN DEFECT: concurrent /api/research POSTs can lose a queue entry (job stays QUEUED forever)',async()=>{
 const mod=await import(path.join(root,'backend/cloudflare-r204-review/worker.mjs'));
 const store=new Map();
 const kv={async get(k,t){await new Promise(r=>setImmediate(r));const v=store.get(k);return v==null?null:(t==='json'?JSON.parse(v):v)},async put(k,v){await new Promise(r=>setImmediate(r));store.set(k,String(v))}};
 const env={TENS_PUBLIC_JOBS:kv};
 const post=()=>mod.default.fetch(new Request('https://api.asktens.com/api/research',{method:'POST',headers:{origin:'https://asktens.com','content-type':'application/json'},body:JSON.stringify({question:'Midnight Pass?'})}),env);
 const res=await Promise.all([post(),post(),post()]);
 const ids=await Promise.all(res.map(async r=>(await r.json()).jobId));
 const queued=JSON.parse(store.get('queue:index:v1')).map(x=>x.id);
 const orphaned=ids.filter(id=>!queued.includes(id));
 assert.ok(orphaned.length>0,'expected lost update; if this fails the queue was fixed - update this test');
});
test('provider reports worker unavailable instead of endless QUEUED',async()=>{
 const load=f=>fs.readFileSync(path.join(root,f),'utf8');let now=1e12;
 const store=new Map(),win={location:{href:'https://asktens.com/results.html'}};
 const fetchMock=async(u,o={})=>(o.method==='POST'?{status:202,ok:true,json:async()=>({jobId:'R203WEB_'+'a'.repeat(32)})}:{status:200,ok:true,json:async()=>({state:'QUEUED'})});
 const D=function(){return new Date(now)};D.now=()=>now;
 const sb={window:win,document:{querySelector:()=>({content:'https://api.asktens.com'})},location:{hostname:'asktens.com',origin:'https://asktens.com'},URL,Headers,fetch:fetchMock,Date:D,
  setTimeout:f=>{now+=1000;f();return 0},crypto:{getRandomValues:b=>{b.fill(3);return b}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))}};
 sb.globalThis=sb;vm.createContext(sb);
 for(const f of ['tens-api-config.js','tens-live-public-provider.js'])vm.runInContext(load(f),sb);
 const events=[];
 await assert.rejects(win.TENS_PUBLIC_PROVIDER.search('q?',{emitStatus:e=>events.push(e.eventType)}),/TENS_WORKER_UNAVAILABLE/);
 assert.ok(events.includes('TENS_QUEUE_WAITING'));
 assert.ok(now-1e12<=60000,'bounded wait');
});
