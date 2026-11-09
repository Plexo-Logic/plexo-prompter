/**
 * The script editor, with live timings: total length, section start times, the pace needed to
 * hit a target length, and a copy-to-clipboard summary.
 */
(function (Plexo) {
  "use strict";

  const { $, $$, html, setHtml, toast, formatDuration, plural, pressToContinue } = Plexo.util;
  const { library, views } = Plexo;
  const prefs = Plexo.settings.values;

  const el = {
    name: $("#editor-name"),
    text: $("#editor-text"),
    status: $("#editor-status"),
    save: $("#editor-save"),
    total: $("#editor-total"),
    summary: $("#editor-summary"),
    pace: $("#editor-pace"),
    paceLabel: $("#editor-pace-label"),
    target: $("#editor-target"),
    targetResult: $("#editor-target-result"),
    timings: $("#editor-timings"),
  };

  /** What is open: a saved script's id, or the source of a script that isn't saved yet. */
  let editing = null; // { id, source, dirty }
  let timingTimer = 0;

  /* ---------- opening and saving ---------- */

  /** Opens a script for editing, or a blank editor when `script` is null. */
  function open(script = null) {
    editing = { id: script ? script.id : null, source: script ? script.source : "saved", dirty: false };
    el.name.value = script ? script.name : "";
    el.text.value = script ? script.text : "";
    el.save.textContent = editing.source === "saved" ? "Save" : "Save to my scripts";
    const status = { folder: "From your Scripts folder", sample: "Sample script" }[editing.source] || (script ? "Saved" : "New script");
    setStatus(status);
    views.show("edit", { id: editing.id });
    updateTimings();
    if (!script) el.text.focus();
  }

  function setStatus(text, dirty = false) {
    el.status.textContent = text;
    el.status.classList.toggle("dirty", dirty);
  }

  function markDirty() {
    if (!editing) return;
    editing.dirty = true;
    setStatus("Unsaved changes", true);
    clearTimeout(timingTimer);
    timingTimer = setTimeout(updateTimings, 150);
  }

  /** Saves to the library (a copy, for folder and sample scripts) and returns the saved script. */
  function save() {
    const id = editing.source === "saved" ? editing.id : null;
    const script = library.save(id, el.name.value.trim() || "Untitled script", el.text.value);
    editing = { id: script.id, source: "saved", dirty: false };
    views.setCurrentId(script.id);
    el.name.value = script.name;
    el.save.textContent = "Save";
    setStatus("Saved");
    return script;
  }

  /** Start prompter: saves first if there is anything to save, then opens the prompter. */
  function startPrompter() {
    if (!el.text.value.trim()) {
      toast("Write or paste a script first.");
      el.text.focus();
      return;
    }
    const unsaved = editing.dirty || !editing.id;
    const script = unsaved ? save() : library.find(editing.id);
    editing = null;
    Plexo.app.read(script);
  }

  /** Resolves true if it's fine to leave: nothing unsaved, or the user agrees to lose it. */
  async function okToLeave() {
    if (!editing?.dirty) return true;
    const yes = await Plexo.dialog.confirm("Leave without saving?", { message: "Your changes to this script haven’t been saved.", action: "Leave", danger: true });
    if (yes && editing) editing.dirty = false;
    return yes;
  }

  async function leave() {
    if (await okToLeave()) views.goBack();
  }

  /* ---------- markers ---------- */

  const MARKERS = {
    heading: (selection) => block(`# ${selection || "Section name"}`),
    pause: () => block("[PAUSE]"),
    hold: () => block("[PAUSE 2]"),
    breath: () => " // ",
    cue: (selection) => ` [${(selection || "SMILE").toUpperCase()}] `,
    emphasis: (selection) => `*${selection || "word"}*`,
  };

  /** A marker that must sit on its own line. */
  function block(line) {
    const atLineStart = el.text.selectionStart === 0 || el.text.value[el.text.selectionStart - 1] === "\n";
    return `${atLineStart ? "" : "\n\n"}${line}\n\n`;
  }

  function insertMarker(kind) {
    const { selectionStart: from, selectionEnd: to, value } = el.text;
    el.text.setRangeText(MARKERS[kind](value.slice(from, to)), from, to, "end");
    el.text.focus();
    markDirty();
  }

  /* ---------- timings ---------- */

  function updateTimings() {
    if (views.current() !== "edit") return;
    const timing = Plexo.script.timeline(Plexo.script.parse(el.text.value), prefs.wordsPerMinute);
    el.total.textContent = formatDuration(timing.total);
    const waits = timing.waits ? `, plus ${plural(timing.waits, "stop that waits", "stops that wait")} for you` : "";
    el.summary.textContent = `${timing.words} words at ${prefs.wordsPerMinute} words a minute${waits}`;
    el.pace.value = prefs.wordsPerMinute;
    el.paceLabel.textContent = `${prefs.wordsPerMinute} words a minute`;

    const hasHeadings = timing.items.some((item) => item.kind === "heading");
    const rows = timing.items
      .filter((item) => !hasHeadings || item.kind !== "paragraph")
      .map((item) => {
        const time = formatDuration(item.t);
        if (item.kind === "heading") return html`<li><span class="time">${time}</span><span>${item.label}</span></li>`;
        if (item.kind === "paragraph") return html`<li><span class="time">${time}</span><span>${item.preview}&hellip;</span></li>`;
        if (item.kind === "hold") return html`<li class="pause"><span class="time">${time}</span><span>${item.seconds} second pause</span></li>`;
        if (item.kind === "wait") return html`<li class="pause"><span class="time">${time}</span><span>Stops until you ${pressToContinue}</span></li>`;
        return html`<li class="end"><span class="time">${time}</span><span>End</span></li>`;
      });
    setHtml(el.timings, timing.words ? rows : html`<li class="end"><span class="time">0:00</span><span>Start typing to see timings</span></li>`);
    updateTarget(timing);
  }

  /** "Need it to finish in 60 seconds?" works out the pace that would do it. */
  function updateTarget(timing) {
    const target = parseFloat(el.target.value);
    if (!(target > 0) || !timing.words) {
      setHtml(el.targetResult, html`<span>Type a length to find the pace you need.</span>`);
      return;
    }
    const { min, max, step } = Plexo.settings.RANGES.wordsPerMinute;
    const speakingSeconds = timing.total - timing.holdSeconds;
    const units = (speakingSeconds * prefs.wordsPerMinute) / 60;
    const needed = Math.round(((units / Math.max(1, target - timing.holdSeconds)) * 60) / step) * step;
    if (needed > max) {
      setHtml(el.targetResult, html`<span>That needs more than ${max} words a minute. Try trimming the script.</span>`);
      return;
    }
    const pace = Math.max(min, needed);
    setHtml(
      el.targetResult,
      html`<span>Read at <b>${pace} words a minute</b></span>${pace === prefs.wordsPerMinute ? html`<span>Already set</span>` : html`<button class="btn sm" data-pace="${pace}">Use this pace</button>`}`
    );
  }

  /** Copies a plain-text list of section times to the clipboard. */
  function copyTimings(name, text) {
    const timing = Plexo.script.timeline(Plexo.script.parse(text), prefs.wordsPerMinute);
    const hasHeadings = timing.items.some((item) => item.kind === "heading");
    const describe = {
      heading: (item) => item.label,
      paragraph: (item) => `${item.preview}...`,
      hold: (item) => `(${item.seconds} second pause)`,
      wait: () => `(stop, waits until you ${pressToContinue})`,
      end: () => "End",
    };
    const lines = timing.items
      .filter((item) => !hasHeadings || item.kind !== "paragraph")
      .map((item) => `${formatDuration(item.t)}  ${describe[item.kind](item)}`);
    const summary = `${name} at ${prefs.wordsPerMinute} words a minute\n${lines.join("\n")}`;
    navigator.clipboard
      .writeText(summary)
      .then(() => toast("Timings copied"))
      .catch(() => toast("Couldn’t copy. Your browser blocked the clipboard."));
  }

  /* ---------- wiring ---------- */

  el.text.addEventListener("input", markDirty);
  el.name.addEventListener("input", () => {
    if (!editing) return;
    editing.dirty = true;
    setStatus("Unsaved changes", true);
  });
  el.target.addEventListener("input", updateTimings);
  el.pace.addEventListener("input", () => Plexo.settings.update({ wordsPerMinute: Number(el.pace.value) }));
  el.targetResult.addEventListener("click", (event) => {
    const pace = event.target.closest("[data-pace]")?.dataset.pace;
    if (pace) Plexo.settings.update({ wordsPerMinute: Number(pace) });
  });
  $("#editor-back").addEventListener("click", leave);
  $("#editor-save").addEventListener("click", () => {
    save();
    toast("Saved to your scripts");
  });
  $("#editor-start").addEventListener("click", startPrompter);
  $("#editor-copy").addEventListener("click", () => copyTimings(el.name.value || "Script", el.text.value));
  $$("[data-marker]").forEach((button) => button.addEventListener("click", () => insertMarker(button.dataset.marker)));

  Plexo.settings.onChange((keys) => keys.includes("wordsPerMinute") && updateTimings());

  views.define("edit", {
    enter: updateTimings,
    // Browser Back has to be answered straight away: stay for now, ask, and go back if the user agrees.
    canLeave: () => {
      if (!editing?.dirty) return true;
      okToLeave().then((yes) => yes && views.goBack());
      return false;
    },
    leave: () => {
      if (editing && editing.source === "saved" && editing.id) Plexo.browse.select(editing.id);
    },
    restore: (state) => open(state.id ? library.find(state.id) : null),
  });

  Plexo.editor = {
    open, copyTimings,
    /** Keyboard shortcuts while editing: Ctrl+S saves, Ctrl+Enter starts the prompter. */
    handleKey(event) {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
        toast("Saved to your scripts");
      } else if (command && event.key === "Enter") {
        event.preventDefault();
        startPrompter();
      }
    },
  };
})(window.Plexo);
