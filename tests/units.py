import os, pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
import asyncio, subprocess, sys, json
from playwright.async_api import async_playwright
JS = r"""
async () => {
  const { openStore, StorageError } = await import('./js/core/storage.js');
  const { createBackup, legacyPrefixAdapter, BackupError } = await import('./js/core/backup.js');
  const out = []; const t = (name, ok, info='') => out.push([name, !!ok, String(info)]);
  const wipe = p => Object.keys(localStorage).filter(k => k.startsWith(p)).forEach(k => localStorage.removeItem(k));
  const code = async fn => { try { await fn(); return 'kein Fehler'; } catch (e) { return e.code || e.message; } };

  // 1 Migration v1 -> v2 mit Sicherungskopie
  wipe('t1'); localStorage.setItem('t1.notes', '["a","b"]');
  let s = await openStore({ id: 't1', schemaVersion: 2, legacySchemaVersion: 1, migrations: { 2: async db => db.set('notes', (await db.get('notes', [])).map(x => ({ text: x }))) } });
  t('Migration: Status migrated', s.status === 'migrated', s.status);
  t('Migration: Daten umgestellt', JSON.stringify(await s.get('notes')) === '[{"text":"a"},{"text":"b"}]');
  t('Migration: Sicherung des alten Stands', JSON.parse(localStorage.getItem('t1._backup.v1')).raw.notes === '["a","b"]');
  s = await openStore({ id: 't1', schemaVersion: 2 });
  t('Zweiter Start: keine erneute Migration', s.status === 'ok', s.status);

  // 2 Migration schlägt fehl -> alter Stand bleibt, nur lesen
  wipe('t2'); localStorage.setItem('t2.notes', '["a"]');
  s = await openStore({ id: 't2', schemaVersion: 2, migrations: { 2: async db => { await db.set('notes', []); throw new Error('kaputt'); } } });
  t('Fehlgeschlagene Migration: Rollback', localStorage.getItem('t2.notes') === '["a"]' && s.status === 'migration-failed', s.status);
  t('Fehlgeschlagene Migration: Schreiben gesperrt', await code(() => s.set('notes', [])) === 'migration');

  // 3 Daten neuer als App
  wipe('t3'); localStorage.setItem('t3._meta', '{"schemaVersion":5,"codec":"json"}'); localStorage.setItem('t3.x', '1');
  s = await openStore({ id: 't3', schemaVersion: 2 });
  t('Neuere Daten: nur lesen', s.status === 'newer' && await code(() => s.set('x', 2)) === 'newer' && localStorage.getItem('t3.x') === '1');

  // 4 Defektes JSON
  wipe('t4'); localStorage.setItem('t4._meta', '{"schemaVersion":1,"codec":"json"}'); localStorage.setItem('t4.data', '{"a":1,,');
  s = await openStore({ id: 't4', schemaVersion: 1 });
  const v = await s.get('data', { leer: true });
  const ck = Object.keys(localStorage).find(k => k.startsWith('t4._corrupt.data.'));
  t('Defekt: Fallback statt Absturz', v.leer === true);
  t('Defekt: Rohtext beiseitegelegt', ck && localStorage.getItem(ck) === '{"a":1,,' && s.problems.length === 1);

  // 4b Defekter Eintrag: nur EINE Kopie, egal wie oft gelesen wird
  const copies = () => Object.keys(localStorage).filter(k => k.startsWith('t4._corrupt.data.')).length;
  await s.get('data'); await s.get('data'); await s.get('data');
  t('Defekt: 4x get() in einer Sitzung = 1 Kopie, 1 Problem', copies() === 1 && s.problems.length === 1, copies() + ' Kopien, ' + s.problems.length + ' Probleme');
  await new Promise(r => setTimeout(r, 5));
  s = await openStore({ id: 't4', schemaVersion: 1 });
  await s.get('data'); await s.get('data');
  t('Defekt: neuer App-Start legt keine zweite Kopie an', copies() === 1 && s.problems.length === 1, copies() + ' Kopien');
  for (let i = 0; i < 200; i++) await s.get('data');
  t('Defekt: 200 weitere Lesezugriffe, Speicher wächst nicht', copies() === 1 && Object.keys(localStorage).filter(k => k.startsWith('t4.')).length === 3);
  localStorage.setItem('t4.data', '{"anders kaputt');
  await s.get('data');
  t('Defekt: anderer defekter Inhalt bekommt eine eigene Kopie', copies() === 2 && s.problems.length === 2, copies() + ' Kopien');

  // 5 Speicher voll
  wipe('t5'); s = await openStore({ id: 't5', schemaVersion: 1 });
  const big = 'x'.repeat(6 * 1024 * 1024);
  t('Voller Speicher: StorageError quota', await code(() => s.set('big', big)) === 'quota');
  t('Voller Speicher: App läuft weiter', await code(() => s.set('klein', 1)) === 'kein Fehler');

  // 6 Legacy-Keys (IronLog-Muster): gleicher Key, gleiches Format
  wipe('t6'); localStorage.setItem('ironlogX', '{"plans":[1],"log":[2]}');
  s = await openStore({ id: 't6', schemaVersion: 1, legacyKeys: { state: 'ironlogX' } });
  const st = await s.get('state'); st.log.push(3); await s.set('state', st);
  t('legacyKeys: alter Key wird weiterbenutzt', localStorage.getItem('ironlogX') === '{"plans":[1],"log":[2,3]}' && !localStorage.getItem('t6.state'), s.status);
  localStorage.removeItem('ironlogX');

  // 7 rawNames (z. B. nc_apikey als reiner Text) + secretNames
  wipe('t7'); localStorage.setItem('nc_apikeyX', 'kein-json-wert');
  s = await openStore({ id: 't7', schemaVersion: 1, legacyKeys: { apikey: 'nc_apikeyX' }, rawNames: ['apikey'], secretNames: ['apikey'] });
  await s.set('plan', { a: 1 });
  t('rawNames: reiner Text lesbar', await s.get('apikey') === 'kein-json-wert' && s.problems.length === 0);
  const b7 = createBackup({ store: s }); const ex = JSON.parse((await b7.exportText()).text);
  t('Backup: geheimer Eintrag fehlt', !('apikey' in ex.data) && ex.data.plan.a === 1 && ex.app === 't7' && ex.format === 1);
  // Import ersetzt Daten, lässt Geheimes stehen, legt Restorepoint an
  await s.set('plan', { a: 2 }); await s.set('extra', 1);
  await b7.importText(JSON.stringify(ex));
  t('Import: Daten ersetzt, Geheimes bleibt', (await s.get('plan')).a === 1 && await s.get('extra') === null && localStorage.getItem('nc_apikeyX') === 'kein-json-wert');
  await s.undoRestore();
  t('Import rückgängig', (await s.get('plan')).a === 2 && await s.get('extra') === 1);
  localStorage.removeItem('nc_apikeyX');

  // 8 Import-Prüfungen
  wipe('t8'); s = await openStore({ id: 't8', schemaVersion: 2, migrations: { 2: async db => db.set('entries', (await db.get('entries', [])).map(e => ({ ...e, v2: true }))) } });
  const b8 = createBackup({ store: s, adapters: [legacyPrefixAdapter({ prefix: 'fin_', ignore: ['fin_pin'] })] });
  t('Import: kein JSON', await code(() => b8.inspect('hallo')) === 'invalid');
  t('Import: fremde App', await code(() => b8.inspect('{"app":"andere","format":1,"schemaVersion":1,"data":{}}')) === 'wrong-app');
  t('Import: neuere Version', await code(() => b8.inspect('{"app":"t8","format":1,"schemaVersion":9,"data":{}}')) === 'newer');
  t('Import: unbekannte Datei', await code(() => b8.inspect('{"foo":1}')) === 'invalid');
  t('Import: verschlüsselt ohne Schlüssel', await code(() => b8.inspect('{"app":"t8","format":1,"schemaVersion":2,"codec":"aes-gcm","data":"…"}')) === 'codec');
  // altes Finanz-Backup: PIN wird ignoriert, Migration läuft
  const old = JSON.stringify({ version: 1, exported: '2026-05-27T10:00:00Z', fin_entries: [{ id: 1 }], fin_month: '2026-05', fin_pin: '1234' });
  const info = await b8.inspect(old);
  t('Altes Finanz-Backup erkannt', info.needsMigration && info.entries === 2 && !('pin' in info.data), JSON.stringify(Object.keys(info.data)));
  await b8.importText(old);
  t('Altes Backup: migriert eingespielt, kein PIN', (await s.get('entries'))[0].v2 === true && !Object.keys(localStorage).some(k => k.includes('pin')));

  // 9 Backup-Erinnerung
  wipe('t9'); s = await openStore({ id: 't9', schemaVersion: 1 }); const b9 = createBackup({ store: s });
  t('Erinnerung: ohne Daten nicht', b9.isReminderDue() === false);
  await s.set('a', 1);
  const day = 864e5, now = Date.now();
  t('Erinnerung: nach 31 Tagen ohne Backup', b9.isReminderDue(now + 31 * day) === true && b9.isReminderDue(now + 5 * day) === false);
  await s.setMeta({ lastBackupAt: new Date(now + 1000).toISOString() });
  t('Erinnerung: nicht, wenn seit Backup nichts geändert', b9.isReminderDue(now + 60 * day) === false);
  await s.setMeta({ lastChangeAt: new Date(now + 2000).toISOString() });
  t('Erinnerung: wieder nach Änderung + 30 Tagen', b9.isReminderDue(now + 60 * day) === true);
  await b9.snooze(7);
  t('Erinnerung: "Später" gibt 7 Tage Ruhe', b9.isReminderDue(now + 60 * day) === true && b9.isReminderDue(now + 3 * day) === false);

  // 10 ungültige Namen
  t('Name mit "_" abgelehnt', await code(() => s.set('_meta', 1)) === 'name');
  ['t1','t2','t3','t4','t5','t6','t7','t8','t9'].forEach(wipe);
  return out;
}
"""
async def main():
    import shutil, pathlib
    tpl = pathlib.Path(__file__).resolve().parents[1]
    out = subprocess.run(['node', str(tpl/'tools/stamp.mjs'), '--out', '_site'], capture_output=True, text=True); assert out.returncode == 0, out.stderr
    shutil.rmtree('/tmp/pwa-test-www/hello', ignore_errors=True); shutil.copytree(tpl/'_site', '/tmp/pwa-test-www/hello'); shutil.rmtree(tpl/'_site')
    srv = subprocess.Popen([sys.executable, str(HERE/'server.py'), '/tmp/pwa-test-www', '8124'], stderr=subprocess.DEVNULL); await asyncio.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            pg = await b.new_page(); await pg.goto('http://localhost:8124/hello/')
            res = await pg.evaluate(JS); await b.close()
    finally: srv.terminate()
    for n, ok, info in res: print(('OK   ' if ok else 'FAIL ') + n + (f'  [{info}]' if info and not ok else ''))
    bad = [r for r in res if not r[1]]; print(f'\n{len(res)-len(bad)}/{len(res)} bestanden'); sys.exit(1 if bad else 0)
asyncio.run(main())
