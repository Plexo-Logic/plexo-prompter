// Voice follow's matching. Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFollower, LOOKAHEAD } = require("../app/js/follow.js");

const WORDS = "the quick brown fox jumps over the lazy dog and then it runs far away into the woods".split(" ");
const UNITS = WORDS.map((_, i) => i);
const heard = (n) => WORDS.slice(Math.max(0, n - 6), n).join(" ");

test("nothing is known until something is heard", () => {
  const f = createFollower();
  f.startAt(0);
  assert.equal(f.saying(), -LOOKAHEAD);
  f.reset();
  assert.equal(f.saying(), null);
});

test("hearing words moves to the next word to be said", () => {
  const f = createFollower();
  f.startAt(0);
  f.hear("the quick brown", WORDS, UNITS, 0, 1000);
  assert.equal(f.saying(), 3); // "fox" is next
  f.hear(heard(6), WORDS, UNITS, 3, 1600);
  assert.equal(f.saying(), 6);
});

test("repeated words are matched in context", () => {
  const f = createFollower();
  f.startAt(0);
  f.hear(heard(7), WORDS, UNITS, 0, 1000); // ends on the second "the"
  assert.equal(f.saying(), 7);
});

test("unrelated speech does not move it", () => {
  const f = createFollower();
  f.startAt(0);
  f.hear("the quick brown", WORDS, UNITS, 0, 1000);
  f.hear("banana telephone orchestra", WORDS, UNITS, 3, 1500);
  assert.equal(f.saying(), 3);
});

test("a weak match far behind is ignored", () => {
  const f = createFollower();
  f.startAt(0);
  f.hear(heard(14), WORDS, UNITS, 12, 1000);
  const before = f.saying();
  f.hear("the", WORDS, UNITS, 14, 1500);
  assert.equal(f.saying(), before);
});

test("it glides on briefly after speech, then waits", () => {
  const f = createFollower();
  f.startAt(0);
  f.hear("the quick brown", WORDS, UNITS, 0, 1000);
  const start = f.saying();
  f.advance(0.5, 1200);
  assert.ok(f.saying() > start, "keeps moving just after a result");
  const capped = f.advance(10, 1300);
  assert.ok(capped - LOOKAHEAD <= start + 3 + 1e-9, "never runs far past what was heard");
  const waiting = f.saying();
  f.advance(1, 5000);
  assert.equal(f.saying(), waiting, "stops once the reader has been quiet a while");
});

test("moving by hand carries on from the new place", () => {
  const f = createFollower();
  f.startAt(0);
  f.moveTo(10 + LOOKAHEAD);
  assert.equal(f.saying(), 10);
});
