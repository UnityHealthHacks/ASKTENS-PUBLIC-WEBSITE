'use strict';
// Offline regression for the REVIEW-ONLY worker-d1-candidate.mjs wrapper over the unchanged worker.mjs.
// Real SQLite behind a D1-shaped shim + in-memory KV. The ECDSA verify is stubbed ONLY for the signature check; no keys, network or Cloudflare.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'../backend/cloudflare-r204-review');
const UI='https://asktens.com',API='https://api.asktens.com',FLAG='SCHEMA_VERIFIED_V1';
const imp=f=>import(pathToFileURL(path.join(dir,f)).href);
const VALID=Buffer.from('valid').toString('base64');
const origVerify=crypto.subtle.verify.bind(crypto.subtle);
let cand,q,DatabaseSync,seq=0;
const BASE=`CREATE TABLE research_jobs(id TEXT PRIMARY KEY,question TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETE','FAILED')),result_json TEXT,error_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX idx_research_jobs_state_created ON research_jobs(state,created_at);CREATE TABLE internal_nonces(nonce TEXT PRIMARY KEY,created_at INTEGER NOT NULL);`;
function d1({migrate=true}={}){
 const db=new DatabaseSync(':memory:');db.exec(BASE);if(migrate)db.exec(fs.readFileSync(path.join(dir,'d1-queue-migration.sql'),'utf8'));
 return {raw:db,prepare(sql){const st=db.prepare(sql);return {async all(){return {results:st.all()}},bind(...a){return {async run(){return {meta:{changes:Number(st.run(...a).changes)}}},async first(){return st.get(...a)||null}}}}}};
}
function kv(){const m=new Map();return {m,async get(k,t){const v=m.get(k);return v==null?null:(t==='json'?JSON.parse(v):v)},async put(k,v){m.set(k,String(v))}}}
const sess=n=>String(n).padStart(32,'a').replace(/[^a-f0-9]/g,'a').slice(-32);
const post=(env,question,s)=>cand.default.fetch(new Request(API+'/api/research',{method:'POST',headers:{origin:UI,'content-type':'application/json',...(s?{'x-tens-public-session':s}:{})},body:JSON.stringify({question})}),env);
const status=(env,id)=>cand.default.fetch(new Request(API+'/api/research/status?jobId='+id,{headers:{origin:UI}}),env);
const internal=(env,p,body,nonce)=>cand.default.fetch(new Request(API+p,{method:'POST',headers:{'x-tens-timestamp':String(Date.now()),'x-tens-nonce':nonce||('nonce'+(seq++)+'x'.repeat(16)),'x-tens-signature':VALID},body:JSON.stringify(body||{})}),env);
const good=(over={})=>({protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,assignmentId:'A',checkpointHash:'h',verified:[],unknowns:[{statement:'u'}],sources:[],...over});
test.before(async()=>{
 ({DatabaseSync}=require('node:sqlite'));
 Object.defineProperty(crypto.subtle,'verify',{configurable:true,value:async(a,k,sig)=>Buffer.from(sig).toString()==='valid'||false});
 cand=await imp('worker-d1-candidate.mjs');q=await imp('d1-research-queue.mjs');
});
test.after(()=>Object.defineProperty(crypto.subtle,'verify',{configurable:true,value:origVerify}));

test('flag off: identical to legacy (job goes to KV, D1 untouched)',async()=>{
 const env={TENS_PUBLIC_JOBS:kv(),DB:d1()};const r=await post(env,'Midnight Pass?');assert.equal(r.status,202);
 assert.ok(env.TENS_PUBLIC_JOBS.m.has('queue:index:v1'));assert.equal(env.DB.raw.prepare('select count(*) c from research_jobs').get().c,0);
});
test('flag on but schema not migrated or D1 missing/throwing: 503, never falls back to KV',async()=>{
 for(const DB of [d1({migrate:false}),undefined,{prepare(){throw new Error('boom')}}]){
  const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB};
  assert.equal((await post(env,'q',sess(1))).status,503);assert.equal((await internal(env,'/internal/claim')).status,503);
  assert.equal(env.TENS_PUBLIC_JOBS.m.size,0,'KV must stay untouched');
 }
});
test('non-research routes are always delegated (health, PRR) even with flag on',async()=>{
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB:undefined};
 assert.equal((await (await cand.default.fetch(new Request(API+'/health'),env)).json()).state,'TENS_R204_PUBLIC_BRIDGE_READY');
 assert.equal((await cand.default.fetch(new Request(API+'/api/prr/submit',{method:'POST',headers:{origin:UI}}),env)).status,403);
});
test('concurrent real handler POSTs -> distinct IDs, all independently claimable, no KV index',async()=>{
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB:d1()};
 const rs=await Promise.all(Array.from({length:6},(_,i)=>post(env,'q'+i,sess(i+10))));
 const ids=await Promise.all(rs.map(async r=>(assert.equal(r.status,202),(await r.json()).jobId)));
 assert.equal(new Set(ids).size,6);
 const claims=await Promise.all(ids.map(()=>internal(env,'/internal/claim').then(r=>r.json())));
 assert.equal(new Set(claims.map(c=>c.jobId)).size,6);assert.ok(claims.every(c=>c.state==='CLAIMED'&&c.claimToken));
 assert.equal(env.TENS_PUBLIC_JOBS.m.size,0);
 assert.equal((await (await internal(env,'/internal/claim')).json()).state,'EMPTY');
});
test('wrong, replayed, stale and cross-job claim tokens cannot finish jobs',async()=>{
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB:d1()};
 const a=(await (await post(env,'a',sess(1))).json()).jobId,b=(await (await post(env,'b',sess(2))).json()).jobId;
 const first=await (await internal(env,'/internal/claim')).json(),second=await (await internal(env,'/internal/claim')).json();
 assert.deepEqual(new Set([first.jobId,second.jobId]),new Set([a,b]),'both jobs claimed once');
 // Jobs submitted within one millisecond tie on created_at; FIFO then orders by random job ID.
 // Associate tokens with job identity rather than assuming submission order wins the tie.
 const ca=first.jobId===a?first:second,cb=first.jobId===b?first:second;
 assert.equal((await internal(env,'/internal/complete',{jobId:a,claimToken:cb.claimToken,result:good()})).status,409,'other job token');
 assert.equal((await internal(env,'/internal/complete',{jobId:a,claimToken:'nope',result:good()})).status,409);
 assert.equal((await internal(env,'/internal/fail',{jobId:a})).status,409,'missing token');
 const n='replayed-nonce-aaaaaaaaaa';
 assert.equal((await internal(env,'/internal/complete',{jobId:a,claimToken:ca.claimToken,result:good()},n)).status,200);
 assert.equal((await internal(env,'/internal/complete',{jobId:a,claimToken:ca.claimToken,result:good()},n)).status,401,'replayed nonce');
 assert.equal((await internal(env,'/internal/complete',{jobId:a,claimToken:ca.claimToken,result:good()})).status,409,'second finish');
 // lease expiry: age b's lease then reclaim; old token is dead
 env.DB.raw.prepare('update research_jobs set claim_expires_at=1 where id=?').run(b);
 const cb2=await (await internal(env,'/internal/claim')).json();assert.equal(cb2.jobId,b);assert.equal(cb2.reclaimed,true);
 assert.equal((await internal(env,'/internal/complete',{jobId:b,claimToken:cb.claimToken,result:good()})).status,409,'stale token');
 assert.equal((await internal(env,'/internal/complete',{jobId:b,claimToken:cb2.claimToken,result:good()})).status,200);
 assert.equal((await (await status(env,b)).json()).state,'COMPLETE');
});
test('unsigned or badly signed internal calls are rejected before any state change',async()=>{
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB:d1()};await post(env,'a',sess(1));
 const bad=await cand.default.fetch(new Request(API+'/internal/claim',{method:'POST',headers:{'x-tens-timestamp':String(Date.now()),'x-tens-nonce':'n'.repeat(20),'x-tens-signature':Buffer.from('forged').toString('base64')},body:'{}'}),env);
 assert.equal(bad.status,401);assert.equal(env.DB.raw.prepare("select count(*) c from research_jobs where state='RUNNING'").get().c,0);
 assert.equal((await cand.default.fetch(new Request(API+'/internal/claim',{method:'POST',body:'{}'}),env)).status,401);
});
test('already-queued legacy job is not stranded: dual-read status, legacy-first claim, legacy token enforced, new writes D1-only',async()=>{
 const kvs=kv(),DB=d1();
 const legacyEnv={TENS_PUBLIC_JOBS:kvs,DB};                       // flag off: how the stuck R203WEB job was created
 const old=(await (await post(legacyEnv,'old question')).json()).jobId;
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kvs,DB};
 const snapshot=kvs.m.get('queue:index:v1');
 const neu=(await (await post(env,'new question',sess(5))).json()).jobId;
 assert.equal(kvs.m.get('queue:index:v1'),snapshot,'legacy KV queue index must be untouched by new writes');
 assert.equal((await (await status(env,old)).json()).state,'QUEUED','legacy status still readable');
 assert.equal((await (await status(env,neu)).json()).state,'QUEUED');
 const c1=await (await internal(env,'/internal/claim')).json();assert.equal(c1.jobId,old,'oldest (legacy) first');
 assert.equal((await internal(env,'/internal/complete',{jobId:old,claimToken:'wrong',result:good()})).status,409,'legacy token enforced by legacy');
 const c2=await (await internal(env,'/internal/claim')).json();assert.equal(c2.jobId,neu,'then D1');
 assert.equal((await internal(env,'/internal/complete',{jobId:old,claimToken:c1.claimToken,result:good()})).status,200);
 assert.equal((await (await status(env,old)).json()).state,'COMPLETE');
 assert.equal((await internal(env,'/internal/complete',{jobId:neu,claimToken:c2.claimToken,result:good()})).status,200);
 assert.equal((await internal(env,'/internal/complete',{jobId:neu,claimToken:c1.claimToken,result:good()})).status,409);
});
test('session separation: header required, per-session active cap, other sessions unaffected, only a hash is stored',async()=>{
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB:d1()};
 assert.equal((await post(env,'q')).status,400);assert.equal((await post(env,'q','not-hex')).status,400);
 for(let i=0;i<q.MAX_PER_SESSION;i++)assert.equal((await post(env,'q'+i,sess(7))).status,202);
 assert.equal((await post(env,'over',sess(7))).status,429);
 assert.equal((await post(env,'other',sess(8))).status,202);
 const hashes=env.DB.raw.prepare('select distinct session_hash h from research_jobs').all().map(r=>r.h);
 assert.ok(hashes.every(h=>/^[a-f0-9]{64}$/.test(h)&&h!==sess(7)&&h!==sess(8)));
});
test('result must be exact TENS_R202 protocol and source-backed (server mirror of evidence guard)',async()=>{
 const env={TENS_D1_QUEUE:FLAG,TENS_PUBLIC_JOBS:kv(),DB:d1()};
 const src=over=>({evidenceId:'E1',preservationVerified:true,url:'https://example.gov/r.pdf',...over});
 const cases=[['protocol',good({protocol:'TENS_R204_PUBLIC_RESULT_1'}),'RESULT_SCHEMA_REJECTED'],
  ['uncited',good({verified:[{evidenceRefs:['X']}],sources:[src()]}),'RESULT_NOT_SOURCE_BACKED_VERIFIED_UNCITED'],
  ['nosrc',good({verified:[{evidenceRefs:['E1']}],sources:[]}),'RESULT_NOT_SOURCE_BACKED_VERIFIED_UNCITED'],
  ['unpres',good({verified:[{evidenceRefs:['E1']}],sources:[src({preservationVerified:false})]}),'RESULT_NOT_SOURCE_BACKED_SOURCE_NOT_PRESERVED'],
  ['http',good({verified:[{evidenceRefs:['E1']}],sources:[src({url:'http://x.gov/a'})]}),'RESULT_NOT_SOURCE_BACKED_SOURCE_NOT_PUBLIC']];
 for(const [name,result,code] of cases){
  const id=(await (await post(env,name,sess(20+cases.length))).json()).jobId,c=await (await internal(env,'/internal/claim')).json();
  const r=await internal(env,'/internal/complete',{jobId:c.jobId,claimToken:c.claimToken,result});assert.equal(r.status,400,name);assert.equal((await r.json()).error,code,name);
  await internal(env,'/internal/fail',{jobId:c.jobId,claimToken:c.claimToken,errorCode:'X'});
 }
 const id=(await (await post(env,'ok',sess(30))).json()).jobId,c=await (await internal(env,'/internal/claim')).json();
 assert.equal((await internal(env,'/internal/complete',{jobId:id,claimToken:c.claimToken,result:good({verified:[{evidenceRefs:['E1']}],sources:[src()]})})).status,200);
});
test('candidate hygiene: legacy worker.mjs verification key unchanged, candidate not wired to R212 or defaults',()=>{
 const w=fs.readFileSync(path.join(dir,'worker.mjs'),'utf8'),c=fs.readFileSync(path.join(dir,'worker-d1-candidate.mjs'),'utf8');
 const key=w.match(/const PUBLIC_KEY=(\{[^}]*\});/)[1];assert.ok(c.includes('const PUBLIC_KEY='+key+';'),'PUBLIC_KEY drift between worker.mjs and candidate');
 const msgExpr="msg=enc.encode(ts+'\\n'+nonce+'\\n'+r.method+'\\n'+new URL(r.url).pathname+'\\n'+digest)";
 assert.ok(w.includes(msgExpr),'legacy signed-message format changed');assert.ok(c.includes(msgExpr),'candidate signed-message format drifted');
 assert.doesNotMatch(c.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'),/r212|activationProof/i);assert.ok(c.includes("env?.TENS_D1_QUEUE!==FLAG"));
});
