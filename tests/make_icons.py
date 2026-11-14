import os, pathlib as _pl
HERE = _pl.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME_PATH', '/usr/bin/google-chrome')
import asyncio, base64, sys, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(sys.argv[1])
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        pg = await b.new_page()
        await pg.goto((root/'tools/icons.html').as_uri())
        svg = (root/'icons/icon.svg').read_text()
        res = await pg.evaluate("([s]) => renderIcons(s, '#050607', 0.8)", [svg])
        for r in res:
            (root/'icons'/r['name']).write_bytes(base64.b64decode(r['dataUrl'].split(',')[1]))
            print(r['name'])
        await b.close()
asyncio.run(main())
