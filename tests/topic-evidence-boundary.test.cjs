'use strict';
// Synthetic offline browser trust-boundary checks. No production APIs or providers.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const here=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(here,'tens-topic-evidence-boundary.js'),'utf8');
const page=fs.readFileSync(path.join(here,'topic.html'),'utf8');
const win={};vm.runInNewContext(source,{window:win,URL});const guard=win.TENS_TOPIC_EVIDENCE_BOUNDARY;
const hash='a'.repeat(64);
const fixture=()=>({answer:'An agency reported a verified result',verified:[{statement:'A document records a project milestone.',evidenceRefs:['SRC_A'] }],unknowns:[],sources:[{evidenceId:'SRC_A',preservationVerified:true,sourceKind:'ARCHIVED_PUBLIC_RECORD',contentHash:hash}]});
test('source-linked archived claim accepted as client-side candidate only',()=>assert.equal(guard.validate(fixture()).valid,true));
test('fail closed: unsupported claimed answer without findings',()=>assert.equal(guard.validate({...fixture(),verified:[]}).valid,false));
test('fail closed: fabricated complete without any source',()=>assert.equal(guard.validate({...fixture(),sources:[]}).valid,false));
test('fail closed: absent evidence reference',()=>assert.equal(guard.validate({...fixture(),verified:[{statement:'Wrong',evidenceRefs:['MISSING'] }]}).valid,false));
test('fail closed: preservation not verified',()=>{const r=fixture();r.sources[0].preservationVerified=false;assert.equal(guard.validate(r).valid,false)});
test('fail closed: archive has no SHA256',()=>{const r=fixture();r.sources[0].contentHash='';assert.equal(guard.validate(r).valid,false)});
test('fail closed: forged duplicate evidence identity',()=>{const r=fixture();r.sources.push({...r.sources[0]});assert.equal(guard.validate(r).valid,false)});
test('fail closed: unsafe remote record URL',()=>{const r=fixture();r.sources[0].url='javascript:alert(1)';assert.equal(guard.validate(r).valid,false)});
test('fail closed: explicit private source',()=>{const r=fixture();r.sources[0].publicSafe=false;assert.equal(guard.validate(r).valid,false)});
test('evidence-free UNKNOWN remains honest',()=>{const r={answer:'UNKNOWN',verified:[],sources:[],unknowns:[{statement:'Not established'}]};assert.equal(guard.validate(r).valid,true)});

test('UNKNOWN cannot smuggle a private source into the rendered evidence list',()=>{
 const r={answer:'UNKNOWN',verified:[],unknowns:[{statement:'Not established'}],sources:[{evidenceId:'PRIVATE_DOC',publicSafe:false,url:'https://example.gov/private',preservationVerified:true,sourceKind:'PUBLIC_WEB',contentHash:hash}]};
 const check=guard.validate(r);
 assert.equal(check.valid,false);assert.equal(check.reason,'UNKNOWN_WITH_SOURCES');
});
test('UNKNOWN rejects unsafe links even when no finding cites them',()=>{
 const r={answer:'UNKNOWN',verified:[],unknowns:[],sources:[{evidenceId:'FAKE_DOC',url:'javascript:alert(1)',publicSafe:true,preservationVerified:true,sourceKind:'PUBLIC_WEB',contentHash:hash}]};
 assert.equal(guard.validate(r).valid,false);
});
test('UNKNOWN with invalid or duplicate evidence identities never passes',()=>{
 for(const ids of [['bad!'],['SRC_A','SRC_A']]){
  const r={answer:'UNKNOWN',verified:[],unknowns:[],sources:ids.map(evidenceId=>({evidenceId,preservationVerified:true,sourceKind:'ARCHIVED_PUBLIC_RECORD',contentHash:hash}))};
  assert.equal(guard.validate(r).valid,false);
 }
});

test('topic loads guard and checks COMPLETE before render',()=>{assert.match(page,/src="tens-topic-evidence-boundary\.js"/);assert.match(page,/SOURCE_BOUNDARY_HOLD/);assert.match(page,/TENS_TOPIC_EVIDENCE_BOUNDARY\?\.validate\(x\.result\)/)});
test('topic never renders old localStorage snapshots as verified',()=>{assert.doesNotMatch(page,/loadSnapshot\(/);assert.doesNotMatch(page,/saveSnapshot\(/);assert.doesNotMatch(page,/R210 live evidence/);assert.doesNotMatch(page,/Latest verified R210/)});

test('topic inline script parses',()=>{const start=page.lastIndexOf('<script>')+8,end=page.lastIndexOf('</script>');assert.ok(start>=8&&end>start);assert.doesNotThrow(()=>new vm.Script(page.slice(start,end)))});
test('topic renders per-statement source evidence',()=>{assert.ok(page.includes('v.evidenceRefs||[]'));assert.ok(page.includes('Open source record'));assert.ok(page.includes('Archived SHA-256'))});

const topicResearchSource=page.slice(page.indexOf('async function research(question)'),page.indexOf('\nfunction collect(r)'));
function offlineTopicResearch({jobId='R203WEB_'+('a'.repeat(24)),startStatus=202,statusBody={state:'QUEUED'},statusHttp=200,guardValid=true}={}){
 let now=0;const calls=[];
 const ctx={
  Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;fn()},
  window:{
   TENS_API:{async fetch(url,opt){
    calls.push({url,method:opt?.method||'GET'});
    if(opt?.method==='POST')return {status:startStatus,json:async()=>({jobId})};
    return {ok:statusHttp===200,status:statusHttp,json:async()=>statusBody};
   }},
   TENS_TOPIC_EVIDENCE_BOUNDARY:{validate(x){return {valid:guardValid,result:x}}}
  }
 };
 const fn=vm.runInNewContext(topicResearchSource+'\nresearch',ctx);
 return {research:fn,calls,elapsed:()=>now};
}
test('subject research never sends a blank or over-limit question to the backend',async()=>{
 const x=offlineTopicResearch();
 await assert.rejects(x.research('    '),/QUESTION_INVALID/);
 await assert.rejects(x.research('a'.repeat(1201)),/QUESTION_INVALID/);
 assert.equal(x.calls.length,0);
});
test('subject research refuses malformed job identifiers before any status request',async()=>{
 const x=offlineTopicResearch({jobId:'not-a-job'});
 await assert.rejects(x.research('When?'),/JOB_ID_INVALID/);
 assert.equal(x.calls.filter(c=>c.method==='GET').length,0);
});
test('subject research times out a queued job and never claims an answer',async()=>{
 const x=offlineTopicResearch();
 await assert.rejects(x.research('What happened?'),/WORKER_UNAVAILABLE/);
 assert(x.elapsed()>=45000&&x.elapsed()<50000);
});
test('subject research refuses missing and unexpected backend states immediately',async()=>{
 for(const statusBody of [{}, {state:'UNRECOGNIZED'}]){
  const x=offlineTopicResearch({statusBody});
  await assert.rejects(x.research('What happened?'),/RESEARCH_STATE_INVALID/);
  assert.equal(x.calls.length,2);
 }
});
test('subject research refuses failed status HTTP and rejected queue',async()=>{
 await assert.rejects(offlineTopicResearch({statusHttp:503}).research('What happened?'),/RESEARCH_STATUS_503/);
 await assert.rejects(offlineTopicResearch({startStatus:503}).research('What happened?'),/QUEUE_503/);
});
test('subject research fails closed on unverified completed result',async()=>{
 const x=offlineTopicResearch({statusBody:{state:'COMPLETE',result:{answer:'unsupported'}},guardValid:false});
 await assert.rejects(x.research('What happened?'),/SOURCE_BOUNDARY_HOLD/);
});
test('subject research returns a completed answer only after evidence validation',async()=>{
 const result={answer:'validated synthetic answer'},x=offlineTopicResearch({statusBody:{state:'COMPLETE',result}});
 assert.equal((await x.research('What happened?')).answer,result.answer);
});
test('subject research returns explicit backend FAILED holds, never a result',async()=>{
 const x=offlineTopicResearch({statusBody:{state:'FAILED',errorCode:'PROOF_NOT_READY'}});
 await assert.rejects(x.research('What happened?'),/RESEARCH_HOLD_PROOF_NOT_READY/);
});
test('subject research times out an indefinitely RUNNING worker',async()=>{
 const x=offlineTopicResearch({statusBody:{state:'RUNNING'}});
 await assert.rejects(x.research('What happened?'),/RESEARCH_TIMEOUT/);
 assert(x.elapsed()>=120000&&x.elapsed()<130000);
});
