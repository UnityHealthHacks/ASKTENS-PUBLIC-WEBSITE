(() => {
  'use strict';

  const VERSION = '0.3.0';
  const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

  const UNKNOWN_REASONS = new Set([
    'NOT_ESTABLISHED',
    'NO_INDEX_MATCH',
    'SOURCE_UNAVAILABLE',
    'PROVENANCE_UNRESOLVED',
    'CONFLICTING_EVIDENCE',
    'SCOPE_LIMITATION'
  ]);

  const RESULT_STATES = new Set([
    'COMPLETE',
    'COMPLETE_WITH_LIMITATIONS',
    'NO_INDEX_MATCH',
    'FAILED',
    'CANCELLED',
    'TEST_ONLY'
  ]);

  const FINANCIAL_KINDS = new Set([
    'APPROPRIATION',
    'BUDGET_AMENDMENT',
    'GRANT_CEILING',
    'GRANT_AWARD',
    'CONTRACT_AUTHORIZATION',
    'PURCHASE_ORDER_AUTHORIZATION',
    'ESTIMATE',
    'INVOICE',
    'APPLICATION_FOR_PAYMENT',
    'PAYMENT',
    'REIMBURSEMENT_REQUEST',
    'REIMBURSEMENT',
    'REFUND',
    'CREDIT',
    'MATCH_REQUIREMENT',
    'OTHER'
  ]);

  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isText = value => typeof value === 'string' && value.trim().length > 0;
  const isStableId = value => isText(value) && value.length >= 3 && STABLE_ID.test(value);
  const isTextArray = value => Array.isArray(value) && value.every(isText);

  function isSafePublicUrl(value) {
    if (!isText(value)) return false;
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch (error) {
      return false;
    }
  }

  function validateAudit(audit, errors, options) {
    if (!isObject(audit)) {
      errors.push('Missing search audit summary.');
      return;
    }

    if (!isStableId(audit.searchEventId)) errors.push('Audit field searchEventId is missing or invalid.');
    if (!isStableId(audit.indexVersion)) errors.push('Audit field indexVersion is missing or invalid.');
    if (!isText(audit.adapterVersion)) errors.push('Audit field adapterVersion is required.');
    if (!isText(audit.rulesetVersion)) errors.push('Audit field rulesetVersion is required.');
    if (!['PRODUCTION', 'TEST'].includes(audit.environment)) errors.push('Audit field environment is missing or invalid.');

    if (!RESULT_STATES.has(audit.resultState)) {
      errors.push('Audit resultState is missing or invalid.');
    }

    if (audit.environment === 'PRODUCTION' && audit.resultState === 'TEST_ONLY') {
      errors.push('PRODUCTION evidence result cannot use TEST_ONLY state.');
    }

    if (audit.environment === 'TEST') {
      if (!['TEST_ONLY', 'FAILED', 'CANCELLED'].includes(audit.resultState)) {
        errors.push('TEST evidence result cannot claim a production completion state.');
      }
      if (options.allowTestOnly !== true) {
        errors.push('TEST evidence result is blocked from production validation mode.');
      }
    }
  }

  function validateSources(sources, errors) {
    if (!Array.isArray(sources)) {
      errors.push('sources must be an array.');
      return new Map();
    }

    const map = new Map();
    for (const source of sources) {
      if (!isObject(source)) {
        errors.push('Source entry is malformed.');
        continue;
      }

      const id = isText(source.id) ? source.id : '(unknown source)';
      if (!isStableId(source.id)) errors.push(`Source ${id} has a missing or invalid id.`);
      if (!isStableId(source.occurrenceId)) errors.push(`Source ${id} is missing a valid occurrenceId.`);
      if (!isText(source.label)) errors.push(`Source ${id} is missing label.`);
      if (!isText(source.recordType)) errors.push(`Source ${id} is missing recordType.`);
      if (source.provenanceStatus !== 'verified') errors.push(`Source ${id} has unresolved provenance.`);
      if (source.publicSafe !== true) errors.push(`Source ${id} is not explicitly public-safe.`);
      if (Object.prototype.hasOwnProperty.call(source, 'url') && source.url !== '' && !isSafePublicUrl(source.url)) {
        errors.push(`Source ${id} has an unsafe or invalid public URL.`);
      }

      if (isStableId(source.id)) {
        if (map.has(source.id)) errors.push(`Duplicate public source id ${source.id}.`);
        else map.set(source.id, source);
      }
    }
    return map;
  }

  function validateFinancialFields(finding, id, errors) {
    const hasAmount = Object.prototype.hasOwnProperty.call(finding, 'amount');
    const hasFinancialKind = Object.prototype.hasOwnProperty.call(finding, 'financialKind');
    const hasCurrency = Object.prototype.hasOwnProperty.call(finding, 'currency');

    if (hasFinancialKind && !FINANCIAL_KINDS.has(finding.financialKind)) {
      errors.push(`${id} has an invalid financialKind.`);
    }
    if (hasAmount && (typeof finding.amount !== 'number' || !Number.isFinite(finding.amount))) {
      errors.push(`${id} amount must be a finite number.`);
    }
    if (hasAmount && !hasFinancialKind) {
      errors.push(`${id} contains an amount without a financialKind.`);
    }
    if (hasAmount && (!hasCurrency || !/^[A-Z]{3}$/.test(finding.currency))) {
      errors.push(`${id} contains an amount without a valid three-letter currency code.`);
    }
    if (hasCurrency && !/^[A-Z]{3}$/.test(finding.currency)) {
      errors.push(`${id} has an invalid currency code.`);
    }
  }

  function validateFinding(finding, expectedClass, sourceMap, findingIds, errors) {
    if (!isObject(finding)) {
      errors.push(`${expectedClass} finding is malformed.`);
      return;
    }

    const id = isText(finding.id) ? finding.id : '(unknown finding)';
    if (!isStableId(finding.id)) errors.push(`${expectedClass} finding has a missing or invalid id.`);
    if (isStableId(finding.id)) {
      if (findingIds.has(finding.id)) errors.push(`Duplicate finding id ${finding.id}.`);
      else findingIds.add(finding.id);
    }

    if (!isText(finding.title)) errors.push(`${id} is missing title.`);
    if (!isText(finding.text)) errors.push(`${id} is missing text.`);
    if (finding.classification !== expectedClass) errors.push(`${id} classification does not match ${expectedClass} result section.`);
    if (!Array.isArray(finding.sourceIds)) errors.push(`${id} sourceIds must be an array.`);
    if (!isTextArray(finding.limitations)) errors.push(`${id} limitations must contain only non-empty text values.`);
    if (finding.provenanceStatus !== 'verified' && finding.provenanceStatus !== 'unresolved') {
      errors.push(`${id} has a missing or invalid provenanceStatus.`);
    }

    const sourceIds = Array.isArray(finding.sourceIds) ? finding.sourceIds : [];
    const uniqueSourceIds = new Set();
    for (const sourceId of sourceIds) {
      if (!isStableId(sourceId)) {
        errors.push(`${id} contains an invalid source id.`);
        continue;
      }
      if (uniqueSourceIds.has(sourceId)) errors.push(`${id} contains duplicate source id ${sourceId}.`);
      uniqueSourceIds.add(sourceId);
      if (!sourceMap.has(sourceId)) errors.push(`${id} references source ${sourceId} that was not returned as an approved public source.`);
    }

    if (expectedClass === 'VERIFIED') {
      if (finding.provenanceStatus !== 'verified') errors.push(`${id} cannot be VERIFIED with unresolved provenance.`);
      if (sourceIds.length < 1) errors.push(`${id} cannot be VERIFIED without at least one source.`);
    }

    if (expectedClass === 'INFERENCE') {
      if (sourceIds.length < 1) errors.push(`${id} cannot be INFERENCE without supporting source evidence.`);
      if (!isText(finding.reasoning)) errors.push(`${id} cannot be INFERENCE without explicit reasoning.`);
    }

    if (expectedClass === 'UNKNOWN') {
      if (!UNKNOWN_REASONS.has(finding.unknownReason)) errors.push(`${id} UNKNOWN finding is missing a valid unknownReason.`);
    }

    validateFinancialFields(finding, id, errors);
  }

  function validateResult(result, options = {}) {
    const errors = [];
    if (!isObject(result)) return { valid: false, errors: ['Adapter returned a non-object result.'] };

    for (const key of ['verified', 'inference', 'unknown', 'sources', 'limitations', 'actions']) {
      if (!Array.isArray(result[key])) errors.push(`${key} must be an array.`);
    }

    validateAudit(result.audit, errors, options);
    const sourceMap = validateSources(result.sources, errors);
    const findingIds = new Set();

    for (const finding of Array.isArray(result.verified) ? result.verified : []) {
      validateFinding(finding, 'VERIFIED', sourceMap, findingIds, errors);
    }
    for (const finding of Array.isArray(result.inference) ? result.inference : []) {
      validateFinding(finding, 'INFERENCE', sourceMap, findingIds, errors);
    }
    for (const finding of Array.isArray(result.unknown) ? result.unknown : []) {
      validateFinding(finding, 'UNKNOWN', sourceMap, findingIds, errors);
    }

    if (Array.isArray(result.limitations) && !isTextArray(result.limitations)) {
      errors.push('limitations contains an invalid value.');
    }
    if (Array.isArray(result.actions) && !isTextArray(result.actions)) {
      errors.push('actions contains an invalid value.');
    }

    const auditState = result.audit && result.audit.resultState;
    const verifiedCount = Array.isArray(result.verified) ? result.verified.length : 0;
    const inferenceCount = Array.isArray(result.inference) ? result.inference.length : 0;
    const unknown = Array.isArray(result.unknown) ? result.unknown : [];

    if (auditState === 'NO_INDEX_MATCH') {
      if (verifiedCount || inferenceCount) {
        errors.push('NO_INDEX_MATCH cannot contain VERIFIED or INFERENCE findings.');
      }
      if (!unknown.some(item => item && item.unknownReason === 'NO_INDEX_MATCH')) {
        errors.push('NO_INDEX_MATCH resultState requires an UNKNOWN finding with unknownReason NO_INDEX_MATCH.');
      }
    }

    if ((auditState === 'FAILED' || auditState === 'CANCELLED') && (verifiedCount || inferenceCount)) {
      errors.push(`${auditState} search results cannot present VERIFIED or INFERENCE findings as completed conclusions.`);
    }

    if (auditState === 'COMPLETE_WITH_LIMITATIONS' && (!Array.isArray(result.limitations) || result.limitations.length < 1)) {
      errors.push('COMPLETE_WITH_LIMITATIONS requires at least one explicit limitation.');
    }

    return { valid: errors.length === 0, errors };
  }

  function rejectedResult(validationErrors) {
    return {
      verified: [],
      inference: [],
      unknown: [{
        id: 'SYSTEM_RESULT_REJECTED',
        title: 'Evidence result rejected by TENS validation',
        text: 'The connected evidence result did not satisfy TENS provenance, classification, public-safe, structural, audit, or environment requirements. TENS is not presenting the rejected material as fact.',
        classification: 'UNKNOWN',
        unknownReason: 'PROVENANCE_UNRESOLVED',
        sourceIds: [],
        limitations: validationErrors.slice(0, 8),
        provenanceStatus: 'unresolved'
      }],
      sources: [],
      limitations: ['The live result failed TENS evidence validation.'].concat(validationErrors.slice(0, 8)),
      actions: ['Review the adapter output and evidence provenance before retrying.'],
      audit: {
        searchEventId: 'SYSTEM_REJECTED_RESULT',
        indexVersion: 'UNVERIFIED',
        adapterVersion: 'UNVERIFIED',
        rulesetVersion: `TENS_GUARD_${VERSION}`,
        environment: 'PRODUCTION',
        resultState: 'FAILED'
      }
    };
  }

  window.TENS_EVIDENCE_GUARD = Object.freeze({
    version: VERSION,
    validateResult,
    rejectedResult
  });
})();