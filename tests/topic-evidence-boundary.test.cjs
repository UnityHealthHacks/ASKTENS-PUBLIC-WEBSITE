'use strict';
// Synthetic offline browser trust-boundary checks. No production APIs or providers.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const here=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(here,'tens-topic-evidence-boundary.js'),'utf8');
const page=fs.readFileSync(path.join(here,'topic.html'),'utf8');
const win={};vm.runInNewContext(source,{window:win,URL});const guard=win.TENS_TOPIC_EVIDENCE_BOUNDARY;
const hash='a'.repeat(64);
const fixture=()=>({answer:'An agency reported a verified result',verified:[{statement:'A document records a project milestone.',evidenceRefs:['SRC_A'] }],unknowns:[],sources:[{evidenceId:'SRC_A',preservationVerified:true,sourceKind:'ARCHIVED_PUBLIC_RECORD',contentHash:hash}]});
test('source-linked archived claim accepted as client-side candidate only',()=>assert.equal(guard.validate(fixture()).valid,true));
test('fail closed: unsupported claimed answer without findings',()=>assert.equal(guard.validate({...fixture(),verified:[]}).valid,false));
test('fail closed: fabricated complete without any source',()=>assert.equal(guard.validate({...fixture(),sources:[]}).valid,false));
test('fail closed: absent evidence reference',()=>assert.equal(guard.validate({...fixture(),verified:[{statement:'Wrong',evidenceRefs:['MISSING'] }]}).valid,false));
test('fail closed: preservation not verified',()=>{const r=fixture();r.sources[0].preservationVerified=false;assert.equal(guard.validate(r).valid,false)});
test('fail closed: archive has no SHA256',()=>{const r=fixture();r.sources[0].contentHash='';assert.equal(guard.validate(r).valid,false)});
test('fail closed: forged duplicate evidence identity',()=>{const r=fixture();r.sources.push({...r.sources[0]});assert.equal(guard.validate(r).valid,false)});
test('fail closed: unsafe remote record URL',()=>{const r=fixture();r.sources[0].url='javascript:alert(1)';assert.equal(guard.validate(r).valid,false)});
test('fail closed: explicit private source',()=>{const r=fixture();r.sources[0].publicSafe=false;assert.equal(guard.validate(r).valid,false)});
test('evidence-free UNKNOWN remains honest',()=>{const r={answer:'UNKNOWN',verified:[],sources:[],unknowns:[{statement:'Not established'}]};assert.equal(guard.validate(r).valid,true)});
test('topic loads guard and checks COMPLETE before render',()=>{assert.match(page,/src="tens-topic-evidence-boundary\.js"/);assert.match(page,/SOURCE_BOUNDARY_HOLD/);assert.match(page,/TENS_TOPIC_EVIDENCE_BOUNDARY\?\.validate\(x\.result\)/)});
test('topic never renders old localStorage snapshots as verified',()=>{assert.doesNotMatch(page,/loadSnapshot\(/);assert.doesNotMatch(page,/saveSnapshot\(/);assert.doesNotMatch(page,/R210 live evidence/);assert.doesNotMatch(page,/Latest verified R210/)});

test('topic inline script parses',()=>{const start=page.lastIndexOf('<script>')+8,end=page.lastIndexOf('</script>');assert.ok(start>=8&&end>start);assert.doesNotThrow(()=>new vm.Script(page.slice(start,end)))});
test('topic renders per-statement source evidence',()=>{assert.ok(page.includes('v.evidenceRefs||[]'));assert.ok(page.includes('Open source record'));assert.ok(page.includes('Archived SHA-256'))});
