import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readDocument, pdfTextLines, DOCUMENT_LIMITS } from '../web/core/document-intake.mjs';

test('UTF-8 intake hashes original bytes and maps normalized text using UTF-16 offsets', async () => {
  const original = '\uFEFFA\r\nB😀\rC\n';
  const file = new File([original], 'inspection.txt', { type: 'text/plain' });
  const document = await readDocument(file, { id: 'inspection', kind: 'inspection_record' });
  assert.equal(document.text, 'A\nB😀\nC\n');
  assert.equal(document.sha256, createHash('sha256').update(Buffer.from(original)).digest('hex'));
  assert.equal(document.byteLength, Buffer.byteLength(original));
  assert.equal(document.originalName, 'inspection.txt');
  assert.equal(document.synthetic, false);
  assert.deepEqual(document.roles, ['inspection_record']);
  assert.deepEqual(document.pages, [{ page: 1, start: 0, end: 8, lines: [
    { line: 1, globalLine: 1, start: 0, end: 1 },
    { line: 2, globalLine: 2, start: 2, end: 5 },
    { line: 3, globalLine: 3, start: 6, end: 7 },
    { line: 4, globalLine: 4, start: 8, end: 8 },
  ] }]);
});

test('PDF visible-row ordering retains content and inserts geometric whitespace', () => {
  const item = (str, x, y, width) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, dir: 'ltr' });
  assert.deepEqual(pdfTextLines([
    item('$2,000.00', 55, 680, 45), item('SYNTHETIC DEMO', 10, 700, 80),
    item('Invoice:', 10, 680, 40), item('B4', 160, 680, 10),
  ]), ['SYNTHETIC DEMO', 'Invoice: $2,000.00        B4']);
});

test('blank, binary, unsupported, and malformed UTF-8 sources receive actionable errors', async () => {
  for (const [name, content, type, code] of [
    ['blank.txt', ' \r\n', 'text/plain', 'empty_document'],
    ['binary.txt', 'A\0B', 'text/plain', 'binary_text'],
    ['photo.png', new Uint8Array([1, 2, 3]), 'image/png', 'unsupported_type'],
    ['invalid.txt', new Uint8Array([0xff]), 'text/plain', 'invalid_utf8'],
  ]) {
    await assert.rejects(readDocument(new File([content], name, { type })), { code });
  }
});

test('single-file byte and canonical-text limits apply before evidence enters a case', async () => {
  let read = false;
  await assert.rejects(readDocument({ name: 'large.txt', size: DOCUMENT_LIMITS.maxBytes + 1, arrayBuffer() { read = true; } }), { code: 'file_too_large' });
  assert.equal(read, false);
  await assert.rejects(readDocument(new File(['x'.repeat(DOCUMENT_LIMITS.maxTextChars + 1)], 'large.txt')), { code: 'text_too_large' });
});
