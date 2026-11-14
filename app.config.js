/* ============================================================
   app.config.js – die EINZIGE Konfiguration dieser App.
   Klassisches Script (kein ES-Modul), weil auch der Service
   Worker diese Datei per importScripts() lädt.
   Keine Geheimnisse hier eintragen: Die Datei ist öffentlich.
   ============================================================ */
self.APP_CONFIG = {
  // Kurzname: nur a–z, 0–9 und Bindestrich. Wird zum Prefix für
  // Speicher-Keys ("hello.…") und Cache-Namen ("hello-…").
  // NIE mehr ändern, sobald Nutzer Daten haben.
  id: 'hello',

  name: 'Hello ZimmermannKI',
  shortName: 'Hello',

  // Nur für Bestands-Apps: der Wert, den "id" in manifest.webmanifest
  // haben MUSS, wenn er von der Regel abweicht (Regel: "/<Repo-Name>/",
  // auf eigener Subdomain "/"). Beispiel IronLog: '/IronLog/index.html'.
  // tools/stamp.mjs prüft das beim Veröffentlichen. Neue Apps: null lassen.
  manifestId: null,

  storage: {
    // Aktuelle Version des Datenformats. Erhöhen, wenn sich die
    // Struktur ändert, und in js/app.js eine Migration ergänzen.
    schemaVersion: 2,

    // Verschlüsselung: 'none' oder 'pin'.
    // 'pin' = Daten liegen verschlüsselt im Speicher, die App fragt beim
    // Start nach PIN (mind. 6 Ziffern) oder Passwort (mind. 8 Zeichen).
    // Für Finanz- oder Gesundheitsdaten. Vor dem ersten Start festlegen:
    // Ein späterer Wechsel stellt vorhandene Daten nicht um.
    encryption: 'none',

    // Nur mit encryption 'pin': nach so vielen Minuten ohne Bedienung sperren.
    autoLockMinutes: 5,

    // Nur für den Umzug alter Apps: bestehende localStorage-Keys
    // weiterverwenden. Beispiel IronLog: { state: 'ironlog4' }
    legacyKeys: {},

    // Datenversion, die alte Daten ohne Versionsangabe haben.
    legacySchemaVersion: 1,

    // Nur für Bestands-Apps: Einträge, die als reiner Text gespeichert
    // sind statt als JSON (z. B. ein alter API-Key).
    rawNames: [],

    // Diese Einträge landen NIE im Backup (z. B. 'apikey').
    secretNames: []
  },

  backup: {
    remindAfterDays: 30, // Hinweis, wenn das letzte Backup älter ist
    snoozeDays: 7        // "Später" = so viele Tage Ruhe
  },

  update: {
    checkEveryMinutes: 60 // Update-Prüfung bei lange geöffneter App
  },

  sw: {
    networkTimeoutMs: 3000 // danach antwortet der Cache
  }
};
