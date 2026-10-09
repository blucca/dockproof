import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_DEFINITIONS, addDocuments, createEmptyCase, fieldValue, normalizeCandidate, selectCandidate,
} from '../web/core/fact-review.mjs';
import { applyAction, createPacket, evaluateCase } from '../web/core/case-engine.mjs';

const today = '2026-10-09';
const evaluate = state => evaluateCase(state, { today });
const confirm = state => applyAction(state, 'confirm_review', { today, reviewer: 'Test reviewer' });

// Constructed test records exercise the same empty-case path as user-supplied documents.
function intakeFixture() {
  const values = {
    carrier: 'XPO', mode: 'LTL', originCountry: 'US', destinationCountry: 'US',
    originState: 'OH', destinationState: 'VA', shipper: 'Test shipper', consignee: 'Test consignee',
    pro: 'TEST-XPO-B4', bol: 'TEST-BOL-B4', pickupDate: '2026-10-05', deliveryDate: '2026-10-07',
    totalPieces: 4, totalWeightLb: 600, affectedPieceId: 'B4',
    invoiceGrossCents: 200000, tradeDiscountBps: 500, allowanceCents: 0, salvageCents: 17500,
    affectedWeightLb: 150, goodsCondition: 'new', commodityScope: 'ordinary', arrangedBy: 'shipper',
    excessValueAgreement: false, deliveryDamage: 'visible_noted', freightClass: '70', serviceType: 'standard_tariff',
  };
  const groups = [
    { id: 'upload-bol-7', roles: ['bill_of_lading', 'delivery_receipt'],
      fields: ['carrier', 'mode', 'originCountry', 'destinationCountry', 'originState', 'destinationState',
        'shipper', 'consignee', 'pro', 'bol', 'pickupDate', 'totalPieces', 'totalWeightLb', 'freightClass'],
      secondPage: ['deliveryDate', 'affectedPieceId', 'deliveryDamage'] },
    { id: 'invoice-39', roles: ['commercial_invoice'], fields: ['invoiceGrossCents', 'tradeDiscountBps', 'allowanceCents'] },
    { id: 'inspection-6', roles: ['inspection_record'], fields: ['salvageCents'] },
    { id: 'packing-11', roles: ['weight_sheet'], fields: ['affectedWeightLb'] },
    { id: 'booking-22', roles: ['rate_confirmation'],
      fields: ['goodsCondition', 'commodityScope', 'arrangedBy', 'excessValueAgreement', 'serviceType'] },
  ];
  const candidates = [];
  const documents = groups.map(group => {
    const makeLine = field => field + ': ' + values[field];
    const first = group.fields.map(makeLine).join('\n');
    const second = group.secondPage?.map(makeLine).join('\n');
    const text = first + (second ? '\n\n' + second : '');
    const pages = [{ page: 1, start: 0, end: first.length }];
    if (second) pages.push({ page: 2, start: first.length + 2, end: text.length });
    for (const field of [...group.fields, ...(group.secondPage ?? [])]) candidates.push({
      field, value: String(values[field]), document_id: group.id, quote: makeLine(field), method: 'manual',
    });
    return { id: group.id, name: group.id + '.txt', originalName: group.id + '.txt', mimeType: 'text/plain',
      roles: group.roles, kind: group.roles[0], text, pages, received: true, synthetic: false };
  });
  let state = addDocuments(createEmptyCase({ id: 'intake-b4-test' }), documents);
  for (const candidate of candidates) state = selectCandidate(state, candidate, { reviewer: 'Test reviewer' });
  return { state, documents, candidates };
}

test('an empty document case reaches a B4 source-linked amount and packet with arbitrary IDs and combined roles', () => {
  const blank = createEmptyCase({ id: 'blank-test' });
  assert.equal(blank.synthetic, false);
  assert.ok(FIELD_DEFINITIONS.every(field => fieldValue(blank, field.key) === null));
  assert.deepEqual(blank.facts.provenance, {});
  assert.equal(evaluate(blank).canConfirm, false);
  const { state, candidates } = intakeFixture();
  assert.equal(state.synthetic, false);
  assert.equal(state.facts.affectedPieceId, 'B4');
  assert.equal(state.facts.excessValueAgreement, false);
  assert.ok(FIELD_DEFINITIONS.filter(field => field.required).every(field => state.facts.provenance[field.key].selected));
  assert.equal(normalizeCandidate(candidates[0], state.documents).id, normalizeCandidate(candidates[0], state.documents).id);
  const result = evaluate(state);
  assert.equal(result.actualLossCents, 172500);
  assert.equal(result.referenceLimitCents, 75000);
  assert.equal(result.recommendedDemandCents, 75000);
  assert.equal(result.canConfirm, true);
  assert.equal(result.originalDemandCents, null);
  assert.throws(() => createPacket(state, { today }), /Confirm/);
  const packet = createPacket(confirm(state), { today });
  assert.equal(packet.summary.synthetic, false);
  assert.equal(packet.summary.requestedAmountCents, 75000);
  assert.equal(packet.manifest.documents.length, 5);
  assert.deepEqual(packet.manifest.documents[0].roles, ['bill_of_lading', 'delivery_receipt']);
  assert.equal(packet.manifest.selections.deliveryDate.page, 2);
  assert.ok(packet.manifest.selections.deliveryDate.globalLine > packet.manifest.selections.deliveryDate.line);
  assert.ok(packet.manifest.documents.every(doc => doc.id !== doc.kind));
  assert.equal(packet.manifest.documents[0].originalName, 'upload-bol-7.txt');
  const audit = JSON.parse(packet.files.find(file => file.name === '03-valuation-audit.json').content);
  assert.equal(audit.facts.provenance.deliveryDate.documentId, 'upload-bol-7');
  assert.equal(audit.events.filter(event => event.action === 'select_fact').length, candidates.length);
  const cover = packet.files.find(file => file.name === '01-claim-cover-letter.txt').content;
  assert.match(cover, /SPECIFIC AMOUNT CLAIMED: \$750\.00 USD/);
  assert.match(cover, /Retain the damaged goods and packaging/);
  assert.doesNotMatch(cover, /C3|Invoice: null|Original worksheet|SYNTHETIC EXAMPLE/);
  assert.doesNotMatch(packet.files.find(file => file.name === '02-valuation-audit.csv').content, /Original worksheet/);
});

test('identity and independent service-scope selections gate confirmation; changed values reconnect to evidence', () => {
  const { state } = intakeFixture();
  for (const field of ['pro', 'commodityScope', 'arrangedBy', 'excessValueAgreement']) {
    const missing = structuredClone(state);
    delete missing.facts.provenance[field];
    assert.equal(evaluate(missing).canConfirm, false, field);
    assert.ok(evaluate(missing).issues.some(issue => issue.id === 'source_' + field));
  }
  const changed = structuredClone(state);
  changed.facts.salvageCents = 15000;
  assert.equal(evaluate(changed).actualLossCents, null);
  assert.equal(evaluate(changed).canConfirm, false);
  assert.throws(() => confirm(changed), /Review stopped/);
  assert.throws(() => applyAction(state, 'set_value', { field: 'salvageCents', value: 15000 }), /source-linked/);
});

test('conflict selection retains the previous value and citation, resets review, and exports selection history', () => {
  const { state } = intakeFixture();
  const correction = { id: 'received-correction-8', name: 'Weight correction.txt', kind: 'weight_sheet',
    text: 'Affected piece B4 gross weight: 160 lb.', received: true, synthetic: false };
  const received = addDocuments(confirm(state), [correction]);
  assert.equal(received.decisions.review, null);
  const prior = confirm(received);
  const changed = selectCandidate(prior, {
    field: 'affectedWeightLb', value: '160', document_id: correction.id,
    quote: correction.text, method: 'manual',
  }, { reason: 'Dispatch supplied the corrected packing weight.', reviewer: 'Shipper reviewer' });
  assert.equal(prior.facts.affectedWeightLb, 150);
  assert.equal(changed.decisions.review, null);
  assert.equal(changed.events.at(-1).previousValue, 150);
  assert.equal(changed.events.at(-1).reviewReset, true);
  assert.equal(changed.facts.provenance.affectedWeightLb.history[0].documentId, 'packing-11');
  assert.equal(changed.facts.provenance.affectedWeightLb.history[0].value, 150);
  assert.equal(evaluate(changed).referenceLimitCents, 80000);
  const packet = createPacket(confirm(changed), { today });
  assert.equal(packet.manifest.selections.affectedWeightLb.value, 160);
  assert.equal(packet.manifest.selections.affectedWeightLb.history[0].quote, 'affectedWeightLb: 150');
  assert.equal(packet.manifest.selections.affectedWeightLb.method, 'manual');
});

test('role updates preserve source metadata and withdraw review; replacement text requires fresh selections', () => {
  const original = confirm(intakeFixture().state);
  const reassigned = addDocuments(original, [{ id: 'booking-22', roles: ['supporting'] }]);
  assert.equal(reassigned.decisions.review, null);
  assert.equal(reassigned.documents.find(doc => doc.id === 'booking-22').originalName, 'booking-22.txt');
  assert.ok(evaluate(reassigned).issues.some(issue => issue.id === 'missing_rate_confirmation'));
  const doc = original.documents.find(item => item.id === 'packing-11');
  const replacement = addDocuments(original, [{ id: doc.id, text: doc.text + '\nAdditional source note.' }]);
  assert.equal(replacement.decisions.review, null);
  assert.ok(evaluate(replacement).issues.some(issue => issue.id === 'source_affectedWeightLb'));
  assert.equal(evaluate(replacement).referenceLimitCents, null);
});

test('repeated quotations need an exact page or offset and preserve page-local and global lines', () => {
  const quote = 'Weight: 150 lb.';
  const first = 'First page 📦\n' + quote;
  const second = 'Second page\n' + quote;
  const text = first + '\n\n' + second;
  const documents = [{ id: 'two-pages', text, pages: [
    { page: 1, start: 0, end: first.length }, { page: 2, start: first.length + 2, end: text.length },
  ] }];
  const raw = { field: 'affectedWeightLb', value: '150', document_id: 'two-pages', quote };
  assert.throws(() => normalizeCandidate(raw, documents), { code: 'citation_ambiguous' });
  const candidate = normalizeCandidate({ ...raw, page: 2 }, documents);
  assert.equal(candidate.value, 150);
  assert.equal(candidate.citation.page, 2);
  assert.equal(candidate.citation.line, 2);
  assert.equal(candidate.citation.globalLine, 5);
  assert.equal(candidate.citation.start, text.lastIndexOf(quote));
  assert.equal(text.slice(candidate.citation.start, candidate.citation.end), quote);
  assert.throws(() => normalizeCandidate({ ...raw, start: 0 }, documents), { code: 'citation_mismatch' });
});
