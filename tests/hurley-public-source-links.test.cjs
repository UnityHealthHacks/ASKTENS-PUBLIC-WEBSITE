'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'topic.html'),'utf8');
const browse=fs.readFileSync(path.join(root,'browse.html'),'utf8');
const start=page.lastIndexOf('<script>'),end=page.lastIndexOf('</script>');
assert(start>=0 && end>start);
const script=new vm.Script(page.slice(start+8,end));
function open(query){
 const map=new Map(),requests=[];
 const el=id=>{if(!map.has(id))map.set(id,{textContent:'',innerHTML:'',hidden:true,classList:{add(){},remove(){}},appendChild(){},addEventListener(){}});return map.get(id)};
 const ctx={window:{TENS_API:{fetch(...args){requests.push(args);return Promise.reject(Error('DISCONNECTED_TEST'))}}},document:{title:'',getElementById:el,querySelector(){return el('pill')},querySelectorAll(){return []},createElement(){return el('created')}},location:{search:query,href:''},URLSearchParams,requestAnimationFrame(){},setTimeout(){}};
 script.runInNewContext(ctx);
 return {el,requests,ctx};
}

test('Lyons Bay is a distinct source-linked topic without assumed County approval',()=>{
 const r=open('?id=hurley-dock');
 assert.match(r.el('title').textContent,/Lyons Bay/);
 assert.match(r.el('intro').textContent,/does not establish final County special-exception approval/i);
 assert.equal(r.el('verifiedPublicLinks').hidden,false);
 const links=r.el('publicSourceLinks').innerHTML;
 assert.match(links,/1hFYDq8SvItf968-SLz86v6XC5wbOBpyb8MJpmxhVbUg/);
 assert.match(links,/1LLm2jLGYVt-aXt83CvourBtyf6g2cnBv/);
 assert.match(links,/www.scgov.net/);
 assert.match(links,/23\.1648694\.1/);
 assert.match(links,/23\.1776682\.1/);
 assert.match(links,/23\.1776683\.1/);
 assert.match(links,/MinutesViewer\.php\?clip_id=6993&amp;view_id=15/);
 assert.match(r.el('intro').textContent,/recommended approval by 5-1/i);
 assert.match(r.el('intro').textContent,/That recommendation is advisory/i);
 assert.match(links,/noopener noreferrer/);
 assert.doesNotMatch(links,/javascript:/i);
 assert.doesNotMatch(r.el('title').textContent,/Blackburn/);
});

test('unsupported topic has no public source links and triggers no research',()=>{
 const r=open('?id=unlisted-subject-9999');
 assert.match(r.el('title').textContent,/Subject not indexed/);
 assert.equal(r.el('verifiedPublicLinks').hidden,true);
 assert.equal(r.el('publicSourceLinks').innerHTML,'');
 assert.equal(r.requests.length,0);
});

test('browse links explicitly to the distinct Lyons Bay dossier and public originals',()=>{
 assert.match(browse,/topic\.html\?id=hurley-dock/);
 assert.match(browse,/1hFYDq8SvItf968-SLz86v6XC5wbOBpyb8MJpmxhVbUg/);
 assert.match(browse,/1LLm2jLGYVt-aXt83CvourBtyf6g2cnBv/);
 assert.doesNotMatch(browse,/This local R210 beta candidate/);
});
