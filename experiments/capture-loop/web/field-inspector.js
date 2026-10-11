// A target-field selection stays in perspective coordinates; the server returns original pixels.
export function createFieldInspector({ api, run, localUrl, getCapture, onSelect, status }) {
  const $ = id => document.getElementById(id);
  const root = $('field-inspector'), form = $('field-inspect-form');
  const stage = $('field-select-stage'), photo = $('field-select-image'), overlay = $('field-selection');
  const coords = ['left', 'top', 'width', 'height'].map(name => form.elements[name]);
  let captureId = null, selected = null, linkedId = null, box = null, drag = null;
  let busy = false, loaded = false, imageReady = false, zoom = 1;
  const inspections = () => getCapture()?.fieldInspections || [];
  const round = value => Math.round(value * 10000) / 10000;
  const validBox = value => value?.length === 4 && value.every(Number.isFinite)
    && value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0
    && value[0] + value[2] <= 1.000001 && value[1] + value[3] <= 1.000001;
  function availability() {
    const ready = loaded && !busy && Boolean(getCapture()?.analysis?.derived?.url);
    form.querySelectorAll('input').forEach(input => { input.disabled = !ready; });
    $('field-inspect-submit').disabled = !ready || inspections().length >= 6;
    $('field-history').disabled = !ready || !inspections().length;
    root.querySelectorAll('[data-field-zoom]').forEach(button => { button.disabled = !ready || !selected; });
    root.setAttribute('aria-busy', String(busy));
    const count = inspections().length;
    $('field-allowance').textContent = `${count} of 6 field inspections saved for this photo.${count >= 6 ? ' Review saved fields below.' : ''}`;
  }
  function drawBox() {
    overlay.hidden = !validBox(box);
    if (overlay.hidden) return;
    const [left, top, width, height] = box.map(value => `${value * 100}%`);
    Object.assign(overlay.style, { left, top, width, height });
  }
  function setBox(value, syncInputs = true) {
    box = value;
    if (syncInputs) coords.forEach((input, index) => { input.value = value ? String(Math.round(value[index] * 10000) / 100) : ''; });
    drawBox();
  }
  function fromInputs() {
    return coords.map(input => input.value.trim() === '' ? NaN : Number(input.value) / 100);
  }
  function setZoom(value) {
    zoom = value;
    root.querySelectorAll('[data-field-zoom]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.fieldZoom) === value)));
    if (!selected) return;
    const size = selected.view?.sizePx || selected.nativeSizePx;
    if (size?.length === 2 && size.every(n => Number.isFinite(n) && n > 0)) {
      $('field-crop').style.width = `${size[0] * zoom}px`;
      $('field-crop').style.height = `${size[1] * zoom}px`;
    }
    $('field-zoom-note').textContent = `${zoom}× pixel view · Scroll within the crop to inspect its edges.`;
  }
  function selectInspection(inspection, fillReview = true) {
    selected = inspection || null; linkedId = inspection?.id || null;
    $('field-result').hidden = !inspection;
    if (!inspection) { if (fillReview) onSelect(null); availability(); return; }
    form.elements.field.value = inspection.field;
    setBox(inspection.box);
    $('field-history').value = inspection.id;
    $('field-result-title').textContent = `Saved field: ${inspection.field}`;
    $('field-crop').src = localUrl(inspection.view.url);
    $('field-crop').alt = `Original-pixel crop for ${inspection.field}`;
    $('field-crop-link').href = localUrl(inspection.view.url);
    const size = inspection.nativeSizePx || inspection.view.sizePx;
    $('field-native-size').textContent = `${size.join(' × ')} native pixels · Original orientation retained`;
    $('field-crop-position').textContent = inspection.sourceBoxPx
      ? `Original crop: x ${inspection.sourceBoxPx[0]}, y ${inspection.sourceBoxPx[1]}, width ${inspection.sourceBoxPx[2]}, height ${inspection.sourceBoxPx[3]} px.`
      : 'The crop retains the original pixels around your selected field.';
    const metrics = $('field-diagnostics'); metrics.replaceChildren();
    const labels = { laplacianVariance: 'Laplacian variance', percentileContrast: 'Percentile contrast', brightPixelFraction: 'Bright pixel fraction' };
    for (const [key, label] of Object.entries(labels)) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label;
      const value = inspection.metrics?.[key];
      dd.textContent = Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '—';
      metrics.append(dt, dd);
    }
    setZoom(1);
    if (fillReview) onSelect(inspection);
    availability();
  }
  function renderHistory() {
    const history = $('field-history'); history.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a saved field'; placeholder.disabled = true;
    history.append(placeholder);
    inspections().forEach((inspection, index) => {
      const option = document.createElement('option'); option.value = inspection.id;
      option.textContent = `${index + 1}. ${inspection.field} · ${(inspection.nativeSizePx || []).join(' × ')} px`;
      history.append(option);
    });
    $('field-history-label').hidden = !inspections().length;
  }
  function render(capture) {
    const derived = capture?.analysis?.derived;
    root.hidden = !derived?.url;
    const changed = captureId !== (capture?.id || null);
    captureId = capture?.id || null;
    if (changed) {
      drag = null; selected = null; linkedId = null; imageReady = false;
      form.reset(); setBox(null); $('field-result').hidden = true;
      $('field-selection-note').textContent = 'Drag across the field, or enter its box as percentages below.';
      root.open = false;
      photo.removeAttribute('src');
      onSelect(null);
    }
    if (derived?.url) {
      const nextUrl = localUrl(derived.url);
      if (photo.src !== nextUrl) photo.src = nextUrl;
      imageReady = photo.complete && photo.naturalWidth > 0;
    }
    renderHistory();
    const currentSelection = inspections().find(item => item.id === selected?.id) || inspections().at(-1);
    if (currentSelection) { selectInspection(currentSelection); if (changed) root.open = true; }
    availability();
  }
  const point = event => {
    const rect = photo.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const end = point(event), [x, y] = drag.start;
    const next = [Math.min(x, end[0]), Math.min(y, end[1]), Math.abs(end[0] - x), Math.abs(end[1] - y)].map(round);
    next[2] = round(Math.min(next[2], 1 - next[0])); next[3] = round(Math.min(next[3], 1 - next[1]));
    setBox(next);
  }
  stage.addEventListener('pointerdown', event => {
    if (busy || !loaded || !imageReady || event.button !== 0 || inspections().length >= 6) return;
    event.preventDefault();
    drag = { start: point(event), pointerId: event.pointerId, previous: box };
    stage.setPointerCapture(event.pointerId); linkedId = null; onSelect(null);
    setBox(null);
  });
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    move(event);
    if (!validBox(box) || box[2] < 0.002 || box[3] < 0.002) setBox(drag.previous);
    drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    $('field-selection-note').textContent = validBox(box) ? 'Field box selected. Name the field, then inspect its original pixels.' : 'Drag across the field, or enter its box as percentages below.';
  });
  stage.addEventListener('pointercancel', event => {
    if (drag?.pointerId === event.pointerId) { setBox(drag.previous); drag = null; }
  });
  photo.addEventListener('load', () => { imageReady = true; });
  photo.addEventListener('error', () => {
    imageReady = false;
    $('field-selection-note').textContent = 'The selection image failed to load. Reload the saved session to restore it.';
  });
  coords.forEach(input => input.addEventListener('input', () => {
    linkedId = null; onSelect(null); const value = fromInputs(); setBox(validBox(value) ? value : null, false);
    $('field-selection-note').textContent = validBox(value)
      ? 'Field box selected from percentage coordinates.'
      : 'Enter left, top, width and height within the page. Left + width and top + height each fit within 100%.';
  }));
  form.elements.field.addEventListener('input', () => { linkedId = null; onSelect(null); });
  $('field-history').addEventListener('change', event => {
    const inspection = inspections().find(item => item.id === event.target.value);
    if (inspection) selectInspection(inspection);
  });
  root.querySelectorAll('[data-field-zoom]').forEach(button => button.addEventListener('click', () => setZoom(Number(button.dataset.fieldZoom))));
  $('review-form').elements.field.addEventListener('input', event => {
    if (event.target.value.trim() !== selected?.field) linkedId = null;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    run('Inspecting the field in the retained original…', async () => {
      const capture = getCapture(), field = form.elements.field.value.trim(), selectedBox = box;
      if (!field) throw new Error('Name the document field to inspect.');
      if (!validBox(selectedBox)) throw new Error('Draw a field box or enter valid percentage coordinates.');
      if (inspections().length >= 6) throw new Error('This photo has six saved field inspections. Choose a saved field to review.');
      const result = await api('/api/field', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ captureId: capture.id, field, box: selectedBox }) });
      const inspection = result.inspection || result;
      if (!inspection.id || inspection.captureId !== capture.id || !inspection.view?.url) throw new Error('The field response needs its saved capture and original crop.');
      capture.fieldInspections = [...(capture.fieldInspections || []).filter(item => item.id !== inspection.id), inspection];
      renderHistory(); selectInspection(inspection);
      $('field-selection-note').textContent = 'Original-pixel field observation saved. Compare its detail and confirm the value below.';
      status.textContent = 'Field crop saved with its original-pixel dimensions. Read and confirm the value below.';
    });
  });
  return {
    render,
    selectedInspection() { return selected?.id === linkedId ? selected : null; },
    setBusy(value, sessionLoaded) { busy = value; loaded = sessionLoaded; availability(); },
    reviewInspectionId(field, id) { return selected?.captureId === id && selected.field === field && linkedId === selected.id ? selected.id : null; }
  };
}
