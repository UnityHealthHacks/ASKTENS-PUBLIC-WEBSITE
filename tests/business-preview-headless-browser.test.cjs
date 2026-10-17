'use strict';
// Isolated real-Chromium browser test for existing STATIC website customer journey.
// No customer secrets, live API, provider, email, payments or TENS runtime.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'asktens-ci-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server=null,child=null,ws=null,seq=0;const pending=new Map();
const chromeLaunchLog=[];
let chromeSpawnError=null;
function captureChrome(data){
 const text=String(data).slice(-8192);
 chromeLaunchLog.push(text);
 while(chromeLaunchLog.join('').length>8192)chromeLaunchLog.shift();
}
function serve(req,res){
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!/^\/[A-Za-z0-9._-]+$/.test(pathname))throw Error('PATH');
  const p=path.resolve(root,'.'+pathname);
  if(!p.startsWith(root+path.sep)||!fs.statSync(p).isFile())throw Error('FILE');
  const e=path.extname(p);if(!['.html','.js','.css'].includes(e))throw Error('EXT');
  res.writeHead(200,{'Content-Type':e==='.html'?'text/html; charset=utf-8':e==='.js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(p).pipe(res);
 }catch{res.writeHead(404);res.end('NOT_FOUND')}
}
function command(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT_'+method))},8000);
  pending.set(id,m=>{clearTimeout(t);if(m.error)reject(Error(JSON.stringify(m.error)));else resolve(m.result)});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function evaluate(expr){
 const r=await command('Runtime.evaluate',{expression:'JSON.stringify(('+expr+'))',returnByValue:true});
 if(r.exceptionDetails)throw Error('PAGE_EXCEPTION_'+JSON.stringify(r.exceptionDetails));
 return JSON.parse(r.result.value);
}
async function until(expr,name){
 for(let i=0;i<60;i++){try{if(await evaluate(expr))return}catch{}await sleep(120)}
 throw Error('BROWSER_WAIT_TIMEOUT_'+name);
}
async function main(){
 server=http.createServer(serve);
 await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
 const url='http://127.0.0.1:'+server.address().port+'/business.html';
 const chrome=process.env.TENS_TEST_CHROME||'/usr/bin/google-chrome';
 assert.ok(fs.existsSync(chrome),'Chrome must be preinstalled on CI image');
 child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=390,844',url],{stdio:['ignore','pipe','pipe']});
 child.on('error',e=>{chromeSpawnError=e?.code||e?.message||'CHROME_SPAWN_ERROR'});
 child.stderr.on('data',captureChrome);
 child.stdout.on('data',captureChrome);
 const f=path.join(profile,'DevToolsActivePort');let port=null;
 // Bounded cold-start tolerance for GitHub-hosted runners. Port 0 avoids races.
 const launchDeadline=Date.now()+(process.env.CI?30000:20000);
 while(Date.now()<launchDeadline){
  if(fs.existsSync(f)){
   try{const t=fs.readFileSync(f,'utf8').split(/\r?\n/)[0];if(/^\d+$/.test(t)){port=Number(t);break}}catch{}
  }
  // Chrome can advertise the port on stderr before DevToolsActivePort is flushed.
  const m=chromeLaunchLog.join('').match(/DevTools listening on ws:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//);
  if(m){port=Number(m[1]);break}
  if(chromeSpawnError||child.exitCode!==null||child.signalCode!==null)break;
  await sleep(125);
 }
 if(!port)throw Error('CHROME_DEBUG_PORT_UNAVAILABLE '+JSON.stringify({
  exitCode:child.exitCode,signal:child.signalCode,spawnError:chromeSpawnError,
  portFileExists:fs.existsSync(f),lastChromeOutput:chromeLaunchLog.join('').slice(-4000)
 }));
 assert.ok(Number.isInteger(port)&&port>0&&port<65536,'Invalid Chrome debugging port');
 let tab=null;
 for(let i=0;i<50;i++){try{const list=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();tab=list.find(x=>x.type==='page'&&x.url.startsWith(url));if(tab)break}catch{}await sleep(100)}
 assert.ok(tab?.webSocketDebuggerUrl,'Browser tab unavailable');
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true})});
 ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}});
 await command('Runtime.enable');
 await until("Boolean(document.getElementById('freeAssessmentForm')&&window.TENS_BUSINESS_CAPABILITIES&&window.TENS_BUSINESS_READINESS)",'INITIAL');
 const guest=await evaluate("({disabled:document.getElementById('runBusinessWork').disabled,account:document.getElementById('businessAccountState').textContent,width:document.documentElement.scrollWidth,view:innerWidth})");
 assert.equal(guest.disabled,true);assert.match(guest.account,/No usable organization credential/);assert.ok(guest.width<=guest.view,'horizontal overflow '+JSON.stringify(guest));
 console.log('PASS mobile viewport and anonymous work denial');
 const preview=await evaluate("(()=>{document.getElementById('freeBusinessType').value='Construction company';document.getElementById('freeOutcome').value='Find invoice discrepancies';document.getElementById('freeProblem').value='Reconcile invoices 101 to 104 against purchase order PO 72';document.getElementById('freeAssessmentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return {visible:!document.getElementById('freeAssessmentProceed').hidden,text:document.getElementById('freeAssessmentResult').textContent}})()");
 assert.equal(preview.visible,true);assert.match(preview.text,/free TENS fit check/);
 console.log('PASS actual Chromium approved free assessment');
 await evaluate("(()=>{document.getElementById('freeAssessmentProceed').click();return true})()");
 await until("location.pathname==='/pricing.html'&&Boolean(document.getElementById('quoteProblem'))",'QUOTE_PAGE');
 await until("document.getElementById('quoteProblem').value.includes('Reconcile invoices')",'QUOTE_DRAFT');
 const quote=await evaluate("({business:document.getElementById('quoteBusiness').value,problem:document.getElementById('quoteProblem').value,notice:document.getElementById('quoteStatus').textContent,url:location.href,search:location.search,draft:sessionStorage.getItem('tens_business_quote_draft_v1')})");
 assert.equal(quote.business,'Construction company');assert.match(quote.problem,/Find invoice discrepancies/);assert.match(quote.problem,/PO 72/);
 assert.match(quote.notice,/Nothing has been sent/);assert.equal(quote.search,'');assert.equal(quote.draft,null);
 assert.ok(!quote.url.includes('invoices'));
 console.log('PASS one-click quote restore, no transmission and clean URL');
 await evaluate("(()=>{location.href='business.html';return true})()");
 // Earlier capability scripts may be ready before the later form submit handler.
  // Require the fully loaded new document, not merely the first global namespace.
  await until("location.pathname==='/business.html'&&document.readyState==='complete'&&Boolean(document.getElementById('freeAssessmentForm')&&window.TENS_BUSINESS_CAPABILITIES&&window.TENS_BUSINESS_READINESS)",'RETURN');
 const denied=await evaluate("(()=>{document.getElementById('freeBusinessType').value='Construction company';document.getElementById('freeOutcome').value='Repair laptops';document.getElementById('freeProblem').value='Remote into our laptops and repair our computers';document.getElementById('freeAssessmentForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return {blocked:document.getElementById('freeAssessmentProceed').hidden,text:document.getElementById('freeAssessmentResult').textContent}})()");
 assert.equal(denied.blocked,true);assert.match(denied.text,/not available/i);
 console.log('PASS unsupported device-repair job cannot proceed');
 console.log('4/4 real browser checks PASS — synthetic static website only, R212 NOT ACTIVE');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(async()=>{
 try{ws?.close()}catch{}
 try{child?.kill('SIGTERM')}catch{}
 try{if(server)await new Promise(ok=>server.close(ok))}catch{}
 try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
});
