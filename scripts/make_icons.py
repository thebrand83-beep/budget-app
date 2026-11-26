# Renders assets/icon.svg to the PNG sizes the PWA manifest / iOS need.
import asyncio, pathlib
from playwright.async_api import async_playwright
A = pathlib.Path(__file__).resolve().parent.parent / 'assets'
svg = (A / 'icon.svg').read_text()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for name, size, pad in [('icon-192.png', 192, 0), ('icon-512.png', 512, 0), ('apple-touch-icon.png', 180, 0), ('icon-maskable-512.png', 512, 60)]:
            pg = await b.new_page(viewport={'width': size, 'height': size})
            inner = svg.replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512" rx="0"') if pad or 'apple' in name else svg
            await pg.set_content(f'<html><body style="margin:0;background:#08080a"><div style="width:{size}px;height:{size}px;display:grid;place-items:center"><div style="width:{size-2*pad*size//512}px;height:{size-2*pad*size//512}px">{inner.replace("<svg ", "<svg width=100% height=100% ")}</div></div></body></html>')
            await pg.screenshot(path=str(A / name), omit_background=False)
        await b.close()
asyncio.run(main())
