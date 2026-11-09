/**
 * The app shell: opening scripts in the prompter, keyboard shortcuts, drag and drop, the
 * animation loop and start-up. Loaded last, once every module exists.
 */
(function (Plexo) {
  "use strict";

  const { $, toast } = Plexo.util;
  const { settings, library, views, prompter, voice, panel, browse, editor, setup } = Plexo;

  /* ---------- opening scripts ---------- */

  /** Opens a script in the prompter. */
  function read(script) {
    if (!script) return;
    if (script.source === "saved") library.markOpened(script.id);
    views.show("prompt", { id: script.id });
    prompter.open(script);
    keepAwake(true);
  }

  views.define("prompt", {
    leave: () => {
      keepAwake(false);
      prompter.stop();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      const script = prompter.current();
      if (script && script.source === "saved") browse.select(script.id);
    },
    restore: (state) => {
      const script = library.find(state.id);
      if (script) read(script);
      else views.show("home");
    },
  });

  // Live updates: if the open script's file changes in the Scripts folder, reload it in place.
  library.onChange((change) => {
    if (change.kind !== "folder") return;
    if (change.added.length) toast(`New in your Scripts folder: ${change.added.map((s) => s.name).join(", ")}`);
    const open = prompter.current();
    const updated = open && open.source === "folder" && change.updated.find((s) => s.id === open.id);
    if (updated && views.current() === "prompt") {
      prompter.open(updated, { keepPlace: true });
      toast(`Updated: ${updated.name}`);
    }
  });

  async function importFiles(files) {
    const { added, ignored } = await library.importFiles(files);
    if (!added.length) {
      if (ignored) toast("Choose plain text files (.txt).");
      return;
    }
    browse.show("saved", added[added.length - 1].id);
    toast(added.length > 1 ? `Added ${added.length} scripts, with their timings` : `Added ${added[0].name}, with its timings`);
  }

  const chooseFiles = () => $("#file-input").click();

  /* ---------- commands (buttons with data-command) ---------- */

  const COMMANDS = {
    "new-script": () => editor.open(null),
    "open-file": chooseFiles,
    "use-folder": () => browse.useFolder(),
    "show-library": () => browse.show("saved"),
    tutorial: () => read(library.tutorial()),
    setup: () => setup.open(),
    "show-display": () => panel.open("display"),
    "show-help": () => panel.open("help"),
    home: () => views.goHome(),
    "edit-current": () => {
      const script = prompter.current();
      if (script) editor.open(library.find(script.id) || script);
    },
    "toggle-settings": () => panel.toggle("display"),
    restart: () => prompter.restart(),
    "paragraph-back": () => prompter.jumpParagraph(-1),
    "paragraph-forward": () => prompter.jumpParagraph(1),
    play: () => prompter.togglePlay(),
    slower: () => settings.nudge("wordsPerMinute", -1),
    faster: () => settings.nudge("wordsPerMinute", 1),
    smaller: () => settings.nudge("fontSize", -2),
    bigger: () => settings.nudge("fontSize", 2),
    "next-highlight": () => cycle("highlight", settings.HIGHLIGHTS, { word: "Highlight: current word", karaoke: "Highlight: karaoke", off: "Highlight off" }),
    "next-theme": () => cycle("theme", Object.keys(settings.THEMES), Object.fromEntries(Object.entries(settings.THEMES).map(([k, t]) => [k, t.name]))),
    "toggle-voice": () => voice.toggleMode(),
    fullscreen: toggleFullscreen,
  };

  /** Moves a setting to the next value in a list and says what it is now. */
  function cycle(key, options, names) {
    const next = options[(options.indexOf(settings.values[key]) + 1) % options.length];
    settings.update({ [key]: next });
    toast(names[next]);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command]");
    if (!button || !COMMANDS[button.dataset.command]) return;
    // After a mouse click or tap, give focus back, so Space goes on meaning play and pause.
    // A click from the keyboard (detail 0) keeps focus where the user put it.
    if (event.detail > 0) button.blur();
    COMMANDS[button.dataset.command]();
  });

  /* ---------- keyboard ---------- */

  const PROMPTER_KEYS = {
    " ": () => prompter.togglePlay(),
    PageDown: () => prompter.togglePlay(),
    Enter: () => prompter.togglePlay(),
    ArrowRight: (event) => prompter.jumpParagraph(1, event.shiftKey),
    ArrowLeft: (event) => prompter.jumpParagraph(-1, event.shiftKey),
    PageUp: () => (voice.effectiveMode() === "manual" ? prompter.stepLine(-1) : prompter.jumpParagraph(-1)),
    ArrowUp: () => (voice.effectiveMode() === "manual" ? prompter.stepLine(-1) : settings.nudge("wordsPerMinute", 1)),
    ArrowDown: () => (voice.effectiveMode() === "manual" ? prompter.stepLine(1) : settings.nudge("wordsPerMinute", -1)),
    Home: () => prompter.restart(),
    "+": () => settings.nudge("fontSize", 2),
    "=": () => settings.nudge("fontSize", 2),
    "-": () => settings.nudge("fontSize", -2),
    _: () => settings.nudge("fontSize", -2),
    "[": () => settings.nudge("columnWidth", -2),
    "]": () => settings.nudge("columnWidth", 2),
    t: COMMANDS["next-theme"],
    k: COMMANDS["next-highlight"],
    m: () => settings.update({ mirror: !settings.values.mirror }),
    f: toggleFullscreen,
    h: () => document.body.classList.toggle("hide-controls"),
    s: () => panel.toggle("display"),
    v: () => voice.toggleMode(),
  };

  function onKey(event) {
    if (Plexo.dialog.isOpen()) return; // the dialog handles its own keys
    const view = views.current();
    if (view === "edit") return editor.handleKey(event);
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
      if (event.key === "Escape") event.target.blur();
      return;
    }
    if (view === "setup") return setup.handleKey(event);
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // A button the user tabbed to handles its own Space and Enter. (Clicked buttons let go of focus below.)
    if ((event.key === " " || event.key === "Enter") && event.target.closest("button")) return;

    if (event.key === "Escape") {
      const menu = $(".menu.on");
      if (menu) browse.closeMenus();
      else if (panel.isOpen()) panel.close();
      else if (view === "prompt" && prompter.pause()) return;
      else if (view !== "home") views.goHome();
      return;
    }
    if (view === "home") {
      const shortcut = { n: COMMANDS["new-script"], o: chooseFiles }[event.key.toLowerCase()];
      if (shortcut) {
        event.preventDefault(); // otherwise the letter lands in the editor that N has just opened
        shortcut();
      }
      return;
    }
    if (view === "library") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        browse.moveSelection(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Enter" && !event.target.closest("button, a")) read(browse.selected());
      return;
    }
    if (view !== "prompt") return;
    const action = PROMPTER_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action) return;
    event.preventDefault();
    action(event);
  }

  document.addEventListener("keydown", onKey);

  /* ---------- mouse, touch and files ---------- */

  const viewport = $("#viewport");
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      prompter.scrollBy(event.deltaY * 0.6);
    },
    { passive: false }
  );

  // Mouse: click a paragraph to jump to it. Touch: tap to start or pause, drag to scroll by hand.
  const TAP_SLOP = 10; // pixels a finger can drift and still count as a tap
  let lastPointer = "mouse";
  let finger = null;

  $("#script-text").addEventListener("click", (event) => {
    const block = lastPointer === "mouse" && event.target.closest("p, .heading");
    if (block) prompter.jumpToBlock(block);
  });
  viewport.addEventListener("pointerdown", (event) => {
    lastPointer = event.pointerType;
    if (event.pointerType === "mouse") return;
    finger = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, dragging: false };
    try {
      viewport.setPointerCapture(event.pointerId); // keep following the finger if it leaves the text
    } catch {
      /* not capturable, for example a synthetic event: the drag still works while over the text */
    }
  });
  viewport.addEventListener("pointermove", (event) => {
    if (finger?.id !== event.pointerId) return;
    if (Math.abs(event.clientY - finger.startY) > TAP_SLOP) finger.dragging = true;
    if (finger.dragging) prompter.scrollBy(finger.lastY - event.clientY);
    finger.lastY = event.clientY;
  });
  const releaseFinger = (event) => {
    if (finger?.id !== event.pointerId) return;
    if (event.type === "pointerup" && !finger.dragging) prompter.togglePlay();
    finger = null;
  };
  viewport.addEventListener("pointerup", releaseFinger);
  viewport.addEventListener("pointercancel", releaseFinger);

  // Hide the controls and cursor while the text is moving and nobody is touching anything.
  let idleTimer = 0;
  const hideSoon = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (views.current() === "prompt" && prompter.isMoving()) document.body.classList.add("idle");
    }, 2500);
  };
  const wake = () => {
    document.body.classList.remove("idle");
    hideSoon();
  };
  document.addEventListener("pointermove", wake);
  document.addEventListener("pointerdown", wake);
  // Starting with the space bar or a clicker, the mouse may never move: hide the controls all the same.
  document.addEventListener("keydown", hideSoon);

  // Keep a phone or tablet screen on while the prompter is open.
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && "wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      } else if (!on && wakeLock) {
        await wakeLock.release();
      }
    } catch {
      wakeLock = null; // not allowed right now, for example in a background tab
    }
  }
  // The browser drops the lock when the app is hidden; take it back on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && views.current() === "prompt") keepAwake(true);
  });

  $("#file-input").addEventListener("change", (event) => {
    importFiles(event.target.files);
    event.target.value = "";
  });

  let dragDepth = 0;
  const dropZone = $("#drop-zone");
  const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  window.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    dropZone.classList.add("on");
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.classList.remove("on");
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("on");
    if (event.dataTransfer.files.length) importFiles(event.dataTransfer.files);
  });

  window.addEventListener("resize", () => prompter.relayout());

  /* ---------- animation loop ---------- */

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!prompter.isMoving()) document.body.classList.remove("idle");
    voice.tick();
    if (views.current() === "setup") Plexo.preview.tick(dt);
    prompter.tick(dt, now);
    requestAnimationFrame(frame);
  }

  /** Keeps the control bar's toggle buttons lit to match the settings. */
  function syncControls() {
    const voiceButton = $('[data-command="toggle-voice"]');
    voiceButton.classList.toggle("on", voice.effectiveMode() === "voice");
    $('[data-command="next-highlight"]').classList.toggle("on", settings.values.highlight !== "off");
  }
  settings.onChange(syncControls);
  voice.onAvailabilityChange(syncControls);

  /* ---------- start-up ---------- */

  Plexo.app = { read };

  (async function start() {
    settings.applyToDocument();
    prompter.syncReadouts();
    syncControls();
    // Give the Scripts folder a moment so the first screen can show it, but never wait on it:
    // the screens redraw themselves when it arrives.
    await Promise.race([library.startWatching(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    views.start();
    if (!setup.isDone()) setup.open();
    // The hosted version keeps working offline after the first visit (sw.js). The launcher doesn't need it.
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
    const { movedFrom } = library.folder();
    if (movedFrom) {
      toast(`Port ${movedFrom} was busy, so Plexo Prompter opened on port ${location.port}. Scripts you saved before are safe, and come back once port ${movedFrom} is free.`, 12000);
    }
    requestAnimationFrame(frame);
  })();
})(window.Plexo);
