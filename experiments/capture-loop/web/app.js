const $ = id => document.getElementById(id);
const titles = {
  request_document_view: 'Bring the document into view',
  request_full_edges: 'Include all four edges',
  request_sharper_capture: 'Take a sharper photo',
  prepare_document_review: 'Ready for your field review'
};
let state = { captures: [], review: null }, loaded = false, busy = false;
const last = () => state.captures.at(-1);
const shortHash = hash => String(hash || '').slice(0, 16);
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
function localUrl(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Media must use this experiment server.');
  return url.href;
}
async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  let body;
  try { body = await response.json(); } catch { throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `The request failed (HTTP ${response.status}).`);
  return body;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button, #photo').forEach(el => { el.disabled = value || (!loaded && el.id !== 'reload'); });
  $('review-form').setAttribute('aria-busy', String(value));
}
async function run(message, work) {
  if (busy) return;
  setBusy(true); $('error').hidden = true; $('status').textContent = message;
  try { await work(); }
  catch (error) {
    $('status').textContent = 'Action stopped.';
    $('error').textContent = `${error.message} Use “Reload saved session” to check the last saved action, then retry.`;
    $('error').hidden = false;
  } finally { setBusy(false); }
}
function imageLink(url, alt) {
  const link = node('a'); link.href = localUrl(url); link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${alt} — open full-size image`);
  const img = node('img'); img.src = link.href; img.alt = alt; img.loading = 'lazy';
  link.append(img); return link;
}
function view(url, title, detail) {
  const figure = node('figure'), caption = node('figcaption', title);
  caption.append(node('span', detail)); figure.append(imageLink(url, title), caption); return figure;
}
function renderReceipt() {
  const receipt = state.review;
  $('receipt').hidden = !receipt;
  if (!receipt) return;
  $('receipt-value').textContent = `${receipt.field}: ${receipt.value}`;
  $('receipt-meta').textContent = `Checked by ${receipt.reviewer} · ${new Date(receipt.reviewedAt).toLocaleString()} · Capture ${receipt.captureId} · Source SHA-256 ${receipt.sourceSha256}`;
}
function render() {
  const current = last(), captures = state.captures;
  const agentMode = state.execution?.endsWith('_with_native_model_tools');
  const cloudMode = state.execution === 'AWS_Lambda_OpenCV5_with_native_model_tools';
  $('file-hint').textContent = `JPEG or PNG · Up to ${(state.maxImageBytes || 8 * 1024 * 1024).toLocaleString()} bytes · The camera opens on supported phones.`;
  $('method').textContent = agentMode ? `${cloudMode ? 'AWS · ' : ''}OpenCV 5 measurements → live model tools → your next step` : 'OpenCV 5 measurements · rule-based capture requests';
  $('data-note').textContent = cloudMode
    ? 'Originals and review records are retained here. Photos are sent to the configured private AWS Lambda function for measurement; numerical measurements and previous requests are sent to the model provider. This server shares one research session.'
    : 'Photos and review records stay on this server. Everyone using it shares one research session.' + (agentMode ? ' Numerical image measurements and previous requests are sent to the configured model provider.' : '');
  $('count').textContent = `${captures.length} photo${captures.length === 1 ? '' : 's'}`;
  $('upload').textContent = current ? 'Take / upload another photo' : 'Take / upload a photo';
  $('empty').hidden = captures.length > 0;
  $('current').hidden = !current;
  $('history').replaceChildren();
  captures.forEach((capture, index) => {
    const li = node('li'), detail = node('div');
    detail.append(node('strong', `${index + 1}. ${titles[capture.analysis.action] || capture.analysis.action}`));
    detail.append(node('p', capture.source.name));
    detail.append(node('p', `SHA-256 ${shortHash(capture.source.sha256)}… · ${capture.source.width} × ${capture.source.height} px`));
    if (capture.previousCaptureId) detail.append(node('p', `Follows capture ${capture.previousCaptureId}`));
    li.append(imageLink(capture.source.url, `Original photo ${index + 1}`), detail); $('history').append(li);
  });
  renderReceipt();
  if (!current) return;
  const { analysis, source } = current, ready = analysis.action === 'prepare_document_review';
  $('request-title').textContent = titles[analysis.action] || analysis.action;
  $('capture-id').textContent = `Photo ${captures.length}`;
  $('request').textContent = analysis.request;
  $('agent-decision').hidden = !analysis.agent;
  $('agent-decision').textContent = analysis.agent ? `Agent executed ${analysis.agent.tool} · ${analysis.agent.rationale} Full tool calls are included in the session export.` : '';
  $('views').replaceChildren(view(source.url, 'Retained original ↗', `${source.name} · ${source.width} × ${source.height} px · SHA-256 ${shortHash(source.sha256)}…`));
  if (analysis.derived) {
    const derived = analysis.derived;
    $('views').append(view(derived.url, 'Perspective-corrected view ↗', `${(derived.sizePx || []).join(' × ')} px · SHA-256 ${shortHash(derived.sha256)}… · Derived from this original`));
  }
  $('metrics').replaceChildren();
  for (const [key, value] of Object.entries(analysis.metrics || {})) {
    const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
    $('metrics').append(node('dt', label), node('dd', typeof value === 'object' ? JSON.stringify(value) : String(value)));
  }
  $('review-area').hidden = !ready;
  $('review-form').reset();
}
async function loadSession() {
  const session = await api('/api/session');
  if (!Array.isArray(session.captures)) throw new Error('The session response needs a captures list.');
  state = session; loaded = true; render();
  $('status').textContent = last() ? 'Saved session restored. Continue with the latest capture request.' : 'Ready for your first photo.';
}
async function upload(blob, name) {
  const params = new URLSearchParams({ name });
  if (last()) params.set('replaces', last().id);
  const capture = await api(`/api/capture?${params}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  state.captures.push(capture); state.review = null; render();
  $('status').textContent = 'Photo saved. Its measurements and next step are below.';
  $('request-title').focus({ preventScroll: true }); $('current').scrollIntoView({ block: 'start' });
}
$('upload').addEventListener('click', () => $('photo').click());
$('another').addEventListener('click', () => $('photo').click());
$('reload').addEventListener('click', () => run('Restoring the saved session…', loadSession));
$('photo').addEventListener('change', () => {
  const file = $('photo').files[0]; $('photo').value = '';
  if (file) run('Saving the original, measuring image quality and choosing the next step…', () => upload(file, file.name));
});
$('review-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const payload = { captureId: last().id, field: data.get('field').trim(), value: data.get('value').trim(), reviewer: data.get('reviewer').trim(), confirmed: data.get('confirmed') === 'on' };
  run('Saving your field confirmation…', async () => {
    if (!payload.field || !payload.value || !payload.reviewer || !payload.confirmed) throw new Error('Enter the field, value and reviewer, then check the comparison box.');
    state.review = await api('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    renderReceipt(); $('review-form').elements.confirmed.checked = false;
    $('status').textContent = 'Field confirmation saved with its original source hash.';
    $('receipt-title').focus({ preventScroll: true }); $('receipt').scrollIntoView({ block: 'center' });
  });
});
async function loadSamples() {
  try {
    const data = await api('/api/samples');
    $('sample-description').textContent = data.description;
    if (data.attributionUrl) {
      const url = new URL(data.attributionUrl);
      if (['https:', 'http:'].includes(url.protocol)) { $('attribution').href = url.href; $('attribution').hidden = false; }
    }
    for (const sample of data.samples || []) {
      const card = node('article', undefined, 'sample');
      const kindLabel = { natural_video_frame: 'Recorded camera frame', controlled_synthetic_capture: 'Synthetic capture' }[sample.kind] || sample.kind;
      card.append(imageLink(sample.url, sample.title), node('h3', sample.title), node('p', kindLabel, 'small'));
      const button = node('button', sample.kind === 'controlled_synthetic_capture' ? 'Use this synthetic capture' : 'Use this camera frame'); button.type = 'button'; button.disabled = busy || !loaded;
      button.addEventListener('click', () => run('Loading the camera frame, measuring it and choosing the next step…', async () => {
        const response = await fetch(localUrl(sample.url));
        if (!response.ok) throw new Error(`Loading the sample failed (HTTP ${response.status}).`);
        const blob = await response.blob(); await upload(blob, `${sample.id}.${blob.type.includes('png') ? 'png' : 'jpg'}`);
      }));
      card.append(button); $('sample-list').append(card);
    }
  } catch (error) { $('sample-description').textContent = `${error.message} Reload this page to load sample frames. Your own photos use the upload button above.`; }
}
run('Loading the saved session…', loadSession);
loadSamples();
