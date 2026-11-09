// The track: scroll position <-> time. Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { BEATS } = require("../app/js/script.js");
const track = require("../app/js/track.js");

const LINE = 40;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

/** Two paragraphs: the first has two lines of four words, the second one line of three. */
function sample({ markers = [], headingYs = [] } = {}) {
  const words = [];
  const line = (y, count, paragraph) => {
    for (let i = 0; i < count; i++) words.push({ y, paragraph });
  };
  line(100, 4, "p1");
  line(100 + LINE, 4, "p1");
  line(300, 3, "p2");
  return track.build({ words, durations: words.map(() => 1), markers, headingYs, endY: 400, readY: 150, lineHeight: LINE });
}

test("words get their times in order", () => {
  const t = sample();
  assert.deepEqual(t.wordUnits.slice(0, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
  close(t.wordUnits[8], 8 + BEATS.paragraph); // a pause for breath between paragraphs
  close(t.endUnits, 11 + BEATS.paragraph + BEATS.paragraph + BEATS.end);
});

test("each line is on the reading line half-way through its words", () => {
  const t = sample();
  close(t.yAt(2), 100); // words 0 to 3 are the first line
  close(t.yAt(6), 100 + LINE);
});

test("position and time convert both ways", () => {
  const t = sample();
  for (const u of [0, 0.5, 3.3, 7.9, 9, 10.2]) close(t.unitsAt(t.yAt(u)), u);
  assert.equal(t.yAt(-5), t.yAt(0));
  assert.equal(t.yAt(1e9), t.yAt(t.endUnits));
});

test("finding the word being said and the word on a line", () => {
  const t = sample();
  assert.equal(t.wordAtUnits(0), 0);
  assert.equal(t.wordAtUnits(2.99), 2);
  assert.equal(t.wordAtUnits(3), 3);
  assert.equal(t.wordAtUnits(1e9), 10);
  assert.equal(t.firstWordFrom(0), 0);
  assert.equal(t.firstWordFrom(101), 4);
  assert.equal(t.firstWordFrom(299), 8);
});

test("markers and headings add their beats where they sit", () => {
  const plain = sample();
  const marked = sample({ markers: [{ y: 200, seconds: null }, { y: 250, seconds: 2 }], headingYs: [270] });
  close(marked.wordUnits[8] - plain.wordUnits[8], 2 * BEATS.marker + BEATS.heading);
  assert.equal(marked.markers[0].seconds, null);
  assert.equal(marked.markers[1].seconds, 2);
  close(marked.markers[0].units, 8 + BEATS.marker);
  close(marked.yAt(marked.markers[0].units), 200); // the reading line stops exactly on the marker
  marked.markPassed(210 - marked.readY);
  assert.deepEqual(marked.markers.map((m) => m.passed), [true, false]);
});

test("scroll limits", () => {
  const t = sample();
  assert.equal(t.maxPos(), 400 - 150);
  assert.equal(t.clamp(-10), 0);
  assert.equal(t.clamp(1e6), t.maxPos());
  close(t.homePos(), t.yAt(0) - 150 < 0 ? 0 : t.yAt(0) - 150);
});

test("an empty script is safe", () => {
  const t = track.empty();
  assert.equal(t.wordAtUnits(3), -1);
  assert.equal(t.firstWordFrom(3), -1);
  assert.equal(t.maxPos(), 0);
  assert.equal(t.homePos(), 0);
  assert.ok(Number.isFinite(t.yAt(1)) && Number.isFinite(t.unitsAt(1)));
});
