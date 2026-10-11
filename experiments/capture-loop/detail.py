"""Map a selected field from a planar context photo into a detail photo.

SIFT/RANSAC runs on bounded working images. The mapped field is saved as an
axis-aligned slice of the detail original. Pixel-footprint comparisons describe
the supplied rasters; the reviewer checks the print and confirms the same item.
"""
import argparse
import json
import math
import os
import time
from pathlib import Path

os.environ.setdefault('OPENCV_IO_MAX_IMAGE_PIXELS', '24000000')
import cv2
import numpy as np

from capture import sha

cv2.setNumThreads(2)

THRESHOLDS = {
    'maxInputPixels': 24_000_000,
    'minInputSidePx': 160,
    'maxWorkSidePx': 1600,
    'maxWorkPixels': 1_600_000,
    'maxFeaturesPerImage': 2400,
    'loweRatio': 0.75,
    'ransacReprojectionWorkPx': 3.0,
    'ransacMaxIterations': 3000,
    'ransacConfidence': 0.995,
    'minInliers': 12,
    'minInlierLocations': 12,
    'minInlierRatio': 0.4,
    'maxMedianReprojectionWorkPx': 1.5,
    'maxP95ReprojectionWorkPx': 3.0,
    'minDetailInlierHullFraction': 0.02,
    'minInlierAxisRatio': 0.035,
    'minLocalInliers': 6,
    'localSupportPaddingFieldDiagonals': 0.5,
    'minLocalSupportPaddingWorkPx': 20,
    'minTargetInlierHullCoverage': 0.5,
    'maxFieldPixels': 3_000_000,
    'minFieldSidePx': 6,
    'minFieldInteriorPixels': 16,
    'minLinearScaleRatio': 1.2,
}


def _read_image(path):
    try:
        image = cv2.imread(str(path))
    except cv2.error as error:
        raise ValueError('Decode failed. Use a JPEG or PNG photo up to 24 million pixels.') from error
    if image is None:
        raise ValueError('Decode failed. Use a JPEG or PNG photo.')
    height, width = image.shape[:2]
    if min(width, height) < THRESHOLDS['minInputSidePx'] or width * height > THRESHOLDS['maxInputPixels']:
        raise ValueError('Use a photo with at least 160 pixels per side and up to 24 million pixels.')
    return image


def _working_image(image):
    height, width = image.shape[:2]
    scale = min(1.0, THRESHOLDS['maxWorkSidePx'] / max(width, height),
                math.sqrt(THRESHOLDS['maxWorkPixels'] / (width * height)))
    size = (max(1, int(width * scale)), max(1, int(height * scale)))
    small = cv2.resize(image, size, interpolation=cv2.INTER_AREA) if scale < 1 else image
    sx, sy = size[0] / width, size[1] / height
    # OpenCV resize maps pixel centers: work = scale * (source + .5) - .5.
    transform = np.array([[sx, 0, (sx - 1) / 2], [0, sy, (sy - 1) / 2], [0, 0, 1.]])
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), transform


def _project(points, matrix):
    points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    homogeneous = np.column_stack((points, np.ones(len(points)))) @ matrix.T
    denominator = homogeneous[:, 2]
    if (np.abs(denominator) < 1e-8).any() or (denominator.min() < 0 < denominator.max()):
        raise ValueError('Keep the camera square to the field and include surrounding printed text.')
    return homogeneous[:, :2] / denominator[:, None]


def _box(quad, width, height):
    x0, y0 = np.maximum(0, np.floor(quad.min(axis=0))).astype(int)
    x1, y1 = np.minimum([width, height], np.ceil(quad.max(axis=0)) + 1).astype(int)
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def _area(points):
    return float(cv2.contourArea(np.asarray(points, dtype=np.float32)))


def _intersection_fraction(quad, polygon):
    intersection, _ = cv2.intersectConvexConvex(np.asarray(quad, dtype=np.float32),
                                               np.asarray(polygon, dtype=np.float32))
    return min(1.0, max(0.0, float(intersection) / _area(quad)))


def _native_field(image, quad, output):
    """Keep the source slice, interior-mask metrics and PNG contract of field.py."""
    height, width = image.shape[:2]
    x, y, w, h = _box(quad, width, height)
    if min(w, h) < THRESHOLDS['minFieldSidePx'] or w * h > THRESHOLDS['maxFieldPixels']:
        return None
    crop = image[y:y+h, x:x+w]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.round(quad - [x, y]).astype(np.int32), 255)
    mask = cv2.erode(mask, np.ones((3, 3), dtype=np.uint8), borderType=cv2.BORDER_CONSTANT,
                     borderValue=0)
    pixels = gray[mask > 0]
    if pixels.size < THRESHOLDS['minFieldInteriorPixels']:
        return None
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)[mask > 0]
    output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output), crop, [cv2.IMWRITE_PNG_COMPRESSION, 3]):
        raise ValueError('Saving the source-pixel detail crop failed. Retry the detail photo.')
    return {
        'sourceQuadPx': np.round(quad, 3).tolist(),
        'sourceBoxPx': [x, y, w, h],
        'nativeSizePx': [w, h],
        'metrics': {'laplacianVariance': round(float(laplacian.var()), 3),
                    'percentileContrast': round(float(np.percentile(pixels, 95) - np.percentile(pixels, 5)), 3),
                    'brightPixelFraction': round(float((pixels >= 245).mean()), 5),
                    'samplePixels': int(pixels.size)},
        'view': {'file': output.name, 'sha256': sha(output), 'sizePx': [w, h],
                 'operations': ['axis_aligned_source_pixel_crop', 'lossless_PNG_encode']},
    }


def register_detail(context_source, detail_source, inspection, output):
    """Return a JSON-serializable registration and optional native-pixel field.

    ``inspection`` comes from the retained context photo's field inspection and
    includes ``sourceSha256``. ``output`` is the PNG path for a mapped field.
    ``matched`` requires accepted geometry, local support, full target coverage
    and a >=1.2 linear source-pixel gain. A mapped lower-gain field is retained
    with ``needs_more_detail`` for side-by-side review.
    """
    started = time.perf_counter()
    output = Path(output)
    if output.suffix.lower() != '.png' or output.resolve() in {
            Path(context_source).resolve(), Path(detail_source).resolve()}:
        raise ValueError('Save the detail field to a separate PNG path.')
    context_sha = sha(context_source)
    if not isinstance(inspection, dict) or inspection.get('sourceSha256') != context_sha:
        raise ValueError('Select the field from this retained context photo before adding a detail photo.')
    context = _read_image(context_source)
    ch, cw = context.shape[:2]
    try:
        quad = np.asarray(inspection['sourceQuadPx'], dtype=np.float64)
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError('Select a four-corner field in the retained context photo.') from error
    if (quad.shape != (4, 2) or not np.isfinite(quad).all() or (quad < 0).any()
            or (quad[:, 0] > cw - 1).any() or (quad[:, 1] > ch - 1).any()
            or not cv2.isContourConvex(quad.astype(np.float32)) or _area(quad) < 16):
        raise ValueError('Select a complete, convex field inside the retained context photo.')
    context_size = inspection.get('nativeSizePx', _box(quad, cw, ch)[2:])
    if (not isinstance(context_size, list) or len(context_size) != 2
            or any(type(n) is not int or n < 6 for n in context_size)):
        raise ValueError('Select a fresh field spanning at least six source pixels per side.')
    context_work, context_transform = _working_image(context)
    del context
    detail = _read_image(detail_source)
    dh, dw = detail.shape[:2]
    detail_work, detail_transform = _working_image(detail)
    metrics = {'contextWorkPx': list(context_work.shape[::-1]),
               'detailWorkPx': list(detail_work.shape[::-1])}
    result = {
        'opencv': cv2.__version__, 'sourceSha256': sha(detail_source),
        'contextSourceSha256': context_sha, 'inputPx': [dw, dh],
        'scope': 'planar_visual_correspondence',
        'registration': {'method': 'SIFT_mutual_Lowe_ratio_RANSAC_homography',
                         'thresholds': THRESHOLDS.copy(), 'metrics': metrics,
                         'contextToDetailHomography': None},
        'comparison': {'contextNativeSizePx': context_size, 'detailNativeSizePx': None,
                       'fieldAreaRatio': None, 'linearScaleRatio': None,
                       'scope': 'supplied_raster_pixel_footprint'},
    }

    def finish(status, reason, request):
        result.update(status=status, reason=reason, request=request,
                      elapsedMs=round((time.perf_counter() - started) * 1000, 2))
        return result

    overlap_request = ('Keep the same label flat, include the target field plus two nearby lines of printed text, '
                       'and tap the text to focus before taking the detail photo.')
    sift = cv2.SIFT_create(nfeatures=THRESHOLDS['maxFeaturesPerImage'], contrastThreshold=0.025)
    ck, cd = sift.detectAndCompute(context_work, None)
    dk, dd = sift.detectAndCompute(detail_work, None)
    limit = THRESHOLDS['maxFeaturesPerImage']
    ck, dk = ck[:limit], dk[:limit]
    metrics.update(contextKeypoints=len(ck), detailKeypoints=len(dk))
    if cd is None or dd is None or min(len(ck), len(dk)) < THRESHOLDS['minInliers']:
        return finish('needs_overlap', 'few_visual_features', overlap_request)
    cd, dd = cd[:limit], dd[:limit]
    matcher = cv2.BFMatcher(cv2.NORM_L2)

    def distinctive(first, second):
        return {(m.queryIdx, m.trainIdx) for pair in matcher.knnMatch(first, second, k=2)
                if len(pair) == 2 for m, n in [pair] if m.distance < THRESHOLDS['loweRatio'] * n.distance}

    forward = distinctive(cd, dd)
    backward = {(j, i) for i, j in distinctive(dd, cd)}
    mutual = sorted(forward & backward)
    metrics.update(ratioMatches=len(forward), mutualMatches=len(mutual))
    if len(mutual) < THRESHOLDS['minInliers']:
        return finish('needs_overlap', 'few_distinct_matches', overlap_request)
    cp = np.array([ck[i].pt for i, _ in mutual], dtype=np.float64)
    dp = np.array([dk[j].pt for _, j in mutual], dtype=np.float64)
    matrix, mask = cv2.findHomography(cp, dp, cv2.RANSAC, THRESHOLDS['ransacReprojectionWorkPx'],
                                     maxIters=THRESHOLDS['ransacMaxIterations'],
                                     confidence=THRESHOLDS['ransacConfidence'])
    if matrix is None or mask is None or not np.isfinite(matrix).all():
        return finish('needs_overlap', 'homography_fit_failed', overlap_request)
    inliers = mask.ravel().astype(bool)
    count = int(inliers.sum())
    metrics.update(inliers=count, inlierRatio=round(count / len(mutual), 5))
    if count < THRESHOLDS['minInliers'] or count / len(mutual) < THRESHOLDS['minInlierRatio']:
        return finish('needs_overlap', 'weak_geometric_consensus', overlap_request)
    cp, dp = cp[inliers], dp[inliers]
    # SIFT may assign several orientations to one location; count its pixel once.
    unique_locations = min(len(np.unique(np.round(points), axis=0)) for points in (cp, dp))
    metrics['inlierLocations'] = unique_locations
    if unique_locations < THRESHOLDS['minInlierLocations']:
        return finish('needs_overlap', 'few_distinct_inlier_locations', overlap_request)
    try:
        forward_error = np.linalg.norm(_project(cp, matrix) - dp, axis=1)
        inverse_error = np.linalg.norm(_project(dp, np.linalg.inv(matrix)) - cp, axis=1)
        native_matrix = np.linalg.inv(detail_transform) @ matrix @ context_transform
        if abs(native_matrix[2, 2]) < 1e-12:
            raise ValueError('Unstable projection origin.')
        native_matrix /= native_matrix[2, 2]
        mapped = _project(quad, native_matrix)
    except (ValueError, np.linalg.LinAlgError):
        return finish('needs_overlap', 'unstable_projection', overlap_request)
    if not np.isfinite(mapped).all() or not cv2.isContourConvex(mapped.astype(np.float32)) or _area(mapped) < 1:
        return finish('needs_overlap', 'unstable_projection', overlap_request)
    hull = cv2.convexHull(dp.astype(np.float32))
    hull_fraction = _area(hull) / detail_work.size
    axes = [np.linalg.svd(points - points.mean(axis=0), compute_uv=False) for points in (cp, dp)]
    axis_ratio = min(float(s[1] / max(s[0], 1e-12)) for s in axes)
    median_error = max(float(np.median(forward_error)), float(np.median(inverse_error)))
    p95_error = max(float(np.percentile(forward_error, 95)), float(np.percentile(inverse_error, 95)))
    metrics.update(medianReprojectionWorkPx=round(float(np.median(forward_error)), 4),
                   p95ReprojectionWorkPx=round(float(np.percentile(forward_error, 95)), 4),
                   medianInverseReprojectionWorkPx=round(float(np.median(inverse_error)), 4),
                   p95InverseReprojectionWorkPx=round(float(np.percentile(inverse_error, 95)), 4),
                   detailInlierHullFraction=round(hull_fraction, 5), inlierAxisRatio=round(axis_ratio, 5))
    if (median_error > THRESHOLDS['maxMedianReprojectionWorkPx']
            or p95_error > THRESHOLDS['maxP95ReprojectionWorkPx']
            or hull_fraction < THRESHOLDS['minDetailInlierHullFraction']
            or axis_ratio < THRESHOLDS['minInlierAxisRatio']):
        return finish('needs_overlap', 'weak_match_distribution', overlap_request)
    result['registration']['contextToDetailHomography'] = native_matrix.tolist()
    field_ratio = _area(mapped) / _area(quad)
    result['comparison'].update(fieldAreaRatio=round(field_ratio, 5),
                                linearScaleRatio=round(math.sqrt(field_ratio), 5))
    frame = np.array([[0, 0], [dw - 1, 0], [dw - 1, dh - 1], [0, dh - 1]], dtype=np.float32)
    metrics['targetFrameCoverage'] = round(_intersection_fraction(mapped, frame), 5)
    if (mapped < 0).any() or (mapped[:, 0] > dw - 1).any() or (mapped[:, 1] > dh - 1).any():
        return finish('target_out_of_frame', 'target_partially_or_fully_outside_detail',
                      'Aim at the selected field in the full-label photo; include the complete field '
                      'and two nearby lines of printed text in the detail photo.')
    raw_size = _box(mapped, dw, dh)[2:]
    result['comparison']['detailNativeSizePx'] = raw_size
    target_work = _project(quad, context_transform)
    padding = max(THRESHOLDS['minLocalSupportPaddingWorkPx'],
                  np.linalg.norm(np.ptp(target_work, axis=0)) * THRESHOLDS['localSupportPaddingFieldDiagonals'])
    low, high = target_work.min(axis=0) - padding, target_work.max(axis=0) + padding
    local_points = cp[(cp >= low).all(axis=1) & (cp <= high).all(axis=1)]
    local = len(np.unique(np.round(local_points), axis=0))
    target_hull = _intersection_fraction(target_work, cv2.convexHull(cp.astype(np.float32)))
    metrics.update(localInliers=local, targetInlierHullCoverage=round(target_hull, 5),
                   localSupportPaddingWorkPx=round(float(padding), 3))
    if local < THRESHOLDS['minLocalInliers'] or target_hull < THRESHOLDS['minTargetInlierHullCoverage']:
        return finish('needs_overlap', 'target_needs_nearby_match_support', overlap_request)
    if raw_size[0] * raw_size[1] > THRESHOLDS['maxFieldPixels']:
        return finish('needs_more_detail', 'field_crop_limit',
                      'Select a smaller target field in the full-label view, then photograph that field '
                      'with nearby printed text; keep the mapped field within three million pixels.')
    field = _native_field(detail, mapped, output)
    if field is None:
        return finish('needs_more_detail', 'few_target_pixels',
                      'Move closer to the selected field, keep two nearby printed lines in view, '
                      'and tap the field to focus before taking a fresh photo.')
    result['field'] = field
    result['comparison']['detailNativeSizePx'] = field['nativeSizePx']
    if math.sqrt(field_ratio) < THRESHOLDS['minLinearScaleRatio']:
        return finish('needs_more_detail', 'small_source_pixel_gain',
                      'Move closer to enlarge the selected field in a fresh photo, retain two nearby '
                      'printed lines, and tap the field to focus.')
    return finish('matched', 'target_mapped_with_larger_pixel_footprint',
                  'Compare the mapped source-pixel field with the full-label context, confirm the same item, '
                  'and enter the printed value you can read.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Detail photograph')
    parser.add_argument('--context', required=True, help='Retained full-label photograph')
    parser.add_argument('--inspection', required=True, help='Context field inspection JSON')
    parser.add_argument('--output', required=True, help='Output directory')
    args = parser.parse_args()
    try:
        inspection = json.loads(Path(args.inspection).read_text())
        output = Path(args.output) / (Path(args.source).stem + '-field.png')
        result = register_detail(args.context, args.source, inspection, output)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, allow_nan=False))


if __name__ == '__main__':
    main()
