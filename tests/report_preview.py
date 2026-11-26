# Generates PDFs + PNG previews of every report variant (period x scope, with/without receipts, small/large data)
# in LOCAL preview mode (sample data, no account, no network). Output: OUT (default /workspace/budget-app-preview/reports)
import asyncio, os, sys, subprocess, pathlib
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__)); from platforms import launch, guard
BASE = os.environ.get('BASE', 'http://127.0.0.1:8841/?preview'); OUT = pathlib.Path(os.environ.get('OUT', '/workspace/budget-app-preview/reports')); OUT.mkdir(parents=True, exist_ok=True)
PERIODS = {'month': 'חודש', 'bimonth': 'חודשיים', 'year': 'שנה', 'all': 'הכל'}; SCOPES = {'business': 'עסקי', 'all': 'עסקי+פרטי', 'personal': 'פרטי'}
SEED = """async (big) => { const S = window.__budget; const { sampleData } = await import('./js/defaults.js');
  const d = sampleData(S.cats, new Date().toISOString().slice(0, 10));
  for (const r of d.recurring) await S.store.saveRecurring(r);
  for (const g of d.goals) await S.store.saveGoal(g); for (const e of d.sentries) await S.store.saveSavingsEntry(e);
  const bizExp = d.txs.filter(t => t.kind === 'expense' && t.scope === 'business').slice(0, 7);
  const files = [['tests/fixtures/receipt-photo.jpg', 'receipt-photo.jpg', 'image/jpeg'], ['tests/fixtures/receipt.pdf', 'receipt.pdf', 'application/pdf']];
  for (const [i, t] of bizExp.entries()) { const [u, n, ty] = files[i % 3 === 2 ? 1 : 0]; const b = await (await fetch(u)).blob(); Object.assign(t, await S.store.uploadReceipt(t.id, new File([b], n, { type: ty }))); }
  for (const t of d.txs) await S.store.saveTransaction(t);
  if (big) { let seed = 11; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280; const ex = S.cats.filter(c => c.kind === 'expense'), inc = S.cats.filter(c => c.kind === 'income'); const base = new Date();
    for (let i = 0; i < 260; i++) { const dt = new Date(base.getFullYear(), base.getMonth(), 1 + Math.floor(rnd() * 27)); dt.setMonth(dt.getMonth() - Math.floor(rnd() * 11)); const isInc = rnd() < .25; const c = (isInc ? inc : ex)[Math.floor(rnd() * (isInc ? inc : ex).length)];
      await S.store.saveTransaction({ id: crypto.randomUUID(), kind: isInc ? 'income' : 'expense', amount: Math.round((isInc ? 400 + rnd() * 6000 : 15 + rnd() * 900) * 100) / 100, date: dt.toISOString().slice(0, 10), category_id: c.id, scope: rnd() < .7 ? 'business' : 'personal', title: (isInc ? 'עבודה ללקוח ' : 'הוצאה: ') + c.name + ' ' + (i + 1), notes: rnd() < .15 ? 'הערה לדוגמה לפירוט הדוח' : null, payment_method: ['אשראי', 'העברה בנקאית', 'מזומן', 'ביט / פייבוקס'][Math.floor(rnd() * 4)] }); } } }"""
async def make(pg, ctx, period, scope, rc, tag, mobile=False):
    await pg.locator(('#bnav' if mobile else '#tabs') + ' [data-view="reports"]').first.click(); await pg.wait_for_timeout(400)
    await pg.select_option('#rpPeriod', period); await pg.select_option('#rpScope', scope)
    if await pg.is_checked('#rpRc') != rc: await pg.locator('#rpRc').click()
    await pg.click('[data-rp="pdf"]'); await pg.wait_for_selector('#rvDl:not([disabled])', timeout=120000)
    async with pg.expect_download(timeout=30000) as dl: await pg.click('#rvDl')
    d = await dl.value; path = OUT / f'{tag}.pdf'; await d.save_as(str(path)); st = await pg.inner_text('#rvSt')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    return path, st
async def main():
    plat = os.environ.get('PLATFORM', 'chrome')
    async with async_playwright() as p:
        b, kw, mobile = await launch(p, plat); ctx = await guard(await b.new_context(**kw)); pg = await ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE); await pg.wait_for_selector('.hero', timeout=30000)
        await pg.evaluate(SEED, os.environ.get('BIG') == '1'); await pg.reload(); await pg.wait_for_selector('.hero'); await pg.wait_for_timeout(800)
        only = os.environ.get('ONLY')
        for period in PERIODS:
            for scope in SCOPES:
                tag = os.environ.get('PREFIX', '') + f'{period}-{scope}'
                if only and only != f'{period}-{scope}': continue
                path, st = await make(pg, ctx, period, scope, True, tag, mobile); print(tag, st)
        if not only:
            path, st = await make(pg, ctx, 'year', 'business', False, os.environ.get('PREFIX', '') + 'year-business-no-receipts', mobile); print('no-receipts', st)
        print('pageerrors', errs)
        await b.close()
asyncio.run(main())
