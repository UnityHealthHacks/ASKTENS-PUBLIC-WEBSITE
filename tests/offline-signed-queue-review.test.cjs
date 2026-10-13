'use strict';
const assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {createOfflineSignedQueueClient,REVIEW_ONLY_BASE}=require('../backend/adapter-contract/offline-signed-queue-review.cjs');
const {processOne}=require('../backend/adapter-contract/claim-adapter.js');
const enc=new TextEncoder();
const signed=[];
const JID='R203WEB_'+'a'.repeat(32);
const proof={state:'R212_PUBLIC_RESEARCH_ACTIVATION_PROOF_READY'};
const sourceResult={protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,
 assignmentId:'AG160_SYNTH',checkpointHash:'sha',
 verified:[],unknowns:[{statement:'No independently verified answer in offline fixture',reason:'NO_INDEX_MATCH'}],sources:[]};
let serial=0;
const nonce=()=>('AG160_nonce_'+String(++serial).padStart(24,'0'));
let count=0;
function response(status,payload){return {status,async json(){return payload}}}
const now=()=>Date.now();
(async()=>{
 const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const signer=async msg=>new Uint8Array(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,msg));
 function server(opts={}){
  const seen=new Set(),log=[];let job='QUEUED';
  const transport={offlineReview:true,async send(req){
   log.push(req);
   if(req.url.startsWith('https://api.asktens.com'))throw Error('PRODUCTION URL');
   const u=new URL(req.url);if(u.origin!==REVIEW_ONLY_BASE||req.method!=='POST')return response(400,{error:'BAD_TARGET'});
   const t=Number(req.headers['x-tens-timestamp']),n=req.headers['x-tens-nonce'];
   if(!Number.isSafeInteger(t)||Math.abs(Date.now()-t)>120000||!n||seen.has(n))return response(401,{error:'INVALID_TIMESTAMP_OR_REPLAY'});
   const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',enc.encode(req.body))).toString('hex');
   const canonical=t+'\n'+n+'\n'+req.method+'\n'+u.pathname+'\n'+digest;
   const sig=Buffer.from(req.headers['x-tens-signature'],'base64url');
   const verified=await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},keys.publicKey,sig,enc.encode(canonical));
   if(!verified)return response(401,{error:'INVALID_SIGNATURE'});
   seen.add(n);
   if(opts.reply!==undefined)return typeof opts.reply==='function'?opts.reply(req):opts.reply;
   const body=JSON.parse(req.body);
   if(u.pathname==='/internal/claim'){
    if(job==='QUEUED'){job='RUNNING';return response(200,{state:'CLAIMED',jobId:JID,claimToken:'REVIEW_ONLY_CLAIM_TOKEN',question:'Midnight Pass public records?'})}
    return response(200,{state:'EMPTY'});
   }
   if(u.pathname==='/internal/complete'){
    if(job!=='RUNNING'||body.jobId!==JID||body.claimToken!=='REVIEW_ONLY_CLAIM_TOKEN')return response(409,{error:'JOB_STATE_CONFLICT'});
    job='COMPLETE';return response(200,{state:'COMPLETE_ACCEPTED'});
   }
   if(u.pathname==='/internal/fail'){
    if(job!=='RUNNING'||body.jobId!==JID)return response(409,{error:'JOB_STATE_CONFLICT'});
    job='FAILED';return response(200,{state:'FAILURE_ACCEPTED'});
   }
   return response(404,{error:'NOT_FOUND'});
  }};
  return {transport,log,state:()=>job};
 }
 function client(s,over={}){return createOfflineSignedQueueClient({transport:s.transport,signer,clock:now,nonceFactory:nonce,webcrypto,...over})}
 const cases=[];const test=(name,fn)=>cases.push([name,fn]);
 test('reject real production endpoint',async()=>{assert.throws(()=>createOfflineSignedQueueClient({base:'https://api.asktens.com',transport:server().transport,signer,clock:now,nonceFactory:nonce,webcrypto}),/INVALID_BASE/)});
 test('reject missing offline transport marker',async()=>{assert.throws(()=>createOfflineSignedQueueClient({transport:{send:async()=>{}},signer,clock:now,nonceFactory:nonce,webcrypto}),/OFFLINE_REVIEW_TRANSPORT_REQUIRED/)});
 test('server verifies actual ephemeral P256 signature and canonical SHA256',async()=>{const s=server(),c=client(s),r=await c.claim();assert.equal(r.state,'CLAIMED');assert.equal(r.status,200);assert.equal(s.log.length,1);assert.equal(s.state(),'RUNNING')});
 test('signed exact completion updates mock queue after acknowledged result',async()=>{const s=server(),c=client(s),claim=await c.claim();const r=await c.complete({jobId:claim.jobId,claimToken:claim.claimToken,result:sourceResult});assert.deepEqual(r,{status:200,state:'COMPLETE_ACCEPTED'});assert.equal(s.state(),'COMPLETE');assert.equal(s.log.length,2)});
 test('signed exact failure updates mock queue after acceptance',async()=>{const s=server(),c=client(s),claim=await c.claim();const r=await c.fail({jobId:claim.jobId,claimToken:claim.claimToken,errorCode:'NOT_VERIFIED'});assert.deepEqual(r,{status:200,state:'FAILURE_ACCEPTED'});assert.equal(s.state(),'FAILED')});
 test('genuinely empty mock signed queue returns EMPTY',async()=>{const s=server(),c=client(s);await c.claim();const r=await c.claim();assert.equal(r.state,'EMPTY');assert.equal(r.status,200)});
 test('signed transport sees HTTP409 and returns UNCONFIRMED',async()=>{const s=server({reply:response(409,{error:'JOB_STATE_CONFLICT'})}),c=client(s);const r=await c.complete({jobId:JID,claimToken:'BAD',result:sourceResult});assert.equal(r.state,'UNCONFIRMED');assert.equal(r.status,409)});
 test('signed HTTP503 claim never reports EMPTY',async()=>{const s=server({reply:response(503,{error:'QUEUE_STORE_NOT_READY'})}),r=await client(s).claim();assert.equal(r.state,'CLAIM_UNCONFIRMED');assert.equal(r.status,503)});
 test('signed HTTP200 malformed claim fails closed',async()=>{const s=server({reply:response(200,{state:'CLAIMED',jobId:'bad',claimToken:'bad'})}),r=await client(s).claim();assert.equal(r.state,'CLAIM_UNCONFIRMED')});
 test('signed HTTP200 wrong accepted state cannot cause COMPLETE',async()=>{const s=server({reply:response(200,{state:'UNKNOWN'})}),r=await client(s).complete({jobId:JID,claimToken:'T',result:sourceResult});assert.equal(r.state,'UNCONFIRMED')});
 test('tampered signature is unauthorized not CLAiMED',async()=>{
  const s=server(),r=await client(s,{signer:async()=>new Uint8Array(64)}).claim();assert.equal(r.status,401);assert.equal(r.state,'CLAIM_UNCONFIRMED');assert.equal(s.state(),'QUEUED');
 });
 test('timestamp too old refused by mock verifier',async()=>{const s=server(),r=await client(s,{clock:()=>Date.now()-400000}).claim();assert.equal(r.status,401);assert.equal(r.state,'CLAIM_UNCONFIRMED')});
 test('reused nonce fails before second HTTP request',async()=>{
  const s=server(),n='REPLAY_NONCE_1234567890123456',c=client(s,{nonceFactory:()=>n});await c.claim();await assert.rejects(()=>c.claim(),/NONCE_INVALID_OR_REUSED/);assert.equal(s.log.length,1);
 });
 test('bad timestamp is refused before signing',async()=>{const s=server(),c=client(s,{clock:()=>NaN});await assert.rejects(()=>c.claim(),/INVALID_TIMESTAMP/);assert.equal(s.log.length,0)});
 test('transport throws => normalized unknown not success',async()=>{const s=server();s.transport.send=async()=>{throw Error('socket offline')};const r=await client(s).claim();assert.equal(r.state,'CLAIM_UNCONFIRMED');assert.equal(r.status,0)});
 test('signed mock client integrates unchanged claim-adapter, reports COMPLETED only on 200',async()=>{
  const s=server(),q=client(s);
  const r=await processOne({queue:q,runner:{runJob:async()=>({state:'PUBLIC_RESEARCH_PASS',completionClaimAllowed:true})},
   buildResult:()=>sourceResult,activationProof:proof,namespace:{}});
  assert.equal(r.state,'COMPLETED');assert.equal(s.state(),'COMPLETE');assert.equal(s.log.length,2);
 });
 test('signed mock client refuses false completion in claim adapter',async()=>{
  let calls=0;const s=server({reply:req=>{
   if(new URL(req.url).pathname==='/internal/claim')return response(200,{state:'CLAIMED',jobId:JID,claimToken:'T',question:'q'});
   calls++;return response(409,{error:'JOB_STATE_CONFLICT'});
  }}),q=client(s);
  const r=await processOne({queue:q,runner:{runJob:async()=>({state:'PUBLIC_RESEARCH_PASS',completionClaimAllowed:true})},
   buildResult:()=>sourceResult,activationProof:proof,namespace:{}});
  assert.equal(r.state,'COMPLETION_UNCONFIRMED');assert.equal(calls,1);
 });
 test('body tampering after signing invalidates signature',async()=>{
  const s=server(),originalSend=s.transport.send.bind(s.transport);
  s.transport.send=async request=>originalSend({...request,body:JSON.stringify({forged:true})});
  const r=await client(s).claim();assert.equal(r.status,401);assert.equal(r.state,'CLAIM_UNCONFIRMED');
 });
 test('pathname tampering after signing invalidates signature',async()=>{
  const s=server(),originalSend=s.transport.send.bind(s.transport);
  s.transport.send=async request=>originalSend({...request,url:REVIEW_ONLY_BASE+'/internal/fail'});
  const r=await client(s).claim();assert.equal(r.status,401);assert.equal(r.state,'CLAIM_UNCONFIRMED');
 });
 let ok=0,errors=[];
 for(const [name,fn] of cases){try{await fn();ok++;console.log('PASS '+name)}catch(e){errors.push({name,error:String(e.stack||e).slice(0,260)});console.log('FAIL '+name+' '+String(e).slice(0,130))}}
 console.log('AG160_SUMMARY '+JSON.stringify({protocol:'R212_AG160_OFFLINE_SIGNED_QUEUE_CONTRACT_1',passed:ok,total:cases.length,errors,
  signatureAlgorithm:'ephemeral P256 ECDSA WebCrypto',realEndpointsCalled:false,realSignerUsed:false,
  mockVerification:true,completeAcceptedOnlyWithSignedMock200:true,sourceClaimsAccepted:false,liveR212:false}));
 if(errors.length)process.exitCode=2;
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1});
