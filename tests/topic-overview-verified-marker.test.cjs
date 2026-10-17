'use strict';
// Pure in-memory regression of the real topic page, using a synthetic, cited result.
// Does not contact live services; does not change the protected evidence guard.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'topic.html'),'utf8');
const guard=fs.readFileSync(path.join(root,'tens-topic-evidence-boundary.js'),'utf8');
const match=page.match(/<script>\s*(\(\(\)=>\{[\s\S]*?\}\)\(\);)\s*<\/script>/);
assert.ok(match,'the real subject script must be loaded');
const offlineRecord={protocol:'TENS_R202_PUBLIC_RESULT_1',state:'COMPLETE',providerWrite:false,productionMutation:false,
 assignmentId:'ASSIGN_OFFLINE_TOPIC_TEST',answer:'VERIFIED',
 verified:[{type:'OFFICIAL_ITEM_NUMBER',statement:'The City of Venice item lists file number 26-0520.',
   evidenceRefs:['VENICE_LEGISTAR_26_0520'],evidenceAnswer:'26-0520'}],
 unknowns:[{type:'SCOPE_NOTE',statement:'This listing does not prove construction approval.',reason:'SCOPE_LIMITATION'}],
 sources:[{evidenceId:'VENICE_LEGISTAR_26_0520',preservationVerified:true,sourceKind:'PUBLIC_WEB',
   label:'City of Venice Legistar file 26-0520',recordType:'OFFICIAL_MEETING_ITEM',contentHash:'a'.repeat(64),
   url:'https://venice.legistar.com/LegislationDetail.aspx?ID=7858068'}]};
function fakeElement(nodes,id=''){
 return {id,innerHTML:'',textContent:'',hidden:false,children:[],classList:{add(){},remove(){}},
  addEventListener(){},appendChild(child){this.children.push(child);if(child.id)nodes.set(child.id,child)}};
}
async function render(record,search='?id=south-jetty'){
 const nodes=new Map(),calls=[];
 function get(id){if(!nodes.has(id))nodes.set(id,fakeElement(nodes,id));return nodes.get(id)}
 const document={title:'',getElementById:get,createElement:()=>fakeElement(nodes),
  querySelector:()=>fakeElement(nodes),querySelectorAll:()=>[]};
 const window={TENS_API:{fetch:async(route,options={})=>{
  calls.push({route,method:options.method||'GET'});
  if((options.method||'GET')==='POST')return{status:202,ok:true,json:async()=>({jobId:'OFFLINE_JOB'})};
  return {status:200,ok:true,json:async()=>({state:'COMPLETE',result:record})}
 }}};
 const location={search,href:'https://asktens.com/topic.html'+search};
 const context={window,document,location,URL,URLSearchParams,Date,
  requestAnimationFrame:fn=>fn(),setTimeout:fn=>{queueMicrotask(fn);return 0}};
 vm.createContext(context);
 vm.runInContext(guard,context,{filename:'tens-topic-evidence-boundary.js'});
 vm.runInContext(match[1],context,{filename:'topic.html:inline'});
 for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
 return {summary:get('summaryAnswer').textContent,highlights:get('highlights').innerHTML,
  records:get('records').innerHTML,title:get('title').textContent,calls};
}
test('VERIFIED marker never replaces the actual cited finding in topic overview',async()=>{
 const got=await render(offlineRecord);
 assert.equal(got.title,'South Jetty');
 assert.equal(got.summary,'The City of Venice item lists file number 26-0520.');
 assert.notEqual(got.summary,'VERIFIED');
 assert.match(got.highlights,/26-0520/);
 assert.match(got.records,/City of Venice Legistar file 26-0520/);
 assert.deepEqual(got.calls.map(x=>x.method),['POST','GET']);
});
test('honest UNKNOWN remains an unresolved overview with no source citation',async()=>{
 const unknown={...offlineRecord,answer:'UNKNOWN',verified:[],sources:[],
  unknowns:[{type:'NO_ADMISSIBLE_EVIDENCE',statement:'No matching admitted record.',reason:'NO_INDEX_MATCH'}]};
 const got=await render(unknown);
 assert.match(got.summary,/does not currently have enough admitted evidence/);
 assert.doesNotMatch(got.records,/Legistar/);
});
test('unrecognized subject fails closed without starting research or showing another dossier',async()=>{
 const got=await render(offlineRecord,'?id=not-listed-20261016');
 assert.equal(got.title,'Subject not indexed');
 assert.match(got.summary,/No evidence dossier is available/);
 assert.equal(got.calls.length,0);
});
