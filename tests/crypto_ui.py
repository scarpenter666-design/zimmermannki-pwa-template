import os, pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
import asyncio, subprocess, sys, shutil, json, pathlib, re
from playwright.async_api import async_playwright
TPL = pathlib.Path(__file__).resolve().parents[1]
R = []
def check(name, ok, info=''):
    R.append((name, bool(ok), str(info))); print(('OK   ' if ok else 'FAIL ') + name + (f'  ({info})' if info else ''))
async def wait_true(page, expr, timeout=15000):
    import time
    end = time.time() + timeout/1000
    while time.time() < end:
        if await page.evaluate(expr): return
        await asyncio.sleep(0.15)
    raise TimeoutError(expr)
def build(encrypted):
    work = pathlib.Path('/tmp/encsrc'); shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(TPL, work, ignore=shutil.ignore_patterns('.git', '_site'))
    if encrypted:
        c = (work/'app.config.js').read_text(); assert "encryption: 'none'" in c
        (work/'app.config.js').write_text(c.replace("encryption: 'none'", "encryption: 'pin'"))
    out = subprocess.run(['node', 'tools/stamp.mjs', '--out', '_site'], cwd=work, capture_output=True, text=True); assert out.returncode == 0, out.stderr
    dest = pathlib.Path('/tmp/wwwe')/('enc' if encrypted else 'plain'); shutil.rmtree(dest, ignore_errors=True); shutil.copytree(work/'_site', dest)
async def main():
    build(True); build(False)
    srv = subprocess.Popen([sys.executable, str(HERE/'server.py'), '/tmp/wwwe', '8170'], stderr=subprocess.DEVNULL); await asyncio.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            ctx = await b.new_context(viewport={'width': 412, 'height': 915}, accept_downloads=True)
            page = await ctx.new_page(); errors = []; viol = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: (viol if 'Content Security Policy' in m.text else errors).append(m.text) if m.type == 'error' else None)
            U = 'http://localhost:8170/enc/'
            await page.goto(U); await page.wait_for_selector('.cp-lock')
            check('Erststart: Sperrbildschirm mit Einrichtung, App dahinter nicht bedienbar', await page.locator('#cpLockRepeat').count() == 1 and await page.evaluate("getComputedStyle(document.querySelector('.cp-lock')).position === 'fixed'"))
            await page.fill('#cpLockSecret', '123456'); await page.fill('#cpLockRepeat', '123456'); await page.click('#cpLockSubmit')
            check('Einrichtung: 123456 wird abgelehnt', 'leicht zu erraten' in await page.text_content('#cpLockError'))
            await page.fill('#cpLockSecret', 'Mein-Passwort-22'); await page.fill('#cpLockRepeat', 'Mein-Passwort-23'); await page.click('#cpLockSubmit')
            check('Einrichtung: ungleiche Eingaben abgelehnt', 'nicht gleich' in await page.text_content('#cpLockError'))
            await page.fill('#cpLockRepeat', 'Mein-Passwort-22'); await page.click('#cpLockSubmit')
            await page.wait_for_selector('.cp-lock', state='detached'); await page.wait_for_selector('#noteForm')
            await page.fill('#nameInput', 'Sven'); await page.dispatch_event('#nameInput', 'change')
            await page.fill('#noteInput', 'Kontostand STRENGGEHEIM'); await page.click('#noteForm button'); await page.wait_for_selector('#noteList li')
            dump = await page.evaluate("Object.entries(localStorage).map(([k,v]) => k + '=' + v).join('\\n')")
            check('Speicher: Notiz und Name nur verschlüsselt, Passwort nirgends', 'STRENGGEHEIM' not in dump and 'Sven' not in dump and 'Mein-Passwort-22' not in dump and 'hello._crypto' in dump)
            await page.screenshot(path='/tmp/pwa-test-c-app.png')
            # Neustart -> gesperrt
            await page.reload(); await page.wait_for_selector('.cp-lock')
            await page.screenshot(path='/tmp/pwa-test-c-lock.png')
            check('Neustart: gesperrt, Inhalt nicht im Dokument', 'STRENGGEHEIM' not in await page.content() and await page.locator('#cpLockRepeat').count() == 0)
            await page.fill('#cpLockSecret', 'falsch-falsch'); await page.click('#cpLockSubmit'); await wait_true(page, "document.getElementById('cpLockError').textContent.length > 0")
            check('Falsche Eingabe: Meldung, bleibt gesperrt', 'stimmt nicht' in await page.text_content('#cpLockError') and await page.locator('.cp-lock').count() == 1)
            await page.fill('#cpLockSecret', 'Mein-Passwort-22'); await page.click('#cpLockSubmit'); await page.wait_for_selector('#noteList li')
            check('Richtige Eingabe: Daten da', 'STRENGGEHEIM' in await page.text_content('#noteList') and (await page.text_content('#greeting')) == 'Hallo Sven!')
            # Export verschlüsselt
            await page.click('[data-nav="settings"]')
            check('Einstellungen: Karte „Sicherheit“ sichtbar', await page.is_visible('#securityCard'))
            await page.click('#exportBtn'); await page.wait_for_selector('#cpSecretDialog[open]')
            await page.fill('#cpSecretInput', 'kurz'); await page.fill('#cpSecretRepeat', 'kurz'); await page.click('#cpSecretOk')
            check('Export: zu kurzes Backup-Passwort abgelehnt', 'mindestens 8' in await page.text_content('#cpSecretError'))
            await page.fill('#cpSecretInput', 'Backup-Wort-77'); await page.fill('#cpSecretRepeat', 'Backup-Wort-77')
            async with page.expect_download() as dl: await page.click('#cpSecretOk')
            d = await dl.value; path = '/tmp/' + d.suggested_filename; await d.save_as(path); txt = open(path).read(); f = json.loads(txt)
            check('Export: Datei verschlüsselt, ohne Klartext und ohne Passwörter', f['codec'] == 'pbkdf2-aes-gcm' and 'STRENGGEHEIM' not in txt and 'Backup-Wort-77' not in txt and 'Mein-Passwort-22' not in txt and f['app'] == 'hello')
            await page.evaluate("document.querySelector('.cp-notice[data-notice-id=toast]')?.remove()")
            # Daten ändern, dann Import
            await page.click('[data-nav="start"]'); await page.click('#noteList button'); await asyncio.sleep(0.3)
            await page.click('[data-nav="settings"]'); await page.set_input_files('#importFile', path); await page.wait_for_selector('#cpSecretDialog[open]')
            await page.fill('#cpSecretInput', 'Falsches-Wort-1'); await page.click('#cpSecretOk'); await page.wait_for_selector('.cp-notice[data-notice-id="toast"]')
            check('Import: falsches Backup-Passwort abgelehnt, nichts geändert', 'stimmt nicht' in await page.text_content('.cp-notice[data-notice-id="toast"]'))
            await page.evaluate("document.querySelector('.cp-notice[data-notice-id=toast]')?.remove()")
            await page.set_input_files('#importFile', path); await page.wait_for_selector('#cpSecretDialog[open]')
            await page.fill('#cpSecretInput', 'Backup-Wort-77'); await page.click('#cpSecretOk'); await page.wait_for_selector('#confirmDialog[open]')
            async with page.expect_navigation(): await page.click('#confirmYes')
            await page.wait_for_selector('.cp-lock'); await page.fill('#cpLockSecret', 'Mein-Passwort-22'); await page.click('#cpLockSubmit'); await page.wait_for_selector('#noteList li')
            check('Import: richtiges Passwort stellt die Daten wieder her', 'STRENGGEHEIM' in await page.text_content('#noteList'))
            # PIN ändern
            await page.click('[data-nav="settings"]'); await page.click('#changeSecretBtn'); await page.wait_for_selector('#cpSecretDialog[open]')
            await page.fill('#cpSecretInput', 'Mein-Passwort-22'); await page.click('#cpSecretOk'); await asyncio.sleep(0.3); await page.wait_for_selector('#cpSecretRepeat')
            await page.fill('#cpSecretInput', '402917'); await page.fill('#cpSecretRepeat', '402917'); await page.click('#cpSecretOk'); await page.wait_for_selector('.cp-notice[data-notice-id="toast"]')
            check('Ändern auf 6-stelligen PIN klappt', 'Geändert' in await page.text_content('.cp-notice[data-notice-id="toast"]'))
            await page.click('#lockBtn'); await page.wait_for_selector('.cp-lock')
            check('„Jetzt sperren“ zeigt den Sperrbildschirm', True)
            await page.fill('#cpLockSecret', 'Mein-Passwort-22'); await page.click('#cpLockSubmit'); await wait_true(page, "document.getElementById('cpLockError').textContent.length > 0")
            ok_old = await page.locator('.cp-lock').count() == 1
            await page.fill('#cpLockSecret', '402917'); await page.click('#cpLockSubmit'); await page.wait_for_selector('#noteList li')
            check('Altes Passwort gilt nicht mehr, neuer PIN entsperrt', ok_old)
            # Automatisches Sperren (Zeit vorspulen)
            await page.evaluate("(() => { const real = Date.now; Date.now = () => real() + 6 * 60 * 1000; document.dispatchEvent(new Event('visibilitychange')); })()")
            await page.wait_for_selector('.cp-lock', timeout=10000)
            check('Automatische Sperre nach 5 Minuten ohne Bedienung', True)
            # PIN vergessen
            await page.evaluate("localStorage.setItem('ironlog4', 'bleibt')")
            await page.click('#cpLockForgot'); await page.wait_for_selector('#cpSecretDialog[open]')
            await page.fill('#cpSecretInput', 'nein'); await page.click('#cpSecretOk'); await asyncio.sleep(0.4)
            check('PIN vergessen: falsches Bestätigungswort löscht nichts', await page.evaluate("!!localStorage.getItem('hello._crypto')"))
            await page.click('#cpLockForgot'); await page.wait_for_selector('#cpSecretDialog[open]'); await page.fill('#cpSecretInput', 'LÖSCHEN')
            async with page.expect_navigation(): await page.click('#cpSecretOk')
            await page.wait_for_selector('#cpLockRepeat')
            keys = await page.evaluate("Object.keys(localStorage)")
            check('PIN vergessen: nur eigene Daten gelöscht, Einrichtung beginnt neu', keys == ['ironlog4'], str(keys))
            check('Verschlüsselte App: keine Verstöße gegen die Sicherheitsregel, keine Fehler', not viol and not errors, '; '.join(viol + errors)[:300])
            # ── CSP wirkt ──
            res = await page.evaluate("""async () => {
              window.__x = 0; const seen = []; document.addEventListener('securitypolicyviolation', e => seen.push(e.violatedDirective));
              const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.body.appendChild(s);
              const d = document.createElement('div'); d.setAttribute('onclick', 'window.__x = 2'); document.body.appendChild(d); d.click();
              const st = document.createElement('div'); st.setAttribute('style', 'color: rgb(1, 2, 3)'); document.body.appendChild(st);
              const ext = document.createElement('script'); ext.src = 'https://example.com/x.js'; document.body.appendChild(ext);
              const net = await fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'durchgelassen', () => 'blockiert');
              window.__y = 0; try { setTimeout('window.__y = 1', 0); } catch {} await new Promise(r => setTimeout(r, 150)); const ev = window.__y === 0 ? 'blockiert' : 'ausgeführt';
              await new Promise(r => setTimeout(r, 400));
              return { x: window.__x, style: getComputedStyle(st).color, net, ev, seen: [...new Set(seen)].sort() }; }""")
            check('CSP: Inline-Script und Inline-Handler werden nicht ausgeführt', res['x'] == 0)
            check('CSP: Inline-Style-Attribut wirkt nicht', res['style'] != 'rgb(1, 2, 3)', res['style'])
            check('CSP: Verbindung zu fremdem Server blockiert, Code aus Zeichenketten (eval-artig) blockiert', res['net'] == 'blockiert' and res['ev'] == 'blockiert')
            check('CSP: Verstöße werden gemeldet', len(res['seen']) >= 3, ', '.join(res['seen']))
            # ── App ohne Verschlüsselung ──
            p2 = await ctx.new_page(); e2 = []; p2.on('console', lambda m: e2.append(m.text) if m.type == 'error' else None); p2.on('pageerror', lambda e: e2.append(str(e)))
            await p2.goto('http://localhost:8170/plain/'); await p2.wait_for_selector('#noteForm'); await p2.click('[data-nav="settings"]')
            loaded = await p2.evaluate("performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('crypto.js') || n.includes('lock-screen.js') && !n.includes('sw'))")
            check('Ohne Verschlüsselung: kein Sperrbildschirm, Karte „Sicherheit“ versteckt, keine Fehler', await p2.locator('.cp-lock').count() == 0 and not await p2.is_visible('#securityCard') and not e2, '; '.join(e2)[:200])
            await b.close()
    finally: srv.terminate()
    bad = [r for r in R if not r[1]]; json.dump(R, open('/tmp/pwa-test-crypto-ui-results.json', 'w'), ensure_ascii=False)
    print(f'\n{len(R)-len(bad)}/{len(R)} bestanden'); sys.exit(1 if bad else 0)
asyncio.run(main())
