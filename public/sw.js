// Gulshan Factory — minimal service worker.
// Purpose: make the app installable on Android. It caches nothing and never
// serves stale files: every request goes straight to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network by default */ });
