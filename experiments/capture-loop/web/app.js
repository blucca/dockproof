import { createFieldInspector } from './field-inspector.js';
import { createDetailCapture } from './detail-capture.js';

const $ = id => document.getElementById(id);
const titles = {
  request_document_view: 'Bring the document into view',
  request_full_edges: 'Include all four edges',
  request_sharper_capture: 'Take a sharper photo',
  prepare_document_review: 'Ready for your field review'
};
let state = { captures: [], review: null }, loaded = false, busy = false;
const parcelGuides = {
  'small-parcel': {
    title: 'GLS parcel label', task: '01 / Compare a field', button: 'Load GLS parcel',
    description: 'Find the handwritten date. Recipient fields are masked in the published source.',
    guide: 'Sample guide: at field review, compare the handwritten date in the original and perspective view, then enter the value you read. Recipient fields are masked in the published source.'
  },
  'package-label-reuse': {
    title: 'Cropped shipping label', task: '02 / Improve the frame', button: 'Load cropped label',
    description: 'The shipping label leaves the right edge. Get a request for a complete document view.',
    guide: 'Sample guide: the shipping label is cropped at the right edge. For a fresh photo, step back, center the label and leave space around all four edges. The GLS sample shows a different parcel.'
  }
};
const parcelSamples = new Map();
let pairedSample = null;
const last = () => state.captures.at(-1);
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
  if (loaded && state.captureReady === false) {
    document.querySelectorAll('#upload, #another, #photo, [data-capture]').forEach(el => { el.disabled = true; });
  }
  $('review-form').setAttribute('aria-busy', String(value));
  fieldInspector.setBusy(value, loaded);
  detailCapture.setBusy(value, loaded);
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
function sourceLinks(source) {
  const credit = node('span', `${source.author} · `, 'source-credit');
  for (const [label, href] of [[source.license, source.licenseUrl], ['Commons source ↗', source.page]]) {
    const url = new URL(href);
    if (!['https:', 'http:'].includes(url.protocol)) continue;
    const link = node('a', label); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    credit.append(link, document.createTextNode(label === source.license ? ' · ' : ''));
  }
  return credit;
}
function renderSampleContext() {
  const sample = parcelSamples.get(last()?.source.name), context = $('sample-context');
  context.hidden = !sample;
  context.replaceChildren();
  if (sample) context.append(document.createTextNode(`${parcelGuides[sample.id].guide} `), sourceLinks(sample.source));
}
function renderReceipt() {
  const receipt = state.review;
  $('receipt').hidden = !receipt;
  if (!receipt) return;
  $('receipt-value').textContent = `${receipt.field}: ${receipt.value}`;
  $('receipt-meta').textContent = `Checked by ${receipt.reviewer} · ${new Date(receipt.reviewedAt).toLocaleString()} · Capture ${receipt.captureId}`;
  if (receipt.detailCaptureId) $('receipt-meta').textContent += ` · Linked detail ${receipt.detailCaptureId} · Reviewer found it ${receipt.detailReadability} to read`;
}
function render() {
  const current = last(), captures = state.captures;
  const hosted = state.scope?.startsWith('hosted');
  const agentMode = state.execution?.endsWith('_with_native_model_tools');
  const cloudMode = state.execution === 'AWS_Lambda_OpenCV5_with_native_model_tools';
  $('file-hint').textContent = `JPEG or PNG · Up to ${(state.maxImageBytes || 8 * 1024 * 1024).toLocaleString()} bytes · The camera opens on supported phones.`;
  $('method').textContent = agentMode ? `${cloudMode ? 'AWS · ' : ''}OpenCV 5 measurements → live model tools → your next step` : 'OpenCV 5 measurements · rule-based capture requests';
  $('data-note').textContent = hosted
    ? `This browser has its own server-side session, accessed with an essential session cookie. Full-label originals, detail originals, perspective views, field crops and review records are automatically deleted after ${state.sessionHours || 24} hours; the button below deletes them now. ${cloudMode ? 'Full-label photos are sent to a private AWS Lambda for OpenCV measurements. Field crops and detail-photo registration run on this server. Page or detail measurements, the selected field name and previous capture requests are sent to Nebius for model decisions.' : 'OpenCV measurements run on this station.'} Use the supplied samples or photos cleared for this trial. Save images and export your record before the session expires.`
    : cloudMode
    ? 'Originals and review records are retained here. Full-label photos are sent to the configured private AWS Lambda. Field crops and detail registration run on this server; page or detail measurements, the target field name and previous requests are sent to the model provider. This server shares one research session.'
    : 'Photos and review records stay on this server. Everyone using it shares one research session.' + (agentMode ? ' Numerical image measurements, the selected field name and previous requests are sent to the configured model provider.' : '');
  $('session-note').hidden = !hosted;
  $('delete-session').hidden = !hosted;
  if (hosted) {
    const allowance = state.captureAllowance;
    const until = new Date(state.expiresAt).toLocaleString();
    const trialUntil = new Date(state.trialExpiresAt).toLocaleString();
    const availability = {
      busy: 'A photo is being processed. Reload in a moment.',
      session_limit: 'Your capture allowance is complete. Review and export your saved work below.',
      trial_closed: 'Live capture has closed. Your saved work remains available until session expiry.',
      service_limit: 'This trial’s capture allocation is complete. Your saved review and export are available.',
      session_expired: 'This session has expired. Reload to open a fresh session.'
    }[state.captureStatus];
    $('session-note').textContent = `Your own session · ${allowance?.remaining ?? '—'} of ${allowance?.limit ?? 6} capture attempts remaining. Photos auto-delete ${until}. Live trial through ${trialUntil}. ${availability || 'Try the two parcel samples below, or upload a photo cleared for this trial.'}`;
  }
  const detailCount = captures.reduce((total, capture) => total + (capture.fieldInspections || []).reduce((sum, item) => sum + (item.detailCaptures || []).length, 0), 0);
  $('count').textContent = `${captures.length + detailCount} photo${captures.length + detailCount === 1 ? '' : 's'}`;
  $('upload').textContent = current ? 'Take / upload another photo' : 'Take / upload a photo';
  $('empty').hidden = captures.length > 0;
  $('current').hidden = !current;
  $('history').replaceChildren();
  captures.forEach((capture, index) => {
    const li = node('li'), detail = node('div');
    detail.append(node('strong', `${index + 1}. ${titles[capture.analysis.action] || capture.analysis.action}`));
    detail.append(node('p', capture.source.name));
    detail.append(node('p', `${capture.source.width} × ${capture.source.height} px · Original retained`));
    if (capture.previousCaptureId) detail.append(node('p', `Follows capture ${capture.previousCaptureId}`));
    for (const inspection of capture.fieldInspections || []) for (const closeup of inspection.detailCaptures || []) {
      const link = node('a', `Detail for ${inspection.field} ↗`); link.href = localUrl(closeup.source.url); link.target = '_blank'; link.rel = 'noopener noreferrer';
      detail.append(link, node('p', `${closeup.analysis.status} · ${closeup.source.width} × ${closeup.source.height} px · Same-document declaration saved`));
    }
    li.append(imageLink(capture.source.url, `Original photo ${index + 1}`), detail); $('history').append(li);
  });
  renderReceipt();
  renderSampleContext();
  if (!current) { fieldInspector.render(null); return; }
  const { analysis, source } = current, ready = analysis.action === 'prepare_document_review';
  $('request-title').textContent = titles[analysis.action] || analysis.action;
  $('capture-id').textContent = `Photo ${captures.length}`;
  $('request').textContent = analysis.request;
  $('agent-decision').hidden = !analysis.agent;
  $('agent-decision').textContent = analysis.agent ? `Agent executed ${analysis.agent.tool} · ${analysis.agent.rationale} Full tool calls are included in the session export.` : '';
  $('views').replaceChildren(view(source.url, 'Retained original ↗', `${source.name} · ${source.width} × ${source.height} px · Original retained`));
  if (analysis.derived) {
    const derived = analysis.derived;
    $('views').append(view(derived.url, 'Perspective-corrected view ↗', `${(derived.sizePx || []).join(' × ')} px · Derived from this original`));
  }
  $('metrics').replaceChildren();
  for (const [key, value] of Object.entries(analysis.metrics || {})) {
    const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
    $('metrics').append(node('dt', label), node('dd', typeof value === 'object' ? JSON.stringify(value) : String(value)));
  }
  $('review-area').hidden = !ready;
  $('review-form').reset();
  fieldInspector.render(current);
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
  state = await api('/api/session'); render();
  $('status').textContent = 'Photo saved. Its measurements and next step are below.';
  $('request-title').focus({ preventScroll: true }); $('current').scrollIntoView({ block: 'start' });
}
const fieldInspector = createFieldInspector({
  api, run, localUrl, getCapture: last, status: $('status'),
  onSelect: inspection => {
    const form = $('review-form').elements;
    if (inspection) form.field.value = inspection.field;
    form.value.value = '';
    form.confirmed.checked = false;
    detailCapture.render(inspection);
  }
});
const detailCapture = createDetailCapture({
  api, run, localUrl, getState: () => state, status: $('status'),
  getPairedSample: () => pairedSample,
  refresh: async () => { state = await api('/api/session'); render(); },
  onReviewTarget: detail => {
    $('review-form').elements.value.value = '';
    $('review-form').elements.confirmed.checked = false;
    $('review-confirmation-label').textContent = detail
      ? 'I checked the same intended document in both retained originals, compared the target crops, and confirmed the value and readability assessment entered above.'
      : 'I checked the intended document, compared this field in the retained original and the perspective view, and confirmed the value entered above.';
  }
});
$('upload').addEventListener('click', () => $('photo').click());
$('another').addEventListener('click', () => $('photo').click());
$('reload').addEventListener('click', () => run('Restoring the saved session…', loadSession));
$('delete-session').addEventListener('click', () => run('Deleting this session’s saved photos and review…', async () => {
  state = await api('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  render(); $('status').textContent = 'Your saved photos and review were deleted. The capture-attempt allowance is unchanged.';
}));
$('photo').addEventListener('change', () => {
  const file = $('photo').files[0]; $('photo').value = '';
  if (file) run('Saving the original, measuring image quality and choosing the next step…', () => upload(file, file.name));
});
$('review-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const payload = { captureId: last().id, field: data.get('field').trim(), value: data.get('value').trim(), reviewer: data.get('reviewer').trim(), confirmed: data.get('confirmed') === 'on' };
  const fieldInspectionId = fieldInspector.reviewInspectionId(payload.field, payload.captureId);
  if (fieldInspectionId) payload.fieldInspectionId = fieldInspectionId;
  run('Saving your field confirmation…', async () => {
    if (!payload.field || !payload.value || !payload.reviewer || !payload.confirmed) throw new Error('Enter the field, value and reviewer, then check the comparison box.');
    Object.assign(payload, detailCapture.reviewPayload(payload.field, payload.captureId, fieldInspectionId));
    state.review = await api('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    renderReceipt(); $('review-form').elements.confirmed.checked = false;
    $('status').textContent = 'Field confirmation saved with its retained original.';
    $('receipt-title').focus({ preventScroll: true }); $('receipt').scrollIntoView({ block: 'center' });
  });
});
async function loadSamples() {
  try {
    const data = await api('/api/samples');
    if (data.pairedSample) {
      pairedSample = data.pairedSample;
      $('paired-sample').hidden = false;
      $('paired-credit').replaceChildren(sourceLinks(pairedSample.source));
      $('paired-start').addEventListener('click', () => run('Loading the full-label context and selecting its printed code…', async () => {
        const response = await fetch(localUrl(pairedSample.context.url));
        if (!response.ok) throw new Error('The paired context failed to load. Reload the station to retry.');
        await upload(await response.blob(), pairedSample.context.name);
        if (last()?.analysis.action !== 'prepare_document_review') return;
        await api('/api/field', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ captureId: last().id, field: pairedSample.field, box: pairedSample.box }) });
        state = await api('/api/session'); render();
        $('field-inspector').open = true;
        $('status').textContent = 'Full-label context saved and target selected. Check the same-document box below, then load its paired detail.';
        $('detail-capture').scrollIntoView({ block: 'start' });
      }));
      if (loaded) detailCapture.render(fieldInspector.selectedInspection());
    }
    const sampleButton = (sample, label) => {
      const button = node('button', label); button.type = 'button'; button.disabled = busy || !loaded;
      button.dataset.capture = 'true';
      if (state.captureReady === false) button.disabled = true;
      button.addEventListener('click', () => run('Loading the source photo, measuring it and choosing the next step…', async () => {
        const response = await fetch(localUrl(sample.url));
        if (!response.ok) throw new Error(`Loading the sample failed (HTTP ${response.status}).`);
        const blob = await response.blob(); await upload(blob, `${sample.id}.${blob.type.includes('png') ? 'png' : 'jpg'}`);
      }));
      return button;
    };
    for (const sample of data.parcelSamples || []) {
      const guide = parcelGuides[sample.id];
      if (!guide) continue;
      parcelSamples.set(`${sample.id}.jpg`, sample);
      const card = node('article', undefined, 'sample parcel-sample');
      card.append(node('p', guide.task, 'eyebrow'), imageLink(sample.url, guide.title), node('h4', guide.title), node('p', guide.description, 'small'));
      card.append(sampleButton(sample, guide.button), sourceLinks(sample.source));
      $('parcel-list').append(card);
    }
    $('parcel-status').hidden = parcelSamples.size > 0;
    if (!parcelSamples.size) $('parcel-status').textContent = 'Parcel samples are available in the full Capture Loop checkout.';
    renderSampleContext();
    $('sample-description').textContent = data.description;
    if (data.attributionUrl) {
      const url = new URL(data.attributionUrl);
      if (['https:', 'http:'].includes(url.protocol)) { $('attribution').href = url.href; $('attribution').hidden = false; }
    }
    for (const sample of data.samples || []) {
      const card = node('article', undefined, 'sample');
      const kindLabel = { natural_video_frame: 'Recorded camera frame', controlled_synthetic_capture: 'Synthetic capture' }[sample.kind] || sample.kind;
      card.append(imageLink(sample.url, sample.title), node('h3', sample.title), node('p', kindLabel, 'small'));
      const button = sampleButton(sample, sample.kind === 'controlled_synthetic_capture' ? 'Use this synthetic capture' : 'Use this camera frame');
      card.append(button); $('sample-list').append(card);
    }
  } catch (error) {
    const message = `${error.message} Reload this page to load samples. Your own photos use the upload button above.`;
    $('sample-description').textContent = message; $('parcel-status').textContent = message; $('parcel-status').hidden = false;
  }
}
run('Loading the saved session…', loadSession);
loadSamples();
