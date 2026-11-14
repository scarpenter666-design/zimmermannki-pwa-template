# Eigene Subdomain für eine App

Ziel: Jede App bekommt eine eigene Adresse wie `meineapp.zimmermannki.de`.
Damit hat sie einen eigenen Speicher, getrennt von allen anderen Apps.
Gehostet wird weiter auf GitHub Pages. Der Hostinger-VPS ist nicht beteiligt.

> **Status:** Ablauf geplant, aber noch nicht mit einem Wegwerf-Repo getestet.
> Vor dem ersten Umzug einer echten App erst Abschnitt 4 durchführen.

## Was nicht angefasst wird

- Die bestehenden DNS-Einträge für `zimmermannki.de` und `www` bleiben, wie sie sind.
- Das Repo `scarpenter666-design.github.io` (falls vorhanden) und die Account-Ebene bekommen **nie** eine eigene Domain.
- Das Repo `jobcenter-prototype-` wird nicht verändert und bekommt keine eigene Domain.
- Kein Platzhalter-Eintrag (`*`) im DNS. Der würde jede beliebige Subdomain auf GitHub zeigen lassen und Fremden die Übernahme ermöglichen.

## 1. Einmalig: Domain bei GitHub bestätigen

Schützt davor, dass jemand anderes eine deiner Subdomains für sein eigenes Repo beansprucht.

1. GitHub: Profilbild oben rechts → **Settings** → links **Pages** → **Add a domain**.
2. Eintragen: `zimmermannki.de` → **Add domain**.
3. GitHub zeigt einen TXT-Eintrag: einen Namen, der mit `_github-pages-challenge-scarpenter666-design` beginnt, und einen Wert.
4. Hostinger: **Domains** → `zimmermannki.de` → **DNS / Nameserver** → **DNS-Einträge verwalten**. Neuer Eintrag:
   - **Typ:** `TXT`
   - **Name:** der Teil vor `.zimmermannki.de`, also `_github-pages-challenge-scarpenter666-design`
   - **Inhalt:** der Wert von GitHub
5. Zurück bei GitHub: **Verify**. Das kann einige Minuten dauern.

Den TXT-Eintrag danach stehen lassen.

Hinweis: Das ist nur eine Bestätigung. Es richtet **keine** Domain auf Account-Ebene ein.

## 2. Pro App: Subdomain anlegen

Reihenfolge einhalten: erst GitHub, dann DNS.

1. GitHub, im Repo der App: **Settings** → **Pages** → **Custom domain** → `meineapp.zimmermannki.de` → **Save**.
2. Hostinger, DNS-Einträge, neuer Eintrag:
   - **Typ:** `CNAME`
   - **Name:** `meineapp`
   - **Ziel:** `scarpenter666-design.github.io`
3. Warten, bis GitHub unter **Custom domain** „DNS check successful“ zeigt.
4. Haken bei **Enforce HTTPS** setzen. Das Zertifikat kann bis zu einer Stunde brauchen.
5. `https://meineapp.zimmermannki.de` öffnen und die App prüfen.

Am Code ändert sich nichts. Alle Pfade im Template sind relativ.

## 3. Wenn eine App wegfällt

Erst den CNAME-Eintrag bei Hostinger löschen, dann das Repo oder die Custom domain entfernen.
Ein CNAME, der auf GitHub zeigt, ohne dass ein Repo ihn benutzt, ist eine offene Tür.

## 4. Test mit einem Wegwerf-Repo (vor dem ersten echten Umzug)

Zu klären ist: Was passiert mit der alten Adresse `scarpenter666-design.github.io/<Repo>/`, sobald eine Custom domain gesetzt ist?

1. Neues Repo aus dem Template anlegen, z. B. `pwa-umzugstest`. Veröffentlichen.
2. Unter der `github.io`-Adresse öffnen, eine Notiz anlegen, auf dem Handy installieren.
3. Subdomain `umzugstest.zimmermannki.de` nach Abschnitt 2 einrichten.
4. Prüfen und notieren:
   - Leitet die alte Adresse um? Wie schnell?
   - Sind die Notizen unter der alten Adresse noch erreichbar? (Erwartung: nein, sobald umgeleitet wird.)
   - Was zeigt die installierte App vom alten Standort?
   - Sind unter der neuen Adresse die Daten leer? (Erwartung: ja.)
   - Bleiben alle anderen Apps unter `github.io` unverändert erreichbar?
5. Aufräumen: CNAME löschen, dann das Repo löschen.

Vom Ergebnis hängt ab, wie der Daten-Umzug bestehender Apps abläuft (kommt in `docs/migrationsplan.md`).

## 5. Bestehende App mit Daten umziehen

Die Daten ziehen **nicht** mit. Grundablauf:

1. Unter der alten Adresse: Backup exportieren.
2. Subdomain einrichten.
3. Unter der neuen Adresse: Backup importieren, App neu installieren.
4. Alte Verknüpfung auf dem Handy löschen.

Wer das Backup vor Schritt 2 vergisst, kommt möglicherweise nicht mehr an die alten Daten. Deshalb erst Abschnitt 4 testen.
