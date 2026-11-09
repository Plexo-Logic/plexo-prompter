/**
 * Display and behaviour settings.
 *
 * Settings are validated against a fixed schema whenever they are loaded or changed, so a
 * corrupted or hand-edited value in storage can never reach the page. Other modules read
 * `Plexo.settings.values` and change things only through `update()`, which saves, applies the
 * new look to the page and tells subscribers which keys changed.
 */
(function (Plexo) {
  "use strict";

  const { storage, createEmitter, clamp, device } = Plexo.util;
  const STORAGE_KEY = "plexo.settings";

  /** Colour schemes: text, background, and the colour used for markers, arrows and highlights. */
  const THEMES = Object.freeze({
    classic: { name: "White on black", text: "#FFFFFF", background: "#000000", marker: "#F5C542" },
    amber: { name: "Yellow on black", text: "#FFD54A", background: "#000000", marker: "#FFFFFF" },
    paper: { name: "Black on white", text: "#111111", background: "#FFFFFF", marker: "#C0392B" },
    navy: { name: "Blue on white", text: "#0B2A5B", background: "#FFFFFF", marker: "#B07A1E" },
    forest: { name: "Green on white", text: "#0E4B2E", background: "#FFFFFF", marker: "#B07A1E" },
    slate: { name: "Slate", text: "#FFFFFF", background: "#3E5358", marker: "#E2C28F" },
    cream: { name: "Ink on cream", text: "#1F2A2D", background: "#FBF6EA", marker: "#3E5358" },
  });

  /** System fonts only, so the app works offline and loads nothing from the internet. */
  const FONTS = Object.freeze([
    { name: "Arial", stack: "Arial, Helvetica, sans-serif" },
    { name: "Verdana", stack: "Verdana, Geneva, sans-serif" },
    { name: "Segoe UI", stack: '"Segoe UI", system-ui, sans-serif' },
    { name: "Calibri", stack: "Calibri, Carlito, sans-serif" },
    { name: "Tahoma", stack: "Tahoma, Verdana, sans-serif" },
    { name: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
  ]);

  const MODES = Object.freeze(["auto", "voice", "manual"]);
  const MODE_NAMES = Object.freeze({ auto: "Auto-scroll", voice: "Voice follow", manual: device.touch ? "One line per tap" : "Clicker or keyboard" });
  const HIGHLIGHTS = Object.freeze(["word", "karaoke", "off"]);
  const COUNTDOWNS = Object.freeze([0, 3, 5]);

  /** Numeric limits, shared by the sliders, the keyboard shortcuts and validation. */
  const RANGES = Object.freeze({
    fontSize: { min: 24, max: 140, step: 2 },
    lineHeight: { min: 1.1, max: 2.2, step: 0.05 },
    columnWidth: { min: 14, max: 70, step: 1 },
    readingLine: { min: 8, max: 60, step: 1 },
    wordsPerMinute: { min: 80, max: 240, step: 5 },
  });

  const BASE_DEFAULTS = {
    mode: "auto",
    highlight: "word",
    theme: "classic",
    customText: "#FFFFFF",
    customBackground: "#000000",
    customMarker: "#F5C542",
    font: "Arial",
    fontSize: 56,
    lineHeight: 1.45,
    columnWidth: 30,
    readingLine: 22,
    wordsPerMinute: 155,
    countdown: 3,
    bold: true,
    capitals: false,
    mirror: false,
    dimRead: true,
    readingBand: true,
    showTimer: true,
  };

  /** Phones start with smaller text, a full-width column and the reading line under the front camera. */
  const PHONE_DEFAULTS = { fontSize: 34, columnWidth: 40, readingLine: 16 };
  const DEFAULTS = Object.freeze({ ...BASE_DEFAULTS, ...(device.compact ? PHONE_DEFAULTS : {}) });

  /** The quick choices setup offers, as [value, label] pairs, sized for this screen. */
  const PRESETS = Object.freeze(
    device.compact
      ? {
          fontSize: [[28, "Small"], [34, "Medium"], [42, "Large"], [52, "Extra large"]],
          readingLine: [[16, "Phone camera at the top"], [42, "A prompter glass, or a camera in the middle"]],
        }
      : {
          fontSize: [[44, "Small"], [56, "Medium"], [72, "Large"], [92, "Extra large"]],
          readingLine: [[22, "Webcam on top of the screen"], [42, "Camera in the middle, or a prompter glass"]],
        }
  );

  const isHexColour = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const isBoolean = (v) => typeof v === "boolean";
  const oneOf = (list) => (v) => list.includes(v);
  const inRange = ({ min, max }) => (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

  const VALIDATORS = Object.freeze({
    mode: oneOf(MODES),
    highlight: oneOf(HIGHLIGHTS),
    theme: (v) => v === "custom" || Object.hasOwn(THEMES, v),
    customText: isHexColour,
    customBackground: isHexColour,
    customMarker: isHexColour,
    font: (v) => FONTS.some((font) => font.name === v),
    fontSize: inRange(RANGES.fontSize),
    lineHeight: inRange(RANGES.lineHeight),
    columnWidth: inRange(RANGES.columnWidth),
    readingLine: inRange(RANGES.readingLine),
    wordsPerMinute: inRange(RANGES.wordsPerMinute),
    countdown: oneOf(COUNTDOWNS),
    bold: isBoolean,
    capitals: isBoolean,
    mirror: isBoolean,
    dimRead: isBoolean,
    readingBand: isBoolean,
    showTimer: isBoolean,
  });

  /** Builds a clean settings object, keeping only known keys with valid values. */
  function sanitise(input) {
    const clean = { ...DEFAULTS };
    if (input && typeof input === "object" && !Array.isArray(input)) {
      for (const key of Object.keys(DEFAULTS)) {
        if (Object.hasOwn(input, key) && VALIDATORS[key](input[key])) clean[key] = input[key];
      }
    }
    return clean;
  }

  const values = sanitise(storage.get(STORAGE_KEY, null));
  const changes = createEmitter();

  /** The colours in use, whichever scheme is selected. */
  function colours() {
    if (values.theme !== "custom") return THEMES[values.theme];
    return { text: values.customText, background: values.customBackground, marker: values.customMarker };
  }

  const fontStack = () => (FONTS.find((font) => font.name === values.font) || FONTS[0]).stack;

  /** Pushes the current settings into CSS custom properties and body classes. */
  function applyToDocument() {
    const style = document.documentElement.style;
    const { text, background, marker } = colours();
    style.setProperty("--fg", text);
    style.setProperty("--bg", background);
    style.setProperty("--accent", marker);
    style.setProperty("--fs", `${values.fontSize}px`);
    style.setProperty("--lh", String(values.lineHeight));
    style.setProperty("--col", `${values.columnWidth}ch`);
    style.setProperty("--read", `${values.readingLine}%`);
    style.setProperty("--weight", values.bold ? "700" : "400");
    style.setProperty("--font", fontStack());

    const body = document.body.classList;
    body.toggle("caps", values.capitals);
    body.toggle("mirror", values.mirror);
    body.toggle("no-dim", !values.dimRead);
    body.toggle("no-band", !values.readingBand);
    body.toggle("no-timer", !values.showTimer);
    body.toggle("hl-word", values.highlight === "word");
    body.toggle("hl-karaoke", values.highlight === "karaoke");
  }

  /** Paints each colour scheme button (data-theme="classic" and so on) in its own colours. */
  function paintSwatches(root) {
    root.querySelectorAll("[data-theme]").forEach((button) => {
      const theme = THEMES[button.dataset.theme];
      if (!theme) return;
      button.style.background = theme.background;
      button.style.color = theme.text;
    });
  }

  /**
   * Changes one or more settings. Invalid values are ignored. Returns true if anything changed.
   *   Plexo.settings.update({ fontSize: 72, theme: "paper" })
   */
  function update(patch) {
    const changed = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(DEFAULTS, key) || !VALIDATORS[key](value) || values[key] === value) continue;
      values[key] = value;
      changed.push(key);
    }
    if (!changed.length) return false;
    storage.set(STORAGE_KEY, values);
    applyToDocument();
    changes.emit(changed);
    return true;
  }

  /** Moves a numeric setting by a number of steps, staying inside its range. */
  function nudge(key, steps) {
    const range = RANGES[key];
    const next = clamp(values[key] + steps * range.step, range.min, range.max);
    return update({ [key]: Math.round(next * 100) / 100 });
  }

  /** Puts the main choices back to their defaults (used by "Skip and use the defaults"). */
  function resetEssentials() {
    const keys = ["mode", "highlight", "theme", "fontSize", "columnWidth", "wordsPerMinute", "countdown", "showTimer", "readingLine"];
    update(Object.fromEntries(keys.map((key) => [key, DEFAULTS[key]])));
  }

  Plexo.settings = {
    THEMES, FONTS, HIGHLIGHTS, MODE_NAMES, RANGES, DEFAULTS, PRESETS,
    values, colours, applyToDocument, paintSwatches, update, nudge, resetEssentials, sanitise,
    onChange: changes.on,
  };
})(window.Plexo);
