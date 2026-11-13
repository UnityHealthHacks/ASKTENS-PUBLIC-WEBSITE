'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../tools/public-beta-readiness.cjs');
const SITE='https://asktens.com',API='https://api.asktens.com';
function fake({cors=true,topic=true,guard=true}={}){
 const calls=[];
 const fetcher=async(u,opt)=>{
  const url=new URL(u),method=opt.method;
  calls.push({u,method,opt});
  assert.ok([SITE,API].includes(url.origin),'other origins forbidden');
  assert.ok(['GET','OPTIONS'].includes(method),'never write');
  assert.equal(opt.credentials,'omit');
  let body='',status=200,headers={'content-type':'text/plain'};
  if(url.origin===API){
   if(url.pathname==='/health'){body=JSON.stringify({state:'TENS_R204_PUBLIC_BRIDGE_READY'});headers['content-type']='application/json'}
   else if(url.pathname==='/api/prr/capabilities'){body=JSON.stringify({mode:'DRY_RUN',submitEnabled:false});headers['content-type']='application/json'}
   else if(method==='OPTIONS'){
    if(opt.headers.Origin!==SITE)status=403;
    else{status=204;headers={'access-control-allow-origin':SITE,
      'access-control-allow-headers':cors?'Content-Type, X-TENS-Public-Session':'Content-Type'};}
   }
  }else{
   if(url.pathname==='/topic.html')body=topic?'<script src="tens-topic-evidence-boundary.js"></script> SOURCE_BOUNDARY_HOLD':'old topic';
   if(url.pathname==='/tens-topic-evidence-boundary.js'){body='TENS_TOPIC_EVIDENCE_BOUNDARY';if(!guard)status=404}
   if(url.pathname==='/results.html')body='<script src="tens-evidence-guard.js"></script>';
   if(url.pathname==='/tens-evidence-guard.js')body='TENS_EVIDENCE_GUARD';
   if(url.pathname==='/tens-api-config.js')body='X-TENS-Public-Session';
  }
  return new Response(status===204?null:body,{status,headers});
 };
 return {fetcher,calls};
}
test('post-deploy web surface passes in a synthetic environment but never asserts D1/R212',async()=>{
 const f=fake(),r=await audit(f.fetcher);assert.equal(r.webSurfacePassed,true);
 assert.equal(r.liveEndToEndProven,false);assert.equal(r.realD1Accepted,false);
 assert.equal(r.prrMode,'DRY_RUN');assert.ok(f.calls.every(x=>['GET','OPTIONS'].includes(x.method)));
});
test('live API missing public session CORS blocks release',async()=>{
 const r=await audit(fake({cors:false}).fetcher);assert.equal(r.webSurfacePassed,false);assert.equal(r.checks.apiCors,false);
});
test('old topic or missing topic guard blocks release',async()=>{
 for(const cases of [{topic:false},{guard:false}]){
  const r=await audit(fake(cases).fetcher);assert.equal(r.webSurfacePassed,false);
 }
});
test('foreign-origin denial is independently required',async()=>{
 const f=fake(),orig=f.fetcher;
 const r=await audit(async(u,o)=>{
  if(o.method==='OPTIONS'&&o.headers.Origin!==SITE)
   return new Response(null,{status:204,headers:{'access-control-allow-origin':'https://invalid.example'}});
  return orig(u,o);
 });
 assert.equal(r.webSurfacePassed,false);assert.equal(r.checks.foreignOriginDenied,false);
});