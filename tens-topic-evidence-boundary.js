(() => {
  'use strict';
  // Browser-side hold only. Server provenance and independent OS acceptance remain required.
  const sha256 = /^[a-f0-9]{64}$/i;
  const stableId = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,}$/;
  const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
  function validate(result) {
    const fail = reason => ({valid:false, reason});
    if (!isObject(result) || !Array.isArray(result.sources) ||
        !Array.isArray(result.verified) || !Array.isArray(result.unknowns) ||
        typeof result.answer !== 'string') return fail('MALFORMED_RESULT');
    if (!result.verified.length) {
      if (result.answer !== 'UNKNOWN') return fail('UNSUPPORTED_ANSWER');
      // An unresolved answer has no admitted evidence cards. Reject unexpected
      // sources before the topic page could render their links or metadata.
      if (result.sources.length) return fail('UNKNOWN_WITH_SOURCES');
      return {valid:true, result:{...result, answer:'UNKNOWN', verified:[], sources:[]}};
    }
    const indexed = new Map();
    for (const source of result.sources) {
      if (!isObject(source) || typeof source.evidenceId !== 'string' ||
          !stableId.test(source.evidenceId) || indexed.has(source.evidenceId) ||
          source.preservationVerified !== true) return fail('SOURCE_IDENTITY_UNPROVEN');
      const hasHash = typeof source.contentHash === 'string' && sha256.test(source.contentHash);
      let hasSafeUrl = false;
      if (typeof source.url === 'string' && source.url) {
        try { const u = new URL(source.url); hasSafeUrl = u.protocol === 'https:' &&
              !u.username && !u.password && !!u.hostname; } catch {}
        if (!hasSafeUrl) return fail('UNSAFE_SOURCE_LINK');
      }
      // Every admitted citation must have an independently accessible HTTPS link,
      // including archived records. A hash alone is not a public citation.
      if (!hasSafeUrl || !hasHash) return fail('SOURCE_PROVENANCE_INCOMPLETE');
      // Missing approval is not approval. The independent release issuer must
      // still attest public disclosure; this client check cannot replace it.
      if (source.publicSafe !== true) return fail('NOT_PUBLIC_SAFE');
      indexed.set(source.evidenceId, source);
    }
    for (const finding of result.verified) {
      if (!isObject(finding) || typeof finding.statement !== 'string' ||
          !finding.statement.trim() || !Array.isArray(finding.evidenceRefs) ||
          !finding.evidenceRefs.length || finding.evidenceRefs.some(id => !indexed.has(id))) {
        return fail('FINDING_WITHOUT_SOURCE');
      }
    }
    return {valid:true, result};
  }
  window.TENS_TOPIC_EVIDENCE_BOUNDARY = Object.freeze({validate});
})();
