/* ============================================================
   update-banner.js – Hinweis "Neue Version verfügbar".
   Eine Zeile im App-Code genügt:

     const updates = await initUpdates();

   Optional kann die App ein Update aufschieben, z. B. während
   eines laufenden Trainings:

     await initUpdates({ canUpdateNow: () => !trainingLaeuft });
   ============================================================ */
import { registerServiceWorker } from './sw-register.js';
import { showNotice } from './notice.js';

/** Version der gerade laufenden App (aus build.js). */
export function getVersion() {
  return (self.APP_BUILD && self.APP_BUILD.version) || 'unbekannt';
}

/**
 * @param {object}   [options]
 * @param {function} [options.canUpdateNow]  gibt false zurück, wenn gerade nicht neu geladen werden darf
 * @param {object}   [options.texts]         eigene Texte
 */
export async function initUpdates({ canUpdateNow = () => true, texts = {} } = {}) {
  const t = {
    ready: 'Neue Version verfügbar.',
    button: 'Jetzt aktualisieren',
    busy: 'Gerade nicht möglich. Erst die laufende Sitzung beenden.',
    working: 'Wird aktualisiert …',
    ...texts
  };

  let sw;
  const showBanner = () => {
    showNotice({
      id: 'update',
      text: t.ready,
      actions: [{
        label: t.button,
        primary: true,
        onClick: notice => {
          if (!canUpdateNow()) { notice.setText(t.busy); return; }
          notice.setText(t.working);
          sw.applyUpdate();
        }
      }]
    });
  };

  sw = await registerServiceWorker({ onUpdateReady: showBanner });

  return {
    supported: sw.supported,
    version: getVersion(),
    /** Sofort nach einem Update suchen. true = neue Version wartet. */
    checkNow: sw.checkNow
  };
}
