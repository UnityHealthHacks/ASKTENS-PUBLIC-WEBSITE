'use strict';
// Read-only static public source-link regression. No credentials, source-attestation guards, or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=process.env.TENS_TEST_REPO||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'topic.html'),'utf8');
const blocks=Array.from(html.matchAll(/^'([a-z0-9-]+)':\{/gm));
const sections=new Map(blocks.map((m,i)=>[m[1],html.slice(m.index,blocks[i+1]?.index??html.indexOf('\n};',m.index))]));
const allLinks=[];
for(const [topic,section] of sections){
  for(const match of section.matchAll(/\burl:'(https:\/\/[^']+)'/g)){
    allLinks.push({topic,url:match[1]});
  }
}
const expected=new Map([
 ['blackburn',['https://drive.google.com/file/d/1M37yoxnQx7bUvBIDZ0Mq9ynQW9oyZsQ3/view']],
 ['little-sarasota-bay',['https://www.scgov.net/home/showpublisheddocument/71031/638912163690670000']],
 ['hurley-dock',[
  'https://docs.google.com/document/d/1hFYDq8SvItf968-SLz86v6XC5wbOBpyb8MJpmxhVbUg/edit',
  'https://drive.google.com/file/d/1LLm2jLGYVt-aXt83CvourBtyf6g2cnBv/view',
  'https://prodenv.dep.state.fl.us/DepStaging/api/dms/23.1648694.1',
  'https://prodenv.dep.state.fl.us/DepStaging/api/dms/23.1776682.1',
  'https://prodenv.dep.state.fl.us/DepStaging/api/dms/23.1776683.1',
  'https://sarasotacounty.granicus.com/MinutesViewer.php?clip_id=6993&view_id=15',
  'https://www.scgov.net/Home/Components/News/News/9340/'
 ]]
]);
test('nine evidence subjects remain indexed as distinct dossiers',()=>{
  assert.deepEqual([...sections.keys()].sort(),[
    '47th-street','blackburn','caspersen','hurley-dock','little-sarasota-bay',
    'midnight','phillippi-creek','south-jetty','water-tower'
  ].sort());
});
test('nine reviewed public-source links are pinned to their intended dossiers',()=>{
  assert.equal(allLinks.length,9);
  for(const [topic,urls] of expected){
    assert.deepEqual(allLinks.filter(x=>x.topic===topic).map(x=>x.url).sort(),urls.sort());
  }
});
test('Blackburn historic report is not mislabeled a structural or replacement approval',()=>{
  assert.match(sections.get('blackburn'),/does not establish the bridge\\'s current structural condition or a final replacement decision/);
});
test('Little Sarasota Bay agenda is not mislabeled an adopted grant or payment',()=>{
  assert.match(sections.get('little-sarasota-bay'),/agenda alone does not confirm a final vote, expenditure, or deliverable acceptance/);
});
test('Hurley FDEP authorization is not misrepresented as County final special exception',()=>{
  assert.match(sections.get('hurley-dock'),/FDEP permit does not establish final County special-exception approval/);
});
test('all external public links are HTTPS and contain no URL credentials',()=>{
  const allow=new Set(['drive.google.com','docs.google.com','www.scgov.net','prodenv.dep.state.fl.us','sarasotacounty.granicus.com']);
  for(const x of allLinks){const u=new URL(x.url);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');assert.ok(allow.has(u.hostname));}
});
test('public source URLs are unique and not leaked into unrelated dossier configuration',()=>{
  assert.equal(new Set(allLinks.map(x=>x.url)).size,allLinks.length);
  for(const {topic,url} of allLinks){
    for(const [other,body] of sections)if(other!==topic)assert.equal(body.includes(url),false,'source from '+topic+' found in '+other);
  }
});
test('the public list does not silently insert a source into subjects with no reviewed public link',()=>{
  for(const topic of sections.keys())if(!expected.has(topic))assert.equal(allLinks.some(x=>x.topic===topic),false);
});
