/* ============================================================
   lock-screen.js – Oberfläche zur Verschlüsselung.
   - unlockApp():  Sperrbildschirm beim Start (PIN vergeben oder eingeben)
   - askSecret():  Dialog, der nach PIN oder Passwort fragt
                   (PIN ändern, Backup-Passwort)

     const vault = await openVault();
     const codec = await unlockApp({ vault });
     const store = await openStore({ codec });

   Baut sein HTML selbst. Keine Inline-Styles, keine Inline-Handler.
   ============================================================ */
import { checkSecret, CryptoError } from './crypto.js';
import { eraseAppData } from './storage.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function secretInput(id, label, autocomplete) {
  const wrap = el('div');
  const caption = el('label', 'label', label);
  caption.htmlFor = id;
  const input = el('input', 'input');
  input.id = id;
  input.type = 'password';
  input.autocomplete = autocomplete;
  input.autocapitalize = 'off';
  input.spellcheck = false;
  wrap.append(caption, input);
  return { wrap, input };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Zeigt den Sperrbildschirm und kommt erst zurück, wenn entsperrt ist.
 * @param {object} options
 * @param {object} options.vault      von openVault()
 * @param {string} [options.appName]  Vorgabe APP_CONFIG.name
 * @returns {Promise<object>} Codec für openStore({ codec })
 */
export function unlockApp({ vault, appName = self.APP_CONFIG && self.APP_CONFIG.name }) {
  return new Promise(resolve => {
    const isNew = vault.state === 'new';
    const screen = el('div', 'cp-lock');
    screen.setAttribute('role', 'dialog');
    screen.setAttribute('aria-modal', 'true');
    screen.setAttribute('aria-label', 'App entsperren');

    const form = el('form', 'cp-lock__box stack');
    form.noValidate = true;
    form.append(el('h1', 'app__title', appName || 'App'));
    form.append(el('p', null, isNew
      ? 'Deine Daten werden verschlüsselt gespeichert. Vergib jetzt ein Passwort (mindestens 8 Zeichen). Ein PIN aus mindestens 6 Ziffern geht auch, schützt aber deutlich schwächer.'
      : 'Bitte Passwort eingeben.'));

    const first = secretInput('cpLockSecret', isNew ? 'Passwort (oder PIN)' : 'Passwort', isNew ? 'new-password' : 'current-password');
    form.append(first.wrap);

    let second = null;
    if (isNew) {
      second = secretInput('cpLockRepeat', 'Wiederholen', 'new-password');
      form.append(second.wrap);
    }

    const hint = el('p', 'muted');
    hint.id = 'cpLockHint';
    const error = el('p', 'cp-lock__error');
    error.id = 'cpLockError';
    error.setAttribute('role', 'alert');
    form.append(hint, error);

    if (isNew) {
      form.append(el('p', 'muted', 'Wichtig: Es gibt keine Hintertür. Wer das Passwort vergisst, kommt nicht mehr an die Daten. Mach regelmäßig ein Backup.'));
    }

    const submit = el('button', 'btn', isNew ? 'Speichern und starten' : 'Entsperren');
    submit.type = 'submit';
    submit.id = 'cpLockSubmit';
    form.append(submit);

    // "PIN vergessen": nur Löschen ist möglich
    let forgot = null;
    if (!isNew) {
      forgot = el('button', 'btn btn--ghost btn--small', 'Passwort vergessen?');
      forgot.type = 'button';
      forgot.id = 'cpLockForgot';
      form.append(forgot);
    }

    screen.append(form);
    document.body.append(screen);
    first.input.focus();

    if (isNew) {
      first.input.addEventListener('input', () => {
        hint.textContent = first.input.value ? checkSecret(first.input.value).message : '';
      });
    }

    let wrongTries = 0;
    let busy = false;

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      error.textContent = '';
      const secret = first.input.value;
      if (isNew) {
        const check = checkSecret(secret);
        if (!check.ok) { error.textContent = check.message; return; }
        if (secret !== second.input.value) { error.textContent = 'Die beiden Eingaben sind nicht gleich.'; return; }
      }
      if (!secret) return;

      busy = true;
      submit.disabled = true;
      submit.textContent = 'Bitte warten …';
      try {
        const codec = isNew ? await vault.setup(secret) : await vault.unlock(secret);
        screen.remove();
        resolve(codec);
      } catch (problem) {
        if (problem instanceof CryptoError && problem.code === 'wrong') {
          wrongTries += 1;
          // Kleine Bremse gegen Durchprobieren von Hand. Kein echter Schutz:
          // Wer die Daten kopiert hat, probiert außerhalb der App.
          const pause = wrongTries >= 3 ? Math.min(30, 2 ** (wrongTries - 2)) : 0;
          error.textContent = pause ? `${problem.message} Nächster Versuch in ${pause} Sekunden.` : problem.message;
          first.input.value = '';
          if (pause) await wait(pause * 1000);
          if (pause) error.textContent = problem.message;
        } else {
          error.textContent = (problem && problem.message) || 'Das hat nicht geklappt.';
        }
        busy = false;
        submit.disabled = false;
        submit.textContent = isNew ? 'Speichern und starten' : 'Entsperren';
        first.input.focus();
      }
    });

    if (forgot) {
      forgot.addEventListener('click', async () => {
        const typed = await askSecret({
          title: 'Alle Daten löschen?',
          text: 'Ohne Passwort lassen sich die Daten nicht entschlüsseln. Du kannst nur alles löschen und neu anfangen. Hast du ein Backup, kannst du es danach einspielen. Zum Bestätigen das Wort LÖSCHEN eintippen.',
          label: 'Bestätigung',
          okLabel: 'Endgültig löschen',
          plainText: true,
          danger: true
        });
        if (typed === null) return;
        if (typed.trim().toUpperCase() !== 'LÖSCHEN') { error.textContent = 'Nicht gelöscht: Das Wort stimmte nicht.'; return; }
        await eraseAppData();
        location.reload();
      });
    }
  });
}

/**
 * Fragt in einem Dialog nach PIN/Passwort. Liefert die Eingabe oder null bei Abbruch.
 * @param {object}  options
 * @param {string}  options.title
 * @param {string}  [options.text]
 * @param {string}  [options.label='PIN oder Passwort']
 * @param {boolean} [options.confirm=false]   zweimal eingeben lassen und Regeln prüfen
 * @param {string}  [options.okLabel='OK']
 * @param {boolean} [options.plainText=false] Eingabe sichtbar (für Bestätigungswörter)
 * @param {boolean} [options.danger=false]
 */
export function askSecret({ title, text = '', label = 'Passwort', confirm = false, okLabel = 'OK', plainText = false, danger = false }) {
  return new Promise(resolve => {
    const dialog = el('dialog', 'dialog');
    dialog.id = 'cpSecretDialog';
    const form = el('form', 'stack');
    form.noValidate = true;
    form.append(el('h2', null, title));
    if (text) form.append(el('p', null, text));

    const first = secretInput('cpSecretInput', label, confirm ? 'new-password' : 'current-password');
    if (plainText) { first.input.type = 'text'; first.input.autocomplete = 'off'; }
    form.append(first.wrap);

    let second = null;
    if (confirm) {
      second = secretInput('cpSecretRepeat', 'Wiederholen', 'new-password');
      form.append(second.wrap);
    }
    const hint = el('p', 'muted');
    const error = el('p', 'cp-lock__error');
    error.id = 'cpSecretError';
    error.setAttribute('role', 'alert');
    form.append(hint, error);

    const actions = el('div', 'dialog__actions');
    const cancel = el('button', 'btn btn--ghost', 'Abbrechen');
    cancel.type = 'button';
    cancel.id = 'cpSecretCancel';
    const ok = el('button', danger ? 'btn btn--danger' : 'btn', okLabel);
    ok.type = 'submit';
    ok.id = 'cpSecretOk';
    actions.append(cancel, ok);
    form.append(actions);
    dialog.append(form);
    document.body.append(dialog);

    const finish = value => { dialog.close(); dialog.remove(); resolve(value); };

    if (confirm) {
      first.input.addEventListener('input', () => {
        hint.textContent = first.input.value ? checkSecret(first.input.value).message : '';
      });
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = first.input.value;
      if (!value) return;
      if (confirm) {
        const check = checkSecret(value);
        if (!check.ok) { error.textContent = check.message; return; }
        if (value !== second.input.value) { error.textContent = 'Die beiden Eingaben sind nicht gleich.'; return; }
      }
      finish(value);
    });
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.showModal();
    first.input.focus();
  });
}
