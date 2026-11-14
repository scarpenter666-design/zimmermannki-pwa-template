/* ============================================================
   notice.js – kleine Hinweisleisten am unteren Rand.
   Wird von update-banner.js, backup.js und install.js benutzt.
   Baut sein HTML selbst, in index.html ist nichts nötig.
   ============================================================ */

function host() {
  let element = document.getElementById('cp-notices');
  if (!element) {
    element = document.createElement('div');
    element.id = 'cp-notices';
    element.className = 'cp-notices';
    document.body.appendChild(element);
  }
  return element;
}

/**
 * Zeigt einen Hinweis. Gibt ein Objekt zum Ändern/Schließen zurück.
 * @param {object} options
 * @param {string} options.id       eindeutiger Name, ein zweiter Aufruf ersetzt den ersten
 * @param {string} options.text
 * @param {Array<{label:string, primary?:boolean, onClick:function}>} [options.actions]
 */
export function showNotice({ id, text, actions = [] }) {
  closeNotice(id);

  const box = document.createElement('div');
  box.className = 'cp-notice';
  box.dataset.noticeId = id;
  box.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.className = 'cp-notice__text';
  label.textContent = text;
  box.appendChild(label);

  const buttons = document.createElement('span');
  buttons.className = 'cp-notice__actions';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary ? 'btn btn--small' : 'btn btn--small btn--ghost';
    button.textContent = action.label;
    button.addEventListener('click', () => action.onClick(handle));
    buttons.appendChild(button);
  }
  box.appendChild(buttons);
  host().appendChild(box);

  const handle = {
    setText: value => { label.textContent = value; },
    close: () => box.remove()
  };
  return handle;
}

export function closeNotice(id) {
  const old = document.querySelector(`.cp-notice[data-notice-id="${id}"]`);
  if (old) old.remove();
}

/** Kurze Meldung, verschwindet von selbst. */
export function toast(text, ms = 3000) {
  const handle = showNotice({ id: 'toast', text });
  setTimeout(handle.close, ms);
}
