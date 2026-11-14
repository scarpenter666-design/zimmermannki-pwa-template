# vendor/

Hier liegen fremde Bibliotheken als Datei im Repo, nicht per CDN.
Nur so funktionieren sie offline und landen im Precache.

Beispiel Chart.js:

1. Datei `chart.umd.min.js` von der offiziellen Chart.js-Seite herunterladen.
2. Hier ablegen: `vendor/chart.umd.min.js`.
3. In `index.html` **vor** `js/app.js` einbinden, mit eigenem Script-Tag:

   ```html
   <script src="vendor/chart.umd.min.js"></script>
   ```

Mehr ist nicht nötig. `tools/stamp.mjs` nimmt die Datei beim Deploy automatisch in die Dateiliste auf.
