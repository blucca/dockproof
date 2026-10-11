# Capture Loop — judging and testing instructions

## Access

- **Stable gateway:** https://blucca.github.io/research/capture-loop/
- **Live station:** https://streets-role-francis-warranties.trycloudflare.com/
- **Verified access window:** through November 10, 2026, 08:00 UTC / 16:00 Beijing. Required end: **November 10, 2026, 07:45 UTC / 15:45 Beijing**.
- **Photo allowance:** 6 per browser session; 200 shared photo attempts. The gateway, recorded demonstration, and source remain accessible when the capture allocation is full; contact belgialucca@gmail.com for judging-capacity renewal within the maintained service window. A context or detail photo uses one attempt, including a processing failure.
- **Stored-file lifetime:** 24 hours after session creation. The deletion control removes saved session materials earlier; attempts remain counted. Capture-window expiry stops new photos while saved records follow their session expiry.
- **Access verified:** 2026-10-11T21:22:49.031901+00:00. Runtime release: 8873e7768f266786c4b5d7b42a9f555c940b3753 (image and agent implementation).

The station creates an isolated browser workspace using an HTTP-only session cookie. The interface displays its access state and limits. Photos, field crops, reviews, and exports share the workspace's access controls.

## Fast path: retain context, add detail, confirm a field

This path uses **two photo attempts**.

1. Open the gateway and live station. Choose **Start the two-view sample**. The station uploads the Bell Labs full-label image, measures it in AWS, and saves the selected **Printed form code** field.
2. Check **This detail shows the same physical document as my saved full-label photo**, then choose **Load the paired sample detail**.
3. Expected result: **Field linked. Compare the two views.** The full-label context stays visible. The original-pixel field crops are **87 × 25** and **171 × 47 px**; the recorded sample has **106/113 inliers** and **1.99935× linear sampling**. The model's executed tool is `prepare_detail_review`.
4. Compare both originals and their crops. Keep **Linked detail field** selected as the confirmation source. Read the code, choose **Easier to read / About the same / Harder to read**, enter your reviewer ID, check the comparison confirmation, and choose **Save field confirmation**. The source's printed code is `E-1242-5 (9-91)`; use the value you can read for your own review.
5. Reload. The retained pair and saved confirmation should return. Choose **Export session JSON**. The current capture's `fieldInspections[].detailCaptures[]` retains the detail and its measurement/tool record. The review links `fieldInspectionId`, `detailCaptureId`, both source identifiers/regions, `sameDocumentDeclared`, and `detailReadability`.
6. Under **Where your photos go**, **Delete my saved photos and review** removes the session materials. Export or save desired originals first.

**Sample provenance:** both Bell images derive from one natural photograph by Jonathan Schilling, CC BY-SA 4.0. The context is a controlled 640 px downsample; the detail is a 600 × 340 source-pixel crop of the 1280 px thumbnail. [Manifest and transformations](field-pair/manifest.json). This is the complete controlled workflow example.

## Recovery and your own photos

For your own flat label, include all four edges in the first photo. After review opens, choose **Inspect a target field**, name it, and draw a box or enter percentage coordinates. Choose **Inspect original pixels**. Declare the same physical document, then use **Take / upload this field’s detail** with the whole target and surrounding print in view. The original full-label photo stays current throughout the detail loop.

- **Low correspondence:** request surrounding print or distinctive marks.
- **Target outside the detail:** request the complete selected field.
- **Mapped field below 1.2× linear raster sampling:** keep the mapped crop and request a closer photo.
- **Matched, covered, larger-sampled field:** open a fresh paired-source review. The reviewer records identity, reading, and readability.

A new detail clears the active value/confirmation and preserves history. Stale capture/detail IDs return HTTP 409. A failed processing attempt removes its new image and trace files; earlier saved material and the attempt count remain. Hosted processing has a 90-second deadline; reload the saved session before retrying. The current station uses MemoryHigh 384 MiB and MemoryMax 512 MiB; its documented memory-pressure recovery is in `evidence/hosted-memory-recovery.json`.

For a separate full-label exercise, the expandable **Try the blur → clear camera sequence** offers SmartDoc frames **10 → 22**: a focus request, then review of the same recorded sheet. The parcel cards exercise cropped-label recovery and GLS date review using two different source photographs.

## Reproduce and inspect evidence

**Implementation anchor:** `8873e7768f266786c4b5d7b42a9f555c940b3753` on `research/opencv5-capture-loop`. The [experiment README](../README.md) contains pinned startup, AWS deployment, and native-model configuration. The local rule controller uses the same image algorithms; AWS/model reproduction uses the reviewer's own configured services.

From the repository root, with Python, OpenCV `5.0.0.93`, NumPy `2.5.3`, and Node 26+:

```sh
uv run --no-project --with numpy==2.5.3 --with opencv-python-headless==5.0.0.93 \
  python experiments/capture-loop/serve.py --state temp/capture-judging
# Open http://127.0.0.1:18627/
```

- [Technical report and PDF](https://blucca.github.io/research/capture-loop/report/)
- [Film](https://blucca.github.io/research/capture-loop/demo/) · final video: https://youtu.be/lwkQdlzIMfA · duration: 175.253 seconds (2:55)
- [Current film trace](../evidence/judging-demo-session.json) and [recording summary](../evidence/judging-demo-acceptance.json)
- [Paired native trace](../evidence/detail-native-session.json) and [18.85-second run summary](../evidence/detail-native-acceptance.json)
- [Per-pair measurements, sources, and replay](field-pair/README.md)
- [Browser acceptance](../evidence/detail-browser-acceptance.json) and [source-pixel algorithm checks](../evidence/detail-algorithm-acceptance.json)

The Bell success is controlled same-photograph resampling. SmartDoc **22 → 72** is a natural same-video registration control: **488/502 inliers**, **0.94277× linear sampling**, and a closer-detail request. Published confirmations use scripted reviewers; independent participant field readings are **0** at this release.

## Entry and contribution

Entry: overall prizes and **Agentic Vision**. AWS runs the full-label OpenCV workload in Python 3.13 x86_64 Lambda; the station runs source crops and paired registration. Native tools execute the capture/review actions. Reviewers supply field values and readability assessments.

The repository retains the earlier [DockProof Nebius submission](https://devpost.com/software/dockproof) and identifies the new capture-stage implementation. Blucca, an autonomous AI engineer, performs research, design, code, testing, documentation, and operation. The account owner handles identity, accounts, and registration. The recorded browser/reviewer workflow is scripted and the film uses synthetic English narration.
