/**
 * First-run setup: a short guided tour of the main choices, with a live preview.
 *
 * Each step is declared in STEPS below. A step renders its own body from the current settings;
 * clicking an option (any element with data-setting and data-value) updates the setting, which
 * re-renders the step and the preview. To add a step, add an entry here.
 */
(function (Plexo) {
  "use strict";

  const { $, $$, html, raw, setHtml, toast, storage, device } = Plexo.util;
  const { settings, views, voice } = Plexo;
  const prefs = settings.values;

  const DONE_KEY = "plexo.onboarded";

  const { MODE_NAMES } = settings;
  const HIGHLIGHT_NAMES = { word: "Box on the current word", karaoke: "Karaoke colour sweep", off: "No highlighting" };

  /* ---------- building blocks for step bodies ---------- */

  /** A large radio-style choice. */
  function choice(setting, value, title, description, { tag = "", demo = "", disabled = false } = {}) {
    const selected = currentValue(setting) === value;
    return html`
      <button class="choice${selected ? " on" : ""}" data-setting="${setting}" data-value="${value}" ${disabled ? raw("disabled") : ""}>
        <span class="choice-dot"></span>
        <span><b>${title}</b>${tag ? html`<span class="choice-tag">${tag}</span>` : ""}<small>${description}</small>${demo}</span>
      </button>`;
  }

  /** A small preset button. */
  function chip(setting, value, label, note = "") {
    const selected = currentValue(setting) === value;
    return html`<button class="chip${selected ? " on" : ""}" data-setting="${setting}" data-value="${value}">${label}${note ? html`<small>${note}</small>` : ""}</button>`;
  }

  const note = (text) => html`<div class="setup-note">${text}</div>`;
  const label = (text, value = "") => html`<div class="setup-label"><span>${text}</span>${value ? html`<b>${value}</b>` : ""}</div>`;
  const slider = (setting) => {
    const { min, max, step } = settings.RANGES[setting];
    return html`<input type="range" data-setting="${setting}" min="${min}" max="${max}" step="${step}" value="${prefs[setting]}" />`;
  };

  /** Setup shows the mode the prompter will actually use. */
  function currentValue(setting) {
    if (setting === "mode") return voice.effectiveMode();
    return prefs[setting];
  }

  const demoLine = (inner) => html`<div class="choice-demo">${inner}</div>`;

  /** "Step 2", worked out from the step's place in STEPS. */
  const kicker = (id) => html`<div class="setup-kicker">Step ${QUESTION_STEPS.findIndex((step) => step.id === id) + 1}</div>`;
  const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

  /** Chips for a setting's presets, marking the default. */
  const presetChips = (setting) =>
    html`<div class="chips">${settings.PRESETS[setting].map(([value, text]) => chip(setting, value, text, value === settings.DEFAULTS[setting] ? "default" : ""))}</div>`;

  /* ---------- the steps ---------- */

  const STEPS = [
    {
      id: "welcome",
      body: () => html`
        <div class="setup-kicker">Welcome</div>
        <h1>Let’s set up your prompter</h1>
        <p>${COUNT_WORDS[QUESTION_STEPS.length] || QUESTION_STEPS.length} quick choices, with a live preview of your screen. Each one starts on a sensible default, so if you’re not sure, press Next. You can change anything later from Display&nbsp;settings.</p>
        <ol class="setup-list">
          <li>How the text moves: auto-scroll, your voice, or a clicker</li>
          <li>Whether words light up as you read along</li>
          <li>Colours, text size and speed</li>
          <li>A countdown, a timer, and where your camera&nbsp;sits</li>
        </ol>`,
    },
    {
      id: "movement",
      label: "Movement",
      body: () => html`
        ${kicker("movement")}
        <h1>How should the text move?</h1>
        <p>You can switch at any time from Display&nbsp;settings${device.touch ? "" : ", or with the V key for voice follow"}.</p>
        <div class="choices">
          ${choice("mode", "auto", "Auto-scroll", `Moves up at a steady pace you choose and stops at any pauses in your script. ${device.touch ? "Tap the screen to start and pause it." : "Space starts and pauses it."}`, { tag: "Recommended" })}
          ${choice(
            "mode",
            "voice",
            "Voice follow",
            voice.isAvailable()
              ? "Listens as you speak and moves with you. When you stop talking, it waits. Your browser sends the microphone audio to its online speech service while it’s on."
              : `Listens as you speak and moves with you. Not available here: ${voice.reason()}`,
            { disabled: !voice.isAvailable() }
          )}
          ${device.touch
            ? choice("mode", "manual", MODE_NAMES.manual, "Nothing moves until you tap. Each tap, or each press of a Bluetooth clicker, moves one line.")
            : choice("mode", "manual", MODE_NAMES.manual, "Nothing moves until you press. Space, Page Down or a presentation clicker moves one line at a time, and Page Up goes back.")}
        </div>
        ${voice.effectiveMode() === "voice"
          ? html`${label("Microphone check")}<button class="btn sm" data-action="test-mic">Test your microphone</button>
              <div class="mic-result" id="mic-result">Press the button, then say a sentence out&nbsp;loud.</div>`
          : ""}`,
    },
    {
      id: "highlight",
      label: "Highlighting",
      body: () => html`
        ${kicker("highlight")}
        <h1>Would you like the words to light up as you read along?</h1>
        <p>It helps you keep your place, a little like captions on a&nbsp;video.</p>
        <div class="choices">
          ${choice("highlight", "word", HIGHLIGHT_NAMES.word, "A box glides from word to word at your pace.", { tag: "Default", demo: demoLine(html`read <span class="demo-box">along</span> with the arrows`) })}
          ${choice("highlight", "karaoke", HIGHLIGHT_NAMES.karaoke, "Colour sweeps across each word as you say it.", { demo: demoLine(html`<span class="demo-done">read</span> <span class="demo-sweep">along</span> with the arrows`) })}
          ${choice("highlight", "off", HIGHLIGHT_NAMES.off, "Just the reading line and arrows, like a studio prompter.", { demo: demoLine("read along with the arrows") })}
        </div>
        ${voice.effectiveMode() === "manual" ? note("Highlighting follows auto-scroll and voice follow. In clicker mode the reading line does the job, so this applies if you switch modes later.") : ""}`,
    },
    {
      id: "colours",
      label: "Colours",
      body: () => html`
        ${kicker("colours")}
        <h1>Which colours are easiest to read?</h1>
        <p>White on black is the classic prompter look. Try a few and watch the&nbsp;preview.</p>
        <div class="swatches">
          ${Object.entries(settings.THEMES).map(
            ([key, theme]) => html`<button class="swatch${prefs.theme === key ? " on" : ""}" data-setting="theme" data-value="${key}" data-theme="${key}">Aa<small>${theme.name}</small></button>`
          )}
        </div>
        ${note("You can pick any colours you like later, from Display settings, under Your colours.")}`,
    },
    {
      id: "size",
      label: "Text size",
      body: () => html`
        ${kicker("size")}
        <h1>How big should the text be?</h1>
        <p>The preview is your screen, shrunk down. Sit where you’ll record and make sure you can read it&nbsp;comfortably.</p>
        ${label("Text size", `${prefs.fontSize} px`)}
        ${presetChips("fontSize")}
        ${slider("fontSize")}
        ${device.compact
          ? note("On a phone the text uses the full width of the screen. Hold it at arm’s length, where you’ll record, to check you can read it.")
          : html`${label("Column width", `${prefs.columnWidth} characters`)}
              <div class="chips">${chip("columnWidth", 22, "Narrow")}${chip("columnWidth", 30, "Medium", "default")}${chip("columnWidth", 42, "Wide")}</div>
              ${note("A narrow column keeps your eyes still and close to the camera, so viewers can’t tell you’re reading.")}`}`,
    },
    {
      id: "speed",
      label: "Speed",
      body: () => {
        const mode = voice.effectiveMode();
        const hint = {
          voice: "Voice follow keeps up with you, so this sets the starting pace and the timings shown for each script.",
          manual: "In clicker mode you set the pace, so this only changes the timings shown for each script.",
          auto: `Around 150 words a minute suits most people. While you record, the plus and minus buttons beside the speed nudge it up or down${device.touch ? "" : ", and so do the up and down arrow keys"}.`,
        }[mode];
        return html`
          ${kicker("speed")}
          <h1>How fast do you speak?</h1>
          <p>Read the preview out loud at your normal pace. If the words run away from you, slow it down. If you’re waiting for them, speed it&nbsp;up.</p>
          ${label("Speed", `${prefs.wordsPerMinute} words a minute`)}
          <div class="chips">${chip("wordsPerMinute", 135, "Relaxed", "135")}${chip("wordsPerMinute", 155, "Natural", "155, default")}${chip("wordsPerMinute", 175, "Brisk", "175")}</div>
          ${slider("wordsPerMinute")}
          ${note(hint)}`;
      },
    },
    {
      id: "extras",
      label: "Extras",
      body: () => html`
        ${kicker("extras")}
        <h1>A few finishing touches</h1>
        <p>Small things that make recording&nbsp;easier.</p>
        ${label("Countdown before it starts")}
        <div class="chips">${chip("countdown", 0, "None")}${chip("countdown", 3, "3 seconds", "default")}${chip("countdown", 5, "5 seconds")}</div>
        ${label("Timer on screen")}
        <div class="chips">${chip("showTimer", true, "Show", "default")}${chip("showTimer", false, "Hide")}</div>
        ${label("Where is your camera?")}
        ${presetChips("readingLine")}
        ${note("The reading line sits close to the camera, so your eyes stay near the lens.")}`,
    },
    {
      id: "done",
      body: () => {
        const mode = voice.effectiveMode();
        const rows = [
          ["Movement", MODE_NAMES[mode]],
          ["Highlighting", mode === "manual" ? "Off in clicker mode" : HIGHLIGHT_NAMES[prefs.highlight]],
          ["Colours", settings.THEMES[prefs.theme]?.name || "Your colours"],
          ["Text", device.compact ? `${prefs.fontSize} px` : `${prefs.fontSize} px, ${prefs.columnWidth} character column`],
          ["Speed", `${prefs.wordsPerMinute} words a minute`],
          ["Countdown", prefs.countdown ? `${prefs.countdown} seconds` : "None"],
          ["Timer", prefs.showTimer ? "Shown" : "Hidden"],
        ];
        return html`
          <div class="setup-kicker">All set</div>
          <h1>Your prompter is ready</h1>
          <p>Here’s what you chose. Change any of it from Display settings, or run setup again from the start&nbsp;screen.</p>
          <table class="setup-summary">${rows.map(([name, value]) => html`<tr><td>${name}</td><td>${value}</td></tr>`)}</table>
          <div class="chips">
            <button class="btn primary" data-command="tutorial"><svg class="icon"><use href="#i-play"/></svg>Start the tutorial</button>
            <button class="btn" data-command="show-library">Go to my scripts</button>
            <button class="btn ghost" data-command="home">Back to start</button>
          </div>`;
      },
    },
  ];

  const QUESTION_STEPS = STEPS.filter((step) => step.label);
  let stepIndex = 0;
  let stopMicTest = null;

  /* ---------- rendering ---------- */

  function render() {
    const step = STEPS[stepIndex];
    setHtml(
      $("#setup-steps"),
      QUESTION_STEPS.map((s, i) => {
        const position = STEPS.indexOf(s);
        const state = position < stepIndex ? "done" : position === stepIndex ? "on" : "";
        return html`<span class="${state}">${i + 1}. ${s.label}</span>`;
      })
    );
    setHtml($("#setup-body"), step.body());
    settings.paintSwatches($("#setup-body"));

    const isFirst = stepIndex === 0;
    const isLast = step.id === "done";
    $("#setup-back").hidden = isFirst;
    $("#setup-next").hidden = isLast;
    $("#setup-next").textContent = isFirst ? "Get started" : step === QUESTION_STEPS[QUESTION_STEPS.length - 1] ? "Finish" : "Next";
    const position = QUESTION_STEPS.indexOf(step) + 1;
    setHtml(
      $("#setup-nav-note"),
      isFirst ? html`<button class="link" data-action="defaults">Skip and use the defaults</button>` : isLast ? "" : html`<span>Step ${position} of ${QUESTION_STEPS.length}</span>`
    );
    if (isLast) storage.set(DONE_KEY, true);
    Plexo.preview.rebuild();
  }

  function go(step) {
    stopMicrophone();
    stepIndex = Math.max(0, Math.min(STEPS.length - 1, stepIndex + step));
    render();
    $("#setup .setup-main").scrollTop = 0;
  }

  /* ---------- actions ---------- */

  function stopMicrophone() {
    if (stopMicTest) stopMicTest();
    stopMicTest = null;
  }

  /** Reads a data-value attribute back into the type the setting expects. */
  function parseValue(setting, value) {
    if (typeof settings.DEFAULTS[setting] === "number") return Number(value);
    if (typeof settings.DEFAULTS[setting] === "boolean") return value === "true";
    return value;
  }

  function onClick(event) {
    const option = event.target.closest("[data-setting]");
    if (option && option.tagName === "BUTTON" && !option.disabled) {
      stopMicrophone();
      settings.update({ [option.dataset.setting]: parseValue(option.dataset.setting, option.dataset.value) });
      render();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "test-mic") {
      stopMicrophone();
      stopMicTest = voice.testMicrophone($("#mic-result"));
    } else if (action === "defaults") useDefaults();
  }

  function onSlider(event) {
    const input = event.target.closest("input[type=range][data-setting]");
    if (!input) return;
    const setting = input.dataset.setting;
    settings.update({ [setting]: Number(input.value) });
    // Update the label and presets without re-rendering, so the slider keeps focus while dragging.
    const value = setting === "fontSize" ? `${prefs.fontSize} px` : `${prefs.wordsPerMinute} words a minute`;
    const labelValue = $("#setup-body .setup-label b");
    if (labelValue) labelValue.textContent = value;
    $$(`#setup-body .chip[data-setting="${setting}"]`).forEach((c) => c.classList.toggle("on", Number(c.dataset.value) === prefs[setting]));
  }

  function useDefaults() {
    settings.resetEssentials();
    storage.set(DONE_KEY, true);
    views.goHome();
    toast("Using the defaults. Change them any time from Display settings.");
  }

  function skip() {
    storage.set(DONE_KEY, true);
    stopMicrophone();
    views.goHome();
  }

  function open() {
    stepIndex = 0;
    views.show("setup");
  }

  /* ---------- wiring ---------- */

  $("#setup-body").addEventListener("click", onClick);
  $("#setup-nav").addEventListener("click", onClick);
  $("#setup-body").addEventListener("input", onSlider);
  $("#setup-next").addEventListener("click", () => go(1));
  $("#setup-back").addEventListener("click", () => go(-1));
  $("#setup-skip").addEventListener("click", skip);
  voice.onAvailabilityChange(() => views.current() === "setup" && render());

  views.define("setup", {
    enter: render,
    leave: stopMicrophone,
    restore: () => views.show("setup"),
  });

  Plexo.setup = {
    open,
    isDone: () => storage.get(DONE_KEY, false) === true,
    /** Enter moves to the next step (unless a button has focus). */
    handleKey(event) {
      if (event.key === "Escape") skip();
      else if (event.key === "Enter" && !$("#setup-next").hidden && !event.target.closest("button, input")) {
        event.preventDefault();
        go(1);
      }
    },
  };
})(window.Plexo);
