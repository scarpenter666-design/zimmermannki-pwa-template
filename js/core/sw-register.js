/* ============================================================
   sw-register.js – registriert den Service Worker und meldet,
   wenn eine neue Version bereitsteht.
   Zeigt selbst nichts an. Das Banner macht update-banner.js.
   ============================================================ */

const config = self.APP_CONFIG;

function isAllowedContext() {
  if (!('serviceWorker' in navigator)) return false;
  let inFrame = true;
  try { inFrame = window.self !== window.top; } catch { /* fremder Rahmen */ }
  if (inFrame) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return location.protocol === 'https:' || local;
}

/**
 * @param {object}   options
 * @param {string}   [options.url='./sw.js']
 * @param {function} options.onUpdateReady  wird aufgerufen, sobald eine neue Version wartet
 * @returns {Promise<{supported:boolean, applyUpdate:function, checkNow:function}>}
 */
export async function registerServiceWorker({ url = './sw.js', onUpdateReady = () => {} } = {}) {
  const noop = { supported: false, applyUpdate: () => location.reload(), checkNow: async () => false };
  if (!isAllowedContext()) return noop;

  let registration;
  try {
    // updateViaCache:'none' = sw.js, app.config.js und build.js immer frisch prüfen
    registration = await navigator.serviceWorker.register(url, { updateViaCache: 'none' });
  } catch (error) {
    console.warn('[sw] Registrierung fehlgeschlagen:', error);
    return noop;
  }

  let userAskedForUpdate = false;
  let reloaded = false;
  let announced = false;

  const announce = () => {
    // Nur melden, wenn schon eine alte Version läuft (sonst: Erstbesuch).
    if (announced || !navigator.serviceWorker.controller || !registration.waiting) return;
    announced = true;
    onUpdateReady();
  };

  // Fall 1: Beim Start wartet schon eine neue Version.
  announce();

  // Fall 2: Eine neue Version wird während der Sitzung fertig.
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') announce();
    });
  });

  // Neu laden NUR, wenn der Nutzer das Update angefordert hat.
  // (Beim Erstbesuch feuert controllerchange auch. Dann nicht neu laden.)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAskedForUpdate && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });

  // Fall 3: App lange offen oder kommt aus dem Hintergrund zurück.
  const everyMs = Math.max(5, (config.update && config.update.checkEveryMinutes) || 60) * 60 * 1000;
  let lastCheck = Date.now();
  const checkNow = async () => {
    lastCheck = Date.now();
    try { await registration.update(); } catch { /* offline: egal */ }
    announce();
    return Boolean(registration.waiting);
  };
  setInterval(checkNow, everyMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60 * 1000) checkNow();
  });

  const applyUpdate = () => {
    userAskedForUpdate = true;
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      // Sicherheitsnetz, falls controllerchange ausbleibt.
      setTimeout(() => { if (!reloaded) { reloaded = true; location.reload(); } }, 4000);
    } else {
      reloaded = true;
      location.reload();
    }
  };

  return { supported: true, applyUpdate, checkNow };
}
