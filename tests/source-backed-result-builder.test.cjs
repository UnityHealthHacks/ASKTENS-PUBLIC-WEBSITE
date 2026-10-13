'use strict';
// Synthetic fixtures only. Proves the builder's refusal rules and output shape, NOT that any real source is preserved or any answer is true.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const B=require('../backend/adapter-contract/source-backed-result-builder.js');
const {processOne}=require('../backend/adapter-contract/claim-adapter.js');
const Q='What does the record establish about Midnight Pass?',HASH='b'.repeat(64);
const job={jobId:'R203WEB_'+'x'.repeat(24),question:Q};
const src=(o={})=>({evidenceId:'EV_1',label:'County permit',recordType:'Permit',readStatus:'READ_COMPLETE',contentHash:HASH,preservation:{verified:true,independent:true,verifier:'fixture-verifier',contentHashMatchesPreservedBytes:true},publicAccess:true,sourceKind:'PUBLIC_WEB',url:'https://example.gov/permit.pdf',...o});
const fnd=(o={})=>({id:'F1',type:'PERMIT',statement:'Permit 4521 was issued for $12,500.',directQuote:'Permit No. 4521 issued; fee 12,500 dollars. $12,500',evidenceRefs:['EV_1'],verification:{state:'COMPLETE_VERIFIED',basis:'DIRECT_SOURCE_STATEMENT',groundingRatio:1,numbersGrounded:true},relevance:{state:'RELEVANT',questionSha256:B.sha(B.normQ(Q))},...o});
const run=(s=[src()],f=[fnd()],extra={})=>B.build(job,{sources:s,findings:f,...extra});

test('fully attested bundle -> exact R202 result, cited, hashed, no claim beyond input',()=>{
 const r=run();assert.equal(r.ok,true);const x=r.result;
 assert.equal(x.protocol,'TENS_R202_PUBLIC_RESULT_1');assert.equal(x.state,'COMPLETE');assert.equal(x.providerWrite,false);assert.equal(x.productionMutation,false);
 assert.equal(x.answer,'VERIFIED');assert.equal(x.verified.length,1);assert.deepEqual(x.verified[0].evidenceRefs,['EV_1']);
 assert.equal(x.sources[0].preservationVerified,true);assert.equal(x.sources[0].contentHash,HASH);assert.match(x.checkpointHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(run().result,x,'deterministic');
});
test('every missing attestation drops the source and its findings (fail closed to UNKNOWN)',()=>{
 const cases={readStatus:{readStatus:'PARTIAL'},hash:{contentHash:'abc'},pres:{preservation:{verified:true,independent:false,verifier:'v',contentHashMatchesPreservedBytes:true}},presNoMatch:{preservation:{verified:true,independent:true,verifier:'v'}},presNone:{preservation:undefined},public:{publicAccess:undefined},kind:{sourceKind:'PRIVATE'},http:{url:'http://example.gov/a'},localhost:{url:'https://localhost/a'},creds:{url:'******example.gov/a'},ip:{url:'https://10.0.0.1/a'}};
 for(const [k,o] of Object.entries(cases)){const r=run([src(o)]);assert.equal(r.ok,true,k);assert.equal(r.result.answer,'UNKNOWN',k);assert.equal(r.result.verified.length,0,k);assert.equal(r.result.sources.length,0,k);assert.ok(r.dropped.length>=1,k)}
});
test('a URL alone never makes a source valid',()=>{
 const r=B.build(job,{sources:[{evidenceId:'EV_1',label:'x',recordType:'y',url:'https://example.gov/a.pdf',sourceKind:'PUBLIC_WEB'}],findings:[fnd()]});
 assert.equal(r.result.answer,'UNKNOWN');assert.equal(r.dropped[0].reason,'SOURCE_NOT_READ_COMPLETE');
});
test('findings need full verification, relevance to THIS question, citations and number grounding',()=>{
 const bad={unverified:{verification:{state:'PARTIAL',basis:'DIRECT_SOURCE_STATEMENT',groundingRatio:1,numbersGrounded:true}},basis:{verification:{state:'COMPLETE_VERIFIED',basis:'INFERENCE',groundingRatio:1,numbersGrounded:true}},ratio:{verification:{state:'COMPLETE_VERIFIED',basis:'DIRECT_SOURCE_STATEMENT',groundingRatio:0.9,numbersGrounded:true}},nums:{verification:{state:'COMPLETE_VERIFIED',basis:'DIRECT_SOURCE_STATEMENT',groundingRatio:1,numbersGrounded:false}},otherQ:{relevance:{state:'RELEVANT',questionSha256:'0'.repeat(64)}},notRel:{relevance:{state:'NOT_RELEVANT',questionSha256:B.sha(B.normQ(Q))}},uncited:{evidenceRefs:['NOPE']},noRefs:{evidenceRefs:[]},noQuote:{directQuote:''},numMismatch:{statement:'Permit 4521 was issued for $99,999.'}};
 for(const [k,o] of Object.entries(bad)){const r=run([src()],[fnd(o)]);assert.equal(r.result.answer,'UNKNOWN',k);assert.equal(r.result.sources.length,0,k)}
});
test('mixed bundle keeps only admissible findings and only the sources they cite',()=>{
 const r=run([src(),src({evidenceId:'EV_2',readStatus:'FAILED'}),src({evidenceId:'EV_3'})],[fnd(),fnd({id:'F2',evidenceRefs:['EV_2']})]);
 assert.equal(r.result.verified.length,1);assert.deepEqual(r.result.sources.map(s=>s.evidenceId),['EV_1']);assert.equal(r.dropped.length,2);
});
test('no match / no bundle content yields honest UNKNOWN with a valid reason, never a finding',()=>{
 let r=run([],[],{noMatch:true});assert.equal(r.result.unknowns[0].reason,'NO_INDEX_MATCH');assert.equal(r.result.answer,'UNKNOWN');
 r=run([src({readStatus:'X'})]);assert.equal(r.result.unknowns[0].reason,'PROVENANCE_UNRESOLVED');
 r=run([],[],{unknowns:[{statement:'Not established',reason:'NOT_ESTABLISHED'},{statement:'bad',reason:'MADE_UP'}]});assert.equal(r.result.unknowns.length,1);
 assert.deepEqual(B.build(null,{sources:[],findings:[]}),{ok:false,reason:'JOB_REQUIRED'});assert.equal(B.build(job,{}).ok,false);
});
test('duplicate source ids are not silently merged',()=>{const r=run([src(),src({label:'Other'})]);assert.ok(r.dropped.some(d=>d.reason==='SOURCE_DUPLICATE'))});
test('output passes the real worker-side and browser-side guards',()=>{
 const res=run().result;
 const {sourceBackedProblems,resultOk}=require('../backend/adapter-contract/claim-adapter.js');
 assert.equal(resultOk(res),true);assert.deepEqual(sourceBackedProblems(res),[]);
 const root=path.resolve(__dirname,'..'),win={location:{href:'https://asktens.com/results.html'}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'tens-evidence-guard.js'),'utf8'),{window:win,URL});
 // transform the stored result with the real provider, then validate with the real guard
 const store=new Map(),sb={window:win,document:{querySelector:()=>({content:'https://api.asktens.com'})},location:{hostname:'asktens.com',origin:'https://asktens.com'},URL,Headers,setTimeout:f=>{f();return 0},crypto:{getRandomValues:b=>{b.fill(5);return b}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},
  fetch:async(u,o={})=>o.method==='POST'?{status:202,ok:true,json:async()=>({jobId:job.jobId})}:{status:200,ok:true,json:async()=>({state:'COMPLETE',result:res})}};
 sb.globalThis=sb;vm.createContext(sb);
 for(const f of ['tens-api-config.js','tens-live-public-provider.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),sb);
 return win.TENS_PUBLIC_PROVIDER.search(Q,{}).then(out=>{
  assert.equal(out.verified.length,1);assert.equal(out.sources[0].url,'https://example.gov/permit.pdf');
  const v=win.TENS_EVIDENCE_GUARD.validateResult(out);assert.equal(v.valid,true,JSON.stringify(v.errors));
 });
});
test('UNKNOWN result also passes the real browser guard',async()=>{
 const res=run([],[],{noMatch:true}).result,root=path.resolve(__dirname,'..'),win={location:{href:'https://asktens.com/results.html'}},store=new Map();
 vm.runInNewContext(fs.readFileSync(path.join(root,'tens-evidence-guard.js'),'utf8'),{window:win,URL});
 const sb={window:win,document:{querySelector:()=>({content:'https://api.asktens.com'})},location:{hostname:'asktens.com',origin:'https://asktens.com'},URL,Headers,setTimeout:f=>{f();return 0},crypto:{getRandomValues:b=>{b.fill(5);return b}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},
  fetch:async(u,o={})=>o.method==='POST'?{status:202,ok:true,json:async()=>({jobId:job.jobId})}:{status:200,ok:true,json:async()=>({state:'COMPLETE',result:res})}};
 sb.globalThis=sb;vm.createContext(sb);for(const f of ['tens-api-config.js','tens-live-public-provider.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),sb);
 const out=await win.TENS_PUBLIC_PROVIDER.search(Q,{});assert.equal(out.verified.length,0);assert.equal(out.unknown.length,1);
 const v=win.TENS_EVIDENCE_GUARD.validateResult(out);assert.equal(v.valid,true,JSON.stringify(v.errors));
});
test('adapter hook: no bundle -> no result (job fails closed); good bundle completes via claim adapter',async()=>{
 const calls=[];const queue={claim:async()=>({state:'CLAIMED',jobId:job.jobId,question:Q,claimToken:'T'}),complete:async o=>{calls.push(['complete',o]);return {status:200,state:'COMPLETE_ACCEPTED'}},fail:async o=>{calls.push(['fail',o]);return {status:200,state:'FAILURE_ACCEPTED'}}};
 const base={queue,runner:{runJob:async()=>({state:'PUBLIC_RESEARCH_PASS',completionClaimAllowed:true})},activationProof:{state:'R212_PUBLIC_RESEARCH_ACTIVATION_PROOF_READY'},namespace:{}};
 assert.equal((await processOne({...base,buildResult:B.asAdapterBuilder(()=>null)})).state,'FAILED_REPORTED');assert.equal(calls[0][1].errorCode,'NO_SOURCE_BACKED_RESULT');
 assert.equal((await processOne({...base,buildResult:B.asAdapterBuilder(()=>({sources:[src()],findings:[fnd()]}))})).state,'COMPLETED');assert.equal(calls[1][0],'complete');
});

test('numeric grounding refuses substring amounts and years but preserves exact numeric tokens',()=>{
 const cases=[
  {statement:'Allocation was $500.',quote:'Allocation was $500.',allow:true},
  {statement:'Allocation was $12500.',quote:'Allocation was $12,500.',allow:true},
  {statement:'In 2026, allocation was $500.',quote:'In 2026, allocation was $500.',allow:true},
  {statement:'Allocation was $500.',quote:'Allocation was $1,500.',allow:false},
  {statement:'Allocation was $50.',quote:'Allocation was $150.',allow:false},
  {statement:'Agency reported year 2026.',quote:'Agency reported year 12026.',allow:false},
  {statement:'Allocation was 1.5 million.',quote:'Allocation was 11.5 million.',allow:false},
  {statement:'In 2026, allocation was $500.',quote:'In 2026, allocation was $1,500.',allow:false},
  {statement:'Event was in 2026.',quote:'Event was in 20260.',allow:false},
  {statement:'Event was in 2023.',quote:'Event was in 2024.',allow:false}
 ];
 for(const c of cases){
  const r=run([src()],[fnd({statement:c.statement,directQuote:c.quote})]);
  assert.equal(r.ok,true,c.statement+' | '+c.quote);
  assert.equal(r.result.answer,c.allow?'VERIFIED':'UNKNOWN',c.statement+' | '+c.quote);
  assert.equal(r.result.verified.length,c.allow?1:0,c.statement+' | '+c.quote);
  if(!c.allow)assert.ok(r.dropped.some(x=>x.reason==='FINDING_NUMBER_NOT_IN_QUOTE'),c.statement+' | '+c.quote);
 }
});
