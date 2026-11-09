/**
 * The word highlight: a box that glides behind the word being read, or a karaoke fill that sweeps
 * across it. The prompter says which word is being read and how far through it; this draws it.
 */
(function (Plexo) {
  "use strict";

  const { $ } = Plexo.util;
  const prefs = Plexo.settings.values;
  const pill = $("#pill");
  const scroller = $("#scroller");

  let words = []; // the script's word elements, from the prompter's last layout
  let current = -1;

  /** Moves the box behind the current word. Uses layout offsets, so it stays right when mirrored. */
  function place(visible, instant = false) {
    const word = words[current];
    if (!visible || prefs.highlight !== "word" || !word) {
      pill.classList.remove("on");
      return;
    }
    let x = word.offsetLeft;
    let y = word.offsetTop;
    for (let parent = word.offsetParent; parent && parent !== scroller; parent = parent.offsetParent) {
      x += parent.offsetLeft;
      y += parent.offsetTop;
    }
    const pad = prefs.fontSize * 0.12;
    const snap = instant || !pill.classList.contains("on");
    if (snap) pill.style.transition = "none";
    pill.style.width = `${word.offsetWidth + pad * 2}px`;
    pill.style.height = `${word.offsetHeight + pad * 0.5}px`;
    pill.style.transform = `translate(${(x - pad).toFixed(1)}px, ${(y - pad * 0.25).toFixed(1)}px)`;
    if (snap) {
      void pill.offsetWidth; // apply the jump before turning transitions back on
      pill.style.transition = "";
    }
    pill.classList.add("on");
  }

  /** Highlights word `index`, marking the words before it as read. */
  function set(index, visible) {
    if (index === current || !words.length) return;
    const previous = current;
    current = index;
    if (words[previous]) {
      words[previous].classList.remove("hl");
      words[previous].style.removeProperty("--p");
    }
    const low = Math.max(0, Math.min(previous, index));
    const high = Math.min(words.length - 1, Math.max(previous, index));
    for (let i = low; i <= high; i++) words[i].classList.toggle("done", i < index);
    if (words[index]) words[index].classList.add("hl");
    place(visible);
  }

  Plexo.highlight = {
    /** Uses a new layout's word elements, keeping the current word. */
    attach(wordEls) {
      words = wordEls;
    },
    /** Starts afresh, for a new script. */
    forget() {
      current = -1;
    },
    /** Clears every mark, for Restart. */
    clear() {
      words.forEach((word) => word.classList.remove("done", "hl"));
      current = -1;
    },
    set,
    place,
    /** Karaoke: fills the current word up to `share` (0 to 1). */
    fill(share) {
      if (prefs.highlight === "karaoke" && words[current]) {
        words[current].style.setProperty("--p", `${(Math.min(1, Math.max(0, share)) * 100).toFixed(1)}%`);
      }
    },
    index: () => current,
  };
})(window.Plexo);
