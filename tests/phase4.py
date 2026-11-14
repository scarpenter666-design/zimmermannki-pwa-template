import os, pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
import asyncio, json, shutil, subprocess, sys, pathlib, re, time, struct
from playwright.async_api import async_playwright
TPL = pathlib.Path(__file__).resolve().parents[1]
WWW = pathlib.Path('/tmp/pwa-test-www4'); APP = WWW/'zimmermannki-pwa-template'
BASE = 'http://localhost:8130/zimmermannki-pwa-template/'
R = []
def check(group, name, ok, info=''):
    R.append((group, name, bool(ok), str(info))); print(('OK   ' if ok else 'FAIL ') + f'[{group}] {name}' + (f'  ({info})' if info else ''))
def deploy():
    out = subprocess.run(['node', str(TPL/'tools/stamp.mjs'), '--out', '_site'], capture_output=True, text=True, env={'PATH': '/usr/bin:/usr/local/bin:/bin', 'GITHUB_REPOSITORY': 'scarpenter666-design/zimmermannki-pwa-template'})
    assert out.returncode == 0, out.stderr
    shutil.rmtree(APP, ignore_errors=True); shutil.copytree(TPL/'_site', APP); shutil.rmtree(TPL/'_site')
    return re.search(r'Version (\S+)', out.stdout).group(1), out.stderr
NC_OLD = json.dumps({"version": 1, "exported": "2026-10-01T08:00:00.000Z",
  "nc_plan": {"days": [{"day": "Montag", "meals": [{"name": "Linsen-Dal"}]}]}, "nc_profile": {"weight": 82, "diet": "Flexitarisch"},
  "nc_shopping": {"Gemüse": [{"name": "Zwiebeln", "done": False}]}, "nc_library": [{"name": "Linsen-Dal"}], "nc_pantry": ["Reis"],
  "nc_receipts": [], "nc_price_alerts": [], "nc_meal_history": [["Linsen-Dal"]]})

async def wait_true(page, expr, timeout=15000):
    """Wie wait_for_function, aber ohne eval (funktioniert mit strenger CSP)."""
    import time as _t
    end = _t.time() + timeout / 1000
    while _t.time() < end:
        if await page.evaluate(expr): return
        await asyncio.sleep(0.15)
    raise TimeoutError(expr)
async def main():
    WWW.mkdir(exist_ok=True); (WWW/'.slow').unlink(missing_ok=True)
    vA, warn = deploy()
    check('Deploy', 'stamp.mjs ohne Warnung zur Manifest-id', 'warning' not in warn.lower(), warn.strip()[:80])
    srv = subprocess.Popen([sys.executable, str(HERE/'server.py'), str(WWW), '8130'], stderr=subprocess.DEVNULL); await asyncio.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            ver = b.version
            ctx = await b.new_context(viewport={'width': 412, 'height': 915}, accept_downloads=True, user_agent=None)
            page = await ctx.new_page(); errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_' not in m.text else None)
            await page.goto(BASE)
            await wait_true(page, "navigator.serviceWorker.controller !== null")
            # ── Installierbarkeit (Chrome-eigene Prüfung über DevTools-Protokoll) ──
            cdp = await ctx.new_cdp_session(page)
            man = await cdp.send('Page.getAppManifest')
            inst = await cdp.send('Page.getInstallabilityErrors')
            check('Installierbarkeit', 'Chrome: Manifest ohne Fehler geladen', man.get('url', '').endswith('manifest.webmanifest') and not man.get('errors'), json.dumps(man.get('errors')))
            check('Installierbarkeit', 'Chrome: keine Installierbarkeits-Fehler', inst.get('installabilityErrors') == [], json.dumps(inst.get('installabilityErrors')))
            m = json.loads(man['data'])
            check('Installierbarkeit', 'Manifest: name, short_name ≤ 12, start_url, scope, display standalone', m['name'] and len(m['short_name']) <= 12 and m['start_url'] == './' and m['scope'] == './' and m['display'] == 'standalone')
            check('Installierbarkeit', 'Manifest: id passt zur Adresse', m['id'] == '/zimmermannki-pwa-template/', m['id'])
            for ic in m['icons']:
                data = (APP/ic['src']).read_bytes(); w, h = struct.unpack('>II', data[16:24])
                check('Installierbarkeit', f"Icon {ic['src']} ist PNG {ic['sizes']} ({ic['purpose']})", data[:8] == b'\x89PNG\r\n\x1a\n' and f'{w}x{h}' == ic['sizes'])
            ap = (APP/'icons/apple-touch-icon.png').read_bytes(); w, h = struct.unpack('>II', ap[16:24])
            check('Installierbarkeit', 'apple-touch-icon ist PNG 180x180 und verlinkt', (w, h) == (180, 180) and await page.locator('link[rel="apple-touch-icon"]').count() == 1)
            ctype = await page.evaluate("fetch('manifest.webmanifest').then(r => r.headers.get('content-type'))")
            check('Installierbarkeit', 'Service Worker aktiv, Scope = App-Ordner', (await page.evaluate("navigator.serviceWorker.ready.then(r => r.scope)")) == BASE)
            check('Installierbarkeit', 'theme-color, viewport-fit=cover, kein Zoom-Verbot', await page.evaluate("!!document.querySelector('meta[name=theme-color]') && document.querySelector('meta[name=viewport]').content.includes('viewport-fit=cover') && !document.querySelector('meta[name=viewport]').content.includes('user-scalable')"))
            csp_ready = await page.evaluate("document.querySelectorAll('[onclick],[onchange],[onsubmit],[style]').length === 0 && [...document.scripts].every(s => s.src)")
            check('Installierbarkeit', 'CSP-bereit: keine Inline-Handler, -Styles, -Scripts', csp_ready)
            ext = await page.evaluate("performance.getEntriesByType('resource').filter(e => !e.name.startsWith(location.origin)).map(e => e.name)")
            check('Installierbarkeit', 'Keine Anfragen an fremde Server (kein CDN)', ext == [], str(ext))
            # ── Offline ──
            await page.fill('#nameInput', 'Sven'); await page.dispatch_event('#nameInput', 'change')
            await page.fill('#noteInput', 'Notiz 1'); await page.click('#noteForm button'); await page.wait_for_selector('#noteList li')
            await ctx.set_offline(True); await page.reload(); await page.wait_for_selector('#noteList li')
            check('Offline', 'Start ohne Netz, Daten und Schrift da', (await page.text_content('#greeting')) == 'Hallo Sven!' and await page.evaluate("document.fonts.check('16px \"DM Sans\"')"))
            check('Offline', 'Fehlendes Script liefert Fehler, nicht index.html', await page.evaluate("fetch('./nix.js').then(r => r.status, () => 'error')") == 'error')
            check('Offline', 'Unbekannte Unterseite zeigt die App (Fallback nur für Seitenaufrufe)', True if (await page.goto(BASE + 'irgendwas')) and await page.locator('#appTitle').count() == 1 else False)
            await page.goto(BASE); await ctx.set_offline(False)
            # ── Langsames Netz: Timeout ──
            (WWW/'.slow').touch(); t0 = time.time()
            await page.reload(); await page.wait_for_selector('#noteList li', timeout=20000); dt = time.time() - t0
            (WWW/'.slow').unlink()
            check('Langsames Netz', 'Server antwortet erst nach 9 s, App steht aus dem Cache nach ~3 s', dt < 6.5, f'{dt:.1f} s')
            await asyncio.sleep(10)
            # ── Backup über die Oberfläche ──
            await page.reload(); await page.wait_for_selector('#noteList li')
            await page.click('[data-nav="settings"]')
            async with page.expect_download() as dl: await page.click('#exportBtn')
            d = await dl.value; path = '/tmp/' + d.suggested_filename; await d.save_as(path)
            f = json.loads(open(path).read())
            check('Backup', 'Export: Datei <id>-backup-<Datum>.json mit app, format, schemaVersion', re.fullmatch(r'hello-backup-\d{4}-\d\d-\d\d\.json', d.suggested_filename) and f['app'] == 'hello' and f['format'] == 1 and f['schemaVersion'] == 2 and f['data']['notes'][0]['text'] == 'Notiz 1', d.suggested_filename)
            await page.click('[data-nav="start"]'); await page.click('#noteList button')
            await page.fill('#noteInput', 'Neu nach Backup'); await page.click('#noteForm button'); await asyncio.sleep(0.3)
            await page.click('[data-nav="settings"]')
            await page.set_input_files('#importFile', path); await page.wait_for_selector('#confirmDialog[open]')
            txt = await page.text_content('#confirmText')
            check('Backup', 'Import fragt nach und nennt Herkunft und Anzahl', 'Backup dieser App' in txt and '2 Einträge' in txt, txt[:70])
            async with page.expect_navigation(): await page.click('#confirmYes')
            await page.wait_for_selector('#noteList li')
            check('Backup', 'Import stellt den Stand des Backups her', (await page.locator('#noteList li').count()) == 1 and 'Notiz 1' in await page.text_content('#noteList'))
            await page.click('[data-nav="settings"]'); await page.click('#undoBtn')
            async with page.expect_navigation(): await page.click('#confirmYes')
            await page.wait_for_selector('#noteList li')
            check('Backup', 'Rückgängig holt den Stand vor dem Import zurück', 'Neu nach Backup' in await page.text_content('#noteList'))
            # falsche Dateien in der Oberfläche
            for label, content, expect in [('fremde App', '{"app":"ironlog","format":1,"schemaVersion":1,"data":{}}', 'anderen App'), ('kein JSON', 'das ist kein backup', 'keine gültige'), ('neuere Version', '{"app":"hello","format":1,"schemaVersion":99,"data":{}}', 'neueren App-Version'), ('altes NutriCoach-Backup in fremder App', NC_OLD, 'nicht als Backup dieser App erkannt')]:
                open('/tmp/x.json', 'w').write(content)
                await page.click('[data-nav="settings"]'); await page.set_input_files('#importFile', '/tmp/x.json')
                await page.wait_for_selector('.cp-notice[data-notice-id="toast"]'); msg = await page.text_content('.cp-notice[data-notice-id="toast"]')
                check('Backup', f'Import abgelehnt: {label}', expect in msg and 'Neu nach Backup' in (await page.evaluate("localStorage.getItem('hello.notes')")), msg[:60])
                await page.evaluate("document.querySelector('.cp-notice[data-notice-id=toast]')?.remove()")
            # altes NutriCoach-Backup in einer App MIT Adapter (so wie NutriCoach nach dem Umzug)
            res = await page.evaluate("""async (old) => {
              const { openStore } = await import('./js/core/storage.js');
              const { createBackup, legacyPrefixAdapter } = await import('./js/core/backup.js');
              Object.keys(localStorage).filter(k => k.startsWith('nctest') || k.startsWith('ncX_')).forEach(k => localStorage.removeItem(k));
              localStorage.setItem('ncX_apikey', 'geheim-bleibt');
              const names = ['plan','profile','shopping','library','pantry','receipts','price_alerts','meal_history'];
              const legacyKeys = Object.fromEntries(names.map(n => [n, 'ncX_' + n])); legacyKeys.apikey = 'ncX_apikey';
              const store = await openStore({ id: 'nctest', schemaVersion: 1, legacyKeys, rawNames: ['apikey'], secretNames: ['apikey'] });
              const backup = createBackup({ store, adapters: [legacyPrefixAdapter({ prefix: 'nc_', ignore: ['nc_apikey'] })] });
              const info = await backup.inspect(old); await backup.importText(old);
              const out = { source: info.source, entries: info.entries, plan: JSON.parse(localStorage.getItem('ncX_plan')).days[0].meals[0].name, pantry: localStorage.getItem('ncX_pantry'), key: localStorage.getItem('ncX_apikey'), newKeys: Object.keys(localStorage).filter(k => k.startsWith('nctest.') && !k.startsWith('nctest._')).length, exp: Object.keys(JSON.parse((await backup.exportText()).text).data).sort().join(',') };
              Object.keys(localStorage).filter(k => k.startsWith('nctest') || k.startsWith('ncX_')).forEach(k => localStorage.removeItem(k)); return out; }""", NC_OLD)
            check('Backup', 'Altes NutriCoach-Backup (version 1, nc_…) wird mit Adapter erkannt', res['entries'] == 8 and 'nc_' in res['source'], f"{res['entries']} Einträge")
            check('Backup', 'Altes NutriCoach-Backup landet in den alten Keys, API-Key bleibt unberührt', res['plan'] == 'Linsen-Dal' and res['pantry'] == '["Reis"]' and res['key'] == 'geheim-bleibt' and res['newKeys'] == 0)
            check('Backup', 'Neuer Export enthält den API-Key nicht', 'apikey' not in res['exp'], res['exp'])
            # ── Update A -> B ──
            idx = TPL/'index.html'; orig = idx.read_text()
            try: idx.write_text(orig.replace('<h2>Notizen</h2>', '<h2>Notizen (Version B)</h2>')); vB, _ = deploy()
            finally: idx.write_text(orig)
            await page.goto(BASE); await page.wait_for_selector('#noteList li'); navs = []
            page.on('framenavigated', lambda fr: navs.append(fr.url) if fr == page.main_frame else None)
            check('Update', 'A ausgeliefert, B bereitgestellt, Seite zeigt noch A', (await page.evaluate("self.APP_BUILD.version")) == vA and vA != vB, f'{vA} -> {vB}')
            await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            await page.click('[data-nav="settings"]'); await page.click('#checkUpdateBtn')
            await page.wait_for_selector('.cp-notice[data-notice-id="update"]', timeout=15000)
            await page.screenshot(path='/tmp/pwa-test-p4-banner.png')
            check('Update', 'Banner „Neue Version verfügbar“ erscheint', 'Neue Version' in await page.text_content('.cp-notice[data-notice-id="update"]'))
            check('Update', 'Kein Reload ohne Klick', len(navs) == 0 and 'Version B' not in await page.content())
            # zweiter Tab sieht das wartende Update beim Start
            p2 = await ctx.new_page(); await p2.goto(BASE); await p2.wait_for_selector('.cp-notice[data-notice-id="update"]', timeout=10000)
            check('Update', 'Neu geöffneter Tab zeigt das wartende Update sofort', True); await p2.close()
            async with page.expect_navigation(timeout=15000): await page.click('.cp-notice[data-notice-id="update"] button')
            await page.wait_for_selector('#noteList li')
            check('Update', 'Nach Klick läuft B, Daten erhalten', (await page.evaluate("self.APP_BUILD.version")) == vB and 'Version B' in await page.content() and 'Neu nach Backup' in await page.text_content('#noteList'))
            await asyncio.sleep(0.6)
            check('Update', 'Alter Cache gelöscht, genau ein eigener Cache', (await page.evaluate("caches.keys()")) == [f'hello@{vB}'])
            await ctx.set_offline(True); await page.reload(); await page.wait_for_selector('#noteList li')
            check('Update', 'B startet auch offline', 'Version B' in await page.content()); await ctx.set_offline(False)
            check('Gesamt', 'Keine Fehler in der Konsole', not errors, '; '.join(errors)[:300])
            await b.close()
    finally: srv.terminate()
    bad = [r for r in R if not r[2]]
    json.dump({'chrome': ver, 'results': R}, open('/tmp/pwa-test-phase4-results.json', 'w'), ensure_ascii=False)
    print(f'\nChrome {ver}: {len(R)-len(bad)}/{len(R)} bestanden'); sys.exit(1 if bad else 0)
asyncio.run(main())
