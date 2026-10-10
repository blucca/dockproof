# Independent shipping-label domain check

A real GLS parcel photo exposed a geometry failure: the original contour approximation produced five corners around the paper label, then the brightness fallback selected the white tabletop as a 99.82% frame region. The resulting “include all four edges” request was wrong for this image.

The local measurement now tries a convex hull when a candidate's contour approximation fails the four-corner test. The hull may expand the contour area by at most 8%; the existing Lab contrast checks still apply. The GLS label is recovered with four interior corners, edge contrasts 64.23 / 62.19 / 85.83 / 87.46 and page-normalized Laplacian variance 340.928. Its next action is `prepare_document_review`. The handwritten date **12.08.2010** is visible in the source and perspective view.

## Selected examples

These examples come from Wikimedia Commons and are independent of the SmartDoc video. Three are photographs; the Korean label reproduction's acquisition hardware is unspecified by its source. All four carry explicit CC BY-SA licenses. [Attribution](ATTRIBUTION.md) and [manifest](manifest.json) preserve the source pages, authors, dates, original dimensions, download URLs and transformations.

| Example | Local result after repair | Field-review scope |
| --- | --- | --- |
| GLS parcel, label on cardboard over a light table | `prepare_document_review`, focus 340.928 | Handwritten date `12.08.2010`; source publisher obscured recipient fields. |
| Package reuse photo, partial shipping label at the right edge | `request_document_view`, full-frame focus 528.019 | The shipping label extends beyond the image. |
| Historical Bell Labs mailing-label pad on wood | `prepare_document_review`, focus 717.825 | Printed form code `E-1242-5 (9-91)` is visible. Shipment fields are blank. |
| Korean parcel label, near front-on and filling the frame | `request_document_view`, full-frame focus 3698.893 | Routing code `615` is visible; personal fields and shipment-number/barcode parts are masked in the published source. |

The GLS photo is a repair development example. The other three are controls for framing, content and background differences. These are selected examples with individual measurements, including publisher masking and blank fields; this check reports the capture action and visibly reviewable fields for each image.

[Before-repair results](before-repair.json) retain the original failure. [After-repair results](after-repair.json) are from an actual local run of the integrated code. [Prior regression](prior-regression.json) reuses the same-session check of the identical repair against the existing four SmartDoc frames and three synthetic label captures: all seven kept their expected actions. The new four-example run produced **4/4 expected actions**.

## Reproduce

From the repository root, using the capture loop's pinned OpenCV 5 environment:

```sh
python experiments/capture-loop/domain/evaluate-domain.py --output ../../temp/domain-check
```

The command assumes a repository checkout two directories below the workspace root and writes to the workspace’s `temp/` directory. For another checkout layout, set `--output` to that workspace’s `temp/` directory. It writes one JSON report and the available perspective views. It checks the local implementation; output paths refer to filenames within that output directory. The four included images are Wikimedia's official 1280-pixel thumbnails.

**Cloud follow-through, 2026-10-11 (UTC+08):** the existing private AWS Lambda was rebuilt and updated with this `capture.py`. A real browser click on the GLS sample produced the same four-corner outline and focus **340.928**. The native model executed `prepare_field_review`; a separate scripted reviewer saved **Date: 12.08.2010**. The cropped-label sample executed `request_recapture` for a complete document view. [Complete cloud/model session](../evidence/parcel-cloud-loop.json) and [deployment/browser record](../evidence/parcel-acceptance.json) preserve the two independent-source executions. The station exposes both photos with their attribution links.
