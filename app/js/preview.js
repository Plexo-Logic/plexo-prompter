/**
 * Setup's live preview: a shrunk copy of the user's screen running the current settings on a
 * short sample. It reuses the real parser and timing, with a simplified scroller.
 */
(function (Plexo) {
  "use strict";

  const { $, raw, setHtml, formatDuration, device, isNarrow } = Plexo.util;
  const { BEATS } = Plexo.script;
  const prefs = Plexo.settings.values;

  const SAMPLE =
    "This is how your script will look on your screen. The words move up at a steady pace, and the line you are reading stays level with the arrows.\n\n" +
    "Pick whatever feels comfortable. Every choice has a sensible default, and you can change any of it later, from Display settings.";
  const { MODE_NAMES } = Plexo.settings;
  const CAPTIONS = {
    voice: () => "Shown here at your chosen speed. With voice follow the text only moves while you’re speaking.",
    manual: () => (device.touch ? "Each tap moves the text up one line." : "Each press of Space, Page Down or your clicker moves the text up one line."),
    auto: () => `This is how your scripts will scroll, at ${prefs.wordsPerMinute} words a minute.`,
  };
  /** Seconds between simulated clicker presses, and the pause before the sample loops. */
  const CLICK_EVERY = 2.2;
  const LOOP_PAUSE = 1.6;

  const el = {
    screen: $("#preview-screen"),
    scroll: $("#preview-scroll"),
    text: $("#preview-text"),
    pill: $("#preview-pill"),
    band: $("#preview-band"),
    fade: $("#preview-fade"),
    arrows: [$("#preview-arrow-left"), $("#preview-arrow-right")],
    hud: $("#preview-hud"),
    mode: $("#preview-mode"),
    caption: $("#preview-caption"),
  };

  let state = null;

  /** Lays the sample out at the current settings, scaled to the preview's size. */
  function rebuild() {
    if (Plexo.views.current() !== "setup") return;
    const width = el.screen.clientWidth;
    if (!width) return;
    const screenWidth = Math.max(320, window.innerWidth);
    const scale = width / screenWidth;
    // A phone's screen is taller than it is wide: show just the top of it, where the reading line is.
    const fullHeight = Math.round((width * window.innerHeight) / screenWidth);
    const height = isNarrow() ? Math.min(fullHeight, Math.round(window.innerHeight * 0.3)) : fullHeight;
    el.screen.style.height = `${height}px`;

    const parsed = Plexo.script.parse(SAMPLE);
    setHtml(el.text, raw(parsed.html));
    const fontSize = prefs.fontSize * scale;
    const lineHeight = fontSize * prefs.lineHeight;
    const readY = (height * prefs.readingLine) / 100;
    const top = readY - lineHeight / 2;

    el.text.style.fontSize = `${fontSize}px`;
    el.text.style.maxWidth = `${prefs.columnWidth}ch`;
    el.text.style.padding = `0 ${(24 * scale).toFixed(1)}px`;
    el.scroll.style.paddingTop = `${top}px`;
    el.scroll.style.paddingBottom = `${height}px`;
    el.band.style.top = `${readY - lineHeight * 0.55}px`;
    el.band.style.height = `${lineHeight * 1.1}px`;
    el.arrows.forEach((arrow) => (arrow.style.top = `${readY - 7}px`));
    el.fade.style.height = `${Math.max(0, readY - lineHeight * 0.6)}px`;

    const words = Array.from(el.text.querySelectorAll(".word"));
    const starts = [];
    let units = 0;
    let lastParagraph = null;
    words.forEach((word, i) => {
      const paragraph = word.closest("p");
      if (lastParagraph && paragraph !== lastParagraph) units += BEATS.paragraph;
      lastParagraph = paragraph;
      starts.push(units);
      units += parsed.durations[i];
    });
    const lines = [];
    words.forEach((word) => {
      const y = word.offsetTop + word.offsetHeight / 2;
      if (!lines.length || Math.abs(lines[lines.length - 1] - y) > lineHeight * 0.3) lines.push(y);
    });

    const previous = state;
    state = {
      words, starts, spoken: parsed.spoken, end: units, lines, scale, top,
      units: previous ? Math.min(previous.units, units) : 0,
      pos: previous ? previous.pos : 0,
      line: 0, clickTimer: 0, pauseLeft: 0, looping: false, highlighted: -1,
    };

    const mode = Plexo.voice.effectiveMode();
    el.mode.textContent = MODE_NAMES[mode] + (mode === "manual" ? "" : `, ${prefs.wordsPerMinute} wpm`);
    el.hud.textContent = prefs.showTimer ? `0:00 / ${formatDuration(Plexo.script.timeline(parsed, prefs.wordsPerMinute).total)}` : "";
    el.caption.textContent = CAPTIONS[mode]();
  }

  function resetLoop() {
    state.looping = false;
    state.units = 0;
    state.line = 0;
    state.pos = 0;
    state.highlighted = -1;
    state.words.forEach((word) => {
      word.classList.remove("hl", "done");
      word.style.removeProperty("--p");
    });
  }

  function placePill(word) {
    if (!word || prefs.highlight !== "word") {
      el.pill.classList.remove("on");
      return;
    }
    const pad = prefs.fontSize * state.scale * 0.12;
    const x = el.text.offsetLeft + word.offsetLeft;
    const y = state.top + word.offsetTop;
    el.pill.style.width = `${word.offsetWidth + pad * 2}px`;
    el.pill.style.height = `${word.offsetHeight + pad * 0.5}px`;
    el.pill.style.transform = `translate(${x - pad}px, ${y - pad * 0.25}px)`;
    el.pill.classList.add("on");
  }

  /** Advances the preview. Called every animation frame while setup is open. */
  function tick(dt) {
    if (!state || !state.words.length) return;
    const mode = Plexo.voice.effectiveMode();
    const words = state.words;

    if (state.pauseLeft > 0) {
      state.pauseLeft -= dt;
      if (state.pauseLeft <= 0 && state.looping) resetLoop();
    } else if (mode === "manual") {
      state.clickTimer += dt;
      if (state.clickTimer > CLICK_EVERY) {
        state.clickTimer = 0;
        if (state.line < state.lines.length - 1) state.line++;
        else {
          state.looping = true;
          state.pauseLeft = LOOP_PAUSE;
        }
      }
    } else {
      state.units += (dt * prefs.wordsPerMinute) / 60;
      if (state.units >= state.end) {
        state.units = state.end;
        state.looping = true;
        state.pauseLeft = LOOP_PAUSE;
      }
    }

    let index = -1;
    if (mode !== "manual") {
      index = state.looping ? words.length : 0;
      if (!state.looping) state.starts.forEach((start, i) => start <= state.units + 1e-6 && (index = i));
    }
    if (index !== state.highlighted) {
      if (words[state.highlighted]) {
        words[state.highlighted].classList.remove("hl");
        words[state.highlighted].style.removeProperty("--p");
      }
      words.forEach((word, i) => word.classList.toggle("done", i < index));
      if (words[index]) words[index].classList.add("hl");
      state.highlighted = index;
      placePill(words[index]);
    }
    if (prefs.highlight === "karaoke" && words[index]) {
      const share = (state.units - state.starts[index]) / (state.spoken[index] || 1);
      words[index].style.setProperty("--p", `${(Math.min(1, Math.max(0, share)) * 100).toFixed(1)}%`);
    }

    let target;
    if (mode === "manual") target = state.lines[state.line];
    else {
      const word = words[Math.min(index, words.length - 1)];
      target = word ? word.offsetTop + word.offsetHeight / 2 : 0;
    }
    state.pos += (Math.max(0, target - state.lines[0]) - state.pos) * Math.min(1, dt * 5);
    el.scroll.style.transform = `translateY(${(-state.pos).toFixed(1)}px)`;
  }

  Plexo.settings.onChange(() => rebuild());
  window.addEventListener("resize", () => rebuild());

  Plexo.preview = { rebuild, tick };
})(window.Plexo);
