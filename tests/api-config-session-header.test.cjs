'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../tens-api-config.js'),'utf8');
function load(){
 const calls=[],store=new Map();
 const win={};
 const ctx={window:win,location:{hostname:'asktens.com',origin:'https://asktens.com'},document:{querySelector:()=>({content:'https://api.asktens.com'})},
  sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},crypto:require('node:crypto').webcrypto,URL,Headers,Uint8Array,
  fetch:(u,o)=>{calls.push({u,h:o.headers,m:o.method||'GET'});return Promise.resolve({})}};
 ctx.globalThis=ctx;vm.runInNewContext(src,ctx);return {api:win.TENS_API,calls};
}
test('per-tab session header is sent on POST /api/research and GET /api/research/status only',async()=>{
 const {api,calls}=load();
 await api.fetch('/api/research',{method:'POST',body:'{}'});
 await api.fetch('/api/research/status?jobId=R203WEB_'+'a'.repeat(32));
 await api.fetch('/api/research',{method:'GET'});
 await api.fetch('/api/prr/status');
 const tok=calls[0].h.get('X-TENS-Public-Session');assert.match(tok,/^[a-f0-9]{32}$/);
 assert.equal(calls[1].h.get('X-TENS-Public-Session'),tok,'same per-tab token');
 assert.equal(calls[2].h.get('X-TENS-Public-Session'),null);assert.equal(calls[3].h.get('X-TENS-Public-Session'),null);
});
