(() => {
  'use strict';

  const FACTORY_VERSION = '0.1.0';
  const MAX_QUERY_LENGTH = 12000;

  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isText = value => typeof value === 'string' && value.trim().length > 0;

  function normalizeStatusEvent(event) {
    if (!isObject(event)) return null;
    if (!isText(event.message)) return null;
    if (!isText(event.eventType)) return null;

    return {
      eventType: event.eventType.trim(),
      message: event.message.trim(),
      searchEventId: isText(event.searchEventId) ? event.searchEventId.trim() : null
    };
  }

  function create(config) {
    if (!isObject(config)) throw new Error('TENS adapter configuration is required.');
    if (!isObject(config.provider) || typeof config.provider.search !== 'function') {
      throw new Error('TENS adapter requires an explicit provider with a search function.');
    }

    const adapterVersion = isText(config.adapterVersion)
      ? config.adapterVersion.trim()
      : `TENS_ADAPTER_${FACTORY_VERSION}`;

    const provider = config.provider;

    return Object.freeze({
      version: adapterVersion,

      async search(query, options = {}) {
        if (!isText(query)) throw new Error('TENS evidence query must contain text.');
        if (query.length > MAX_QUERY_LENGTH) throw new Error('TENS evidence query exceeds the adapter limit.');

        const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

        const providerResult = await provider.search(query, {
          emitStatus: event => {
            const status = normalizeStatusEvent(event);
            if (status) onStatus(status.message, status);
          }
        });

        if (!isObject(providerResult)) {
          throw new Error('TENS evidence provider returned a malformed result.');
        }
        if (!isObject(providerResult.audit)) {
          throw new Error('TENS evidence provider returned no search audit identity.');
        }

        const audit = Object.assign({}, providerResult.audit, { adapterVersion });
        return Object.assign({}, providerResult, { audit });
      }
    });
  }

  function activate(config) {
    const adapter = create(config);
    window.TENS_EVIDENCE_ADAPTER = adapter;
    return adapter;
  }

  function deactivate() {
    delete window.TENS_EVIDENCE_ADAPTER;
  }

  window.TENS_EVIDENCE_ADAPTER_FACTORY = Object.freeze({
    version: FACTORY_VERSION,
    create,
    activate,
    deactivate
  });
})();
