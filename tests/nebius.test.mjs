import test from 'node:test';
import assert from 'node:assert/strict';
import { FACT_FIELDS, extractFacts, validateExtraction } from '../src/nebius.mjs';
import { FIELD_DEFINITIONS, selectCandidate, addDocuments, createEmptyCase } from '../web/core/fact-review.mjs';

const documents = [{ id:'weight', text:'Crate C3 actual gross weight: 200 lb.' }];
const response = { facts:[{ field:'affectedWeightLb', value:'200', document_id:'weight', quote:'Crate C3 actual gross weight: 200 lb.' }], questions:[] };

test('structured extraction sends the NVIDIA model and preserves exact evidence spans', async () => {
  let sent;
  const result = await extractFacts(documents, { apiKey:'test-only', fetchImpl:async (url,init) => {
    sent = { url, ...JSON.parse(init.body) };
    return { ok:true, json:async () => ({ id:'test-response', choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}], usage:{total_tokens:12} }) };
  } });
  assert.match(sent.url, /tokenfactory.*chat\/completions$/);
  assert.equal(sent.model,'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(sent.response_format.json_schema.strict,true);
  assert.equal(result.extraction.facts[0].citation.start,0);
  assert.equal(result.execution.exactCitations,1);
});

test('an invented document quote stops extraction review', () => {
  assert.throws(() => validateExtraction({facts:[{...response.facts[0],quote:'Weight: 1000 lb.'}],questions:[]},documents), {code:'citation_mismatch'});
});

test('canonical model fields reach typed selections with page-aware quotation resolution', () => {
  assert.deepEqual(FACT_FIELDS, FIELD_DEFINITIONS.map(field => field.key));
  const quote = 'Excess-value agreement: false.';
  const text = quote + '\n\n' + quote;
  const docs = [{ id: 'booking-file-31', kind: 'rate_confirmation', text, received: true, pages: [
    { page: 1, start: 0, end: quote.length }, { page: 2, start: quote.length + 2, end: text.length },
  ] }];
  const fact = { field: 'excessValueAgreement', value: 'false', document_id: docs[0].id, quote };
  assert.throws(() => validateExtraction({ facts: [fact], questions: [] }, docs), { code: 'citation_ambiguous' });
  const extraction = validateExtraction({ facts: [{ ...fact, page: 2 }], questions: [] }, docs);
  assert.equal(extraction.facts[0].value, false);
  assert.equal(extraction.facts[0].method, 'nemotron');
  assert.equal(extraction.facts[0].citation.page, 2);
  const state = selectCandidate(addDocuments(createEmptyCase(), docs), extraction.facts[0]);
  assert.equal(state.facts.excessValueAgreement, false);
  assert.equal(state.facts.provenance.excessValueAgreement.documentId, docs[0].id);
  assert.equal(state.facts.provenance.excessValueAgreement.method, 'nemotron');
});
