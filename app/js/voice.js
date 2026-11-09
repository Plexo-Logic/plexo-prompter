/**
 * Voice follow: speech recognition through the browser's Web Speech API.
 *
 * Works in Chrome and Edge when the page is served by the launcher (a secure context) and the
 * computer is online. While it is on, the browser sends microphone audio to its speech service
 * (Google for Chrome, Microsoft for Edge). It is only ever started by the user.
 */
(function (Plexo) {
  "use strict";

  const { $, html, setHtml, toast, device } = Plexo.util;
  const prefs = Plexo.settings.values;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const MESSAGES = {
    unsupported: device.touch
      ? "This browser can’t do speech recognition. Use Safari on an iPhone, or Chrome on Android."
      : "This browser can’t do speech recognition. Open Plexo Prompter in Edge or Chrome.",
    fileUrl: "Voice follow needs the launcher. Opening the file directly doesn’t allow it.",
    embedded: "This window can’t use your microphone. Start Plexo Prompter with the launcher, or open it in Chrome.",
    blocked: "The microphone is blocked for this page. Allow it from the icon at the left of the address bar, then reload.",
    "not-allowed": device.touch
      ? "The microphone is blocked. Allow it for this site in your browser’s settings, then switch voice follow on again."
      : "The microphone is blocked. Allow it from the icon at the left of the address bar, then press V.",
    "service-not-allowed": `This browser won’t let the page use speech recognition. Try ${device.touch ? "Safari on an iPhone, or Chrome on Android" : "Edge or Chrome"}.`,
    "audio-capture": "No microphone found. Plug one in, or check it’s chosen in your sound settings.",
    network: "Voice follow couldn’t reach the speech service. Check your internet connection, or use auto-scroll.",
    silent: "Listening, but nothing heard yet. Check your microphone is on and selected.",
  };

  const served = location.protocol === "http:" || location.protocol === "https:";
  const embedded = /Electron\//.test(navigator.userAgent);

  let available = Boolean(Recognition) && served && !embedded;
  let reason = !Recognition ? MESSAGES.unsupported : !served ? MESSAGES.fileUrl : embedded ? MESSAGES.embedded : "";
  let recognition = null;
  let listening = false;
  let lastResultAt = 0;
  let language = navigator.language || "en-GB";
  let lastNonVoiceMode = prefs.mode === "voice" ? "auto" : prefs.mode;
  const availability = Plexo.util.createEmitter();

  const heardEl = $("#heard");

  function showHeard(content) {
    // The strip is right-to-left so long text trims from the left; <bdi> keeps the words themselves left-to-right.
    setHtml(heardEl, html`<bdi>${content}</bdi>`);
    heardEl.classList.add("on");
  }

  function setAvailable(isAvailable, why) {
    available = isAvailable;
    reason = why;
    if (!available) stop();
    availability.emit();
  }

  /** Watches the microphone permission so voice follow is disabled, with a reason, when blocked. */
  async function watchPermission() {
    if (!Recognition || !served || embedded || !navigator.permissions) return;
    try {
      const status = await navigator.permissions.query({ name: "microphone" });
      const update = () => setAvailable(status.state !== "denied", status.state === "denied" ? MESSAGES.blocked : "");
      update();
      status.onchange = update;
    } catch {
      /* the permission can't be queried in this browser; errors are reported when it starts */
    }
  }

  /** The mode the prompter should use: voice falls back to auto-scroll where it can't work. */
  function effectiveMode() {
    return prefs.mode === "voice" && !available ? "auto" : prefs.mode;
  }

  /**
   * Starts listening. `onTranscript` receives the latest recognised text, interim results
   * included. Returns true if listening started.
   */
  function start(onTranscript) {
    if (!available) {
      toast(reason, 5000);
      return false;
    }
    stop();
    const instance = new Recognition();
    recognition = instance;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let text = "";
      for (let i = Math.max(0, event.results.length - 2); i < event.results.length; i++) text += `${event.results[i][0].transcript} `;
      lastResultAt = performance.now();
      onTranscript(text);
      const lastWords = text.trim().split(/\s+/).slice(-9).join(" ");
      if (lastWords) showHeard(html`<b>Heard</b>&nbsp; ${lastWords}`);
    };

    recognition.onerror = (event) => {
      if (event.error === "language-not-supported" && language !== "en-US") {
        language = "en-US";
        return;
      }
      if (event.error === "no-speech" || event.error === "aborted") return;
      const message = MESSAGES[event.error] || `Voice follow stopped (${event.error}). ${device.touch ? "Switch it on again in Display settings" : "Press V to try again"}, or use auto-scroll.`;
      stop();
      toast(message, 6000);
      showHeard(message);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setAvailable(false, message);
    };

    // Browsers end recognition after a silence; carry on while the user still wants it.
    recognition.onend = () => {
      if (!listening || recognition !== instance) return; // stopped, or replaced by a newer start()
      try {
        instance.lang = language;
        instance.start();
      } catch {
        /* already restarting */
      }
    };

    try {
      recognition.start();
    } catch {
      toast("Voice follow couldn’t start.", 5000);
      return false;
    }
    listening = true;
    lastResultAt = performance.now();
    showHeard(html`Listening. Start reading out&nbsp;loud.`);
    return true;
  }

  function stop() {
    listening = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* not running */
      }
      recognition = null;
    }
    setTimeout(() => {
      if (!listening) heardEl.classList.remove("on");
    }, 2500);
  }

  /** Called every frame: nudges the user if nothing has been heard for a while. */
  function tick() {
    if (listening && performance.now() - lastResultAt > 7000) {
      lastResultAt = performance.now();
      showHeard(MESSAGES.silent);
    }
  }

  /** The V key: switch voice follow on or off, returning to the previous mode. */
  function toggleMode() {
    if (!available) {
      toast(reason, 6000);
      return;
    }
    if (prefs.mode === "voice") {
      Plexo.settings.update({ mode: lastNonVoiceMode });
      toast("Voice follow off.");
    } else {
      lastNonVoiceMode = prefs.mode;
      Plexo.settings.update({ mode: "voice" });
      toast(`Voice follow on. ${device.touch ? "Tap the screen" : "Press Space"} and start speaking.`);
    }
  }

  /** Setup's microphone check: listens for up to ten seconds and shows what it heard. */
  function testMicrophone(output) {
    if (!available) return;
    const test = new Recognition();
    test.lang = language;
    test.continuous = true;
    test.interimResults = true;
    let heardEnough = false;
    setHtml(output, html`<span class="live-dot"></span>Listening. Say a sentence out&nbsp;loud.`);

    test.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += `${event.results[i][0].transcript} `;
      text = text.trim();
      heardEnough = heardEnough || text.split(/\s+/).length >= 3;
      setHtml(output, html`<b>Heard:</b> ${text}${heardEnough ? html`<div class="ok">Voice follow can hear you.</div>` : ""}`);
      if (heardEnough) setTimeout(() => test.stop(), 1200);
    };
    test.onerror = (event) => {
      const hint = event.error === "no-speech" ? "Nothing heard yet. Check the right microphone is selected, then try again." : MESSAGES[event.error];
      output.textContent = hint || `Couldn’t use the microphone (${event.error}).`;
    };
    try {
      test.start();
    } catch {
      output.textContent = "Couldn’t start the microphone.";
      return () => {};
    }
    const timer = setTimeout(() => test.stop(), 10000);
    return () => {
      clearTimeout(timer);
      try {
        test.stop();
      } catch {
        /* already stopped */
      }
    };
  }

  watchPermission();

  Plexo.voice = {
    isAvailable: () => available,
    reason: () => reason,
    isListening: () => listening,
    effectiveMode,
    start, stop, tick, toggleMode, testMicrophone,
    onAvailabilityChange: availability.on,
  };
})(window.Plexo);
