import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, validateExtraction } from '../src/nebius.mjs';

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
