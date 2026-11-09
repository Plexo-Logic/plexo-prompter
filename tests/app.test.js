// Settings and the script library, loaded the way the browser loads them, with a stand-in for
// localStorage. Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

/** Loads fresh copies of the modules, as on a first visit with empty storage. */
function loadApp() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.window = globalThis;
  // Just enough of a page for settings to apply themselves to.
  globalThis.document = { documentElement: { style: { setProperty() {} } }, body: { classList: { toggle() {} } } };
  globalThis.Plexo = { util: require("../app/js/core.js"), samples: [] };
  for (const name of ["settings.js", "library.js"]) {
    const file = path.join(__dirname, "..", "app", "js", name);
    delete require.cache[require.resolve(file)];
    require(file);
  }
  return globalThis.Plexo;
}

test("settings reject bad stored values", () => {
  const { settings } = loadApp();
  const clean = settings.sanitise(JSON.parse('{"fontSize": 9999, "theme": "evil", "customText": "red;}", "mode": "voice", "__proto__": {"polluted": true}}'));
  assert.equal(clean.fontSize, settings.DEFAULTS.fontSize);
  assert.equal(clean.theme, settings.DEFAULTS.theme);
  assert.equal(clean.customText, settings.DEFAULTS.customText);
  assert.equal(clean.mode, "voice");
  assert.equal({}.polluted, undefined);
  assert.equal(settings.sanitise("not an object").fontSize, settings.DEFAULTS.fontSize);
});

test("settings only change through valid updates", () => {
  const { settings } = loadApp();
  assert.equal(settings.update({ fontSize: -5 }), false);
  assert.equal(settings.update({ notASetting: 1 }), false);
  assert.equal(settings.update({ fontSize: 60 }), true);
  for (let i = 0; i < 100; i++) settings.nudge("fontSize", 1);
  assert.equal(settings.values.fontSize, settings.RANGES.fontSize.max);
  assert.equal(JSON.parse(localStorage.getItem("plexo.settings")).fontSize, settings.RANGES.fontSize.max);
});

test("saving the same new script twice keeps one copy", () => {
  const { library } = loadApp();
  const first = library.save(null, "", "");
  const second = library.save(null, "", "");
  assert.equal(first.id, second.id);
  assert.equal(library.count(), 1);
  assert.equal(first.name, "Untitled script");
});

test("different scripts with the same name get numbered", () => {
  const { library } = loadApp();
  assert.equal(library.add("Intro", "one").name, "Intro");
  assert.equal(library.add("intro", "two").name, "intro (2)");
  assert.equal(library.add("Intro", "one").name, "Intro"); // identical: the existing one comes back
  assert.equal(library.count(), 2);
});

test("rename, duplicate and delete", () => {
  const { library } = loadApp();
  const a = library.add("Pitch", "text");
  const b = library.add("Outro", "other");
  library.rename(b.id, "pitch");
  assert.equal(library.find(b.id).name, "pitch (2)");
  assert.equal(library.duplicate(a.id).name, "Pitch copy");
  library.remove(a.id);
  assert.equal(library.find(a.id), null);
  assert.equal(library.count(), 2);
});

test("recent puts the last opened first", async () => {
  const { library } = loadApp();
  const a = library.add("A", "a");
  library.add("B", "b");
  await new Promise((resolve) => setTimeout(resolve, 5)); // so "opened" is later than "added"
  library.markOpened(a.id);
  assert.equal(library.recent(1)[0].id, a.id);
  assert.equal(library.recent().length, 2);
});

test("scripts taken off Recent stay saved and come back when used again", async () => {
  const { library } = loadApp();
  const a = library.add("A", "a");
  const b = library.add("B", "b");
  library.removeFromRecent(a.id);
  assert.deepEqual(library.recent().map((s) => s.id), [b.id]);
  library.removeFromRecent();
  assert.equal(library.recent().length, 0);
  assert.equal(library.all().length, 2); // All scripts still has both
  assert.equal(JSON.parse(localStorage.getItem("plexo.library")).length, 2);

  await new Promise((resolve) => setTimeout(resolve, 5));
  library.markOpened(a.id);
  library.save(b.id, "B", "b, edited");
  assert.deepEqual(library.recent().map((s) => s.id), [b.id, a.id]);
});
