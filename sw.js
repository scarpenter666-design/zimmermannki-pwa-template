/* ============================================================
   sw.js – Service Worker. Bei allen Apps identisch.
   Hier nichts anpassen: App-Name kommt aus app.config.js,
   Version und Dateiliste kommen aus build.js.
   ============================================================ */
importScripts('./app.config.js', './build.js');

const CONFIG = self.APP_CONFIG;
const BUILD = self.APP_BUILD;

// Cache-Name "<id>@<version>". Das "@" kann in keiner id vorkommen,
// deshalb löscht die App "hello" nie die Caches von "hello-world".
const PREFIX = CONFIG.id + '@';
const CACHE = PREFIX + BUILD.version;
// Alte, von Hand gezählte Cache-Namen der Bestands-Apps ("ironlog-v2")
const LEGACY_CACHE = new RegExp('^' + CONFIG.id + '-v\\d+$');
const TIMEOUT = (CONFIG.sw && CONFIG.sw.networkTimeoutMs) || 3000;
const SCOPE = new URL('./', self.location).href;
const INDEX = new URL('./index.html', self.location).href;
const PRECACHE = BUILD.files.length ? BUILD.files : ['./index.html'];

// ── Installieren: alle Dateien frisch vom Server holen ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // cache:'reload' umgeht den HTTP-Cache. Sonst landet evtl.
      // eine alte Datei im neuen Cache.
      cache.addAll(PRECACHE.map(file => new Request(file, { cache: 'reload' })))
    )
  );
  // Bewusst KEIN skipWaiting(): Der Nutzer bestätigt das Update im Banner.
});

// ── Aktivieren: nur die eigenen alten Caches löschen ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => (key.startsWith(PREFIX) && key !== CACHE) || LEGACY_CACHE.test(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Nachrichten von der Seite ──
// Versteht das neue Format {type:'SKIP_WAITING'} und die beiden
// alten Formate der Bestands-Apps, damit auch eine noch geladene
// alte Seite das Update auslösen kann.
self.addEventListener('message', event => {
  const data = event.data;
  if (data === 'skip' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

// ── Anfragen ──
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;            // POST usw. nie anfassen
  if (!request.url.startsWith(SCOPE)) return;      // fremde Origin, fremde App
  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const request = event.request;
  const isPage = request.mode === 'navigate';
  const cache = await caches.open(CACHE);

  const fromCache = async () => {
    const hit = await cache.match(request, { ignoreSearch: isPage });
    if (hit) return hit;
    // Fallback auf index.html NUR für Seitenaufrufe.
    return isPage ? cache.match(INDEX) : undefined;
  };

  const fromNetwork = fetch(request).then(response => {
    if (response.ok) {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  });
  fromNetwork.catch(() => {}); // kein "unhandled rejection", wenn der Timeout gewinnt

  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), TIMEOUT);
  });

  try {
    const response = await Promise.race([fromNetwork, timeout]);
    if (response) {
      // Serverfehler bei einem Seitenaufruf: lieber die gecachte App zeigen.
      if (isPage && response.status >= 500) {
        return (await fromCache()) || response;
      }
      return response;
    }
    // Timeout: Cache nehmen, sonst doch aufs Netz warten.
    return (await fromCache()) || (await fromNetwork);
  } catch (error) {
    const cached = await fromCache();
    if (cached) return cached;
    if (isPage) {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<p style="font-family:sans-serif;padding:2rem">Offline, und die App ist noch nicht gespeichert. Bitte einmal online öffnen.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    return Response.error(); // echtes Fehlersignal für Scripts, Bilder usw.
  } finally {
    clearTimeout(timer);
  }
}
