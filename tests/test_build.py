"""Run with:  python -m unittest discover tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build  # noqa: E402


class SamplesTest(unittest.TestCase):
    def test_samples_js_matches_the_scripts(self):
        built = build.OUTPUT.read_text(encoding="utf-8")
        self.assertEqual(built, build.render(), "app/js/samples.js is out of date: run python build.py")

    def test_samples_cannot_close_a_script_tag(self):
        self.assertNotIn("</", build.render())


if __name__ == "__main__":
    unittest.main()
