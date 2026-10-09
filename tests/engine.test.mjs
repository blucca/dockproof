import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addCalendarMonths, applyAction, createPacket, evaluateCase } from '../web/core/case-engine.mjs';

const template = JSON.parse(await readFile(new URL('../web/data/sample-case.json', import.meta.url), 'utf8'));
const today = '2026-10-09';
const sample = () => structuredClone(template);
const evaluate = state => evaluateCase(state, { today });
const completeEvidence = () => applyAction(applyAction(sample(), 'receive_weight'), 'receive_rate');
const reviewed = () => applyAction(completeEvidence(), 'confirm_review', { today, reviewer: 'Demo shipper' });

test('initial case exposes the two evidence gaps and retains the original $5,000 worksheet', () => {
  const state = sample();
  const result = evaluate(state);
  assert.equal(result.status, 'needs_evidence');
  assert.equal(result.actualLossCents, 88000);
  assert.equal(result.referenceLimitCents, null);
  assert.equal(result.recommendedDemandCents, null);
  assert.equal(result.draftDemandCents, 500000);
  assert.equal(state.facts.worksheetWeightLb, state.shipment.totalWeightLb);
  assert.deepEqual(result.issues.filter(issue => issue.severity === 'blocking').map(issue => issue.id), [
    'missing_weight_sheet', 'missing_rate_confirmation',
  ]);
  assert.throws(() => applyAction(state, 'confirm_review', { today }), /Review stopped/);
  assert.throws(() => createPacket(state, { today }), /Packet export stopped/);
});

test('piece evidence repairs the weight; discount, salvage, reference limit and demand stay distinct', () => {
  const initial = sample();
  const original = JSON.stringify(initial);
  const withWeight = applyAction(initial, 'receive_weight');
  assert.equal(JSON.stringify(initial), original);
  assert.equal(withWeight.facts.affectedWeightLb, 200);
  assert.equal(evaluate(withWeight).referenceLimitCents, null);
  const state = applyAction(withWeight, 'receive_rate');
  const result = evaluate(state);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.canConfirm, true);
  assert.equal(result.netInvoiceCents, 108000);
  assert.equal(result.actualLossCents, 88000);
  assert.equal(result.referenceLimitCents, 100000);
  assert.equal(result.recommendedDemandCents, 88000);
  assert.equal(result.draftDemandCents, 88000);
  assert.equal(result.originalDemandCents, 500000);
  assert.equal(result.math.find(row => row.id === 'trade_discount').valueCents, 12000);
  assert.equal(result.checks.find(check => check.id === 'affected_weight').status, 'pass');
  for (const row of result.math) {
    for (const ref of row.evidence) {
      assert.ok(state.documents.find(doc => doc.id === ref.documentId).text.includes(ref.quote), ref.quote);
    }
  }
  assert.throws(() => createPacket(state, { today }), /Confirm the current shipper review/);
});

test('review unlocks a complete synthetic packet with identity, liability assertion and specific amount', () => {
  const state = reviewed();
  assert.equal(evaluate(state).status, 'ready');
  const packet = createPacket(state, { today });
  const cover = packet.files.find(file => file.name === '01-claim-cover-letter.txt').content;
  assert.match(cover, /SYNTHETIC EXAMPLE/);
  assert.match(cover, /PRO: SYN-XPO-0930-048/);
  assert.match(cover, /asserts that XPO is liable/);
  assert.match(cover, /SPECIFIC AMOUNT CLAIMED: \$880\.00 USD/);
  assert.match(cover, /Tariff reference limit: \$1,000\.00/);
  assert.match(cover, /awaiting submission to XPO/);
  assert.equal(packet.summary.requestedAmountCents, 88000);
  assert.equal(packet.summary.filingStatus, 'awaiting_carrier_submission');
  assert.equal(packet.manifest.documents.length, 7);
  assert.equal(packet.files.length, 13);
  assert.equal(new Set(packet.files.map(file => file.name)).size, packet.files.length);
  for (const doc of packet.manifest.documents) {
    const exported = packet.files.find(file => file.name === doc.file);
    assert.equal(exported.content, state.documents.find(item => item.id === doc.id).text + '\n');
  }
  assert.match(packet.files.find(file => file.name === '04-official-sources.txt').content, /CNWY_199-AK\.3_Eff\._08\.17\.2026\.pdf/);
  assert.equal(JSON.parse(packet.files.find(file => file.name === 'document-manifest.json').content).files.length, 13);
});

test('the spot-quote example changes the evidence and yields a $200 demand after a fresh review', () => {
  const original = reviewed();
  const spot = applyAction(original, 'set_service', { service: 'spot_quote' });
  const result = evaluate(spot);
  assert.equal(original.facts.serviceType, 'standard_tariff');
  assert.equal(spot.decisions.review, null);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.actualLossCents, 88000);
  assert.equal(result.referenceLimitCents, 20000);
  assert.equal(result.draftDemandCents, 20000);
  assert.match(spot.documents.find(doc => doc.id === 'rate_confirmation').text, /Spot quote reference: \$1\.00/);
  assert.ok(spot.documents.find(doc => doc.id === 'rate_confirmation').text.includes(spot.facts.provenance.serviceType.quote));
  const confirmed = applyAction(spot, 'confirm_review', { today });
  assert.equal(createPacket(confirmed, { today }).summary.requestedAmountCents, 20000);
});

test('calendar-month deadlines clamp at month end and track the carrier receipt window', () => {
  assert.equal(addCalendarMonths('2026-05-31', 9), '2027-02-28');
  assert.equal(addCalendarMonths('2027-05-31', 9), '2028-02-29');
  assert.equal(addCalendarMonths('2026-01-31', 9), '2026-10-31');
  assert.throws(() => addCalendarMonths('2026-02-30', 9), /valid YYYY-MM-DD/);
  const state = reviewed();
  const deadline = evaluate(state).deadlines.find(item => item.id === 'carrier_receipt_deadline');
  assert.equal(deadline.date, '2027-06-30');
  assert.equal(evaluateCase(state, { today: '2027-06-30' }).status, 'ready');
  const expired = evaluateCase(state, { today: '2027-07-01' });
  assert.equal(expired.status, 'needs_review');
  assert.ok(expired.issues.some(issue => issue.id === 'claim_deadline_elapsed'));
  assert.throws(() => createPacket(state, { today: '2027-07-01' }), /elapsed filing deadline/);
});

test('negative and excessive monetary inputs stop review; a supported lower demand can be confirmed', () => {
  const state = completeEvidence();
  for (const [field, value] of [['salvageCents', -1], ['invoiceGrossCents', -100], ['affectedWeightLb', -200], ['tradeDiscountBps', 10001]]) {
    assert.throws(() => applyAction(state, 'set_value', { field, value }));
  }
  const invalid = structuredClone(state);
  invalid.facts.salvageCents = -1;
  assert.equal(evaluate(invalid).canConfirm, false);
  assert.ok(evaluate(invalid).issues.some(issue => issue.id === 'invalid_salvageCents'));
  assert.throws(() => applyAction(invalid, 'confirm_review', { today }), /Review stopped/);
  const excessive = applyAction(state, 'set_value', { field: 'demandCents', value: 95000 });
  assert.equal(evaluate(excessive).canConfirm, false);
  assert.ok(evaluate(excessive).issues.some(issue => issue.id === 'draft_demand_out_of_range'));
  const lower = applyAction(state, 'set_value', { field: 'demandCents', value: 85000 });
  assert.equal(evaluate(lower).recommendedDemandCents, 88000);
  assert.equal(createPacket(applyAction(lower, 'confirm_review', { today }), { today }).summary.requestedAmountCents, 85000);
});

test('fact and document changes invalidate the saved review, including direct mutations', () => {
  const state = reviewed();
  const edited = applyAction(state, 'set_value', { field: 'salvageCents', value: 25000 });
  assert.equal(edited.decisions.review, null);
  assert.equal(evaluate(edited).status, 'needs_review');
  const directlyEdited = structuredClone(state);
  directlyEdited.facts.salvageCents = 25000;
  assert.equal(evaluate(directlyEdited).reviewValid, false);
  assert.throws(() => createPacket(directlyEdited, { today }), /Confirm the current shipper review/);
  const documentEdited = structuredClone(state);
  documentEdited.documents[0].text += '\nL09 Warehouse annotation.';
  assert.equal(evaluate(documentEdited).reviewValid, false);
  const wrongPiece = structuredClone(state);
  wrongPiece.facts.affectedWeightLb = 1000;
  assert.ok(evaluate(wrongPiece).issues.some(issue => issue.id === 'weight_document_conflict'));
  assert.equal(evaluate(wrongPiece).referenceLimitCents, null);
});

test('out-of-scope cases route to manual review with the standard calculation closed', () => {
  for (const change of [
    state => { state.shipment.originCountry = 'CA'; },
    state => { state.facts.goodsCondition = 'used'; },
    state => { state.facts.freightClass = '77'; },
    state => { state.facts.arrangedBy = 'broker'; },
    state => { state.facts.deliveryDamage = 'concealed'; },
  ]) {
    const state = completeEvidence();
    change(state);
    const result = evaluate(state);
    assert.equal(result.status, 'needs_review');
    assert.equal(result.manualReviewRequired, true);
    assert.equal(result.referenceLimitCents, null);
    assert.equal(result.canConfirm, false);
    assert.throws(() => applyAction(state, 'confirm_review', { today }), /manual review/);
  }
});
