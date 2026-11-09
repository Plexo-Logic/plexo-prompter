/**
 * Record mode: film yourself with the script just under the lens.
 *
 *   Camera button   camera mode on or off. The front camera fills the screen behind the script,
 *                   mirrored like a selfie, and the script sits in a see-through band at the top.
 *   Play button     in camera mode it records: the countdown, then recording and scrolling start
 *                   together; pressed again, it stops and the take screen opens.
 * Tapping the text, Space and clickers still only pause and restart the scrolling, so they can never
 * end a take by accident. Voice follow rests during a take (a phone lets only one thing use the
 * microphone), so the text scrolls at the set speed.
 *
 * The take screen plays the take back and saves it: through the share sheet on iPhones and iPads
 * ("Save Video" puts it in Photos), as a download everywhere else (Android, computers). A take is
 * held in memory until it's saved, and never leaves the device otherwise.
 */
(function (Plexo) {
  "use strict";

  const { $, toast, formatDuration } = Plexo.util;
  const { prompter, views, voice, recorder } = Plexo;

  const camera = $("#camera");
  const badge = $("#rec-time");
  const takeVideo = $("#take-video");

  let stream = null;      // the camera, while camera mode is on
  let arming = false;     // the countdown before a take
  let take = null;        // the recording in progress
  let last = null;        // the finished take: { blob, extension, url, saved }
  let ticker = 0;
  let cameraOnReturn = false;

  const cameraOn = () => Boolean(stream);
  const APPLE_TOUCH = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  /* ---------- camera mode ---------- */

  async function toggleCamera() {
    if (take || arming) return;
    if (stream) return cameraOff();
    if (!recorder.supported()) {
      toast("This browser can’t record video. Try Safari on an iPhone, or Chrome or Edge.", 6000);
      return;
    }
    try {
      stream = await recorder.openCamera();
    } catch (error) {
      toast(error && error.name === "NotAllowedError"
        ? "The camera is blocked. Allow it for this site in your browser’s settings, then try again."
        : "Couldn’t start the camera. Check no other app is using it.", 6000);
      return;
    }
    camera.muted = true; // the preview is silent, or the microphone would play back through the speaker
    camera.srcObject = stream;
    camera.play().catch(() => {});
    document.body.classList.add("camera");
    prompter.relayout();
  }

  function cameraOff() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    camera.srcObject = null;
    document.body.classList.remove("camera");
    prompter.relayout();
  }

  /* ---------- takes ---------- */

  /** The play button in camera mode: start a take, cancel its countdown, or stop it. */
  function toggleTake() {
    if (take) return finish();
    if (arming) {
      arming = false;
      prompter.stop();
      voice.suspend(false);
      return;
    }
    if (voice.effectiveMode() === "voice") toast("Voice follow rests while you record. The text scrolls at your set speed.", 4000);
    voice.suspend(true);
    arming = true;
    prompter.roll(() => {
      arming = false;
      take = recorder.record(camera, stream, { portrait: innerHeight >= innerWidth });
      document.body.classList.add("recording");
      ticker = setInterval(tick, 250);
      tick();
    });
  }

  function tick() {
    const seconds = take.seconds();
    badge.textContent = formatDuration(seconds);
    if (seconds >= recorder.LIMIT) {
      toast("That’s the 10 minute limit for one take.", 5000);
      finish();
    } else if (seconds >= recorder.LIMIT - 60 && !take.warned) {
      take.warned = true;
      toast("One minute of recording left in this take.", 4000);
    }
  }

  /** Stops the take, keeps it, and opens the take screen. */
  async function finish() {
    const current = take;
    take = null;
    clearInterval(ticker);
    document.body.classList.remove("recording");
    prompter.stop();
    voice.suspend(false);
    const { blob, extension } = await current.stop();
    discard();
    last = { blob, extension, url: URL.createObjectURL(blob), saved: false };
    takeVideo.src = last.url;
    takeVideo.controls = true; // only once there's a take, or browsers show a broken-video placard
    views.show("take");
  }

  function discard() {
    if (last) URL.revokeObjectURL(last.url);
    last = null;
    takeVideo.controls = false;
    takeVideo.removeAttribute("src");
    takeVideo.load();
  }

  /** Leaving the prompter: the camera goes off, and a take still recording is stopped. */
  function leavePrompter() {
    if (take) {
      clearInterval(ticker);
      take.stop();
      take = null;
      document.body.classList.remove("recording");
      voice.suspend(false);
      toast("Recording stopped.");
    }
    arming = false;
    voice.suspend(false);
    cameraOff();
  }

  /** Back on the prompter after a take: the camera comes straight back on. */
  function enterPrompter() {
    if (!cameraOnReturn) return;
    cameraOnReturn = false;
    toggleCamera();
  }

  /* ---------- the take screen ---------- */

  async function save() {
    if (!last) return;
    const script = prompter.current();
    const when = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
    const name = `${(script ? script.name : "Take").replace(/[\\/:*?"<>|]/g, "-")} ${when}.${last.extension}`;
    const file = new File([last.blob], name, { type: last.blob.type });
    // iPhones and iPads: the share sheet's "Save Video" puts it in Photos (a download would land in Files).
    // Everywhere else a download is the sure way; on Android it lands in Downloads and shows in the gallery.
    if (APPLE_TOUCH && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        last.saved = true;
      } catch (error) {
        if (error.name !== "AbortError") toast("Couldn’t open the share sheet. Try again.");
      }
      return;
    }
    const link = Object.assign(document.createElement("a"), { href: last.url, download: name });
    link.click();
    last.saved = true;
    toast("Saved to your Downloads");
  }

  async function okToLeaveTake() {
    if (!last || last.saved) return true;
    return Plexo.dialog.confirm("Leave without saving this take?", { message: "It isn’t kept anywhere until you save it.", action: "Leave", danger: true });
  }

  /** Retake: back to the prompter (which reopens the script at its start), the camera on. */
  async function retake() {
    if (!(await okToLeaveTake())) return;
    discard();
    cameraOnReturn = true;
    views.goBack();
  }

  views.define("take", {
    enter: () => takeVideo.play().catch(() => {}),
    canLeave: () => {
      if (!last || last.saved) {
        cameraOnReturn = true;
        return true;
      }
      okToLeaveTake().then((yes) => {
        if (!yes) return;
        last.saved = true;
        cameraOnReturn = true;
        views.goBack();
      });
      return false;
    },
    leave: () => {
      takeVideo.pause();
      discard();
    },
    restore: () => views.goBack(), // a take isn't kept, so Forward can't come back to one
  });

  Plexo.record = { toggleCamera, toggleTake, cameraOn, isRecording: () => Boolean(take), save, retake, leavePrompter, enterPrompter };
})(window.Plexo);
