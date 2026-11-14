/* ============================================================
   crypto.js – optionale Verschlüsselung für sensible Daten.
   Nur aktiv, wenn in app.config.js storage.encryption: 'pin' steht.

   So funktioniert es:
   - Ein zufälliger Datenschlüssel (AES-GCM, 256 Bit) verschlüsselt
     alle Einträge des Speichers.
   - Dieser Datenschlüssel liegt selbst verschlüsselt im Speicher
     ("<id>._crypto"), verpackt mit einem Schlüssel, der per
     PBKDF2 aus PIN oder Passwort abgeleitet wird.
   - PIN/Passwort wird NIRGENDS gespeichert, auch kein Hash davon.
     Ob die Eingabe stimmt, zeigt sich daran, ob das Auspacken gelingt.
   - PIN ändern = nur den Datenschlüssel neu verpacken. Die Daten
     selbst werden nicht angefasst.

   Schützt vor: Auslesen des Browser-Speichers, anderen Apps auf
   derselben Adresse (solange gesperrt), Mitlesen von Backups.
   Schützt NICHT vor: kurzem PIN (durchprobierbar), Schadcode bei
   entsperrter App, entsperrtem Handy in fremder Hand, Löschen,
   vergessenem PIN (dann sind die Daten weg).

   Klartext bleiben: die Namen der Einträge, Verwaltungsdaten
   (Zeitstempel, Datenversion) und Einträge aus storage.rawNames.
   ============================================================ */
import { localStorageBackend } from './storage.js';

const KDF_ITERATIONS = 600000;     // PBKDF2-SHA256, Empfehlung OWASP
const SALT_BYTES = 16;
const IV_BYTES = 12;
const subtle = globalThis.crypto && globalThis.crypto.subtle;

export class CryptoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CryptoError';
    this.code = code; // weak | wrong | unsupported | state | damaged
  }
}

// ── Hilfen ──────────────────────────────────────────────────
const toBase64 = bytes => {
  let text = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
const randomBytes = count => crypto.getRandomValues(new Uint8Array(count));
const encodeText = text => new TextEncoder().encode(text);

function assertSupported() {
  if (!subtle) {
    throw new CryptoError('unsupported', 'Verschlüsselung ist hier nicht verfügbar. Die App muss über https laufen.');
  }
}

/**
 * Prüft PIN oder Passwort gegen die Mindestregeln.
 * Nur Ziffern = PIN: mindestens 6 Stellen, keine einfachen Muster.
 * Sonst = Passwort: mindestens 8 Zeichen.
 * @returns {{ok:boolean, kind:'pin'|'password', message:string}}
 */
export function checkSecret(secret) {
  const value = String(secret ?? '');
  if (/^\d+$/.test(value)) {
    if (value.length < 6) return { ok: false, kind: 'pin', message: 'Ein PIN braucht mindestens 6 Ziffern.' };
    const digits = [...value].map(Number);
    const same = digits.every(digit => digit === digits[0]);
    const up = digits.every((digit, i) => i === 0 || digit === (digits[i - 1] + 1) % 10);
    const down = digits.every((digit, i) => i === 0 || digit === (digits[i - 1] + 9) % 10);
    if (same || up || down) return { ok: false, kind: 'pin', message: 'Dieser PIN ist zu leicht zu erraten (gleiche oder aufeinanderfolgende Ziffern).' };
    return { ok: true, kind: 'pin', message: 'PIN ist zulässig. Ein Passwort schützt deutlich besser.' };
  }
  if (value.length < 8) return { ok: false, kind: 'password', message: 'Ein Passwort braucht mindestens 8 Zeichen.' };
  return { ok: true, kind: 'password', message: 'Passwort ist zulässig.' };
}

async function deriveKey(secret, salt, iterations, usages) {
  const material = await subtle.importKey('raw', encodeText(String(secret).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

async function encryptJson(key, value) {
  const iv = randomBytes(IV_BYTES);
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeText(JSON.stringify(value)));
  return { iv: toBase64(iv), ct: toBase64(cipher) };
}

async function decryptJson(key, stored) {
  if (!stored || typeof stored.iv !== 'string' || typeof stored.ct !== 'string') {
    throw new CryptoError('damaged', 'Der Eintrag ist nicht verschlüsselt oder beschädigt.');
  }
  let plain;
  try {
    plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(stored.iv) }, key, fromBase64(stored.ct));
  } catch {
    throw new CryptoError('wrong', 'Entschlüsseln fehlgeschlagen.');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Codec für storage.js: verschlüsselt jeden Eintrag einzeln. */
function storageCodec(dataKey) {
  return {
    name: 'aes-gcm',
    encode: value => encryptJson(dataKey, value),
    decode: stored => decryptJson(dataKey, stored)
  };
}

// ── Tresor: verwaltet den Datenschlüssel ────────────────────
/**
 * Öffnet den Tresor der App. Liefert ein Objekt mit dem Zustand
 * "new" (noch kein PIN vergeben) oder "locked".
 *
 *   const vault = await openVault();
 *   const codec = vault.state === 'new' ? await vault.setup(pin) : await vault.unlock(pin);
 *   const store = await openStore({ codec });
 *
 * @param {object} [options]
 * @param {string} [options.id]          Vorgabe APP_CONFIG.id
 * @param {number} [options.iterations]  Vorgabe 600000 (nur für Tests ändern)
 * @param {object} [options.backend]     Vorgabe localStorage
 */
export async function openVault(options = {}) {
  assertSupported();
  const id = options.id || (self.APP_CONFIG && self.APP_CONFIG.id);
  const iterations = options.iterations || KDF_ITERATIONS;
  const backend = options.backend || localStorageBackend();
  const KEY = `${id}._crypto`;

  let record = null;
  const text = await backend.get(KEY);
  if (text) {
    try { record = JSON.parse(text); }
    catch { throw new CryptoError('damaged', 'Die Schlüsseldaten sind beschädigt. Ohne sie lassen sich die Daten nicht entschlüsseln.'); }
  }

  let state = record ? 'locked' : 'new';
  let dataKey = null;

  async function wrap(secret) {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const kek = await deriveKey(secret, salt, iterations, ['wrapKey']);
    const wrapped = await subtle.wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv });
    record = {
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
      wrapped: { iv: toBase64(iv), ct: toBase64(wrapped) }
    };
    await backend.set(KEY, JSON.stringify(record));
  }

  async function unwrap(secret, extractable) {
    const kek = await deriveKey(secret, fromBase64(record.kdf.salt), record.kdf.iterations, ['unwrapKey']);
    try {
      return await subtle.unwrapKey('raw', fromBase64(record.wrapped.ct), kek,
        { name: 'AES-GCM', iv: fromBase64(record.wrapped.iv) },
        { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
    } catch {
      throw new CryptoError('wrong', 'Das Passwort stimmt nicht.');
    }
  }

  return {
    /** new | locked | open */
    get state() { return state; },

    /** Ersteinrichtung: vergibt PIN/Passwort und erzeugt den Datenschlüssel. */
    async setup(secret) {
      if (state !== 'new') throw new CryptoError('state', 'Es ist bereits ein PIN vergeben.');
      const check = checkSecret(secret);
      if (!check.ok) throw new CryptoError('weak', check.message);
      // Zum Verpacken muss der Schlüssel kurz exportierbar sein. Danach wird er
      // als NICHT exportierbar neu geladen: Kein Script kann ihn dann auslesen.
      dataKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      await wrap(secret);
      dataKey = await unwrap(secret, false);
      state = 'open';
      return storageCodec(dataKey);
    },

    /** Entsperren. Wirft CryptoError mit code "wrong" bei falscher Eingabe. */
    async unlock(secret) {
      if (state === 'new') throw new CryptoError('state', 'Es ist noch kein PIN vergeben.');
      dataKey = await unwrap(secret, false);
      state = 'open';
      return storageCodec(dataKey);
    },

    /** PIN/Passwort ändern. Die Daten bleiben unverändert verschlüsselt. */
    async changeSecret(oldSecret, newSecret) {
      if (state === 'new') throw new CryptoError('state', 'Es ist noch kein PIN vergeben.');
      const check = checkSecret(newSecret);
      if (!check.ok) throw new CryptoError('weak', check.message);
      dataKey = await unwrap(oldSecret, true);   // prüft zugleich die alte Eingabe
      await wrap(newSecret);
      dataKey = await unwrap(newSecret, false);
      state = 'open';
    },

    /** Schlüssel aus dem Arbeitsspeicher entfernen. */
    lock() {
      dataKey = null;
      if (state === 'open') state = 'locked';
    }
  };
}

// ── Backup-Verschlüsselung ──────────────────────────────────
/**
 * Codec für backup.js: verschlüsselt die Backup-Datei mit einem
 * eigenen Passwort. Unabhängig vom Tresor, damit sich das Backup
 * auch auf einem anderen Gerät einspielen lässt.
 *
 *   createBackup({ store, codec: backupCodec(passwort) })
 */
export function backupCodec(password, { iterations = KDF_ITERATIONS } = {}) {
  assertSupported();
  return {
    name: 'pbkdf2-aes-gcm',
    async encode(value) {
      const check = checkSecret(password);
      if (!check.ok) throw new CryptoError('weak', check.message);
      const salt = randomBytes(SALT_BYTES);
      const key = await deriveKey(password, salt, iterations, ['encrypt']);
      const sealed = await encryptJson(key, value);
      return { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) }, ...sealed };
    },
    async decode(stored) {
      if (!stored || !stored.kdf || typeof stored.kdf.salt !== 'string') {
        throw new CryptoError('damaged', 'Die Backup-Datei ist beschädigt.');
      }
      const key = await deriveKey(password, fromBase64(stored.kdf.salt), stored.kdf.iterations, ['decrypt']);
      try {
        return await decryptJson(key, stored);
      } catch (error) {
        if (error instanceof CryptoError && error.code === 'wrong') {
          throw new CryptoError('wrong', 'Das Backup-Passwort stimmt nicht.');
        }
        throw error;
      }
    }
  };
}

// ── Automatisches Sperren ───────────────────────────────────
/**
 * Sperrt nach einer Zeit ohne Bedienung. "Sperren" heißt: onLock()
 * aufrufen. Üblich ist dort location.reload(), dann ist der
 * Schlüssel sicher aus dem Arbeitsspeicher.
 * @returns {function} zum Abschalten
 */
export function startAutoLock({ minutes, onLock }) {
  if (!minutes || minutes <= 0) return () => {};
  const limit = minutes * 60 * 1000;
  let last = Date.now();
  let done = false;
  const touch = () => { last = Date.now(); };
  const check = () => {
    if (!done && Date.now() - last >= limit) { done = true; stop(); onLock(); }
  };
  const events = ['pointerdown', 'keydown', 'scroll'];
  events.forEach(name => window.addEventListener(name, touch, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', check);   // Rückkehr aus dem Hintergrund
  const timer = setInterval(check, 15000);
  function stop() {
    clearInterval(timer);
    events.forEach(name => window.removeEventListener(name, touch, { capture: true }));
    document.removeEventListener('visibilitychange', check);
  }
  return stop;
}
