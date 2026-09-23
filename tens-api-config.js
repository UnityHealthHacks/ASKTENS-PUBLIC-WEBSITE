(() => {
  'use strict';
  const meta = document.querySelector('meta[name="tens-api-base"]');
  const value = String(meta && meta.content || '').trim();
  const loopback = h => ['localhost','127.0.0.1','[::1]'].includes(h);
  let base = '', error = '';
  try {
    if (!value && !loopback(location.hostname)) throw new Error('API_BASE_NOT_CONFIGURED');
    const u = new URL(value || location.origin);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('API_BASE_ORIGIN_REQUIRED');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback(u.hostname) && loopback(location.hostname))) throw new Error('API_BASE_HTTPS_REQUIRED');
    if (!loopback(location.hostname) && (location.origin !== 'https://asktens.com' || u.origin !== 'https://api.asktens.com')) throw new Error('PUBLIC_ORIGIN_NOT_APPROVED');
    base = u.origin;
  } catch (e) { error = e.message || 'API_BASE_INVALID'; }
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
    fetch(path, options = {}) { return fetch(url(path), {...options, credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer'}); }
  });
})();