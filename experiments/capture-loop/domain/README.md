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
python experiments/capture-loop/domain/evaluate-domain.py --output ../domain-check
```

This writes one JSON report and the available perspective views to the supplied scratch directory. It checks the local implementation; output paths refer to filenames within that output directory. The four included images are Wikimedia's official 1280-pixel thumbnails.

**Deployment at this check:** local `capture.py` includes the repair. The existing AWS Lambda remains on the prior contour implementation from the previously deployed research version. Updating the local source changes the next deployment build; the cloud function requires an explicit rebuild and deployment before it uses this repair.
