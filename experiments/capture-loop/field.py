"""Inspect a reviewer-selected field in the retained original's pixel grid.

The selection is expressed as left/top/width/height fractions of the page view.
The saved PNG is an axis-aligned source slice: interpolation is confined to the
existing page view used for selection. Field values are supplied by a reviewer.
"""
import math
from pathlib import Path

import cv2
import numpy as np

from capture import sha


def inspect_field(source, analysis, box, output):
    if (not isinstance(box, list) or len(box) != 4
            or any(type(n) not in (int, float) or not math.isfinite(n) for n in box)):
        raise ValueError('Select a field using four finite coordinates: left, top, width, height.')
    left, top, width, height = box
    if (min(left, top) < 0 or min(width, height) <= 0
            or left + width > 1.00000001 or top + height > 1.00000001):
        raise ValueError('Keep the complete field selection inside the page view.')
    view = analysis.get('derived') or analysis.get('perspectiveView')
    if analysis.get('geometry') != 'four_interior_corners' or not view:
        raise ValueError('Open a four-corner page review before selecting a field.')
    matrix = np.asarray(view['homography'], dtype=np.float64)
    ow, oh = view['sizePx']
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise ValueError('The page mapping needs a fresh capture.')
    corners = np.array([[[left * (ow - 1), top * (oh - 1)],
                         [min(1, left + width) * (ow - 1), top * (oh - 1)],
                         [min(1, left + width) * (ow - 1), min(1, top + height) * (oh - 1)],
                         [left * (ow - 1), min(1, top + height) * (oh - 1)]]], dtype=np.float64)
    quad = cv2.perspectiveTransform(corners, np.linalg.inv(matrix))[0]
    image = cv2.imread(str(source))
    if image is None:
        raise ValueError('The retained original needs a fresh capture.')
    ih, iw = image.shape[:2]
    if (not np.isfinite(quad).all() or (quad < -1).any()
            or (quad[:, 0] > iw).any() or (quad[:, 1] > ih).any()):
        raise ValueError('Select a region fully inside the retained original.')
    x0, y0 = np.maximum(0, np.floor(quad.min(axis=0))).astype(int)
    x1, y1 = np.minimum([iw, ih], np.ceil(quad.max(axis=0)) + 1).astype(int)
    if min(x1 - x0, y1 - y0) < 6:
        raise ValueError('Select a field spanning at least six source pixels on each side.')
    if (x1 - x0) * (y1 - y0) > 3_000_000:
        raise ValueError('Select a smaller target field covering up to three million source pixels.')
    crop = image[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.round(quad - [x0, y0]).astype(np.int32), 255)
    mask = cv2.erode(mask, np.ones((3, 3), dtype=np.uint8), borderType=cv2.BORDER_CONSTANT,
                     borderValue=0)
    pixels = gray[mask > 0]
    if pixels.size < 16:
        raise ValueError('Select a larger field region with at least sixteen interior source pixels.')
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)[mask > 0]
    output = Path(output)
    if not cv2.imwrite(str(output), crop, [cv2.IMWRITE_PNG_COMPRESSION, 3]):
        raise ValueError('Saving the original-pixel field crop failed. Select the field again.')
    return {
        'box': [float(n) for n in box],
        'sourceQuadPx': np.round(quad, 3).tolist(),
        'sourceBoxPx': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
        'nativeSizePx': [int(x1 - x0), int(y1 - y0)],
        'metrics': {'laplacianVariance': round(float(laplacian.var()), 3),
                    'percentileContrast': round(float(np.percentile(pixels, 95) - np.percentile(pixels, 5)), 3),
                    'brightPixelFraction': round(float((pixels >= 245).mean()), 5),
                    'samplePixels': int(pixels.size)},
        'view': {'file': output.name, 'sha256': sha(output),
                 'sizePx': [int(x1 - x0), int(y1 - y0)],
                 'operations': ['axis_aligned_source_pixel_crop', 'lossless_PNG_encode']},
        'scope': 'original_pixel_field_observation',
        'method': 'inverse_page_homography_to_retained_original',
        'opencv': cv2.__version__,
    }
