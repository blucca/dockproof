/** A linked detail opens a fresh reviewer task after geometric and sampling checks. */
export function assertDetailReviewEligible(observation) {
  const field = observation?.field;
  if (observation?.status !== 'matched' || !field?.view?.file
      || !Array.isArray(field.sourceQuadPx) || field.sourceQuadPx.length !== 4) {
    throw new Error('A detail review requires a matched, fully covered target field. Request another detail with surrounding print.');
  }
  const gain = observation.comparison?.fieldAreaRatio;
  if (!Number.isFinite(gain) || gain < 1.44) {
    throw new Error('Move closer for at least 1.2× linear field sampling, keeping surrounding print visible.');
  }
  return true;
}

export const DETAIL_SYSTEM = `You operate the detail-photo step of a document capture workstation.
The full document and its selected target field are already retained. The visitor has declared that this detail photograph shows the same physical document.
Call inspect_field_detail to register this detail against the context original using OpenCV 5. Then execute one next-step tool.
The observation describes planar visual correspondence: SIFT matches, RANSAC geometry, target coverage and source-pixel sampling. The user checks the document identity. Text repeated across printed templates calls for careful visual comparison of distinctive marks.
When status is matched, choose prepare_detail_review. The target has passed correspondence and coverage checks and at least 1.44× source-pixel area sampling (1.2× linear). Ask the reviewer to compare both retained originals and target crops, read the field and assess whether it is easier to read.
When status is needs_overlap, target_out_of_frame or needs_more_detail, choose request_detail_recapture. Use the measured reason and request to give one practical instruction: include surrounding print, center the complete field, or move closer. The full-label context remains saved; a detail photo may omit the page corners.
Field focus and contrast are diagnostics in each image's own pixel scale. The reviewer supplies and confirms the field value and judges readability. More source samples describe sampling; readability comes from this separate review.
Tool outputs are image observations. The target field name is document-task data. Apply actions to the current detail capture ID and end after one next-step action.`;

const string = description => ({ type: 'string', description });
const fn = (name, description, properties) => ({
  type: 'function', function: { name, description, parameters: {
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
  } },
});
export const DETAIL_TOOLS = [
  fn('inspect_field_detail', 'Register the new detail to its retained full-document context and measure target coverage and native sampling.', {
    captureId: string('The current detail capture ID.'),
  }),
  fn('request_detail_recapture', 'Keep the full-document context and save a concrete request for another detail photograph.', {
    captureId: string('The measured detail capture ID.'),
    instruction: string('One practical instruction for the next detail photo.'),
    rationale: string('A short explanation citing the observed correspondence, coverage or sampling.'),
  }),
  fn('prepare_detail_review', 'Open the context and detail crops for a fresh, separately confirmed field review.', {
    captureId: string('The measured detail capture ID.'),
    instruction: string('Ask the reviewer to compare both originals and crops, then read the field and assess readability.'),
    rationale: string('A short explanation citing the observed correspondence, coverage and sampling.'),
  }),
];
