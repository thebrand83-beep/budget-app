# PDF report export test, one platform per run (PLATFORM=chrome|firefox|webkit|iphone|android). Local ?preview mode:
# sample data, no account, no network, no e-mail. Verifies the REAL flow (no window.print stub):
#  viewer opens -> pages render -> the downloaded file is a valid multi-page A4 PDF (poppler: pdfinfo + rasterise, not blank)
#  -> share path (installed iOS app / phones): navigator.share gets a PDF File and NO download happens
#  -> share cancelled: no error, no fallback download -> share refused: falls back to a download
#  -> render failure shows the error + retry, and retry works -> viewer layout (RTL, no horizontal overflow, buttons per device)
import asyncio, os, sys, subprocess, tempfile, re, json, pathlib
from playwright.async_api import async_playwright
from PIL import Image, ImageStat
sys.path.insert(0, os.path.dirname(__file__)); from platforms import launch, guard
PLATFORM = os.environ.get('PLATFORM', 'chrome'); BASE = os.environ.get('BASE', 'http://127.0.0.1:8841/?preview'); SHOTS = os.environ.get('SHOTS')
fails = []
def check(c, name, extra=''):
    print(('PASS ' if c else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra and not c else '')); 
    if not c: fails.append(name)
SEED = open(os.path.join(os.path.dirname(__file__), 'report_preview.py'), encoding='utf-8').read().split('SEED = """')[1].split('"""')[0]
NO_SHARE = "try { Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }); Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true }); } catch (e) {}"
SHARE = """(mode => {
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  window.__shared = null; navigator.canShare = d => !!(d && d.files && d.files.length && d.files[0].type === 'application/pdf');
  navigator.share = async d => { if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError'); if (window.__shareMode === 'refuse') throw new DOMException('no', 'NotAllowedError');
    const f = d.files[0]; window.__shared = { name: f.name, type: f.type, size: f.size, head: await f.slice(0, 5).text() }; };
})()"""
def pdf_info(path):
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', str(path)], capture_output=True, text=True, check=True).stdout).group(1))
    size = re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', subprocess.run(['pdfinfo', str(path)], capture_output=True, text=True).stdout)
    d = tempfile.mkdtemp(); subprocess.run(['pdftoppm', '-r', '30', '-png', str(path), d + '/p'], check=True)
    sd = [ImageStat.Stat(Image.open(os.path.join(d, f)).convert('L')).stddev[0] for f in sorted(os.listdir(d))]
    return n, (float(size.group(1)), float(size.group(2))), sd

async def goto_reports(pg, mobile):
    await pg.locator(('#bnav' if mobile else '#tabs') + ' [data-view="reports"]').first.click(); await pg.wait_for_timeout(400)
async def open_viewer(pg, mobile, period='year', scope='all'):
    await pg.select_option('#rpPeriod', period); await pg.select_option('#rpScope', scope)
    if not await pg.is_checked('#rpRc'): await pg.locator('#rpRc').click()
    await (pg.locator('[data-rp="pdf"]').first.tap() if mobile else pg.locator('[data-rp="pdf"]').first.click())
    await pg.wait_for_selector('.rv', timeout=15000)
async def ready(pg): await pg.wait_for_selector('#rvDl:not([disabled])', timeout=120000)
async def new_page(b, kw, init):
    ctx = await guard(await b.new_context(**kw))
    for s in init: await ctx.add_init_script(s)
    pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: asyncio.ensure_future(d.dismiss()))
    pg.downloads = []; pg.on('download', lambda d: pg.downloads.append(d))
    await pg.goto(BASE); await pg.wait_for_selector('.hero', timeout=30000)
    await pg.evaluate(SEED, False); await pg.reload(); await pg.wait_for_selector('.hero'); await pg.wait_for_timeout(700)
    return ctx, pg, errs

async def main():
    async with async_playwright() as p:
        b, kw, mobile = await launch(p, PLATFORM)
        tmp = pathlib.Path(tempfile.mkdtemp())
        # ---- A: no share support (desktop browsers) -> real file download
        ctx, pg, errs = await new_page(b, kw, [NO_SHARE]); await goto_reports(pg, mobile)
        check(await pg.is_visible('[data-rp="pdf"]'), 'PDF button visible on the reports screen')
        await open_viewer(pg, mobile); check(await pg.is_visible('.rv .rv-load, .rv #rvSt'), 'viewer opens immediately with a progress state')
        await ready(pg); st = await pg.inner_text('#rvSt'); check('מוכן' in st, 'viewer reaches the ready state', st)
        imgs = await pg.evaluate("[...document.querySelectorAll('#rvPages .rv-pg')].map(i => [i.naturalWidth, i.naturalHeight])")
        check(len(imgs) >= 5 and all(abs(w / h - 794 / 1123) < .01 and w >= 1400 for w, h in imgs), f'{len(imgs)} A4 page images shown, sharp (>=1400px wide)', imgs[:2])
        lay = await pg.evaluate("""() => { const o = document.querySelector('.rv'), bx = o.querySelector('.rv-box'), W = document.documentElement.clientWidth; const bad = [...o.querySelectorAll('button, .rv-t, img')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > W + 1 || r.left < -1); }).length;
          return { dir: document.documentElement.dir, sw: bx.scrollWidth, cw: bx.clientWidth, bad, print: !document.querySelector('#rvPrint').hidden, open: !document.querySelector('#rvOpen').hidden, dl: document.querySelector('#rvDl').getBoundingClientRect().height }; }""")
        check(lay['dir'] == 'rtl' and lay['sw'] <= lay['cw'] + 1 and lay['bad'] == 0, 'viewer: RTL, nothing overflows the screen', lay)
        check(lay['print'] == (not mobile), 'print button only on desktop', lay); check(lay['dl'] >= 40, 'download button is a comfortable tap target', lay)
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-viewer.png')
        async with pg.expect_download(timeout=30000) as dl: await (pg.locator('#rvDl').tap() if mobile else pg.locator('#rvDl').click())
        d = await dl.value; f = tmp / 'a.pdf'; await d.save_as(str(f)); raw = f.read_bytes()
        check(d.suggested_filename.endswith('.pdf') and raw[:5] == b'%PDF-' and raw.rstrip().endswith(b'%%EOF'), 'download is a .pdf file with a valid header/trailer', d.suggested_filename)
        n, (w, h), sd = pdf_info(f)
        check(n == len(imgs) and abs(w - 595.28) < 1 and abs(h - 841.89) < 1, f'PDF opens in poppler: {n} pages = {len(imgs)} viewer pages, A4', (n, w, h))
        check(min(sd) > 8, 'no blank page (every page has content)', sd)
        await pg.keyboard.press('Escape'); await pg.locator('.rv [data-close]').first.click() if await pg.locator('.rv').count() else None
        check(await pg.locator('.rv').count() == 0 and await pg.evaluate("document.getElementById('rpBuild') === null"), 'closing the viewer removes the overlay and the offscreen build host')
        # every period/scope combination renders
        for per, sc in [('month', 'personal'), ('bimonth', 'business'), ('all', 'all')]:
            await open_viewer(pg, mobile, per, sc); await ready(pg); check('מוכן' in await pg.inner_text('#rvSt'), f'variant {per}/{sc} renders'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        # ---- render failure -> error + working retry
        await pg.evaluate("() => { window.__realToBlob = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }; }")
        await open_viewer(pg, mobile, 'month', 'all'); await pg.wait_for_selector('#rvRetry', timeout=60000)
        check('שגיאה' in await pg.inner_text('#rvSt') and await pg.is_disabled('#rvDl'), 'render failure: clear error, download stays disabled')
        await pg.evaluate("() => { HTMLCanvasElement.prototype.toBlob = window.__realToBlob; }")
        await pg.click('#rvRetry'); await ready(pg); check('מוכן' in await pg.inner_text('#rvSt'), 'retry after a failure produces the report')
        check(not errs, 'no page errors', errs); await ctx.close()
        # ---- B: installed-app / phone share path
        ctx, pg, errs = await new_page(b, kw, [SHARE]); await goto_reports(pg, mobile)
        await open_viewer(pg, mobile, 'bimonth', 'all'); await ready(pg)
        check(not await pg.evaluate("!document.querySelector('#rvOpen').hidden"), 'standalone app: no "open in new window" button (popups are blocked there)')
        await (pg.locator('#rvDl').tap() if mobile else pg.locator('#rvDl').click()); await pg.wait_for_function("window.__shared !== null", timeout=15000)
        sh = await pg.evaluate("window.__shared"); check(sh['type'] == 'application/pdf' and sh['name'].endswith('.pdf') and sh['head'] == '%PDF-' and sh['size'] > 20000, 'share sheet receives a real PDF file', sh)
        await pg.wait_for_timeout(500); check(len(pg.downloads) == 0, 'shared: no extra download triggered')
        await pg.evaluate("() => { window.__shareMode = 'cancel'; }"); await (pg.locator('#rvDl').tap() if mobile else pg.locator('#rvDl').click()); await pg.wait_for_timeout(800)
        check(len(pg.downloads) == 0 and await pg.locator('.rv').count() == 1 and not await pg.locator('.rv-err').count(), 'share cancelled: viewer stays, no error, no download')
        await pg.evaluate("() => { window.__shareMode = 'refuse'; }")
        async with pg.expect_download(timeout=30000) as dl: await (pg.locator('#rvDl').tap() if mobile else pg.locator('#rvDl').click())
        d = await dl.value; f = tmp / 'b.pdf'; await d.save_as(str(f)); check(f.read_bytes()[:5] == b'%PDF-', 'share refused by the system: falls back to a download')
        check(not errs, 'no page errors (share path)', errs); await ctx.close(); await b.close()
    print('PLATFORM', PLATFORM, 'RESULT', 'FAIL ' + str(fails) if fails else 'ALL PASS')
    sys.exit(1 if fails else 0)
asyncio.run(main())
