/** On-demand, browser-local English OCR. One LSTM-only CPU worker at a time. */
export const OCR_VERSION = '6.0.1';
export const OCR_LIMITS = Object.freeze({ maxPixels: 4_000_000, maxEdge: 3200, maxSourcePixels: 24_000_000, timeoutMs: 120_000 });
const vendor = new URL('../vendor/tesseract/', import.meta.url);
let slot = Promise.resolve();

export function rasterSize(width, height, scale = 1) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('Image dimensions require positive finite values.');
  const factor = Math.min(scale, OCR_LIMITS.maxEdge / width, OCR_LIMITS.maxEdge / height, Math.sqrt(OCR_LIMITS.maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), scale: factor };
}

function withTimeout(promise, stop) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => { stop(); reject(new Error('Local English OCR reached its two-minute page limit. The original remains available for review and retry.')); }, OCR_LIMITS.timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

/** A session owns the worker until close(); PDF pages can reuse it serially. */
export async function createOCRSession({ onProgress = () => {} } = {}) {
  const previous = slot;
  let release;
  slot = new Promise(resolve => { release = resolve; });
  await previous;
  let worker;
  let pending;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (worker) await worker.terminate();
      else pending?.then(created => created.terminate()).catch(() => {});
    } finally { release(); }
  };
  try {
    const { default: { createWorker } } = await import('../vendor/tesseract/tesseract.esm.min.js');
    pending = createWorker('eng', 1, {
      workerPath: new URL('worker.min.js', vendor).href,
      corePath: new URL('tesseract-core-lstm.js', vendor).href,
      langPath: vendor.href,
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: event => onProgress({ status: event.status, progress: event.progress }),
      errorHandler: () => {},
    });
    worker = await withTimeout(pending, close);
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '200' });
    return {
      async recognize(canvas) {
        if (closed) throw new Error('OCR session finished. Start a fresh document read.');
        const { data } = await withTimeout(worker.recognize(canvas, { rotateAuto: true }, { text: true }), close);
        return {
          text: String(data.text || '').replace(/\r\n?/g, '\n').trimEnd(),
          extraction: {
            method: 'tesseract_ocr', version: OCR_VERSION, language: 'eng', model: '4.0.0_best_int',
            confidence: Number.isFinite(data.confidence) ? data.confidence : null,
            derived: true, status: 'complete', raster: { width: canvas.width, height: canvas.height },
          },
        };
      },
      close,
    };
  } catch (error) { await close(); throw error; }
}

export async function imageCanvas(bytes, mimeType) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }), { imageOrientation: 'from-image' });
  try {
    if (bitmap.width * bitmap.height > OCR_LIMITS.maxSourcePixels) throw new Error('Use a photo of up to 24 megapixels for local text recognition.');
    const size = rasterSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { bitmap.close(); }
}
