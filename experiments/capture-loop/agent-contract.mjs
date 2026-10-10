/** The executable measurement contract for opening a separate field review. */
export function assertFieldReviewEligible(observation) {
  const view = observation?.perspectiveView;
  if (observation?.geometry !== 'four_interior_corners'
      || typeof view?.file !== 'string' || !view.file.trim()) {
    throw new Error('A field-review task requires a measured four-corner perspective view.');
  }

  const metrics = observation.metrics;
  if (metrics?.touchesFrame !== false) {
    throw new Error('A field-review task requires measured clearance from the frame. Request a complete document view.');
  }
  const focus = metrics.laplacianVariance;
  const threshold = metrics.focusThreshold;
  if (!Number.isFinite(focus) || focus < 0
      || !Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('A field-review task requires finite page focus and a positive finite focus threshold. Inspect again or request a fresh photo.');
  }
  if (focus < threshold) {
    throw new Error(`Page focus ${focus} is below the measured threshold ${threshold}. Request a sharper capture.`);
  }
  return true;
}
