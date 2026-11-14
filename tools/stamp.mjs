#!/usr/bin/env node
/* ============================================================
   stamp.mjs – macht aus dem Repo den auslieferbaren Stand.

   1. Kopiert alle App-Dateien nach _site/ (ohne tools/, docs/ usw.).
   2. Schreibt _site/build.js mit Version und Dateiliste.

   Die Version ergibt sich aus dem INHALT der Dateien. Ändert sich
   nichts an der App (z. B. nur die README), bleibt die Version
   gleich und niemand bekommt ein unnötiges Update-Banner.

   Aufruf:   node tools/stamp.mjs [--out _site]
   Läuft automatisch in .github/workflows/deploy.yml.
   Braucht nur Node.js, keine weiteren Pakete.
   ============================================================ */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : '_site';
const out = resolve(root, outArg);

// Was NICHT ausgeliefert wird (oberste Ebene des Repos)
const EXCLUDE_TOP = new Set([
  'tools', 'docs', 'server', 'node_modules', 'tests',
  'README.md', 'LICENSE', 'package.json', 'package-lock.json',
  relative(root, out).split(sep)[0]
]);
// Dateien, die nirgends ausgeliefert werden
const EXCLUDE_ANYWHERE = name => name.startsWith('.') || name.endsWith('.md');
// Ausgeliefert, aber nicht in der Precache-Liste
const NOT_PRECACHED = new Set(['sw.js', 'CNAME']);

function walk(dir, base = dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    if (EXCLUDE_ANYWHERE(name)) continue;
    if (dir === base && EXCLUDE_TOP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path, base));
    else files.push(relative(base, path).split(sep).join('/'));
  }
  return files;
}

const files = walk(root);
for (const required of ['index.html', 'sw.js', 'app.config.js', 'manifest.webmanifest']) {
  if (!files.includes(required)) {
    console.error(`Fehler: ${required} fehlt.`);
    process.exit(1);
  }
}

// ── Manifest prüfen: "id" muss zur Adresse der App passen ──
// Auf github.io heißt sie "/<Repo-Name>/", auf einer eigenen Subdomain "/".
// Eine aus dem Template kopierte id würde zwei Apps für Chrome zur selben machen.
try {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  const repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1];
  const ownDomain = files.includes('CNAME');
  if (!manifest.id) {
    console.warn('Warnung: In manifest.webmanifest fehlt das Feld "id".');
  } else if (repo && !ownDomain && manifest.id !== `/${repo}/` && manifest.id !== '/') {
    console.warn(`::warning file=manifest.webmanifest::"id" ist "${manifest.id}", das Repo heißt "${repo}". Erwartet: "/${repo}/" (oder "/" bei eigener Subdomain).`);
  }
} catch (error) {
  console.error('Fehler: manifest.webmanifest ist kein gültiges JSON. ' + error.message);
  process.exit(1);
}

// ── Version aus dem Inhalt berechnen (build.js selbst zählt nicht mit) ──
const hash = createHash('sha256');
for (const file of files) {
  if (file === 'build.js') continue;
  hash.update(file + '\n');
  hash.update(readFileSync(join(root, file)));
}
const contentHash = hash.digest('hex').slice(0, 8);

// Datum des letzten Commits, der eine App-Datei geändert hat (nur zur Lesbarkeit)
let date = '';
try {
  const pathspec = ['.', ...[...EXCLUDE_TOP].filter(Boolean).map(name => `:(exclude,top)${name}`), ':(exclude,top).github'];
  date = execFileSync('git', ['log', '-1', '--format=%cd', '--date=format:%Y-%m-%d', '--', ...pathspec],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch { /* kein Git: Version ohne Datum */ }
const version = date ? `${date}-${contentHash}` : contentHash;

// ── Ausgabe-Ordner füllen ──
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of files) {
  cpSync(join(root, file), join(out, file), { recursive: true });
}

const precache = files.filter(file => !NOT_PRECACHED.has(file)).map(file => './' + file);
if (!precache.includes('./build.js')) precache.push('./build.js');

writeFileSync(join(out, 'build.js'),
  '/* Automatisch erzeugt von tools/stamp.mjs. Nicht bearbeiten. */\n' +
  'self.APP_BUILD = ' + JSON.stringify({ version, files: precache.sort() }, null, 2) + ';\n');

// Jekyll auf GitHub Pages abschalten (sonst fehlen Dateien mit "_" am Anfang)
writeFileSync(join(out, '.nojekyll'), '');

console.log(`Version ${version}`);
console.log(`${precache.length} Dateien im Precache, Ausgabe in ${relative(root, out) || '.'}/`);
