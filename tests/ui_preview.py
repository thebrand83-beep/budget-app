# End-to-end UI run + screenshots. Works in local preview mode (default) or against the
# real cloud backend when BUDGET_TEST_EMAIL / BUDGET_TEST_PASSWORD are set (test user only).
import asyncio, os, sys, json, zipfile, csv, io, pathlib
from playwright.async_api import async_playwright
BASE = os.environ.get('BASE', 'http://127.0.0.1:8841/')
OUT = pathlib.Path(os.environ.get('OUT', '/workspace/budget-app-preview')); OUT.mkdir(parents=True, exist_ok=True)
FX = pathlib.Path(__file__).parent / 'fixtures'
EMAIL, PASSWORD = os.environ.get('BUDGET_TEST_EMAIL'), os.environ.get('BUDGET_TEST_PASSWORD')
errors = []

async def login_or_seed(pg):
    await pg.goto(BASE); await pg.wait_for_timeout(1800)
    if await pg.is_visible('#loginF'):
        await pg.fill('#lEmail', EMAIL); await pg.fill('#lPass', PASSWORD); await pg.click('#lBtn')
        await pg.wait_for_selector('.hero', timeout=30000)
    await pg.wait_for_selector('.hero', timeout=30000)

async def add_tx(pg, kind, amount, title, cat, scope, fixture=None, pay=None, notes=None, recurring=False):
    await pg.click('#fab'); await pg.wait_for_selector('#fAmt')
    await pg.click(f'.kind-seg button[data-k="{kind}"]')
    await pg.fill('#fAmt', str(amount)); await pg.fill('#fTitle', title)
    await pg.click(f'#fCats button:has-text("{cat}")')
    await pg.click(f'#fScope button[data-s="{scope}"]')
    if pay: await pg.select_option('#fPay', pay)
    if notes: await pg.fill('#fNotes', notes)
    if fixture: await pg.set_input_files('#fFile', str(FX / fixture)); await pg.wait_for_timeout(700)
    if recurring: await pg.check('#fRec')

async def run_desktop(b):
    ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, locale='he-IL', accept_downloads=True, timezone_id='Asia/Jerusalem')
    pg = await ctx.new_page()
    pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await login_or_seed(pg)
    if EMAIL:  # cloud: seed the same realistic sample data through the app's own store (RLS applies)
        await pg.evaluate('''async () => { const S = window.__budget; const { sampleData } = await import('./js/defaults.js');
            const d = sampleData(S.cats, new Date().toISOString().slice(0,10));
            for (const c of d.cats) await S.store.saveCategory(c); for (const r of d.recurring) await S.store.saveRecurring(r);
            for (const t of d.txs) await S.store.saveTransaction(t); }''')
        await pg.reload(); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(2500)
    if not EMAIL:  # local preview: realistic sample data
        await pg.click('#btnSettings'); await pg.click('#sDemo'); await pg.wait_for_timeout(2500)
    await pg.screenshot(path=str(OUT / '01-desktop-overview.png'), full_page=True)
    before = await pg.evaluate("() => { const S = window.__budget; return S.txs.length }")
    # expense with a photographed receipt
    await add_tx(pg, 'expense', 1290, 'עדשה 50mm + פילטר', 'ציוד צילום', 'business', 'receipt-photo.jpg', 'אשראי', 'חשבונית 88213')
    await pg.screenshot(path=str(OUT / '02-desktop-add-expense-with-receipt.png'))
    await pg.click('#fSave'); await pg.wait_for_timeout(2500)
    # income with a PDF receipt
    await add_tx(pg, 'income', 4800, 'צילומי בת מצווה – משפחת אברהם', 'חתונות ואירועים', 'business', 'receipt.pdf', 'העברה בנקאית')
    await pg.click('#fSave'); await pg.wait_for_timeout(2500)
    after = await pg.evaluate("() => window.__budget.txs.length")
    assert after == before + 2, (before, after)
    # balance check: UI number == independent recomputation from raw rows
    chk = await pg.evaluate("""() => { const S = window.__budget; const k = S.month;
        const l = S.txs.filter(t => t.date.slice(0,7) === k); const inc = l.filter(t=>t.kind==='income').reduce((a,t)=>a+ +t.amount,0), exp = l.filter(t=>t.kind==='expense').reduce((a,t)=>a+ +t.amount,0);
        return { inc, exp, hero: document.querySelector('.hero .big').textContent, statIn: document.querySelector('.stat.in b').textContent, statOut: document.querySelector('.stat.out b').textContent } }""")
    print('balance check', json.dumps(chk, ensure_ascii=False))
    await pg.screenshot(path=str(OUT / '03-desktop-overview-after-adding.png'), full_page=True)
    # transactions + search
    await pg.click('#tabs [data-view="tx"]'); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(OUT / '04-desktop-transactions.png'), full_page=True)
    await pg.fill('#q', 'עדשה'); await pg.wait_for_timeout(700)
    n = await pg.locator('.tx').count(); assert n >= 1
    await pg.screenshot(path=str(OUT / '05-desktop-search.png'))
    # open the receipt
    await pg.click('.tx:has-text("עדשה 50mm")'); await pg.wait_for_selector('#rcView'); await pg.click('#rcView')
    await pg.wait_for_selector('#vw img', timeout=20000); await pg.wait_for_timeout(800)
    await pg.screenshot(path=str(OUT / '06-desktop-receipt-viewer.png'))
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    await pg.fill('#q', ''); await pg.wait_for_timeout(500)
    # pdf receipt viewer
    await pg.click('.tx:has-text("בת מצווה")'); await pg.click('#rcView'); await pg.wait_for_selector('#vw iframe', timeout=20000); await pg.wait_for_timeout(1500)
    await pg.screenshot(path=str(OUT / '07-desktop-pdf-receipt.png'))
    await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape')
    # budgets, recurring, reports, settings
    for v, name in [('budgets', '08-desktop-budgets'), ('recurring', '09-desktop-recurring'), ('reports', '10-desktop-reports')]:
        await pg.click(f'#tabs [data-view="{v}"]'); await pg.wait_for_timeout(700)
        await pg.screenshot(path=str(OUT / f'{name}.png'), full_page=True)
    # business filter on overview
    await pg.click('#tabs [data-view="overview"]'); await pg.click('[data-scope="business"]'); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(OUT / '11-desktop-business-only.png'), full_page=True)
    await pg.click('[data-scope="all"]')
    # exports
    await pg.click('#tabs [data-view="reports"]'); await pg.wait_for_timeout(400)
    for kind, ext in [('csv', 'csv'), ('xlsx', 'xlsx'), ('zip', 'zip')]:
        async with pg.expect_download(timeout=60000) as d: await pg.click(f'[data-rp="{kind}"]')
        dl = await d.value; p = OUT / f'export-sample.{ext}'; await dl.save_as(p); print('download', kind, dl.suggested_filename, p.stat().st_size)
    rows = list(csv.DictReader(io.StringIO((OUT / 'export-sample.csv').read_text('utf-8-sig'))))
    print('csv rows', len(rows), 'with receipt', sum(1 for r in rows if r['קבלה']))
    print('zip files', zipfile.ZipFile(OUT / 'export-sample.zip').namelist())
    # printable report → PDF (stub window.print, then print-media PDF)
    await pg.evaluate("() => { window.__printed = false; window.print = () => { window.__printed = true } }")
    await pg.click('[data-rp="pdf"]'); await pg.wait_for_function("window.__printed === true", timeout=60000)
    print('rpMsg', await pg.inner_text('#rpMsg'), await pg.evaluate("document.getElementById('printArea').innerHTML.length"))
    await pg.emulate_media(media='print')
    print('print diag', await pg.evaluate("[getComputedStyle(document.getElementById('printArea')).display, document.getElementById('printArea').getBoundingClientRect().height, document.getElementById('printArea').innerHTML.length, document.body.style.overflow, document.querySelectorAll('body>*').length]"))
    await pg.pdf(path=str(OUT / 'report-sample.pdf'), format='A4', print_background=True); await pg.emulate_media(media='screen')
    await pg.click('#btnSettings'); await pg.wait_for_timeout(400)
    await pg.screenshot(path=str(OUT / '12-desktop-settings.png'))
    await pg.keyboard.press('Escape')
    state = await pg.context.storage_state()
    await ctx.close(); return state

async def run_mobile(b, state):
    m = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True, locale='he-IL', storage_state=state, timezone_id='Asia/Jerusalem')
    pg = await m.new_page(); pg.on('console', lambda x: errors.append('m-console: ' + x.text) if x.type == 'error' else None); pg.on('pageerror', lambda e: errors.append('m-pageerror: ' + str(e)))
    if EMAIL: await login_or_seed(pg)
    else:  # IndexedDB isn't in storage_state: re-seed the mobile context
        await pg.goto(BASE); await pg.wait_for_timeout(1500); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.click('#btnSettings'); await pg.click('#sDemo'); await pg.wait_for_timeout(2500)
    await pg.screenshot(path=str(OUT / '20-mobile-overview.png'))
    await pg.screenshot(path=str(OUT / '21-mobile-overview-full.png'), full_page=True)
    await pg.click('#bnav [data-view="tx"]'); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(OUT / '22-mobile-transactions.png'))
    await pg.click('#fab'); await pg.wait_for_selector('#fAmt'); await pg.fill('#fAmt', '86.90'); await pg.fill('#fTitle', 'דלק – פז'); await pg.click('#fCats button:has-text("רכב ודלק")')
    await pg.set_input_files('#fCam', str(FX / 'receipt-photo.jpg')); await pg.wait_for_timeout(800)
    await pg.screenshot(path=str(OUT / '23-mobile-add-with-camera-receipt.png'))
    await pg.click('#fSave'); await pg.wait_for_timeout(3500)
    print('mobile save toast:', await pg.locator('.toast').all_inner_texts(), 'overlays left:', await pg.locator('.overlay').count())
    await pg.click('#bnav [data-view="budgets"]'); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(OUT / '24-mobile-budgets.png'))
    await pg.click('#bnav [data-view="reports"]'); await pg.wait_for_timeout(600)
    await pg.screenshot(path=str(OUT / '25-mobile-reports.png'))
    await m.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        state = await run_desktop(b)
        if not os.environ.get('SKIP_MOBILE'): await run_mobile(b, state)
        await b.close()
    print('ERRORS:', errors or 'none')
asyncio.run(main())
