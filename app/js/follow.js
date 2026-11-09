/**
 * Voice follow's sense of place: works out where the reader is from what speech recognition heard,
 * and keeps the reading line a couple of words ahead, because results arrive a little late. It
 * learns the reader's pace as it goes, so the text glides smoothly between results and waits when
 * they stop talking.
 *
 * Pure: no page or microphone access (voice.js does the listening), so it is unit tested in Node
 * (tests/follow.test.js).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./script.js"));
  else root.Plexo.follow = factory(root.Plexo.script);
})(typeof window !== "undefined" ? window : globalThis, function (script) {
  "use strict";

  /** How far ahead of the last recognised word the reading line sits, in word units. */
  const LOOKAHEAD = 2.5;
  /** How long to keep gliding forward after the last speech result, in milliseconds. */
  const GLIDE_MS = 1300;
  /** How many of the latest recognised words to match against the script. */
  const HEARD_WORDS = 6;

  function createFollower() {
    let units = null; // where the reading line should be, in word units; null until something is heard
    let cap = 0; // never glide further than this past the last match
    let lastHeardAt = 0;
    let lastBest = -1;
    let saidUpTo = -1;
    let rate = 2.5; // the reader's pace in word units a second, learned as they speak

    return {
      /** Forgets the reader's place (a new script, or Restart). */
      reset() {
        units = null;
        saidUpTo = -1;
        lastBest = -1;
      },

      /** Starts listening with the reading line where it is now. */
      startAt(atUnits) {
        units = atUnits;
        cap = atUnits;
        lastBest = -1;
        lastHeardAt = 0;
      },

      /** The reader scrolled or jumped by hand: carry on from there. */
      moveTo(atUnits) {
        units = atUnits;
        cap = atUnits;
      },

      /**
       * Matches the latest recognised words against the script.
       *   transcript  what was heard, latest words last
       *   words       the script's words, normalised (script.parse().words)
       *   wordUnits   when each word starts (the track's wordUnits)
       *   wordOnLine  the word on the reading line now, where the search starts
       *   now         milliseconds, for learning the pace
       */
      hear(transcript, words, wordUnits, wordOnLine, now) {
        const heard = transcript.split(/\s+/).map(script.normaliseWord).filter(Boolean).slice(-HEARD_WORDS);
        if (!heard.length || !words.length) return;

        const from = Math.max(saidUpTo, wordOnLine - 1);
        const n = heard.length;
        let best = -1;
        let bestScore = 0;
        for (let j = Math.max(0, from - 6); j < Math.min(words.length, from + 45); j++) {
          let score = 0;
          for (let k = 0; k < n && j - k >= 0; k++) {
            if (words[j - k] === heard[n - 1 - k]) score += k === 0 ? 1.5 : 1;
          }
          score -= Math.abs(j - from) * 0.01; // prefer the nearest of equally good matches
          if (score > bestScore) {
            bestScore = score;
            best = j;
          }
        }
        const confident = bestScore >= (n >= 3 ? 2.4 : 1.5);
        const jumpedBack = best < from - 2 && bestScore < 3.5;
        if (best < 0 || !confident || jumpedBack) return;

        if (lastBest >= 0 && best > lastBest) {
          const seconds = (now - lastHeardAt) / 1000;
          if (seconds > 0.15 && seconds < 4) {
            const measured = (wordUnits[best] - wordUnits[lastBest]) / seconds;
            rate = 0.7 * rate + 0.3 * Math.min(4.2, Math.max(1.3, measured));
          }
        }
        saidUpTo = best;
        const target = wordUnits[Math.min(best + 1, wordUnits.length - 1)] + LOOKAHEAD;
        if (units === null || target > units || bestScore >= 3.5) units = target;
        cap = target + 3;
        lastBest = best;
        lastHeardAt = now;
      },

      /** Glides on at the reader's pace for a moment after each result. Returns where the line should be. */
      advance(dt, now) {
        if (units !== null && now - lastHeardAt < GLIDE_MS) units = Math.min(cap, units + rate * dt);
        return units;
      },

      /** Where the reader is now, in word units, or null before anything is heard. */
      saying: () => (units === null ? null : units - LOOKAHEAD),
    };
  }

  return { createFollower, LOOKAHEAD };
});
