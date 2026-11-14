/* ============================================================
   backup.js – Export, Import und Backup-Erinnerung.

     const backup = createBackup({ store });
     await backup.download();                    // Export als Datei
     const check = await backup.inspect(text);   // Datei prüfen
     await backup.importText(text);              // einspielen
     backup.remindIfDue();                       // Hinweis nach 30 Tagen

   Format der Datei:
     { app, format: 1, schemaVersion, exported, codec: "json", data: { name: wert } }

   Geheime Einträge (storage.secretNames) stehen nie in der Datei.
   Verschlüsselte Backups: einen Codec aus crypto.js mitgeben,
     backup.download({ codec: backupCodec(passwort) })
     backup.importText(text, { codec: backupCodec(passwort) })
   Dann steht in der Datei codec: "pbkdf2-aes-gcm" und `data` ist
   verschlüsselt. Unverschlüsselte (alte) Backups bleiben lesbar.
   ============================================================ */
import { showNotice } from './notice.js';

const FORMAT = 1;
const DAY = 24 * 60 * 60 * 1000;

export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code; // invalid | wrong-app | newer | codec | password | format
  }
}

/**
 * Adapter für alte Backup-Dateien, deren Keys alle mit einem Prefix beginnen
 * (NutriCoach: "nc_", Meine Finanzen: "fin_").
 * Aus "nc_plan" wird der Eintrag "plan".
 *
 * @param {object}   options
 * @param {string}   options.prefix         z. B. 'nc_'
 * @param {number}   [options.version=1]    Wert des Feldes "version" in der alten Datei
 * @param {number}   [options.schemaVersion=1]  Datenversion, der das alte Format entspricht
 * @param {string[]} [options.ignore]       alte Keys, die NICHT übernommen werden (z. B. 'fin_pin')
 */
export function legacyPrefixAdapter({ prefix, version = 1, schemaVersion = 1, ignore = [] }) {
  return function adapt(file) {
    if (!file || typeof file !== 'object' || 'app' in file) return null;
    if (file.version !== version) return null;
    const keys = Object.keys(file).filter(key => key.startsWith(prefix));
    if (!keys.length) return null;
    const data = {};
    for (const key of keys) {
      if (ignore.includes(key)) continue;
      if (file[key] === null || file[key] === undefined) continue;
      data[key.slice(prefix.length)] = file[key];
    }
    return { schemaVersion, exported: file.exported || null, data, source: `altes Format (${prefix}…)` };
  };
}

/**
 * @param {object}   options
 * @param {object}   options.store        von openStore()
 * @param {Array}    [options.adapters]   Funktionen für alte Dateiformate
 * @param {object}   [options.codec]      Standard-Codec für verschlüsselte Backups (pro Aufruf überschreibbar)
 */
export function createBackup({ store, adapters = [], codec: defaultCodec = null }) {
  const config = (self.APP_CONFIG && self.APP_CONFIG.backup) || {};
  const remindAfterDays = config.remindAfterDays ?? 30;
  const snoozeDays = config.snoozeDays ?? 7;

  /** Baut den Inhalt der Backup-Datei. */
  async function exportText({ codec = defaultCodec } = {}) {
    const data = await store.snapshot();
    const file = {
      app: store.id,
      format: FORMAT,
      schemaVersion: store.getMeta().schemaVersion,
      exported: new Date().toISOString(),
      codec: codec ? codec.name : 'json',
      data: codec ? await codec.encode(data) : data
    };
    const date = file.exported.slice(0, 10);
    return { filename: `${store.id}-backup-${date}.json`, text: JSON.stringify(file, null, 2) };
  }

  /** Exportiert als Datei: auf dem Handy über "Teilen", sonst als Download. */
  async function download(options = {}) {
    const { filename, text } = await exportText(options);
    let done = false;
    try {
      const file = new File([text], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        done = true;
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return { filename, cancelled: true };
      // Teilen nicht möglich: normaler Download
    }
    if (!done) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    await store.setMeta({ lastBackupAt: new Date().toISOString(), backupSnoozeUntil: null });
    return { filename, cancelled: false };
  }

  /**
   * Prüft eine Backup-Datei, ohne etwas zu ändern.
   * Wirft BackupError, wenn sie nicht passt.
   * @returns {Promise<{schemaVersion:number, exported:string|null, data:object, source:string, entries:number, needsMigration:boolean}>}
   */
  async function inspect(text, { codec = defaultCodec } = {}) {
    let file;
    try { file = JSON.parse(text); }
    catch { throw new BackupError('invalid', 'Das ist keine gültige Backup-Datei (kein JSON).'); }
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new BackupError('invalid', 'Das ist keine gültige Backup-Datei.');
    }

    let result = null;
    if ('app' in file) {
      if (file.app !== store.id) {
        throw new BackupError('wrong-app', `Diese Datei gehört zu einer anderen App ("${file.app}").`);
      }
      if (file.format !== FORMAT) {
        throw new BackupError('format', 'Unbekanntes Backup-Format. Bitte die App aktualisieren.');
      }
      let data = file.data;
      const usedCodec = file.codec || 'json';
      if (usedCodec !== 'json') {
        if (!codec || codec.name !== usedCodec) {
          // Die App fragt daraufhin nach dem Backup-Passwort und ruft erneut mit Codec auf.
          throw new BackupError('codec', 'Dieses Backup ist verschlüsselt. Bitte das Backup-Passwort eingeben.');
        }
        try {
          data = await codec.decode(data);
        } catch (error) {
          throw new BackupError('password', (error && error.message) || 'Das Backup-Passwort stimmt nicht.');
        }
      }
      result = { schemaVersion: file.schemaVersion, exported: file.exported || null, data, source: 'Backup dieser App' };
    } else {
      for (const adapt of adapters) {
        result = adapt(file);
        if (result) break;
      }
      if (!result) throw new BackupError('invalid', 'Die Datei wurde nicht als Backup dieser App erkannt.');
    }

    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
      throw new BackupError('invalid', 'Die Backup-Datei enthält keine Daten.');
    }
    if (!Number.isInteger(result.schemaVersion) || result.schemaVersion < 1) {
      throw new BackupError('invalid', 'In der Backup-Datei fehlt die Datenversion.');
    }
    if (result.schemaVersion > store.schemaVersion) {
      throw new BackupError('newer', 'Das Backup stammt aus einer neueren App-Version. Bitte erst die App aktualisieren.');
    }
    return {
      ...result,
      entries: Object.keys(result.data).length,
      needsMigration: result.schemaVersion < store.schemaVersion
    };
  }

  /**
   * Spielt ein Backup ein. Der aktuelle Stand wird vorher als
   * Wiederherstellungspunkt gesichert (store.undoRestore() macht es rückgängig).
   */
  async function importText(text, options = {}) {
    const checked = await inspect(text, options);
    await store.restore(checked.data, { fromVersion: checked.schemaVersion });
    return checked;
  }

  /** Ist eine Erinnerung fällig? */
  function isReminderDue(now = Date.now()) {
    const meta = store.getMeta();
    if (!meta.lastChangeAt) return false;                         // noch keine Daten
    if (meta.backupSnoozeUntil && now < Date.parse(meta.backupSnoozeUntil)) return false;
    const reference = meta.lastBackupAt || meta.createdAt || meta.lastChangeAt;
    if (now - Date.parse(reference) < remindAfterDays * DAY) return false;
    // Nur erinnern, wenn sich seit dem letzten Backup etwas geändert hat
    return !meta.lastBackupAt || Date.parse(meta.lastChangeAt) > Date.parse(meta.lastBackupAt);
  }

  async function snooze(days = snoozeDays) {
    await store.setMeta({ backupSnoozeUntil: new Date(Date.now() + days * DAY).toISOString() });
  }

  /** Zeigt den Hinweis, wenn er fällig ist. Gibt true zurück, wenn angezeigt. */
  function remindIfDue({ onBackupRequested = null } = {}) {
    if (!isReminderDue()) return false;
    const last = store.getMeta().lastBackupAt;
    showNotice({
      id: 'backup',
      text: last
        ? `Dein letztes Backup ist über ${remindAfterDays} Tage alt.`
        : 'Du hast noch kein Backup deiner Daten.',
      actions: [
        { label: 'Jetzt sichern', primary: true, onClick: async notice => {
          // Apps mit Verschlüsselung geben onBackupRequested mit und fragen dort nach dem Passwort.
          const result = onBackupRequested ? await onBackupRequested() : await download();
          if (result && !result.cancelled) notice.close();
        } },
        { label: 'Später', onClick: async notice => { await snooze(); notice.close(); } }
      ]
    });
    return true;
  }

  return { exportText, download, inspect, importText, isReminderDue, snooze, remindIfDue };
}
