(() => {
  'use strict';

  const INDEX_VERSION = 'TENS_PUBLIC_BBP_2026_08_20_001';
  const RULESET_VERSION = 'TENS_PUBLIC_CURATED_2_5';
  let eventSequence = 0;

  const sources = Object.freeze([
    {
      id: 'SRC_BBP_RESOLUTION_2018_172', occurrenceId: 'OCC_BBP_RESOLUTION_2018_172_PUBLIC_PACKET',
      label: 'Sarasota County Resolution 2018-172 — Local Historic Designation', recordType: 'County resolution',
      provenanceStatus: 'verified', publicSafe: true, documentDate: '2018-08-29',
      url: 'https://drive.google.com/file/d/1rYuQ7GGuFlcS_wgd9htH1nbZDuDN-gTM/view?usp=sharing'
    },
    {
      id: 'SRC_BBP_PDE_2026_06_23', occurrenceId: 'OCC_BBP_PDE_2026_06_23_PUBLIC_PACKET',
      label: 'Blackburn Point Bridge — HPB PD&E Presentation — June 23, 2026', recordType: 'County/consultant presentation',
      provenanceStatus: 'verified', publicSafe: true, documentDate: '2026-06-23',
      url: 'https://drive.google.com/file/d/13FeYgXdpqrdc0hpGKySMdGesjGnHH3Oq/view?usp=sharing'
    },
    {
      id: 'SRC_BBP_TIMELINE_2026_08_20', occurrenceId: 'OCC_BBP_TIMELINE_2026_08_20_PUBLIC_PACKET',
      label: 'TENS Update — 2021 to Pre-February 8, 2022 Replacement Timeline', recordType: 'TENS evidence synthesis',
      provenanceStatus: 'verified', publicSafe: true, documentDate: '2026-08-20',
      url: 'https://docs.google.com/document/d/1ttXU0fsB9GebIWJUr24Vsu97nI4aei6kJYNOb4MfK_0/edit?usp=sharing'
    },
    {
      id: 'SRC_BBP_SR2515_2024', occurrenceId: 'OCC_BBP_SR2515_2024_PUBLIC_PACKET',
      label: 'Hardesty & Hanover SR 2515 — Executed Replacement Engineering Agreement', recordType: 'Executed professional engineering agreement',
      provenanceStatus: 'verified', publicSafe: true, documentDate: '2024-11-07',
      url: 'https://drive.google.com/file/d/1CUxQWC7AmHKLXs7jokn_lamrmBv1jGVZ/view?usp=sharing'
    },
    {
      id: 'SRC_BBP_PRESERVATION_INDEX_2026_08_19', occurrenceId: 'OCC_BBP_PRESERVATION_INDEX_2026_08_19_PUBLIC_PACKET',
      label: 'PRR-5659 Historic Preservation Evidence Index', recordType: 'TENS evidence index',
      provenanceStatus: 'verified', publicSafe: true, documentDate: '2026-08-19',
      url: 'https://docs.google.com/document/d/1REmYlnZ-whW1W2v7iSus5r5TydUFFZ_y5KSKDJbjK1M/edit?usp=sharing'
    },
    {
      id: 'SRC_BBP_HISTORIC_MEETING_2025_03_31', occurrenceId: 'OCC_BBP_HISTORIC_MEETING_2025_03_31_PUBLIC_PACKET',
      label: 'County Historic Preservation and Repurposing Meeting — March 31, 2025', recordType: 'County/consultant meeting record',
      provenanceStatus: 'verified', publicSafe: true, documentDate: '2025-03-31',
      url: 'https://drive.google.com/file/d/1rXXNjRs6OvtVC7qr1rnSkey7s9T8z9Fb/view?usp=sharing'
    }
  ]);

  const findings = Object.freeze({
    historic: {
      id: 'V_BBP_HISTORIC_STATUS', title: 'Historic status is documented',
      text: 'Blackburn Point Bridge was constructed in 1925–26, is listed on the National Register of Historic Places, and received Sarasota County local historic designation through Resolution 2018-172.',
      classification: 'VERIFIED', sourceIds: ['SRC_BBP_RESOLUTION_2018_172'],
      limitations: ['Historic designation does not by itself require permanent preservation or decide the engineering alternative.'], provenanceStatus: 'verified'
    },
    alternatives: {
      id: 'V_BBP_PDE_ALTERNATIVES', title: 'Current PD&E materials still evaluate preservation and rehabilitation',
      text: 'The June 23, 2026 PD&E presentation includes preservation and rehabilitation as No-Build alternatives and also evaluates replacement alternatives, including swing-span and bascule concepts.',
      classification: 'VERIFIED', sourceIds: ['SRC_BBP_PDE_2026_06_23'],
      limitations: ['The alternatives and cost figures shown in the presentation are planning-stage materials, not final construction bids.'], provenanceStatus: 'verified'
    },
    surtax: {
      id: 'V_BBP_SURTAX_PREWORKSHOP', title: 'Replacement was already on the proposed Surtax IV list before the February 8, 2022 workshop',
      text: 'The preserved County-generated project-list evidence identifies “Blackburn Point Road Movable Bridge Replacement” at $4.492 million and shows it was not one of the projects added at the February 8 workshop.',
      classification: 'VERIFIED', sourceIds: ['SRC_BBP_TIMELINE_2026_08_20'],
      limitations: ['The linked TENS synthesis preserves the source limitation that the preferred original County/Clerk packet remains an archival target. This finding does not identify who first placed Blackburn on the earlier administrative list.'],
      provenanceStatus: 'verified', amount: 4492000, currency: 'USD', financialKind: 'OTHER'
    },
    sr2515: {
      id: 'V_BBP_SR2515_SCOPE', title: 'The 2024 engineering agreement formally frames the project around replacement',
      text: 'The executed Hardesty & Hanover SR 2515 agreement is titled “Professional Engineering Services for Blackburn Point Bridge Replacement.” Its Phase 1 scope calls for identifying the preferred alternative for bridge replacement.',
      classification: 'VERIFIED', sourceIds: ['SRC_BBP_SR2515_2024'],
      limitations: ['A replacement-framed engineering agreement is not the same thing as proof of the earlier decision-path rationale or a final selected construction alternative.'], provenanceStatus: 'verified'
    },
    repairAnalysis: {
      id: 'V_BBP_SR2515_EXISTING_BRIDGE_ANALYSIS', title: 'The replacement-framed scope still requires analysis of continued use of the existing bridge',
      text: 'The SR 2515 no-build task requires estimating remaining service life, preparing a maintenance-and-repair program to extend service life where practicable, assessing reliability, and comparing life-cycle costs of continued repairs versus replacement.',
      classification: 'VERIFIED', sourceIds: ['SRC_BBP_SR2515_2024'],
      limitations: ['The scope requires these analyses; this initial public index does not claim that every final analysis or recommendation has been completed or publicly produced.'], provenanceStatus: 'verified'
    },
    historicReview: {
      id: 'V_BBP_HISTORIC_REVIEW_PROCESS', title: 'Historic-preservation review is part of the current project process',
      text: 'PRR-5659 records document Section 106 / State Historic Preservation Office coordination and Sarasota County historic-preservation review, including the local Certificate of Appropriateness process for demolition, relocation, or alteration of the locally listed bridge.',
      classification: 'VERIFIED', sourceIds: ['SRC_BBP_PRESERVATION_INDEX_2026_08_19', 'SRC_BBP_HISTORIC_MEETING_2025_03_31'],
      limitations: ['Historic-review requirements establish process obligations; they do not predetermine the final alternative.'], provenanceStatus: 'verified'
    },
    planningHorizon: {
      id: 'I_BBP_DUAL_PLANNING_HORIZON', title: 'Near-term rehabilitation and longer-term replacement planning may have operated at the same time',
      text: 'The current record makes it plausible that Sarasota County was addressing near-term repair/rehabilitation needs while separately developing a future Surtax IV replacement project.',
      classification: 'INFERENCE', sourceIds: ['SRC_BBP_TIMELINE_2026_08_20', 'SRC_BBP_SR2515_2024'],
      limitations: ['TENS has not located the primary record that expressly states this was the County’s rationale.'], provenanceStatus: 'verified',
      reasoning: 'The preserved chronology contains near-term rehabilitation activity and a separate future replacement-project track, but the missing project-origin record prevents treating the relationship as established fact.'
    },
    originGap: {
      id: 'U_BBP_REPLACEMENT_ORIGIN', title: 'Who first put Blackburn replacement into the County/Surtax process remains unresolved',
      text: 'The current indexed evidence does not establish the person or source that first proposed or entered “Blackburn Point Road Movable Bridge Replacement,” the exact first-entry date, or whether the project originated with staff, a citizen submission, or both.',
      classification: 'UNKNOWN', unknownReason: 'NOT_ESTABLISHED', sourceIds: ['SRC_BBP_TIMELINE_2026_08_20'],
      limitations: ['This is an open discovery gap, not evidence that no such record exists.'], provenanceStatus: 'unresolved'
    },
    rationaleGap: {
      id: 'U_BBP_REPLACEMENT_RATIONALE', title: 'The specific rationale for the original replacement framing remains unresolved',
      text: 'The initial public index does not establish the specific engineering, navigation, lifecycle, evacuation, policy, or financial analysis used when replacement was first placed on the future project list.',
      classification: 'UNKNOWN', unknownReason: 'NOT_ESTABLISHED', sourceIds: ['SRC_BBP_TIMELINE_2026_08_20', 'SRC_BBP_SR2515_2024'],
      limitations: ['Later replacement-framed contracts do not, by themselves, prove why the earlier project entry was created.'], provenanceStatus: 'unresolved'
    },
    mayChartGap: {
      id: 'U_BBP_MAY2021_REHAB_CHART', title: 'The original May 2021 rehabilitation chart remains an evidence target',
      text: 'TENS has not yet preserved the original May 21, 2021 Blackburn rehabilitation chart/page needed to reconcile the reported approximately $555,000 item to the exact project title, funding source, work orders, invoices, payments, and closeout.',
      classification: 'UNKNOWN', unknownReason: 'SOURCE_UNAVAILABLE', sourceIds: ['SRC_BBP_TIMELINE_2026_08_20'],
      limitations: ['Secondary reporting is preserved, but the preferred primary chart and financial trail are still being sought.'], provenanceStatus: 'unresolved'
    },
    uscgGap: {
      id: 'U_BBP_USCG_2000_SOURCE', title: 'The underlying U.S. Coast Guard source record remains a primary-source target',
      text: 'Current PD&E materials cite a 2000 U.S. Coast Guard determination concerning navigation obstruction, but the underlying determination/correspondence has not yet been located in the reviewed TENS public evidence set.',
      classification: 'UNKNOWN', unknownReason: 'SOURCE_UNAVAILABLE', sourceIds: ['SRC_BBP_PDE_2026_06_23'],
      limitations: ['Failure to locate the underlying record in the reviewed production is not proof that it does not exist.'], provenanceStatus: 'unresolved'
    }
  });

  function normalizedQuery(query) { return String(query || '').toLowerCase().replace(/[^a-z0-9$&.\- ]+/g, ' '); }
  function relevantToIndex(q) {
    if (/(blackburn|sr\s*2515|po\s*251122|surtax\s*iv|casey\s*key)/.test(q)) return true;
    const bridgeTerms = ['bridge', 'swing', 'replacement', 'rehabilitation', 'preservation', 'historic'];
    return bridgeTerms.filter(term => q.includes(term)).length >= 3;
  }
  function pickFindings(q) {
    const origin = /(surtax|2021|2022|who|when|why|origin|decision|shift|replacement)/.test(q);
    const engineering = /(engineer|hardesty|2515|service life|maintenance|repair|reliability|life cycle|cost|scope)/.test(q);
    const historic = /(historic|preservation|section 106|certificate|register|rehabilitation)/.test(q);
    const alternatives = /(alternative|pde|pd&e|bascule|swing|navigation|preservation|rehabilitation|replace)/.test(q);
    const broad = !origin && !engineering && !historic && !alternatives;
    const verified = [], inference = [], unknown = [];
    if (broad || historic) verified.push(findings.historic, findings.historicReview);
    if (broad || alternatives) verified.push(findings.alternatives);
    if (broad || origin) verified.push(findings.surtax);
    if (broad || engineering || origin) verified.push(findings.sr2515, findings.repairAnalysis);
    if (broad || origin || engineering) inference.push(findings.planningHorizon);
    if (broad || origin) unknown.push(findings.originGap, findings.rationaleGap, findings.mayChartGap);
    if (broad || alternatives || q.includes('coast guard') || q.includes('uscg') || q.includes('navigation')) unknown.push(findings.uscgGap);
    const uniq = items => Array.from(new Map(items.map(item => [item.id, item])).values());
    return { verified: uniq(verified), inference: uniq(inference), unknown: uniq(unknown) };
  }
  function sourceSubset(groups) {
    const sourceIds = new Set();
    for (const group of [groups.verified, groups.inference, groups.unknown]) for (const finding of group) for (const sourceId of finding.sourceIds || []) sourceIds.add(sourceId);
    return sources.filter(source => sourceIds.has(source.id));
  }
  function searchEventId() { eventSequence += 1; return `PUB_BBP_${Date.now()}_${eventSequence}`; }
  function noIndexMatch(query) {
    return {
      scopeLabel: 'Initial public-safe index — Blackburn Point Bridge beta', verified: [], inference: [],
      unknown: [{ id: 'U_PUBLIC_INDEX_NO_MATCH', title: 'This question is outside the current public index match',
        text: `The initial TENS 2.5 public-safe index did not return a supported match for “${query}”. That does not establish that no responsive record exists.`,
        classification: 'UNKNOWN', unknownReason: 'NO_INDEX_MATCH', sourceIds: [],
        limitations: ['The initial public index is intentionally bounded and currently centers on the Blackburn Point Bridge beta evidence set.'], provenanceStatus: 'unresolved' }],
      sources: [], limitations: ['The initial TENS 2.5 public-safe index is bounded and is not the complete private TENS evidence archive.', 'No indexed match is not proof that no responsive record exists.'],
      actions: ['Refine the question to the Blackburn Point Bridge evidence currently in the public index.', 'Expand the public-safe evidence index only after source provenance and public-release boundaries are verified.'],
      audit: { searchEventId: searchEventId(), indexVersion: INDEX_VERSION, adapterVersion: 'PENDING_ADAPTER_STAMP', rulesetVersion: RULESET_VERSION, environment: 'PRODUCTION', resultState: 'NO_INDEX_MATCH' }
    };
  }

  const provider = Object.freeze({
    version: '2.5.0-initial-public', indexVersion: INDEX_VERSION, scopeLabel: 'Initial public-safe index — Blackburn Point Bridge beta',
    async search(query, options = {}) {
      const q = normalizedQuery(query);
      const emitStatus = typeof options.emitStatus === 'function' ? options.emitStatus : () => {};
      emitStatus({ eventType: 'INDEX_SCOPE', message: 'Searching the bounded public-safe Blackburn evidence index…', searchEventId: null });
      if (!relevantToIndex(q)) return noIndexMatch(query);
      const groups = pickFindings(q);
      const matchedSources = sourceSubset(groups);
      emitStatus({ eventType: 'CLASSIFY', message: 'Matching source-backed findings and unresolved gaps…', searchEventId: null });
      return {
        scopeLabel: provider.scopeLabel, verified: groups.verified, inference: groups.inference, unknown: groups.unknown, sources: matchedSources,
        limitations: ['This is an initial, curated public-safe index for the Blackburn Point Bridge beta. It is not the full private TENS archive and is not an exhaustive search of every government repository.', 'The search returns only findings that have been admitted to this bounded public index; omitted records may exist outside the current index.', 'A negative search result is never proof that no responsive record exists.'],
        actions: ['Highest-value open target: the Blackburn-specific pre-public-input Surtax IV project-origin record, including the first entry, creator/source, date, and supporting rationale.', 'Secondary targets: the original May 2021 rehabilitation chart/payment trail and the underlying U.S. Coast Guard determination cited by current PD&E materials.'],
        audit: { searchEventId: searchEventId(), indexVersion: INDEX_VERSION, adapterVersion: 'PENDING_ADAPTER_STAMP', rulesetVersion: RULESET_VERSION, environment: 'PRODUCTION', resultState: 'COMPLETE_WITH_LIMITATIONS' }
      };
    }
  });

  window.TENS_PUBLIC_PROVIDER = provider;
})();
