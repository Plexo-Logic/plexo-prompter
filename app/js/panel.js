/**
 * The settings drawer: Display settings and Help.
 *
 * Every control carries a data-setting attribute naming the setting it edits, so the drawer is
 * wired generically: change a control and the setting updates; change a setting anywhere and
 * the controls follow.
 */
(function (Plexo) {
  "use strict";

  const { $, $$, html, setHtml, device } = Plexo.util;
  const { settings, voice } = Plexo;
  const prefs = settings.values;

  const drawer = $("#settings");

  /** On/off switches, rendered into the Display tab. */
  const SWITCHES = [
    ["bold", "Bold text", ""],
    ["capitals", "Capital letters", "Most people read faster in normal case"],
    ["readingBand", "Reading line highlight", ""],
    ["dimRead", "Dim lines already read", ""],
    ["showTimer", "Show timer and section times", ""],
    ["mirror", "Mirror text", "Only for a teleprompter with reflective glass"],
  ];

  /** Read-outs next to each slider. */
  const SLIDER_LABELS = {
    fontSize: (v) => `${v} px`,
    columnWidth: (v) => `${v} characters`,
    lineHeight: (v) => v.toFixed(2),
    readingLine: (v) => `${v}% from the top`,
    wordsPerMinute: (v) => `${v} words a minute`,
  };

  function build() {
    setHtml(
      $("#set-themes"),
      [
        ...Object.entries(settings.THEMES).map(
          ([key, theme]) => html`<button class="swatch" data-theme="${key}" title="${theme.name}">Aa<small>${theme.name}</small></button>`
        ),
        html`<button class="swatch" data-theme="custom" title="Your colours">+<small>Your colours</small></button>`,
      ]
    );
    settings.paintSwatches($("#set-themes"));

    setHtml($("#set-font"), settings.FONTS.map((font) => html`<option value="${font.name}">${font.name}</option>`));

    for (const [key, { min, max, step }] of Object.entries(settings.RANGES)) {
      const input = $(`#settings input[type=range][data-setting="${key}"]`);
      if (input) Object.assign(input, { min, max, step });
    }

    setHtml(
      $("#set-switches"),
      SWITCHES.map(
        ([key, label, hint]) => html`
          <label class="switch-row">
            <span>${label}${hint ? html`<small>${hint}</small>` : ""}</span>
            <span class="switch"><input type="checkbox" data-setting="${key}" /><i></i></span>
          </label>`
      )
    );
  }

  /** Brings every control in line with the current settings. */
  function sync() {
    $$("#set-themes [data-theme]").forEach((button) => button.classList.toggle("on", button.dataset.theme === prefs.theme));
    $("#set-custom").hidden = prefs.theme !== "custom";
    const { text, background, marker } = settings.colours();
    $("#set-custom-text").value = text;
    $("#set-custom-background").value = background;
    $("#set-custom-marker").value = marker;

    $$("#settings [data-setting]").forEach((control) => {
      const key = control.dataset.setting;
      if (control.type === "checkbox") control.checked = Boolean(prefs[key]);
      else if (control.type !== "color") control.value = String(prefs[key]);
      const readout = $(`#settings [data-readout="${key}"]`);
      if (readout && SLIDER_LABELS[key]) readout.textContent = SLIDER_LABELS[key](prefs[key]);
    });

    const voiceOption = $('#set-mode option[value="voice"]');
    voiceOption.disabled = !voice.isAvailable();
    $("#set-mode").value = voice.effectiveMode();
    const mode = voice.effectiveMode();
    $("#set-mode-note").textContent =
      mode === "voice"
        ? "Scrolls as you speak and waits when you stop. Uses the browser’s online speech service."
        : mode === "manual"
          ? device.touch ? "Each tap, or a press of a Bluetooth clicker, moves one line." : "Space, Page Down or a clicker moves one line. Page Up goes back."
          : `Moves at the speed below and stops at pauses in your script.${voice.isAvailable() ? "" : ` Voice follow isn’t available here: ${voice.reason()}`}`;
  }

  /** Reads a control's value as the type its setting uses. */
  function valueOf(control) {
    const key = control.dataset.setting;
    if (control.type === "checkbox") return control.checked;
    if (typeof settings.DEFAULTS[key] === "number") return Number(control.value);
    return control.value;
  }

  function onInput(event) {
    const control = event.target.closest("[data-setting]");
    if (!control) return;
    const key = control.dataset.setting;
    if (key === "mode" && control.value === "voice" && !voice.isAvailable()) {
      Plexo.util.toast(voice.reason(), 5000);
      sync();
      return;
    }
    settings.update({ [key]: valueOf(control) });
  }

  function onCustomColour(event) {
    const key = { "set-custom-text": "customText", "set-custom-background": "customBackground", "set-custom-marker": "customMarker" }[event.target.id];
    if (key) settings.update({ [key]: event.target.value, theme: "custom" });
  }

  // Where focus goes back to when the drawer closes.
  let returnFocus = null;

  function open(tab = "display") {
    $$("#settings [data-panel-tab]").forEach((button) => button.classList.toggle("on", button.dataset.panelTab === tab));
    $$("#settings [data-panel]").forEach((pane) => (pane.hidden = pane.dataset.panel !== tab));
    if (isOpen()) return;
    returnFocus = document.activeElement;
    drawer.classList.add("on");
    drawer.inert = false;
    $("#settings-close").focus();
  }

  function close() {
    if (!isOpen()) return;
    drawer.classList.remove("on");
    drawer.inert = true; // out of the tab order and hidden from screen readers while closed
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  const isOpen = () => drawer.classList.contains("on");

  build();
  sync();

  drawer.addEventListener("input", onInput);
  drawer.addEventListener("change", onInput);
  $("#set-custom").addEventListener("input", onCustomColour);
  $("#set-themes").addEventListener("click", (event) => {
    const theme = event.target.closest("[data-theme]")?.dataset.theme;
    if (theme) settings.update({ theme });
  });
  $$("#settings [data-panel-tab]").forEach((button) => button.addEventListener("click", () => open(button.dataset.panelTab)));
  $("#settings-close").addEventListener("click", close);
  $("#settings-rerun").addEventListener("click", () => {
    close();
    Plexo.setup.open();
  });

  settings.onChange(sync);
  voice.onAvailabilityChange(sync);

  Plexo.panel = { open, close, isOpen, toggle: (tab) => (isOpen() ? close() : open(tab)) };
})(window.Plexo);
