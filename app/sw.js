/**
 * Offline support for the hosted version (main.js registers it on https only; the launcher doesn't
 * need it). Keeps a copy of the app's own files, so after one visit the app opens and runs with no
 * connection. It serves the saved copy straight away and refreshes it in the background, so an
 * update arrives on the next visit.
 *
 * Scripts never pass through here: they live in the browser's storage on the device.
 */
const CACHE = "plexo-prompter";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Clear out caches from any older naming, then look after pages that are already open.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  // Fetch a fresh copy in the background either way, and keep it for next time.
  const fresh = caches.open(CACHE).then((cache) =>
    fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
  );
  event.waitUntil(fresh.catch(() => {})); // offline: nothing to refresh
  event.respondWith(caches.match(request).then((cached) => cached || fresh));
});
