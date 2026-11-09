/**
 * Script parsing and timing. Pure functions with no access to the page, so they are unit tested
 * in Node (see tests/script.test.js).
 *
 * Script format:
 *   blank line        new paragraph
 *   # Heading         section heading, shown small, not read out
 *   [PAUSE]           stop until the reader presses Space
 *   [PAUSE 2]         hold for two seconds, then carry on
 *   //                breath mark
 *   [ANY WORDS]       a reminder badge, not read out
 *   *words*           emphasis
 *
 * Timing is measured in "word units". Each word gets time for its syllables plus a pause after
 * punctuation, then all weights are scaled so the average word is one unit. That keeps
 * "words per minute" meaning what people expect while giving the rhythm of real speech.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else root.Plexo.script = factory(root.Plexo.util);
})(typeof window !== "undefined" ? window : globalThis, function (util) {
  "use strict";

  const { escapeHtml } = util;

  /** Extra word units added between paragraphs, per heading crossed, and at a pause marker. */
  const BEATS = Object.freeze({ paragraph: 0.7, heading: 0.5, marker: 0.5, end: 0.5 });

  const PAUSE_TAG = /\[\s*pause(?:\s+(\d+(?:\.\d+)?))?\s*\]/gi;
  const PAUSE_LINE = /^\[\s*pause(?:\s+(\d+(?:\.\d+)?))?\s*\]$/i;
  const HEADING_LINE = /^#+\s*(.*)$/;
  const MAX_PAUSE_SECONDS = 600;

  /** Lower-case letters and digits only, so speech results and script words compare cleanly. */
  function normaliseWord(word) {
    return String(word).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "");
  }

  /** A rough English syllable count, enough to give long words more time than short ones. */
  function syllables(word) {
    let w = String(word).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!w) return 1;
    if (/^\d+$/.test(w)) return Math.max(1, Math.round(w.length * 1.6));
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  /** Time taken to say a word, before scaling. */
  const spokenWeight = (word) => 0.5 + 0.5 * syllables(word);

  /** The natural pause after a word, from its closing punctuation. */
  function pauseAfter(word) {
    const closers = "[\"'’”)]*$";
    if (new RegExp(`(…|\\.\\.\\.)${closers}`).test(word)) return 1.3;
    if (new RegExp(`[.!?]${closers}`).test(word)) return 1.1;
    if (new RegExp(`[,;:]${closers}`).test(word)) return 0.55;
    return 0;
  }

  /** Splits text into heading, paragraph and pause blocks. */
  function splitBlocks(text) {
    const source = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(PAUSE_TAG, (tag) => `\n${tag.trim()}\n`);

    const blocks = [];
    let lines = [];
    const endParagraph = () => {
      if (lines.length) blocks.push({ type: "paragraph", text: lines.join(" ") });
      lines = [];
    };

    for (const rawLine of source.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        endParagraph();
        continue;
      }
      const heading = line.match(HEADING_LINE);
      if (heading) {
        endParagraph();
        if (heading[1]) blocks.push({ type: "heading", text: heading[1] });
        continue;
      }
      const pause = line.match(PAUSE_LINE);
      if (pause) {
        endParagraph();
        const seconds = pause[1] ? Math.min(MAX_PAUSE_SECONDS, parseFloat(pause[1])) : null;
        blocks.push({ type: "pause", seconds: seconds || null });
        continue;
      }
      lines.push(line);
    }
    endParagraph();
    return blocks;
  }

  // Private-use markers stand in for cues, breath marks and emphasis while a paragraph is split
  // into words. They cannot appear in normal text.
  const CUE_OPEN = "\u0003", CUE_CLOSE = "\u0004", BREATH = "\u0005", EM_OPEN = "\u0001", EM_CLOSE = "\u0002";

  /**
   * Turns a script into display markup plus per-word timing.
   * @returns {{blocks: object[], html: string, words: string[], durations: number[], spoken: number[]}}
   *   words: normalised words for voice matching; durations: word units including the pause after
   *   each word; spoken: the part of each duration spent saying the word.
   * `stop` labels a [PAUSE] that waits for the user, so a phone can say "tap" where a computer says "press Space".
   */
  function parse(text, { stop = "Stop, press Space" } = {}) {
    const blocks = splitBlocks(text);
    const words = [];
    const spoken = [];
    const gaps = [];

    const renderParagraph = (paragraph) => {
      const cues = [];
      const marked = paragraph
        .replace(/\[([^[\]]+)\]/g, (_, cue) => ` ${CUE_OPEN}${cues.push(cue) - 1}${CUE_CLOSE} `)
        .replace(/\/\//g, ` ${BREATH} `)
        .replace(/\*([^*]+)\*/g, `${EM_OPEN}$1${EM_CLOSE}`);

      const parts = [];
      let emphasis = false;
      for (let token of marked.split(/\s+/)) {
        if (!token) continue;
        const cue = token.match(new RegExp(`^${CUE_OPEN}(\\d+)${CUE_CLOSE}$`));
        if (cue) {
          parts.push(`<span class="cue">${escapeHtml(cues[Number(cue[1])])}</span>`);
          continue;
        }
        if (token === BREATH) {
          if (gaps.length) gaps[gaps.length - 1] += 0.55;
          parts.push('<span class="breath">//</span>');
          continue;
        }
        const opens = token.includes(EM_OPEN);
        const closes = token.includes(EM_CLOSE);
        token = token.replace(new RegExp(`[${EM_OPEN}${EM_CLOSE}]`, "g"), "");
        if (opens) emphasis = true;

        const normal = normaliseWord(token);
        let part = escapeHtml(token);
        if (normal) {
          part = `<span class="word" data-i="${words.length}">${part}</span>`;
          words.push(normal);
          spoken.push(spokenWeight(token));
          gaps.push(pauseAfter(token));
        }
        parts.push(emphasis ? `<span class="emphasis">${part}</span>` : part);
        if (closes) emphasis = false;
      }
      return parts.join(" ");
    };

    let html = "";
    for (const block of blocks) {
      if (block.type === "heading") {
        html += `<div class="heading"><span>${escapeHtml(block.text)}</span><span class="heading-time"></span></div>`;
      } else if (block.type === "pause") {
        const label = block.seconds ? `Pause ${block.seconds}s` : escapeHtml(stop);
        html += `<div class="pause-marker" data-seconds="${block.seconds || ""}">${label}</div>`;
      } else {
        block.firstWord = words.length;
        block.html = renderParagraph(block.text);
        block.wordCount = words.length - block.firstWord;
        html += `<p>${block.html}</p>`;
      }
    }

    // Scale so the average word is one unit.
    const raw = spoken.map((weight, i) => weight + gaps[i]);
    const total = raw.reduce((sum, weight) => sum + weight, 0) || 1;
    const scale = words.length / total;
    const durations = raw.map((weight) => weight * scale);
    const spokenScaled = spoken.map((weight) => weight * scale);
    for (const block of blocks) {
      if (block.type !== "paragraph") continue;
      block.units = durations.slice(block.firstWord, block.firstWord + block.wordCount).reduce((a, b) => a + b, 0);
    }
    return { blocks, html, words, durations, spoken: spokenScaled };
  }

  /**
   * Works out when each part of a parsed script is reached at a given pace. Uses the same word
   * units as the scrolling, so these times match the prompter's clock.
   * @returns {{items: object[], times: number[], total: number, words: number, waits: number, holdSeconds: number}}
   *   items: headings, paragraphs, pauses and the end, each with a time `t` in seconds.
   *   times: the start time of each block, by block index.
   */
  function timeline(parsed, wordsPerMinute) {
    const unitsPerSecond = wordsPerMinute / 60;
    const items = [];
    const times = new Array(parsed.blocks.length).fill(null);
    let units = 0;
    let holdSeconds = 0;
    let started = false;
    let pendingHeadings = [];
    const now = () => units / unitsPerSecond + holdSeconds;

    parsed.blocks.forEach((block, index) => {
      if (block.type === "heading") {
        pendingHeadings.push(index);
        return;
      }
      if (block.type === "pause") {
        if (started) units += BEATS.marker;
        times[index] = now();
        items.push({ kind: block.seconds ? "hold" : "wait", seconds: block.seconds, t: now() });
        holdSeconds += block.seconds || 0;
        return;
      }
      if (!block.wordCount) return;
      if (started) units += BEATS.paragraph + BEATS.heading * pendingHeadings.length;
      const t = now();
      for (const h of pendingHeadings) {
        times[h] = t;
        items.push({ kind: "heading", label: parsed.blocks[h].text, t });
      }
      pendingHeadings = [];
      times[index] = t;
      items.push({ kind: "paragraph", t, preview: excerpt(block.text, 7) });
      units += block.units;
      started = true;
    });

    units += BEATS.paragraph + BEATS.heading * pendingHeadings.length;
    const total = started ? (units + BEATS.end) / unitsPerSecond + holdSeconds : 0;
    for (const h of pendingHeadings) {
      times[h] = total;
      items.push({ kind: "heading", label: parsed.blocks[h].text, t: total });
    }
    items.push({ kind: "end", t: total });

    return {
      items,
      times,
      total,
      words: parsed.words.length,
      waits: items.filter((item) => item.kind === "wait").length,
      holdSeconds,
    };
  }

  /** The first few readable words of some script text, without markers. */
  function excerpt(text, wordLimit = 18) {
    return String(text)
      .replace(/^#.*$/gm, "")
      .replace(/\[[^[\]]*\]|\/\/|\*/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, wordLimit)
      .join(" ");
  }

  // Lists show a length for every script and re-render as the user types in search, so totals are
  // worked out once per script text and pace.
  const totals = new Map();
  let totalsPace = null;

  /** The reading time of some script text in seconds, at a pace in words per minute. */
  function totalSeconds(text, wordsPerMinute) {
    if (totalsPace !== wordsPerMinute) {
      totals.clear();
      totalsPace = wordsPerMinute;
    }
    if (!totals.has(text)) totals.set(text, timeline(parse(text), wordsPerMinute).total);
    return totals.get(text);
  }

  return { BEATS, parse, timeline, totalSeconds, normaliseWord, syllables, pauseAfter, excerpt };
});
