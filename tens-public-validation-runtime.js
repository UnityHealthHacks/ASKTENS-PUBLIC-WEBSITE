(() => {
  'use strict';
  function ready(){
    return Boolean(
      window.TENS_PUBLIC_PROVIDER &&
      window.TENS_EVIDENCE_ADAPTER_FACTORY &&
      window.TENS_EVIDENCE_GUARD
    );
  }
  let adapter=null;
  function ensureAdapter(){
    if(adapter) return adapter;
    if(!ready()) throw new Error('TENS_VALIDATION_RUNTIME_NOT_READY');
    adapter=window.TENS_EVIDENCE_ADAPTER_FACTORY.activate({
      provider:window.TENS_PUBLIC_PROVIDER,
      adapterVersion:'TENS_PUBLIC_PROMOTION_ADAPTER_1'
    });
    return adapter;
  }
  async function search(query){
    const raw=await ensureAdapter().search(query);
    const validation=window.TENS_EVIDENCE_GUARD.validateResult(raw);
    if(!validation.valid){
      return Object.assign(
        {tensState:'REJECTED',scopeLabel:'Result blocked by truth boundary'},
        window.TENS_EVIDENCE_GUARD.rejectedResult(validation.errors)
      );
    }
    return Object.assign({tensState:'VALIDATED'},raw);
  }
  window.TENS_VALIDATED_PUBLIC_SEARCH=Object.freeze({ready,search});
})();
