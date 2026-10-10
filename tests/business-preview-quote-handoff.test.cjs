'use strict';
// Local synthetic user-flow acceptance for public website drafts.
// Intentionally zero network, email sends, payment, or customer data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'..');
const free=fs.readFileSync(path.join(dir,'tens-business-free-assessment.js'),'utf8');
const core=fs.readFileSync(path.join(dir,'tens-business-capabilities.js'),'utf8');
const pricing=fs.readFileSync(path.join(dir,'pricing.html'),'utf8');
const match=pricing.match(/<script>\s*([\s\S]*?)<\/script>\s*<script src="tens-i18n.js">/);
assert.ok(match,'Pricing inline script must be uniquely found');
const priceScript=match[1];
let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++}
function harness(lang='en'){
 const store=new Map();
 const sessionStorage={setItem:(k,v)=>store.set(k,String(v)),getItem:k=>store.has(k)?store.get(k):null,removeItem:k=>store.delete(k)};
 const makeIds=(ids)=>Object.fromEntries(ids.map(id=>[id,{value:'',innerHTML:'',hidden:true,textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn}}]));
 const fresh=makeIds(['freeAssessmentForm','freeBusinessType','freeOutcome','freeProblem','freeAssessmentResult','freeAssessmentProceed']);
 const pricingIds=makeIds(['quoteForm','quoteStatus','quoteName','quoteBusiness','quoteEmail','quoteProblem']);
 const ctx={sessionStorage,store,freeEls:fresh,quoteEls:pricingIds,previewUrl:{href:'',search:''},quoteUrl:{href:'',search:'?from=preview'}};
 const readiness={rows:[{label:'Construction & engineering',decision:'PASS_NOW',note:'Historical tested domain; onboarding required for customer.'}]};
 const researched={rows:[{id:'ENDPOINT_DEVICE_MANAGEMENT',label:'Endpoint / Device Monitoring & Repair',decision:'FAIL_UNTIL_ISOLATED_ARM_BUILT'}]};
 function runPreview(business,goal,issue){
  fresh.freeBusinessType.value=business;fresh.freeOutcome.value=goal;fresh.freeProblem.value=issue;
  const sandbox={window:{TENS_I18N:{lang:()=> 'en'},TENS_BUSINESS_READINESS:readiness,TENS_RESEARCHED_BUSINESS_CAPABILITIES:researched},document:{getElementById:id=>fresh[id]||null},sessionStorage,location:ctx.previewUrl,Date};
  vm.runInNewContext(core,sandbox);
  sandbox.window.TENS_BUSINESS_CAPABILITIES={...sandbox.window.TENS_BUSINESS_CAPABILITIES,answer:()=>({state:'BUSINESS_CAPABILITY_READY',plainAnswer:'May support limited evidence review.',capabilities:[{description:'Record review'}],requires:['Scope and data'],blocked:['External writes']})};
  vm.runInNewContext(free,sandbox);
  fresh.freeAssessmentForm.listeners.submit({preventDefault(){}});
  return fresh.freeAssessmentProceed;
 }
 function runPricing(search='?from=preview'){
  ctx.quoteUrl.search=search;
  const sandbox={document:{getElementById:id=>pricingIds[id]||null},sessionStorage,localStorage:{getItem:k=>k==='tensLanguage'?lang:null},location:ctx.quoteUrl,URLSearchParams,Date,encodeURIComponent};
  vm.runInNewContext(priceScript,sandbox);
  return pricingIds;
 }
 return {ctx,runPreview,runPricing};
}
test('opt-in free preview keeps relevant context only in sessionStorage and preserves no auto-send',()=>{
 const h=harness(),b=h.runPreview('Construction company','Find invoice discrepancies','Reconcile invoices 101-104 against PO 72');
 assert.equal(b.hidden,false);b.onclick();
 assert.equal(h.ctx.previewUrl.href,'pricing.html?from=preview');
 assert.doesNotMatch(h.ctx.previewUrl.href,/invoice|PO|Construction/);
 assert.equal(h.ctx.store.size,1);
 const q=h.runPricing();assert.equal(q.quoteBusiness.value,'Construction company');
 assert.match(q.quoteProblem.value,/Desired result: Find invoice discrepancies/);
 assert.match(q.quoteProblem.value,/Reconcile invoices 101-104 against PO 72/);
 assert.equal(q.quoteEmail.value,'');
 assert.equal(h.ctx.store.size,0);
 assert.match(q.quoteStatus.textContent,/Nothing has been sent/);
 assert.equal(h.ctx.quoteUrl.href,'');
});
test('expired or stale preview is never restored',()=>{
 const h=harness();
 h.ctx.store.set('tens_business_quote_draft_v1',JSON.stringify({createdAt:Date.now()-20*60*1000,business:'Expired',goal:'',problem:'stale'}));
 const q=h.runPricing();assert.equal(q.quoteProblem.value,'');assert.equal(h.ctx.store.size,0);assert.match(q.quoteStatus.textContent,/expired or is unavailable/);
});
test('direct quote-page visit does not import unrelated retained preview',()=>{
 const h=harness();
 h.ctx.store.set('tens_business_quote_draft_v1',JSON.stringify({createdAt:Date.now(),business:'Sensitive private company',goal:'x',problem:'Not requested'}));
 const q=h.runPricing('');assert.equal(q.quoteProblem.value,'');assert.equal(h.ctx.store.size,1);
});
test('unsupported device-repair service cannot advance to quote with cached draft',()=>{
 const h=harness(),b=h.runPreview('Construction company','Repair our devices','Please remotely repair our office laptops');
 assert.equal(b.hidden,true);assert.match(h.ctx.freeEls.freeAssessmentResult.innerHTML,/not available/i);assert.equal(h.ctx.store.size,0);
});
test('malformed handoff is handled safely and consumed without leaving stale entry',()=>{
 const h=harness();h.ctx.store.set('tens_business_quote_draft_v1','{bad JSON');
 const q=h.runPricing();assert.equal(q.quoteProblem.value,'');assert.equal(h.ctx.store.size,0);assert.match(q.quoteStatus.textContent,/unavailable/);
});
test('quote still requires explicit user submit before email-app navigation',()=>{
 const h=harness();const q=h.runPricing('');
 q.quoteProblem.value='Compare project contract and invoice records';
 assert.equal(h.ctx.quoteUrl.href,'');
 q.quoteForm.listeners.submit({preventDefault(){}});
 assert.match(h.ctx.quoteUrl.href,/^mailto:/);
 assert.match(q.quoteStatus.textContent,/Review it, then send it when ready/);
});

test('Spanish quote restore confirms user review and no transmission',()=>{
 const h=harness('es'),b=h.runPreview('Construcción','Comparar facturas','Revisar facturas de proveedores');
 b.onclick();
 const q=h.runPricing();
 assert.match(q.quoteStatus.textContent,/No se envió nada/);
 assert.match(q.quoteProblem.value,/Revisar facturas de proveedores/);
 assert.equal(q.quoteEmail.value,'');
});
test('Spanish stale quote restore fails closed in Spanish',()=>{
 const h=harness('es');
 h.ctx.store.set('tens_business_quote_draft_v1',JSON.stringify({createdAt:Date.now()-25*60*1000,business:'X',goal:'Y',problem:'Caducado'}));
 const q=h.runPricing();
 assert.match(q.quoteStatus.textContent,/caducó/);
 assert.equal(q.quoteProblem.value,'');
});
console.log(passed+'/'+passed+' synthetic browser flow tests PASS; NOT a live production or AI integration test.');
