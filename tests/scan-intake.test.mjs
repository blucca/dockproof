import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readDocument, pageMap } from '../web/core/document-intake.mjs';
import { rasterSize, OCR_LIMITS } from '../web/core/local-ocr.mjs';
import { addDocuments, createEmptyCase, normalizeCandidate, selectCandidate } from '../web/core/fact-review.mjs';
import { applyAction, createPacket } from '../web/core/case-engine.mjs';
import { readFile } from 'node:fs/promises';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');

test('PNG visual evidence preserves empty text, original hash, roles, and export metadata', async () => {
  const doc = await readDocument(new File([png], 'damage.png', { type:'image/png' }), { id:'damage-photo', kind:'damage_photo' });
  assert.equal(doc.text, '');
  assert.equal(doc.sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(doc.mimeType, 'image/png');
  assert.deepEqual(doc.image, { width:1, height:1, mimeType:'image/png' });
  assert.equal(doc.pages[0].extraction.method, 'original_image');
  assert.equal(doc.extraction.method, 'image_original');
  const empty = addDocuments(createEmptyCase(), [doc]);
  assert.equal(empty.documents[0].roles[0], 'damage_photo');
  assert.throws(() => normalizeCandidate({field:'affectedPieceId', value:'B4', document_id:doc.id, quote:'B4'}, [doc]), {code:'document_missing'});
  assert.throws(() => addDocuments(createEmptyCase(), [{ ...doc, sha256:null }]), { code:'document_text' });
  let state = JSON.parse(await readFile(new URL('../web/data/sample-case.json', import.meta.url), 'utf8'));
  state = applyAction(state, 'receive_weight'); state = applyAction(state, 'receive_rate');
  state = addDocuments(state, [doc]);
  state = applyAction(state, 'confirm_review', { today:'2026-10-10', reviewer:'Fixture reviewer' });
  const packet = createPacket(state, { today:'2026-10-10' });
  const attached = packet.manifest.documents.find(record => record.id === doc.id);
  assert.equal(attached.textKind, 'visual_attachment');
  assert.equal(attached.sha256, doc.sha256);
  assert.equal(attached.pages[0].extraction.method, 'original_image');
});

test('mixed selectable / OCR pages retain exact page-local quotation spans through selection', () => {
  const texts = ['BOL\nTotal weight 600 lb.', 'OCR RECEIPT\nAffected piece B4 weighs 150 lb.'];
  const doc = { id:'mixed-pdf', name:'Mixed BOL.pdf', kind:'weight_sheet', text:texts.join('\n\n'),
    pages:pageMap(texts, [{ method:'pdfjs_selectable_text', derived:false }, { method:'tesseract_ocr', derived:true }]) };
  const candidate = normalizeCandidate({field:'affectedWeightLb', value:'150', document_id:doc.id, quote:'Affected piece B4 weighs 150 lb.', page:2}, [doc]);
  assert.equal(candidate.citation.page, 2); assert.equal(candidate.citation.line, 2);
  assert.equal(doc.text.slice(candidate.citation.start, candidate.citation.end), candidate.quote);
  assert.equal(doc.pages[1].extraction.derived, true);
  const state = selectCandidate(addDocuments(createEmptyCase(), [doc]), candidate);
  assert.equal(state.facts.affectedWeightLb, 150);
  assert.equal(state.facts.provenance.affectedWeightLb.page, 2);
});

test('OCR raster sizes stay inside pixel and edge budgets for portrait, panorama, and high-resolution inputs', () => {
  for (const [width,height,scale] of [[612,792,200/72], [20000,200,1], [6000,4000,1], [1,100000,1]]) {
    const size=rasterSize(width,height,scale);
    assert.ok(size.width*size.height <= OCR_LIMITS.maxPixels);
    assert.ok(Math.max(size.width,size.height) <= OCR_LIMITS.maxEdge);
  }
});
