const CACHE_NAME = "giveaway-scheduler-v1";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./app-icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() =>
    caches.match(event.request).then(response => response || caches.match("./"))
  ));
});

self.addEventListener("push", event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || "Giveaway reminder", {
    body: data.body || "A giveaway is ending soon.",
    icon: "app-icon.svg",
    badge: "app-icon.svg",
    tag: data.tag || "giveaway-reminder",
    renotify: true,
    data: { url: data.url || "./" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});
