const CACHE = 'shijian-shell-v2';
const SHELL = ['./', './index.html', './style.css', './account.css', './app.js', './model.mjs',
  './account.mjs', './sync.mjs', './cloud.mjs', './config.mjs', './supabase-vendor.mjs',
  './manifest.webmanifest', './icon-original.ico', './icon-original-192.png', './icon-solid.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('shijian-shell-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Cache only app files. Auth requests and journal records never enter this cache.
  if (event.request.method !== 'GET' || url.origin !== location.origin ||
      !SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const cloned = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, cloned)));
    }
    return response;
  }).catch(() => caches.match(event.request).then(response => response || Response.error())));
});
