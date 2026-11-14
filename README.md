# zimmermannki-pwa-template

Grundgerüst für installierbare Web-Apps (PWA) von ZimmermannKI.
Kein Framework, kein Bundler. Das Repo läuft so, wie es ist, im Browser.

Stand: **v1**. Enthalten ist die Beispiel-App „Hello ZimmermannKI“, die alle Module benutzt.

---

## Was drin ist

| Datei | Aufgabe | Pro App anpassen? |
|---|---|---|
| `app.config.js` | einzige Konfiguration (Name, `id`, Datenversion) | **ja** |
| `index.html` | App-Hülle | **ja** (Titel, Inhalt) |
| `manifest.webmanifest` | Angaben für die Installation | **ja** |
| `css/tokens.css` | Farben und Schriften | **ja** |
| `css/base.css` | Grundgerüst, Knöpfe, Hinweisleisten | nein |
| `icons/` | `icon.svg` + vier PNG-Dateien | **ja** |
| `js/app.js` | deine App | **ja** |
| `js/core/storage.js` | Speicher mit Version, Migration, Sicherung | nein |
| `js/core/backup.js` | Export, Import, Backup-Erinnerung | nein |
| `js/core/update-banner.js` + `sw-register.js` | „Neue Version verfügbar“ | nein |
| `js/core/install.js` | Installieren-Knopf, iOS-Hinweis | nein |
| `js/core/notice.js` | Hinweisleisten und kurze Meldungen | nein |
| `sw.js` | Service Worker (Offline, Updates) | **nie** |
| `build.js` | Version + Dateiliste, wird beim Deploy automatisch gesetzt | **nie** |
| `tools/stamp.mjs` | setzt Version und Dateiliste | nein |
| `tools/icons.html` | erzeugt die PNG-Icons im Browser | nein |
| `.github/workflows/deploy.yml` | veröffentlicht auf GitHub Pages | nein |
| `fonts/`, `vendor/` | Schriften und Bibliotheken, lokal statt CDN | bei Bedarf |

---

## Lokal starten

Ein Terminal im Ordner des Repos öffnen (Windows: im Explorer in die Adresszeile `cmd` tippen und Enter).

| System | Befehl |
|---|---|
| Windows | `py -m http.server 8000` |
| Windows, falls `py` fehlt | `npx serve -l 8000` (braucht Node.js) |
| macOS, Linux | `python3 -m http.server 8000` |

Dann `http://localhost:8000` öffnen. Die Version heißt lokal `dev`. Beenden mit `Strg + C`.
Direkt per Doppelklick auf `index.html` geht es **nicht** (Module und Service Worker brauchen einen Server).

So testest du lokal den echten Auslieferungsstand samt Version:

```bash
node tools/stamp.mjs
cd _site
py -m http.server 8000
```

(macOS, Linux: `python3` statt `py`.)

---

## Neue App aus dem Template erstellen

Rechne mit 30 bis 60 Minuten bis zur installierbaren App.

### Schritt 1 – Repo anlegen
1. Auf GitHub das Repo `zimmermannki-pwa-template` öffnen.
2. Knopf **Use this template** → **Create a new repository**.
3. **Repository name:** z. B. `MeineApp`. **Public** auswählen. **Create repository**.
4. Repo auf den Rechner klonen.

### Schritt 2 – `app.config.js`
| Feld | Eintragen |
|---|---|
| `id` | Kurzname in Kleinbuchstaben, z. B. `meineapp`. Nur `a–z`, `0–9`, `-`. **Danach nie mehr ändern.** |
| `name` | voller Name, z. B. `Meine App` |
| `shortName` | höchstens 12 Zeichen |
| `storage.schemaVersion` | `1` |

Die `id` muss sich von allen anderen Apps unterscheiden. Vergeben sind: `ironlog`, `nutricoach`, `nadabrahma`, `meine-finanzen`, `hello`.

### Schritt 3 – `manifest.webmanifest`
| Feld | Eintragen |
|---|---|
| `id` | Adresse der App ohne Domain. Auf `github.io`: `/<Repo-Name>/`, z. B. `/MeineApp/` (Groß- und Kleinschreibung wie im Repo-Namen). Auf eigener Subdomain: `/` |
| `name` | wie `name` in `app.config.js` |
| `short_name` | wie `shortName` |
| `description` | ein Satz |
| `background_color` | wie `--bg` in `css/tokens.css` |
| `theme_color` | wie `--bg` |
| `categories` | z. B. `["health"]`, `["finance"]`, `["utilities"]` |

`start_url` und `scope` bleiben `./`.

**Zu `id`:**
- An `id` erkennt Chrome eine installierte App wieder. **Nach der ersten Veröffentlichung nie mehr ändern.** Sonst gilt die App als neu, und die alte Installation bekommt keine Updates des Manifests mehr.
- Den Wert aus dem Template **nicht** stehen lassen. Zwei Apps mit derselben `id` auf `github.io` hält Chrome für dieselbe App.
- Ein relativer Wert wie `./` funktioniert nicht. Er würde bei jeder App zu `/` und damit bei allen gleich.
- Beim Veröffentlichen prüft `tools/stamp.mjs` den Wert. Passt er nicht zum Repo-Namen, steht im Reiter **Actions** eine gelbe Warnung.
- Entscheide **vor** der ersten Veröffentlichung, ob die App auf `github.io` bleibt oder eine eigene Subdomain bekommt (Schritt 11). Davon hängt der Wert ab.

### Schritt 4 – `index.html`
Im Block zwischen `▼ Pro App anpassen` und `▲ Pro App anpassen`:
| Zeile | Eintragen |
|---|---|
| `<title>` | App-Name |
| `<meta name="description">` | ein Satz |
| `<meta name="theme-color">` | wie `--bg` |
| `<meta name="apple-mobile-web-app-title">` | wie `shortName` |

Danach den Inhalt von `<main class="app__main">` durch deine Oberfläche ersetzen.

### Schritt 5 – `css/tokens.css`
Mindestens `--accent`, `--accent-contrast`, `--accent-dim`, `--accent-glow` setzen. Wenn du `--bg` änderst, auch Schritt 3 und 4 nachziehen.

### Schritt 6 – Icons
1. `icons/icon.svg` durch dein Icon ersetzen (quadratisch, `viewBox="0 0 512 512"`).
2. `tools/icons.html` im Browser öffnen (Doppelklick genügt).
3. **SVG-Datei** auswählen, **Hintergrundfarbe** eintragen, **Erzeugen**, dann **Alle herunterladen**.
4. Die vier Dateien nach `icons/` kopieren: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`.

### Schritt 7 – `js/app.js`
Die Beispiel-App durch deine Logik ersetzen. Das Gerüst bleibt:

```js
import { openStore } from './core/storage.js';
import { createBackup } from './core/backup.js';
import { initUpdates } from './core/update-banner.js';
import { initInstall } from './core/install.js';

const store = await openStore();                 // Speicher
const backup = createBackup({ store });          // Backup
const daten = await store.get('daten', []);      // lesen
await store.set('daten', daten);                 // schreiben

await initUpdates();                             // Update-Banner
initInstall({ button: document.getElementById('installBtn'), store });
backup.remindIfDue();                            // Backup-Erinnerung
```

Export- und Import-Knöpfe kannst du aus der Beispiel-App übernehmen (`exportBtn`, `importBtn`, `importFile`).

### Schritt 8 – Lokal prüfen
Server starten (siehe „Lokal starten“), App öffnen, einmal durchklicken. In den Entwicklerwerkzeugen (F12) → Reiter **Console** (deutsch: **Konsole**) darf nichts Rotes stehen.

### Schritt 9 – Veröffentlichen
1. `git add -A`, `git commit -m "Erste Version"`, `git push`.
2. Auf GitHub im Repo: **Settings** → **Pages** → **Build and deployment** → **Source:** `GitHub Actions`.
3. Reiter **Actions**: Der Lauf **Deploy** muss grün werden (ca. 1 Minute). Falls er vor Schritt 2 rot wurde: **Re-run all jobs**.
4. Die App liegt unter `https://scarpenter666-design.github.io/MeineApp/`.

### Schritt 10 – Aufs Handy
- **Android (Chrome):** Seite öffnen → Knopf **Installieren** in der App oder Menü ⋮ → **App installieren**.
- **iPhone (Safari):** Teilen-Symbol → **Zum Home-Bildschirm**.

### Schritt 11 (empfohlen) – eigene Subdomain
Neue Apps sollen auf eine eigene Adresse wie `meineapp.zimmermannki.de`. Anleitung: [`docs/eigene-subdomain.md`](docs/eigene-subdomain.md).
**Mach das, bevor echte Daten in der App liegen.** Ein späterer Wechsel der Adresse nimmt die Daten nicht mit.

---

## Updates ausliefern

Ändern, committen, pushen. Mehr nicht.

- Die Version entsteht automatisch aus dem Inhalt der Dateien, z. B. `2026-11-14-de417b11`.
- Geöffnete Apps zeigen „Neue Version verfügbar“. Neu geladen wird erst nach Klick auf **Jetzt aktualisieren**.
- Ändert sich nur die README oder etwas in `docs/`, bleibt die Version gleich. Niemand sieht ein Banner.
- Die Dateiliste für den Offline-Modus entsteht ebenfalls automatisch. Neue Dateien einfach ins Repo legen.

---

## Die Module

### Speicher (`storage.js`)

```js
const store = await openStore({ migrations: { 2: async db => { /* … */ } } });

await store.get('name', vorgabe);   // lesen
await store.set('name', wert);      // schreiben, wirft StorageError
await store.remove('name');
await store.snapshot();             // alles als Objekt
await store.reset();                // nur die Daten DIESER App löschen
store.status;                       // ok, fresh, migrated, newer, …
store.problems;                     // was beim Lesen schiefging
```

- Jeder Key heißt `<id>.<name>`, z. B. `hello.notes`. Andere Apps werden nie berührt.
- **Defekte Daten** werden nach `<id>._corrupt.…` kopiert und nicht überschrieben.
- **Voller Speicher:** `store.set()` wirft einen `StorageError` mit `code: 'quota'`. Fang ihn ab und zeig die Meldung (siehe Funktion `save()` in `js/app.js`).
- Vor `reset()` und vor jedem Import entsteht ein Wiederherstellungspunkt. `store.undoRestore()` holt ihn zurück.

### Datenformat ändern (Migration)
1. In `app.config.js` die Zahl `storage.schemaVersion` um 1 erhöhen, z. B. von `2` auf `3`.
2. In `js/app.js` bei `openStore({ migrations: { … } })` einen Eintrag ergänzen:

   ```js
   3: async db => {
     const alt = await db.get('notes', []);
     await db.set('notes', alt.map(n => ({ ...n, wichtig: false })));
   }
   ```
3. Fertig. Beim nächsten Start legt das Modul eine Sicherung an (`<id>._backup.v2`) und führt den Schritt aus. Geht er schief, bleibt der alte Stand, und die App schreibt nichts mehr.

Alte Migrationen nie löschen. Wer lange nicht geöffnet hat, braucht alle Schritte.

### Backup (`backup.js`)

```js
const backup = createBackup({ store });
await backup.download();               // Datei <id>-backup-JJJJ-MM-TT.json
const info = await backup.inspect(text);   // prüfen, ohne etwas zu ändern
await backup.importText(text);         // einspielen (vorher Wiederherstellungspunkt)
backup.remindIfDue();                  // Hinweis, wenn fällig
```

- Der Import lehnt ab: kein JSON, fremde App, neuere Datenversion. Ältere Backups werden migriert.
- Erinnerung nach `backup.remindAfterDays` Tagen (Vorgabe 30), aber nur, wenn sich seit dem letzten Backup etwas geändert hat. „Später“ gibt `backup.snoozeDays` Tage Ruhe.
- Einträge aus `storage.secretNames` stehen nie in der Datei.

### Update-Banner (`update-banner.js`)

```js
const updates = await initUpdates({
  canUpdateNow: () => !sitzungLaeuft   // optional: Update aufschieben
});
updates.version;       // laufende Version
updates.checkNow();    // sofort suchen
```

### Installieren (`install.js`)

```js
initInstall({ button: document.getElementById('installBtn'), store });
```

Der Knopf braucht im HTML das Attribut `hidden`. Er erscheint nur, wenn der Browser die Installation anbietet.

### Hinweise (`notice.js`)

```js
import { toast, showNotice } from './core/notice.js';
toast('Gespeichert.');
```

---

## Regeln

1. **Kein `onclick="…"` im HTML.** Immer `addEventListener` in `js/app.js`. (Vorbereitung für die strenge Sicherheitsregel in v1.1.)
2. **Jedes Script bekommt ein eigenes Tag.** Zwischen `<script src="…">` und `</script>` steht nie Code. Der Browser ignoriert ihn sonst.
3. **Nie direkt `localStorage` benutzen**, immer `store`. Nie `localStorage.clear()`.
4. **Nichts per CDN laden.** Bibliotheken nach `vendor/`, Schriften nach `fonts/`.
5. **Nie mehr ändern, sobald jemand die App nutzt:** `id` in `app.config.js`, `id` in `manifest.webmanifest`, `start_url`.
6. **`sw.js` und `build.js` nicht anfassen.**
7. **Keine Geheimnisse ins Repo.** Es ist öffentlich.
8. **Nie eine eigene Domain für das Repo `scarpenter666-design.github.io` oder auf Account-Ebene einrichten.** Das würde die Adressen aller Apps verschieben. Eigene Domains nur pro Projekt-Repo.

---

## Bestehende App umstellen (Kurzfassung)

Das Template ist dafür gebaut, alte Apps schrittweise zu übernehmen, ohne Daten umzukopieren:

```js
// app.config.js einer alten App, Beispiel IronLog
storage: {
  schemaVersion: 1,
  legacyKeys: { state: 'ironlog4' },   // alter Key bleibt, gleiches Format
  legacySchemaVersion: 1
}
```

```js
// alte Backup-Dateien weiter lesbar, Beispiel NutriCoach
import { createBackup, legacyPrefixAdapter } from './core/backup.js';
const backup = createBackup({
  store,
  adapters: [legacyPrefixAdapter({ prefix: 'nc_', ignore: ['nc_apikey'] })]
});
```

Der Service Worker versteht auch die alten Update-Nachrichten (`"skip"` und `{type:'SKIP_WAITING'}`). Der ausführliche Plan je App steht im Migrationsplan. Der liegt absichtlich nicht in diesem öffentlichen Repo.

**Achtung beim Testen:** Eine Testkopie einer bestehenden App nie unter `scarpenter666-design.github.io` veröffentlichen. Sie würde dieselben Daten benutzen wie die echte App. Nur lokal oder unter einer eigenen Subdomain testen.

---

## Fehlersuche

| Problem | Prüfen |
|---|---|
| Kein Update-Banner | Reiter **Actions**: Ist **Deploy** grün? In der App: **Einstellungen** → **Nach Update suchen**. |
| App lädt nicht offline | Einmal online öffnen und 5 Sekunden warten. F12 → Reiter **Application** (deutsch: **App**) → **Service workers** (deutsch: **Service Worker**): Steht dort „activated and is running“ (deutsch: „aktiviert und wird ausgeführt“)? |
| Knopf „Installieren“ fehlt | App ist schon installiert, oder der Browser bietet es nicht an. Menü ⋮ → **App installieren** probieren. |
| Seite bleibt weiß | F12 → Reiter **Console** (deutsch: **Konsole**). Häufig: Tippfehler in `app.config.js`. |
| Manifest prüfen | F12 → Reiter **Application** (deutsch: **App**) → **Manifest**. Dort stehen Name, Icons und Warnungen zur Installierbarkeit. |
| Gespeicherte Daten ansehen | F12 → **Application** (**App**) → **Local storage** (deutsch: **Lokaler Speicher**). Die Einträge der App beginnen mit ihrer `id`. |
| Deploy schlägt fehl | **Settings** → **Pages** → **Source** muss `GitHub Actions` sein. |
| Icon auf Android abgeschnitten | In `tools/icons.html` den Regler für das Maskable-Icon kleiner stellen. |

---

## Noch nicht enthalten (kommt mit v1.1)

- `crypto.js`: Verschlüsselung mit PIN oder Passwort
- `ai.js`: KI-Aufrufe (persönlich oder über Supabase mit Anmeldung)
- strenge Content-Security-Policy
- `tools/new-app.mjs`: Setup-Skript statt Checkliste

`storage.js` und `backup.js` haben dafür schon den Anschluss (`codec`).

---

## Schriften

DM Sans und Bebas Neue liegen in `fonts/`. Beide stehen unter der SIL Open Font License, Text in `fonts/LICENSE-FONTS.txt`.
