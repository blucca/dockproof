/** Browser-local document intake. Original bytes stay in this origin's IndexedDB. */
import { createOCRSession, rasterSize, imageCanvas, OCR_LIMITS, OCR_VERSION } from './local-ocr.mjs';

export const PDFJS_VERSION = '6.4.299';
export const DOCUMENT_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPages: 40, maxTextChars: 80000 });

export class DocumentIntakeError extends Error {
  constructor(message, code = 'document_intake_failed') {
    super(message);
    this.name = 'DocumentIntakeError';
    this.code = code;
  }
}

let pdfLibrary;
let pdfSlot = Promise.resolve();

async function getPDFLibrary() {
  pdfLibrary ??= import('../vendor/pdfjs/pdf.min.mjs').then((library) => {
    library.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return library;
  });
  return pdfLibrary;
}

const fail = (message, code) => { throw new DocumentIntakeError(message, code); };
const normalizeLF = (value) => value.replace(/\r\n?/g, '\n');

export function pageMap(pageTexts, extractions = []) {
  let offset = 0;
  let globalLine = 1;
  return pageTexts.map((pageText, index) => {
    const start = offset;
    let lineStart = start;
    const lines = pageText.split('\n').map((lineText, lineIndex) => {
      const line = { line: lineIndex + 1, globalLine: globalLine++, start: lineStart, end: lineStart + lineText.length };
      lineStart = line.end + 1;
      return line;
    });
    const page = { page: index + 1, start, end: start + pageText.length, lines, ...(extractions[index] ? { extraction: extractions[index] } : {}) };
    offset = page.end + 2;
    // A page separator contributes one additional empty line to canonical text.
    if (index < pageTexts.length - 1) globalLine++;
    return page;
  });
}

/** Flatten selectable PDF text by visible baseline and horizontal position. */
export function pdfTextLines(items, viewportTransform = [1, 0, 0, -1, 0, 0]) {
  const [a, b, c, d, e, f] = viewportTransform;
  const chunks = items.filter((item) => typeof item.str === 'string' && item.str.length > 0).map((item, index) => {
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const [ta, tb, tc, td, tx, ty] = transform;
    const width = Math.abs(Number(item.width) || 0) * Math.hypot(a, b);
    const height = Math.max(1, Math.hypot(a * tc + c * td, b * tc + d * td), Math.abs(Number(item.height) || 0));
    return {
      text: normalizeLF(item.str), x: a * tx + c * ty + e, y: b * tx + d * ty + f,
      width, height, dir: item.dir || 'ltr', index,
      rotated: Math.abs(b * ta + d * tb) > Math.max(0.2, Math.abs(a * ta + c * tb) * 0.15),
    };
  });
  chunks.sort((left, right) => left.y - right.y || left.x - right.x || left.index - right.index);
  const rows = [];
  for (const chunk of chunks) {
    // Find a close visible baseline. A superscript joins its surrounding row only
    // when its baseline falls within the row's quarter-em tolerance.
    let row = rows.at(-1);
    if (!row || Math.abs(row.y - chunk.y) > Math.max(1.5, Math.min(row.height, chunk.height) * 0.25)) {
      row = { y: chunk.y, height: chunk.height, chunks: [] };
      rows.push(row);
    }
    row.chunks.push(chunk);
    row.height = Math.max(row.height, chunk.height);
  }
  return rows.flatMap((row) => {
    const rtl = row.chunks.filter((chunk) => chunk.dir === 'rtl').length > row.chunks.length / 2;
    row.chunks.sort((left, right) => (rtl ? right.x - left.x : left.x - right.x) || left.index - right.index);
    let text = '';
    let previous;
    for (const chunk of row.chunks) {
      if (previous && text && !/\s$/u.test(text) && !/^\s/u.test(chunk.text)) {
        const gap = rtl ? previous.x - (chunk.x + chunk.width) : chunk.x - (previous.x + previous.width);
        const em = Math.min(previous.height, chunk.height);
        if (gap > Math.max(0.5, em * 0.08)) {
          const spaces = gap > em * 1.5 ? Math.min(8, Math.max(2, Math.round(gap / (em * 0.3)))) : 1;
          text += ' '.repeat(spaces);
        }
      }
      text += chunk.text;
      previous = chunk;
    }
    return text.replace(/[\t ]+$/u, '').split('\n');
  });
}

async function parsePDF(bytes, { onProgress = () => {}, ocr = true } = {}) {
  const prior = pdfSlot;
  let release;
  pdfSlot = new Promise((resolve) => { release = resolve; });
  await prior;
  let loadingTask;
  let ocrSession;
  let activePage = 1;
  try {
    const library = await getPDFLibrary();
    loadingTask = library.getDocument({
      data: bytes,
      isEvalSupported: false,
      useWasm: false,
      useSystemFonts: true,
      disableFontFace: true,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      disableAutoFetch: true,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > DOCUMENT_LIMITS.maxPages) fail(`This PDF has ${pdf.numPages} pages. Choose a document with up to ${DOCUMENT_LIMITS.maxPages} pages.`, 'too_many_pages');
    const pageTexts = [];
    const warnings = [];
    const extractions = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ disableNormalization: true });
        let pageText = pdfTextLines(content.items, page.getViewport({ scale: 1 }).transform).join('\n');
        let extraction = { method: 'pdfjs_selectable_text', version: PDFJS_VERSION, derived: false };
        activePage = pageNumber;
        onProgress({ status: 'reading PDF page', page: pageNumber, pageCount: pdf.numPages });
        if (!pageText.trim()) {
          extraction = { method: 'pdf_original', derived: false, status: 'attached' };
          if (ocr) {
            let canvas;
            try {
              ocrSession ??= await createOCRSession({ onProgress: event => onProgress({ ...event, page: activePage, pageCount: pdf.numPages }) });
              const base = page.getViewport({ scale: 1 });
              const size = rasterSize(base.width, base.height, 200 / 72);
              const viewport = page.getViewport({ scale: size.scale });
              canvas = document.createElement('canvas');
              canvas.width = size.width; canvas.height = size.height;
              await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, background: '#ffffff' }).promise;
              const recognized = await ocrSession.recognize(canvas);
              pageText = recognized.text; extraction = recognized.extraction;
              warnings.push(`Page ${pageNumber}: English OCR-derived text. Compare selected facts with the original page.`);
              if (!pageText.trim()) warnings.push(`Page ${pageNumber}: OCR returned 0 readable characters. The original page remains attached; add a UTF-8 transcript for sourced facts.`);
            } catch (error) {
              extraction = { method: 'tesseract_ocr', version: OCR_VERSION, language: 'eng', derived: true, status: 'failed' };
              warnings.push(`Page ${pageNumber}: OCR failed (${error?.message || String(error)}). The original page remains attached for visual review.`);
              await ocrSession?.close(); ocrSession = undefined;
            } finally { if (canvas) { canvas.width = 1; canvas.height = 1; } }
          } else warnings.push(`Page ${pageNumber}: original page attached with 0 selectable characters. Read its text with local English OCR.`);
        }
        extractions.push(extraction);
        characters += pageText.length + (pageNumber > 1 ? 2 : 0);
        if (characters > DOCUMENT_LIMITS.maxTextChars) fail(`Extracted text exceeds ${DOCUMENT_LIMITS.maxTextChars.toLocaleString('en-US')} characters. Split the document into a smaller evidence selection.`, 'text_too_large');
        pageTexts.push(pageText);
        if (content.items.some((item) => item.dir === 'ttb')) warnings.push(`Page ${pageNumber}: vertical text was arranged into visible rows. Review its reading order before selecting facts.`);
      } finally {
        page.cleanup();
      }
    }
    const text = pageTexts.join('\n\n');
    return {
      text, pages: pageMap(pageTexts, extractions), warnings,
      extraction: {
        method: new Set(extractions.map(item => item.method)).size > 1 ? 'pdfjs_mixed' : extractions[0].method, pdfjsVersion: PDFJS_VERSION,
        ocrPages: extractions.flatMap((item, index) => item.method === 'tesseract_ocr' ? [index + 1] : []),
        normalization: 'Visible baselines sorted top-to-bottom; each row follows horizontal reading direction. Geometric gaps become spaces. Empty selectable-text pages use browser-local English OCR with per-page method records. OCR output is derived text for comparison with the original. Page lines use LF; pages are separated by two LF characters. Offsets count JavaScript UTF-16 code units in this canonical text.',
      },
    };
  } catch (error) {
    if (error instanceof DocumentIntakeError) throw error;
    if (error?.name === 'PasswordException') fail('This PDF requires a password. Export an unlocked copy for this case.', 'encrypted_pdf');
    fail(`PDF extraction failed: ${error?.message || 'invalid PDF data'}. Try a searchable PDF or a UTF-8 transcript.`, 'pdf_parse_failed');
  } finally {
    try { await ocrSession?.close(); } catch { /* Release the PDF slot after OCR cleanup. */ }
    try { await loadingTask?.destroy(); } catch { /* The completed parse already carries its result or error. */ }
    release();
  }
}

function parseText(bytes) {
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('UTF-8 decoding failed. Save the source as UTF-8 text and import it again.', 'invalid_utf8'); }
  if (decoded.includes('\0')) fail('This file contains binary NUL bytes. Export its evidence as UTF-8 text.', 'binary_text');
  const text = normalizeLF(decoded);
  if (text.length > DOCUMENT_LIMITS.maxTextChars) fail(`Text exceeds ${DOCUMENT_LIMITS.maxTextChars.toLocaleString('en-US')} characters. Choose a smaller evidence selection.`, 'text_too_large');
  if (!text.trim()) fail('The text file contains 0 visible characters. Add a document containing shipment evidence.', 'empty_document');
  return {
    text, pages: pageMap([text]), warnings: [],
    extraction: {
      method: 'utf8_text',
      normalization: 'UTF-8 decoding removes a leading BOM. CRLF and CR line breaks become LF; all other text is preserved. Text files use one logical page. Offsets count JavaScript UTF-16 code units in this canonical text.',
    },
  };
}

/** Signature-based PNG / JPEG dimensions, before allocating decoded image pixels. */
export function imageDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)
    && [73,72,68,82].every((byte, index) => bytes[12 + index] === byte)) {
    return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        return { mimeType: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  fail('Image reading failed. Choose an original PNG or JPEG photo.', 'invalid_image');
}

async function parseImage(bytes, { ocrImages = false, onProgress = () => {} } = {}) {
  const dimensions = imageDimensions(bytes);
  if (!(dimensions.width > 0 && dimensions.height > 0) || dimensions.width * dimensions.height > OCR_LIMITS.maxSourcePixels) {
    fail('Choose a PNG or JPEG photo of up to 24 megapixels.', 'image_too_large');
  }
  let text = '';
  let extraction = { method: 'original_image', derived: false, status: 'attached' };
  const warnings = [];
  if (ocrImages) {
    let canvas;
    let session;
    try {
      canvas = await imageCanvas(bytes, dimensions.mimeType);
      session = await createOCRSession({ onProgress });
      const recognized = await session.recognize(canvas);
      text = recognized.text; extraction = recognized.extraction;
      if (text.length > DOCUMENT_LIMITS.maxTextChars) fail('Photo text exceeds 80,000 characters. Use a smaller evidence selection.', 'text_too_large');
      warnings.push('English OCR-derived text. Compare each selected fact with the original photo.');
      if (!text.trim()) warnings.push('OCR returned 0 readable characters. The original photo remains attached as visual evidence.');
    } catch (error) {
      if (error instanceof DocumentIntakeError) throw error;
      extraction = { method: 'tesseract_ocr', version: OCR_VERSION, language: 'eng', derived: true, status: 'failed' };
      warnings.push(`Photo OCR failed (${error?.message || String(error)}). The original photo remains attached for visual review.`);
    } finally {
      await session?.close();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
  }
  return {
    text, pages: pageMap([text], [extraction]), warnings, image: dimensions,
    extraction: { method: ocrImages ? 'image_ocr' : 'image_original', language: ocrImages ? 'eng' : null,
      normalization: 'The original image is preserved byte-for-byte. Optional local English OCR produces a derived UTF-16 text transcript; line breaks use LF and trailing whitespace is trimmed. Review selected excerpts against the original image.' },
  };
}

/** Read PDF, PNG/JPEG photo, or UTF-8 text; preserve originals and exact canonical offsets. */
export async function readDocument(file, { id, kind = 'supporting', synthetic = false, ocr = true, ocrImages = false, onProgress } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') fail('Choose a PDF, PNG/JPEG photo, or UTF-8 text file.', 'invalid_file');
  if (Number(file.size) > DOCUMENT_LIMITS.maxBytes) fail('This file exceeds 10 MB. Choose a smaller evidence file.', 'file_too_large');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > DOCUMENT_LIMITS.maxBytes) fail('This file exceeds 10 MB. Choose a smaller evidence file.', 'file_too_large');
  if (buffer.byteLength === 0) fail('The file contains 0 bytes. Choose a document containing shipment evidence.', 'empty_document');
  const bytes = new Uint8Array(buffer);
  const originalName = String(file.name || 'Imported document');
  const declaredType = String(file.type || '').toLowerCase().split(';')[0];
  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const isPDF = prefix.includes('%PDF-') || declaredType === 'application/pdf' || /\.pdf$/i.test(originalName);
  const isImage = !isPDF && (/\.(?:png|jpe?g)$/i.test(originalName) || ['image/png', 'image/jpeg'].includes(declaredType) || (bytes[0] === 137 && bytes[1] === 80) || (bytes[0] === 255 && bytes[1] === 216));
  if (!isPDF && !isImage && !/\.(?:txt|text|md|csv|eml)$/i.test(originalName) && !declaredType.startsWith('text/')) {
    fail('Choose a PDF, PNG/JPEG photo, or UTF-8 text record (.txt, .md, .csv, or .eml).', 'unsupported_type');
  }
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
  const byteLength = bytes.byteLength;
  const content = isPDF ? await parsePDF(bytes, { ocr, onProgress }) : isImage ? await parseImage(bytes, { ocrImages, onProgress }) : parseText(bytes);
  return {
    id: id || `doc_${crypto.randomUUID()}`, name: originalName, originalName,
    kind, roles: [kind], received: true, synthetic: Boolean(synthetic),
    ...content, sha256, mimeType: isPDF ? 'application/pdf' : isImage ? content.image.mimeType : (declaredType.startsWith('text/') ? declaredType : 'text/plain'), byteLength,
  };
}

let databasePromise;
function originalDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new DocumentIntakeError('Browser original-file storage is unavailable. Open DockProof in a browser with IndexedDB enabled.', 'storage_unavailable'));
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('dockproof-originals-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('originals', { keyPath: 'id' });
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = undefined; };
      resolve(database);
    };
    request.onerror = () => { databasePromise = undefined; reject(request.error); };
    request.onblocked = () => { databasePromise = undefined; reject(new DocumentIntakeError('Close other DockProof tabs and retry original-file storage.', 'storage_blocked')); };
  });
  return databasePromise;
}

async function originalsTransaction(mode, action) {
  const database = await originalDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('originals', mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new DocumentIntakeError('Original-file storage was interrupted. Retry this file.', 'storage_failed'));
    transaction.onerror = () => reject(transaction.error || new DocumentIntakeError('Original-file storage failed. Check browser storage space.', 'storage_failed'));
    try {
      const request = action(transaction.objectStore('originals'));
      if (request) request.onsuccess = () => { result = request.result; };
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function storeOriginal(document, file) {
  if (!document?.id || !file || typeof file.slice !== 'function') fail('Supply the imported document and its original file.', 'invalid_original');
  await originalsTransaction('readwrite', (store) => store.put({
    id: document.id,
    blob: file.slice(0, file.size, file.type || document.mimeType),
    originalName: document.originalName || file.name,
    sha256: document.sha256,
    storedAt: new Date().toISOString(),
  }));
}

export async function getOriginal(documentId) {
  const record = await originalsTransaction('readonly', (store) => store.get(documentId));
  return record?.blob || null;
}

export async function deleteOriginal(documentId) {
  await originalsTransaction('readwrite', (store) => store.delete(documentId));
}

/** Delete only the supplied case's document IDs; other cases keep their originals. */
export async function clearOriginals(documentIds) {
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return;
  await originalsTransaction('readwrite', (store) => { for (const id of ids) store.delete(id); });
}
