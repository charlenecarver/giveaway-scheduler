const CACHE_NAME = "givvy-time-v35";
const IMAGE_CACHE_NAME = "givvy-time-images-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon-32.png",
  "./app-icon-180.png",
  "./app-icon-192.png",
  "./app-icon-512.png",
  "./givvy-time-logo-web.png"
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
      const cached = await caches.match(event.request);
      if (cached) {
        return cached;
      }

      return fetch(event.request).then(async response => {
        if (response.ok || response.type === "opaque") {
          const imageCache = await caches.open(IMAGE_CACHE_NAME);
          await imageCache.put(event.request, response.clone());
        }
        return response;
      });
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
