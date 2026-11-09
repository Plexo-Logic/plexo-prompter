/**
 * The track: where each word sits once the script is laid out, and the maths between scroll
 * position and time.
 *
 * Time is measured in word units (see script.js). The prompter lays the script out and measures it;
 * build() turns those measurements into "anchors", pairs of [scroll y, word units], with straight
 * lines in between. Each line of text is centred on the reading line half-way through its words,
 * which keeps the word being read, and its highlight, inside the reading band. Auto-scroll then
 * just walks through word units at the reading pace.
 *
 * Pure functions with no access to the page, so they are unit tested in Node (tests/track.test.js).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./script.js"));
  else root.Plexo.track = factory(root.Plexo.script);
})(typeof window !== "undefined" ? window : globalThis, function (script) {
  "use strict";

  const { BEATS } = script;

  /** Position along a list of [x, y] anchors: linear between anchors, flat beyond the ends. */
  function interpolate(anchors, value, from, to) {
    if (value <= anchors[0][from]) return anchors[0][to];
    for (let i = 1; i < anchors.length; i++) {
      if (value <= anchors[i][from]) {
        const span = anchors[i][from] - anchors[i - 1][from];
        return span <= 0 ? anchors[i][to] : anchors[i - 1][to] + ((anchors[i][to] - anchors[i - 1][to]) * (value - anchors[i - 1][from])) / span;
      }
    }
    return anchors[anchors.length - 1][to];
  }

  /**
   * Builds the track from measurements of the laid-out script. All y values are in pixels from the
   * top of the scrolling text.
   *   words       [{ y, paragraph }] for each word in order: the centre of its line, and anything
   *               that is the same for words in the same paragraph (the paragraph element will do)
   *   durations   word units for each word (from script.parse)
   *   markers     [{ y, seconds }] pause markers in order; seconds is null for "wait for the reader"
   *   headingYs   the centre of each heading, in order
   *   endY        the centre of the end mark
   *   readY       how far the reading line is from the top of the screen
   *   lineHeight  in pixels
   */
  function build({ words, durations, markers, headingYs, endY, readY, lineHeight }) {
    // Words on the same height in the same paragraph form a line.
    const lines = [];
    words.forEach((word, i) => {
      const last = lines[lines.length - 1];
      if (last && last.paragraph === word.paragraph && Math.abs(last.y - word.y) < lineHeight * 0.3) last.count++;
      else lines.push({ y: word.y, count: 1, paragraph: word.paragraph, first: i });
    });

    const placed = markers.map((m) => ({ y: m.y, seconds: m.seconds || null, units: null, passed: false }));
    const anchors = [];
    const wordUnits = [];
    const push = (y, u) => {
      const previous = anchors[anchors.length - 1];
      anchors.push([previous ? Math.max(previous[0], y) : y, u]);
    };

    let u = 0;
    let markerIndex = 0;
    let headingIndex = 0;
    if (!lines.length) push(readY, 0);
    lines.forEach((line, k) => {
      push(line.y - lineHeight * 0.5, u);
      for (let j = 0; j < line.count; j++) {
        wordUnits.push(u);
        u += durations[line.first + j] || 1;
      }
      const next = lines[k + 1];
      if (next && next.paragraph === line.paragraph) return;

      // End of a paragraph: the beats for any markers and headings before the next one.
      const nextY = next ? next.y : endY;
      push(Math.min(line.y + lineHeight * 0.5, nextY), u);
      while (markerIndex < placed.length && placed[markerIndex].y <= line.y) markerIndex++;
      while (markerIndex < placed.length && placed[markerIndex].y < nextY) {
        const marker = placed[markerIndex++];
        u += BEATS.marker;
        push(marker.y, u);
        marker.units = u;
      }
      let headingsCrossed = 0;
      while (headingIndex < headingYs.length && headingYs[headingIndex] <= line.y) headingIndex++;
      while (headingIndex < headingYs.length && headingYs[headingIndex] < nextY) {
        headingIndex++;
        headingsCrossed++;
      }
      u += BEATS.paragraph + BEATS.heading * headingsCrossed;
    });
    push(Math.max(endY, anchors[anchors.length - 1][0]), u + BEATS.end);

    const wordY = words.map((word) => word.y);
    const maxPos = () => Math.max(0, endY - readY);
    const clamp = (pos) => Math.min(maxPos(), Math.max(0, pos));
    const yAt = (units) => interpolate(anchors, units, 1, 0);

    return {
      wordY,
      wordUnits,
      lineYs: lines.map((line) => line.y),
      markers: placed,
      readY,
      lineHeight,
      /** Word units at the very end of the script. */
      endUnits: anchors[anchors.length - 1][1],
      /** Scroll y for a time in word units. */
      yAt,
      /** Word units for a scroll y: the inverse of yAt. */
      unitsAt: (y) => interpolate(anchors, y, 0, 1),
      /** The word being said at a time in word units, or -1 if there are no words. */
      wordAtUnits(units) {
        if (!wordUnits.length) return -1;
        let low = 0;
        let high = wordUnits.length - 1;
        while (low < high) {
          const mid = (low + high + 1) >> 1;
          if (wordUnits[mid] <= units + 1e-6) low = mid;
          else high = mid - 1;
        }
        return low;
      },
      /** The first word whose line is at or below y, or -1 if there are no words. */
      firstWordFrom(y) {
        if (!wordY.length) return -1;
        let low = 0;
        let high = wordY.length - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (wordY[mid] < y) low = mid + 1;
          else high = mid;
        }
        return low;
      },
      /** The furthest the text can scroll: the end mark on the reading line. */
      maxPos,
      clamp,
      /** The scroll position with the first word on the reading line. */
      homePos: () => (wordUnits.length ? clamp(yAt(0) - readY) : 0),
      /** Marks each pause marker above the reading line as passed. */
      markPassed(pos) {
        placed.forEach((m) => (m.passed = m.y < pos + readY - 2));
      },
    };
  }

  const EMPTY = { words: [], durations: [], markers: [], headingYs: [], endY: 0, readY: 0, lineHeight: 0 };

  return { build, empty: () => build(EMPTY) };
});
