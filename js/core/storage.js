/* ============================================================
   storage.js – Speicher mit Version, Migration und Sicherung.

   Grundregeln:
   - Jeder Key beginnt mit "<id>." – andere Apps auf derselben
     Origin werden nie angefasst. Es gibt kein clear().
   - Vor jeder Migration und jedem Überschreiben entsteht eine
     Sicherungskopie.
   - Defekte Daten werden beiseitegelegt, nie überschrieben.
   - Alle Funktionen sind asynchron (await), damit später
     Verschlüsselung (crypto.js) ohne Umbau dazukommen kann.

   Kurz:
     const store = await openStore({ migrations: { 2: async db => { … } } });
     const notes = await store.get('notes', []);
     await store.set('notes', notes);
   ============================================================ */

/** Fehler mit maschinenlesbarem Code: quota | newer | locked | blocked | name | write | migration */
export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Standard-Codec: speichert lesbares JSON. crypto.js liefert später einen
    Codec mit gleicher Form ({ name, encode, decode }), der verschlüsselt. */
export const jsonCodec = {
  name: 'json',
  async encode(value) { return value; },
  async decode(stored) { return stored; }
};

/** Backend für localStorage. Gleiche Form ließe sich später für IndexedDB bauen. */
export function localStorageBackend(storage = globalThis.localStorage) {
  return {
    async get(key) { return storage.getItem(key); },
    async set(key, text) { storage.setItem(key, text); },
    async remove(key) { storage.removeItem(key); },
    async keys() {
      const list = [];
      for (let i = 0; i < storage.length; i++) list.push(storage.key(i));
      return list;
    }
  };
}

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Öffnet den Speicher der App. Fehlende Angaben kommen aus app.config.js.
 *
 * @param {object} [options]
 * @param {string} [options.id]                   Prefix, Vorgabe APP_CONFIG.id
 * @param {number} [options.schemaVersion]        aktuelle Datenversion
 * @param {object} [options.migrations]           { 2: async db => {…}, 3: … }
 * @param {object} [options.legacyKeys]           { name: 'alterKey' } für Bestands-Apps
 * @param {number} [options.legacySchemaVersion]  Version alter Daten ohne Versionsangabe
 * @param {string[]} [options.rawNames]           Einträge, die als reiner Text liegen (kein JSON)
 * @param {string[]} [options.secretNames]        Einträge, die nie ins Backup gehen
 * @param {object} [options.codec]                Vorgabe jsonCodec
 * @param {object} [options.backend]              Vorgabe localStorage
 */
export async function openStore(options = {}) {
  const cfg = (self.APP_CONFIG && self.APP_CONFIG.storage) || {};
  const id = options.id || (self.APP_CONFIG && self.APP_CONFIG.id);
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    throw new StorageError('name', 'Ungültige App-id. Erlaubt: a–z, 0–9, Bindestrich.');
  }

  const schemaVersion = options.schemaVersion ?? cfg.schemaVersion ?? 1;
  const migrations = options.migrations || {};
  const legacyKeys = options.legacyKeys || cfg.legacyKeys || {};
  const legacySchemaVersion = options.legacySchemaVersion ?? cfg.legacySchemaVersion ?? 1;
  const rawNames = new Set(options.rawNames || cfg.rawNames || []);
  const secretNames = new Set(options.secretNames || cfg.secretNames || []);
  const codec = options.codec || jsonCodec;
  const backend = options.backend || localStorageBackend();

  const prefix = id + '.';
  const internal = prefix + '_';              // reserviert: _meta, _backup.*, _corrupt.*, _restorepoint
  const META = internal + 'meta';
  const RESTOREPOINT = internal + 'restorepoint';

  const problems = [];                        // was beim Öffnen/Lesen schiefging
  const blocked = new Set();                  // Einträge, die nicht überschrieben werden dürfen
  let readOnly = false;
  let status = 'ok';
  let meta = null;

  // ── Hilfen ────────────────────────────────────────────────
  const keyFor = name => legacyKeys[name] || prefix + name;

  const checkName = name => {
    if (typeof name !== 'string' || !name || name.startsWith('_') || name.includes('.')) {
      throw new StorageError('name', `Ungültiger Name "${name}". Ohne Punkt, nicht mit "_" beginnen.`);
    }
  };

  async function names() {
    const all = await backend.keys();
    const found = new Set();
    for (const key of all) {
      if (key.startsWith(prefix) && !key.startsWith(internal)) found.add(key.slice(prefix.length));
    }
    for (const [name, key] of Object.entries(legacyKeys)) {
      if (all.includes(key)) found.add(name);
    }
    return [...found].sort();
  }

  async function writeText(key, text) {
    try {
      await backend.set(key, text);
    } catch (error) {
      const full = error && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014);
      throw new StorageError(full ? 'quota' : 'write',
        full ? 'Der Speicher ist voll. Bitte ein Backup exportieren und alte Daten löschen.'
             : 'Speichern fehlgeschlagen: ' + (error && error.message));
    }
  }

  async function saveMeta() {
    try { await writeText(META, JSON.stringify(meta)); } catch { /* Meta ist nicht kritisch */ }
  }

  async function quarantine(name, raw, reason) {
    const key = `${internal}corrupt.${name}.${Date.now()}`;
    try {
      await writeText(key, raw);
      problems.push({ type: 'corrupt', name, key, reason });
    } catch {
      // Keine Kopie möglich: Original schützen, bis der Nutzer entschieden hat.
      blocked.add(name);
      problems.push({ type: 'corrupt', name, key: null, reason });
    }
  }

  async function rawGet(name, fallback) {
    const raw = await backend.get(keyFor(name));
    if (raw === null || raw === undefined) return clone(fallback);
    if (rawNames.has(name)) return raw;
    try {
      return await codec.decode(JSON.parse(raw));
    } catch (error) {
      await quarantine(name, raw, String(error && error.message));
      return clone(fallback);
    }
  }

  async function rawSet(name, value) {
    const text = rawNames.has(name) ? String(value) : JSON.stringify(await codec.encode(value));
    await writeText(keyFor(name), text);
  }

  async function rawRemove(name) {
    await backend.remove(keyFor(name));
  }

  /** Rohtext aller Einträge, für Sicherungskopien. */
  async function rawDump() {
    const dump = {};
    for (const name of await names()) dump[name] = await backend.get(keyFor(name));
    return dump;
  }

  async function rawLoad(dump) {
    for (const name of await names()) await rawRemove(name);
    for (const [name, text] of Object.entries(dump)) {
      if (text !== null && text !== undefined) await writeText(keyFor(name), text);
    }
  }

  async function runMigrations(from, to) {
    const db = { get: rawGet, set: rawSet, remove: rawRemove, names };
    for (let version = from + 1; version <= to; version++) {
      const step = migrations[version];
      if (step) await step(db);
    }
  }

  // ── Öffnen ────────────────────────────────────────────────
  const metaText = await backend.get(META);
  if (metaText) {
    try { meta = JSON.parse(metaText); } catch { meta = null; }
  }
  const existing = await names();

  if (!meta) {
    if (existing.length) {
      // Alte Daten ohne Versionsangabe (Bestands-App)
      meta = { schemaVersion: legacySchemaVersion, codec: codec.name, createdAt: null };
      status = 'legacy';
    } else {
      meta = { schemaVersion, codec: codec.name, createdAt: new Date().toISOString() };
      status = 'fresh';
      await saveMeta();
    }
  }

  if (meta.codec && meta.codec !== codec.name) {
    // z. B. Daten sind verschlüsselt, die App wurde ohne Schlüssel geöffnet
    status = 'locked';
    readOnly = true;
  } else if (meta.schemaVersion > schemaVersion) {
    // Daten stammen aus einer neueren App-Version: nichts schreiben
    status = 'newer';
    readOnly = true;
    problems.push({ type: 'newer', stored: meta.schemaVersion, app: schemaVersion });
  } else if (meta.schemaVersion < schemaVersion) {
    const from = meta.schemaVersion;
    const dump = await rawDump();
    try {
      // 1. Sicherungskopie, alte Kopien wegräumen
      for (const key of await backend.keys()) {
        if (key.startsWith(internal + 'backup.')) await backend.remove(key);
      }
      await writeText(`${internal}backup.v${from}`, JSON.stringify({ savedAt: new Date().toISOString(), schemaVersion: from, raw: dump }));
      // 2. Migrieren
      await runMigrations(from, schemaVersion);
      meta.schemaVersion = schemaVersion;
      meta.codec = codec.name;
      meta.migratedAt = new Date().toISOString();
      await saveMeta();
      status = 'migrated';
    } catch (error) {
      // Zurück auf den Stand vor der Migration
      try { await rawLoad(dump); } catch { /* bestmöglich */ }
      status = 'migration-failed';
      readOnly = true;
      problems.push({ type: 'migration', from, to: schemaVersion, reason: String(error && error.message) });
    }
  } else if (status === 'legacy') {
    await saveMeta();
  }

  // Browser bitten, die Daten nicht von sich aus zu löschen
  let persisted = null;
  if (globalThis.navigator && navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(ok => { persisted = ok; }).catch(() => {});
  }

  const assertWritable = name => {
    if (status === 'locked') throw new StorageError('locked', 'Der Speicher ist gesperrt.');
    if (status === 'newer') throw new StorageError('newer', 'Die Daten stammen aus einer neueren App-Version. Bitte die App aktualisieren.');
    if (readOnly) throw new StorageError('migration', 'Die Daten konnten nicht umgestellt werden. Es wurde nichts verändert.');
    if (name && blocked.has(name)) throw new StorageError('blocked', `"${name}" ist beschädigt und wird nicht überschrieben.`);
  };

  // ── Öffentliche Schnittstelle ─────────────────────────────
  return {
    id,
    schemaVersion,
    /** ok | fresh | legacy | migrated | newer | locked | migration-failed */
    get status() { return status; },
    get readOnly() { return readOnly; },
    get persisted() { return persisted; },
    /** Liste der Probleme seit dem Öffnen (defekte Einträge usw.) */
    problems,

    /** Liest einen Eintrag. Fehlt er oder ist er defekt, kommt `fallback` zurück. */
    async get(name, fallback = null) {
      checkName(name);
      return rawGet(name, fallback);
    },

    /** Speichert einen Eintrag. Wirft StorageError (z. B. code "quota"). */
    async set(name, value) {
      checkName(name);
      assertWritable(name);
      await rawSet(name, value);
      meta.lastChangeAt = new Date().toISOString();
      await saveMeta();
    },

    async remove(name) {
      checkName(name);
      assertWritable(name);
      await rawRemove(name);
      meta.lastChangeAt = new Date().toISOString();
      await saveMeta();
    },

    names,

    /** Alle Einträge als Objekt { name: wert }. Geheime Einträge fehlen, außer mit includeSecrets. */
    async snapshot({ includeSecrets = false } = {}) {
      const data = {};
      for (const name of await names()) {
        if (!includeSecrets && secretNames.has(name)) continue;
        data[name] = await rawGet(name, null);
      }
      return data;
    },

    /**
     * Ersetzt alle Einträge durch `data` (z. B. aus einem Backup).
     * Vorher entsteht ein Wiederherstellungspunkt. Geheime Einträge bleiben stehen.
     * Ist `fromVersion` älter als die App, laufen die Migrationen.
     */
    async restore(data, { fromVersion = schemaVersion } = {}) {
      assertWritable();
      if (fromVersion > schemaVersion) {
        throw new StorageError('newer', 'Das Backup stammt aus einer neueren App-Version.');
      }
      const dump = await rawDump();
      await writeText(RESTOREPOINT, JSON.stringify({ savedAt: new Date().toISOString(), schemaVersion: meta.schemaVersion, raw: dump }));
      try {
        for (const name of await names()) {
          if (!secretNames.has(name)) await rawRemove(name);
        }
        for (const [name, value] of Object.entries(data)) {
          checkName(name);
          if (secretNames.has(name)) continue;
          await rawSet(name, value);
        }
        if (fromVersion < schemaVersion) await runMigrations(fromVersion, schemaVersion);
        meta.schemaVersion = schemaVersion;
        meta.lastChangeAt = new Date().toISOString();
        await saveMeta();
      } catch (error) {
        await rawLoad(dump);
        throw error instanceof StorageError ? error
          : new StorageError('write', 'Wiederherstellen fehlgeschlagen, alter Stand bleibt: ' + (error && error.message));
      }
    },

    /** Gibt es einen Wiederherstellungspunkt? Liefert { savedAt } oder null. */
    async restorePointInfo() {
      const text = await backend.get(RESTOREPOINT);
      if (!text) return null;
      try { const point = JSON.parse(text); return { savedAt: point.savedAt, schemaVersion: point.schemaVersion }; }
      catch { return null; }
    },

    /** Macht das letzte restore() oder reset() rückgängig. */
    async undoRestore() {
      const text = await backend.get(RESTOREPOINT);
      if (!text) throw new StorageError('write', 'Kein Wiederherstellungspunkt vorhanden.');
      const point = JSON.parse(text);
      await rawLoad(point.raw);
      meta.schemaVersion = point.schemaVersion;
      meta.lastChangeAt = new Date().toISOString();
      await saveMeta();
      await backend.remove(RESTOREPOINT);
    },

    /** Löscht die Daten DIESER App (nur eigene Keys). Vorher Wiederherstellungspunkt. */
    async reset() {
      const dump = await rawDump();
      await writeText(RESTOREPOINT, JSON.stringify({ savedAt: new Date().toISOString(), schemaVersion: meta.schemaVersion, raw: dump }));
      for (const name of await names()) await rawRemove(name);
      meta = { schemaVersion, codec: codec.name, createdAt: new Date().toISOString() };
      await saveMeta();
      blocked.clear();
      if (status !== 'locked') { status = 'fresh'; readOnly = false; }
    },

    /** Verwaltungsdaten (Kopie): schemaVersion, lastChangeAt, lastBackupAt, … */
    getMeta() { return clone(meta); },

    /** Ergänzt Verwaltungsdaten, z. B. { lastBackupAt: … }. */
    async setMeta(patch) {
      meta = { ...meta, ...patch, schemaVersion: meta.schemaVersion, codec: meta.codec };
      await saveMeta();
    },

    /** Rohtext eines beiseitegelegten, defekten Eintrags (für Download). */
    async readCorrupt(key) {
      return key && key.startsWith(internal + 'corrupt.') ? backend.get(key) : null;
    }
  };
}
