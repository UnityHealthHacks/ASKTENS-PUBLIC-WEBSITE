(() => {
  'use strict';
  const meta = document.querySelector('meta[name="tens-api-base"]');
  const value = String(meta && meta.content || '').trim();
  const loopback = h => ['localhost','127.0.0.1','[::1]'].includes(h);
  let base = '', error = '';
  try {
    if (!value && !loopback(location.hostname)) throw new Error('API_BASE_NOT_CONFIGURED');
    const u = new URL(loopback(location.hostname) ? location.origin : (value || location.origin));
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('API_BASE_ORIGIN_REQUIRED');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback(u.hostname) && loopback(location.hostname))) throw new Error('API_BASE_HTTPS_REQUIRED');
    if (!loopback(location.hostname) && (location.origin !== 'https://asktens.com' || u.origin !== 'https://api.asktens.com')) throw new Error('PUBLIC_ORIGIN_NOT_APPROVED');
    base = u.origin;
  } catch (e) { error = e.message || 'API_BASE_INVALID'; }
  function publicSessionId() {
    const key = 'tens.public.session.v1';
    let token = '';
    try { token = String(globalThis.sessionStorage && sessionStorage.getItem(key) || ''); } catch {}
    if (!/^[a-f0-9]{32}$/.test(token)) {
      const c = globalThis.crypto;
      if (!c || typeof c.getRandomValues !== 'function') return '';
      const bytes = new Uint8Array(16); c.getRandomValues(bytes);
      token = [...bytes].map(x => x.toString(16).padStart(2,'0')).join('');
      try { if (globalThis.sessionStorage) sessionStorage.setItem(key, token); } catch {}
    }
    return token;
  }
  const publicSession = publicSessionId();
  function url(path) {
    if (error) throw new Error(error);
    if (typeof path !== 'string' || !/^\/api\/[a-z/]+(?:\?[^#]*)?$/.test(path)) throw new Error('API_PATH_INVALID');
    const u = new URL(path, base);
    if (u.origin !== base) throw new Error('API_ORIGIN_INVALID');
    return u.href;
  }
  function evidenceUrl(value) {
    if (error) throw new Error(error);
    const u = new URL(value);
    if (u.origin !== base || !/^\/share\/SHARE_[A-Za-z0-9]{20}$/.test(u.pathname) || u.search || u.hash || u.username || u.password) throw new Error('EVIDENCE_URL_INVALID');
    return u.href;
  }
  window.TENS_API_BASE = base;
  window.TENS_API = Object.freeze({base, error, url, evidenceUrl,
    fetch(path, options = {}) {
      const target = url(path);
      const method = String(options.method || 'GET').toUpperCase();
      const headers = new Headers(options.headers || {});
      if (new URL(target).pathname === '/api/research' && method === 'POST') {
        if (!publicSession) throw new Error('PUBLIC_SESSION_UNAVAILABLE');
        headers.set('X-TENS-Public-Session', publicSession);
      }
      return fetch(target, {...options, headers, credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer'});
    }
  });
})();
