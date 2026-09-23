(() => {
  'use strict';
  async function getStatus(requestId) {
    const r = await window.TENS_API.fetch('/api/prr/status?requestId='+encodeURIComponent(String(requestId||'')));
    const data = await r.json(); if (!r.ok) throw new Error(data.error||'PRR_STATUS_FAILED'); return data;
  }
  async function connect() {
    if (!window.TENS_PRR_BRIDGE_FACTORY || !window.TENS_API) return;
    window.TENS_PRR_BRIDGE_FACTORY.deactivate();
    try {
      const cap = await window.TENS_API.fetch('/api/prr/capabilities'), info = await cap.json();
      if (!cap.ok || info.ready !== true || info.mode !== 'DRY_RUN' || info.providerWrite !== false) return;
      window.TENS_PRR_STATUS = Object.freeze({get:getStatus});
      window.TENS_PRR_BRIDGE_INFO = Object.freeze(info);
      window.dispatchEvent(new CustomEvent('tens-prr-bridge-ready',{detail:{mode:info.mode,submitEnabled:false}}));
    } catch (e) {}
  }
  connect();
})();