// Record mode's decisions: which format to record in, the size of a take, and how the camera picture
// is cropped to fill it. Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const recorder = require("../app/js/recorder.js");

test("records MP4 where the browser can, WebM where it can't", () => {
  assert.deepEqual(recorder.pickFormat(() => true), { type: recorder.FORMATS[0], extension: "mp4" });
  const webmOnly = (type) => type.startsWith("video/webm");
  assert.deepEqual(recorder.pickFormat(webmOnly), { type: "video/webm;codecs=vp9,opus", extension: "webm" });
  assert.deepEqual(recorder.pickFormat(() => false), { type: "", extension: "webm" }); // the browser's own choice
});

test("a take is 1080 x 1920 held upright and 1920 x 1080 sideways", () => {
  assert.deepEqual(recorder.outputSize(true), { width: 1080, height: 1920 });
  assert.deepEqual(recorder.outputSize(false), { width: 1920, height: 1080 });
});

test("the camera picture fills the take without stretching, centred", () => {
  // A landscape camera picture into an upright take: the sides are cropped.
  const c = recorder.coverCrop(1920, 1080, 1080, 1920);
  assert.ok(Math.abs(c.sw / c.sh - 1080 / 1920) < 1e-9, "same shape as the take");
  assert.equal(c.sh, 1080);
  assert.ok(Math.abs(c.sx - (1920 - c.sw) / 2) < 1e-9 && c.sy === 0, "centred");
  // A picture already the right shape is used whole, whatever its size.
  assert.deepEqual(recorder.coverCrop(720, 1280, 1080, 1920), { sx: 0, sy: 0, sw: 720, sh: 1280 });
  // A taller picture into a sideways take: top and bottom are cropped.
  const d = recorder.coverCrop(1080, 1920, 1920, 1080);
  assert.equal(d.sw, 1080);
  assert.ok(d.sy > 0 && Math.abs(d.sh - 1080 * 1080 / 1920) < 1e-9);
});

test("a take may run 10 minutes", () => {
  assert.equal(recorder.LIMIT, 600);
});
