'use strict';
// Offline. SQLite shim behind a D1-shaped API: proves the harness's refusals/logic, NOT real Cloudflare D1.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'../backend/cloudflare-r204-review');
let H,DatabaseSync;
const SCHEMA=fs.readFileSync(path.join(__dirname,'d1-research-queue.test.cjs'),'utf8').match(/const SCHEMA=`([\s\S]*?)`;/)[1];
function d1({marker=true,migrate=true,markerRow}={}){
 const raw=new DatabaseSync(':memory:');raw.exec(SCHEMA);if(migrate)raw.exec(fs.readFileSync(path.join(dir,'d1-queue-migration.sql'),'utf8'));
 if(marker){raw.exec('CREATE TABLE tens_acceptance_marker(database_id TEXT,environment TEXT,approval_nonce TEXT)');const m=markerRow||['db-disposable-0001','NONPRODUCTION_DISPOSABLE','n'.repeat(20)];raw.prepare('INSERT INTO tens_acceptance_marker VALUES(?,?,?)').run(...m)}
 const stmt=(sql,args=[])=>{const st=raw.prepare(sql);return {all:async()=>({results:st.all(...args)}),run:async()=>({meta:{changes:Number(st.run(...args).changes)}}),first:async()=>st.get(...args)||null}};
 return {raw,prepare(sql){return {...stmt(sql),bind:(...a)=>stmt(sql,a)}},
  async batch(list){raw.exec('BEGIN');try{const o=[];for(const s of list)o.push(await s.run());raw.exec('COMMIT');return o}catch(e){raw.exec('ROLLBACK');throw e}}};
}
const NOW=Date.parse('2026-10-14T03:00:00Z'),RUN='abcd1234';
async function approval(over={}){const a={schema:'TENS_D1_ACCEPTANCE_APPROVAL_V1',environment:'NONPRODUCTION_DISPOSABLE',databaseId:'db-disposable-0001',databaseName:'tens-acceptance-disposable',productionDatabaseIds:['11111111-2222-3333-4444-555555555555'],approvedBy:'owner',approvalNonce:'n'.repeat(20),approvedAt:'2026-10-14T02:00:00Z',expiresAt:'2026-10-14T05:00:00Z',mutationsApproved:true,runId:RUN,...over};
 if(!('approvalDigest' in over))a.approvalDigest=await H.approvalDigest(a);return {approval:a}}
test.before(async()=>{({DatabaseSync}=require('node:sqlite'));H=await import(pathToFileURL(path.join(dir,'d1-acceptance-harness.mjs')).href)});

test('default preflight touches no binding, reports NOT_RUN and no proof flags',async()=>{
 const touched=[];const db=new Proxy({},{get(_,k){touched.push(k);return ()=>{}}});
 const r=await H.run({db,now:NOW});
 assert.equal(r.status,'NOT_RUN_NO_REAL_D1_PROOF');assert.equal(r.realD1Proof,false);assert.deepEqual(touched,[]);
 for(const k of ['production','network','migrationsApplied','otherTablesTouched','signingCredentials','sourceClaimUpgrade','r212RuntimeAdmission'])assert.equal(r[k],false,k);
 assert.match(r.receiptSha256,/^[a-f0-9]{64}$/);
});
test('refuses unknown mode, missing approval, and missing binding',async()=>{
 assert.equal((await H.run({mode:'x',now:NOW})).status,'REFUSED');
 assert.deepEqual((await H.run({mode:'readonly',db:d1(),config:{},now:NOW})).reasons,['APPROVAL_MISSING']);
 assert.deepEqual((await H.run({mode:'readonly',config:await approval(),now:NOW})).reasons,['BINDING_NOT_SUPPLIED']);
});
test('refuses production/unknown identity, names, expired or oversized windows, bad digest',async()=>{
 const cases={prodName:{databaseName:'tens-research-jobs'},prodNameCase:{databaseName:'TENS-Research-Jobs'},env:{environment:'PRODUCTION'},prodId:{databaseId:'11111111-2222-3333-4444-555555555555'},noDeny:{productionDatabaseIds:[]},expired:{expiresAt:'2026-10-14T02:30:00Z'},future:{approvedAt:'2026-10-14T03:30:00Z',expiresAt:'2026-10-14T04:00:00Z'},long:{approvedAt:'2026-10-14T00:00:00Z',expiresAt:'2026-10-14T09:00:00Z'},noMut:{mutationsApproved:false},otherRun:{runId:'ffffffff'},badDigest:{approvalDigest:'0'.repeat(64)},noNonce:{approvalNonce:'x'}};
 for(const [k,o] of Object.entries(cases)){const db=d1();const r=await H.run({mode:'mutate',db,config:await approval(o),runId:RUN,now:NOW});assert.equal(r.status,'REFUSED',k);assert.equal(db.raw.prepare('select count(*) c from research_jobs').get().c,0,k)}
 const e=await H.run({mode:'mutate',db:d1(),config:await approval({approvalDigest:'0'.repeat(64)}),runId:RUN,now:NOW});assert.ok(e.reasons.includes('APPROVAL_DIGEST_MISMATCH'));
});
test('marker must exist and match; self-asserted approval alone is not enough',async()=>{
 for(const [name,db] of [['none',d1({marker:false})],['wrongId',d1({markerRow:['other-db-00001','NONPRODUCTION_DISPOSABLE','n'.repeat(20)]})],['wrongEnv',d1({markerRow:['db-disposable-0001','PRODUCTION','n'.repeat(20)]})],['wrongNonce',d1({markerRow:['db-disposable-0001','NONPRODUCTION_DISPOSABLE','z'.repeat(20)]})]]){
  const r=await H.run({mode:'mutate',db,config:await approval(),runId:RUN,now:NOW});assert.equal(r.status,'HOLD',name);assert.equal(db.raw.prepare('select count(*) c from research_jobs').get().c,0,name)}
});
test('unmigrated schema or non-empty active queue is HOLD; harness never migrates',async()=>{
 const un=d1({migrate:false});let r=await H.run({mode:'mutate',db:un,config:await approval(),runId:RUN,now:NOW});
 assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('MIGRATION_NOT_APPLIED_HARNESS_WILL_NOT_APPLY_IT'));assert.ok(r.classification.missingColumns.includes('claim_token'));
 assert.equal(un.raw.prepare("select count(*) c from pragma_table_info('research_jobs') where name='claim_token'").get().c,0);
 const busy=d1();busy.raw.prepare("INSERT INTO research_jobs(id,question,state,created_at,updated_at) VALUES('R203WEB_realjob000000000000000001','q','QUEUED',1780000000000,1780000000000)").run();
 r=await H.run({mode:'mutate',db:busy,config:await approval(),runId:RUN,now:NOW});assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('NON_EMPTY_ACTIVE_QUEUE_CLAIM_WOULD_TOUCH_FOREIGN_ROWS'));
 assert.equal(busy.raw.prepare("select state from research_jobs").get().state,'QUEUED');
});
test('readonly classifies only and mutates nothing',async()=>{
 const db=d1();const before=db.raw.prepare('select count(*) c from research_jobs').get().c;
 const r=await H.run({mode:'readonly',db,config:await approval({mutationsApproved:false}),now:NOW});
 assert.equal(r.status,'NOT_RUN_NO_REAL_D1_PROOF');assert.equal(r.classification.marker,'MATCHES_OWNER_APPROVAL');assert.deepEqual(r.classification.missingColumns,[]);assert.equal(r.scenarios.length,0);
 assert.equal(db.raw.prepare('select count(*) c from research_jobs').get().c,before);
});
test('authorized mutate on shim: every scenario passes, fixtures cleaned, foreign rows untouched, NOT claimed as real D1',async()=>{
 const db=d1();db.raw.prepare("INSERT INTO research_jobs(id,question,state,result_json,created_at,updated_at) VALUES('R203WEB_realjob000000000000000002','q','COMPLETE','{}',1780000000000,1780000000000)").run();
 db.raw.prepare("INSERT INTO internal_nonces VALUES('real-nonce',1780000000000)").run();
 const r=await H.run({mode:'mutate',db,config:await approval(),runId:RUN,now:NOW});
 assert.equal(r.scenarios.filter(s=>!s.ok).length,0,JSON.stringify(r.scenarios.filter(s=>!s.ok)));assert.ok(r.scenarios.length>=13);
 assert.equal(r.status,'SCENARIOS_PASSED_BINDING_NOT_WITNESSED_AS_CLOUDFLARE');assert.equal(r.realD1Proof,false);
 assert.equal(r.cleanup.error,null);assert.equal(db.raw.prepare('select count(*) c from research_jobs').get().c,1);assert.equal(db.raw.prepare('select count(*) c from internal_nonces').get().c,1);
 assert.equal(db.raw.prepare('select count(*) c from tens_acceptance_marker').get().c,1);
});
test('forged Workers user-agent cannot promote a SQLite fixture into REAL D1 proof',async()=>{
 const had=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Cloudflare-Workers'},configurable:true});
 try{
  const r=await H.run({mode:'mutate',db:d1(),config:await approval(),runId:RUN,now:NOW});
  assert.equal(r.status,'SCENARIOS_PASSED_BINDING_NOT_WITNESSED_AS_CLOUDFLARE');
  assert.equal(r.realD1Proof,false);
  assert.ok(r.reasons.includes('EXTERNAL_NONPRODUCTION_D1_ATTESTATION_NOT_ESTABLISHED'));
 }finally{if(had)Object.defineProperty(globalThis,'navigator',had);else delete globalThis.navigator}
});
test('a broken queue is reported FAIL, not passed (no false green)',async()=>{
 const db=d1();const orig=db.prepare;db.prepare=sql=>/SET state='COMPLETE'/.test(sql)?{bind:()=>({run:async()=>({meta:{changes:1}}),first:async()=>null,all:async()=>({results:[]})})}:orig(sql);
 const r=await H.run({mode:'mutate',db,config:await approval(),runId:RUN,now:NOW});assert.equal(r.status,'FAIL');assert.equal(r.realD1Proof,false);
});
test('harness source has no network, credentials, migration application or unscoped deletes',()=>{
 const s=fs.readFileSync(path.join(dir,'d1-acceptance-harness.mjs'),'utf8').split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
 assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|process\.env|api[_-]?token|secret|ALTER TABLE|CREATE TABLE|DROP /i.test(s));
 for(const m of s.matchAll(/DELETE FROM[^`'"]*/g))assert.match(m[0],/WHERE (id|nonce) IN/);
});
