import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assertFieldReviewEligible } from '../agent-contract.mjs';

const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const gls = read('../domain/after-repair.json').records
  .find(record => record.file === 'small-parcel.jpg').observation;
const blurred = read('../domain/prior-regression.json').records
  .find(record => record.file === 'synthetic-blurred.jpg').metrics;
const sample = changes => ({ ...structuredClone(gls), ...changes });
const withMetrics = changes => sample({ metrics: { ...gls.metrics, ...changes } });

test('recorded GLS measurement opens a separate field review', () => {
  assert.equal(gls.metrics.laplacianVariance, 340.928);
  assert.equal(assertFieldReviewEligible(gls), true);
});

test('recorded page blur requests sharper capture even with a four-corner view', () => {
  assert.equal(blurred.laplacianVariance, 0.453);
  assert.throws(() => assertFieldReviewEligible(withMetrics(blurred)), /Request a sharper capture/);
});

test('focus comparison includes the returned threshold boundary', () => {
  assert.equal(assertFieldReviewEligible(withMetrics({ laplacianVariance: 50 })), true);
  assert.throws(() => assertFieldReviewEligible(withMetrics({ laplacianVariance: 49.999 })), /sharper capture/);
  assert.throws(() => assertFieldReviewEligible(withMetrics({ laplacianVariance: 55, focusThreshold: 60 })), /sharper capture/);
});

test('incomplete geometry, view or frame-contact measurements keep review closed', () => {
  for (const changes of [
    { geometry: 'outline_missing' }, { geometry: undefined },
    { perspectiveView: null }, { perspectiveView: {} },
  ]) assert.throws(() => assertFieldReviewEligible(sample(changes)), /four-corner perspective view/);
  for (const touchesFrame of [true, undefined, 'false']) {
    assert.throws(() => assertFieldReviewEligible(withMetrics({ touchesFrame })), /clearance/);
  }
  assert.throws(() => assertFieldReviewEligible(sample({ metrics: undefined })), /clearance/);
  assert.throws(() => assertFieldReviewEligible(undefined), /four-corner perspective view/);
});

test('missing, nonnumeric and nonfinite focus measurements stop field review', () => {
  for (const laplacianVariance of [undefined, null, '340.928', NaN, Infinity, -1]) {
    assert.throws(() => assertFieldReviewEligible(withMetrics({ laplacianVariance })), /finite page focus/);
  }
  for (const focusThreshold of [undefined, null, '50', NaN, Infinity, 0, -1]) {
    assert.throws(() => assertFieldReviewEligible(withMetrics({ focusThreshold })), /finite focus threshold/);
  }
});
