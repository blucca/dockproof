# Capture Loop · OpenCV 5 + a tool-using capture agent

**Get a readable original before reviewing a printed value.** A photograph starts an evidence trail. Image measurements select a concrete capture request; a fresh photo continues the trail; the reviewer compares the retained original and a perspective-corrected view before recording a field.

![Actual agent-selected field review after AWS OpenCV measurement of an attributed SmartDoc camera frame](evidence/agent-review.png)

This research branch adds a capture stage to DockProof. The production claim-review application continues its existing workflow. The workstation supports the original **OpenCV 5 rule baseline** and a **live native-tool-calling model**, with optional AWS Lambda image measurement.

## Independent parcel photographs

[Four licensed shipping-label examples](domain/README.md) now extend the SmartDoc checks. A real GLS parcel exposed a five-corner paper-edge failure; a bounded convex-hull candidate recovers the label and leads to a readable-date review. The original failure, integrated local results, attribution and a reproducible check are public. The GLS case is a repair-development example; the remaining photos cover cropped, masked and blank-label controls. The AWS function currently runs the prior measurement build; the domain repair is local pending its next explicit deployment.

## Capture station interface

![Capture station desktop interface with a signal-yellow capture poster and the photo controls](evidence/station-desktop.png)

The station uses a warehouse-signage direction: condensed lettering, signal yellow, cobalt annotations, square controls, and a label-framing diagram. The mobile layout gives the photograph action its own full-width control. Original identifiers remain in the exported record; image captions focus on the source and the next review action. The locally bundled Barlow Condensed font is SIL Open Font License 1.1; see [`web/fonts/OFL.txt`](web/fonts/OFL.txt).

The updated interface completed the recorded SmartDoc frame 10 → frame 22 → scripted `Power Dissipation: 300 mW` confirmation. The saved review survived reload, the 390 px and 320 px layouts had no horizontal overflow, and no page errors occurred. [Mobile view](evidence/station-mobile.png) · [Field comparison](evidence/station-review-mobile.png) · [Acceptance record](evidence/station-acceptance.json). This interface run uses the local rule controller; the earlier AWS/model execution is recorded separately below.

## The agent's actual job

The model calls `inspect_capture`, receives numerical OpenCV observations, and chooses a next-step tool. `request_recapture` saves a concrete request and waits for a new original. `prepare_field_review` opens the source-versus-perspective comparison and waits for a reviewer. Field entry and confirmation use the separate review form.

```text
New original → model calls inspect_capture → OpenCV 5 (local or AWS Lambda)
                                           ↓ geometry, focus, available view
               model chooses request_recapture or prepare_field_review
                                           ↓
                          saved next step + native tool trace
```

`capture.measure()` returns observations. `capture.rule_policy()` serves the baseline. The agent receives geometry, numeric measurements and the available view; its selected function is executed and persisted by the workstation. The next photo carries the earlier request into the next model turn. Every model request passes the repository's persistent credit-budget guard.

The [initial live-agent failure](evidence/agent-initial-failure.json) exposed a useful interface error: the model read the old `frameMarginPx` tolerance as measured clearance and asked for another framing change on frame 22. The tool now distinguishes `frameContactTolerancePx` from `minObservedFrameGapPx`, and describes page area as composition context. The intake contract uses page geometry and focus to open the separate field-legibility review.

### Recorded AWS + model run

| New original | Actual cloud observation | Model-selected and executed tool |
| --- | --- | --- |
| SmartDoc frame 10 | Whole-frame focus **3.443**; outline missing | `request_recapture` → wait for a sharper original |
| Subsequent frame 22 | Four interior corners; focus **105.891**; measured edge clearance **193.2 px** | `prepare_field_review` → wait for the reviewer |

The [complete recorded session](evidence/agent-loop.json) contains **four successful native model requests**, the two AWS Lambda request IDs and each tool result. Both image measurements ran in **AWS Lambda, Python 3.13.15, x86_64, OpenCV 5.0.0**. A separate scripted reviewer then recorded `Power Dissipation: 300 mW`; model actions and that scripted confirmation have separate records. [Acceptance](evidence/agent-acceptance.json) and the [390 px interface check](evidence/agent-browser.json) describe the performed checks. These observations use two selected frames from the existing SmartDoc recording; the uploads and reviewer were scripted.

## Run the complete local workflow

From this branch of the DockProof repository:

```sh
uv run --no-project --with numpy==2.5.3 --with opencv-python-headless==5.0.0.93 \
  python experiments/capture-loop/serve.py --state temp/capture-loop
```

Open **http://127.0.0.1:18627/**. The server uses one local research case, stores its original files and review records in the chosen state directory, and uses two OpenCV CPU threads. JPEG and PNG uploads support images up to 8 MB / 24 megapixels.

1. Expand **Try recorded camera frames** and use **Frame 10**. The natural blur produces a request to steady the camera, focus on the printed text, and take a new complete photo.
2. Use **Frame 22**, a later natural view of the same sheet. The page boundary and focus measurements lead to field review.
3. Compare the full original and straightened view. For the sample, review `Power Dissipation` and `300 mW`, enter the reviewer role, and save the confirmation.
4. Export the session JSON. The state directory retains every original and derived image. New captures clear the active confirmation and preserve earlier reviews in the history.

Your own files use **Take / upload a photo**. The supported subject is one flat page or label with a visible boundary against a contrasting surface. The four-edge, focus and source-comparison steps form this experiment's review contract.

## Enable live agent decisions

Use **Node 26+**, the Python dependencies above, and a configured Nebius account. Set `NEBIUS_API_KEY`, `NEBIUS_MODEL` (`nvidia/nemotron-3-super-120b-a12b`) and `NEBIUS_BUDGET_FILE`. Create that private budget from the repository's `budget.example.json`, entering the actual confirmed credits, approved ceiling, model prices and expiry. Its initial zero-credit configuration pauses live requests until configured.

```sh
# Environment variables contain your own private provider and budget settings.
uv run --no-project --with numpy==2.5.3 --with opencv-python-headless==5.0.0.93 \
  python experiments/capture-loop/serve.py --state temp/capture-agent --controller agent
```

Use the same frame 10 → new frame 22 workflow. The interface shows the executed tool and its measurement-based explanation. The JSON export includes the native assistant tool calls, corresponding observation/action results and pending review state. Up to four model turns are available per photograph; provider failures pause that capture. For a standalone photograph, run `node experiments/capture-loop/agent.mjs --source IMAGE --output temp/capture-agent` with `CAPTURE_PYTHON` pointing to the Python environment containing OpenCV.

### Run the image tool on AWS

The [AWS package and deployment instructions](aws/README.md) provide a private synchronous Lambda measurement function. Set `CAPTURE_MEASURE_FUNCTION` to the deployed function name, `CAPTURE_AWS_CLI` to your AWS CLI executable or executable wrapper, and the normal AWS profile/region environment. Start the same workstation with `--controller agent`.

Here the model's `inspect_capture` call uploads the original to the configured Lambda function, executes OpenCV there, and returns measurements and the perspective image to the workstation. The model receives the numerical result; originals, derived views and reviewer confirmations remain in the workstation's evidence record. The cloud path accepts the image size supported by the synchronous Lambda payload; its connector reports the applicable limit before upload.

## What changed after natural-image testing

The original brightness-only probe selected the patterned background in all four selected natural frames, producing an incorrect edge request. The revised pipeline first searches for closed Canny quadrilaterals and measures Lab color contrast across each boundary. This selects the physical page on the textured background.

Strong blur can also erase the page outline. A whole-frame, fixed-width focus measurement handles that path and asks for focus recovery. A detected page receives perspective normalization and an interior focus measurement. The reviewer checks the needed printed value and intended document before confirmation.

| Selected natural observation | Measurement | Action | Recorded time |
| --- | --- | --- | --- |
| Frame 10 · natural blur | Whole-frame Laplacian variance 3.443 | Request sharper capture | 230.69 ms |
| Frame 22 · subsequent view | Four interior corners; normalized page focus 105.891 | Prepare field review | 122.88 ms |
| Frame 110 · natural blur | Whole-frame variance 12.574 | Request sharper capture | 54.71 ms |
| Frame 154 · natural blur | Whole-frame variance 5.405 | Request sharper capture | 49.99 ms |

The times are individual local observations; the first also includes initialization. Thresholds are **25** for the whole-frame fallback and **50** for the normalized page interior. Geometry development used frames 0 and 22, with frame 10 used for focus recovery; frames 110 and 154 are same-video checks. Frame selection covers this single printed sheet, camera recording, lighting and background. Shipping-label checks use the separately generated synthetic cases.

[evaluation.json](evaluation.json) contains the baseline failures, all four natural-frame measurements and three synthetic-label outcomes. [The recorded loop](evidence/recorded-loop.json) preserves the actual capture lineage, hashes and scripted `300 mW` confirmation. [Browser acceptance](evidence/browser-acceptance.json) covers upload → request → new photo → review, reload, stale-capture rejection, original bytes, current-review reset and 390 px layout. The uploader and reviewer in that run are explicitly scripted.

## Reproduce the selected checks

```sh
uv run --no-project --with numpy==2.5.3 --with opencv-python-headless==5.0.0.93 \
  python experiments/capture-loop/evaluate.py --output temp/capture-evaluation
```

The earlier three-case synthetic probe remains available as `probe.py`, with its original recorded run in `probe-result.json`. The new evaluation reports natural and synthetic observations separately.

## Source and license

Code and the original synthetic shipping label: repository MIT license. Natural SmartDoc camera frames: **CC BY 4.0**, with [full author attribution, source and transformation notes](fixtures/ATTRIBUTION.md). The screenshot above includes that attributed dataset. OpenCV: Apache-2.0; the Python wheel includes its third-party license files.

The candidate's next evaluation scope is independent shipping-label photography, including different phones, lighting, print sizes and backgrounds. The current natural-image observations cover the selected SmartDoc recording described above. The live agent and AWS execution are tracked separately from human use and confirmed fields.
