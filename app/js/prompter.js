/**
 * The prompter: lays the script out, moves through it, and draws the timer and controls.
 *
 * It leans on three smaller modules:
 *   track.js      where each word sits, and the maths between scroll position and time
 *   follow.js     voice follow's sense of where the reader is
 *   highlight.js  the box or karaoke fill on the word being read
 *
 * Modes
 *   auto    advances by itself at the reading pace; pause markers stop or hold it
 *   voice   moves to wherever the reader is, from speech recognition (see voice.js)
 *   manual  moves one line per press of Space, Page Down or a presentation clicker
 */
(function (Plexo) {
  "use strict";

  const { $, setHtml, raw, formatDuration, device, pressToContinue } = Plexo.util;
  const { highlight } = Plexo;
  const prefs = Plexo.settings.values;

  const el = {
    viewport: $("#viewport"),
    scroller: $("#scroller"),
    text: $("#script-text"),
    padTop: $("#pad-top"),
    padBottom: $("#pad-bottom"),
    progress: $("#progress"),
    title: $("#prompt-title"),
    clock: $("#hud-clock"),
    state: $("#hud-state"),
    countdown: $("#countdown"),
    playIcon: $("#icon-play"),
    pauseIcon: $("#icon-pause"),
    speed: $("#speed-value"),
    size: $("#size-value"),
  };

  let script = null;
  let parsed = null;
  let track = Plexo.track.empty(); // rebuilt by measure()
  let blocks = []; // paragraphs and headings, for jumping between them

  // Playback state.
  let pos = 0; // scroll offset in pixels
  let units = 0; // current position in word units while auto-scrolling
  let jumpTarget = null;
  let playing = false;
  let holdLeft = 0;
  let waitingAt = null;
  let started = false;
  let finished = false;
  let elapsed = 0;
  let countdownLeft = 0;
  let countdownTimer = 0;

  const follower = Plexo.follow.createFollower();

  const mode = () => Plexo.voice.effectiveMode();
  const listening = () => Plexo.voice.isListening();
  const unitsPerSecond = () => prefs.wordsPerMinute / 60;
  /** The highlight shows unless the script has finished or the clicker is moving the text. */
  const showHighlight = () => !finished && mode() !== "manual";

  /* ---------- opening a script ---------- */

  /** Shows a script in the prompter. `keepPlace` keeps the relative position (used for live edits). */
  function open(nextScript, { keepPlace = false } = {}) {
    const ratio = keepPlace && track.maxPos() ? pos / track.maxPos() : 0;
    script = nextScript;
    parsed = Plexo.script.parse(script.text, { stop: `Stop, ${pressToContinue}` });
    setHtml(el.text, raw(`${parsed.html}<div class="script-end">End</div>`));
    el.title.textContent = script.name;
    document.title = `${script.name} | Plexo Prompter`;
    highlight.forget();
    if (!keepPlace) resetPlayback();
    stampHeadings();
    requestAnimationFrame(() => {
      measure();
      pos = keepPlace ? track.clamp(ratio * track.maxPos()) : startPos();
      track.markPassed(pos);
      render();
    });
  }

  function resetPlayback() {
    stop();
    started = false;
    finished = false;
    elapsed = 0;
    follower.reset();
  }

  /** Writes each heading's start time next to it. */
  function stampHeadings() {
    if (!parsed) return;
    const { times } = Plexo.script.timeline(parsed, prefs.wordsPerMinute);
    const headingTimes = parsed.blocks.map((b, i) => (b.type === "heading" ? times[i] : null)).filter((t) => t !== null);
    el.text.querySelectorAll(".heading-time").forEach((span, i) => {
      span.textContent = headingTimes[i] !== undefined ? formatDuration(headingTimes[i]) : "";
    });
  }

  /* ---------- layout ---------- */

  /** Sets the padding around the reading line, then measures the laid-out script into a new track. */
  function measure() {
    const viewportHeight = el.viewport.clientHeight;
    const lineHeight = prefs.fontSize * prefs.lineHeight;
    const readY = (viewportHeight * prefs.readingLine) / 100;
    el.padTop.style.height = `${Math.max(0, readY)}px`;
    el.padBottom.style.height = `${viewportHeight}px`;

    const top = el.scroller.getBoundingClientRect().top;
    const yOf = (node) => node.getBoundingClientRect().top - top;
    const centreOf = (node) => yOf(node) + node.offsetHeight / 2;
    const all = (selector) => Array.from(el.text.querySelectorAll(selector));
    const wordEls = all(".word");
    const endNode = el.text.querySelector(".script-end");

    track = Plexo.track.build({
      words: wordEls.map((node) => ({ y: centreOf(node), paragraph: node.closest("p") })),
      durations: parsed.durations,
      markers: all(".pause-marker").map((node) => ({ y: centreOf(node), seconds: Number(node.dataset.seconds) || null })),
      headingYs: all(".heading").map(centreOf),
      endY: endNode ? centreOf(endNode) : 0,
      readY,
      lineHeight,
    });
    // Paragraphs and headings, each with the scroll position that puts its first word on the reading line.
    blocks = all("p, .heading").map((node) => ({
      el: node,
      isHeading: node.classList.contains("heading"),
      pos: positionForBlock(node, yOf(node), node.offsetHeight),
    }));
    highlight.attach(wordEls);
    track.markPassed(pos);
    units = track.unitsAt(pos + readY);
  }

  /** Re-measures after a size or layout change, keeping the same word on the reading line. */
  function relayout() {
    if (!script || Plexo.views.current() !== "prompt") return;
    const keepWord = wordOnReadingLine();
    requestAnimationFrame(() => {
      measure();
      if (keepWord >= 0 && track.wordY.length) pos = track.clamp(track.wordY[Math.min(keepWord, track.wordY.length - 1)] - track.readY);
      highlight.place(showHighlight(), true);
      render();
    });
  }

  /* ---------- positions ---------- */

  /** The first word at or just below the reading line. */
  const wordOnReadingLine = () => track.firstWordFrom(pos + track.readY - track.lineHeight * 0.4);
  /** Where reading starts: the first word, or in clicker mode the first line. */
  const startPos = () => (mode() === "manual" && track.lineYs.length ? track.clamp(track.lineYs[0] - track.readY) : track.homePos());

  /** Scroll position that puts the first word of a block (or the next block with words) on the reading line. */
  function positionForBlock(node, fallbackY, height) {
    let word = node.querySelector(".word");
    for (let next = node; !word && (next = next.nextElementSibling); ) word = next.querySelector(".word");
    if (word && track.wordUnits.length) return track.clamp(track.yAt(track.wordUnits[Number(word.dataset.i)]) - track.readY);
    return track.clamp(fallbackY + Math.min(track.lineHeight, height) * 0.5 - track.readY);
  }

  /* ---------- controls ---------- */

  /** Space, Page Down, Enter or the play button: start, pause, carry on, next line or listen. */
  function togglePlay() {
    if (!script) return;
    const current = mode();
    if (current === "voice") {
      if (listening()) Plexo.voice.stop();
      else startListening();
      return;
    }
    if (current === "manual") {
      stepLine(1);
      return;
    }
    if (countdownLeft) return clearCountdown();
    if (playing) {
      playing = false;
      return;
    }
    if (waitingAt) {
      waitingAt.passed = true;
      waitingAt = null;
      playing = true;
      return;
    }
    if (finished) restart();
    if (!started && prefs.countdown > 0) return startCountdown(prefs.countdown);
    go();
  }

  /** Counts down on screen, then starts rolling (or calls `then`, which does). */
  function startCountdown(seconds, then = go) {
    countdownLeft = seconds;
    el.countdown.textContent = String(seconds);
    el.countdown.classList.add("on");
    countdownTimer = setInterval(() => {
      countdownLeft -= 1;
      if (countdownLeft > 0) {
        el.countdown.textContent = String(countdownLeft);
        return;
      }
      clearCountdown();
      then();
    }, 1000);
  }

  function go() {
    started = true;
    playing = true;
  }

  /**
   * For a recorded take: the countdown every time (if one is set), then `onRolling` at the moment the
   * text starts to move. With a clicker, the text waits for the clicks as usual.
   */
  function roll(onRolling) {
    if (!script) return;
    stop();
    if (finished) restart();
    const begin = () => {
      started = true;
      playing = mode() !== "manual";
      onRolling();
    };
    if (prefs.countdown > 0) startCountdown(prefs.countdown, begin);
    else begin();
  }

  function clearCountdown() {
    clearInterval(countdownTimer);
    countdownLeft = 0;
    el.countdown.classList.remove("on");
  }

  /** Stops all movement (but keeps the place). */
  function stop() {
    playing = false;
    holdLeft = 0;
    waitingAt = null;
    jumpTarget = null;
    clearCountdown();
    Plexo.voice.stop();
  }

  /** Esc: pause if anything is moving. Returns true if it paused something. */
  function pause() {
    if (!(playing || listening() || countdownLeft)) return false;
    playing = false;
    clearCountdown();
    Plexo.voice.stop();
    return true;
  }

  function restart() {
    stop();
    resetPlayback();
    jumpTarget = startPos();
    highlight.clear();
    track.markers.forEach((m) => (m.passed = false));
  }

  function jumpTo(target) {
    waitingAt = null;
    holdLeft = 0;
    finished = false;
    jumpTarget = target;
    track.markPassed(target);
    if (mode() === "voice") follower.moveTo(track.unitsAt(target + track.readY));
  }

  /**
   * Arrow keys and the paragraph buttons: on to the next paragraph (or section), or back to the
   * previous one. Chosen by where each would put the text, so a heading sitting just above the
   * current line can never be "next" and leave the text where it is.
   */
  function jumpParagraph(direction, sectionsOnly = false) {
    const stops = blocks.filter((b) => !sectionsOnly || b.isHeading).map((b) => b.pos);
    const target = direction > 0 ? stops.find((p) => p > pos + 4) : [...stops].reverse().find((p) => p < pos - 4) ?? stops[0];
    if (target !== undefined) jumpTo(target);
  }

  /** Clicker mode: one line forward or back. */
  function stepLine(direction) {
    const here = pos + track.readY;
    const y = direction > 0 ? track.lineYs.find((v) => v > here + 4) : [...track.lineYs].reverse().find((v) => v < here - 4);
    if (y === undefined) {
      if (direction > 0) {
        jumpTarget = track.maxPos();
        finished = true;
      }
      return;
    }
    started = true;
    jumpTo(track.clamp(y - track.readY));
  }

  /** Mouse wheel, dragging, and clicking a paragraph. */
  function scrollBy(delta) {
    jumpTarget = null;
    waitingAt = null;
    pos = track.clamp(pos + delta);
    track.markPassed(pos);
    if (mode() === "voice") follower.moveTo(track.unitsAt(pos + track.readY));
  }

  function jumpToBlock(node) {
    const y = node.getBoundingClientRect().top - el.scroller.getBoundingClientRect().top;
    jumpTo(positionForBlock(node, y, node.offsetHeight));
  }

  /* ---------- voice follow ---------- */

  function startListening() {
    follower.startAt(track.unitsAt(pos + track.readY));
    if (Plexo.voice.start(followSpeech)) started = true;
  }

  function followSpeech(transcript) {
    follower.hear(transcript, parsed.words, track.wordUnits, wordOnReadingLine(), performance.now());
  }

  /* ---------- the frame loop ---------- */

  /** Stops or holds at a pause marker the reading line has just reached. */
  function checkMarkers() {
    const here = pos + track.readY;
    for (const marker of track.markers) {
      if (marker.passed || here < marker.y) continue;
      marker.passed = true;
      pos = marker.y - track.readY;
      units = marker.units !== null ? marker.units : track.unitsAt(marker.y);
      if (marker.seconds) holdLeft = marker.seconds;
      else {
        playing = false;
        waitingAt = marker;
      }
      break;
    }
  }

  /** Advances the prompter by `dt` seconds. Called every animation frame by main.js. */
  function tick(dt, now) {
    if (!script || Plexo.views.current() !== "prompt") return;
    const current = mode();

    if (jumpTarget !== null) {
      pos += (jumpTarget - pos) * Math.min(1, dt * 12);
      if (Math.abs(jumpTarget - pos) < 0.5) {
        pos = jumpTarget;
        jumpTarget = null;
      }
    } else if (current === "voice") {
      if (listening()) {
        elapsed += dt;
        const target = follower.advance(dt, now);
        if (target !== null) pos += (track.clamp(track.yAt(target) - track.readY) - pos) * Math.min(1, dt * 9);
      }
    } else if (current === "manual") {
      if (started && !finished) elapsed += dt;
    } else if (playing) {
      elapsed += dt;
      if (holdLeft > 0) holdLeft -= dt;
      else {
        if (Math.abs(track.yAt(units) - track.readY - pos) > 1) units = track.unitsAt(pos + track.readY);
        units += unitsPerSecond() * dt;
        pos = track.yAt(units) - track.readY;
        checkMarkers();
      }
      if (pos >= track.maxPos()) {
        pos = track.maxPos();
        playing = false;
        finished = true;
      }
    }

    // Which word is being said right now, and how far through it.
    let saying;
    if (current === "voice" && listening() && follower.saying() !== null) saying = follower.saying();
    else if (playing && jumpTarget === null) saying = units;
    else saying = track.unitsAt(pos + track.readY);

    highlight.set(current === "manual" ? -1 : finished ? track.wordUnits.length : track.wordAtUnits(saying), showHighlight());
    const index = highlight.index();
    if (index >= 0 && index < track.wordUnits.length) highlight.fill((saying - track.wordUnits[index]) / (parsed.spoken[index] || 1));
    render();
  }

  /* ---------- drawing ---------- */

  function stateLabel() {
    const current = mode();
    if (countdownLeft) return ["Starting", "wait"];
    if (current === "voice") return listening() ? ["Listening", "live"] : ["Voice follow", ""];
    if (current === "manual") return [finished ? "Finished" : started ? "Clicker" : device.touch ? "Ready, tap to start" : "Ready, press Space", ""];
    if (waitingAt) return [device.touch ? "Stopped, tap to go on" : "Stopped, press Space", "wait"];
    if (playing && holdLeft > 0) return [`Pause ${Math.ceil(holdLeft)}s`, "wait"];
    if (playing) return ["Rolling", "live"];
    if (finished) return ["Finished", ""];
    return [started ? "Paused" : "Ready", ""];
  }

  function render() {
    el.scroller.style.transform = `translate3d(0, ${(-pos).toFixed(2)}px, 0)`;

    const holds = (include) => track.markers.reduce((sum, m) => sum + (include(m) && m.seconds ? m.seconds : 0), 0);
    const total = (track.endUnits - track.unitsAt(track.homePos() + track.readY)) / unitsPerSecond() + holds(() => true);
    const left = Math.max(0, (track.endUnits - track.unitsAt(pos + track.readY)) / unitsPerSecond()) + holds((m) => !m.passed) + Math.max(0, holdLeft);
    el.clock.textContent = `${formatDuration(elapsed)} / ${mode() === "voice" ? `~${formatDuration(total)}` : formatDuration(elapsed + left)}`;
    el.progress.style.width = `${track.maxPos() ? (pos / track.maxPos()) * 100 : 0}%`;

    const [label, tone] = stateLabel();
    if (el.state.textContent !== label) el.state.textContent = label;
    el.state.className = `state ${tone}`;

    const moving = playing || listening() || countdownLeft > 0;
    // toggleAttribute, not .hidden: icons are SVG elements, which have no hidden property.
    el.playIcon.toggleAttribute("hidden", moving);
    el.pauseIcon.toggleAttribute("hidden", !moving);
  }

  /** The speed and text size shown in the control bar. */
  function syncReadouts() {
    el.speed.textContent = String(prefs.wordsPerMinute);
    el.size.textContent = String(prefs.fontSize);
  }

  /** Keeps the control bar's read-outs and the layout in step with the settings. */
  Plexo.settings.onChange((keys) => {
    syncReadouts();
    if (keys.includes("wordsPerMinute")) stampHeadings();
    if (keys.includes("mode")) stop();
    const layoutKeys = ["fontSize", "lineHeight", "columnWidth", "readingLine", "font", "bold", "capitals"];
    if (keys.some((key) => layoutKeys.includes(key))) relayout();
    if (keys.includes("highlight") || keys.includes("mode")) highlight.place(showHighlight(), true);
  });

  Plexo.prompter = {
    open,
    current: () => script,
    togglePlay, roll, pause, restart, stop,
    jumpParagraph, stepLine, scrollBy, jumpToBlock,
    tick, relayout,
    isMoving: () => playing || listening() || countdownLeft > 0,
    syncReadouts,
  };
})(window.Plexo);
