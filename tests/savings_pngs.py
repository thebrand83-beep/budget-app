# PNG previews of the savings area in LOCAL preview mode (sample data, no account, no network).
# Output: OUT (default /workspace/budget-app-preview/savings): desktop-* (1440x900) and iphone-* (iPhone 15) + the PDF savings page.
import asyncio, os, sys, subprocess, pathlib, re
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__)); from platforms import launch, guard
BASE = os.environ.get('BASE', 'http://127.0.0.1:8841/?preview'); OUT = pathlib.Path(os.environ.get('OUT', '/workspace/budget-app-preview/savings')); OUT.mkdir(parents=True, exist_ok=True)
SEED = open(os.path.join(os.path.dirname(__file__), 'report_preview.py'), encoding='utf-8').read().split('SEED = """')[1].split('"""')[0]
async def run(plat, tag):
    async with async_playwright() as p:
        b, kw, mobile = await launch(p, plat); ctx = await guard(await b.new_context(**kw)); pg = await ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        tap = (lambda s: pg.locator(s).first.tap()) if mobile else (lambda s: pg.locator(s).first.click())
        nav = '#bnav' if mobile else '#tabs'
        await pg.goto(BASE); await pg.wait_for_selector('.hero', timeout=30000)
        await pg.evaluate(SEED, False); await pg.reload(); await pg.wait_for_selector('.hero'); await pg.wait_for_timeout(1000)
        await pg.evaluate("document.querySelector('.banner, .preview-note')?.remove()")
        shot = lambda n, **k: pg.screenshot(path=str(OUT / f'{tag}-{n}.png'), **k)
        await pg.wait_for_timeout(5500); await shot('1-overview')
        await tap(f'{nav} [data-view="savings"]'); await pg.wait_for_timeout(1200)
        await shot('2-savings')
        if mobile:
            await pg.evaluate("document.querySelector('.goals').scrollIntoView({block:'start'}), window.scrollBy(0, -110)"); await pg.wait_for_timeout(600); await shot('3-goals')
            await pg.evaluate("document.querySelector('#app .card.span2:last-child')?.scrollIntoView({block:'start'}), window.scrollBy(0, -110)"); await pg.wait_for_timeout(500); await shot('4-activity')
        else:
            await shot('2b-savings-full', full_page=True)
        await pg.evaluate("window.scrollTo(0,0)")
        await tap('.goal [data-gedit]'); await pg.wait_for_selector('#gName'); await pg.wait_for_timeout(500); await shot('5-goal-form')
        await pg.evaluate("document.querySelector('#gAuto')?.closest('.sheet')?.scrollTo?.(0, 9999)"); await pg.wait_for_timeout(300); await shot('5b-goal-form-bottom')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        if await pg.locator('#gName').count(): await pg.evaluate("document.querySelector('.overlay')?.click()")
        await pg.wait_for_timeout(400)
        await tap('#svAddEntry'); await pg.wait_for_selector('#eAmt'); await pg.fill('#eAmt', '750'); await pg.wait_for_timeout(300); await shot('6-entry-form')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        if await pg.locator('#eAmt').count(): await pg.evaluate("document.querySelector('.overlay')?.click()")
        await pg.wait_for_timeout(400)
        # the PDF: find the page with the savings section
        await pg.locator(f'{nav} [data-view="reports"]').first.click() if not mobile else await pg.locator(f'{nav} [data-view="reports"]').first.tap()
        await pg.wait_for_timeout(400); await pg.select_option('#rpPeriod', 'month'); await pg.select_option('#rpScope', 'all')
        if await pg.is_checked('#rpRc'): await pg.locator('#rpRc').click()
        await pg.evaluate("window.__sp = -1; window.__t = setInterval(() => { const ps = [...document.querySelectorAll('#rpBuild .rp-page')]; const i = ps.findIndex(x => x.innerText.includes('מטרות חיסכון')); if (i >= 0) window.__sp = i; }, 30)")
        await tap('[data-rp="pdf"]'); await pg.wait_for_selector('#rvDl:not([disabled])', timeout=120000)
        sp = await pg.evaluate("clearInterval(window.__t), window.__sp")
        async with pg.expect_download(timeout=30000) as dl: await pg.click('#rvDl')
        d = await dl.value; path = OUT / f'{tag}-report.pdf'; await d.save_as(str(path))
        if sp >= 0:
            subprocess.run(['pdftoppm', '-r', '110', '-png', '-f', str(sp + 1), '-l', str(sp + 1), str(path), str(OUT / f'{tag}-7-pdf-savings')], check=True)
        print(tag, 'savings pdf page', sp + 1, 'errors', errs)
        await b.close()
asyncio.run(run(os.environ.get('PLATFORM', 'chrome'), os.environ.get('TAG', 'desktop')))
