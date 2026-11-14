import os, pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
import asyncio, subprocess, sys, shutil, re, pathlib
from playwright.async_api import async_playwright
TPL = pathlib.Path(__file__).resolve().parents[1]
JS = r"""
async () => {
  const { openStore, StorageError, eraseAppData } = await import('./js/core/storage.js');
  const { createBackup, legacyPrefixAdapter, BackupError } = await import('./js/core/backup.js');
  const { openVault, backupCodec, checkSecret, CryptoError } = await import('./js/core/crypto.js');
  const out = []; const t = (name, ok, info='') => out.push([name, !!ok, String(info)]);
  const wipe = p => Object.keys(localStorage).filter(k => k.startsWith(p)).forEach(k => localStorage.removeItem(k));
  const code = async fn => { try { await fn(); return 'kein Fehler'; } catch (e) { return e.code || e.message; } };
  const IT = 2000;   // wenige Runden, damit die Tests schnell laufen. Ein Test unten misst die echte Einstellung.

  // 1 Regeln für PIN/Passwort
  t('Regel: 5 Ziffern abgelehnt', !checkSecret('12345').ok);
  t('Regel: 123456, 654321, 000000, 890123 abgelehnt', ['123456','654321','000000','890123'].every(p => !checkSecret(p).ok));
  t('Regel: 6 gemischte Ziffern erlaubt, Hinweis auf Passwort', checkSecret('402917').ok && checkSecret('402917').message.includes('Passwort'));
  t('Regel: Passwort unter 8 Zeichen abgelehnt, ab 8 erlaubt', !checkSecret('abc12').ok && checkSecret('Sonne-und-Meer').ok);

  // 2 Einrichten, Daten schreiben
  wipe('c1'); let v = await openVault({ id: 'c1', iterations: IT });
  t('Neuer Tresor: Zustand new', v.state === 'new');
  t('Schwacher PIN bei Einrichtung abgelehnt', await code(() => v.setup('111111')) === 'weak' && !localStorage.getItem('c1._crypto'));
  let codec = await v.setup('402917');
  let s = await openStore({ id: 'c1', schemaVersion: 1, codec });
  await s.set('entries', [{ betrag: 1234.56, text: 'Gehalt GEHEIMWORT' }]); await s.set('month', '2026-11');
  const raw = localStorage.getItem('c1.entries');
  t('Gespeicherter Eintrag enthält keinen Klartext', !raw.includes('GEHEIMWORT') && !raw.includes('1234') && JSON.parse(raw).iv && JSON.parse(raw).ct, raw.slice(0, 40));
  const all = Object.entries(localStorage).filter(([k]) => k.startsWith('c1.')).map(([k, x]) => k + '=' + x).join('\n');
  t('PIN steht nirgends im Speicher', !all.includes('402917'));
  const rec = JSON.parse(localStorage.getItem('c1._crypto'));
  t('Schlüsseldaten: PBKDF2-SHA256, Salt, verpackter Schlüssel, kein PIN-Hash', rec.kdf.name === 'PBKDF2' && rec.kdf.hash === 'SHA-256' && rec.kdf.salt && rec.wrapped.ct && Object.keys(rec).sort().join() === 'kdf,v,wrapped');
  const a1 = localStorage.getItem('c1.month'); await s.set('month', '2026-11'); const a2 = localStorage.getItem('c1.month');
  t('Gleicher Inhalt ergibt jedes Mal anderen Geheimtext (frischer IV)', a1 !== a2);

  // 3 Neu öffnen: gesperrt, falscher/richtiger PIN
  v = await openVault({ id: 'c1', iterations: IT });
  t('Nach Neustart: Zustand locked', v.state === 'locked');
  t('Falscher PIN: Fehler wrong', await code(() => v.unlock('402918')) === 'wrong' && v.state === 'locked');
  codec = await v.unlock('402917'); s = await openStore({ id: 'c1', schemaVersion: 1, codec });
  t('Richtiger PIN: Daten lesbar', (await s.get('entries'))[0].text === 'Gehalt GEHEIMWORT' && await s.get('month') === '2026-11' && s.status === 'ok' && s.problems.length === 0);

  // 4 Ohne Schlüssel geöffnet: gesperrt, nichts wird überschrieben
  const plain = await openStore({ id: 'c1', schemaVersion: 1 });
  t('Ohne Schlüssel: Status locked, Schreiben verweigert', plain.status === 'locked' && await code(() => plain.set('entries', [])) === 'locked' && localStorage.getItem('c1.entries').includes('"ct"'));

  // 5 PIN ändern: Daten bleiben, alter PIN gilt nicht mehr
  const before = localStorage.getItem('c1.entries');
  t('PIN ändern mit falschem altem PIN abgelehnt', await code(() => v.changeSecret('000001', 'Neues-Passwort-9')) === 'wrong');
  t('PIN ändern auf schwachen Wert abgelehnt', await code(() => v.changeSecret('402917', '1234')) === 'weak');
  await v.changeSecret('402917', 'Neues-Passwort-9');
  t('PIN ändern: Daten wurden nicht neu geschrieben', localStorage.getItem('c1.entries') === before);
  v = await openVault({ id: 'c1', iterations: IT });
  t('Nach Änderung: alter PIN falsch, neues Passwort richtig', await code(() => v.unlock('402917')) === 'wrong' && (codec = await v.unlock('Neues-Passwort-9')) && true);
  s = await openStore({ id: 'c1', schemaVersion: 1, codec });
  t('Nach Änderung: Daten weiter lesbar', (await s.get('entries'))[0].betrag === 1234.56);

  // 6 Migration und Sicherungen mit Verschlüsselung
  const s2 = await openStore({ id: 'c1', schemaVersion: 2, codec, migrations: { 2: async db => db.set('entries', (await db.get('entries')).map(e => ({ ...e, kat: 'neu' }))) } });
  const bk = localStorage.getItem('c1._backup.v1');
  t('Migration verschlüsselter Daten klappt', s2.status === 'migrated' && (await s2.get('entries'))[0].kat === 'neu');
  t('Sicherungskopie vor Migration ist ebenfalls verschlüsselt', bk && !bk.includes('GEHEIMWORT'));
  await s2.reset();
  t('Wiederherstellungspunkt nach Reset ist verschlüsselt', !localStorage.getItem('c1._restorepoint').includes('GEHEIMWORT'));
  await s2.undoRestore();
  t('Rückgängig nach Reset: Daten wieder lesbar', (await s2.get('entries'))[0].text === 'Gehalt GEHEIMWORT');

  // 7 Verschlüsseltes Backup
  const b = createBackup({ store: s2 });
  const file = (await b.exportText({ codec: backupCodec('Backup-Passwort-1', { iterations: IT }) })).text; const fj = JSON.parse(file);
  t('Backup-Datei: verschlüsselt, kein Klartext, kein PIN', fj.codec === 'pbkdf2-aes-gcm' && fj.data.ct && fj.data.kdf.salt && !file.includes('GEHEIMWORT') && !file.includes('Neues-Passwort-9') && !file.includes('Backup-Passwort-1'));
  t('Backup-Datei: schwaches Passwort abgelehnt', await code(() => b.exportText({ codec: backupCodec('123', { iterations: IT }) })) === 'weak');
  t('Import ohne Passwort: Hinweis codec', await code(() => b.inspect(file)) === 'codec');
  t('Import mit falschem Passwort: Fehler password', await code(() => b.inspect(file, { codec: backupCodec('Falsches-Passwort', { iterations: IT }) })) === 'password');
  // auf "anderem Gerät": neue App-Instanz, anderer PIN, gleiches Backup
  wipe('c1'); v = await openVault({ id: 'c1', iterations: IT }); codec = await v.setup('Ganz-anderes-Geraet'); s = await openStore({ id: 'c1', schemaVersion: 2, codec });
  await b.inspect(file, { codec: backupCodec('Backup-Passwort-1') }).catch(() => {});
  const b2 = createBackup({ store: s }); await b2.importText(file, { codec: backupCodec('Backup-Passwort-1', { iterations: IT }) });
  t('Backup auf neuem Gerät mit anderem PIN einspielbar', (await s.get('entries'))[0].text === 'Gehalt GEHEIMWORT');
  t('Eingespielte Daten liegen wieder verschlüsselt', !localStorage.getItem('c1.entries').includes('GEHEIMWORT'));

  // 8 Altes Klartext-Backup der Finanz-App in verschlüsselte App
  wipe('c2'); v = await openVault({ id: 'c2', iterations: IT }); codec = await v.setup('Finanz-Passwort'); s = await openStore({ id: 'c2', schemaVersion: 1, codec });
  const b3 = createBackup({ store: s, adapters: [legacyPrefixAdapter({ prefix: 'fin_', ignore: ['fin_pin', 'fin_pin_attempts', 'fin_pin_lock_until'] })] });
  await b3.importText(JSON.stringify({ version: 1, exported: '2026-05-27T10:00:00Z', fin_entries: [{ id: 1, amount: 99, note: 'ALTDATEN' }], fin_month: '2026-05', fin_pin: '1234' }));
  const dump = Object.entries(localStorage).filter(([k]) => k.startsWith('c2.')).map(([k, x]) => k + '=' + x).join('\n');
  t('Altes Finanz-Backup: eingespielt, verschlüsselt, alter PIN nirgends', (await s.get('entries'))[0].note === 'ALTDATEN' && !dump.includes('ALTDATEN') && !dump.includes('1234') && !dump.includes('fin_pin'));

  // 9 PIN vergessen: alles löschen, fremde Keys bleiben
  localStorage.setItem('ironlog4', 'bleibt'); localStorage.setItem('c2x.fremd', 'bleibt');
  await eraseAppData({ id: 'c2', legacyKeys: {} });
  t('Löschen bei vergessenem PIN: nur eigene Keys weg', !Object.keys(localStorage).some(k => k.startsWith('c2.')) && localStorage.getItem('ironlog4') === 'bleibt' && localStorage.getItem('c2x.fremd') === 'bleibt');
  t('Danach: Tresor ist wieder neu', (await openVault({ id: 'c2', iterations: IT })).state === 'new');
  localStorage.removeItem('ironlog4'); localStorage.removeItem('c2x.fremd');

  // 10 Beschädigte Schlüsseldaten und manipulierter Eintrag
  wipe('c3'); v = await openVault({ id: 'c3', iterations: IT }); codec = await v.setup('Passwort-Drei'); s = await openStore({ id: 'c3', schemaVersion: 1, codec }); await s.set('x', { a: 1 });
  const tam = JSON.parse(localStorage.getItem('c3.x')); tam.ct = tam.ct.slice(0, -4) + (tam.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'); localStorage.setItem('c3.x', JSON.stringify(tam));
  t('Manipulierter Eintrag wird erkannt, nicht als Daten akzeptiert', (await s.get('x', 'FALLBACK')) === 'FALLBACK' && s.problems.length === 1);
  localStorage.setItem('c3._crypto', '{kaputt');
  t('Beschädigte Schlüsseldaten: klare Fehlermeldung', await code(() => openVault({ id: 'c3' })) === 'damaged');

  // 11 Echte Einstellung: 600000 Runden, Dauer messen
  wipe('c4'); v = await openVault({ id: 'c4' }); const t0 = performance.now(); await v.setup('Echte-Runden-1'); const ms = Math.round(performance.now() - t0);
  t('Standard sind 600000 PBKDF2-Runden', JSON.parse(localStorage.getItem('c4._crypto')).kdf.iterations === 600000, '');
  out.push(['Dauer Einrichtung mit 600000 Runden (2 Ableitungen)', true, ms + ' ms']);
  ['c1','c2','c3','c4'].forEach(wipe);
  return out;
}
"""
async def main():
    out = subprocess.run(['node', str(TPL/'tools/stamp.mjs'), '--out', '_site'], capture_output=True, text=True); assert out.returncode == 0, out.stderr
    shutil.rmtree('/tmp/wwwc', ignore_errors=True); shutil.copytree(TPL/'_site', '/tmp/wwwc/app'); shutil.rmtree(TPL/'_site')
    srv = subprocess.Popen([sys.executable, str(HERE/'server.py'), '/tmp/wwwc', '8160'], stderr=subprocess.DEVNULL); await asyncio.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            pg = await b.new_page(); await pg.goto('http://localhost:8160/app/'); res = await pg.evaluate(JS); await b.close()
    finally: srv.terminate()
    for n, ok, info in res: print(('OK   ' if ok else 'FAIL ') + n + (f'  [{info}]' if info else ''))
    bad = [r for r in res if not r[1]]; print(f'\n{len(res)-len(bad)}/{len(res)} bestanden'); sys.exit(1 if bad else 0)
asyncio.run(main())
