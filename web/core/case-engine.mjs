/**
 * DockProof's deterministic, document-linked audit.
 * Inputs and currency are explicit: pounds, integer USD cents, discount basis points.
 * The bundled fixture and source-selected document cases share arithmetic and review gates.
 */
import {
  FIELD_DEFINITIONS, DOCUMENT_ROLES, documentRoles, evidenceFingerprint,
  fieldValue, fieldSelectionStatus, requiresSelectedSources,
} from './fact-review.mjs';

export const POLICY_VERSION = 'xpo-cnwy-199-ak3-20260817/v1';
export const SUPPORTED_CLASSES = Object.freeze([
  '50', '55', '60', '65', '70', '77.5', '85', '92.5', '100',
  '110', '125', '150', '175', '200', '250', '300', '400', '500',
]);

const TARIFF_URL = 'https://www.xpo.com/cdn/download_files/s1/p2831/CNWY_199-AK.3_Eff._08.17.2026.pdf';
const SHIPMENT_MAX_CENTS = 10000000;
const SOURCES = [
  {
    id: 'xpo_filing',
    title: 'XPO CNWY 199-AK.3 · written claim and carrier receipt',
    url: TARIFF_URL + '#page=11',
    locator: 'Item 7(11), page 11; effective August 17, 2026',
    description: 'The carrier must receive a written claim within nine calendar months after delivery. Include shipment identity, an assertion of carrier liability, and a specific amount.',
    verifiedAt: '2026-10-09',
  },
  {
    id: 'xpo_liability',
    title: 'XPO CNWY 199-AK.3 · cargo liability reference',
    url: TARIFF_URL + '#page=19',
    locator: 'Item 25, pages 19–21; effective August 17, 2026',
    description: 'Use the affected shipping piece, actual NMFC class, applicable service terms, invoice value and salvage. Standard class 70 is $5/lb; a spot quote is $1/lb. The shipment maximum is $100,000. Review special commodity and contract branches separately.',
    verifiedAt: '2026-10-09',
  },
  {
    id: 'cfr_claim',
    title: '49 CFR § 1005.2(b) · minimum written claim fields',
    url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-X/subchapter-B/part-1005/section-1005.2#p-1005.2(b)',
    locator: '49 CFR § 1005.2(b)',
    description: 'A written communication identifies the shipment, asserts liability for loss or damage, and claims a specified or determinable amount of money.',
    verifiedAt: '2026-10-09',
  },
  {
    id: 'cfr_invoice',
    title: '49 CFR § 1005.4(b) · invoice and discounts',
    url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-X/subchapter-B/part-1005/section-1005.4#p-1005.4(b)',
    locator: '49 CFR § 1005.4(b)',
    description: 'The supporting invoice shows all trade or other discounts, allowances, or deductions of any nature.',
    verifiedAt: '2026-10-09',
  },
  {
    id: 'xpo_filing_help',
    title: 'XPO · filing a freight claim',
    url: 'https://www.xpo.com/help-center/claims-and-refunds/how-file-claims-and-refunds/',
    locator: 'Official claim instructions and portal links',
    description: 'Follow the carrier filing instructions, attach the vendor invoice, and retain the carrier receipt or confirmation.',
    verifiedAt: '2026-10-09',
  },
];

const DOC_REQUIREMENTS = [
  ['bill_of_lading', 'Shipment identity and freight class', null],
  ['delivery_receipt', 'Visible damage recorded at delivery', null],
  ['commercial_invoice', 'Invoice with trade discount', null],
  ['inspection_record', 'Damage and salvage valuation', null],
  ['weight_sheet', 'Affected-piece weight evidence', 'receive_weight'],
  ['rate_confirmation', 'Applicable service terms', 'receive_rate'],
];

const MONEY_FIELDS = new Set(['invoiceGrossCents', 'allowanceCents', 'salvageCents']);
const EDITABLE_FACTS = new Set([
  ...MONEY_FIELDS, 'tradeDiscountBps', 'affectedWeightLb', 'freightClass',
  'goodsCondition', 'commodityScope', 'arrangedBy', 'excessValueAgreement',
  'deliveryDamage', 'claimReceivedDate',
]);

const clone = value => JSON.parse(JSON.stringify(value));
const todayUTC = () => new Date().toISOString().slice(0, 10);
const money = cents => cents === null || cents === undefined
  ? 'Pending evidence'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isMoney = value => Number.isSafeInteger(value) && value >= 0;
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
};

/** Stable change detector for review snapshots, with an explicit policy version. */
function fingerprint(value) {
  const text = canonical(value);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return 'fnv1a64:' + hash.toString(16).padStart(16, '0');
}

function reviewSignature(state) {
  const snapshot = clone(state);
  delete snapshot.events;
  if (snapshot.decisions) delete snapshot.decisions.review;
  return fingerprint({ policyVersion: POLICY_VERSION, case: snapshot });
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Calendar-month addition clamps to the last valid day of the target month. */
export function addCalendarMonths(dateString, months) {
  const date = parseDate(dateString);
  if (!date || !Number.isInteger(months)) throw new Error('Use a valid YYYY-MM-DD date and a whole number of calendar months.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function discountCents(gross, bps) {
  return Number((BigInt(gross) * BigInt(bps) + 5000n) / 10000n);
}

function rateCentsFor(service, freightClass) {
  if (service === 'spot_quote') return 100;
  if (service !== 'standard_tariff' || !SUPPORTED_CLASSES.includes(String(freightClass))) return null;
  return { '50': 300, '55': 350, '60': 400 }[String(freightClass)] ?? 500;
}

function sourceRefs(state, fields) {
  return fields.map(field => state.facts?.provenance?.[field]
    ? { field, ...clone(state.facts.provenance[field]) } : null).filter(Boolean);
}

export function evaluateCase(state, { today = todayUTC() } = {}) {
  const shipment = state?.shipment ?? {};
  const facts = state?.facts ?? {};
  const decisions = state?.decisions ?? {};
  const documents = Array.isArray(state?.documents) ? state.documents : [];
  const docs = new Map(documents.map(doc => [doc.id, doc]));
  const strictSources = requiresSelectedSources(state);
  const roleDocs = role => documents.filter(doc => documentRoles(doc).includes(role));
  const isReceived = doc => doc?.received === true && isText(doc?.text);
  const received = role => roleDocs(role).some(isReceived);
  const receivedDoc = id => isReceived(docs.get(id));
  const docFor = role => roleDocs(role).find(isReceived) ?? roleDocs(role)[0];
  const actualIds = ids => [...new Set(ids.flatMap(id => DOCUMENT_ROLES.includes(id)
    ? roleDocs(id).map(doc => doc.id) : [id]))];
  const selectedSources = new Map(FIELD_DEFINITIONS.map(field => [field.key,
    strictSources ? fieldSelectionStatus(state, field.key) : { valid: true }]));
  const sourceReady = key => selectedSources.get(key)?.valid === true;
  const sourcesReady = keys => keys.every(sourceReady);
  const issues = [];
  const checks = [];
  const math = [];
  const deadlines = [];
  let evidenceMissing = false;
  let manualReviewRequired = false;

  const issue = (id, title, detail, documentIds = [], { evidence = false, actionKey, severity = 'blocking' } = {}) => {
    if (issues.some(item => item.id === id)) return;
    issues.push({ id, title, detail, severity, documentIds: actualIds(documentIds), ...(actionKey ? { actionKey } : {}) });
    if (evidence) evidenceMissing = true;
    if (severity === 'blocking' && !evidence) manualReviewRequired = true;
  };
  const check = (id, label, status, detail, documentIds = []) => {
    checks.push({ id, label, status, detail, documentIds: actualIds(documentIds) });
  };
  const mathRow = (id, label, expression, valueCents, fields, documentIds, sourceIds = []) => {
    const evidence = sourceRefs(state, fields);
    math.push({ id, label, expression, valueCents,
      documentIds: evidence.length ? [...new Set(evidence.map(ref => ref.documentId))] : actualIds(documentIds),
      sourceIds, evidence });
  };

  for (const [id, label, actionKey] of DOC_REQUIREMENTS) {
    const present = received(id);
    check('document_' + id, label, present ? 'pass' : 'missing',
      present ? 'Received: ' + roleDocs(id).filter(isReceived).map(doc => doc.name).join('; ')
        : 'Add the ' + (docFor(id)?.name ?? id.replaceAll('_', ' ')) + '.', [id]);
    if (!present) issue('missing_' + id, 'Add ' + label.toLowerCase(),
      id === 'weight_sheet'
        ? 'Add a weight record identifying the affected shipping piece and its gross weight, including packing.'
        : id === 'rate_confirmation'
          ? 'Attach the rate confirmation to select the applicable liability branch.'
          : 'This source document is required for the current claim review.',
      [id], { evidence: true, ...(!strictSources ? { actionKey } : {}) });
  }

  if (strictSources) {
    const fieldsForReview = FIELD_DEFINITIONS.filter(field => field.required || fieldValue(state, field.key) !== null);
    for (const field of fieldsForReview) {
      const selection = selectedSources.get(field.key);
      if (!selection.valid) issue('source_' + field.key, 'Select evidence for ' + field.label.toLowerCase(),
        selection.detail, selection.documentId ? [selection.documentId] : [], { evidence: true });
    }
    const complete = fieldsForReview.every(field => sourceReady(field.key));
    check('selected_source_facts', 'Reviewed, source-linked shipment facts', complete ? 'pass' : 'missing',
      fieldsForReview.filter(field => sourceReady(field.key)).length + ' of ' + fieldsForReview.length
        + ' fields selected from exact, current document quotations.');
  }

  const scopeProblems = [];
  if (shipment.carrier !== 'XPO') scopeProblems.push('Carrier: XPO');
  if (shipment.mode !== 'LTL') scopeProblems.push('Transport mode: LTL');
  if (shipment.originCountry !== 'US' || shipment.destinationCountry !== 'US') scopeProblems.push('Origin and destination: United States');
  if (!isText(shipment.originState) || !isText(shipment.destinationState) || shipment.originState === shipment.destinationState) {
    scopeProblems.push('Route: US interstate');
  }
  if (facts.goodsCondition !== 'new') scopeProblems.push('Goods condition: new');
  if (facts.commodityScope !== 'ordinary') scopeProblems.push('Commodity: ordinary goods under the standard class table');
  if (facts.arrangedBy !== 'shipper') scopeProblems.push('Booking principal: shipper, with direct carrier terms');
  if (facts.excessValueAgreement !== false) scopeProblems.push('Excess-value agreement: standard liability selection');
  if (facts.deliveryDamage !== 'visible_noted') scopeProblems.push('Damage: visible and recorded on delivery');
  if (!SUPPORTED_CLASSES.includes(String(facts.freightClass))) scopeProblems.push('Actual NMFC class: a listed class');
  if (!['standard_tariff', 'spot_quote'].includes(facts.serviceType)) scopeProblems.push('Service: standard tariff or a documented spot quote');
  if (!isText(facts.affectedPieceId)) scopeProblems.push('Affected piece: one identified shipping piece');
  if (!parseDate(shipment.pickupDate) || shipment.pickupDate < '2026-08-17') scopeProblems.push('Shipment date: August 17, 2026 or later under the selected tariff version');
  const scopeSourcesReady = sourcesReady(['carrier', 'mode', 'originCountry', 'destinationCountry', 'originState',
    'destinationState', 'pickupDate', 'goodsCondition', 'commodityScope', 'arrangedBy', 'excessValueAgreement',
    'deliveryDamage', 'freightClass', 'serviceType', 'affectedPieceId']);
  const scopeSupported = scopeProblems.length === 0 && scopeSourcesReady;
  check('supported_scope', 'Supported shipment scope', scopeSupported ? 'pass' : (scopeProblems.length ? 'review' : 'missing'),
    scopeSupported
      ? 'XPO US interstate LTL; new ordinary goods; documented class ' + facts.freightClass + '; one visibly damaged piece; direct shipper terms.'
      : scopeProblems.length ? 'Manual review required. Current calculation scope: ' + scopeProblems.join('; ') + '.'
        : 'Select current source evidence for the route, goods, affected piece, and controlling service terms.',
    ['bill_of_lading', 'delivery_receipt', 'rate_confirmation']);
  if (scopeProblems.length) issue('manual_review_scope', 'Route this case to manual review',
    'The supported calculation requires: ' + scopeProblems.join('; ') + '.',
    ['bill_of_lading', 'delivery_receipt', 'rate_confirmation']);

  const identityValid = [shipment.pro, shipment.bol, shipment.shipper, shipment.consignee].every(isText)
    && sourcesReady(['pro', 'bol', 'shipper', 'consignee']);
  check('shipment_identity', 'Shipment identity for the written claim', identityValid ? 'pass' : 'missing',
    identityValid ? 'PRO ' + shipment.pro + ' · BOL ' + shipment.bol + ' · affected piece ' + facts.affectedPieceId
      : 'Enter the PRO, bill of lading, shipper, and consignee.', ['bill_of_lading', 'delivery_receipt']);
  if (!identityValid) issue('identity_required', 'Complete the shipment identity',
    'Enter the PRO, bill of lading, shipper, and consignee.', ['bill_of_lading'], { evidence: true });

  let deadline = null;
  const validToday = parseDate(today);
  const delivery = sourceReady('deliveryDate') ? parseDate(shipment.deliveryDate) : null;
  if (!validToday) issue('invalid_review_date', 'Enter a valid review date', 'Use YYYY-MM-DD for the review date.');
  if (delivery) {
    deadline = addCalendarMonths(shipment.deliveryDate, 9);
    deadlines.push({
      id: 'carrier_receipt_deadline',
      label: 'Written claim must be received by XPO',
      date: deadline,
      sourceId: 'xpo_filing',
      basis: 'Delivery date + 9 calendar months',
      deliveryDate: shipment.deliveryDate,
    });
    if (shipment.pickupDate > shipment.deliveryDate || (validToday && shipment.deliveryDate > today)) {
      issue('shipment_date_sequence', 'Review the shipment dates',
        'Use a completed delivery on or after pickup and on or before the review date.', ['bill_of_lading', 'delivery_receipt']);
    }
    const receivedDate = facts.claimReceivedDate;
    if (receivedDate !== null && receivedDate !== undefined && !parseDate(receivedDate)) {
      issue('invalid_carrier_receipt_date', 'Enter a valid carrier receipt date',
        'Record the carrier confirmation date as YYYY-MM-DD.');
    } else if (receivedDate && (receivedDate < shipment.deliveryDate || (validToday && receivedDate > today))) {
      issue('carrier_receipt_date_sequence', 'Review the carrier receipt date',
        'Record a completed carrier receipt on or after delivery and on or before the review date.');
    } else if ((receivedDate && receivedDate > deadline) || (!receivedDate && validToday && today > deadline)) {
      issue('claim_deadline_elapsed', 'Use manual review for the elapsed filing deadline',
        'The tariff carrier-receipt deadline is ' + deadline + '. Record the original receipt evidence and review the applicable claim history.',
        ['delivery_receipt']);
    }
    const deadlineIssue = issues.some(item => ['claim_deadline_elapsed', 'invalid_carrier_receipt_date', 'carrier_receipt_date_sequence', 'shipment_date_sequence'].includes(item.id));
    check('carrier_receipt_window', 'Carrier-receipt deadline', deadlineIssue ? 'review' : 'pass',
      receivedDate ? 'Carrier receipt recorded: ' + receivedDate + ' · deadline: ' + deadline
        : 'XPO must receive the written claim by ' + deadline + '. Export prepares the shipper filing packet.',
      ['delivery_receipt']);
  } else {
    issue('delivery_date_required', 'Add a valid delivery date',
      'The nine-calendar-month deadline starts from the documented delivery date.', ['delivery_receipt'], { evidence: true });
    check('carrier_receipt_window', 'Carrier-receipt deadline', 'missing', 'Add the delivery date.', ['delivery_receipt']);
  }

  let valuesValid = sourcesReady(['invoiceGrossCents', 'tradeDiscountBps', 'allowanceCents', 'salvageCents']);
  for (const field of MONEY_FIELDS) {
    if (!isMoney(facts[field])) {
      issue('invalid_' + field, 'Review the ' + field.replace(/Cents$/, '') + ' value',
        'Use a non-negative whole number of USD cents.', field === 'salvageCents' ? ['inspection_record'] : ['commercial_invoice']);
      valuesValid = false;
    }
  }
  if (!Number.isInteger(facts.tradeDiscountBps) || facts.tradeDiscountBps < 0 || facts.tradeDiscountBps > 10000) {
    issue('invalid_tradeDiscountBps', 'Review the trade discount',
      'Use a whole number from 0 to 10,000 basis points; 1,000 basis points is 10%.', ['commercial_invoice']);
    valuesValid = false;
  }

  let actualLossCents = null;
  let netInvoiceCents = null;
  if (valuesValid && received('commercial_invoice') && received('inspection_record')) {
    const discount = discountCents(facts.invoiceGrossCents, facts.tradeDiscountBps);
    netInvoiceCents = facts.invoiceGrossCents - discount - facts.allowanceCents;
    if (netInvoiceCents < 0 || facts.salvageCents > netInvoiceCents) {
      issue('invalid_valuation_balance', 'Review the invoice and salvage balance',
        'Discounts and allowances must fit within the invoice value; salvage must fit within the net invoice value.',
        ['commercial_invoice', 'inspection_record']);
    } else {
      actualLossCents = netInvoiceCents - facts.salvageCents;
      mathRow('gross_invoice', 'Affected-piece gross invoice', money(facts.invoiceGrossCents), facts.invoiceGrossCents,
        ['invoiceGrossCents'], ['commercial_invoice']);
      mathRow('trade_discount', 'Trade discount', money(facts.invoiceGrossCents) + ' × ' + number(facts.tradeDiscountBps / 100) + '%', discount,
        ['invoiceGrossCents', 'tradeDiscountBps'], ['commercial_invoice'], ['cfr_invoice']);
      mathRow('net_invoice', 'Affected-piece net invoice', money(facts.invoiceGrossCents) + ' − ' + money(discount) + ' − ' + money(facts.allowanceCents), netInvoiceCents,
        ['invoiceGrossCents', 'tradeDiscountBps', 'allowanceCents'], ['commercial_invoice'], ['cfr_invoice']);
      mathRow('salvage', 'Retained salvage value', money(facts.salvageCents), facts.salvageCents,
        ['salvageCents'], ['inspection_record'], ['xpo_liability']);
      mathRow('actual_loss', 'Evidence-backed actual loss', money(netInvoiceCents) + ' − ' + money(facts.salvageCents), actualLossCents,
        ['invoiceGrossCents', 'tradeDiscountBps', 'allowanceCents', 'salvageCents'], ['commercial_invoice', 'inspection_record'], ['xpo_liability', 'cfr_invoice']);
      if (actualLossCents === 0) issue('zero_actual_loss', 'Review the zero-loss valuation',
        'A positive damage demand requires a positive supported loss.', ['commercial_invoice', 'inspection_record']);
    }
  }
  check('actual_loss', 'Invoice and salvage reconciliation', actualLossCents === null ? 'review' : 'pass',
    actualLossCents === null ? 'Complete and review the invoice, discounts, allowances, and salvage.'
      : money(netInvoiceCents) + ' net invoice − ' + money(facts.salvageCents) + ' salvage = ' + money(actualLossCents) + ' actual loss.',
    ['commercial_invoice', 'inspection_record']);

  const weightValid = typeof facts.affectedWeightLb === 'number' && Number.isFinite(facts.affectedWeightLb) && facts.affectedWeightLb > 0;
  const totalWeightValid = typeof shipment.totalWeightLb === 'number' && Number.isFinite(shipment.totalWeightLb) && shipment.totalWeightLb > 0;
  let weightEvidenceValid = received('weight_sheet') && weightValid && totalWeightValid
    && sourcesReady(['affectedWeightLb', 'totalWeightLb', 'affectedPieceId']);
  if (!Number.isSafeInteger(shipment.totalPieces) || shipment.totalPieces <= 0) issue('invalid_shipment_pieces', 'Review the shipping-piece count',
    'Enter a positive whole number of total shipping pieces.', ['bill_of_lading']);
  if (!totalWeightValid) issue('invalid_shipment_weight', 'Review the shipment weight',
    'Enter a positive finite total shipment weight in pounds.', ['bill_of_lading']);
  if (received('weight_sheet') && !weightValid) {
    issue('affected_weight_required', 'Record the affected-piece weight',
      'Enter a positive finite weight for the identified damaged shipping piece.', ['weight_sheet']);
  }
  if (weightValid && totalWeightValid && facts.affectedWeightLb > shipment.totalWeightLb) {
    issue('affected_weight_exceeds_shipment', 'Reconcile the piece and shipment weights',
      'The affected-piece weight must fit within the total shipment weight.', ['weight_sheet', 'bill_of_lading']);
    weightEvidenceValid = false;
  }
  if (!strictSources && received('weight_sheet')) {
    const documented = docFor('weight_sheet').text.match(/Affected piece\s+(\S+)\s+weighs\s+([\d,.]+)\s+lb/i);
    if (documented && (documented[1] !== facts.affectedPieceId || Number(documented[2].replaceAll(',', '')) !== facts.affectedWeightLb)) {
      issue('weight_document_conflict', 'Reconcile the weight sheet and selected piece',
        'Use the identified piece and weight recorded on the received weight sheet.', ['weight_sheet', 'bill_of_lading']);
      weightEvidenceValid = false;
    }
  }
  check('affected_weight', 'Use the damaged piece’s weight', weightEvidenceValid ? 'pass' : 'missing',
    weightEvidenceValid
      ? facts.affectedPieceId + ': ' + number(facts.affectedWeightLb) + ' lb.'
        + (typeof facts.worksheetWeightLb === 'number' ? ' The original worksheet weight is preserved: ' + number(facts.worksheetWeightLb) + ' lb.' : '')
      : 'Add and select the gross weight of ' + (facts.affectedPieceId || 'the affected piece') + ', including its packing.',
    ['weight_sheet', 'claim_worksheet', 'bill_of_lading']);

  for (const [field, ref] of Object.entries(facts.provenance ?? {})) {
    if (strictSources || !receivedDoc(ref.documentId)) continue;
    if (!isText(ref.quote) || !docs.get(ref.documentId).text.includes(ref.quote)) {
      issue('citation_' + field, 'Reconnect the ' + field + ' source quotation',
        'The selected quotation must appear in the current received document.', [ref.documentId]);
    }
  }

  const rateCentsPerLb = rateCentsFor(facts.serviceType, facts.freightClass);
  let referenceLimitCents = null;
  if (scopeSupported && weightEvidenceValid && received('rate_confirmation') && rateCentsPerLb !== null) {
    referenceLimitCents = Math.min(SHIPMENT_MAX_CENTS, Math.round(facts.affectedWeightLb * rateCentsPerLb));
    mathRow('reference_limit', 'Selected tariff reference limit',
      number(facts.affectedWeightLb) + ' lb × ' + money(rateCentsPerLb) + '/lb; shipment maximum ' + money(SHIPMENT_MAX_CENTS),
      referenceLimitCents, ['affectedWeightLb', 'freightClass', 'serviceType'], ['weight_sheet', 'bill_of_lading', 'rate_confirmation'], ['xpo_liability']);
  }
  check('selected_reference', 'Applicable liability branch', referenceLimitCents === null ? 'missing' : 'pass',
    referenceLimitCents === null ? 'Receive the piece weight and service terms to calculate the reference limit.'
      : (facts.serviceType === 'spot_quote' ? 'Spot quote' : 'Standard tariff, class ' + facts.freightClass)
        + ': ' + money(rateCentsPerLb) + '/lb × ' + number(facts.affectedWeightLb) + ' lb = ' + money(referenceLimitCents) + ' reference limit.',
    ['rate_confirmation', 'weight_sheet', 'bill_of_lading']);

  const recommendedDemandCents = actualLossCents !== null && referenceLimitCents !== null
    ? Math.min(actualLossCents, referenceLimitCents) : null;
  const draftDemandCents = decisions.demandCents ?? recommendedDemandCents ?? (isMoney(facts.worksheetDemandCents) ? facts.worksheetDemandCents : null);
  const demandValid = isMoney(draftDemandCents) && draftDemandCents > 0
    && recommendedDemandCents !== null && draftDemandCents <= recommendedDemandCents;
  if (recommendedDemandCents !== null) {
    mathRow('recommended_demand', 'Recommended draft demand',
      'min(' + money(actualLossCents) + ' actual loss, ' + money(referenceLimitCents) + ' reference limit)',
      recommendedDemandCents, ['invoiceGrossCents', 'tradeDiscountBps', 'allowanceCents', 'salvageCents', 'affectedWeightLb', 'freightClass', 'serviceType'],
      ['commercial_invoice', 'inspection_record', 'weight_sheet', 'rate_confirmation'], ['xpo_liability', 'cfr_invoice']);
  }
  if (decisions.demandCents !== null && decisions.demandCents !== undefined && !demandValid) {
    issue('draft_demand_out_of_range', 'Review the specific requested amount',
      'Select a positive whole-cent demand within the evidence-backed recommendation.', ['commercial_invoice', 'inspection_record', 'weight_sheet', 'rate_confirmation']);
  }
  check('specific_demand', 'A specific, supported requested amount', demandValid ? 'pass' : 'review',
    demandValid ? 'Draft request: ' + money(draftDemandCents) + '.'
      + (isMoney(facts.worksheetDemandCents) ? ' Original worksheet request retained: ' + money(facts.worksheetDemandCents) + '.' : '')
      : (isMoney(facts.worksheetDemandCents) ? 'Original worksheet request: ' + money(facts.worksheetDemandCents) + '. ' : '')
        + 'Complete the evidence review to prepare the specific claim amount.',
    ['claim_worksheet', 'commercial_invoice', 'inspection_record', 'weight_sheet', 'rate_confirmation']);

  const signature = reviewSignature(state);
  const currentReview = decisions.review;
  const reviewValid = currentReview?.signature === signature
    && currentReview?.demandCents === draftDemandCents && parseDate(currentReview?.date) !== null;
  const hasBlocking = issues.some(item => item.severity === 'blocking');
  const canConfirm = !hasBlocking && demandValid;
  if (!reviewValid) {
    issue('shipper_review', currentReview ? 'Review the changed packet' : 'Confirm the shipper review',
      currentReview
        ? 'The facts or evidence have changed since the saved review. Confirm the current evidence, scope, and specific amount.'
        : 'Confirm the received evidence, selected contract branch, actual loss, reference limit, and draft demand.',
      [], { severity: 'review', actionKey: 'confirm_review' });
  }
  check('shipper_review', 'Shipper review of the current packet', reviewValid ? 'pass' : 'review',
    reviewValid ? 'Current evidence snapshot confirmed for ' + money(draftDemandCents) + ' on ' + currentReview.date + '.'
      : 'Review is linked to the current facts, documents, contract branch, and amount.');

  return {
    status: hasBlocking ? (evidenceMissing ? 'needs_evidence' : 'needs_review') : (reviewValid && demandValid ? 'ready' : 'needs_review'),
    actualLossCents, referenceLimitCents, recommendedDemandCents, draftDemandCents,
    originalDemandCents: isMoney(facts.worksheetDemandCents) ? facts.worksheetDemandCents : null,
    netInvoiceCents, rateCentsPerLb, issues, checks, math, deadlines,
    sources: clone(SOURCES),
    scopeSupported, manualReviewRequired, canConfirm, reviewValid,
    signature, policyVersion: POLICY_VERSION, reviewedAsOf: today,
    filingStatus: facts.claimReceivedDate ? 'carrier_receipt_recorded' : 'awaiting_carrier_submission',
  };
}

function rateDocumentText(state, service) {
  const spot = service === 'spot_quote';
  return [
    'L01 SYNTHETIC TRAINING RECORD — DockProof curated example',
    'L02 Rate confirmation | PRO: ' + state.shipment.pro + ' | BOL: ' + state.shipment.bol,
    'L03 Selected example service: ' + (spot ? 'spot quote.' : 'standard tariff shipment.'),
    'L04 CNWY 199-AK.3, effective 2026-08-17, applies to this US domestic LTL shipment.',
    'L05 Freight class: ' + state.facts.freightClass + ' | Goods condition: new | Liability reference: Item 25.',
    'L06 ' + (spot
      ? 'Spot quote reference: $1.00 per pound per individual lost or damaged piece.'
      : 'Standard tariff reference: the actual class table and documented affected-piece weight apply.'),
  ].join('\n');
}

export function applyAction(state, action, payload = {}) {
  const next = clone(state);
  next.decisions ??= { demandCents: null, review: null };
  next.events ??= [];
  const before = next.decisions.review;
  if (action !== 'confirm_review') next.decisions.review = null;
  const docById = id => {
    const doc = next.documents.find(item => item.id === id);
    if (!doc) throw new Error('Add the ' + id.replaceAll('_', ' ') + ' record before continuing.');
    return doc;
  };
  const event = { sequence: next.events.length + 1, action, ...(payload.today ? { date: payload.today } : {}) };

  switch (action) {
    case 'receive_weight': {
      if (requiresSelectedSources(next)) throw new Error('Use a source-linked weight candidate for this document case.');
      const doc = docById('weight_sheet');
      const match = doc.text.match(/Affected piece\s+(\S+)\s+weighs\s+([\d,.]+)\s+lb/i);
      if (!match || match[1] !== next.facts.affectedPieceId) throw new Error('The weight sheet must identify the selected affected piece and its weight in pounds.');
      doc.received = true;
      next.facts.affectedWeightLb = Number(match[2].replaceAll(',', ''));
      event.documentId = doc.id;
      event.value = next.facts.affectedWeightLb;
      break;
    }
    case 'receive_rate': {
      if (requiresSelectedSources(next)) throw new Error('Select the service terms from this case’s received documents.');
      const doc = docById('rate_confirmation');
      doc.received = true;
      event.documentId = doc.id;
      event.value = next.facts.serviceType;
      break;
    }
    case 'set_service': {
      const service = payload.service ?? payload.serviceType ?? payload.value;
      if (!['standard_tariff', 'spot_quote'].includes(service)) throw new Error('Select standard_tariff or spot_quote for the example scenario.');
      if (requiresSelectedSources(next)) throw new Error('The scenario control belongs to the curated C3 example. Select terms from this case’s documents.');
      next.facts.serviceType = service;
      next.decisions.demandCents = null;
      const doc = docById('rate_confirmation');
      doc.text = rateDocumentText(next, service);
      doc.name = service === 'spot_quote' ? 'Supplement · spot quote service' : 'Supplement · standard tariff service';
      next.facts.provenance ??= {};
      next.facts.provenance.serviceType = {
        documentId: 'rate_confirmation', line: 3,
        quote: 'Selected example service: ' + (service === 'spot_quote' ? 'spot quote.' : 'standard tariff shipment.'),
      };
      event.value = service;
      break;
    }
    case 'set_value': {
      const { field, value } = payload;
      if (field === 'demandCents') {
        if (value !== null && (!isMoney(value) || value === 0)) throw new Error('Enter a positive whole-cent demand, or null to use the recommendation.');
        next.decisions.demandCents = value;
      } else {
        if (requiresSelectedSources(next)) throw new Error('Use a source-linked candidate to set a document fact.');
        if (!EDITABLE_FACTS.has(field)) throw new Error('Choose a supported fact field for the edit.');
        if (MONEY_FIELDS.has(field) && !isMoney(value)) throw new Error('Enter a non-negative whole number of USD cents.');
        if (field === 'tradeDiscountBps' && (!Number.isInteger(value) || value < 0 || value > 10000)) throw new Error('Enter discount basis points from 0 to 10,000.');
        if (field === 'affectedWeightLb' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new Error('Enter a positive finite piece weight in pounds.');
        if (field === 'claimReceivedDate' && value !== null && !parseDate(value)) throw new Error('Enter the carrier receipt date as YYYY-MM-DD.');
        event.previousValue = next.facts[field];
        next.facts[field] = value;
        if (next.facts.provenance?.[field]) next.facts.provenance[field].method = 'shipper_entered_edit';
      }
      event.field = field;
      event.value = value;
      if (payload.reason) event.reason = String(payload.reason);
      break;
    }
    case 'confirm_review': {
      const today = payload.today ?? todayUTC();
      const result = evaluateCase(next, { today });
      if (!result.canConfirm) {
        const reasons = result.issues.filter(item => item.severity === 'blocking').map(item => item.title).join('; ');
        throw new Error('Review stopped: ' + (reasons || 'Complete the evidence and select a positive supported amount.') + '.');
      }
      next.decisions.review = {
        signature: reviewSignature(next),
        demandCents: result.draftDemandCents,
        date: today,
        reviewer: String(payload.reviewer ?? 'Shipper reviewer'),
      };
      event.date = today;
      event.value = result.draftDemandCents;
      break;
    }
    case 'reset_review':
      break;
    default:
      throw new Error('Choose a supported DockProof case action.');
  }
  if (before && action !== 'confirm_review') event.reviewReset = true;
  next.events.push(event);
  return next;
}

const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const safeName = value => String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'case';
const csv = value => {
  let text = String(value ?? '');
  if (/^[=+@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

export function createPacket(state, { today = todayUTC() } = {}) {
  const result = evaluateCase(state, { today });
  if (result.status !== 'ready') {
    const reasons = result.issues.filter(item => item.severity === 'blocking').map(item => item.title);
    throw new Error('Packet export stopped: ' + (reasons.length ? reasons.join('; ') : 'Confirm the current shipper review') + '.');
  }
  const shipment = state.shipment;
  const facts = state.facts;
  const synthetic = state.synthetic === true || state.documents.some(doc => doc.synthetic === true);
  const marker = synthetic ? 'SYNTHETIC EXAMPLE — SHIPPER-REVIEWED DRAFT' : 'SHIPPER-REVIEWED CLAIM DRAFT';
  const deadline = result.deadlines.find(item => item.id === 'carrier_receipt_deadline')?.date ?? '';
  const amount = money(result.draftDemandCents);
  const service = facts.serviceType === 'spot_quote' ? 'Spot quote, $1.00/lb' : 'Standard tariff, actual class ' + facts.freightClass + ', ' + money(result.rateCentsPerLb) + '/lb';
  const receivedDocs = state.documents.filter(doc => doc.received === true);
  const files = [];
  const addFile = (name, type, content) => files.push({ name, type, content });
  const evidenceFiles = receivedDocs.map((doc, i) => ({
    id: doc.id, name: doc.name, kind: doc.kind, roles: documentRoles(doc), synthetic: doc.synthetic === true,
    received: true, file: 'evidence/' + String(i + 1).padStart(2, '0') + '-' + safeName(doc.id) + '.txt',
    originalFile: doc.originalFile ?? null, originalName: doc.originalName ?? null,
    mimeType: doc.mimeType ?? 'text/plain', byteLength: doc.byteLength ?? null, sha256: doc.sha256 ?? null,
    textLength: doc.text.length, sourceFingerprint: evidenceFingerprint(doc.text),
    offsetUnit: 'UTF-16 code units in document.text',
    pages: clone(doc.pages ?? [{ page: 1, start: 0, end: doc.text.length }]),
    extraction: clone(doc.extraction ?? { method: 'curated_text' }),
    warnings: clone(doc.warnings ?? []),
    textKind: doc.pages?.some(page => page.extraction?.derived) ? 'contains_ocr_derived_text' : doc.text.trim() ? 'source_text' : 'visual_attachment',
    selectedFields: Object.entries(facts.provenance ?? {}).filter(([, ref]) => ref.documentId === doc.id).map(([key]) => key),
  }));
  const cover = [
    marker,
    synthetic ? 'Curated example with synthetic parties, shipment records, and values.' : 'Prepared for the named shipper’s filing process.',
    '',
    'Date: ' + today,
    'To: XPO Freight Claims',
    'From: ' + shipment.shipper,
    'Consignee: ' + shipment.consignee,
    'PRO: ' + shipment.pro,
    'Bill of lading: ' + shipment.bol,
    ...(isText(shipment.invoiceNumber) ? ['Invoice: ' + shipment.invoiceNumber] : []),
    'Delivery date: ' + shipment.deliveryDate,
    'Affected shipping piece: ' + facts.affectedPieceId,
    '',
    'SPECIFIC AMOUNT CLAIMED: ' + amount + ' USD',
    '',
    shipment.shipper + ' asserts that XPO is liable for damage to ' + facts.affectedPieceId
      + ' on the identified shipment and requests payment of ' + amount + ' USD.',
    'The delivery receipt records visible damage to ' + facts.affectedPieceId
      + '. The accompanying invoice, inspection record, piece-weight sheet, and rate confirmation support this demand.',
    '',
    'VALUATION',
    'Affected-piece gross invoice: ' + money(facts.invoiceGrossCents),
    'Trade discount: ' + number(facts.tradeDiscountBps / 100) + '%',
    'Additional allowances: ' + money(facts.allowanceCents),
    'Affected-piece net invoice: ' + money(result.netInvoiceCents),
    'Retained salvage: ' + money(facts.salvageCents),
    'Evidence-backed actual loss: ' + money(result.actualLossCents),
    'Selected service terms: ' + service,
    'Affected-piece weight: ' + number(facts.affectedWeightLb) + ' lb',
    'Tariff reference limit: ' + money(result.referenceLimitCents),
    'Reviewed amount claimed: ' + amount,
    ...(isMoney(facts.worksheetDemandCents) ? ['Original worksheet amount preserved in the audit: ' + money(facts.worksheetDemandCents)] : []),
    '',
    'Retain the damaged goods and packaging for carrier inspection.',
    'Supporting records are listed in document-manifest.json and included in evidence/.',
    '',
    'Shipper review: ' + state.decisions.review.reviewer + ' · ' + state.decisions.review.date,
    'Review snapshot: ' + result.signature,
    '',
    'CARRIER FILING HANDOFF',
    'Carrier receipt deadline: ' + deadline + ' (delivery + nine calendar months).',
    'Current filing status: ' + (facts.claimReceivedDate ? 'carrier receipt recorded on ' + facts.claimReceivedDate : 'awaiting submission to XPO'),
    'File through the official XPO claims process and retain the carrier confirmation.',
    'Official instructions: ' + SOURCES.find(source => source.id === 'xpo_filing_help').url,
    ...(synthetic ? ['', 'Use this packet to rehearse the workflow. Actual filing uses the shipper’s genuine documents and confirmed facts.'] : []),
    '',
  ].join('\n');
  addFile('01-claim-cover-letter.txt', 'text/plain', cover);

  const csvRows = [
    ['step', 'calculation', 'amount_usd', 'source_documents', 'source_quotes'],
    ...result.math.map(row => [
      row.label, row.expression, (row.valueCents / 100).toFixed(2),
      row.documentIds.join('; '),
      row.evidence.map(ref => ref.documentId + (ref.page ? ':p' + ref.page : '') + ':L' + String(ref.line).padStart(2, '0')
        + (Number.isInteger(ref.start) ? ' [' + ref.start + ':' + ref.end + ']' : '') + ' ' + ref.quote).join(' | '),
    ]),
    ['Reviewed specific demand', 'Shipper-confirmed amount', (result.draftDemandCents / 100).toFixed(2), '', ''],
    ...(isMoney(facts.worksheetDemandCents) ? [['Original worksheet demand', 'Original record retained',
      (facts.worksheetDemandCents / 100).toFixed(2),
      facts.provenance?.worksheetDemandCents?.documentId ?? 'claim_worksheet',
      facts.provenance?.worksheetDemandCents?.quote ?? '']] : []),
  ];
  addFile('02-valuation-audit.csv', 'text/csv', csvRows.map(row => row.map(csv).join(',')).join('\r\n') + '\r\n');
  addFile('03-valuation-audit.json', 'application/json', JSON.stringify({
    policyVersion: POLICY_VERSION, sourceMode: state.sourceMode ?? 'curated_fixture', synthetic,
    shipment, facts, documents: evidenceFiles, decisions: state.decisions,
    evaluation: result, events: state.events, intakeRuns: clone(state.intake?.runs ?? []),
  }, null, 2) + '\n');
  addFile('04-official-sources.txt', 'text/plain',
    [marker, '', ...SOURCES.flatMap(source => [source.title, source.locator, source.url, source.description, 'Verified: ' + source.verifiedAt, ''])].join('\n'));
  receivedDocs.forEach((doc, i) => addFile(evidenceFiles[i].file, 'text/plain', doc.text + '\n'));

  const mathHTML = result.math.map(row => '<tr><th scope="row">' + html(row.label) + '</th><td>'
    + html(row.expression) + '</td><td>' + html(money(row.valueCents)) + '</td></tr>').join('');
  const evidenceHTML = evidenceFiles.map(doc => '<li><a href="' + html(doc.file) + '">' + html(doc.name) + '</a>'
    + (doc.textKind === 'contains_ocr_derived_text' ? ' — OCR-derived text; compare with the original.' : doc.textKind === 'visual_attachment' ? ' — visual attachment; open its original file in the originals folder.' : '') + '</li>').join('');
  const sourcesHTML = SOURCES.map(source => '<li><a href="' + html(source.url) + '" target="_blank" rel="noopener noreferrer">'
    + html(source.title) + '</a> — ' + html(source.locator) + '</li>').join('');
  addFile('review.html', 'text/html', '<!doctype html><html lang="en"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>DockProof — ' + html(shipment.pro) + '</title>'
    + '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#172331}h1{line-height:1.2}header{border-bottom:3px solid #087c6d}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;font:14px/1.5 ui-monospace,monospace}.amount{font-size:38px;font-weight:750}a{color:#096e65}@media print{body{margin:0;max-width:none}a{color:inherit}table{break-inside:avoid}h2{break-after:avoid}}</style>'
    + '<header><p>' + html(marker) + '</p><h1>One shipment. An evidence-linked claim.</h1><p>PRO ' + html(shipment.pro)
    + ' · BOL ' + html(shipment.bol) + '</p></header><p>Reviewed specific demand</p><p class="amount">' + html(amount) + '</p>'
    + '<p>Actual loss: ' + html(money(result.actualLossCents)) + ' · Tariff reference limit: ' + html(money(result.referenceLimitCents)) + '</p>'
    + '<p>Written claim carrier-receipt deadline: <strong>' + html(deadline) + '</strong>. Filing status: ' + html(result.filingStatus.replaceAll('_', ' ')) + '.</p>'
    + '<h2>Valuation audit</h2><table><thead><tr><th>Step</th><th>Calculation</th><th>USD</th></tr></thead><tbody>' + mathHTML + '</tbody></table>'
    + '<h2>Original evidence</h2><ol>' + evidenceHTML + '</ol><h2>Official rule sources</h2><ul>' + sourcesHTML + '</ul>'
    + '<h2>Claim cover letter</h2><pre>' + html(cover) + '</pre></html>\n');

  const summary = {
    title: 'Shipper-reviewed ' + amount + ' claim draft',
    description: 'Actual loss ' + money(result.actualLossCents) + '; tariff reference ' + money(result.referenceLimitCents)
      + '; specific demand ' + amount + '. Carrier receipt due ' + deadline + '.',
    caseId: state.id, pro: shipment.pro, synthetic, status: 'shipper_reviewed_draft',
    actualLossCents: result.actualLossCents, referenceLimitCents: result.referenceLimitCents,
    requestedAmountCents: result.draftDemandCents, carrierReceiptDeadline: deadline,
    filingStatus: result.filingStatus,
  };
  const manifest = {
    schema: 'dockproof-packet/v2', caseId: state.id, synthetic, createdDate: today,
    policyVersion: POLICY_VERSION, reviewSignature: result.signature,
    review: clone(state.decisions.review), summary, documents: evidenceFiles,
    sourceMode: state.sourceMode ?? 'curated_fixture', selections: clone(facts.provenance ?? {}),
    sources: clone(SOURCES),
    files: [...files.map(file => ({ name: file.name, type: file.type })), { name: 'document-manifest.json', type: 'application/json' }],
  };
  addFile('document-manifest.json', 'application/json', JSON.stringify(manifest, null, 2) + '\n');
  return { filename: 'dockproof-' + safeName(state.id) + '-' + today + '.zip', files, summary, manifest };
}
