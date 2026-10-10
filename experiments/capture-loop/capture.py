"""OpenCV 5 measurements, with a separate rule policy for the local baseline."""
import hashlib
import os
import time
from pathlib import Path

os.environ.setdefault('OPENCV_IO_MAX_IMAGE_PIXELS', '24000000')
import cv2
import numpy as np

cv2.setNumThreads(2)

# Page-normalized focus threshold; the published split is in evaluation.json.
FOCUS_THRESHOLD = 50.0
FULL_FRAME_FOCUS_THRESHOLD = 25.0


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ordered_quad(points):
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums, diffs = points.sum(axis=1), points[:, 1] - points[:, 0]
    return np.array([points[sums.argmin()], points[diffs.argmin()],
                     points[sums.argmax()], points[diffs.argmax()]], dtype=np.float32)


def boundary_contrast(lab, polygon):
    """Measure both sides of each page edge, separating paper edges from text boxes."""
    points = polygon.reshape(4, 2).astype(float)
    center = points.mean(axis=0)
    offset = max(6, min(np.linalg.norm(points[(i + 1) % 4] - points[i]) for i in range(4)) * .025)
    h, w = lab.shape[:2]
    scores = []
    for i in range(4):
        a, b = points[i], points[(i + 1) % 4]
        normal = center - (a + b) / 2
        normal /= np.linalg.norm(normal)
        samples = a + (b - a) * np.linspace(.15, .85, 17)[:, None]
        inside = np.round(samples + normal * offset).astype(int)
        outside = np.round(samples - normal * offset).astype(int)
        all_points = np.concatenate([inside, outside])
        if (all_points < 0).any() or (all_points[:, 0] >= w).any() or (all_points[:, 1] >= h).any():
            scores.append(0.0)
            continue
        differences = np.linalg.norm(lab[inside[:, 1], inside[:, 0]] - lab[outside[:, 1], outside[:, 0]], axis=1)
        scores.append(round(float(np.median(differences)), 2))
    return scores


def measure(path, output):
    """Return visual observations and an available perspective view."""
    started = time.perf_counter()
    img = cv2.imread(str(path))
    if img is None:
        raise ValueError('Image decode failed. Use a JPEG or PNG photograph.')
    height, width = img.shape[:2]
    if min(height, width) < 160:
        raise ValueError('Use an image with at least 160 pixels on each side.')
    # Geometry is measured at a bounded resolution and returned in original pixels.
    scale = min(1.0, 1600 / max(height, width))
    small = cv2.resize(img, None, fx=scale, fy=scale) if scale < 1 else img
    h, w = small.shape[:2]
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    result = {'opencv': cv2.__version__, 'sourceSha256': sha(path),
              'inputPx': [width, height], 'method': 'edge_and_brightness_planar_document_v2',
              'metrics': {}}

    def finish(geometry):
        result.update(geometry=geometry,
                      elapsedMs=round((time.perf_counter() - started) * 1000, 2))
        return result

    edges = cv2.Canny(smooth, 30, 90)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    candidates = []
    for candidate in contours:
        area = cv2.contourArea(candidate)
        if area < w * h * .08:
            continue
        polygon = cv2.approxPolyDP(candidate, .025 * cv2.arcLength(candidate, True), True)
        if len(polygon) == 4 and cv2.isContourConvex(polygon):
            contrast = boundary_contrast(lab, polygon)
            if min(contrast) >= 12:
                candidates.append((area, candidate, polygon, contrast))
    if candidates:
        _, contour, polygon, contrast = max(candidates, key=lambda item: item[0])
        result['metrics'].update(boundaryMethod='closed_edge_quad', edgeContrastLab=contrast)
    else:
        _, mask = cv2.threshold(smooth, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = [c for c in contours if cv2.contourArea(c) > w * h * .12]
        contour = max(candidates, key=cv2.contourArea) if candidates else None
        polygon = cv2.approxPolyDP(contour, .025 * cv2.arcLength(contour, True), True) if contour is not None else []
        result['metrics']['boundaryMethod'] = 'brightness_fallback'
    if contour is None or len(polygon) != 4 or not cv2.isContourConvex(polygon):
        # A severely blurred page can lose its closed outline. Check the whole
        # image before asking the uploader to change the background or framing.
        focus_view = cv2.resize(gray, (1000, max(1, round(1000 * h / w))))
        full_focus = float(cv2.Laplacian(focus_view, cv2.CV_64F).var())
        result['metrics'].update(fullFrameLaplacianVariance=round(full_focus, 3),
                                 fullFrameFocusThreshold=FULL_FRAME_FOCUS_THRESHOLD)
        return finish('outline_missing')
    x, y, bw, bh = cv2.boundingRect(contour)
    margin = max(5, round(min(w, h) * .008))
    touches = x < margin or y < margin or x + bw > w - margin or y + bh > h - margin
    result['metrics'].update(polygonCorners=len(polygon), touchesFrame=touches,
                             frameContactTolerancePx=round(margin / scale, 2),
                             minObservedFrameGapPx=round(min(x, y, w - x - bw, h - y - bh) / scale, 2),
                             documentAreaRatio=round(cv2.contourArea(contour) / (w * h), 4))
    if touches:
        return finish('boundary_touches_frame')
    quad = ordered_quad(polygon / scale)
    top, right, bottom, left = [np.linalg.norm(quad[(i + 1) % 4] - quad[i]) for i in range(4)]
    ow, oh = 1000, max(1, round(1000 * max(left, right) / max(top, bottom)))
    # Bound extreme geometry for this planar page / label experiment.
    if oh < 250 or oh > 2400 or len(np.unique(quad, axis=0)) < 4:
        return finish('extreme_perspective')
    matrix = cv2.getPerspectiveTransform(quad, np.array(
        [[0, 0], [ow - 1, 0], [ow - 1, oh - 1], [0, oh - 1]], dtype=np.float32))
    rectified = cv2.warpPerspective(img, matrix, (ow, oh))
    rectgray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    inset = max(8, round(min(ow, oh) * .04))
    roi = rectgray[inset:-inset, inset:-inset]
    focus = float(cv2.Laplacian(roi, cv2.CV_64F).var())
    result['metrics'].update(laplacianVariance=round(focus, 3), focusThreshold=FOCUS_THRESHOLD)
    result['documentQuadPx'] = np.round(quad, 3).tolist()
    derived = Path(output) / (Path(path).stem + '-rectified.jpg')
    if not cv2.imwrite(str(derived), rectified, [cv2.IMWRITE_JPEG_QUALITY, 95]):
        raise ValueError('Saving the review image failed. Retry the photo.')
    result['perspectiveView'] = {'file': derived.name, 'sha256': sha(derived),
                         'operations': ['perspective_rectification', 'JPEG_encode_quality_95'],
                         'homography': matrix.tolist(), 'sizePx': [ow, oh]}
    return finish('four_interior_corners')


def rule_policy(observation):
    """The existing baseline policy; the tool-using agent receives measure() only."""
    metrics, geometry = observation['metrics'], observation['geometry']
    if geometry == 'outline_missing':
        if metrics['fullFrameLaplacianVariance'] < FULL_FRAME_FOCUS_THRESHOLD:
            return ('request_sharper_capture',
                    'Hold the camera steady, tap the printed text to focus, and wait for the letters to sharpen. Keep the whole page in view, then take a fresh photo.')
        return ('request_document_view',
                'Place one page or label flat on a darker, plain surface. Include its four corners and move close enough to read the print, then take a fresh photo.')
    if geometry == 'boundary_touches_frame':
        return ('request_full_edges',
                'Step back slightly. Include all four page edges and a narrow strip of the darker surface around them, then take a fresh photo.')
    if geometry == 'extreme_perspective':
        return ('request_document_view',
                'Point the camera more squarely at the page and include its four corners.')
    if metrics['laplacianVariance'] < FOCUS_THRESHOLD:
        return ('request_sharper_capture',
                'Rest your elbows or the camera on a steady surface. Tap the printed text to focus, wait for it to settle, then take a fresh photo.')
    return ('prepare_document_review',
            'Compare the printed value in the original with the straightened view. Enter the field you have checked and confirm that the same document is shown.')


def inspect(path, output):
    result = measure(path, output)
    action, request = rule_policy(result)
    view = result.pop('perspectiveView', None)
    if view and action == 'prepare_document_review':
        result['derived'] = view
    result.update(controller='fixed_visual_rules', action=action, request=request)
    return result
