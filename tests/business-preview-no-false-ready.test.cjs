'use strict';
// Standalone synthetic browser tests: NO backend, customer data, browser, or payments.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'..','tens-business-free-assessment.js'),'utf8');
function preview(businessType,problemText,lang='en'){
 const els={};for(const id of ['freeAssessmentForm','freeBusinessType','freeOutcome','freeProblem','freeAssessmentResult','freeAssessmentProceed'])els[id]={value:'',innerHTML:'',hidden:true,listeners:{},addEventListener(type,fn){this.listeners[type]=fn}};
 els.freeBusinessType.value=businessType;els.freeProblem.value=problemText;
 const window={
  TENS_I18N:{lang:()=>lang},
  TENS_BUSINESS_READINESS:{rows:[{label:'Business back office',decision:'PASS_NOW',note:'Historical verified domain; per-customer work still requires onboarding.'}]},
  TENS_RESEARCHED_BUSINESS_CAPABILITIES:{rows:[{id:'ENDPOINT_DEVICE_MANAGEMENT',label:'Endpoint / Device Monitoring & Repair',decision:'FAIL_UNTIL_ISOLATED_ARM_BUILT'}]},
  TENS_BUSINESS_CAPABILITIES:{answer:()=>({state:'BUSINESS_CAPABILITY_READY',plainAnswer:'Document coordination may be possible.',capabilities:[{description:'Organize records'}],requires:['Approved files'],blocked:['External changes require authorization']})}
 };
 vm.runInNewContext(code,{window,document:{getElementById:id=>els[id]||null},location:{href:''}});
 els.freeAssessmentForm.listeners.submit({preventDefault(){}});
 return {html:els.freeAssessmentResult.innerHTML,proceed:els.freeAssessmentProceed.hidden};
}
let n=0;
function test(name,fn){fn();console.log('PASS '+name);n++}
test('explicit English customer-device repair holds and disables proceed',()=>{const x=preview('Business back office','Please remotely repair our office laptops');assert.match(x.html,/Not ready yet/);assert.match(x.html,/not available/i);assert.equal(x.proceed,true)});
test('explicit Spanish laptop repair holds',()=>{const x=preview('Business back office','Necesitamos reparar las computadoras de la oficina','es');assert.match(x.html,/Aún no está listo/);assert.equal(x.proceed,true)});
test('generic document reconciliation remains an ordinary scoped preview',()=>{const x=preview('Business back office','Reconcile our vendor invoices');assert.doesNotMatch(x.html,/This exact task is not available/);assert.equal(x.proceed,false)});
test('invoice review involving past laptop repair is not misclassified',()=>{const x=preview('Business back office','Compare invoices for completed laptop repairs');assert.doesNotMatch(x.html,/This exact task is not available/)});
test('missing problem never exposes proceed',()=>{const x=preview('Business back office','');assert.match(x.html,/Tell TENS what is going wrong/);assert.equal(x.proceed,true)});
console.log(n+'/'+n+' static business-preview tests PASS; production admission NOT tested.');
