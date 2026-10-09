import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTRACTION_SCHEMA, FACT_FIELDS, MAX_OUTPUT_TOKENS, extractFacts, validateDocuments, validateExtraction } from '../src/nebius.mjs';
import { FIELD_DEFINITIONS, selectCandidate, addDocuments, createEmptyCase } from '../web/core/fact-review.mjs';
import { SUPPORTED_CLASSES } from '../web/core/case-engine.mjs';

const documents = [{ id:'weight', text:'Crate C3 actual gross weight: 200 lb.' }];
const response = { facts:[{ field:'affectedWeightLb', value:'200', document_id:'weight', quote:'Crate C3 actual gross weight: 200 lb.' }], questions:[] };

test('structured extraction sends the NVIDIA model and preserves exact evidence spans', async () => {
  let sent;
  let reserved = false;
  const result = await extractFacts(documents, { apiKey:'test-only', reserveBudget:({model,request}) => {
    assert.equal(model, request.model);
    assert.equal(request.max_tokens, MAX_OUTPUT_TOKENS);
    reserved = true;
    return { requestJson:JSON.stringify(request) };
  }, fetchImpl:async (url,init) => {
    assert.equal(reserved, true);
    sent = { url, ...JSON.parse(init.body) };
    return { ok:true, json:async () => ({ id:'test-response', choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}], usage:{total_tokens:12} }) };
  } });
  assert.match(sent.url, /tokenfactory.*chat\/completions$/);
  assert.equal(sent.model,'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(sent.response_format.json_schema.strict,true);
  assert.deepEqual(sent.response_format.json_schema.schema.properties.fields.properties.affectedWeightLb.properties.candidates.items.properties.document_id.enum, ['weight']);
  assert.equal(result.extraction.facts[0].citation.start,0);
  assert.equal(result.execution.exactCitations,1);
});

test('text extraction keeps empty original attachments outside model input', () => {
  const photo = { id:'photo', text:'', sha256:'a'.repeat(64), mimeType:'image/jpeg' };
  assert.equal(validateDocuments([...documents, photo]).length, 1);
  assert.throws(() => validateDocuments([photo]), { code:'document_text' });
});

test('an exhausted credit budget stops the HTTP request', async () => {
  let sent = false;
  await assert.rejects(() => extractFacts(documents, { apiKey:'test-only',
    reserveBudget:() => { throw Object.assign(new Error('Approved budget exhausted.'), {code:'budget_reached'}); },
    fetchImpl:async () => { sent = true; },
  }), {code:'budget_reached'});
  assert.equal(sent, false);
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

test('bounded field slots retain typed values and exact source quotes', () => {
  const raw = { fields:{ affectedWeightLb:{ candidates:[{value:200,document_id:'weight',quote:documents[0].text,page:1}], question:null } } };
  const result = validateExtraction(raw,documents);
  assert.equal(result.facts[0].value,200);
  assert.equal(result.facts[0].citation.start,0);
  assert.equal(result.facts[0].citation.end,documents[0].text.length);
  assert.deepEqual(result.questions,[]);
  const repeated = {fields:{affectedWeightLb:{...raw.fields.affectedWeightLb,candidates:Array(4).fill(raw.fields.affectedWeightLb.candidates[0])}}};
  assert.throws(() => validateExtraction(repeated,documents),{code:'response_shape'});
});

test('carrier claim receipt candidates require an explicit receipt acknowledgement', () => {
  const docs = [{ id:'inspection', text:'Inspection date: 2026-10-08' },
    { id:'ack', text:'XPO received this freight claim on 2026-10-09.' }];
  const fact = { field:'claimReceivedDate', value:'2026-10-08', document_id:'inspection', quote:docs[0].text };
  const inspection = validateExtraction({ facts:[fact], questions:[] }, docs);
  assert.equal(inspection.facts.length, 0);
  assert.equal(inspection.omitted[0].field, 'claimReceivedDate');
  assert.equal(inspection.questions[0].field, 'claimReceivedDate');
  const acknowledgement = validateExtraction({ facts:[{ ...fact, value:'2026-10-09', document_id:'ack', quote:docs[1].text }], questions:[] }, docs);
  assert.equal(acknowledgement.facts[0].value, '2026-10-09');
  assert.equal(acknowledgement.questions.length, 0);
});

test('freight-class extraction retains supported quoted numbers and preserves other facts', () => {
  assert.deepEqual(EXTRACTION_SCHEMA.properties.fields.properties.freightClass.properties.candidates.items.properties.value,
    { type:'string', enum:SUPPORTED_CLASSES });
  const cases = [
    { value:', no quotes found, maybe missing', quote:'Freight class: 70', valid:false },
    { value:'70', quote:'Freight class: 70.', valid:true },
    { value:'77.5', quote:'Freight class: 77.5.', valid:true },
    { value:'60', quote:'Freight class: 70', valid:false },
    { value:'70', quote:'Freight class: 170', valid:false },
    { value:'70', quote:'Freight class: 70.5', valid:false },
  ];
  for (const { value, quote, valid } of cases) {
    const docs = [...documents, { id:'class', text:quote }];
    const fact = { field:'freightClass', value, document_id:'class', quote };
    const result = validateExtraction({ facts:[fact, response.facts[0]], questions:[] }, docs);
    assert.equal(result.facts.some(candidate => candidate.field === 'freightClass'), valid, value + ' / ' + quote);
    assert.equal(result.facts.find(candidate => candidate.field === 'affectedWeightLb').value, 200);
    if (valid) {
      assert.equal(result.facts.find(candidate => candidate.field === 'freightClass').value, value);
      assert.equal(result.omitted, undefined);
      assert.deepEqual(result.questions, []);
    } else {
      assert.equal(result.omitted[0].field, 'freightClass');
      assert.equal(result.omitted[0].value, value);
      assert.deepEqual(result.questions.map(question => question.field), ['freightClass']);
      assert.match(result.questions[0].question, /original.*Record a sourced value/);
    }
  }
  const docs = [...documents, { id:'class', text:'Freight class: 70' }];
  const invalidClass = { field:'freightClass', value:'missing', document_id:'class', quote:docs[1].text };
  assert.throws(() => validateExtraction({ facts:[invalidClass, { ...response.facts[0], quote:'Weight: 999 lb.' }], questions:[] }, docs),
    { code:'citation_mismatch' });
  assert.throws(() => validateExtraction({ facts:[{ ...invalidClass, document_id:'absent' }], questions:[] }, docs),
    { code:'document_missing' });
});
