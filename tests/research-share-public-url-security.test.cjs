'use strict';
// Isolated synthetic regression only. No Cloudflare, no network, no customer data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {join}=require('node:path'),{pathToFileURL}=require('node:url');
const workerPromise=import(pathToFileURL(join(__dirname,'..','backend','cloudflare-r204-review','worker.mjs')).href);
const owner='12121212121212121212121212121212';
const other='34343434343434343434343434343434';
const digest=crypto.createHash('sha256').update('tens-public-session-v1:'+owner).digest('hex');
const sessionHeaders={'Origin':'https://asktens.com','X-TENS-Public-Session':owner,'Content-Type':'application/json'};
const invalidURLs=[
 'javascript:alert(1)','data:text/html,hello','http://127.0.0.1/a','https://127.0.0.1/a',
 'https://[::1]/','https://user:pass@agency.gov/a','https://agency.local/a',
 'https://agency.gov/?access_token=private','https://agency.gov/?api_key=private',
 'https://agency.gov/?password=private'
];
const validURLs=['https://agency.gov/report.pdf','https://public.example.org/document?year=2026'];
let seq=0;
function setup(urls){
 const id='R203WEB_'+String(++seq).padStart(32,'0');
 const source=urls.map((url,i)=>({evidenceId:'EV'+i,url,publicSafe:true,preservationVerified:true,sourceKind:'PUBLIC_WEB',contentHash:'a'.repeat(64)}));
 const record={id,sessionHash:digest,question:'Synthetic testing only',state:'COMPLETE',createdAt:Date.now(),updatedAt:Date.now(),
  result:{protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,
   assignmentId:'SAFE38',checkpointHash:'test-only',verified:[{statement:'Test',evidenceRefs:['EV'+Math.max(0,urls.indexOf('https://agency.gov/report.pdf'))],evidenceAnswer:'Synthetic'}],unknowns:[],sources:source}};
 const map=new Map([['job:'+id,JSON.stringify(record)]]);
 const env={TENS_PUBLIC_JOBS:{async get(key,type){const x=map.get(key);return x==null?null:type==='json'?JSON.parse(x):x},
  async put(key,value){map.set(key,String(value))}}};
 return {id,map,env};
}
async function share(x,opts={}){
 const worker=(await workerPromise).default;
 const headers={...sessionHeaders};
 if(opts.session===null)delete headers['X-TENS-Public-Session'];
 if(typeof opts.session==='string')headers['X-TENS-Public-Session']=opts.session;
 if(opts.origin)headers.Origin=opts.origin;
 const r=await worker.fetch(new Request('https://api.asktens.com/api/share/create',{method:'POST',headers,
 body:JSON.stringify({approved:opts.approved!==false,searchEventId:x.id,verifiedIds:['V_SAFE38_0'],unknownIds:[]})}),x.env);
 return {status:r.status,body:await r.json()};
}
test('Only public HTTPS DNS-host source URLs enter the explicitly approved share',async()=>{
 const x=setup([...invalidURLs,...validURLs]);
 const r=await share(x);assert.equal(r.status,200);
 assert.equal(r.body.autoPostAuthorized,false);
 assert.deepEqual(r.body.sources.map(s=>s.url),validURLs);
 const pkg=JSON.parse(x.map.get('share:'+r.body.packageId));
 assert(validURLs.every(url=>pkg.html.includes(url)));
 assert(invalidURLs.every(url=>!pkg.html.includes(url)));
});
test('No public-share package is written if every source URL is invalid',async()=>{
 const x=setup(invalidURLs);
 const r=await share(x);
 assert.equal(r.status,422);assert.equal(r.body.error,'SHARE_PUBLIC_SOURCE_REQUIRED');
 assert.equal([...x.map.keys()].filter(k=>k.startsWith('share:')).length,0);
});
test('No public-share package is written if source list is empty',async()=>{
 const x=setup([]);
 const r=await share(x);
 assert.equal(r.status,422);assert.equal(r.body.error,'SHARE_PUBLIC_SOURCE_REQUIRED');
});
test('Reject missing or different session before sharing even with safe URLs',async()=>{
 const x=setup(validURLs);
 assert.equal((await share(x,{session:null})).status,401);
 assert.equal((await share(x,{session:other})).status,404);
 assert.equal([...x.map.keys()].filter(k=>k.startsWith('share:')).length,0);
});
test('Reject absent explicit user approval, even with valid sources',async()=>{
 const x=setup(validURLs);
 assert.equal((await share(x,{approved:false})).status,400);
 assert.equal([...x.map.keys()].filter(k=>k.startsWith('share:')).length,0);
});
test('Reject foreign browser origin',async()=>{
 const x=setup(validURLs);
 assert.equal((await share(x,{origin:'https://attacker.example'})).status,403);
 assert.equal([...x.map.keys()].filter(k=>k.startsWith('share:')).length,0);
});

test('An explicitly non-public source is never shareable despite syntactically valid HTTPS',async()=>{
 const x=setup(['https://agency.gov/report.pdf']);
 const j=JSON.parse(x.map.get('job:'+x.id));j.result.sources[0].publicSafe=false;
 x.map.set('job:'+x.id,JSON.stringify(j));
 const r=await share(x);assert.equal(r.status,422);assert.equal(r.body.error,'SHARE_PUBLIC_SOURCE_REQUIRED');
});
test('An unpreserved source cannot be shared',async()=>{
 const x=setup(['https://agency.gov/report.pdf']);
 const j=JSON.parse(x.map.get('job:'+x.id));j.result.sources[0].preservationVerified=false;
 x.map.set('job:'+x.id,JSON.stringify(j));
 const r=await share(x);assert.equal(r.status,422);assert.equal(r.body.error,'SHARE_PUBLIC_SOURCE_REQUIRED');
});
test('A verified finding must cite a preserved public-safe source',async()=>{
 const x=setup(['https://agency.gov/report.pdf']);
 const j=JSON.parse(x.map.get('job:'+x.id));j.result.verified[0].evidenceRefs=['EV_NOT_IN_RESULT'];
 x.map.set('job:'+x.id,JSON.stringify(j));
 const r=await share(x);assert.equal(r.status,422);assert.equal(r.body.error,'SHARE_VERIFIED_FINDING_UNCITED');
});
test('Reject synthetic credential-like fragments and unknown/encoded query tokens in a public evidence URL',async()=>{
 const cases=[
  'https://agency.gov/report.pdf#access_token=SYNTHETIC',
  'https://agency.gov/report.pdf#session=SYNTHETIC',
  'https://agency.gov/#/download?token=SYNTHETIC',
  'https://agency.gov/report.pdf?authToken=SYNTHETIC',
  'https://agency.gov/report.pdf?key=SYNTHETIC',
  'https://agency.gov/report.pdf?%61uthToken=SYNTHETIC',
  'https://agency.gov/report.pdf?X-Amz-Signature=SYNTHETIC',
  'https://agency.gov/report.pdf?file=https%3A%2F%2Fsomewhere.example',
  'https://agency.gov/report.pdf?id=ABC%0ASECRET',
  'https://agency.gov/report.pdf?redirect=anything'
 ];
 for(const url of cases){
  const x=setup([url]),r=await share(x);
  assert.equal(r.status,422,url);
  assert.equal(r.body.error,'SHARE_PUBLIC_SOURCE_REQUIRED',url);
  assert.equal([...x.map.keys()].filter(k=>k.startsWith('share:')).length,0,url);
 }
});
test('Allow a normal public document URL and bounded year/page navigation but never leak unsafe fragments',async()=>{
 const good=['https://agency.gov/report.pdf','https://agency.gov/report.pdf?year=2026','https://agency.gov/report.pdf?page=3'];
 for(const url of good){
  const x=setup([url]),r=await share(x);
  assert.equal(r.status,200,url);
  assert.equal(r.body.sources[0].url,url);
 }
});