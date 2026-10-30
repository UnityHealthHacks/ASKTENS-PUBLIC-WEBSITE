'use strict';
// REVIEW-ONLY. Synthetic reconstruction of the actual Oct 12 Cloudflare PRAGMA result.
// No production connection, no credentials, no network. 16 sample rows match aggregate counts,
// but NOT the contents of any real user record.
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const dir=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(dir,'backend/cloudflare-r204-review/d1-queue-migration.sql'),'utf8');
const sql=`
 CREATE TABLE research_jobs(
  id TEXT PRIMARY KEY,question TEXT NOT NULL,state TEXT NOT NULL
  CHECK(state IN('QUEUED','RUNNING','COMPLETE','FAILED')),
  result_json TEXT,error_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
 );
 CREATE TABLE internal_nonces(nonce TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
 CREATE TABLE share_packages(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,facebook_text TEXT NOT NULL,html TEXT NOT NULL,created_at INTEGER NOT NULL);
`;
const hash=(x)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function prepareFixture(){
 const db=new DatabaseSync(':memory:');db.exec(sql);
 const ins=db.prepare('INSERT INTO research_jobs(id,question,state,result_json,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
 for(let i=0;i<16;i++){
  const sources=i<11?[{evidenceId:'SRC_'+i,url:'https://public.example.gov/record-'+i,contentHash:'a'.repeat(64),preservationVerified:true,publicSafe:true}]:[];
  const verified=i<11?[{statement:'Synthetic fixture evidence '+i,evidenceRefs:['SRC_'+i]}]:[];
  const unknowns=i>=11?[{statement:'UNKNOWN',reason:'NO_DIRECT_MATCH'}]:[];
  const result={protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',assignmentId:'FIXTURE_'+i,answer:verified.length?'Synthetic fixture statement '+i:'UNKNOWN',verified,unknowns,sources,providerWrite:false,productionMutation:false,checkpointHash:'synthetic-fixture'};
  ins.run('R203WEB_'+String(i).padStart(32,'0'),'synthetic-only-'+i,'COMPLETE',JSON.stringify(result),null,1700000000000+i,1700000000000+i);
 }
 db.prepare('INSERT INTO internal_nonces VALUES (?,?)').run('synthetic-nonce',1700000000000);
 db.prepare('INSERT INTO share_packages VALUES (?,?,?,?,?)').run('SHARE_SYNTHETIC','R203WEB_'+String(0).padStart(32,'0'),'test-only','<div>fixture</div>',1700000000000);
 return db;
}
test('migration appends four required columns without altering the 16 preexisting COMPLETE rows and security/share tables',()=>{
 const db=prepareFixture();
 const before=db.prepare('SELECT * FROM research_jobs ORDER BY id').all();
 const originalCols=db.prepare('PRAGMA table_info(research_jobs)').all().map(r=>r.name);
 assert.deepEqual(originalCols,['id','question','state','result_json','error_code','created_at','updated_at']);
 const beforeHash=hash(before);
 const nonces=db.prepare('SELECT * FROM internal_nonces').all();
 const shares=db.prepare('SELECT * FROM share_packages').all();
 const countsBefore=db.prepare(`SELECT count(*) total,sum(CASE WHEN json_array_length(json_extract(result_json,'$.verified'))>0 THEN 1 ELSE 0 END) as verified,sum(CASE WHEN json_array_length(json_extract(result_json,'$.sources'))>0 THEN 1 ELSE 0 END) as sourced FROM research_jobs`).get();
 assert.equal(Number(countsBefore.total),16);
 assert.equal(Number(countsBefore.verified),11);
 assert.equal(Number(countsBefore.sourced),11);
 db.exec(migration);
 const after=db.prepare('SELECT id,question,state,result_json,error_code,created_at,updated_at FROM research_jobs ORDER BY id').all();
 assert.equal(hash(after),beforeHash);
 const afterCols=db.prepare('PRAGMA table_info(research_jobs)').all().map(r=>r.name);
 for(const c of ['claim_token','claim_expires_at','claim_count','session_hash'])assert.ok(afterCols.includes(c),c);
 for(const r of db.prepare('SELECT claim_token,claim_expires_at,claim_count,session_hash FROM research_jobs').all()){
  assert.equal(r.claim_token,null);assert.equal(r.claim_expires_at,null);assert.equal(Number(r.claim_count),0);assert.equal(r.session_hash,null);
 }
 assert.deepEqual(db.prepare('SELECT * FROM internal_nonces').all(),nonces);
 assert.deepEqual(db.prepare('SELECT * FROM share_packages').all(),shares);
 db.close();
});
test('migration requires a backup, a single application, and no attempt to mutate the production database',()=>{
 assert.ok(migration.includes('ADD COLUMN claim_token'));
 assert.ok(migration.includes('ADD COLUMN session_hash'));
 assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\b/i.test(migration),false);
 const db=prepareFixture();
 db.exec(migration);
 assert.throws(()=>db.exec(migration),/duplicate column/i);
 assert.equal(db.prepare('SELECT count(*) AS n FROM research_jobs').get().n,16);
 db.close();
});
