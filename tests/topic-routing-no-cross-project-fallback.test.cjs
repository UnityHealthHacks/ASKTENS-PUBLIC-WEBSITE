'use strict';
// A missing/unknown topic must not silently inherit an unrelated project's claims.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'..','topic.html'),'utf8');
const start=page.lastIndexOf('<script>'),end=page.lastIndexOf('</script>');
assert(start>=0&&end>start);
const script=new vm.Script(page.slice(start+8,end));

function openSubject(search){
  const elements=new Map(),events=[],fetches=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      textContent:'',innerHTML:'',classList:{add(){},remove(){}},
      appendChild(){},addEventListener(type,cb){events.push({id,type})}
    });
    return elements.get(id);
  };
  const pill=element('pill');
  const context={
    window:{TENS_API:{fetch(...args){fetches.push(args);throw Error('UNEXPECTED_BACKEND_CALL')}}},
    document:{
      title:'',getElementById:element,
      querySelectorAll(){return []},
      querySelector(){return pill},
      createElement(){return element('created')}
    },
    location:{search,href:'https://asktens.com/topic.html'+search},
    URLSearchParams,requestAnimationFrame(){},setTimeout(){},
  };
  script.runInNewContext(context);
  return {context,element,fetches,events};
}

for(const id of ['hurley-dock','not-a-topic','__proto__','constructor','<script>alert(1)</script>','']){
  test('unrecognized subject id '+JSON.stringify(id)+' fails closed without other dossier or backend call',()=>{
    const url=id?'?id='+encodeURIComponent(id):'';
    const r=openSubject(url);
    assert.match(r.element('title').textContent,/subject not indexed/i);
    assert.match(r.element('summaryAnswer').textContent,/no evidence dossier/i);
    assert.match(r.element('summaryMeta').textContent,/not proof that no records exist/i);
    assert.match(r.element('updated').textContent,/no research request submitted/i);
    assert.doesNotMatch(r.element('title').textContent,/Blackburn/i);
    assert.equal(r.element('lanes').innerHTML,'');
    assert.deepEqual(r.fetches,[]);
  });
}

test('existing valid subject still selects its own dossier before research',()=>{
  const r=openSubject('?id=midnight');
  assert.equal(r.element('title').textContent,'Midnight Pass');
  assert.match(r.context.document.title,/Midnight Pass/);
  assert.doesNotMatch(r.element('summaryAnswer').textContent,/No evidence dossier/i);
  // Async research may fail in this disconnected test environment; only subject identity is asserted.
});
