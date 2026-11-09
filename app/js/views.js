/**
 * Screens and browser history.
 *
 * The app has five screens: home, library, edit, prompt and setup. Each one apart from home is a
 * browser history entry, so Back, Forward and a mouse's back button move between them. `depth`
 * counts how many entries sit above home, which lets the Home button jump straight back.
 *
 * Modules register hooks with `define(name, { enter, leave, canLeave, restore })`:
 *   enter     the screen has just been shown
 *   leave     the screen is about to be hidden
 *   canLeave  return false to stay (for example, unsaved changes)
 *   restore   rebuild the screen from a history entry ({ id }) after Back or Forward
 */
(function (Plexo) {
  "use strict";

  const HASHES = { home: "", library: "#scripts", edit: "#edit", prompt: "#read", setup: "#setup" };
  const hooks = {};
  let current = "home";
  let currentId = null;
  let restoring = false;

  function define(name, handlers) {
    hooks[name] = handlers;
  }

  /** Shows a screen. `id` is stored in history so Back and Forward can reopen the same script. */
  function show(name, { id = null } = {}) {
    const previous = current;
    if (previous !== name) hooks[previous]?.leave?.();
    current = name;
    currentId = id;
    document.body.dataset.view = name;
    hooks[name]?.enter?.();
    if (!restoring && name !== "home" && name !== previous) {
      const depth = (history.state?.depth || 0) + 1;
      history.pushState({ view: name, id, depth }, "", HASHES[name] || "#");
    }
  }

  /** Updates the current history entry's script id (for example after saving a new script). */
  function setCurrentId(id) {
    currentId = id;
    if (history.state && history.state.view === current) history.replaceState({ ...history.state, id }, "", location.hash);
  }

  /** Back to home, whatever is open, by stepping back through history. */
  function goHome() {
    const depth = history.state?.depth || 0;
    if (current !== "home" && depth > 0) {
      history.go(-depth);
      return;
    }
    show("home");
    history.replaceState({ view: "home", depth: 0 }, "", location.pathname + location.search);
  }

  /** One step back, or home if there is nothing behind. */
  function goBack() {
    if ((history.state?.depth || 0) > 0) history.back();
    else goHome();
  }

  window.addEventListener("popstate", (event) => {
    const state = event.state || { view: "home", depth: 0 };
    const guard = hooks[current]?.canLeave;
    if (state.view !== current && guard && !guard()) {
      // Stay put: put back the entry the browser just left.
      history.pushState({ view: current, id: currentId, depth: (state.depth || 0) + 1 }, "", HASHES[current] || "#");
      return;
    }
    restoring = true;
    try {
      const restore = hooks[state.view]?.restore;
      if (restore) restore(state);
      else show(state.view in HASHES ? state.view : "home");
    } finally {
      restoring = false;
    }
  });

  /** Called once at start-up: whatever URL the page was opened with, start at home. */
  function start() {
    restoring = true;
    show("home");
    restoring = false;
    history.replaceState({ view: "home", depth: 0 }, "", location.pathname + location.search);
  }

  Plexo.views = { define, show, goHome, goBack, setCurrentId, start, current: () => current };
})(window.Plexo);
