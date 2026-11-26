import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8841/'); await pg.wait_for_timeout(1500)
        await pg.click('#btnSettings'); await pg.wait_for_timeout(300)
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.click('#sDemo'); await pg.wait_for_timeout(2500)
        await pg.screenshot(path='/tmp/b1.png', full_page=True)
        print('errors:', errs)
        await b.close()
asyncio.run(main())
