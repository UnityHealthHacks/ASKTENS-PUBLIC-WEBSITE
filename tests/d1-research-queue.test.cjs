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
 let sigOk=true;const ctx={uiOrigin:UI,json,bodyText:r=>r.text(),verifyInternal:async()=>sigOk,sessionHash:async r=>{const t=r.headers.get('x-tens-public-session')||'';return /^[a-f0-9]{32}$/.test(t)?Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('t:'+t))).toString('hex'):false}},env={DB:db};const SESS='a'.repeat(32);
 const pub=(p,o={})=>Q.handleResearchRoute(new Request('https://api.asktens.com'+p,{headers:{origin:UI,'content-type':'application/json','x-tens-public-session':SESS},...o}),env,ctx);
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
 // fail-closed status: no resolver / missing / wrong / malformed session => uniform 404, no data, no lazy-expiry write
 const stale=await (await pub('/api/research',{method:'POST',body:JSON.stringify({question:'stale'})})).json();
 db.raw.prepare('UPDATE research_jobs SET created_at=? WHERE id=?').run(Date.now()-Q.TTL_MS-5000,stale.jobId);
 const st404=async(c,h)=>{const r=await Q.handleResearchRoute(new Request('https://api.asktens.com/api/research/status?jobId='+stale.jobId,{headers:{origin:UI,...h}}),env,c);assert.equal(r.status,404);const t=await r.text();assert.ok(!/QUEUED|FAILED|EXPIRED|stale/.test(t));};
 const {sessionHash:_r,...noResolver}=ctx;
 await st404(noResolver,{'x-tens-public-session':SESS});await st404(noResolver,{});await st404(ctx,{});await st404(ctx,{'x-tens-public-session':'b'.repeat(32)});await st404(ctx,{'x-tens-public-session':'zz'});
 await st404({...ctx,sessionHash:async()=>undefined},{'x-tens-public-session':SESS});await st404({...ctx,sessionHash:async()=>null},{'x-tens-public-session':SESS});
 assert.equal(db.raw.prepare('select state from research_jobs where id=?').get(stale.jobId).state,'QUEUED','unauthorised polls must not expire');
 assert.equal((await (await pub('/api/research/status?jobId='+stale.jobId)).json()).state,'FAILED','owner poll expires');
 // fail-closed POST: no resolver / malformed or non-hash resolver result / missing or bad token => no row written
 const rows=()=>db.raw.prepare('select count(*) c from research_jobs').get().c,before=rows();
 const postWith=(c,h)=>Q.handleResearchRoute(new Request('https://api.asktens.com/api/research',{method:'POST',headers:{origin:UI,'content-type':'application/json',...h},body:JSON.stringify({question:'anon'})}),env,c);
 const H={'x-tens-public-session':SESS};
 for(let i=0;i<4;i++)assert.equal((await postWith(noResolver,H)).status,400,'no resolver');
 for(const bad of [null,undefined,false,'',  'abc','A'.repeat(64),'g'.repeat(64),'a'.repeat(63),123,{}])assert.equal((await postWith({...ctx,sessionHash:async()=>bad},H)).status,400,String(bad));
 assert.equal((await postWith(ctx,{})).status,400,'missing token');assert.equal((await postWith(ctx,{'x-tens-public-session':'zz'})).status,400,'bad token');
 assert.equal(rows(),before,'no writes on any refusal');
 assert.equal((await postWith(ctx,H)).status,202,'correct resolver still enqueues');
 assert.equal(db.raw.prepare('select count(*) c from research_jobs where session_hash is null').get().c,0,'no NULL session_hash rows');
});


test('all cited sources require hash, unique identity, supported source type and safe HTTPS syntax',async()=>{
 const clean={evidenceId:'DOC_001',preservationVerified:true,sourceKind:'PUBLIC_WEB',url:'https://example.gov/record',contentHash:'a'.repeat(64)};
 const archived={...clean,sourceKind:'ARCHIVED_PUBLIC_RECORD',url:undefined};
 const base=()=>({...good(),verified:[{statement:'Direct source finding',evidenceRefs:['DOC_001']}],sources:[clean]});
 assert.equal(Q.sourceProblem(base()),'','valid HTTPS original');
 assert.equal(Q.sourceProblem({...base(),sources:[archived]}),'','valid hash-bound archived source without public URL');
 assert.equal(Q.sourceProblem(good()),'','UNKNOWN/no claims remains accepted');
 const bad=[
   [{...clean,contentHash:undefined},'SOURCE_HASH_MISSING'],
   [{...clean,contentHash:'not-a-hash'},'SOURCE_HASH_MISSING'],
   [{...clean,url:'https://example.gov@attacker.example/record'},'SOURCE_NOT_PUBLIC'],
   [{...clean,url:'http://example.gov/record'},'SOURCE_NOT_PUBLIC'],
   [{...clean,url:'https://localhost/record'},'SOURCE_NOT_PUBLIC'],
   [{...clean,url:'https://127.0.0.1/record'},'SOURCE_NOT_PUBLIC'],
   [{...clean,url:'https://[::1]/record'},'SOURCE_NOT_PUBLIC'],
   [{...clean,url:'https://example.gov/record#section'},'SOURCE_NOT_PUBLIC'],
   ...['https://localhost./record','https://app.localhost/record','https://printer/record','https://db.internal/record','https://example.local./record'].map(url=>[{...clean,url},'SOURCE_NOT_PUBLIC']),
   [{...clean,sourceKind:'PERSONAL_DRIVE'},'SOURCE_KIND_INVALID'],
   [{...clean,contentHash:'b'.repeat(64),sourceKind:'ARCHIVED_PUBLIC_RECORD',url:'https://example.gov@attacker.example/x'},'SOURCE_URL_UNSAFE']
 ];
 for(const [source,reason] of bad){
  const x={...base(),sources:[source]};
  assert.equal(Q.sourceProblem(x),reason,JSON.stringify(source));
 }
 assert.equal(Q.sourceProblem({...base(),sources:[clean,{...clean,contentHash:'b'.repeat(64)}]}),'SOURCE_DUPLICATE');
 assert.equal(Q.sourceProblem({...base(),verified:[{statement:'no support',evidenceRefs:['OTHER_DOC']}]}),'VERIFIED_UNCITED');
});

test('D1 completion rejects forged source envelopes atomically but accepts valid and UNKNOWN results',async()=>{
 const goodSource={evidenceId:'DOC_001',sourceKind:'PUBLIC_WEB',url:'https://example.gov/permit',contentHash:'c'.repeat(64),preservationVerified:true};
 const make=sources=>({...good(),verified:[{statement:'Relevant directly sourced claim',evidenceRefs:['DOC_001']}],sources});
 const cases=[
   {name:'missing hash',sources:[{...goodSource,contentHash:undefined}],accept:false},
   {name:'malformed hash',sources:[{...goodSource,contentHash:'bad'}],accept:false},
   {name:'userinfo URL',sources:[{...goodSource,url:'https://example.gov@attacker.example/permit'}],accept:false},
   {name:'duplicate cited identity',sources:[goodSource,{...goodSource,contentHash:'d'.repeat(64)}],accept:false},
   {name:'valid public source',sources:[goodSource],accept:true},
   {name:'valid archived source',sources:[{...goodSource,url:undefined,sourceKind:'ARCHIVED_PUBLIC_RECORD'}],accept:true}
 ];
 for(let i=0;i<cases.length;i++){
  const item=cases[i],db=d1(),jobId=id(100+i),now=10000+i;
  await Q.enqueue(db,{id:jobId,question:'test',now});
  const c=await Q.claim(db,{now:now+1,token:'tok'+i});
  const r=await Q.complete(db,{jobId,claimToken:c.claimToken,result:make(item.sources),now:now+2});
  assert.equal(r.status,item.accept?200:400,item.name);
  const st=await Q.status(db,jobId);
  assert.equal(st.state,item.accept?'COMPLETE':'RUNNING',item.name);
 }
});

test('scoped acceptance claim skips foreign FIFO jobs while ordinary unscoped claim stays unchanged',async()=>{
 const db=d1();
 await Q.enqueue(db,{id:id(1),question:'foreign older',now:1001});
 await Q.enqueue(db,{id:id(2),question:'scoped fixture',now:1002});
 const s=await Q.claim(db,{now:2000,token:'scope-token',scopeJobIds:[id(2)]});
 assert.equal(s.jobId,id(2));assert.equal(db.raw.prepare('SELECT state FROM research_jobs WHERE id=?').get(id(1)).state,'QUEUED');
 const defaultClaim=await Q.claim(db,{now:2001,token:'default-token'});
 assert.equal(defaultClaim.jobId,id(1),'unscoped normal queue semantics remain FIFO');
});
test('scoped expiry never expires a different stale job; invalid scope refuses before writes',async()=>{
 const db=d1();
 await Q.enqueue(db,{id:id(1),question:'foreign stale',now:1000});
 await Q.enqueue(db,{id:id(2),question:'scoped stale',now:1001});
 const rejected=await Q.claim(db,{now:1000+Q.TTL_MS+5,token:'nope',scopeJobIds:[]});
 assert.equal(rejected.state,'REFUSED');
 assert.equal(db.raw.prepare('SELECT state FROM research_jobs WHERE id=?').get(id(1)).state,'QUEUED');
 const scoped=await Q.claim(db,{now:1000+Q.TTL_MS+5,token:'valid',scopeJobIds:[id(2)]});
 assert.equal(scoped.state,'EMPTY');
 assert.equal(db.raw.prepare('SELECT state FROM research_jobs WHERE id=?').get(id(2)).state,'FAILED');
 assert.equal(db.raw.prepare('SELECT state FROM research_jobs WHERE id=?').get(id(1)).state,'QUEUED');
});
test('status lazily expires only the requested stale job; plain status stays a pure read',async()=>{
 const db=d1();const old=1000,fresh=1000+Q.TTL_MS+500,now=1000+Q.TTL_MS+1000;
 await Q.enqueue(db,{id:id(31),question:'old',now:old});await Q.enqueue(db,{id:id(32),question:'old other',now:old});await Q.enqueue(db,{id:id(33),question:'fresh',now:fresh});
 assert.equal((await Q.status(db,id(31))).state,'QUEUED','no now => no write');
 const s=await Q.status(db,id(31),{now});assert.equal(s.state,'FAILED');assert.equal(s.errorCode,'EXPIRED_UNCLAIMED');
 assert.equal((await Q.status(db,id(32))).state,'QUEUED','other stale job untouched by exact-id scope');
 assert.equal((await Q.status(db,id(33),{now})).state,'QUEUED','fresh job not expired');
 assert.equal((await Q.status(db,'not-a-job',{now})),null);
 const c=await Q.complete(db,{jobId:id(31),claimToken:'x',result:good(),now});assert.equal(c.status,409);
});

// Oct 17 review-only boundary regression: do not admit coercible evidence IDs,
// hashes, orphan sources or contradictory answer states as a completed result.
test('reject non-string source identities and contradictory source-backed answers',()=>{
 const x={evidenceId:'DOC_001',sourceKind:'PUBLIC_WEB',url:'https://example.gov/record',contentHash:'a'.repeat(64),preservationVerified:true};
 const envelope=(sources,verified=[],answer='UNKNOWN')=>({sources,verified,answer});
 assert.equal(Q.sourceProblem(envelope([{...x,evidenceId:['DOC_001']}])),'SOURCE_NOT_PRESERVED');
 assert.equal(Q.sourceProblem(envelope([{...x,contentHash:['a'.repeat(64)]}])),'SOURCE_HASH_MISSING');
 assert.equal(Q.sourceProblem(envelope([x])),'SOURCE_UNCITED');
 assert.equal(Q.sourceProblem(envelope([],[],'VERIFIED')),'ANSWER_CONFLICT');
 assert.equal(Q.sourceProblem(envelope([x],[{evidenceRefs:['DOC_001']}],'UNKNOWN')),'ANSWER_CONFLICT');
 assert.equal(Q.sourceProblem(envelope([x],[{evidenceRefs:[['DOC_001']]}],'VERIFIED')),'VERIFIED_UNCITED');
 assert.equal(Q.sourceProblem(envelope([],[],'UNKNOWN')),'');
 assert.equal(Q.sourceProblem(envelope([x],[{evidenceRefs:['DOC_001']}],'VERIFIED')),'');
});
