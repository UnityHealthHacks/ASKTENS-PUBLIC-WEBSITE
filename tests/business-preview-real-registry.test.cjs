'use strict';
// Native Node VM runs the real existing AskTENS browser capability data.
// It makes no network requests, sends no email, and does not access any customer tenant.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
const capability=file('tens-business-capabilities.js');
const readiness=file('tens-business-readiness.js');
const researched=file('tens-researched-business-capabilities.js');
const free=file('tens-business-free-assessment.js');
function make(){
 const ids={};
 for(const id of ['freeAssessmentForm','freeBusinessType','freeOutcome','freeProblem','freeAssessmentResult','freeAssessmentProceed']){
  ids[id]={value:'',innerHTML:'',hidden:true,listeners:{},addEventListener(k,fn){this.listeners[k]=fn}};
 }
 const w={TENS_I18N:{lang:()=> 'en'}};
 const context=vm.createContext({window:w,document:{getElementById:id=>ids[id]||null},location:{href:''},Date,sessionStorage:{setItem(){},getItem(){return null},removeItem(){}}});
 for(const js of [capability,readiness,researched,free])vm.runInContext(js,context);
 return {ids,w,request(b,q){ids.freeBusinessType.value=b;ids.freeProblem.value=q;ids.freeAssessmentForm.listeners.submit({preventDefault(){}});return {html:ids.freeAssessmentResult.innerHTML,blocked:ids.freeAssessmentProceed.hidden}}};
}
const check=(label,fn)=>{fn();console.log('PASS '+label)};
check('actual registry retains historic 10 ready-now / 41 onboarding / 16 bounded',()=>{
 const {w}=make(),rows=w.TENS_BUSINESS_READINESS.rows;
 assert.equal(rows.length,67);
 for(const [key,count] of [['PASS_NOW',10],['PASS_WITH_ONBOARDING',41],['PASS_WITH_BOUNDARIES',16]])assert.equal(rows.filter(x=>x.decision===key).length,count);
});
check('actual researched catalog retains 25 entries and explicit endpoint hold',()=>{
 const {w}=make(),rows=w.TENS_RESEARCHED_BUSINESS_CAPABILITIES.rows;
 assert.equal(rows.length,25);assert.equal(rows.find(x=>x.id==='ENDPOINT_DEVICE_MANAGEMENT').decision,'FAIL_UNTIL_ISOLATED_ARM_BUILT');
});
check('actual registry general accounting inquiry stays in free preview',()=>{
 const h=make(),x=h.request('Accounting firm','Help reconcile authorized invoice and purchase order records');
 assert.equal(x.blocked,false);assert.match(x.html,/free TENS fit check/i);assert.doesNotMatch(x.html,/This exact task is not available/);
});
check('actual registry flags unsupported remote laptop maintenance',()=>{
 const h=make(),x=h.request('Accounting firm','Please reset passwords on staff laptops');
 assert.equal(x.blocked,true);assert.match(x.html,/Not ready yet/);
});
check('actual registry holds Spanish unsupported computer repair',()=>{
 const h=make(),x=h.request('Accounting firm','Reparación de computadoras en mi oficina');
 assert.equal(x.blocked,true);assert.match(x.html,/todavía no está disponible/i);
});
check('actual registry invoice review about past laptop repairs remains allowed',()=>{
 const h=make(),x=h.request('Accounting firm','Compare invoices for completed laptop repairs');
 assert.equal(x.blocked,false);assert.match(x.html,/free TENS fit check/i);
});
check('business results route suppresses capability claims for unsupported laptop control',()=>{
 const {w}=make(),r=w.TENS_BUSINESS_CAPABILITIES.toResult('Can TENS remote into our laptops and clean malware?','en');
 assert.equal(r.mode,'BUSINESS_CAPABILITY');assert.match(r.plainAnswer,/does not offer customer-device repair/);
 assert.equal(r.verified.length,0);assert.equal(r.unknown[0].unknownReason,'SERVICE_NOT_READY');
});
check('Spanish business results route is explicitly NOT READY',()=>{
 const {w}=make(),r=w.TENS_BUSINESS_CAPABILITIES.toResult('¿Puede TENS hacer reparación de computadoras?','es');
 assert.match(r.plainAnswer,/no ofrece reparación/);
 assert.equal(r.verified.length,0);assert.equal(r.unknown[0].unknownReason,'SERVICE_NOT_READY');
});
check('ordinary accounting business results still advertise configurable core only',()=>{
 const {w}=make(),r=w.TENS_BUSINESS_CAPABILITIES.toResult('How can TENS help reconcile accounting invoices?','en');
 assert.equal(r.mode,'BUSINESS_CAPABILITY');
 assert.ok(r.verified.length>0);
 assert.notEqual(r.audit?.resultState,'SERVICE_NOT_READY');
});
console.log('9/9 REAL-REGISTRY browser-mock checks PASS. Historical classifications are NOT R212 current acceptance.');
