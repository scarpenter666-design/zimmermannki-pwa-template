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

  storage: {
    // Aktuelle Version des Datenformats. Erhöhen, wenn sich die
    // Struktur ändert, und in js/app.js eine Migration ergänzen.
    schemaVersion: 2,

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
