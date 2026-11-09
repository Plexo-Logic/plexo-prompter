/**
 * Plexo Prompter: shared helpers.
 *
 * Every module registers itself on one global, `Plexo`, so nothing else leaks into the page.
 * This file also loads in Node (for the tests), where it exports the same helpers.
 */
(function (root, factory) {
  "use strict";
  const util = factory();
  if (typeof module === "object" && module.exports) module.exports = util;
  else {
    (root.Plexo = root.Plexo || {}).util = util;
    // Set before anything is drawn, so phone layouts never flash the desktop one first.
    root.document.documentElement.classList.toggle("compact", util.device.compact);
    root.document.documentElement.classList.toggle("touch", util.device.touch);
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* ---------- safe HTML ---------- */

  const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /** Escapes text so it can be placed inside HTML, including attribute values. */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
  }

  /** A string that is already safe HTML. Only `html` and `raw` create these. */
  class SafeHtml {
    constructor(value) {
      this.value = value;
    }
    toString() {
      return this.value;
    }
  }

  /** Marks trusted, hand-written markup as safe. Never pass user text to this. */
  const raw = (markup) => new SafeHtml(String(markup));

  function renderValue(value) {
    if (value instanceof SafeHtml) return value.value;
    if (Array.isArray(value)) return value.map(renderValue).join("");
    if (value === null || value === undefined || value === false) return "";
    return escapeHtml(value);
  }

  /**
   * Tagged template for building markup. Every interpolated value is escaped unless it is
   * itself SafeHtml, so user text can never become markup by accident.
   *   html`<b>${name}</b>`
   */
  function html(strings, ...values) {
    let out = strings[0];
    values.forEach((value, i) => {
      out += renderValue(value) + strings[i + 1];
    });
    return new SafeHtml(out);
  }

  /** The only way this app writes markup into the page. Takes the same values as `html`. */
  function setHtml(element, content) {
    element.innerHTML = renderValue(content);
  }

  /* ---------- formatting ---------- */

  /** 75.4 -> "1:15" */
  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  /** "Today, 09:41", "Yesterday, 18:02" or "3 Nov". */
  function relativeDate(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString([], { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
  }

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const uid = (prefix) => `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /* ---------- script files ---------- */

  const TEXT_FILE = /\.(txt|md|text)$/i;
  const MAX_SCRIPT_BYTES = 2_000_000;
  const stripExtension = (fileName) => fileName.replace(TEXT_FILE, "");

  /* ---------- browser helpers (only used in the page) ---------- */

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  let toastTimer = 0;
  /** Shows a short message at the bottom of the window. */
  function toast(message, ms = 2800) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), ms);
  }

  /** JSON in localStorage. Never throws: private windows and full storage just fall back. */
  const storage = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* nothing to do */
      }
    },
  };

  /* ---------- device ---------- */

  const media = (query) => typeof matchMedia === "function" && matchMedia(query).matches;

  /**
   * What kind of device this is, worked out once at start-up. "compact" is a phone: a small touch
   * screen, upright or on its side. It decides phone defaults and the compact control bar. A narrow
   * desktop window is not a phone; the CSS adapts its layout by width instead (see isNarrow).
   */
  const device = Object.freeze({
    compact: media("(pointer: coarse) and (max-width: 640px), (pointer: coarse) and (max-height: 480px)"),
    /** Touch is the main way in, as on phones and tablets. */
    touch: media("(pointer: coarse)"),
  });

  /** True while the window is narrow enough for one-column layouts. Matches the CSS breakpoint. */
  const isNarrow = () => media("(max-width: 640px)");

  /** How the user carries on after a stop: "tap" on touch screens, "press Space" elsewhere. */
  const pressToContinue = device.touch ? "tap the screen" : "press Space";

  /** A tiny publish and subscribe helper. */
  function createEmitter() {
    const listeners = new Set();
    return {
      on(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit(...args) {
        listeners.forEach((listener) => listener(...args));
      },
    };
  }

  return {
    escapeHtml, SafeHtml, raw, html, setHtml,
    formatDuration, relativeDate, plural, clamp, uid,
    TEXT_FILE, MAX_SCRIPT_BYTES, stripExtension,
    $, $$, toast, storage, createEmitter, device, isNarrow, pressToContinue,
  };
});
