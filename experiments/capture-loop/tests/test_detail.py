"""Focused source-scale registration checks using the published Bell Labs photo.

Run with the capture loop's OpenCV 5 environment. CAPTURE_DETAIL_TEST_ROOT sets
the scratch directory. The pairs are controlled crops/scales of one photograph.
"""
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from capture import sha
from detail import THRESHOLDS, register_detail
from field import inspect_field
import cv2
import numpy as np


class DetailRegistration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.output = Path(os.environ.get('CAPTURE_DETAIL_TEST_ROOT', Path.cwd() / 'temp' / 'detail-tests'))
        cls.output.mkdir(parents=True, exist_ok=True)
        cls.samples = ROOT / 'docs' / 'field-source-scale'
        cls.context = cls.samples / 'bell-input-640.png'
        cls.full = cls.samples / 'bell-input-1280.png'
        record = json.loads((cls.samples / 'field-study.json').read_text())['records'][1]
        cls.inspection = {**record['field'], 'sourceSha256': sha(cls.context),
                          'nativeSizePx': record['field']['sourceBoxPx'][2:]}
        cls.analysis = record['pageObservation']
        full_image = cv2.imread(str(cls.full))
        cls.local = cls.output / 'bell-detail-local.png'
        cls.missing = cls.output / 'bell-detail-missing.png'
        cv2.imwrite(str(cls.local), full_image[590:930, 150:750])
        cv2.imwrite(str(cls.missing), full_image[180:650, 170:1120])
        (cls.output / 'inspection.json').write_text(json.dumps(cls.inspection, indent=2) + '\n')

    def register(self, name, source, inspection=None):
        path = self.output / (name + '-field.png')
        path.unlink(missing_ok=True)
        result = register_detail(self.context, source, inspection or self.inspection, path)
        (self.output / (name + '-result.json')).write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
        self.assertEqual(result['sourceSha256'], sha(source))
        self.assertEqual(result['contextSourceSha256'], sha(self.context))
        self.assertLessEqual(result['registration']['metrics']['contextKeypoints'], THRESHOLDS['maxFeaturesPerImage'])
        self.assertLessEqual(result['registration']['metrics']['detailKeypoints'], THRESHOLDS['maxFeaturesPerImage'])
        return result, path

    def assert_native_crop(self, source, result, path):
        original, saved = cv2.imread(str(source)), cv2.imread(str(path))
        field = result['field']
        x, y, w, h = field['sourceBoxPx']
        self.assertTrue(np.array_equal(saved, original[y:y+h, x:x+w]))
        self.assertEqual(field['nativeSizePx'], [w, h])
        self.assertEqual(field['view']['sizePx'], [w, h])
        self.assertEqual(field['view']['sha256'], sha(path))
        self.assertEqual(field['view']['operations'], ['axis_aligned_source_pixel_crop', 'lossless_PNG_encode'])
        self.assertLessEqual(w * h, THRESHOLDS['maxFieldPixels'])
        self.assertTrue(all(np.isfinite(value) for value in field['metrics'].values()))

    def test_controlled_double_scale_maps_original_pixels(self):
        result, path = self.register('full', self.full)
        self.assertEqual(result['status'], 'matched')
        self.assertAlmostEqual(result['comparison']['fieldAreaRatio'], 4.0, delta=0.08)
        self.assertAlmostEqual(result['comparison']['linearScaleRatio'], 2.0, delta=0.02)
        expected = np.asarray(self.inspection['sourceQuadPx']) * 2 + .5
        self.assertLess(float(np.linalg.norm(np.asarray(result['field']['sourceQuadPx']) - expected, axis=1).max()), 2)
        matrix = np.asarray(result['registration']['contextToDetailHomography'])
        mapped = cv2.perspectiveTransform(np.array([self.inspection['sourceQuadPx']], dtype=float), matrix)[0]
        self.assertTrue(np.allclose(mapped, result['field']['sourceQuadPx'], atol=.001))
        self.assert_native_crop(self.full, result, path)

    def test_partial_photo_maps_actual_page_inspection(self):
        # The interactive inspector selects an axis-aligned region in page-view
        # coordinates, yielding a slightly larger source quad than the study ROI.
        box = [0.05224436357806984, 0.894653258714778, 0.16944058509428248, 0.04246645361704937]
        inspection = inspect_field(self.context, self.analysis, box, self.output / 'context-field.png')
        inspection['sourceSha256'] = sha(self.context)
        result, path = self.register('local', self.local, inspection)
        self.assertEqual(result['status'], 'matched')
        self.assertAlmostEqual(result['comparison']['fieldAreaRatio'], 4.0, delta=0.1)
        expected = np.asarray(inspection['sourceQuadPx']) * 2 + .5 - [150, 590]
        self.assertLess(float(np.linalg.norm(np.asarray(result['field']['sourceQuadPx']) - expected, axis=1).max()), 2)
        metrics = result['registration']['metrics']
        self.assertGreaterEqual(metrics['localInliers'], THRESHOLDS['minLocalInliers'])
        self.assertGreaterEqual(metrics['targetInlierHullCoverage'], THRESHOLDS['minTargetInlierHullCoverage'])
        self.assertEqual(metrics['targetFrameCoverage'], 1)
        self.assert_native_crop(self.local, result, path)

    def test_existing_scale_retains_crop_and_requests_more_pixels(self):
        result, path = self.register('same', self.context)
        self.assertEqual(result['status'], 'needs_more_detail')
        self.assertEqual(result['reason'], 'small_source_pixel_gain')
        self.assertAlmostEqual(result['comparison']['linearScaleRatio'], 1, delta=.001)
        self.assert_native_crop(self.context, result, path)

    def test_missing_target_requests_target_in_frame(self):
        result, path = self.register('missing', self.missing)
        self.assertEqual(result['status'], 'target_out_of_frame')
        self.assertEqual(result['registration']['metrics']['targetFrameCoverage'], 0)
        self.assertNotIn('field', result)
        self.assertFalse(path.exists())

    def test_unrelated_label_requests_printed_overlap(self):
        result, path = self.register('unrelated', ROOT / 'domain' / 'images' / 'small-parcel.jpg')
        self.assertEqual(result['status'], 'needs_overlap')
        self.assertIn('printed text', result['request'])
        self.assertNotIn('field', result)
        self.assertFalse(path.exists())

    def test_inspection_is_bound_to_context_source(self):
        with self.assertRaisesRegex(ValueError, 'retained context photo'):
            register_detail(self.context, self.full, {**self.inspection, 'sourceSha256': '0' * 64},
                            self.output / 'bad-binding-field.png')


if __name__ == '__main__':
    unittest.main()
