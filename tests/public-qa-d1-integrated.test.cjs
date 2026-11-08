'use strict';
// End-to-end synthetic public Q&A: actual source builder -> real SQLite-backed D1
// queue -> actual website client/provider/guard. NO live Cloudflare, issuer,
// private records, native R212, real ingestion, or independently verified source.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');
const B=require('../backend/adapter-contract/source-backed-result-builder.js');
const dirname=path.resolve(__dirname,'..');
const d1dir=path.resolve(dirname,'backend/cloudflare-r204-review');
const SRC='https://example.gov/public/permit.pdf',QTEXT='What does the County permit record establish?';
const SCHEMA="CREATE TABLE research_jobs(id TEXT PRIMARY KEY,question TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETE','FAILED')),result_json TEXT,error_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL); CREATE INDEX idx_research_jobs_state_created ON research_jobs(state,created_at); CREATE TABLE internal_nonces(nonce TEXT PRIMARY KEY,created_at INTEGER NOT NULL);";
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const H='a'.repeat(64);
function dbShim(){
 const raw=new DatabaseSync(':memory:');
 raw.exec(SCHEMA);raw.exec(fs.readFileSync(path.join(d1dir,'d1-queue-migration.sql'),'utf8'));
 return {raw,prepare(sql){const stmt=raw.prepare(sql);return {async all(){return {results:stmt.all()}},bind(...args){return {async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}},async first(){return stmt.get(...args)||null}}}}}};
}
function bundle(question,{kind='verified',archive=false,link=SRC}={}){
 if(kind==='unknown')return {sources:[],findings:[],noMatch:true};
 const source={evidenceId:'DOC_TEST_PUBLIC_1',label:'Synthetic County permit',
  recordType:'Permit',readStatus:'READ_COMPLETE',contentHash:H,
  preservation:{verified:true,independent:true,verifier:'SYNTHETIC_FIXTURE_ONLY',contentHashMatchesPreservedBytes:true},
  publicAccess:true,sourceKind:archive?'ARCHIVED_PUBLIC_RECORD':'PUBLIC_WEB',url:link,
  releaseAttestation:{evidenceId:'DOC_TEST_PUBLIC_1',contentHash:H,scope:'PUBLIC_TEST',fixtureOnly:true}};
 const finding={type:'PERMIT',statement:'A permit was issued.',directQuote:'A permit was issued.',
  evidenceRefs:['DOC_TEST_PUBLIC_1'],verification:{state:'COMPLETE_VERIFIED',basis:'DIRECT_SOURCE_STATEMENT',groundingRatio:1,numbersGrounded:true},
  relevance:{state:'RELEVANT',questionSha256:B.sha(B.normQ(question))}};
 return {sources:[source],findings:[finding]};
}
function mockBrowser(api){
 const store=new Map(),win={location:{href:'https://asktens.com/results.html'}};
 const sandbox={window:win,globalThis:null,location:{hostname:'asktens.com',origin:'https://asktens.com'},
  document:{querySelector:()=>({content:'https://api.asktens.com'})},URL,Headers,
  fetch:api,crypto:crypto.webcrypto,sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},
  setTimeout:f=>{f();return 0}};
 sandbox.globalThis=sandbox;
 vm.createContext(sandbox);
 for(const f of ['tens-api-config.js','tens-evidence-guard.js','tens-evidence-adapter.js',
  'tens-live-public-provider.js','tens-public-validation-runtime.js'])
  vm.runInContext(fs.readFileSync(path.join(dirname,f),'utf8'),sandbox,{filename:f});
 assert.equal(win.TENS_API.error,'');
 return win;
}
async function harness({kind='verified',archive=false,link=SRC,waitOnce=true,withoutReleaseVerifier=false}={}){
 const Q=await import(pathToFileURL(path.join(d1dir,'d1-research-queue.mjs')).href);
 const db=dbShim(),events=[],jobs=[],state={statusReads:0,workerRuns:0,workerResult:null};
 const jid='R203WEB_'+crypto.randomBytes(16).toString('hex');
 const verifier={verifyReleaseAttestation:x=>x?.attestation?.fixtureOnly===true};
 const api=async(input,opt={})=>{
  const url=new URL(String(input)),method=opt.method||'GET';
  assert.equal(url.origin,'https://api.asktens.com');
  const hdr=new Headers(opt.headers||{});
  const session=hdr.get('x-tens-public-session')||'';
  assert.match(session,/^[a-f0-9]{32}$/);
  const sessionHash=sha('tens-public-session-v1:'+session);
  events.push({method,path:url.pathname,sessionHash});
  if(url.pathname==='/api/research'&&method==='POST'){
   const question=JSON.parse(opt.body).question;
   const queued=await Q.enqueue(db,{id:jid,question,sessionHash});
   assert.equal(queued.state,'QUEUED');
   jobs.push(jid);
   return {status:202,ok:true,json:async()=>({jobId:jid,state:'QUEUED'})};
  }
  if(url.pathname==='/api/research/status'&&method==='GET'){
   const id=url.searchParams.get('jobId');state.statusReads++;
   assert.equal(id,jid);
   if(!waitOnce||state.statusReads>=2){
    if(state.workerRuns===0){
     state.workerRuns++;
     const claimed=await Q.claim(db,{token:'synthetic-claim-token'});
     assert.equal(claimed.state,'CLAIMED');
     const built=B.build({jobId:claimed.jobId,question:claimed.question},
      bundle(claimed.question,{kind,archive,link}),withoutReleaseVerifier?{}:verifier);
     assert.equal(built.ok,true);
     state.workerResult=built.result;
     const done=await Q.complete(db,{jobId:jid,claimToken:claimed.claimToken,result:built.result});
     assert.equal(done.status,200,'D1 should accept real builder result');
    }
   }
   const status=await Q.status(db,id,{sessionHash});
   assert.ok(status);
   return {status:200,ok:true,json:async()=>status};
  }
  throw Error('UNEXPECTED_API_CALL:'+method+url.pathname);
 };
 const win=mockBrowser(api);
 const result=await win.TENS_VALIDATED_PUBLIC_SEARCH.search(QTEXT,{language:'en'});
 return {Q,db,jid,win,result,events,jobs,state};
}
test('full synthetic flow: question -> D1 atomic queue -> claimed source builder -> stored row -> cited browser answer',async()=>{
 const v=await harness();
 assert.equal(v.state.statusReads,2);assert.equal(v.state.workerRuns,1);
 assert.equal(v.result.tensState,'VALIDATED');
 assert.equal(v.result.verified.length,1);assert.equal(v.result.sources[0].url,SRC);
 assert.match(v.result.plainAnswer,/permit was issued/i);
 assert.equal(v.db.raw.prepare('SELECT state FROM research_jobs').get().state,'COMPLETE');
 assert.deepEqual(v.events.map(e=>e.method),['POST','GET','GET']);
 assert.equal(v.events[0].sessionHash,v.events[2].sessionHash);
});
test('full synthetic no-match flow is honest UNKNOWN without source or verified assertion',async()=>{
 const v=await harness({kind:'unknown',waitOnce:false});
 assert.equal(v.result.tensState,'VALIDATED');assert.equal(v.result.verified.length,0);
 assert.equal(v.result.sources.length,0);assert.equal(v.result.unknown.length,1);
 assert.match(v.result.plainAnswer,/could not verify/i);
});
test('archive with public URL survives source builder, D1 and website as clickable record',async()=>{
 const v=await harness({archive:true});
 assert.equal(v.result.tensState,'VALIDATED');assert.equal(v.result.sources[0].url,SRC);
 assert.equal(v.result.sources[0].sourceKind,'ARCHIVED_PUBLIC_RECORD');
});
test('archive lacking a public URL falls back to UNKNOWN before D1 or browser claims a fact',async()=>{
 const v=await harness({archive:true,link:null});
 assert.equal(v.result.tensState,'VALIDATED');
 assert.equal(v.result.sources.length,0);assert.equal(v.result.verified.length,0);
 assert.equal(v.result.unknown.length,1);assert.equal(v.state.workerResult.answer,'UNKNOWN');
});
test('tampered D1 checkpoint becomes FAILED integrity hold rather than a forged verified answer',async()=>{
 const v=await harness({waitOnce:false});
 v.db.raw.exec("UPDATE research_jobs SET result_json=json_set(result_json,'$.checkpointHash','0000000000000000000000000000000000000000000000000000000000000000')");
 const clean=await v.Q.status(v.db,v.jid);
 assert.equal(clean.state,'FAILED');
 assert.equal(clean.errorCode,'RESULT_INTEGRITY_HOLD');assert.equal(clean.result,null);
});
test('same D1 job is invisible across browser session boundaries and claim tokens cannot be replayed',async()=>{
 const v=await harness({waitOnce:false});
 const session=sha('tens-public-session-v1:'+'b'.repeat(32));
 assert.equal(await v.Q.status(v.db,v.jid,{sessionHash:session}),null);
 const replay=await v.Q.complete(v.db,{jobId:v.jid,claimToken:'synthetic-claim-token',result:v.state.workerResult});
 assert.equal(replay.status,409);
});

test('absent independent public release verifier cannot produce a claimed verified answer',async()=>{
 const v=await harness({withoutReleaseVerifier:true,waitOnce:false});
 assert.equal(v.result.tensState,'VALIDATED');
 assert.equal(v.result.verified.length,0);
 assert.equal(v.result.sources.length,0);
 assert.equal(v.state.workerResult.answer,'UNKNOWN');
 assert.equal(v.result.unknown.length,1);
});
test('unsafe public link is not transformed into a verified answer or share source',async()=>{
 const v=await harness({link:'http://example.gov/permit.pdf',waitOnce:false});
 assert.equal(v.result.tensState,'VALIDATED');
 assert.equal(v.result.verified.length,0);
 assert.equal(v.result.sources.length,0);
 assert.equal(v.state.workerResult.answer,'UNKNOWN');
});
