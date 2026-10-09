import { FIELD_DEFINITIONS, createEmptyCase, addDocuments, normalizeCandidate, selectCandidate } from './core/fact-review.mjs';
import { readDocument, storeOriginal, getOriginal } from './core/document-intake.mjs';

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100);
const clone = value => structuredClone(value);
const safeName = value => String(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^\.+/, '') || 'record';
const roles = [
  ['bill_of_lading', 'Bill of lading'], ['delivery_receipt', 'Delivery receipt'],
  ['commercial_invoice', 'Invoice'], ['inspection_record', 'Inspection / salvage'],
  ['weight_sheet', 'Piece weight'], ['rate_confirmation', 'Booking terms'],
  ['claim_worksheet', 'Original worksheet'],
];
const definitions = new Map(FIELD_DEFINITIONS.map(field => [field.key, field]));
const formatValue = (field, value) => {
  if (value === null || value === undefined || value === '') return 'Awaiting selection';
  const definition = definitions.get(field);
  if (definition?.unit === 'cents') return money(value);
  if (definition?.unit === 'bps') return number(value / 100) + '%';
  if (definition?.unit === 'lb') return number(value) + ' lb';
  return String(value).replaceAll('_', ' ');
};
const roleNames = doc => (Array.isArray(doc.roles) ? doc.roles : [doc.kind]).map(role => roles.find(([id]) => id === role)?.[1] || 'Supporting record').join(' · ') || 'Assign a record role';
const valueFor = (state, definition) => (definition.group === 'shipment' ? state.shipment : state.facts)?.[definition.key];
const candidatesFor = (state, field) => (state.intake?.candidates || []).filter(candidate => candidate.field === field);
const distinctValues = candidates => new Set(candidates.map(candidate => JSON.stringify(candidate.value)));
const selectedRef = (state, key) => state.facts?.provenance?.[key];

function sourceLines(doc) {
  let start = 0;
  return doc.text.split('\n').map((text, index) => {
    const page = doc.pages?.find(page => start >= page.start && start <= page.end);
    const pageLine = page?.lines?.find(line => start >= line.start && start <= line.end);
    const line = { start, text, globalLine:index + 1, page:page?.page || 1, line:pageLine?.line || index + 1 };
    start += text.length + 1;
    return line;
  });
}

function citationButton(ref, label) {
  if (!ref) return '';
  return `<button class="cite" data-cite="${html(ref.documentId)}" data-line="${ref.globalLine || ref.line || 1}" data-page="${ref.page || 1}">${html(label || `p${ref.page || 1} · line ${ref.line || 1} ↗`)}</button>`;
}

export function createIntakeUI({ getState, commit, notify, openDocument }) {
  const originals = new Map();
  let busy = false;
  let modelReady = false;
  let manualField;

  const setStatus = message => { $('#import-status').textContent = message; };
  function setBusy(value) {
    busy = value;
    $('#document-files').disabled = busy;
    $('#add-pasted').disabled = busy;
    $('#extract-live').disabled = busy || !modelReady || !getState().documents.length;
    $('#save-manual-fact').disabled = busy;
    for (const input of document.querySelectorAll('[data-record-role]')) input.disabled = busy;
  }

  async function retain(doc, file) {
    originals.set(doc.id, file);
    try { await storeOriginal(doc, file); doc.originalStorage = 'browser'; }
    catch { doc.originalStorage = 'tab'; }
  }

  async function openOriginal(id, page = 1) {
    const doc = getState().documents.find(doc => doc.id === id);
    const windowRef = window.open('', '_blank');
    if (windowRef) windowRef.opener = null;
    try {
      const blob = originals.get(id) || await getOriginal(id);
      if (!blob) throw new Error(`Reattach ${doc?.originalName || doc?.name || 'this original file'} to restore its saved bytes.`);
      const viewBlob = new Blob([blob], { type:doc?.mimeType === 'application/pdf' ? 'application/pdf' : 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(viewBlob);
      if (windowRef) windowRef.location.href = url + (doc?.mimeType === 'application/pdf' ? `#page=${page}` : '');
      else {
        const link = document.createElement('a'); link.href = url; link.download = doc?.originalName || 'record'; link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) { windowRef?.close(); notify(error.message); }
  }

  async function addFiles(files) {
    if (busy) return;
    setBusy(true);
    const errors = [];
    let added = 0;
    try {
      for (const file of files) {
        setStatus(`Reading ${file.name} in this browser…`);
        try {
          const parsed = await readDocument(file, { id:`doc-${crypto.randomUUID()}`, kind:'supporting', synthetic:false });
          const state = getState();
          const existing = state.documents.find(doc => doc.sha256 === parsed.sha256);
          if (existing) {
            await retain(existing, file);
            commit(addDocuments(state, [{ ...existing }]));
            added += 1;
            continue;
          }
          if (state.documents.length >= 12) throw new Error('The 12-record case limit is reached. Combine related text records for the next case.');
          if (state.documents.reduce((total, doc) => total + (doc.byteLength || 0), 0) + parsed.byteLength > 25 * 1024 * 1024) throw new Error('Use a combined original-file size of 25 MB or less.');
          if (state.documents.reduce((total, doc) => total + doc.text.length, 0) + parsed.text.length > 80000) throw new Error('Use up to 80,000 extracted text characters in one case.');
          await retain(parsed, file);
          commit(addDocuments(state, [parsed]));
          added += 1;
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
      }
      setStatus([`${added} ${added === 1 ? 'record' : 'records'} added or reattached. Assign record roles below.`, ...errors].join(' '));
    } finally { setBusy(false); $('#document-files').value = ''; render(); }
  }

  async function loadExample() {
    if (busy) throw new Error('Finish the current document operation first.');
    setBusy(true);
    try {
      const base = new URL('./data/import-example/', import.meta.url);
      const response = await fetch(new URL('index.json', base));
      if (!response.ok) throw new Error('The PDF example failed to load. Retry the example.');
      const manifest = await response.json();
      let state = createEmptyCase({ id:manifest.id, title:manifest.title, synthetic:true });
      state.intake = { candidates:[], questions:[], runs:[] };
      const documents = [];
      for (const entry of manifest.documents) {
        setStatus(`Reading example PDF / text: ${entry.name}…`);
        const fileResponse = await fetch(new URL(entry.path, base));
        if (!fileResponse.ok) throw new Error(`Example record failed to load: ${entry.path}.`);
        const file = new File([await fileResponse.arrayBuffer()], entry.path.split('/').pop(), { type:entry.path.endsWith('.pdf') ? 'application/pdf' : 'text/plain' });
        const doc = await readDocument(file, { id:entry.id, kind:entry.kind, synthetic:true });
        doc.roles = entry.roles || [entry.kind];
        doc.name = entry.name || doc.name;
        await retain(doc, file);
        documents.push(doc);
      }
      state = addDocuments(state, documents);
      const candidateResponse = await fetch(new URL(manifest.candidates, base));
      if (!candidateResponse.ok) throw new Error('The example candidate selections failed to load.');
      const supplied = await candidateResponse.json();
      state.intake = {
        candidates:(supplied.facts || supplied).map(raw => normalizeCandidate({ ...raw, method:'sample_curated' }, documents)),
        questions:supplied.questions || [], runs:[], method:'sample_curated',
      };
      setStatus(`${documents.length} original example records parsed in this browser. The PDF case uses curated candidate facts.`);
      return state;
    } finally { setBusy(false); }
  }

  async function connect() {
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)) {
      $('#model-status').innerHTML = 'Use source-linked manual selection here. For model extraction, <a class="text-link" href="https://github.com/blucca/dockproof#run-locally" target="_blank" rel="noreferrer">start the local DockProof server with your Nebius key ↗</a>.';
      return;
    }
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error('server');
      const status = await response.json();
      modelReady = Boolean(status.extractionReady);
      $('#model-status').textContent = modelReady ? `${status.model} · ready through your local server.` : 'Set NEBIUS_API_KEY in your local server environment, restart the server, and reload this page. Source-linked manual selection is ready now.';
    } catch { $('#model-status').textContent = 'Start npm start locally to connect NVIDIA Nemotron. Source-linked manual selection is ready here.'; }
    setBusy(busy);
  }

  async function extract() {
    if (busy || !modelReady) return;
    setBusy(true);
    $('#extraction-results').textContent = 'Reading the document set and matching exact source excerpts…';
    try {
      const state = getState();
      const response = await fetch('/api/extract', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ documents:state.documents.map(({ id, name, text, pages, kind, roles, sha256, synthetic }) => ({ id, name, text, kind, roles, sha256, synthetic, pages:pages?.map(({ page, start, end }) => ({ page, start, end })) })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Extraction failed: HTTP ${response.status}.`);
      const candidates = result.extraction.facts.map(raw => normalizeCandidate({ ...raw, method:'nemotron' }, state.documents));
      const next = clone(state);
      const combined = new Map((next.intake?.candidates || []).map(candidate => [candidate.id, candidate]));
      candidates.forEach(candidate => combined.set(candidate.id, candidate));
      next.intake = {
        ...next.intake, candidates:[...combined.values()], questions:result.extraction.questions,
        runs:[...(next.intake?.runs || []), { mode:result.mode, model:result.model, ...result.execution }],
      };
      next.decisions.review = null;
      commit(next);
      $('#extraction-results').textContent = `${candidates.length} source-matched candidate facts · ${Math.round(result.execution.durationMs / 1000)} s · ${result.execution.usage?.total_tokens ?? 'usage pending'} tokens. Select the supported values below.`;
    } catch (error) { $('#extraction-results').textContent = error.message; }
    finally { setBusy(false); render(); }
  }

  function unambiguous(state) {
    return FIELD_DEFINITIONS.flatMap(definition => {
      if (selectedRef(state, definition.key)?.candidateId) return [];
      const candidates = candidatesFor(state, definition.key);
      return candidates.length && distinctValues(candidates).size === 1 ? [candidates[0]] : [];
    });
  }

  function select(id) {
    if (busy) return;
    const candidate = getState().intake?.candidates.find(candidate => candidate.id === id);
    if (!candidate) return;
    try {
      commit(selectCandidate(getState(), candidate, { reviewer:'Shipper reviewer', reason:'Selected after source review' }));
      notify(`${definitions.get(candidate.field)?.label || candidate.field}: ${formatValue(candidate.field, candidate.value)} selected. The calculation follows this evidence.`);
    } catch (error) { notify(error.message); }
  }

  function selectSingles() {
    if (busy) return;
    let next = getState();
    const candidates = unambiguous(next);
    try {
      for (const candidate of candidates) next = selectCandidate(next, candidate, { reviewer:'Shipper reviewer', reason:'Selected the displayed single-value candidate; conflicting fields retained for individual review' });
      commit(next);
      notify(`${candidates.length} single-value fields selected. Resolve the remaining source conflicts individually.`);
    } catch (error) { notify(error.message); }
  }

  function renderDocuments() {
    const state = getState();
    $('#intake-documents').innerHTML = state.documents.map(doc => {
      const selectedRoles = Array.isArray(doc.roles) ? doc.roles : [doc.kind];
      const warnings = (doc.warnings || []).map(warning => typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning));
      return `<article class="intake-record"><div class="record-heading"><h4>${html(doc.name)}</h4><span>${doc.pages?.length || 1}p</span></div><p class="record-meta">${number(doc.byteLength || new TextEncoder().encode(doc.text).length)} bytes · ${doc.originalStorage === 'tab' ? 'Original held in this tab' : 'Browser-local original'}</p>${warnings.map(warning => `<p class="record-warning">${html(warning)}</p>`).join('')}<div class="record-actions"><button class="cite" data-show-source="${html(doc.id)}">Read source ↗</button><button class="cite" data-open-original="${html(doc.id)}">Open original ↗</button></div><details class="record-roles" ${selectedRoles.includes('supporting') ? 'open' : ''}><summary>${html(roleNames(doc))}</summary><div>${roles.map(([role, label]) => `<label><input type="checkbox" data-record-role="${role}" data-record-id="${html(doc.id)}" ${selectedRoles.includes(role) ? 'checked' : ''} ${busy ? 'disabled' : ''}>${label}</label>`).join('')}</div></details></article>`;
    }).join('') || '<div class="empty-note">The original record list starts here. A single PDF may supply several roles.</div>';
  }

  function renderFields() {
    const state = getState();
    const required = FIELD_DEFINITIONS.filter(definition => definition.required);
    const selected = required.filter(definition => selectedRef(state, definition.key)?.candidateId).length;
    const conflicts = FIELD_DEFINITIONS.filter(definition => distinctValues(candidatesFor(state, definition.key)).size > 1);
    const unresolved = conflicts.filter(definition => !selectedRef(state, definition.key)?.candidateId);
    const singles = unambiguous(state);
    $('#facts-summary').textContent = `${selected} / ${required.length} required fields selected · ${unresolved.length} unresolved ${unresolved.length === 1 ? 'conflict' : 'conflicts'}. Each selection keeps its exact excerpt and source location.`;
    $('#facts-badge').textContent = `${selected}/${required.length}`;
    $('#select-unambiguous').textContent = `Select ${singles.length} single-value fields`;
    $('#select-unambiguous').disabled = busy || !singles.length;
    const runs = state.intake?.runs || [];
    $('#candidate-origin').textContent = runs.length ? `Candidate sources: NVIDIA Nemotron · ${runs.length} recorded ${runs.length === 1 ? 'run' : 'runs'}; manual selections keep their own method. Matching excerpts locates the evidence; the reviewer chooses the supported value.` : state.intake?.method === 'sample_curated' ? 'PDF example: real browser PDF parsing with curated candidate facts. The two weight candidates preserve the original source conflict.' : 'Choose “Record a sourced value” to select a fact manually. A connected local Nemotron model can propose candidates for the full document set.';
    $('#candidate-questions').innerHTML = (state.intake?.questions || []).map(question => `<div class="candidate-question"><strong>${html(definitions.get(question.field)?.label || question.field)}</strong><p>${html(question.question)}</p></div>`).join('');
    const filter = $('#fact-filter').value;
    const visible = FIELD_DEFINITIONS.filter(definition => filter === 'all' || (filter === 'conflicts' ? conflicts.includes(definition) : !selectedRef(state, definition.key)?.candidateId && (definition.required || candidatesFor(state, definition.key).length)));
    if (!visible.length) {
      $('#fact-fields').innerHTML = `<div class="all-received"><span class="check-icon">✓</span><div><h3>${filter === 'conflicts' ? 'Source conflicts resolved or absent.' : 'The required fact selections are complete.'}</h3><p>Open All fields to revisit a value, or review the evidence and amount at the desk.</p><button class="button secondary small" data-tab="desk">Review the amount →</button></div></div>`;
      return;
    }
    $('#fact-fields').innerHTML = [['shipment', 'Shipment identity'], ['valuation', 'Damaged piece & amount'], ['terms', 'Carrier terms & scope']].map(([group, label]) => {
      const fields = visible.filter(definition => definition.group === group);
      if (!fields.length) return '';
      return `<details class="fact-group" open><summary>${label}<span>${fields.length} ${fields.length === 1 ? 'field' : 'fields'}</span></summary>${fields.map(definition => {
        const ref = selectedRef(state, definition.key);
        const candidates = candidatesFor(state, definition.key);
        const conflict = distinctValues(candidates).size > 1;
        return `<article class="fact-field ${conflict ? 'has-conflict' : ''}" data-field="${html(definition.key)}"><div class="fact-field-heading"><h4>${html(definition.label)}</h4><span class="status-tag ${ref?.candidateId ? 'green' : 'amber'}">${ref?.candidateId ? 'Selected' : conflict ? 'Choose between sources' : definition.required ? 'Required' : 'Optional'}</span></div>${ref?.candidateId ? `<p class="selected-value">${html(formatValue(definition.key, valueFor(state, definition)))} ${citationButton(ref)}</p>` : ''}${candidates.map(candidate => {
          const chosen = ref?.candidateId === candidate.id;
          const doc = state.documents.find(doc => doc.id === candidate.document_id);
          return `<div class="candidate ${chosen ? 'chosen' : ''}"><div class="candidate-top"><strong>${html(formatValue(definition.key, candidate.value))}</strong><button class="button ${chosen ? 'secondary' : 'primary'} small" data-select-candidate="${html(candidate.id)}" ${chosen || busy ? 'disabled' : ''}>${chosen ? 'Selected ✓' : 'Select value'}</button></div><blockquote>${html(candidate.quote)}</blockquote><div class="candidate-source"><span>${html(doc?.name || candidate.document_id)} · ${html(candidate.method === 'nemotron' ? 'Nemotron candidate' : candidate.method === 'sample_curated' ? 'Curated example' : 'Reviewer entry')}</span>${citationButton(candidate.citation)}</div></div>`;
        }).join('')}<button class="button-plain" data-edit-field="${html(definition.key)}">${ref?.candidateId ? 'Revise with a source excerpt' : 'Record a sourced value'} →</button>${ref?.history?.length ? `<details class="selection-history"><summary>${ref.history.length} previous ${ref.history.length === 1 ? 'selection' : 'selections'}</summary>${ref.history.map(previous => `<p>${html(formatValue(definition.key, previous.value))} · ${html(previous.reason || previous.method || 'Earlier selection')}</p>`).join('')}</details>` : ''}</article>`;
      }).join('')}</details>`;
    }).join('');
  }

  function render() {
    renderDocuments(); renderFields(); setBusy(busy);
  }

  function updateManualLines() {
    const doc = getState().documents.find(doc => doc.id === $('#manual-source').value);
    const lines = sourceLines(doc).filter(line => line.text.trim());
    $('#manual-line').innerHTML = lines.map(line => `<option value="${line.start}">p${line.page} · L${line.line}: ${html(line.text.slice(0, 95))}</option>`).join('');
    updateManualQuote();
  }

  function updateManualQuote() {
    const doc = getState().documents.find(doc => doc.id === $('#manual-source').value);
    const line = sourceLines(doc).find(line => line.start === Number($('#manual-line').value));
    $('#manual-quote').value = line?.text || '';
  }

  function openManual(field) {
    if (busy) return;
    const state = getState();
    if (!state.documents.length) { notify('Add a source record first.'); return; }
    manualField = definitions.get(field);
    const ref = selectedRef(state, field);
    $('#manual-title').textContent = manualField.label;
    $('#manual-source').innerHTML = state.documents.map(doc => `<option value="${html(doc.id)}">${html(doc.name)}</option>`).join('');
    if (ref?.documentId && state.documents.some(doc => doc.id === ref.documentId)) $('#manual-source').value = ref.documentId;
    updateManualLines();
    if (ref?.quote) {
      $('#manual-quote').value = ref.quote;
      const line = sourceLines(state.documents.find(doc => doc.id === $('#manual-source').value)).find(line => ref.start >= line.start && ref.start <= line.start + line.text.length);
      if (line) $('#manual-line').value = line.start;
    }
    const current = valueFor(state, manualField);
    const initial = current === null || current === undefined ? '' : ['cents', 'bps'].includes(manualField.unit) ? String(current / 100) : String(current);
    $('#manual-value-label').textContent = manualField.unit === 'cents' ? 'Selected amount · USD' : manualField.unit === 'bps' ? 'Selected discount · %' : `Selected value${manualField.unit === 'lb' ? ' · lb' : ''}`;
    const options = manualField.type === 'boolean' ? ['true', 'false'] : manualField.options;
    $('#manual-value-editor').innerHTML = options
      ? `<select id="manual-value"><option value="">Choose a value</option>${options.map(option => `<option value="${html(option)}" ${String(option) === initial ? 'selected' : ''}>${html(String(option).replaceAll('_', ' '))}</option>`).join('')}</select>`
      : `<input id="manual-value" type="${manualField.type === 'date' ? 'date' : 'text'}" value="${html(initial)}" ${['integer', 'number'].includes(manualField.type) ? 'inputmode="decimal"' : ''}>`;
    $('#manual-reason').value = ''; $('#manual-error').textContent = '';
    $('#fact-dialog').showModal();
  }

  function saveManual() {
    if (busy) return;
    try {
      const state = getState();
      const doc = state.documents.find(doc => doc.id === $('#manual-source').value);
      const quote = $('#manual-quote').value;
      let value = $('#manual-value').value;
      if (['cents', 'bps'].includes(manualField.unit)) {
        if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a non-negative value with up to two decimal places.');
        value = String(Math.round(Number(value) * 100));
      }
      const preferredStart = Number($('#manual-line').value);
      const raw = { field:manualField.key, value, document_id:doc.id, quote, method:'manual' };
      if (doc.text.slice(preferredStart, preferredStart + quote.length) === quote) raw.start = preferredStart;
      const candidate = normalizeCandidate(raw, state.documents);
      let next = clone(state);
      next.intake ??= { candidates:[], questions:[], runs:[] };
      next.intake.candidates = [...next.intake.candidates.filter(item => item.id !== candidate.id), candidate];
      next = selectCandidate(next, candidate, { reviewer:'Shipper reviewer', reason:$('#manual-reason').value || 'Reviewer selected a value from the source excerpt' });
      commit(next); $('#fact-dialog').close();
      notify(`${formatValue(manualField.key, candidate.value)} selected with its exact source excerpt.`);
    } catch (error) { $('#manual-error').textContent = error.message; }
  }

  async function preparePacket(packet) {
    const state = getState();
    const originalsManifest = [];
    for (const doc of state.documents.filter(doc => doc.received && doc.sha256)) {
      const original = originals.get(doc.id) || await getOriginal(doc.id);
      if (!original) throw new Error(`Packet export stopped: reattach ${doc.originalName || doc.name} to include its original bytes.`);
      const bytes = new Uint8Array(await original.arrayBuffer());
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== doc.sha256) throw new Error(`Packet export stopped: the original ${doc.name} needs its matching source file.`);
      const path = `originals/${safeName(doc.id)}-${safeName(doc.originalName || doc.name)}`;
      packet.files.push({ name:path, type:doc.mimeType || 'application/octet-stream', content:bytes });
      originalsManifest.push({ documentId:doc.id, file:path, originalName:doc.originalName || doc.name, mimeType:doc.mimeType, sha256:digest, byteLength:bytes.length });
    }
    if (originalsManifest.length) {
      packet.manifest.originals = originalsManifest;
      packet.manifest.files = packet.files.map(file => ({ name:file.name, type:file.type }));
      for (const entry of packet.manifest.documents) {
        const original = originalsManifest.find(item => item.documentId === entry.id);
        if (original) entry.originalFile = original.file;
      }
      packet.files.find(file => file.name === 'document-manifest.json').content = JSON.stringify(packet.manifest, null, 2) + '\n';
    }
    return packet;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.selectCandidate) select(button.dataset.selectCandidate);
    if (button.dataset.editField) openManual(button.dataset.editField);
    if (button.dataset.showSource) openDocument(button.dataset.showSource, 1);
    if (button.dataset.openOriginal) openOriginal(button.dataset.openOriginal, Number(button.dataset.page) || 1);
    if (button.id === 'select-unambiguous') selectSingles();
    if (button.id === 'save-manual-fact') saveManual();
    if (button.id === 'extract-live') extract();
    if (button.id === 'add-pasted') {
      const text = $('#pasted-text').value;
      if (!text.trim()) { setStatus('Paste the source text first.'); return; }
      const name = ($('#pasted-name').value.trim() || 'Pasted record').replace(/\.txt$/i, '') + '.txt';
      addFiles([new File([text], name, { type:'text/plain' })]).then(() => { $('#pasted-text').value = ''; });
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'document-files') addFiles([...event.target.files]);
    if (event.target.id === 'fact-filter') renderFields();
    if (event.target.id === 'manual-source') updateManualLines();
    if (event.target.id === 'manual-line') updateManualQuote();
    if (event.target.dataset.recordRole && !busy) {
      const id = event.target.dataset.recordId;
      const doc = getState().documents.find(doc => doc.id === id);
      const selectedRoles = new Set(Array.isArray(doc.roles) ? doc.roles : [doc.kind]);
      selectedRoles.delete('supporting');
      if (event.target.checked) selectedRoles.add(event.target.dataset.recordRole); else selectedRoles.delete(event.target.dataset.recordRole);
      const nextRoles = selectedRoles.size ? [...selectedRoles] : ['supporting'];
      commit(addDocuments(getState(), [{ id, kind:nextRoles[0], roles:nextRoles }]));
    }
  });
  connect();
  return { render, addFiles, loadExample, openOriginal, preparePacket, forgetOriginals:ids => ids.forEach(id => originals.delete(id)), get busy() { return busy; } };
}
