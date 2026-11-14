import os, pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
import asyncio, json, shutil, subprocess, sys, pathlib, re
from playwright.async_api import async_playwright
TPL = pathlib.Path(__file__).resolve().parents[1]
WWW = pathlib.Path('/tmp/pwa-test-www'); APP = WWW/'hello'
BASE = 'http://localhost:8123/hello/'
def deploy():
    out = subprocess.run(['node', str(TPL/'tools/stamp.mjs'), '--out', '_site'], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    shutil.rmtree(APP, ignore_errors=True); shutil.copytree(TPL/'_site', APP)
    return re.search(r'Version (\S+)', out.stdout).group(1)
results = []
def check(name, ok, info=''):
    results.append((name, ok, info)); print(('OK   ' if ok else 'FAIL ') + name + (f'  [{info}]' if info else ''))

async def wait_true(page, expr, timeout=15000):
    """Wie wait_for_function, aber ohne eval (funktioniert mit strenger CSP)."""
    import time as _t
    end = _t.time() + timeout / 1000
    while _t.time() < end:
        if await page.evaluate(expr): return
        await asyncio.sleep(0.15)
    raise TimeoutError(expr)
async def main():
    WWW.mkdir(exist_ok=True)
    vA = deploy()
    srv = subprocess.Popen([sys.executable, str(HERE/'server.py'), str(WWW), '8123'], stderr=subprocess.DEVNULL)
    await asyncio.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            ctx = await b.new_context(viewport={'width': 412, 'height': 915})
            page = await ctx.new_page()
            errors = []; navs = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
            page.on('framenavigated', lambda f: navs.append(f.url) if f == page.main_frame else None)
            # Mitbewohner auf derselben Origin simulieren
            await page.goto(BASE)
            await page.evaluate("""async () => { localStorage.setItem('ironlog4','{"log":[1]}'); localStorage.setItem('jc-lernapp-claude-v2','{"schemaVersion":2}'); const c = await caches.open('nutricoach-v13'); await c.put('/x', new Response('x')); await (await caches.open('hello-world@1')).put('/x', new Response('x')); await (await caches.open('hello-v7')).put('/x', new Response('x')); }""")
            await wait_true(page, "navigator.serviceWorker.controller !== null")
            await asyncio.sleep(1.0)
            check('Erstbesuch: SW aktiv, kein ungefragter Reload', len(navs) == 1, f'{len(navs)} Navigation(en)')
            check('Keine Konsolenfehler', not errors, '; '.join(errors)[:300])
            check('Kein Update-Banner beim Erstbesuch', await page.locator('.cp-notice[data-notice-id="update"]').count() == 0)
            # Bedienung
            await page.fill('#nameInput', 'Test'); await page.dispatch_event('#nameInput', 'change')
            await page.fill('#noteInput', 'Erste Notiz'); await page.click('#noteForm button')
            await page.wait_for_selector('#noteList li')
            check('Notiz gespeichert unter hello.notes', 'Erste Notiz' in (await page.evaluate("localStorage.getItem('hello.notes')") or ''))
            ver = await page.evaluate("self.APP_BUILD.version")
            check('Version A läuft', ver == vA, ver)
            keys = await page.evaluate("caches.keys()")
            check('Cache heißt hello@<version>', f'hello@{vA}' in keys, str(keys))
            # Offline
            await ctx.set_offline(True)
            await page.reload(); await page.wait_for_selector('#noteList li')
            check('Offline: App startet, Daten da', (await page.text_content('#greeting')) == 'Hallo Test!')
            status = await page.evaluate("fetch('./gibt-es-nicht.js').then(r => r.status, e => 'error')")
            check('Offline: fehlendes Script liefert Fehler statt index.html', status == 'error', str(status))
            fonts_ok = await page.evaluate("fetch('./fonts/dm-sans-latin-variable.woff2').then(r => r.ok, () => false)")
            check('Offline: Schrift kommt aus dem Cache', fonts_ok)
            await ctx.set_offline(False)
            # Update A -> B
            idx = TPL/'index.html'; orig = idx.read_text()
            try:
                idx.write_text(orig.replace('<h2>Notizen</h2>', '<h2>Notizen B</h2>'))
                vB = deploy()
            finally:
                idx.write_text(orig)
            check('Version B hat andere Kennung', vB != vA, f'{vA} -> {vB}')
            await page.reload(); await page.wait_for_selector('#noteList li')
            navs.clear()
            await page.click('[data-nav="settings"]'); await page.click('#checkUpdateBtn')
            await page.wait_for_selector('.cp-notice[data-notice-id="update"]', timeout=15000)
            check('Banner erscheint nach Deploy von B', True)
            check('Vor Klick läuft noch A, kein Reload', (await page.evaluate("self.APP_BUILD.version")) == vA and len(navs) == 0)
            # canUpdateNow: Text im Notizfeld blockiert
            await page.click('[data-nav="start"]'); await page.fill('#noteInput', 'tippe gerade')
            await page.click('.cp-notice[data-notice-id="update"] button')
            await asyncio.sleep(0.5)
            check('Update wird aufgeschoben, solange getippt wird', 'nicht möglich' in await page.text_content('.cp-notice[data-notice-id="update"]'))
            await page.fill('#noteInput', '')
            async with page.expect_navigation(timeout=15000):
                await page.click('.cp-notice[data-notice-id="update"] button')
            await page.wait_for_selector('#noteList li')
            check('Nach Klick läuft B', (await page.evaluate("self.APP_BUILD.version")) == vB)
            check('Neue Seite ist B', 'Notizen B' in await page.content())
            check('Daten haben das Update überlebt', 'Erste Notiz' in await page.text_content('#noteList'))
            await asyncio.sleep(0.5)
            keys = await page.evaluate("caches.keys()")
            check('Eigene alte Caches (auch hello-v7) gelöscht, fremde (nutricoach-v13, hello-world@1) bleiben', f'hello@{vA}' not in keys and f'hello@{vB}' in keys and 'nutricoach-v13' in keys and 'hello-world@1' in keys and 'hello-v7' not in keys, str(keys))
            # Reset: nur eigene Keys
            await page.click('[data-nav="settings"]'); await page.click('#resetBtn'); 
            async with page.expect_navigation(): await page.click('#confirmYes')
            ls = await page.evaluate("Object.keys(localStorage).sort()")
            check('Reset lässt fremde Keys stehen', 'ironlog4' in ls and 'jc-lernapp-claude-v2' in ls and 'hello.notes' not in ls, str(ls))
            check('Reset legt Wiederherstellungspunkt an', 'hello._restorepoint' in ls)
            await page.click('[data-nav="settings"]'); await page.click('#undoBtn')
            async with page.expect_navigation(): await page.click('#confirmYes')
            await page.wait_for_selector('#noteList li')
            check('Rückgängig holt die Daten zurück', 'Erste Notiz' in await page.text_content('#noteList'))
            # Manifest
            man = await page.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
            sizes = {(i['sizes'], i['purpose']) for i in man['icons']}
            check('Manifest: 192, 512, maskable 512', {('192x192','any'),('512x512','any'),('512x512','maskable')} <= sizes)
            await page.screenshot(path='/tmp/pwa-test-shot-start.png')
            await page.click('[data-nav="settings"]'); await page.screenshot(path='/tmp/pwa-test-shot-settings.png')
            check('Keine Fehler im ganzen Lauf', not errors, '; '.join(errors)[:400])
            await b.close()
    finally:
        srv.terminate()
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results)-len(bad)}/{len(results)} bestanden'); sys.exit(1 if bad else 0)
asyncio.run(main())
