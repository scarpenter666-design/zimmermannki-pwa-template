/* build.js – Version und Dateiliste für den Service Worker.
   NICHT von Hand pflegen. Beim Deploy überschreibt
   tools/stamp.mjs diese Datei (siehe .github/workflows/deploy.yml).
   Der Stand hier im Repo ist der Entwicklungs-Stand. */
self.APP_BUILD = {
  version: 'dev',
  files: []
};
