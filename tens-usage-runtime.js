(() => {
  'use strict';
  let completed=0;
  async function send(event,payload={}){try{await window.TENS_API.fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,...payload}),keepalive:true})}catch(e){}}
  function topicFor(data){return data&&data.audit&&String(data.audit.indexVersion||'').includes('BBP')?'BLACKBURN_POINT_BRIDGE':'UNCLASSIFIED'}
  function recordQuery(query,data,durationMs){const counts={verified:Array.isArray(data&&data.verified)?data.verified.length:0,inference:Array.isArray(data&&data.inference)?data.inference.length:0,unknown:Array.isArray(data&&data.unknown)?data.unknown.length:0};const event=completed++===0?'QUERY_COMPLETED':'QUERY_REFINED';send(event,{query:String(query||''),topicKey:topicFor(data),resultState:String(data&&data.audit&&data.audit.resultState||data&&data.tensState||''),counts,gapIds:Array.isArray(data&&data.unknown)?data.unknown.map(x=>String(x&&x.id||'')).filter(Boolean):[],durationMs:Number(durationMs||0)})}
  function recordShareCopy(pkg){return send('SHARE_COPIED',{topicKey:String(pkg&&pkg.topicKey||'UNCLASSIFIED'),sharePackageHash:String(pkg&&pkg.sharePackageHash||'')})}
  window.addEventListener('tens-evidence-result',e=>{const d=e&&e.detail||{};recordQuery(d.query,d.data,null)});
  window.TENS_USAGE_RUNTIME=Object.freeze({recordQuery,recordShareCopy});
})();