'use strict';
// Post-release smoke check. Intentionally GET/OPTIONS only; never submits a research job,
// follows a private release link, uses credentials, touches R212, or attests real D1.
const SITE='https://asktens.com',API='https://api.asktens.com';
const allowed=[
 [SITE,'/'],[SITE,'/topic.html?id=midnight-pass'],[SITE,'/results.html'],
 [SITE,'/tens-topic-evidence-boundary.js'],[SITE,'/tens-evidence-guard.js'],
 [SITE,'/tens-api-config.js'],[API,'/health'],[API,'/api/prr/capabilities'],
 [API,'/api/research']
];
async function audit(fetcher=globalThis.fetch){
 if(typeof fetcher!=='function')throw Error('FETCH_REQUIRED');
 const results={}, checks={};
 async function ask(name,origin,path,method='GET',headers={}){
  if(!allowed.some(([a,b])=>a===origin&&b===path)||!['GET','OPTIONS'].includes(method))throw Error('UNAUTHORIZED_PROBE');
  try{
   const response=await fetcher(origin+path,{method,headers,credentials:'omit',redirect:'error',
     cache:'no-store',signal:AbortSignal.timeout(12000)});
   const value={status:response.status,headers:response.headers,text:''};
   if(method==='GET'){
    const type=response.headers.get('content-type')||'';
    if(type.includes('application/json')){value.text=await response.text();}
    else value.text=await response.text();
    if(value.text.length>1000000)throw Error('OVERSIZED_PUBLIC_RESPONSE');
   }
   results[name]=value;return value;
  }catch(e){results[name]={status:0,error:String(e.message||e),headers:new Headers(),text:''};return results[name]}
 }
 const home=await ask('home',SITE,'/');
 const topic=await ask('topic',SITE,'/topic.html?id=midnight-pass');
 const resultPage=await ask('results',SITE,'/results.html');
 const boundary=await ask('topicGuard',SITE,'/tens-topic-evidence-boundary.js');
 const resultGuard=await ask('resultGuard',SITE,'/tens-evidence-guard.js');
 const apiConfig=await ask('apiConfig',SITE,'/tens-api-config.js');
 const health=await ask('health',API,'/health');
 const capabilities=await ask('capabilities',API,'/api/prr/capabilities');
 const preflightHeaders={'Origin':SITE,'Access-Control-Request-Method':'POST',
   'Access-Control-Request-Headers':'content-type,x-tens-public-session'};
 const cors=await ask('cors',API,'/api/research','OPTIONS',preflightHeaders);
 const foreign=await ask('foreignOrigin',API,'/api/research','OPTIONS',
   {...preflightHeaders,'Origin':'https://invalid.example'});
 function json(x){try{return JSON.parse(x.text)}catch{return {}}}
 const allow=(cors.headers.get('access-control-allow-headers')||'').toLowerCase().split(',').map(x=>x.trim());
 checks.home=home.status===200;
 checks.topic=topic.status===200&&topic.text.includes('tens-topic-evidence-boundary.js')&&topic.text.includes('SOURCE_BOUNDARY_HOLD');
 checks.topicGuard=boundary.status===200&&boundary.text.includes('TENS_TOPIC_EVIDENCE_BOUNDARY');
 checks.results=resultPage.status===200&&resultPage.text.includes('tens-evidence-guard.js');
 checks.resultGuard=resultGuard.status===200&&resultGuard.text.includes('TENS_EVIDENCE_GUARD');
 checks.browserSession=apiConfig.status===200&&apiConfig.text.includes('X-TENS-Public-Session');
 checks.apiHealth=health.status===200&&json(health).state==='TENS_R204_PUBLIC_BRIDGE_READY';
 checks.apiCors=cors.status===204&&cors.headers.get('access-control-allow-origin')===SITE&&allow.includes('content-type')&&allow.includes('x-tens-public-session');
 checks.foreignOriginDenied=foreign.status===403;
 const caps=json(capabilities);
 const status={checks,webSurfacePassed:Object.values(checks).every(Boolean),
   researchWorkerAccepted:false,realD1Accepted:false,sourceCitationAccessible:false,
   nativeR212Accepted:false,liveEndToEndProven:false,
   prrMode:caps.mode||'UNKNOWN',prrSubmissionEnabled:caps.submitEnabled===true,
   disclaimer:'Web-surface PASS is not a successful live source-backed question or permission to deploy.'};
 return status;
}
module.exports={audit};
if(require.main===module) audit().then(x=>{console.log(JSON.stringify(x,null,2));if(!x.webSurfacePassed)process.exitCode=2;}).catch(e=>{console.error(e.message);process.exitCode=2});