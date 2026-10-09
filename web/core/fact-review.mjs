/** Shared, source-linked fields for document intake and the deterministic claim desk. */
export const FIELD_DEFINITIONS = Object.freeze([
  { key: 'carrier', label: 'Carrier', group: 'shipment', type: 'text', required: true },
  { key: 'mode', label: 'Transport mode', group: 'shipment', type: 'enum', options: ['LTL', 'FTL', 'parcel', 'other', 'unknown'], required: true },
  { key: 'originCountry', label: 'Origin country · 2-letter code', group: 'shipment', type: 'text', required: true },
  { key: 'destinationCountry', label: 'Destination country · 2-letter code', group: 'shipment', type: 'text', required: true },
  { key: 'originState', label: 'Origin state · 2-letter code', group: 'shipment', type: 'text', required: true },
  { key: 'destinationState', label: 'Destination state · 2-letter code', group: 'shipment', type: 'text', required: true },
  { key: 'shipper', label: 'Shipper', group: 'shipment', type: 'text', required: true },
  { key: 'consignee', label: 'Consignee', group: 'shipment', type: 'text', required: true },
  { key: 'pro', label: 'Carrier PRO number', group: 'shipment', type: 'text', required: true },
  { key: 'bol', label: 'Bill of lading number', group: 'shipment', type: 'text', required: true },
  { key: 'pickupDate', label: 'Pickup date', group: 'shipment', type: 'date', required: true },
  { key: 'deliveryDate', label: 'Delivery date', group: 'shipment', type: 'date', required: true },
  { key: 'totalPieces', label: 'Total shipping pieces', group: 'shipment', type: 'integer', required: true },
  { key: 'totalWeightLb', label: 'Total shipment weight · lb', group: 'shipment', type: 'number', unit: 'lb', required: true },
  { key: 'invoiceNumber', label: 'Invoice number', group: 'shipment', type: 'text', required: false },
  { key: 'origin', label: 'Origin address or city', group: 'shipment', type: 'text', required: false },
  { key: 'destination', label: 'Destination address or city', group: 'shipment', type: 'text', required: false },
  { key: 'affectedPieceId', label: 'Affected shipping piece ID', group: 'valuation', type: 'text', required: true },
  { key: 'invoiceGrossCents', label: 'Affected-piece gross invoice · USD cents', group: 'valuation', type: 'integer', unit: 'cents', required: true },
  { key: 'tradeDiscountBps', label: 'Trade discount · basis points', group: 'valuation', type: 'integer', unit: 'bps', required: true },
  { key: 'allowanceCents', label: 'Additional allowances · USD cents', group: 'valuation', type: 'integer', unit: 'cents', required: true },
  { key: 'salvageCents', label: 'Retained salvage value · USD cents', group: 'valuation', type: 'integer', unit: 'cents', required: true },
  { key: 'affectedWeightLb', label: 'Affected-piece gross weight · lb', group: 'valuation', type: 'number', unit: 'lb', required: true },
  { key: 'worksheetWeightLb', label: 'Original worksheet weight · lb', group: 'valuation', type: 'number', unit: 'lb', required: false },
  { key: 'worksheetDemandCents', label: 'Original worksheet demand · USD cents', group: 'valuation', type: 'integer', unit: 'cents', required: false },
  { key: 'goodsCondition', label: 'Goods condition', group: 'terms', type: 'enum', options: ['new', 'used', 'unknown'], required: true },
  { key: 'commodityScope', label: 'Commodity scope', group: 'terms', type: 'enum', options: ['ordinary', 'special', 'unknown'], required: true },
  { key: 'arrangedBy', label: 'Booking principal', group: 'terms', type: 'enum', options: ['shipper', 'broker', 'other', 'unknown'], required: true },
  { key: 'excessValueAgreement', label: 'Purchased excess-value agreement', group: 'terms', type: 'boolean', required: true },
  { key: 'deliveryDamage', label: 'Delivery damage notation', group: 'terms', type: 'enum', options: ['visible_noted', 'visible_unnoted', 'concealed', 'none', 'unknown'], required: true },
  { key: 'freightClass', label: 'Actual NMFC freight class', group: 'terms', type: 'text', required: true },
  { key: 'serviceType', label: 'Selected service terms', group: 'terms', type: 'enum', options: ['standard_tariff', 'spot_quote', 'other', 'unknown'], required: true },
  { key: 'claimReceivedDate', label: 'Carrier claim receipt date', group: 'terms', type: 'date', required: false },
].map(field => Object.freeze(field)));

export const DOCUMENT_ROLES = Object.freeze([
  'bill_of_lading', 'delivery_receipt', 'commercial_invoice', 'inspection_record',
  'weight_sheet', 'rate_confirmation', 'claim_worksheet', 'damage_photo', 'supporting',
]);

const fieldByKey = new Map(FIELD_DEFINITIONS.map(field => [field.key, field]));
const clone = value => JSON.parse(JSON.stringify(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const documentIdPattern = /^[a-zA-Z0-9_-]{1,80}$/;

export class FactReviewError extends Error {
  constructor(message, code = 'candidate_invalid') {
    super(message); this.name = 'FactReviewError'; this.code = code;
  }
}

/** A deterministic text/change identifier. Original file SHA-256 stays separate. */
export function evidenceFingerprint(text) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return 'fnv1a64:' + hash.toString(16).padStart(16, '0');
}

export function requiresSelectedSources(state) {
  return state?.sourceMode === 'selected_candidates'
    || state?.synthetic !== true || state?.id !== 'dockproof-c3-example';
}

/** An explicit roles array is the current assignment; kind/id support the original fixture. */
export function documentRoles(doc) {
  if (Array.isArray(doc?.roles)) return [...new Set(doc.roles.filter(role => DOCUMENT_ROLES.includes(role)))];
  return [doc?.kind || doc?.id].filter(role => DOCUMENT_ROLES.includes(role));
}

export function fieldValue(state, key) {
  const definition = fieldByKey.get(key);
  return (definition?.group === 'shipment' ? state?.shipment?.[key] : state?.facts?.[key]) ?? null;
}

function parseValue(definition, input) {
  const { key, type, label } = definition;
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) {
    throw new FactReviewError('Enter a documented value for ' + label + '.', 'value_required');
  }
  if (type === 'boolean') {
    if (input === true || input === false) return input;
    if (String(input).trim().toLowerCase() === 'true') return true;
    if (String(input).trim().toLowerCase() === 'false') return false;
    throw new FactReviewError('Use true or false for ' + label + '.', 'value_type');
  }
  if (type === 'integer' || type === 'number') {
    const numericText = typeof input === 'string' ? input.trim() : String(input);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(numericText)) {
      throw new FactReviewError('Enter the ' + label + ' as a non-negative number in its stated units.', 'value_type');
    }
    const value = Number(numericText.replaceAll(',', ''));
    if (!Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) {
      throw new FactReviewError('Enter a finite ' + (type === 'integer' ? 'whole number' : 'number') + ' for ' + label + '.', 'value_type');
    }
    if ((definition.unit === 'lb' || key === 'totalPieces') && value <= 0) {
      throw new FactReviewError('Enter a positive value for ' + label + '.', 'value_range');
    }
    if (key === 'tradeDiscountBps' && value > 10000) {
      throw new FactReviewError('Use trade discount basis points from 0 to 10,000.', 'value_range');
    }
    return value;
  }
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new FactReviewError('Enter a text value for ' + label + '.', 'value_type');
  }
  let value = String(input).trim();
  if (type === 'date') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00.000Z') : null;
    if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new FactReviewError('Use a valid YYYY-MM-DD date for ' + label + '.', 'value_type');
    }
  }
  if (['originCountry', 'destinationCountry', 'originState', 'destinationState'].includes(key)) {
    value = value.toUpperCase();
    if (!/^[A-Z]{2}$/.test(value)) throw new FactReviewError('Use a 2-letter code for ' + label + '.', 'value_type');
  }
  if (type === 'enum' && !definition.options.includes(value)) {
    throw new FactReviewError('Choose a documented ' + label + ': ' + definition.options.join(', ') + '.', 'value_type');
  }
  return value;
}

function locationAt(doc, start, end) {
  const globalLine = doc.text.slice(0, start).split('\n').length;
  const page = (doc.pages ?? []).find(item => Number.isInteger(item.start) && Number.isInteger(item.end)
    && start >= item.start && start < item.end);
  const pageLine = page?.lines?.find(item => start >= item.start && start <= item.end);
  const line = pageLine?.line ?? (page ? doc.text.slice(page.start, start).split('\n').length : globalLine);
  const endPage = (doc.pages ?? []).find(item => end - 1 >= item.start && end - 1 < item.end);
  return { page: page?.page ?? 1, line, globalLine, ...(endPage && endPage.page !== page?.page ? { endPage: endPage.page } : {}) };
}

/** Exact offsets use JavaScript UTF-16 code units in the preserved document.text. */
export function normalizeCandidate(raw, documents) {
  const definition = fieldByKey.get(raw?.field);
  if (!definition) throw new FactReviewError('Choose a supported DockProof field.', 'fact_field');
  const value = parseValue(definition, raw.value);
  const documentId = raw.document_id ?? raw.documentId ?? raw.citation?.documentId;
  const doc = documents?.find(item => item.id === documentId);
  const quote = raw.quote ?? raw.citation?.quote;
  if (!doc || !nonempty(doc.text)) throw new FactReviewError('Add the candidate’s source document first.', 'document_missing');
  if (!nonempty(quote)) throw new FactReviewError('Select an exact source quotation for ' + definition.label + '.', 'citation_required');
  const sourceFingerprint = evidenceFingerprint(doc.text);
  if (raw.sourceFingerprint && raw.sourceFingerprint !== sourceFingerprint) {
    throw new FactReviewError('The source text changed. Select this fact from the current document.', 'source_changed');
  }
  const locator = raw.citation ?? {};
  const requestedStart = raw.start ?? locator.start;
  const requestedEnd = raw.end ?? locator.end;
  const requestedPage = raw.page ?? locator.page;
  const requestedLine = raw.line ?? locator.line;
  const requestedGlobalLine = raw.globalLine ?? locator.globalLine;
  const hasStart = requestedStart !== null && requestedStart !== undefined;
  const matches = [];
  if (hasStart) {
    if (!Number.isInteger(requestedStart) || requestedStart < 0 || doc.text.slice(requestedStart, requestedStart + quote.length) !== quote) {
      throw new FactReviewError('The quotation must match the exact source offsets.', 'citation_mismatch');
    }
    matches.push(requestedStart);
  } else {
    for (let offset = doc.text.indexOf(quote); offset >= 0; offset = doc.text.indexOf(quote, offset + 1)) matches.push(offset);
  }
  const located = matches.filter(start => {
    const end = start + quote.length;
    const location = locationAt(doc, start, end);
    return (requestedEnd === undefined || requestedEnd === null || requestedEnd === end)
      && (requestedPage === undefined || requestedPage === null || requestedPage === location.page)
      && (requestedLine === undefined || requestedLine === null || requestedLine === location.line)
      && (requestedGlobalLine === undefined || requestedGlobalLine === null || requestedGlobalLine === location.globalLine);
  });
  if (located.length === 0) throw new FactReviewError('The quotation needs an exact match at the supplied source location.', 'citation_mismatch');
  if (located.length > 1) throw new FactReviewError('This quotation occurs several times. Supply its page, line, or exact start offset, or select a longer unique quotation.', 'citation_ambiguous');
  const start = located[0];
  const end = start + quote.length;
  const citation = { documentId, start, end, ...locationAt(doc, start, end), quote, matched: true };
  const id = 'fact-' + evidenceFingerprint(JSON.stringify([definition.key, value, documentId, start, end, sourceFingerprint])).slice(8);
  return {
    id, field: definition.key, value, document_id: documentId, quote, citation,
    sourceFingerprint, sourceSha256: doc.sha256 ?? null,
    method: nonempty(raw.method) ? raw.method : 'manual',
    synthetic: doc.synthetic === true,
  };
}

export function createEmptyCase({ id, title, synthetic = false } = {}) {
  const shipment = {};
  const facts = {};
  for (const field of FIELD_DEFINITIONS) (field.group === 'shipment' ? shipment : facts)[field.key] = null;
  facts.provenance = {};
  return {
    id: id ?? 'case-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)),
    title: title ?? 'Your freight claim', synthetic: synthetic === true,
    sourceMode: 'selected_candidates', shipment, facts, documents: [],
    decisions: { demandCents: null, review: null }, events: [],
    intake: { candidates: [], questions: [], runs: [] },
  };
}

export function addDocuments(state, documents) {
  if (!Array.isArray(documents) || documents.length === 0) throw new FactReviewError('Choose at least one document to add.', 'document_count');
  const next = clone(state);
  next.documents ??= [];
  next.decisions ??= { demandCents: null, review: null };
  next.events ??= [];
  const changes = [];
  const seen = new Set();
  for (const incoming of documents) {
    if (!incoming || !documentIdPattern.test(incoming.id ?? '') || seen.has(incoming.id)) {
      throw new FactReviewError('Each document in this update needs a unique safe ID of 1–80 letters, digits, underscores, or hyphens.', 'document_id');
    }
    seen.add(incoming.id);
    const index = next.documents.findIndex(doc => doc.id === incoming.id);
    const previous = index >= 0 ? next.documents[index] : null;
    const doc = { ...(previous ?? {}), ...clone(incoming) };
    const visualOriginal = ['application/pdf', 'image/png', 'image/jpeg'].includes(doc.mimeType)
      && /^[a-f0-9]{64}$/i.test(doc.sha256 ?? '') && Number.isInteger(doc.byteLength) && doc.byteLength > 0;
    if (typeof doc.text !== 'string' || (!nonempty(doc.text) && !visualOriginal)) throw new FactReviewError('Add source text or a fingerprinted original PDF / photo before assigning this evidence.', 'document_text');
    doc.name = nonempty(doc.name) ? doc.name : doc.id;
    doc.kind ??= 'supporting';
    doc.received ??= true;
    doc.synthetic ??= false;
    if (!DOCUMENT_ROLES.includes(doc.kind) || (doc.roles !== undefined
      && (!Array.isArray(doc.roles) || doc.roles.some(role => !DOCUMENT_ROLES.includes(role))))) {
      throw new FactReviewError('Assign document roles from the DockProof evidence list.', 'document_role');
    }
    if (doc.roles) doc.roles = [...new Set(doc.roles)];
    if (doc.pages && (!Array.isArray(doc.pages) || doc.pages.some(page => !Number.isInteger(page.page) || page.page < 1
      || !Number.isInteger(page.start) || !Number.isInteger(page.end) || page.start < 0 || page.end < page.start || page.end > doc.text.length))) {
      throw new FactReviewError('Document pages need valid page numbers and exact text bounds.', 'document_pages');
    }
    if (JSON.stringify(previous) === JSON.stringify(doc)) continue;
    changes.push({ documentId: doc.id, kind: doc.kind, roles: documentRoles(doc),
      previousSourceFingerprint: previous ? evidenceFingerprint(previous.text) : null,
      sourceFingerprint: evidenceFingerprint(doc.text), sha256: doc.sha256 ?? null,
      action: previous ? 'replace' : 'add' });
    if (index >= 0) next.documents[index] = doc;
    else next.documents.push(doc);
  }
  if (changes.length) {
    const previousReview = next.decisions.review;
    next.decisions.review = null;
    next.events.push({ sequence: next.events.length + 1, action: 'add_documents',
      at: new Date().toISOString(), documents: changes,
      ...(previousReview ? { reviewReset: true, previousReview } : {}) });
  }
  return next;
}

export function selectCandidate(state, candidate, { reason, reviewer } = {}) {
  const normalized = normalizeCandidate(candidate, state.documents);
  const doc = state.documents.find(item => item.id === normalized.document_id);
  if (doc.received !== true) throw new FactReviewError('Receive the source document before selecting this fact.', 'document_unreceived');
  const next = clone(state);
  next.shipment ??= {};
  next.facts ??= {};
  next.facts.provenance ??= {};
  next.decisions ??= { demandCents: null, review: null };
  next.events ??= [];
  const definition = fieldByKey.get(normalized.field);
  const previousValue = fieldValue(next, normalized.field);
  const previousSource = next.facts.provenance[normalized.field];
  const selectedAt = new Date().toISOString();
  const selectedBy = String(reviewer ?? 'Shipper reviewer');
  const history = clone(previousSource?.history ?? []);
  if (previousSource) {
    const previousSelection = clone(previousSource);
    delete previousSelection.history;
    history.push({ ...previousSelection, value: previousValue, replacedAt: selectedAt,
      replacedBy: selectedBy, ...(reason ? { replacementReason: String(reason) } : {}) });
  }
  const provenance = { ...normalized.citation, field: normalized.field, candidateId: normalized.id,
    value: normalized.value, method: normalized.method, selected: true,
    reviewer: selectedBy, selectedAt,
    sourceFingerprint: normalized.sourceFingerprint, sourceSha256: normalized.sourceSha256,
    ...(reason ? { reason: String(reason) } : {}), history };
  (definition.group === 'shipment' ? next.shipment : next.facts)[normalized.field] = normalized.value;
  next.facts.provenance[normalized.field] = provenance;
  const previousReview = next.decisions.review;
  next.decisions.review = null;
  next.events.push({ sequence: next.events.length + 1, action: 'select_fact', field: normalized.field,
    value: normalized.value, previousValue, candidateId: normalized.id, documentId: normalized.document_id,
    citation: normalized.citation, method: normalized.method, reviewer: selectedBy, at: selectedAt,
    ...(reason ? { reason: String(reason) } : {}),
    ...(previousReview ? { reviewReset: true, previousReview } : {}) });
  return next;
}

/** The review gate checks the selected value, current text and original file identity. */
export function fieldSelectionStatus(state, key) {
  const value = fieldValue(state, key);
  const ref = state?.facts?.provenance?.[key];
  if (value === null) return { valid: false, code: 'value_required', detail: 'Select a documented value.' };
  if (!ref?.selected || !ref.candidateId || !ref.sourceFingerprint || !Number.isInteger(ref.start) || !Number.isInteger(ref.end)) {
    return { valid: false, code: 'selection_required', detail: 'Select this field from an exact source quotation.', documentId: ref?.documentId };
  }
  if (ref.value !== value) return { valid: false, code: 'value_changed', detail: 'The value changed. Select its supporting source again.', documentId: ref.documentId };
  const doc = state.documents?.find(item => item.id === ref.documentId);
  if (doc?.received !== true) return { valid: false, code: 'document_unreceived', detail: 'Receive the selected source document.', documentId: ref.documentId };
  if ((doc.sha256 ?? null) !== (ref.sourceSha256 ?? null)) {
    return { valid: false, code: 'source_changed', detail: 'The original file changed. Review and select its current source.', documentId: ref.documentId };
  }
  try {
    const normalized = normalizeCandidate({ field: key, value, document_id: ref.documentId, quote: ref.quote,
      citation: ref, sourceFingerprint: ref.sourceFingerprint, method: ref.method }, state.documents);
    if (normalized.id !== ref.candidateId) return { valid: false, code: 'selection_changed',
      detail: 'The selection changed. Choose the current value and quotation again.', documentId: ref.documentId };
    return { valid: true, code: 'selected', documentId: ref.documentId, citation: normalized.citation };
  } catch (error) {
    return { valid: false, code: error.code ?? 'citation_mismatch', detail: error.message, documentId: ref.documentId };
  }
}
