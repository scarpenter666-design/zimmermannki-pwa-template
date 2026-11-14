/* ============================================================
   install.js – "App installieren".
   - Android/Desktop (Chrome, Edge): fängt den Install-Prompt ab
     und blendet einen eigenen Knopf ein.
   - iPhone/iPad: Dort gibt es keinen Prompt. Stattdessen einmalig
     der Hinweis "Teilen → Zum Home-Bildschirm".

     initInstall({ button: document.getElementById('installBtn'), store });
   ============================================================ */
import { showNotice, toast } from './notice.js';

/** Läuft die App schon installiert (ohne Browser-Leiste)? */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIos() {
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOs;
}

/**
 * @param {object}       options
 * @param {HTMLElement}  [options.button]  Knopf, der bei Bedarf eingeblendet wird (hidden-Attribut)
 * @param {object}       [options.store]   von openStore(), merkt sich "iOS-Hinweis gesehen"
 */
export function initInstall({ button = null, store = null } = {}) {
  let promptEvent = null;

  if (button) button.hidden = true;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();            // Chrome-eigene Leiste unterdrücken
    promptEvent = event;
    if (button) button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    if (button) button.hidden = true;
    toast('App installiert.');
  });

  if (button) {
    button.addEventListener('click', async () => {
      if (!promptEvent) return;
      promptEvent.prompt();
      await promptEvent.userChoice;
      promptEvent = null;
      button.hidden = true;
    });
  }

  // iOS: einmaliger Hinweis
  if (isIos() && !isStandalone()) {
    const seen = store && store.getMeta().iosHintSeen;
    if (!seen) {
      showNotice({
        id: 'ios-install',
        text: 'Als App installieren: unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.',
        actions: [{
          label: 'Verstanden',
          onClick: async notice => {
            if (store) await store.setMeta({ iosHintSeen: true });
            notice.close();
          }
        }]
      });
    }
  }

  return { isStandalone, canPrompt: () => Boolean(promptEvent) };
}
