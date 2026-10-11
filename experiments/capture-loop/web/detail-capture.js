// A detail is a child of a saved field; the full-document context stays in place.
export function createDetailCapture({ api, run, localUrl, getState, getPairedSample, refresh, onReviewTarget, status }) {
  const $ = id => document.getElementById(id);
  const root = $('detail-capture');
  let inspection = null, currentKey = null, busy = false, loaded = false, reviewSource = 'context';
  const current = () => getState().captures.at(-1);
  const latest = () => inspection?.detailCaptures?.at(-1);
  const ready = () => latest()?.analysis?.action === 'prepare_detail_review' && latest()?.analysis?.status === 'matched';
  const selectedDetail = () => reviewSource === 'detail' && ready() ? latest() : null;
  const pairedSample = () => {
    const sample = getPairedSample();
    return sample?.context.sha256 === current()?.source.sha256 ? sample : null;
  };
  function availability() {
    const enabled = loaded && !busy && Boolean(inspection);
    $('detail-same-document').disabled = !enabled;
    $('detail-upload').disabled = !enabled || getState().captureReady === false || !$('detail-same-document').checked;
    $('detail-photo').disabled = $('detail-upload').disabled;
    $('detail-sample').disabled = $('detail-upload').disabled || !pairedSample();
    $('detail-review-source').disabled = !enabled || !ready();
    $('detail-readability').disabled = !enabled || !selectedDetail();
    root.setAttribute('aria-busy', String(busy));
  }
  function reviewTargetChanged() {
    $('detail-readability-row').hidden = !selectedDetail();
    onReviewTarget(selectedDetail());
    availability();
  }
  function linkImage(container, url, alt, caption, nativeSize = null) {
    const figure = document.createElement('figure');
    const link = document.createElement('a');
    link.href = localUrl(url); link.target = '_blank'; link.rel = 'noopener noreferrer';
    const image = document.createElement('img'); image.src = link.href; image.alt = alt;
    if (nativeSize) {
      image.style.width = `${nativeSize[0]}px`; image.style.height = `${nativeSize[1]}px`;
      figure.className = 'detail-pixel-figure';
    }
    link.append(image);
    const note = document.createElement('figcaption'); note.textContent = caption;
    figure.append(link, note); container.append(figure);
  }
  function render(value) {
    inspection = value;
    const detail = latest();
    const key = inspection ? `${current()?.id}:${inspection.id}:${detail?.id || ''}` : null;
    const changed = key !== currentKey;
    currentKey = key;
    root.hidden = !inspection;
    if (!inspection) { reviewSource = 'context'; if (changed) onReviewTarget(null); availability(); return; }
    if (changed) {
      reviewSource = ready() ? 'detail' : 'context';
      $('detail-same-document').checked = false;
      $('detail-readability').value = '';
    }
    $('detail-target').textContent = `Get a closer look at ${inspection.field}`;
    $('detail-sample').hidden = !pairedSample();
    $('detail-sample-note').hidden = !pairedSample();
    $('detail-context-link').href = localUrl(current().source.url);
    $('detail-result').hidden = !detail;
    $('detail-review-source').value = reviewSource;
    $('detail-review-source').querySelector('[value=detail]').disabled = !ready();
    $('detail-readability-row').hidden = !selectedDetail();
    $('detail-originals').replaceChildren();
    $('detail-crops').replaceChildren();
    $('detail-metrics').replaceChildren();
    if (detail) {
      const analysis = detail.analysis, field = analysis.field;
      $('detail-result-title').textContent = ready() ? 'Field linked. Compare the two views.' : 'Keep the context. Adjust the detail.';
      $('detail-request').textContent = analysis.request;
      $('detail-agent').hidden = !analysis.agent;
      $('detail-agent').textContent = analysis.agent
        ? `Agent executed ${analysis.agent.tool} · ${analysis.agent.rationale}` : '';
      linkImage($('detail-originals'), current().source.url, 'Retained full-document context', '01 / Full-document context retained');
      linkImage($('detail-originals'), detail.source.url, 'Retained detail photograph', `02 / Detail original · ${detail.source.width} × ${detail.source.height} px`);
      linkImage($('detail-crops'), inspection.view.url, 'Target pixels in the full-document context',
        `Context target · ${inspection.nativeSizePx.join(' × ')} px`, inspection.nativeSizePx);
      if (field) linkImage($('detail-crops'), field.view.url, 'Mapped target pixels in the detail photograph',
        `Detail target · ${field.nativeSizePx.join(' × ')} px`, field.nativeSizePx);
      const comparison = analysis.comparison || {};
      const ratio = comparison.linearScaleRatio;
      $('detail-sampling').textContent = Number.isFinite(ratio)
        ? `${ratio.toFixed(2)}× linear source-pixel sampling for the mapped field. Compare the print and tell us how it reads.`
        : 'The target mapping is still in progress. Follow the detail request above.';
      const entries = [['Correspondence', analysis.status], ['Reason', analysis.reason],
        ['Field area ratio', comparison.fieldAreaRatio],
        ...Object.entries(analysis.registration?.metrics || {}).map(([name, value]) => [name.replace(/([a-z])([A-Z])/g, '$1 $2'), value])];
      for (const [name, value] of entries) {
        if (value === undefined || value === null) continue;
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = name; dd.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
        $('detail-metrics').append(dt, dd);
      }
    }
    if (changed) reviewTargetChanged();
    availability();
  }
  $('detail-same-document').addEventListener('change', availability);
  $('detail-upload').addEventListener('click', () => $('detail-photo').click());
  async function uploadDetail(file, name) {
    if (!inspection || !$('detail-same-document').checked) throw new Error('Choose a saved field and confirm the same physical document.');
    const params = new URLSearchParams({ captureId: current().id, fieldInspectionId: inspection.id,
      name, sameDocument: 'true' });
    if (latest()) params.set('replacesDetail', latest().id);
    await api(`/api/detail?${params}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    await refresh();
    status.textContent = 'Detail saved alongside its full-document context. Follow the field result below.';
    $('detail-result-title').focus({ preventScroll: true });
    $('detail-result').scrollIntoView({ block: 'start' });
  }
  $('detail-sample').addEventListener('click', () => run('Matching the controlled sample detail to the saved label…', async () => {
    const sample = pairedSample();
    if (!sample) throw new Error('Start the two-view sample to use its paired detail.');
    const response = await fetch(localUrl(sample.detail.url));
    if (!response.ok) throw new Error('The sample detail failed to load. Reload the station to retry.');
    await uploadDetail(await response.blob(), sample.detail.name);
  }));
  $('detail-photo').addEventListener('change', () => {
    const file = $('detail-photo').files[0]; $('detail-photo').value = '';
    if (!file) return;
    run('Keeping the full label and matching this new detail to its target…', () => uploadDetail(file, file.name));
  });
  $('detail-review-source').addEventListener('change', event => {
    reviewSource = event.target.value; $('detail-readability').value = ''; reviewTargetChanged();
  });
  return {
    render,
    setBusy(value, sessionLoaded) { busy = value; loaded = sessionLoaded; availability(); },
    reviewPayload(field, captureId, inspectionId) {
      const detail = selectedDetail();
      if (!detail) return {};
      if (inspection?.captureId !== captureId || inspection.id !== inspectionId || inspection.field !== field) {
        throw new Error('Use the selected saved field name for this linked-detail review.');
      }
      const readability = $('detail-readability').value;
      if (!['easier', 'same', 'harder'].includes(readability)) throw new Error('Choose how the detail field reads compared with the context crop.');
      return { detailCaptureId: detail.id, detailReadability: readability };
    },
  };
}
