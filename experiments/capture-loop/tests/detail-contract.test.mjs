import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDetailReviewEligible } from '../detail-contract.mjs';

const matched = () => ({ status: 'matched', comparison: { fieldAreaRatio: 4 },
  field: { view: { file: 'detail-field.png' }, sourceQuadPx: [[20, 30], [90, 30], [90, 50], [20, 50]] } });

test('a registered, covered field with more native samples opens separate review', () => {
  assert.equal(assertDetailReviewEligible(matched()), true);
});

test('detail recovery statuses and missing sampling or crop stop review', () => {
  for (const status of ['needs_overlap', 'target_out_of_frame', 'needs_more_detail']) {
    assert.throws(() => assertDetailReviewEligible({ ...matched(), status }));
  }
  for (const fieldAreaRatio of [undefined, NaN, 1, 1.43]) {
    assert.throws(() => assertDetailReviewEligible({ ...matched(), comparison: { fieldAreaRatio } }));
  }
  assert.throws(() => assertDetailReviewEligible({ ...matched(), field: null }));
});
