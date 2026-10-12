'use strict';
// Offline: real SQLite (node:sqlite) behind a D1-shaped shim. No Cloudflare, no network, no keys. Proves SQL semantics only, NOT the deployed D1.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'../backend/cloudflare-r204-review');
let Q,DatabaseSync;
const SCHEMA=`CREATE TABLE research_jobs(id TEXT PRIMARY KEY,question TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETE','FAILED')),result_json TEXT,error_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX idx_research_jobs_state_created ON research_jobs(state,created_at);
CREATE TABLE internal_nonces(nonce TEXT PRIMARY KEY,created_at INTEGER NOT NULL);`;
function d1(){
 const db=new DatabaseSync(':memory:');db.exec(SCHEMA);db.exec(fs.readFileSync(path.join(dir,'d1-queue-migration.sql'),'utf8'));
 return {raw:db,prepare(sql){const st=db.prepare(sql);return {async all(){return {results:st.all()}},bind(...a){return {
  async run(){const r=st.run(...a);return {meta:{changes:Number(r.changes)}}},
  async first(){return st.get(...a)||null}}}}}};
}
const id=n=>'R203WEB_'+String(n).padStart(24,'0');
const good=()=>({protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,assignmentId:'A',checkpointHash:'h',verified:[],unknowns:[],sources:[]});
test.before(async()=>{({DatabaseSync}=require('node:sqlite'));Q=await import(pathToFileURL(path.join(dir,'d1-research-queue.mjs')).href)});

test('concurrent enqueues all land (no lost update) and claim is FIFO',async()=>{
 const db=d1();await Promise.all([3,1,2].map((n,i)=>Q.enqueue(db,{id:id(n),question:'q'+n,now:1000+n})));
 assert.equal(db.raw.prepare('select count(*) c from research_jobs').get().c,3);
 const order=[];for(let i=0;i<3;i++)order.push((await Q.claim(db,{now:2000,token:'t'+i})).jobId);
 assert.deepEqual(order,[id(1),id(2),id(3)]);assert.equal((await Q.claim(db,{now:2000})).state,'EMPTY');
});
test('parallel claims never hand out the same job',async()=>{
 const db=d1();for(let n=1;n<=5;n++)await Q.enqueue(db,{id:id(n),question:'q',now:1000+n});
 const got=(await Promise.all(Array.from({length:8},(_,i)=>Q.claim(db,{now:2000,token:'tok'+i})))).filter(c=>c.state==='CLAIMED').map(c=>c.jobId);
 assert.equal(got.length,5);assert.equal(new Set(got).size,5);
});
test('queue bound is enforced atomically',async()=>{
 const db=d1();const rs=await Promise.all([1,2,3,4].map(n=>Q.enqueue(db,{id:id(n),question:'q',now:1000,maxActive:2})));
 assert.equal(rs.filter(r=>r.state==='QUEUED').length,2);assert.equal(rs.filter(r=>r.error==='RESEARCH_QUEUE_BUSY').length,2);
});
test('complete/fail require the exact current claim token',async()=>{
 const db=d1();await Q.enqueue(db,{id:id(1),question:'q',now:1000});const c=await Q.claim(db,{now:1500,token:'secret-1'});
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:'wrong',result:good()})).status,409);
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:'',result:good()})).status,409);
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:c.claimToken,result:{...good(),providerWrite:true}})).status,400);
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:c.claimToken,result:good(),now:1600})).status,200);
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:c.claimToken,result:good()})).status,409,'single use');
 assert.equal((await Q.fail(db,{jobId:id(1),claimToken:c.claimToken})).status,409,'no fail after complete');
 const s=await Q.status(db,id(1));assert.equal(s.state,'COMPLETE');assert.equal(s.result.assignmentId,'A');assert.equal(s.createdAt,1000);
});
test('expired claim is reclaimed, token rotates, old worker cannot complete',async()=>{
 const db=d1();await Q.enqueue(db,{id:id(1),question:'q',now:1000});
 const a=await Q.claim(db,{now:2000,token:'A'});assert.equal(a.reclaimed,false);
 assert.equal((await Q.claim(db,{now:2000+Q.CLAIM_MS-1})).state,'EMPTY','not yet expired');
 const b=await Q.claim(db,{now:2000+Q.CLAIM_MS,token:'B'});assert.equal(b.state,'CLAIMED');assert.equal(b.reclaimed,true);
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:'A',result:good()})).status,409);
 assert.equal((await Q.complete(db,{jobId:id(1),claimToken:'B',result:good(),now:2000+Q.CLAIM_MS+1})).status,200);
});
test('an expired lease cannot complete or fail even before another worker reclaims it',async()=>{
 const db=d1(),base=Date.now();
 await Q.enqueue(db,{id:id(17),question:'source check',now:base});
 await Q.enqueue(db,{id:id(18),question:'follow-up',now:base+1});
 const first=await Q.claim(db,{now:base+2,token:'lease17'});
 const second=await Q.claim(db,{now:base+3,token:'lease18'});
 assert.equal(first.jobId,id(17));assert.equal(second.jobId,id(18));
 assert.equal((await Q.complete(db,{jobId:first.jobId,claimToken:'lease17',result:good(),now:first.claimExpiresAt})).status,409,'completion at lease boundary forbidden');
 assert.equal((await Q.fail(db,{jobId:second.jobId,claimToken:'lease18',errorCode:'WORKER_HOLD',now:second.claimExpiresAt+1})).status,409,'failure after expired lease forbidden');
 assert.equal((await Q.status(db,id(17))).state,'RUNNING');
 assert.equal((await Q.status(db,id(18))).state,'RUNNING');
 const reclaimed=await Q.claim(db,{now:Math.max(first.claimExpiresAt,second.claimExpiresAt)+2,token:'fresh'});
 assert.equal(reclaimed.state,'CLAIMED');assert.equal(reclaimed.reclaimed,true);
 assert.equal((await Q.complete(db,{jobId:reclaimed.jobId,claimToken:'fresh',result:good(),now:Math.max(first.claimExpiresAt,second.claimExpiresAt)+3})).status,200);
});
test('fail records a bounded error code and never leaves a result',async()=>{
 const db=d1();await Q.enqueue(db,{id:id(1),question:'q',now:1});const c=await Q.claim(db,{now:2,token:'T'});
 assert.equal((await Q.fail(db,{jobId:id(1),claimToken:'T',errorCode:'X'.repeat(500),now:3})).status,200);
 const s=await Q.status(db,id(1));assert.equal(s.state,'FAILED');assert.equal(s.errorCode.length,120);assert.equal(s.result,null);
});
test('stale unclaimed jobs expire to FAILED instead of staying QUEUED forever',async()=>{
 const db=d1();await Q.enqueue(db,{id:id(1),question:'q',now:1000});
 assert.equal((await Q.claim(db,{now:1000+Q.TTL_MS+1})).state,'EMPTY');
 const s=await Q.status(db,id(1));assert.equal(s.state,'FAILED');assert.equal(s.errorCode,'EXPIRED_UNCLAIMED');
});
test('nonce replay is rejected across isolates (shared table) and old nonces are pruned',async()=>{
 const db=d1();assert.equal(await Q.consumeNonce(db,'n1',1000),true);assert.equal(await Q.consumeNonce(db,'n1',1001),false);
 assert.equal(await Q.consumeNonce(db,'n1',1000+Q.NONCE_MS+1),true);
});
test('route handler: public contract preserved; internal needs signature AND fresh nonce; claim -> complete -> status',async()=>{
 const db=d1(),UI='https://asktens.com';
 const json=(data,status=200,origin=null)=>new Response(JSON.stringify({...data,providerWrite:false,productionMutation:false}),{status,headers:origin?{'access-control-allow-origin':origin}:{}});
 let sigOk=true;const ctx={uiOrigin:UI,json,bodyText:r=>r.text(),verifyInternal:async()=>sigOk},env={DB:db};
 const pub=(p,o={})=>Q.handleResearchRoute(new Request('https://api.asktens.com'+p,{headers:{origin:UI,'content-type':'application/json'},...o}),env,ctx);
 let n=0;const internal=(p,body)=>Q.handleResearchRoute(new Request('https://api.asktens.com'+p,{method:'POST',headers:{'x-tens-nonce':'nonce-'+(n++)+'-aaaaaaaaaaaaaaaaaa'},body:JSON.stringify(body||{})}),env,ctx);
 assert.equal(await Q.handleResearchRoute(new Request('https://api.asktens.com/health'),env,ctx),null);
 assert.equal((await Q.handleResearchRoute(new Request('https://api.asktens.com/api/research',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}),env,ctx)).status,403);
 assert.equal((await pub('/api/research',{method:'POST',body:JSON.stringify({question:''})})).status,400);
 const post=await pub('/api/research',{method:'POST',body:JSON.stringify({question:'Midnight Pass?'})});assert.equal(post.status,202);
 const {jobId}=await post.json();assert.match(jobId,/^R203WEB_/);
 assert.equal((await (await pub('/api/research/status?jobId='+jobId)).json()).state,'QUEUED');
 sigOk=false;assert.equal((await internal('/internal/claim')).status,401);sigOk=true;
 const c=await (await internal('/internal/claim')).json();assert.equal(c.state,'CLAIMED');assert.equal(c.jobId,jobId);
 const nonce='replay-aaaaaaaaaaaaaaaaaaaa',mk=()=>new Request('https://api.asktens.com/internal/complete',{method:'POST',headers:{'x-tens-nonce':nonce},body:JSON.stringify({jobId,claimToken:c.claimToken,result:good()})});
 assert.equal((await Q.handleResearchRoute(mk(),env,ctx)).status,200);
 assert.equal((await Q.handleResearchRoute(mk(),env,ctx)).status,401,'replayed nonce');
 const st=await (await pub('/api/research/status?jobId='+jobId)).json();assert.equal(st.state,'COMPLETE');
 assert.equal((await pub('/api/research/status?jobId=bad')).status,400);
 assert.equal((await Q.handleResearchRoute(new Request('https://api.asktens.com/api/research/status?jobId='+jobId,{headers:{origin:UI}}),{},ctx)).status,503);
});
