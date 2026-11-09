// Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { html, raw, escapeHtml, formatDuration } = require("../app/js/core.js");
const script = require("../app/js/script.js");

test("html template escapes every value", () => {
  const name = `<img src=x onerror="alert(1)">`;
  const out = String(html`<b title="${name}">${name}</b>`);
  assert.ok(!out.includes("<img"));
  assert.ok(!out.includes(`"alert`));
  assert.equal(escapeHtml(`'&"`), "&#39;&amp;&quot;");
});

test("html template keeps trusted markup and nests", () => {
  const inner = html`<i>${"a < b"}</i>`;
  assert.equal(String(html`<p>${inner}${raw("<br>")}</p>`), "<p><i>a &lt; b</i><br></p>");
  assert.equal(String(html`<ul>${["x", "<y>"].map((v) => html`<li>${v}</li>`)}</ul>`), "<ul><li>x</li><li>&lt;y&gt;</li></ul>");
});

test("script text cannot inject markup", () => {
  const parsed = script.parse(`# <script>bad()</script>\n\nHello <b>there</b> [<img src=x>] *<u>em</u>*`);
  assert.ok(!/<script|<b>|<img|<u>/.test(parsed.html));
});

test("parses headings, paragraphs, pauses and markers", () => {
  const parsed = script.parse("# Hook\nFirst line here.\n\n[PAUSE]\n\nSecond, with a // breath [SMILE] and *emphasis*.\n\n[PAUSE 2]");
  assert.deepEqual(parsed.blocks.map((b) => b.type), ["heading", "paragraph", "pause", "paragraph", "pause"]);
  assert.equal(parsed.blocks[2].seconds, null);
  assert.equal(parsed.blocks[4].seconds, 2);
  assert.equal(parsed.words.length, 3 + 6); // cues and breath marks are not words
  assert.match(parsed.html, /class="cue">SMILE</);
  assert.match(parsed.html, /class="breath"/);
  assert.match(parsed.html, /class="emphasis"/);
});

test("hostile input is handled in linear time", () => {
  const started = Date.now();
  for (const text of ["[".repeat(2_000_000), "*".repeat(2_000_000), "[x".repeat(1_000_000)]) {
    script.parse(text);
    script.excerpt(text);
  }
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test("pauses are capped", () => {
  assert.equal(script.parse("[PAUSE 99999]").blocks[0].seconds, 600);
});

test("timing matches words per minute and adds holds, not waits", () => {
  const words = Array.from({ length: 150 }, () => "word").join(" ");
  const plain = script.timeline(script.parse(words), 150);
  assert.ok(Math.abs(plain.total - 60) < 1.5, `150 words at 150 wpm took ${plain.total}s`);

  const held = script.timeline(script.parse(`${words}\n\n[PAUSE 3]\n\n[PAUSE]`), 150);
  assert.equal(held.waits, 1);
  assert.equal(held.holdSeconds, 3);
  assert.ok(held.total > plain.total + 3);
});

test("punctuation and long words take longer", () => {
  const [short, long] = script.parse("cat, extraordinary").durations;
  assert.ok(long > short * 0.9);
  assert.ok(script.pauseAfter("end.") > script.pauseAfter("end,"));
  assert.equal(script.syllables("cat"), 1);
  assert.ok(script.syllables("extraordinary") >= 5);
});

test("empty scripts and trailing headings are handled", () => {
  const empty = script.timeline(script.parse(""), 150);
  assert.equal(empty.total, 0);
  assert.equal(empty.words, 0);
  const trailing = script.timeline(script.parse("Some words here.\n\n# Ending"), 150);
  assert.ok(trailing.total > 0);
  assert.equal(script.parse("   \n\n  ").words.length, 0);
});

test("helpers", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(75), "1:15");
  assert.equal(script.normaliseWord("Don’t!"), "dont");
  assert.ok(script.excerpt("# Title\n\nOne two three four").startsWith("One two"));
});

test("a stop marker says how to carry on on this device", () => {
  const text = "One.\n\n[PAUSE]\n\nTwo.";
  assert.match(script.parse(text).html, />Stop, press Space</);
  assert.match(script.parse(text, { stop: "Stop, tap the screen" }).html, />Stop, tap the screen</);
  assert.match(script.parse("[PAUSE 2]").html, />Pause 2s</);
});
