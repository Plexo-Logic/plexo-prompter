/**
 * Recording a take: the front camera is drawn into a canvas of a fixed size, and the canvas, with the
 * microphone, is what gets recorded. The canvas step gives every take an exact size for the way the
 * device is held, whatever the camera delivers, and keeps the saved video the right way round (only
 * the preview is mirrored, like a selfie). Takes are held in memory and never leave the device.
 *
 * The parts that decide things (format, size, crop) are pure and tested in Node.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Plexo.recorder = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /** MP4 where the browser records it (iPhones, current Chrome and Edge), WebM where it doesn't. */
  const FORMATS = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

  function pickFormat(isSupported) {
    const type = FORMATS.find((candidate) => isSupported(candidate)) || "";
    return { type, extension: type.startsWith("video/mp4") ? "mp4" : "webm" };
  }

  /** 1080 x 1920 held upright (Shorts, Reels, TikTok), 1920 x 1080 turned sideways. */
  const outputSize = (portrait) => (portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

  /** The part of a w x h camera picture that fills the output without stretching: centred, edges cropped. */
  function coverCrop(w, h, outW, outH) {
    const scale = Math.max(outW / w, outH / h);
    const sw = outW / scale;
    const sh = outH / scale;
    return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
  }

  const BITRATE = 5_000_000; // about 37 MB a minute
  const LIMIT = 10 * 60;     // seconds a take may run, held in memory

  /** The front camera and the microphone. */
  function openCamera() {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  }

  /**
   * Starts recording what `video` shows (the camera stream), plus the stream's sound.
   * Returns { seconds(), stop() }; stop() resolves { blob, extension }.
   */
  function record(video, stream, { portrait }) {
    const { width, height } = outputSize(portrait);
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d");
    let drawing = true;
    const draw = () => {
      if (!drawing) return;
      if (video.videoWidth) {
        const { sx, sy, sw, sh } = coverCrop(video.videoWidth, video.videoHeight, width, height);
        context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      }
      requestAnimationFrame(draw);
    };
    draw();

    const out = canvas.captureStream(30);
    stream.getAudioTracks().forEach((track) => out.addTrack(track));
    const format = pickFormat((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(out, { ...(format.type && { mimeType: format.type }), videoBitsPerSecond: BITRATE });
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.start(1000);
    const began = performance.now();

    return {
      seconds: () => (performance.now() - began) / 1000,
      stop: () =>
        new Promise((resolve) => {
          recorder.onstop = () => {
            drawing = false;
            out.getVideoTracks().forEach((track) => track.stop());
            resolve({ blob: new Blob(chunks, { type: recorder.mimeType || format.type || "video/webm" }), extension: format.extension });
          };
          recorder.stop();
        }),
    };
  }

  const supported = () =>
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;

  return { FORMATS, LIMIT, pickFormat, outputSize, coverCrop, openCamera, record, supported };
});
