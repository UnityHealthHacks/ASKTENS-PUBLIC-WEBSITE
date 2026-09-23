(() => {
  'use strict';
  const VERSION='0.2.0',isText=v=>typeof v==='string'&&v.trim().length>0;
  function validateProposal(p){
    const errors=[];if(!p||typeof p!=='object')return{valid:false,errors:['PRR proposal is missing.']};
    for(const k of ['requestId','agency','agencyKey','draft','evidenceGap'])if(!isText(p[k]))errors.push(`${k} is required.`);
    return{valid:errors.length===0,errors};
  }
  function create(config={}){
    if(typeof config.submitter!=='function')throw new Error('TENS PRR bridge requires an explicit governed submitter.');
    return Object.freeze({version:VERSION,async submit(proposal,decision={}){
      const v=validateProposal(proposal);if(!v.valid)throw new Error(v.errors.join(' | '));
      if(decision.acknowledged!==true||decision.submitted!==true)throw new Error('CUSTOMER_ACK_AND_SUBMIT_REQUIRED');
      return config.submitter(Object.freeze({...proposal}),{acknowledged:true,submitted:true,customerEmail:String(decision.customerEmail||'').trim()});
    }});
  }
  window.TENS_PRR_BRIDGE_FACTORY=Object.freeze({version:VERSION,validateProposal,create,
    activate(config){const b=create(config);window.TENS_PRR_BRIDGE=b;return b},deactivate(){delete window.TENS_PRR_BRIDGE}
  });
})();