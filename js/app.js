/* ============================================================
   app.js – Beispiel-App "Hello ZimmermannKI".
   Zeigt, wie alle Module zusammenspielen. Für eine neue App
   ersetzt du diese Datei durch deine eigene Logik.
   ============================================================ */
import { openStore, StorageError } from './core/storage.js';
import { createBackup, BackupError } from './core/backup.js';
import { initUpdates, getVersion } from './core/update-banner.js';
import { initInstall, isStandalone } from './core/install.js';
import { toast } from './core/notice.js';

const config = self.APP_CONFIG;
const $ = id => document.getElementById(id);

// ── 1. Speicher öffnen ──────────────────────────────────────
// Beispiel-Migration: In Datenversion 1 waren Notizen einfache Texte.
// Ab Version 2 sind es Objekte mit id und Datum.
const store = await openStore({
  migrations: {
    2: async db => {
      const old = await db.get('notes', []);
      const upgraded = old.map((entry, index) =>
        typeof entry === 'string'
          ? { id: `m${index}`, text: entry, createdAt: null }
          : entry
      );
      await db.set('notes', upgraded);
    }
  }
});

const backup = createBackup({ store });

let profile = await store.get('profile', { name: '', starts: 0 });
let notes = await store.get('notes', []);

// ── 2. Speichern mit Fehlermeldung ──────────────────────────
async function save(name, value) {
  try {
    await store.set(name, value);
    return true;
  } catch (error) {
    toast(error instanceof StorageError ? error.message : 'Speichern fehlgeschlagen.', 6000);
    return false;
  }
}

// ── 3. Bestätigungsdialog ───────────────────────────────────
function confirmDialog({ title, text, yes = 'OK', danger = false }) {
  return new Promise(resolve => {
    const dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yes;
    $('confirmYes').className = danger ? 'btn btn--danger' : 'btn';
    const finish = answer => {
      $('confirmYes').removeEventListener('click', onYes);
      $('confirmNo').removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onNo);
      dialog.close();
      resolve(answer);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    $('confirmYes').addEventListener('click', onYes);
    $('confirmNo').addEventListener('click', onNo);
    dialog.addEventListener('cancel', onNo);
    dialog.showModal();
  });
}

// ── 4. Anzeige ──────────────────────────────────────────────
const formatDate = iso => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

function renderStart() {
  $('greeting').textContent = profile.name ? `Hallo ${profile.name}!` : 'Hallo!';
  $('startCount').textContent = `Du hast diese App ${profile.starts}-mal geöffnet.`;

  const list = $('noteList');
  list.replaceChildren();
  for (const note of notes) {
    const item = document.createElement('li');
    item.className = 'list__item';

    const text = document.createElement('span');
    text.className = 'list__text';
    text.textContent = note.text;           // textContent: kein HTML aus Nutzereingaben

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--small btn--ghost';
    remove.textContent = 'Löschen';
    remove.dataset.removeNote = note.id;

    item.append(text, remove);
    list.appendChild(item);
  }
  $('noteEmpty').hidden = notes.length > 0;
}

const STATUS_TEXT = {
  ok: 'in Ordnung',
  fresh: 'neu angelegt',
  legacy: 'alte Daten übernommen',
  migrated: 'auf neue Datenversion umgestellt',
  newer: 'Daten sind neuer als die App (nur lesen)',
  locked: 'gesperrt',
  'migration-failed': 'Umstellung fehlgeschlagen (nur lesen)'
};

async function renderSettings(updates) {
  const meta = store.getMeta();
  $('factVersion').textContent = getVersion();
  $('factSw').textContent = updates.supported ? 'aktiv' : 'nicht verfügbar';
  $('factInstalled').textContent = isStandalone() ? 'ja' : 'nein, läuft im Browser';
  $('factStatus').textContent = STATUS_TEXT[store.status] || store.status;
  $('factSchema').textContent = String(meta.schemaVersion);
  $('factPersist').textContent = store.persisted === true ? 'ja' : store.persisted === false ? 'nein (Browser entscheidet)' : 'unbekannt';
  $('factChanged').textContent = formatDate(meta.lastChangeAt);
  $('backupInfo').textContent = meta.lastBackupAt
    ? `Letztes Backup: ${formatDate(meta.lastBackupAt)}`
    : 'Noch kein Backup erstellt.';

  const point = await store.restorePointInfo();
  $('undoRow').hidden = !point;

  const problem = $('problemInfo');
  problem.hidden = store.problems.length === 0;
  if (store.problems.length) {
    problem.textContent = `Hinweis: ${store.problems.length} Problem(e) beim Lesen der Daten. Die Originale wurden gesichert und nicht überschrieben.`;
  }
}

function showView(name) {
  for (const view of document.querySelectorAll('[data-view]')) {
    view.hidden = view.dataset.view !== name;
  }
  for (const button of document.querySelectorAll('[data-nav]')) {
    if (button.dataset.nav === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

// ── 5. Start ────────────────────────────────────────────────
document.title = config.name;
$('appTitle').textContent = config.name;

profile.starts += 1;
if (!store.readOnly) await save('profile', profile);
$('nameInput').value = profile.name;
renderStart();

// Update-Banner. canUpdateNow: nicht mitten im Tippen neu laden.
const updates = await initUpdates({
  canUpdateNow: () => $('noteInput').value.trim() === ''
});

initInstall({ button: $('installBtn'), store });
backup.remindIfDue();
await renderSettings(updates);

// ── 6. Bedienung (alles über addEventListener, kein onclick im HTML) ──
document.querySelector('.app__nav').addEventListener('click', async event => {
  const button = event.target.closest('[data-nav]');
  if (!button) return;
  showView(button.dataset.nav);
  if (button.dataset.nav === 'settings') await renderSettings(updates);
});

$('nameInput').addEventListener('change', async event => {
  profile.name = event.target.value.trim();
  if (await save('profile', profile)) renderStart();
});

$('noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('noteInput').value.trim();
  if (!text) return;
  const next = [...notes, { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }];
  if (await save('notes', next)) {
    notes = next;
    $('noteInput').value = '';
    renderStart();
  }
});

$('noteList').addEventListener('click', async event => {
  const id = event.target.dataset.removeNote;
  if (!id) return;
  const next = notes.filter(note => note.id !== id);
  if (await save('notes', next)) {
    notes = next;
    renderStart();
  }
});

$('checkUpdateBtn').addEventListener('click', async () => {
  if (!updates.supported) { toast('Offline-Modus ist hier nicht verfügbar.'); return; }
  const found = await updates.checkNow();
  if (!found) toast('Du hast die aktuelle Version.');
});

$('exportBtn').addEventListener('click', async () => {
  const result = await backup.download();
  if (!result.cancelled) toast('Backup erstellt: ' + result.filename);
  await renderSettings(updates);
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const check = await backup.inspect(text);      // erst prüfen, noch nichts ändern
    const ok = await confirmDialog({
      title: 'Backup einspielen?',
      text: `${check.source} vom ${formatDate(check.exported)}, ${check.entries} Einträge. ` +
            'Deine aktuellen Daten werden ersetzt. Der jetzige Stand wird vorher gesichert und lässt sich zurückholen.',
      yes: 'Einspielen'
    });
    if (!ok) return;
    await backup.importText(text);
    location.reload();
  } catch (error) {
    const known = error instanceof BackupError || error instanceof StorageError;
    toast(known ? error.message : 'Import fehlgeschlagen.', 6000);
  }
});

$('undoBtn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Rückgängig machen?',
    text: 'Der Stand vor dem letzten Import oder Löschen wird wiederhergestellt.',
    yes: 'Zurückholen'
  });
  if (!ok) return;
  await store.undoRestore();
  location.reload();
});

$('resetBtn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Alle Daten löschen?',
    text: 'Gelöscht werden nur die Daten dieser App. Andere Apps bleiben unberührt.',
    yes: 'Löschen',
    danger: true
  });
  if (!ok) return;
  await store.reset();
  location.reload();
});
