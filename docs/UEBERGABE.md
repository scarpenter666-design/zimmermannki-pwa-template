# Übergabe: zimmermannki-pwa-template

Stand: 15.11.2026. Dieses Dokument reicht, um ohne Rückfragen weiterzuarbeiten.
Sprache mit dem Auftraggeber (Sven): Deutsch, du, kurze Sätze, Schritt für Schritt mit exakten Feldnamen. Er arbeitet unter Windows, seine Chrome-DevTools sind deutsch (beide Namen nennen, z. B. **Application** / **App**).

Schwachstellen der bestehenden Live-Apps stehen bewusst **nicht** hier. Sie liegen in einer privaten Datei bei Sven (`UEBERGABE-privat.md`, dazu `phase1-analyse.md` und `migrationsplan.md`). Dieses Repo ist öffentlich.

---

## 1. Was das ist

Grundgerüst für installierbare Web-Apps (PWA) der Marke **ZimmermannKI**. Vanilla JavaScript, ES-Module, kein Framework, kein Bundler. Deploy über GitHub Pages per GitHub Action.

- Repo: `scarpenter666-design/zimmermannki-pwa-template` (öffentlich)
- Live: `https://scarpenter666-design.github.io/zimmermannki-pwa-template/`
- Beispiel-App: „Hello ZimmermannKI“
- Der Name „CarpenterAI“ gilt nur noch im GitHub-Kontonamen. Überall sonst: ZimmermannKI.

## 2. Stand

| Teil | Stand |
|---|---|
| Phase 1 Analyse, Phase 2 Konzept | abgeschlossen |
| Phase 3 Template v1 | abgeschlossen, live |
| Phase 4 Prüfung + Migrationsplan | abgeschlossen |
| v1.1a Verschlüsselung + CSP | abgeschlossen, live |
| Finanz-App (Neustart) | siehe Abschnitt 9 |
| v1.1b `ai.js` | offen |
| NutriCoach-Umzug | offen |

Vom Auftraggeber bestätigt: Installation auf einem Pixel 10 Pro (Android, Chrome) klappt, die installierte App startet im Flugmodus.

**Noch offen bzw. ungetestet:**
- iOS komplett ungetestet.
- Verschlüsselung auf einem echten Handy ungetestet (nur Desktop-Chrome, ferngesteuert).
- Update-Banner in der *installierten* App auf dem Pixel noch nicht bestätigt.
- Sven hat noch nie selbst eine App nur nach der README angelegt. Das soll mit der Finanz-App passieren.
- Im Template-Repo fehlt evtl. noch der Haken **Settings → General → Template repository**.
- Der Ablauf „eigene Subdomain“ (`docs/eigene-subdomain.md`) ist geschrieben, aber nie am echten Konto durchgeführt. Die Menünamen bei Hostinger (hPanel) und GitHub sind aus dem Gedächtnis und müssen beim ersten Mal geprüft werden.
- Bekanntes Verhalten: Öffnet man die App nach einem Push frisch, kommen die neuen Dateien schon aus dem Netz (Network-First). Unter **Einstellungen** steht dann die neue Version, obwohl das Banner noch erscheint. Der Klick schaltet nur den Cache um. Harmlos. Ob das Banner in dem Fall unterdrückt werden soll, ist bei Sven angefragt und unbeantwortet.

## 3. Aufbau

```
app.config.js            einzige Konfiguration (klassisches Script, auch vom SW geladen)
build.js                 Version + Dateiliste. Im Repo "dev". Beim Deploy von stamp.mjs überschrieben
index.html               App-Hülle, enthält die CSP als <meta>
manifest.webmanifest
sw.js                    Service Worker, bei allen Apps identisch
css/tokens.css           Farben (Schwarz + Neon-Cyan), Schriften
css/base.css             Grundgerüst, Hinweisleisten, Dialog, Sperrbildschirm
js/app.js                Beispiel-App
js/core/sw-register.js   Registrierung, Update-Erkennung
js/core/update-banner.js Banner "Neue Version verfügbar"
js/core/storage.js       Speicher: Version, Migration, Sicherung, Fehlerfälle
js/core/backup.js        Export, Import, Adapter für alte Formate, Erinnerung
js/core/install.js       Installieren-Knopf, iOS-Hinweis
js/core/notice.js        Hinweisleisten, toast()
js/core/crypto.js        optionale Verschlüsselung
js/core/lock-screen.js   Sperrbildschirm, Passwort-Dialog
fonts/                   DM Sans, Bebas Neue (lokal, OFL)
icons/                   icon.svg + 4 PNG
vendor/                  fremde Bibliotheken lokal (leer bis auf README)
tools/stamp.mjs          setzt Version + Dateiliste, prüft Manifest-id
tools/icons.html         erzeugt die PNG-Icons im Browser
tests/                   automatische Tests (werden nicht ausgeliefert)
.github/workflows/deploy.yml
docs/                    diese Datei, eigene-subdomain.md
```

Ausgeliefert wird alles außer `tools/`, `docs/`, `tests/`, `server/`, `README.md`, Dateien mit Punkt am Anfang und `*.md`.

### Wichtige Mechanik
- **Version:** `stamp.mjs` berechnet sie aus dem Inhalt der ausgelieferten Dateien, Form `JJJJ-MM-TT-<hash8>`. Ändert sich nur README, `docs/` oder `tests/`, bleibt die Version gleich und niemand sieht ein Banner.
- **Cache-Name:** `<id>@<version>`. Aufgeräumt werden nur Caches mit `<id>@…` und alte Namen der Form `<id>-v<Zahl>`.
- **Service Worker:** Network-First mit Timeout (3 s), Precache mit `cache: 'reload'`, Fallback auf `index.html` nur bei `request.mode === 'navigate'`, behandelt nur `GET` innerhalb des eigenen Ordners. Kein `skipWaiting` ohne Klick. Versteht `{type:'SKIP_WAITING'}` und `"skip"`.
- **Speicher-Keys:** `<id>.<name>`. Reserviert: `<id>._meta`, `<id>._backup.v<N>`, `<id>._corrupt.<name>.<Zeit>`, `<id>._restorepoint`, `<id>._crypto`.
- **Speicher-API ist asynchron.** Daten liegen als JSON ohne Umschlag, die Datenversion steht in `_meta`. Mit Verschlüsselung liegt je Eintrag `{iv, ct}`.
- **Codec-Schnittstelle** `{ name, encode(value), decode(stored) }`: `storage.js` und `backup.js` nehmen einen Codec. `crypto.js` liefert zwei: `aes-gcm` für den Speicher (aus `openVault().setup()/unlock()`), `pbkdf2-aes-gcm` für Backups (`backupCodec(passwort)`).
- **Verschlüsselung:** zufälliger Datenschlüssel (AES-GCM 256), verpackt mit einem Schlüssel aus PBKDF2-SHA256 (600 000 Runden). Passwort wird nie gespeichert. Passwort ändern verpackt nur neu.
- **Manifest-`id`:** auf `github.io` `/<Repo-Name>/`, auf eigener Subdomain `/`. Abweichender Sollwert für Bestands-Apps in `app.config.js` → `manifestId`. `stamp.mjs` warnt bei Abweichung.

## 4. Geltende Entscheidungen

### Konzept (E1–E13)
| Nr. | Entscheidung |
|---|---|
| E1 | Isolation als Mischform: Prefixe immer aktiv, neue Apps auf eigener Subdomain |
| E2 | Domain `zimmermannki.de`, DNS bei Hostinger. Pro App ein CNAME auf `scarpenter666-design.github.io`. Die Einträge für `zimmermannki.de` und `www` (anderes Projekt auf einem VPS) bleiben unangetastet. Vor dem ersten CNAME die Domain bei GitHub bestätigen |
| E3 | Hosting nur GitHub Pages. Kein Netlify, keine `netlify.toml` |
| E4 | `stamp.mjs` per GitHub Action ist freigegeben. Sonst kein Build-Tool |
| E5 | Mehrere Dateien mit ES-Modulen |
| E6 | Speicher asynchron, localStorage dahinter |
| E7 | KI-Server (Supabase, mit Anmeldung): **zurückgestellt.** Nur falls NutriCoach ein Produkt wird. Ein Endpunkt ohne Anmeldung geht nie öffentlich |
| E8 | **Passwort ist der Standard** (mindestens 8 Zeichen). PIN bleibt erlaubt, mindestens 6 Ziffern, einfache Muster abgelehnt. Backups verschlüsselt |
| E9 | Schriften DM Sans + Bebas Neue, lokal als woff2. Farben Schwarz + Neon-Cyan |
| E10 | Icons über `tools/icons.html` |
| E11 | Strenge CSP ist an. Kein Inline-Handler, kein Inline-Style, kein Inline-Script |
| E12 | Repo öffentlich, als Template repository gedacht |
| E13 | Setup nur als Checkliste in der README. `new-app.mjs` ist gestrichen |

### Migration (M1–M6, mit Svens Änderungen)
| Nr. | Entscheidung |
|---|---|
| M1 | **IronLog wird nicht migriert.** Bleibt auf `github.io`, wie es ist |
| M2 | Finanz-App: Neustart statt Umzug, mit Verschlüsselung |
| M3 | Umzüge immer als neue Fassung in einem **neuen** Repo unter eigener Subdomain. Die alte Adresse bleibt unverändert, bis Sven bestätigt. Danach nur Hinweis „umgezogen“ |
| M4 | Subdomains: `finanzen`, `nutricoach`, `nadabrahma` unter `zimmermannki.de` |
| M5 | Repo-Namen: `finanzen-app`, `nutricoach-app` (von Sven so genannt), `nadabrahma-app` (Vorschlag) |
| M6 | NutriCoach erst nach `ai.js` |

### Reihenfolge
1. v1.1a: erledigt.
2. **Finanz-App** neu, Repo `finanzen-app`, `finanzen.zimmermannki.de`, Verschlüsselung an, Passwort als Standard. Zugleich Svens README-Versuch und Generalprobe für Subdomain, DNS, Domain-Bestätigung. Er will dazu eine Schritt-für-Schritt-Anleitung für Hostinger (hPanel) und GitHub.
3. **v1.1b: `ai.js`, nur Modus „personal“** (Key im Browser des Nutzers). Kein Server, kein Supabase, keine Anmeldung. Modellname in der Konfiguration, nicht im Code. Key nie ins Backup. In der CSP `connect-src` um die KI-Adresse ergänzen.
4. **NutriCoach**: Repo `nutricoach-app`, `nutricoach.zimmermannki.de`, Daten per Export (alte Adresse) und Import (`legacyPrefixAdapter({ prefix: 'nc_', ignore: ['nc_apikey'] })`), danach alten Key widerrufen, alte Adresse mit Hinweis „umgezogen“.
5. NadaBrahma: ohne Termin.

**Gestrichen oder später:** IronLog-Migration, `new-app.mjs`, KI-Server.

### Arbeitsweise
- Nach jedem Schritt stoppen und auf Svens OK warten.
- Vor dem Anlegen eines GitHub-Repos fragen. Repos legt Sven selbst an (Werkzeuge hier können das nicht).
- Abweichungen vom Auftrag und Unsicherheiten offen sagen. Er will Widerspruch, keine Zustimmung aus Höflichkeit.
- Ergebnisse als Datei liefern (`.md`), in der Antwort nur das Wichtigste.

## 5. Was nie passieren darf

1. Die bestehenden Repos `IronLog`, `NutriCoach`, `NadaBrahma`, `Meine-Finanz-App` ohne ausdrücklichen Auftrag verändern. Standard: nur lesen.
2. **`jobcenter-prototype-` in irgendeiner Form anfassen.** Höchstens lesen. Keine Commits, Branches, Issues, keine Änderung an Pages, keine eigene Domain. Nicht in Migrationspläne aufnehmen. Den localStorage-Key `jc-lernapp-claude-v2` nie lesen oder schreiben.
3. Eine eigene Domain für ein Repo `scarpenter666-design.github.io` oder auf Account-Ebene einrichten. Das würde die Adressen aller Projekt-Repos verschieben. Eigene Domains nur per CNAME in einzelnen Projekt-Repos.
4. Eine eigene Domain auf ein bestehendes App-Repo legen, solange dessen alte Adresse gebraucht wird.
5. Die DNS-Einträge für `zimmermannki.de` und `www` ändern. Einen Platzhalter-Eintrag (`*`) anlegen.
6. `localStorage.clear()` oder Cache-Löschen ohne Prefix-Filter. Auf `github.io` teilen sich alle Apps eine Origin.
7. Eine App-`id` doppelt vergeben. Vergeben: `hello`, `ironlog`, `nutricoach`, `nadabrahma`, `meine-finanzen`.
8. `id` in `app.config.js`, `id` im Manifest oder `start_url` einer genutzten App ändern.
9. Testkopien bestehender Apps unter `github.io` veröffentlichen. Sie würden die echten Daten mitbenutzen. Nur lokal oder unter eigener Subdomain testen.
10. Secrets, API-Keys, E-Mail-Adressen oder persönliche Daten ins Repo. Schwachstellen der Live-Apps in öffentliche Dateien.
11. Framework oder Build-Tool einführen. CDN-Links einbauen. Inline-Handler, Inline-Styles oder Inline-Scripts ins HTML schreiben.
12. Den Hinweis „umgezogen“ auf eine alte Adresse setzen, bevor Sven den Umzug bestätigt hat.
13. Eine verschlüsselte App ohne Backup-Möglichkeit ausliefern. Passwort weg heißt Daten weg.
14. Passwörter, PINs oder Zahlungsdaten für Sven in Formulare eintippen. Anmeldungen macht er selbst.

## 6. Tests

Voraussetzung: Python 3 mit `playwright`, Node.js, ein Chrome. Pfad zu Chrome bei Bedarf über die Umgebungsvariable `CHROME_PATH` (Vorgabe `/usr/bin/google-chrome`). Die Tests starten einen eigenen kleinen Server (`tests/server.py`, verhält sich wie GitHub Pages: Unterordner, `max-age=600`).

Im Repo-Ordner:

| Befehl | Prüft | Soll |
|---|---|---|
| `python3 tests/smoke.py` | Erstbesuch, Offline, Update A → B, Reset, Isolation | 22/22 |
| `python3 tests/units.py` | Speicher und Backup | 33/33 |
| `python3 tests/crypto_units.py` | Verschlüsselung, Module | 36/36 |
| `python3 tests/crypto_ui.py` | Verschlüsselung über die Oberfläche, CSP | 24/24 |
| `python3 tests/phase4.py` | Installierbarkeit, langsames Netz, Backup über die Oberfläche | 35/36 |
| `node tools/stamp.mjs` | erzeugt `_site/`, zeigt die Version | ohne Warnung |

Unter Windows `py` statt `python3`.

Zu `phase4.py`: Die eine Abweichung ist Chromes Meldung `in-incognito` aus dem Testfenster. Im normalen Profil meldet Chrome keine Installierbarkeits-Fehler. Kein Fehler der App.

Hinweise für neue Tests:
- Wegen der CSP funktioniert `page.wait_for_function("…")` nicht (nutzt `eval`). Stattdessen die Hilfsfunktion `wait_true` aus den Tests.
- `page.evaluate` läuft an der CSP vorbei. Wer prüfen will, ob die CSP wirkt, muss Code über das Dokument einschleusen (siehe `crypto_ui.py`).
- Nach `node tools/stamp.mjs` den Ordner `_site/` wieder löschen. Er steht in `.gitignore`.

Von Hand, lokal: `py -m http.server 8000` im Repo-Ordner, dann `http://localhost:8000`.

**Vor jedem Push:** `smoke.py` und, falls Speicher oder Verschlüsselung berührt sind, die passenden Tests. Prüfen, dass kein `_site/`, kein `node_modules/` und keine Secrets im Commit sind.

**Nach jedem Push:** Reiter **Actions**, Lauf **Deploy** grün. Schlägt er mit „Get Pages site failed“ fehl, steht **Settings → Pages → Source** nicht auf `GitHub Actions`.

## 7. Neue App aus dem Template

Checkliste in der `README.md`, Abschnitt „Neue App aus dem Template erstellen“. Für eine App mit eigener Subdomain zusätzlich `docs/eigene-subdomain.md`. Kurzfassung der Stellen, die sich pro App ändern:

- `app.config.js`: `id`, `name`, `shortName`, `storage.schemaVersion: 1`, `storage.encryption`
- `manifest.webmanifest`: `id`, `name`, `short_name`, `description`, Farben, `categories`
- `index.html`: Block „Pro App anpassen“, die `<h1 id="appTitle">`, Inhalt von `<main>`
- `css/tokens.css`: Akzentfarben
- `icons/`: `icon.svg`, dann vier PNG über `tools/icons.html`
- `js/app.js`: eigene Logik. Beispiel-Migration `migrations: { 2: … }` entfernen

## 8. Bekannte Grenzen

- localStorage fasst rund 5 MB je Origin.
- Ein PIN aus 6 Ziffern ist durchprobierbar, wenn jemand die verschlüsselten Daten kopiert hat. Deshalb Passwort als Standard.
- Namen der Einträge, Zeitstempel und Datenversion bleiben im Klartext.
- Verschlüsselung lässt sich nicht nachträglich für vorhandene Klartext-Daten einschalten.
- CSP nur per `<meta>`. `frame-ancestors` (Schutz gegen Einbetten) ginge nur per HTTP-Header, den GitHub Pages nicht setzen kann.
- Keine iOS-Startbilder, kein Light-Mode, kein Cloud-Backup.

## 9. Laufende Arbeit: Finanz-App

Auftrag (15.11.2026): Finanz-App neu aufbauen. Repo `finanzen-app`, Verschlüsselung an, Passwort als Standard, Funktionen der alten App, Chart.js aus `vendor/`. Lokal testen. **Nicht** auf die Subdomain bringen, das macht Sven später.

### Stand 15.11.2026, 01:00: gebaut und lokal getestet, noch nirgends veröffentlicht

- Der Code liegt **nicht auf GitHub**. Das Repo `finanzen-app` existiert noch nicht. Sven hat ihn als `finanzen-app.zip` bekommen (kompletter Ordner mit einem lokalen Commit auf `main`).
- Entstanden aus dem Template-Stand `3e5903e` (v1.1a).
- Lokaler Test `python3 tests/finanzen.py` im App-Ordner: **20/20**.

**App-spezifische Dateien:** `js/app.js`, `css/app.css`, `index.html`, `app.config.js`, `manifest.webmanifest`, `icons/`, `vendor/chart.umd.js` (Chart.js 4.4.1), `tests/finanzen.py`, `README.md`. Alles unter `js/core/`, `sw.js`, `tools/` ist unverändert aus dem Template.

**Konfiguration:** `id: 'meine-finanzen'`, `storage.schemaVersion: 1`, `storage.encryption: 'pin'`, `manifestId: null`, Manifest-`id` `/` (passt nur zur Subdomain).

**Speicher:** `meine-finanzen.entries`, `.income_cats`, `.expense_cats`, `.month`. Die Namen sind so gewählt, dass `legacyPrefixAdapter({ prefix: 'fin_', … })` alte Backups direkt abbildet.

**Funktionen wie in der alten App:** Einnahmen und Ausgaben mit Kategorie und Datum, Fixposten (werden ab ihrem Startmonat in jeden Monat kopiert), Übertrag aus Vormonaten, Monatswahl (drei Monate zurück, zwei voraus), Ringdiagramm der Ausgaben mit Anteilen, eigene Kategorien.

**Abweichungen von der alten App:**
- Passwort statt 4-stelligem PIN, Daten verschlüsselt.
- Fünf Reiter: Übersicht, Einnahmen, Ausgaben, Fix, **Mehr**. „Mehr“ enthält Kategorien, Backup, Sicherheit, App. Die alte App hatte einen eigenen Reiter „Kategorien“.
- Betrag als Text mit Komma (`12,50` und `1.234,56` gehen).
- Löscht man eine verwendete Kategorie, erscheinen ihre Einträge unter „Ohne Kategorie“ (früher verschwanden sie aus den Listen).
- Farben im ZimmermannKI-Stil, Grün/Rot/Gelb nur für Beträge.
- Die Zeile „Verfügbar“ in der Übersicht ist ohne Übertrag, die Karte oben mit Übertrag (wie früher, jetzt beschriftet).

**Nächste Schritte:**
1. Sven legt das Repo `finanzen-app` an (**Use this template** oder leeres Repo) und stellt **Settings → Pages → Source** auf `GitHub Actions`.
2. Code einspielen (Push-Zugriff über das Werkzeug `add_repo` mit `access: "push"`, oder Sven lädt den Inhalt der ZIP hoch).
3. **Achtung:** Ohne Subdomain würde die App unter `…github.io/finanzen-app/` laufen, also auf der gemeinsamen Origin, und `stamp.mjs` warnt nicht (Wert `/` ist erlaubt), obwohl die `id` dort falsch wäre. Erst die Subdomain einrichten (`docs/eigene-subdomain.md`), dann echte Daten eingeben.
4. Schritt-für-Schritt-Anleitung für Hostinger (hPanel) und GitHub schreiben. Sven hat sie verlangt, sie ist noch nicht geschrieben. Grundlage: `docs/eigene-subdomain.md`.
5. Auf dem Pixel testen: Entsperren, Tastatur, Passwort-Manager, Dauer.

**Nicht getestet:** echtes Handy, iOS, viele hundert Einträge, Verhalten über den Jahreswechsel hinaus (Logik ist aus der alten App übernommen).

Älterer Stand:


- 15.11.2026, 00:45: Noch nicht begonnen. Das Repo `finanzen-app` existiert noch nicht (Sven legt es an).
