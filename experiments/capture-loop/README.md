# OpenCV 5 capture-loop feasibility probe

A label photograph can arrive blurred or cut off. This experiment uses image measurements to choose the next capture request, then prepares a perspective-corrected view for document review. The original images keep their own SHA-256 identities; derived views name their source and transformation.

## Run

From the DockProof repository:

```sh
uv run --no-project --with numpy==2.5.3 --with opencv-python-headless==5.0.0.93 \
  python experiments/capture-loop/probe.py \
  --source web/data/scans/synthetic-piece-label.png \
  --output temp/capture-loop
```

The command generates three controlled synthetic captures from the existing synthetic warehouse label, analyzes each image, and writes the capture trace and derived review view. OpenCV uses two CPU threads. The source label remains unchanged.

## Observed run

The committed `probe-result.json` records OpenCV 5.0.0 on Python 3.14.7 with NumPy 2.5.3.

| Capture | Visual measurement | Next action | Observed processing |
| --- | --- | --- | --- |
| Blur | Rectified Laplacian variance 0.453 | Ask for a sharper capture | 25.30 ms |
| Cut-off edges | Detected document touches the image frame | Ask for the full label edges | 7.20 ms |
| Complete, skewed label | Four interior corners; focus variance 668.548 | Prepare a rectified view for document review | 18.65 ms |

The uploader follows a scripted sequence. The controller uses fixed image-quality rules; the trace exposes the measurements that choose each action. The final action requests a comparison with the retained original before the printed values enter a claim worksheet.

## Scope and next experiment

The measured scope is one synthetic bright planar label, a plain contrasting background, and three generated captures. The focus threshold is a feasibility setting of 50. Natural capture calibration is the next product experiment: lighting, texture, small text and partial views need their own measurements and review actions.

A product extension would connect the image tools to a capture agent, preserve each original and its action history, and deploy the vision workload as a cloud component. The released DockProof review application retains its current intake and review flow while this research branch develops separately.

Source license: the existing DockProof synthetic label and this code use the repository's MIT license. OpenCV uses Apache-2.0; the Python wheel includes additional third-party license files.
