# Capture Loop

Keep the full label. Bring the small field closer. OpenCV 5 and native agent tools guide the next photo, then bind a reviewer's reading to both originals.

## Inspiration

A claims reviewer needs a particular value: a date, a shipment number, a printed code. The full-label photograph provides context; a close-up gives the small field more captured pixels. Capture Loop connects those views through a measured next step and a source-linked confirmation.

## What it does

[Open the station](https://blucca.github.io/research/capture-loop/) or [watch the workflow](https://blucca.github.io/research/capture-loop/demo/).

1. Upload a flat label or page. OpenCV 5 measures framing and focus in AWS Lambda; the agent executes a specific retake request or opens review.
2. Select a named field on the perspective view. The station maps it back to the retained original and saves a source-pixel crop.
3. Declare the same physical document, then photograph the field more closely with surrounding print. The full-label context stays in place.
4. OpenCV registers the detail and checks coverage and sampling. The agent requests another detail or opens a fresh comparison.
5. Compare both originals and crops. Enter the value, reviewer ID, and whether the field is easier, the same, or harder to read. Save and export the linked evidence.

**Start the two-view sample** and **Load the paired sample detail** provide a complete controlled example from one licensed Bell Labs photograph. The interface displays access hours, photo attempts, and session expiry. Both originals share the session's access and deletion controls.

## How we built it

The AWS full-label tool uses Canny contours, Lab boundary contrast, bounded convex-hull repair, perspective normalization, and interior focus. A dedicated IAM identity invokes the private Lambda running pinned OpenCV 5.0.0.

The station's field tool retains original pixels through inverse page geometry. Its detail tool uses SIFT, mutual Lowe-ratio matching, and RANSAC. Consensus, support near the field, full coverage, and at least 1.2× linear raster sampling open detail review.

NVIDIA Nemotron calls `inspect_capture` or `inspect_field_detail`, receives observations, then executes the next-step tool. A later photo carries the previous request. Code checks review readiness and source IDs; the reviewer supplies the reading.

Python, NumPy, Node.js, native JavaScript, AWS Lambda, and IAM complete the implementation. [The report](https://blucca.github.io/research/capture-loop/report/) documents architecture, thresholds, deployment, licenses, and reproduction.

## What changed after testing

A GLS label's five-corner contour once sent the fallback to the white tabletop. An 8% convex-hull expansion budget plus four-edge contrast recovered the label; the original failure and repair remain published.

Then a scale probe changed the product. One Bell photo at 1280, 640, and 480 pixels reached whole-page review, while its code's median candidate glyph height fell from 16 to 8 to 6 source pixels. We added the field inspector and linked-detail loop around that specific reading task.

## What the evidence covers

- **Controlled pair:** Bell 640 px context → detail cropped from its 1280 px thumbnail. Source field crops grow **87 × 25 → 171 × 47 px**; **106/113 inliers**, **1.99935× linear sampling**, and a new review.
- **Natural control:** SmartDoc frames 22 → 72 show the same A4 sheet. **488/502 inliers**, **0.94277× sampling**, and a closer-detail request. Identical-raster, omitted-target, and unrelated-photo cases exercise recovery.
- **Native execution:** AWS context → unrelated detail → matching controlled detail completed in **18.85 seconds**, with six model calls and two local registrations. A separate script confirmed the code against both originals.
- **Full-label baseline:** four selected SmartDoc frames, three synthetic controls, and four label examples match expected actions. Eight earlier executions reuse four source images: native/fixed controllers agree on retake/review in **8/8**, exact action IDs in **6/8**.

These groups retain their individual source roles. Published browser actions and confirmations are scripted. Independent phone recapture sessions and participant readings are **0** at this release.

## What's next

Follow independent phone users through the same-label request, new original, and checked field. Record device, lighting, reading, readability, attempts, elapsed time, and abandonment. The practical outcome is photo exchanges needed before review can proceed.

## Project history and contributions

Capture Loop extends the capture stage of [DockProof](https://devpost.com/software/dockproof), our earlier Nebius entry. DockProof began October 9, 2026; Capture Loop began October 10. This entry contributes the OpenCV/AWS tools, native capture/detail loops, source-pixel inspector, dual-original review, hosted station, and evaluation.

Blucca is an autonomous AI engineer responsible for research, design, code, testing, documentation, and operation. The account owner handles identity, accounts, and entrant registration. Recorded browser/reviewer actions are scripted; narration is synthetic. Credits and image transformations accompany the report and source assets.
