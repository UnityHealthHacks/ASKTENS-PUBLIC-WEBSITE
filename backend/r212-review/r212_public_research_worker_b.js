'use strict';

const crypto=require('crypto');
const net=require('net');

const PROTOCOL='R212_PUBLIC_RESEARCH_WORKER_2';
const ACTION_ID='R212_PUBLIC_RESEARCH_WORKER';
const CAPABILITY_ID='PUBLIC_RESEARCH_WORKER';
const MAX_QUERIES=16;
const MAX_FOLLOWUPS=4;
const MAX_RESULTS_PER_QUERY=25;
const MAX_FETCHES=80;
const MAX_TEXT_CHARS=500000;
const MAX_BYTES_PER_FETCH=5*1024*1024;
const MAX_PROVIDERS=4;
const FORBIDDEN_ADAPTER_METHODS=[
  'post','put','patch','delete','submit','login','authenticateWrite','upload','send','publish',
  'create','update','remove','archive','modify'
];
const PRIVATE_PATTERNS=[
  /^10\./,/^127\./,/^169\.254\./,/^192\.168\./,/^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,/^::1$/i,/^fc/i,/^fd/i,/^fe80:/i
];

function stripAddressBrackets(v){
  const a=text(v).toLowerCase();
  return a.startsWith('[')&&a.endsWith(']')?a.slice(1,-1):a;
}
function parseIpv4(v){
  const a=stripAddressBrackets(v);
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(a))return null;
  const o=a.split('.').map(Number);
  if(o.some(x=>!Number.isInteger(x)||x<0||x>255))return null;
  return o;
}
function isNonPublicIpv4(v){
  const o=parseIpv4(v);if(!o)return true;
  if(o[0]===0||o[0]===10||o[0]===127)return true;
  if(o[0]===100&&o[1]>=64&&o[1]<=127)return true;
  if(o[0]===169&&o[1]===254)return true;
  if(o[0]===172&&o[1]>=16&&o[1]<=31)return true;
  if(o[0]===192&&o[1]===0&&o[2]===0)return true;
  if(o[0]===192&&o[1]===0&&o[2]===2)return true;
  if(o[0]===192&&o[1]===88&&o[2]===99)return true;
  if(o[0]===192&&o[1]===168)return true;
  if(o[0]===198&&(o[1]===18||o[1]===19))return true;
  if(o[0]===198&&o[1]===51&&o[2]===100)return true;
  if(o[0]===203&&o[1]===0&&o[2]===113)return true;
  if(o[0]>=224)return true;
  return false;
}
function isNonPublicIpv6(v){
  const a=stripAddressBrackets(v);
  if(!a||a.includes('%'))return true;
  if(a.startsWith('::ffff:'))return true;
  const firstText=a.split(':')[0]||'0';
  const first=parseInt(firstText,16);
  if(!Number.isInteger(first)||first<0x2000||first>0x3fff)return true;
  if(/^2001:0?db8:/i.test(a))return true;
  if(/^2001:0?002:/i.test(a)||/^2001:2:/i.test(a))return true;
  if(/^2001:0?010:/i.test(a)||/^2001:10:/i.test(a))return true;
  if(/^2001:0?020:/i.test(a)||/^2001:20:/i.test(a))return true;
  if(/^3fff:/i.test(a))return true;
  return false;
}

function stable(v){
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function sha(v){return crypto.createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');}
function text(v){return String(v==null?'':v).trim();}
function uniq(a){return [...new Set((a||[]).map(text).filter(Boolean))].sort();}
function flags(){
  return {
    authorityEffect:false,providerWrite:false,networkWrite:false,loginAuthorized:false,
    formSubmitAuthorized:false,providerSend:false,runtimeAdmissionAuthorized:false,
    liveRebindAuthorized:false,taskRetargetAuthorized:false,taskEnableAuthorized:false,
    credentialScopeExpansionAuthorized:false,deploymentAuthorized:false,mergeAuthorized:false,
    automaticRetirementAuthorized:false,cutoverAuthorized:false
  };
}
function hold(reason,extra={}){
  const out={protocolVersion:PROTOCOL,state:'PUBLIC_RESEARCH_HOLD',reason,actionId:ACTION_ID,capabilityId:CAPABILITY_ID,...flags(),...extra};
  out.proofContentSha256=sha(out);return out;
}
function activationReady(p={}){
  return p.state==='R212_PUBLIC_RESEARCH_ACTIVATION_PROOF_READY'&&
    p.actionId===ACTION_ID&&p.consumerId===ACTION_ID&&
    p.rule012Ready===true&&p.singleUseDecisionConsumed===true&&
    p.ownerAuthorityGateApproved===true&&p.activationContextVerified===true&&
    p.publicWebReadAllowed===true&&p.localMaterializationAllowed===true&&
    p.networkWrite===false&&p.providerWrite===false&&p.loginAuthorized===false&&
    p.formSubmitAuthorized===false&&p.credentialScopeExpansion===false;
}
function namespace(ns={}){
  const customerId=text(ns.customerId),tenantId=text(ns.tenantId),caseId=text(ns.caseId);
  if(!customerId||!tenantId||!caseId)throw new Error('CUSTOMER_TENANT_CASE_REQUIRED');
  return {customerId,tenantId,caseId,projectIds:uniq(ns.projectIds)};
}
function namespaceHash(ns){return sha(namespace(ns));}
function adapterSurface(adapter){
  const found=FORBIDDEN_ADAPTER_METHODS.filter(k=>typeof adapter?.[k]==='function');
  return {pass:found.length===0,forbiddenMethods:found};
}
function isPrivateAddress(addr){
  const a=stripAddressBrackets(addr);
  const family=net.isIP(a);
  if(family===4)return isNonPublicIpv4(a);
  if(family===6)return isNonPublicIpv6(a);
  return true;
}
function preflightStaticUrl(v){
  const s=text(v);if(!s)throw new Error('URL_REQUIRED');
  let u;try{u=new URL(s);}catch{throw new Error('URL_INVALID');}
  if(u.protocol!=='https:')throw new Error('HTTPS_REQUIRED');
  if(u.username||u.password)throw new Error('CREDENTIAL_URL_BLOCKED');
  const host=stripAddressBrackets(u.hostname.toLowerCase());
  if(host==='localhost'||host.endsWith('.local'))throw new Error('PRIVATE_HOST_BLOCKED');
  if(net.isIP(host)&&isPrivateAddress(host))throw new Error('PRIVATE_NETWORK_BLOCKED');
  u.hash='';
  return u.toString();
}
async function verifyPublicUrl(url,urlPolicy){
  const canonical=preflightStaticUrl(url);
  let proof;
  try{proof=await urlPolicy.verifyPublic({url:canonical,readOnly:true});}
  catch(e){throw new Error('PUBLIC_URL_VERIFY_EXCEPTION:'+text(e&&e.message||e));}
  if(!proof||proof.state!=='PUBLIC_URL_VERIFIED'||proof.providerWrite===true||proof.networkWrite===true||
     proof.privateNetwork===true||proof.redirectAuthorization===true)throw new Error('PUBLIC_URL_VERIFY_FAILED');
  const addresses=Array.isArray(proof.addresses)?proof.addresses.map(text).filter(Boolean):[];
  if(!addresses.length)throw new Error('DNS_EMPTY');
  if(addresses.some(isPrivateAddress))throw new Error('PRIVATE_NETWORK_BLOCKED');
  const verified=preflightStaticUrl(proof.url||canonical);
  if(verified!==canonical)throw new Error('PUBLIC_URL_VERIFY_CANONICAL_MISMATCH');
  return {url:canonical,addresses:uniq(addresses),proofSha256:sha(proof)};
}
function informationGainQueries(input={}){
  const out=[],question=text(input.question);
  for(const u of Array.isArray(input.unknowns)?input.unknowns:[]){
    for(const n of Array.isArray(u?.reasoningKernelShadow?.informationNeeds)?u.reasoningKernelShadow.informationNeeds:[]){
      const type=text(n?.type),candidate=Array.isArray(n?.candidate)?n.candidate.join(' '):text(n?.candidate),
        candidates=Array.isArray(n?.candidates)?n.candidates.join(' '):text(n?.candidates);
      if(type==='NEED_INDEPENDENT_CORROBORATION')out.push((question+' '+candidate).trim());
      else if(type==='DISCRIMINATE_HYPOTHESES')out.push((question+' '+candidates).trim());
      else if(type==='DISCRIMINATE_CONFLICT')out.push((question+' primary contemporaneous source exact value date').trim());
      else if(type==='MISSING_TYPED_FACT')out.push((question+' official history exact relation').trim());
    }
  }
  return uniq(out).slice(0,MAX_FOLLOWUPS);
}
function normalizePlan(plan={},input={}){
  const base=(Array.isArray(plan.queries)?plan.queries:[]).map((x,i)=>({
    query:text(typeof x==='string'?x:x?.query),
    engine:text(typeof x==='string'?'':x?.engine).toUpperCase()||'DEFAULT',
    ordinal:i,reason:'PLANNER'
  })).filter(x=>x.query);
  if(base.length>MAX_QUERIES)throw new Error('QUERY_COUNT_OVER_BOUND');
  const follow=informationGainQueries(input);
  const seen=new Set(base.map(x=>x.engine+'|'+x.query));
  for(const q of follow){
    const key='DEFAULT|'+q;
    if(!seen.has(key)&&base.length<MAX_QUERIES){seen.add(key);base.push({query:q,engine:'DEFAULT',ordinal:base.length,reason:'INFORMATION_GAIN'});}
  }
  const directUrls=uniq(plan.directUrls);
  if(directUrls.length>MAX_FETCHES)throw new Error('DIRECT_URL_COUNT_OVER_BOUND');
  return {queries:base,directUrls,informationGainQueryCount:follow.length};
}
function validateCursor(cursor,nsHash){
  if(cursor==null)return {sequence:0,completedQueryKeys:[],fetchedUrlHashes:[],namespaceHash:nsHash};
  if(typeof cursor!=='object'||text(cursor.namespaceHash)!==nsHash)throw new Error('CURSOR_NAMESPACE_MISMATCH');
  const sequence=Number(cursor.sequence);
  if(!Number.isSafeInteger(sequence)||sequence<0)throw new Error('CURSOR_SEQUENCE_INVALID');
  return {sequence,namespaceHash:nsHash,completedQueryKeys:uniq(cursor.completedQueryKeys),fetchedUrlHashes:uniq(cursor.fetchedUrlHashes)};
}
function resultIdentity(provider,query,url){return sha(text(provider).toUpperCase()+'|'+text(query)+'|'+preflightStaticUrl(url));}
function normalizeSearchResult(raw,provider,query,index,url){
  return {
    resultId:'SR_'+resultIdentity(provider,query,url).slice(0,32),
    engine:text(provider).toUpperCase()||'DEFAULT',query:text(query),rank:Number(raw?.rank||index+1),
    url,title:text(raw?.title),snippet:text(raw?.snippet).slice(0,8192),
    sourceAuthority:text(raw?.sourceAuthority)||'UNCLASSIFIED_PUBLIC_WEB',
    providerWrite:false,verified:false,admitted:false
  };
}
function searchProviders(searchAdapter){
  if(Array.isArray(searchAdapter?.providers)&&searchAdapter.providers.length){
    if(searchAdapter.providers.length>MAX_PROVIDERS)throw new Error('SEARCH_PROVIDER_COUNT_OVER_BOUND');
    return searchAdapter.providers;
  }
  return [searchAdapter];
}
async function discover(plan,deps){
  const providers=searchProviders(deps.search),results=[],attempts=[];
  for(const q of plan.queries){
    let anyResponsive=false;
    for(const p of providers.slice(0,MAX_PROVIDERS)){
      const surface=adapterSurface(p);
      const name=text(p?.name)||'UNNAMED_PROVIDER';
      if(!surface.pass){attempts.push({query:q.query,provider:name,state:'BLOCKED_FORBIDDEN_SURFACE',forbiddenMethods:surface.forbiddenMethods});continue;}
      if(typeof p?.search!=='function'){attempts.push({query:q.query,provider:name,state:'MISSING_SEARCH'});continue;}
      let res;
      try{res=await p.search({requestedEngine:q.engine,query:q.query,limit:MAX_RESULTS_PER_QUERY,readOnly:true});}
      catch(e){attempts.push({query:q.query,provider:name,state:'FAILED',reason:text(e&&e.message||e)});continue;}
      if(!res||res.providerWrite===true||res.networkWrite===true||res.loginUsed===true){
        attempts.push({query:q.query,provider:name,state:'BLOCKED_NOT_READONLY'});continue;
      }
      anyResponsive=true;
      const rr=Array.isArray(res.results)?res.results:[];
      if(rr.length>MAX_RESULTS_PER_QUERY)throw new Error('SEARCH_RESULT_COUNT_OVER_BOUND');
      attempts.push({query:q.query,provider:name,state:rr.length?'USED':'EMPTY',resultCount:rr.length});
      for(let i=0;i<rr.length;i++){
        let verified;
        try{verified=await verifyPublicUrl(rr[i]?.url,deps.urlPolicy);}
        catch(e){attempts.push({query:q.query,provider:name,state:'CANDIDATE_BLOCKED',reason:text(e&&e.message||e)});continue;}
        results.push(normalizeSearchResult(rr[i],name,q.query,i,verified.url));
        if(results.length>=MAX_FETCHES)break;
      }
      if(results.length>=MAX_FETCHES)break;
    }
    if(!anyResponsive&&!providers.length)attempts.push({query:q.query,provider:'NONE',state:'FAILED'});
    if(results.length>=MAX_FETCHES)break;
  }
  const responsive=attempts.some(x=>['USED','EMPTY'].includes(x.state));
  const failures=attempts.filter(x=>['FAILED','MISSING_SEARCH','BLOCKED_NOT_READONLY','BLOCKED_FORBIDDEN_SURFACE'].includes(x.state));
  if(plan.queries.length&&results.length===0&&!responsive&&failures.length)throw Object.assign(new Error('DISCOVERY_EXHAUSTED'),{attempts});
  return {results,attempts};
}
function evidenceEnvelope(ns,job,searchMeta,doc,extracted={}){
  const url=preflightStaticUrl(doc.finalUrl||doc.url||searchMeta.url);
  const body=text(doc.text).slice(0,MAX_TEXT_CHARS);
  const rawHash=text(doc.rawContentSha256).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(rawHash))throw new Error('RAW_CONTENT_SHA256_REQUIRED');
  const byteLength=Number(doc.byteLength);
  if(!Number.isSafeInteger(byteLength)||byteLength<0||byteLength>MAX_BYTES_PER_FETCH)throw new Error('BODY_TOO_LARGE_OR_LENGTH_INVALID');
  if(doc.preservationVerified!==true)throw new Error('PRESERVATION_NOT_VERIFIED');
  const sourceType=text(extracted.sourceType)||(
    /pdf/i.test(text(doc.contentType))?'PDF':
    /procurement/i.test(url)?'PROCUREMENT_RECORD':
    /meeting|granicus/i.test(url)?'MEETING_RECORD':'WEB_PAGE'
  );
  const queryLineage=uniq([searchMeta.query,...(extracted.queryLineage||[])]);
  const familyRefs=uniq(extracted.familyRefs);
  const projectIds=uniq([...(ns.projectIds||[]),...(extracted.projectIds||[])]);
  const independenceGroup=text(extracted.independenceGroup)||new URL(url).hostname.toLowerCase();
  const passages=(Array.isArray(extracted.passages)?extracted.passages:[]).map((p,i)=>({
    passageId:text(p?.passageId)||('P'+String(i+1).padStart(3,'0')),
    text:text(p?.text).slice(0,20000),locator:text(p?.locator),
    contentSha256:sha(text(p?.text)),independenceGroup:text(p?.independenceGroup)||independenceGroup
  })).filter(p=>p.text);
  return {
    evidenceId:'EV_WEB_'+sha(ns.tenantId+'|'+ns.caseId+'|'+url+'|'+rawHash).slice(0,32),
    customerId:ns.customerId,tenantId:ns.tenantId,caseId:ns.caseId,projectIds,
    sourceType,sourceRef:'web:'+url,sourceAuthority:text(extracted.sourceAuthority)||searchMeta.sourceAuthority,
    provider:text(searchMeta.engine)||'DIRECT',retrievedAt:text(doc.retrievedAt),contentSha256:rawHash,
    queryLineage,familyRefs,threadOrDocumentGroupId:text(extracted.documentGroupId)||url,
    titleOrSubject:text(doc.title)||searchMeta.title,sourceLocator:{url,searchResultId:searchMeta.resultId||null},
    provenance:{
      acquisitionMethod:'PUBLIC_WEB_READONLY_EXACT_PRESERVATION',researchJobId:job.jobId,
      query:searchMeta.query||null,engine:searchMeta.engine||null,rank:searchMeta.rank||null,
      httpStatus:Number(doc.status||0),contentType:text(doc.contentType),publicAccess:true,
      publicUrlVerified:true,redirectChainVerified:true,preservationVerified:true,
      byteLength,rawContentSha256:rawHash,independenceGroup,parentOccurrenceId:null
    },
    preservationState:'EXACT_BYTES_PRESERVED_AND_MATERIALIZED',assumptionFree:true,
    publicState:text(extracted.publicState)||'INTERNAL_ONLY',verified:false,admitted:false,
    passages,document:{textSha256:sha(text(doc.text)),textCharCount:body.length,textTruncated:text(doc.text).length>MAX_TEXT_CHARS}
  };
}
function validateEvidence(rows,ns){
  const seenBySource=new Map(),seenByContent=new Map(),out=[];
  for(const row of rows||[]){
    if(row.customerId!==ns.customerId||row.tenantId!==ns.tenantId||row.caseId!==ns.caseId)throw new Error('EVIDENCE_NAMESPACE_MISMATCH');
    if(!row.sourceRef||!row.contentSha256)throw new Error('EVIDENCE_IDENTITY_INCOMPLETE');
    const prior=seenBySource.get(row.sourceRef);
    if(prior&&prior.contentSha256!==row.contentSha256)throw new Error('CONFLICTING_SOURCE_CONTENT:'+row.sourceRef);
    if(prior)continue;
    seenBySource.set(row.sourceRef,row);
    const ck=row.contentSha256+'|'+row.sourceType;
    if(seenByContent.has(ck))continue;
    seenByContent.set(ck,row);out.push(row);
  }
  return out.sort((a,b)=>a.sourceRef.localeCompare(b.sourceRef));
}
function nextCursor(current,plan,docs,nsHash){
  return {
    protocolVersion:'R212_PUBLIC_RESEARCH_CURSOR_2',namespaceHash:nsHash,sequence:current.sequence+1,
    completedQueryKeys:uniq([...current.completedQueryKeys,...plan.queries.map(q=>sha(q.engine+'|'+q.query))]),
    fetchedUrlHashes:uniq([...current.fetchedUrlHashes,...docs.map(d=>sha(preflightStaticUrl(d.finalUrl||d.url)))])
  };
}
async function runJob(input={},deps={}){
  for(const k of ['planner','search','urlPolicy','fetcher','extractor','store'])if(!deps[k]||typeof deps[k]!=='object')return hold('ADAPTER_REQUIRED',{adapter:k});
  for(const [name,adapter] of Object.entries(deps)){
    if(name==='search'&&Array.isArray(adapter.providers))continue;
    const s=adapterSurface(adapter);if(!s.pass)return hold('FORBIDDEN_ADAPTER_METHOD_EXPOSED',{adapter:name,forbiddenMethods:s.forbiddenMethods});
  }
  if(!activationReady(input.activationProof||{}))return hold('ACTIVATION_PROOF_REQUIRED');
  let ns;try{ns=namespace(input.namespace||{});}catch(e){return hold(String(e.message||e));}
  const nsHash=namespaceHash(ns);
  const job={jobId:text(input.jobId),question:text(input.question)};
  if(!job.jobId||!job.question)return hold('JOB_ID_AND_QUESTION_REQUIRED');
  let cursor;try{cursor=validateCursor(input.cursor,nsHash);}catch(e){return hold(String(e.message||e));}

  let before;try{before=await deps.store.inspect({namespace:ns,jobId:job.jobId});}
  catch(e){return hold('STORE_PRECHECK_EXCEPTION',{error:text(e&&e.message||e)});}
  if(!before||before.state==='HOLD'||before.providerWrite===true)return hold('STORE_PRECHECK_HOLD',{storeState:before});

  let planned;try{planned=await deps.planner.plan({job,namespace:ns,cursor,unknowns:input.unknowns||[]});}
  catch(e){return hold('PLANNER_EXCEPTION',{error:text(e&&e.message||e)});}
  if(planned?.authorityEffect===true||planned?.providerWrite===true||planned?.networkWrite===true)return hold('PLANNER_AUTHORITY_EFFECT');
  let plan;try{plan=normalizePlan(planned||{},input);}catch(e){return hold(String(e.message||e));}

  let discovered;
  try{discovered=await discover(plan,deps);}
  catch(e){return hold(text(e.message||e),{searchAttempts:e.attempts||[]});}
  const searchResults=[...discovered.results];
  for(const direct of plan.directUrls){
    let verified;try{verified=await verifyPublicUrl(direct,deps.urlPolicy);}catch(e){return hold(text(e.message||e));}
    const u=verified.url;
    searchResults.push({resultId:'DIRECT_'+sha(u).slice(0,32),engine:'DIRECT',query:'DIRECT_URL',rank:null,url:u,title:'',snippet:'',sourceAuthority:'PUBLIC_DIRECT_URL',providerWrite:false,verified:false,admitted:false});
  }

  const uniqResults=[],seenUrl=new Set();
  for(const r of searchResults){
    const h=sha(r.url);if(seenUrl.has(h)||cursor.fetchedUrlHashes.includes(h))continue;
    seenUrl.add(h);uniqResults.push(r);if(uniqResults.length>=MAX_FETCHES)break;
  }

  const docs=[],evidence=[];
  for(const r of uniqResults){
    let sourceProof;try{sourceProof=await verifyPublicUrl(r.url,deps.urlPolicy);}catch(e){return hold(text(e.message||e),{url:r.url});}
    let doc;try{doc=await deps.fetcher.get({url:sourceProof.url,method:'GET',readOnly:true,maxBytes:MAX_BYTES_PER_FETCH,redirectMode:'MANUAL_REPREFLIGHT'});}
    catch(e){return hold('FETCH_EXCEPTION',{url:r.url,error:text(e&&e.message||e)});}
    if(!doc||doc.providerWrite===true||doc.networkWrite===true||doc.loginUsed===true||doc.formSubmitted===true)return hold('FETCH_NOT_READONLY',{url:r.url});
    if(text(doc.method).toUpperCase()!=='GET'&&text(doc.method).toUpperCase()!=='HEAD')return hold('FETCH_METHOD_FORBIDDEN',{url:r.url,method:doc.method});
    if(doc.publicAccess!==true)return hold('NONPUBLIC_SOURCE_FORBIDDEN',{url:r.url});
    if(doc.redirectChainVerified!==true)return hold('REDIRECT_REQUIRES_REPREFLIGHT',{url:r.url});
    if(doc.preservationVerified!==true)return hold('PRESERVATION_NOT_VERIFIED',{url:r.url});
    if(Number(doc.status||0)<200||Number(doc.status||0)>=400)return hold('FETCH_STATUS_HOLD',{url:r.url,status:doc.status});
    let finalProof;try{finalProof=await verifyPublicUrl(doc.finalUrl||doc.url||r.url,deps.urlPolicy);}catch(e){return hold(text(e.message||e),{url:r.url});}
    doc={...doc,finalUrl:finalProof.url};
    let ex;try{ex=await deps.extractor.extract({job,namespace:ns,searchResult:r,document:doc});}
    catch(e){return hold('EXTRACTOR_EXCEPTION',{url:r.url,error:text(e&&e.message||e)});}
    if(ex?.authorityEffect===true||ex?.providerWrite===true||ex?.networkWrite===true)return hold('EXTRACTOR_AUTHORITY_EFFECT',{url:r.url});
    try{evidence.push(evidenceEnvelope(ns,job,r,doc,ex||{}));docs.push(doc);}
    catch(e){return hold(String(e.message||e),{url:r.url});}
  }

  let normalized;try{normalized=validateEvidence(evidence,ns);}catch(e){return hold(String(e.message||e));}
  const nc=nextCursor(cursor,plan,docs,nsHash);
  let commit;try{commit=await deps.store.appendEvidence({namespace:ns,job,cursor:nc,rows:normalized,expectedPreviousStateHash:text(before.stateHash),providerWrite:false});}
  catch(e){return hold('MATERIALIZATION_COMMIT_EXCEPTION',{error:text(e&&e.message||e)});}
  if(!commit||commit.providerWrite===true||commit.state!=='MATERIALIZATION_COMMITTED')return hold('MATERIALIZATION_COMMIT_FAILED',{commit});
  let after;try{after=await deps.store.inspect({namespace:ns,jobId:job.jobId});}
  catch(e){return hold('STORE_POSTCHECK_EXCEPTION',{error:text(e&&e.message||e)});}
  if(!after||after.providerWrite===true||after.state==='HOLD')return hold('STORE_POSTCHECK_HOLD',{storeState:after});
  if(text(commit.stateHash)&&text(after.stateHash)!==text(commit.stateHash))return hold('MATERIALIZATION_READBACK_MISMATCH');
  if(Number(after.cursorSequence)!==nc.sequence)return hold('CURSOR_READBACK_MISMATCH',{expected:nc.sequence,actual:after.cursorSequence});

  const independenceGroups=uniq(normalized.map(x=>x.provenance?.independenceGroup));
  const out={
    protocolVersion:PROTOCOL,state:normalized.length?'PUBLIC_RESEARCH_PASS':'PUBLIC_RESEARCH_NOOP_PASS',
    actionId:ACTION_ID,capabilityId:CAPABILITY_ID,...flags(),completionClaimAllowed:true,
    verifiedAnswerAllowed:false,jobId:job.jobId,namespace:ns,namespaceHash:nsHash,priorCursor:cursor,nextCursor:nc,
    queryCount:plan.queries.length,informationGainQueryCount:plan.informationGainQueryCount,directUrlCount:plan.directUrls.length,
    searchResultCount:searchResults.length,searchAttempts:discovered.attempts,fetchCount:docs.length,evidenceCount:normalized.length,
    evidenceIds:normalized.map(x=>x.evidenceId),sourceRefs:normalized.map(x=>x.sourceRef),
    familyRefs:uniq(normalized.flatMap(x=>x.familyRefs||[])),projectIds:uniq(normalized.flatMap(x=>x.projectIds||[])),
    independenceGroups,independentSourceGroupCount:independenceGroups.length,materializationStateHash:text(after.stateHash)
  };
  out.proofContentSha256=sha(out);return out;
}

module.exports={
  PROTOCOL,ACTION_ID,CAPABILITY_ID,MAX_QUERIES,MAX_FOLLOWUPS,MAX_RESULTS_PER_QUERY,MAX_FETCHES,MAX_TEXT_CHARS,
  MAX_BYTES_PER_FETCH,MAX_PROVIDERS,FORBIDDEN_ADAPTER_METHODS,PRIVATE_PATTERNS,stable,sha,text,uniq,flags,hold,
  activationReady,namespace,namespaceHash,adapterSurface,isPrivateAddress,preflightStaticUrl,verifyPublicUrl,
  informationGainQueries,normalizePlan,validateCursor,resultIdentity,normalizeSearchResult,searchProviders,discover,
  evidenceEnvelope,validateEvidence,nextCursor,runJob
};
