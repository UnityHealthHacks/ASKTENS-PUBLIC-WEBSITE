'use strict';
// Synthetic customer auth-boundary tests only. No network or real credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'..','tens-business-work-client.js'),'utf8');
function harness(initialToken='',responses=[]){
 const entries=new Map(initialToken?[['tens_business_session_v1',initialToken]]:[]);
 const storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 let calls=0;
 const nodes={};
 for(const id of ['businessAccountState','businessWorkStatus','workObjective','workFiles','runBusinessWork']){
  nodes[id]={id,textContent:'',value:'',files:[],disabled:false,children:[],listeners:{},style:{},appendChild(c){this.children.push(c)},addEventListener(type,fn){this.listeners[type]=fn},focus(){}};
 }
 const location={hash:'',origin:'https://asktens.com',pathname:'/business.html',search:''};
 const document={getElementById:id=>nodes[id]||null,createElement:tag=>({tag,style:{},textContent:'',href:'',onclick:null})};
 const sandbox={window:{},document,location,history:{replaceState(){}},sessionStorage:storage,
  localStorage:{getItem:()=> 'en'},URLSearchParams,URL,Blob,atob,btoa,
  setTimeout:fn=>{fn();return 1},clearTimeout(){},encodeURIComponent,
  fetch:async(url,opts)=>{calls++;assert.ok(responses.length,'unexpected fetch');const x=responses.shift();return {ok:x.ok,status:x.status,json:async()=>x.body};}
 };
 vm.runInNewContext(code,sandbox);
 return{nodes,entries,location,requests:()=>calls,submit:()=>nodes.runBusinessWork.listeners.click(),sandbox};
}
function fabricatedToken(){return Buffer.from(JSON.stringify({tenantId:'TEST-ORG',planId:'TEST-PLAN'})).toString('base64url')+'.INVALID_SIGNATURE';}
let pass=0;
async function check(name,fn){await fn();console.log('PASS '+name);pass++}
(async()=>{
 await check('no session blocks private jobs and offers quote onboarding',async()=>{
  const h=harness();assert.equal(h.nodes.runBusinessWork.disabled,true);
  assert.match(h.nodes.businessAccountState.textContent,/No usable organization credential/);
  assert.equal(h.nodes.businessAccountState.children[0].href,'pricing.html');
  assert.equal(h.requests(),0);
 });
 await check('fabricated session is never labeled server-authenticated',async()=>{
  const h=harness(fabricatedToken());
  assert.match(h.nodes.businessAccountState.textContent,/server authorization is checked on each request/);
  assert.doesNotMatch(h.nodes.businessAccountState.textContent,/session active/i);
  assert.equal(h.requests(),0);
 });
 await check('invalid token is cleared without any request',async()=>{
  const h=harness('badtoken');assert.equal(h.nodes.runBusinessWork.disabled,true);
  assert.equal(h.entries.has('tens_business_session_v1'),false);assert.equal(h.requests(),0);
 });
 await check('server 401 on job admission clears token and disables run',async()=>{
  const h=harness(fabricatedToken(),[{ok:false,status:401,body:{error:'NOT_AUTHORIZED'}}]);
  h.nodes.workObjective.value='Review authorized invoices';
  await h.submit();
  assert.equal(h.requests(),1);assert.equal(h.entries.has('tens_business_session_v1'),false);
  assert.equal(h.nodes.runBusinessWork.disabled,true);
  assert.match(h.nodes.businessWorkStatus.textContent,/could not admit/);
 });
 await check('server 403 on status revokes credential and stops polling',async()=>{
  const h=harness(fabricatedToken(),[
   {ok:true,status:202,body:{jobId:'TEST-JOB',immediateFeedback:'Pending evidence check'}},
   {ok:false,status:403,body:{error:'SESSION_REVOKED'}}
  ]);
  h.nodes.workObjective.value='Reconcile permitted records';
  await h.submit();assert.equal(h.requests(),2);assert.equal(h.entries.has('tens_business_session_v1'),false);
  assert.equal(h.nodes.runBusinessWork.disabled,true);
  assert.match(h.nodes.businessWorkStatus.textContent,/server rejected this credential/);
 });
 await check('server terminal HOLD stops polling with no completed report',async()=>{
  const h=harness(fabricatedToken(),[
   {ok:true,status:202,body:{jobId:'TEST-JOB',immediateFeedback:'Processing'}},
   {ok:true,status:200,body:{state:'HOLD',result:{summary:{gapCount:1}}}}
  ]);
  h.nodes.workObjective.value='Review records with missing approvals';
  await h.submit();
  assert.equal(h.requests(),2);
  assert.match(h.nodes.businessWorkStatus.textContent,/State: HOLD/);
  assert.equal(h.nodes.businessWorkStatus.children.length,0);
 });
 console.log(pass+'/'+pass+' SYNTHETIC guarded business-session checks PASS — no production, credentials or server tested.');
})().catch(e=>{console.error(e);process.exitCode=1});
