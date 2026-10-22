const CACHE_NAME = 'gmv-counter-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']
const TAILWIND_CDN = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL)
        // The app currently loads Tailwind from jsDelivr. Cache its opaque
        // response during installation so the stylesheet still loads offline.
        try {
          const response = await fetch(TAILWIND_CDN, { mode: 'no-cors' })
          await cache.put(TAILWIND_CDN, response)
        } catch {
          // Keep installation available if the CDN cannot be reached.
        }
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET') return

  if (request.url === TAILWIND_CDN) {
    event.respondWith(
      caches.match(TAILWIND_CDN).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(TAILWIND_CDN, copy))
        return response
      })),
    )
    return
  }

  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
