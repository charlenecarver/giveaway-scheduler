const CACHE_NAME = "givvy-time-v88";
const IMAGE_CACHE_NAME = "givvy-time-images-v5";
const REMOTE_IMAGE_TIMEOUT_MS = 8000;
const APP_SHELL = [
  "./",
  "./index.html",
  "./lives-admin.html",
  "./manifest.webmanifest",
  "./favicon-32.png",
  "./app-icon-180.png",
  "./app-icon-192.png",
  "./app-icon-512.png",
  "./givvy-time-logo-web.png",
  "./logos/manifest.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME && key !== IMAGE_CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();

    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    await Promise.allSettled(
      windows.map(client => client.navigate(client.url))
    );
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  if (event.request.destination === "image") {
    event.respondWith((async () => {
      const requestUrl = new URL(event.request.url);

      // Logo filenames are versioned when an image changes, so a cached
      // response is safe to reuse and avoids repeatedly billing Storage egress.
      if (requestUrl.origin !== self.location.origin) {
        const imageCache = await caches.open(IMAGE_CACHE_NAME);
        const cached = await imageCache.match(event.request);
        if (cached) return cached;

        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          REMOTE_IMAGE_TIMEOUT_MS
        );

        try {
          const response = await fetch(event.request, { signal: controller.signal });
          if (response.ok || response.type === "opaque") {
            await imageCache.put(event.request, response.clone());
          }
          return response;
        } catch (error) {
          // Resolve the request promptly so the image element can run its
          // normal error handler and try a bundled-logo fallback.
          return new Response("", {
            status: 504,
            statusText: "Logo request timed out"
          });
        } finally {
          clearTimeout(timeout);
        }
      }

      const imageCache = await caches.open(IMAGE_CACHE_NAME);
      const cached = await imageCache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request, { cache: "no-cache" });
      if (response.ok) {
        await imageCache.put(event.request, response.clone());
      }
      return response;
    })());
    return;
  }

  event.respondWith(fetch(event.request).catch(() =>
    caches.match(event.request).then(response => response || caches.match("./"))
  ));
});

self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || "Givvy Time reminder", {
    body: data.body || "A giveaway is ending soon.",
    icon: "app-icon-192.png",
    badge: "app-icon-192.png",
    tag: data.tag || "giveaway-reminder",
    renotify: true,
    data: { url: data.url || "./" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      existing.postMessage({ type: "REFRESH_SHARED_DATA" });
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});
