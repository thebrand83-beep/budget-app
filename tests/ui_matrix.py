# Cross-platform matrix against the LIVE site + real cloud (throw-away test user only).
# Covers: login/sign-up screens, Hebrew auth errors, RTL + no horizontal overflow on every screen and sheet,
# receipt upload (photo + PDF) and viewing via signed URL, CSV/XLSX/ZIP/PDF exports, service worker active (budget-v2).
# Sign-up submit is answered by a mocked /auth/v1/signup so no real e-mail is sent to fake addresses.
# env: PLATFORM (chrome|firefox|webkit|iphone|android), BASE, BUDGET_TEST_EMAIL, BUDGET_TEST_PASSWORD, SHOTS (optional dir)
import asyncio, os, sys, json, pathlib, zipfile, io
sys.path.insert(0, os.path.dirname(__file__))
from platforms import launch, guard
from playwright.async_api import async_playwright
BASE = os.environ.get('BASE', 'https://thebrand83-beep.github.io/budget-app/')
EMAIL, PASSWORD = os.environ['BUDGET_TEST_EMAIL'], os.environ['BUDGET_TEST_PASSWORD']
assert EMAIL.startswith('budget-e2e-ui-')
PLATFORM = os.environ.get('PLATFORM', 'chrome')
SHOTS = os.environ.get('SHOTS'); FX = pathlib.Path(__file__).parent / 'fixtures'
fails, log = [], []
def check(cond, name, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:400]}]' if extra and not cond else ''))
    if not cond: fails.append(name)

OVERFLOW = """() => { const W = document.documentElement.clientWidth; const bad = [];
  for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (cs.position === 'fixed' && e.closest('.overlay') == null && !['bnav','fab','tabs'].includes(e.id) && !e.classList.contains('toast')) continue;
    if (e.closest('.chips, .cat-pick, .seg, .table-wrap, .viewer, svg, .tabs, [data-scroll-x]')) continue;  // intentionally scrollable rows / svg internals
    const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push(e.tagName + '.' + (e.className && e.className.baseVal === undefined ? e.className : '') + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); }
  return { W, sw: document.documentElement.scrollWidth, dir: document.documentElement.dir, bad: bad.slice(0, 6) }; }"""

async def main():
    async with async_playwright() as p:
        b, kw, MOBILE = await launch(p, PLATFORM)
        ctx = await guard(await b.new_context(**kw))
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: log.append('pageerror: ' + str(e)))
        pg.on('dialog', lambda d: (log.append('NATIVE DIALOG: ' + d.message), asyncio.ensure_future(d.dismiss())))
        click = (lambda sel: pg.locator(sel).first.tap()) if MOBILE else (lambda sel: pg.locator(sel).first.click())
        async def no_overflow(name):
            o = await pg.evaluate(OVERFLOW)
            check(o['sw'] <= o['W'] + 1 and not o['bad'] and o['dir'] == 'rtl', f'RTL, no horizontal overflow: {name}', o)
            if SHOTS: await pg.screenshot(path=f"{SHOTS}/{PLATFORM}-{name}.png")
        async def view(v):
            await click(f'{"#bnav" if MOBILE else "#tabs"} [data-view="{v}"]'); await pg.wait_for_timeout(700)

        # ---- auth screens
        await pg.goto(BASE); await pg.wait_for_selector('#loginF', timeout=30000); await pg.wait_for_timeout(600)
        check(await pg.evaluate("document.querySelector('meta[name=app-version]').content") == '2', 'live serves version 2')
        await no_overflow('login')
        await pg.fill('#lEmail', EMAIL); await pg.fill('#lPass', 'wrong-password-1'); await click('#lBtn')
        await pg.wait_for_selector('#lMsg .msg', timeout=20000)
        check('שגויים' in await pg.inner_text('#lMsg'), 'wrong password shows Hebrew error', await pg.inner_text('#lMsg'))
        await click('[data-auth="signup"]'); await pg.wait_for_timeout(300)
        await no_overflow('signup')
        await pg.fill('#lEmail', 'mock-signup@example.invalid'); await pg.fill('#lPass', 'abcdefgh123'); await click('#lBtn')
        await pg.wait_for_selector('#lMsg .msg', timeout=20000)
        check('שלחנו לך מייל' in await pg.inner_text('#lMsg'), 'sign-up shows "confirm your e-mail" message (mocked, no e-mail sent)', await pg.inner_text('#lMsg'))
        check(await pg.evaluate("window.__blockedEmailCalls.length") == 1, 'sign-up request stayed in the browser (email guard)')
        await click('[data-auth="login"]'); await pg.wait_for_timeout(300)

        # ---- login (real) and clean slate for this test user
        await pg.fill('#lEmail', EMAIL); await pg.fill('#lPass', PASSWORD); await click('#lBtn')
        await pg.wait_for_selector('.hero', timeout=30000)
        await pg.evaluate("""(async()=>{const S=window.__budget, sb=S.store.sb; if(!S.user.email.startsWith('budget-e2e-ui-')) throw new Error('not a test user');
          const {data}=await sb.from('budget_transactions').select('receipt_path').not('receipt_path','is',null); if(data?.length) await sb.storage.from('budget-receipts').remove(data.map(x=>x.receipt_path));
          await sb.from('budget_transactions').delete().neq('id','00000000-0000-0000-0000-000000000000'); await sb.from('budget_recurring').delete().neq('id','00000000-0000-0000-0000-000000000000');
          const { sampleData } = await import('./js/defaults.js'); const d = sampleData(S.cats, new Date().toISOString().slice(0,10));
          const pk=(o,f)=>Object.fromEntries(f.filter(k=>k in o).map(k=>[k,o[k]]));
          let e1=(await sb.from('budget_recurring').insert(d.recurring.map(r=>pk(r,['id','kind','amount','category_id','scope','title','notes','day_of_month','start_month','end_month','active'])))).error; if(e1) throw e1;
          let e2=(await sb.from('budget_transactions').insert(d.txs.map(t=>pk(t,['id','kind','amount','date','category_id','scope','title','notes','payment_method','recurring_id'])))).error; if(e2) throw e2; })()""")
        await pg.reload(); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(1200)

        # ---- service worker controls the page and uses the v2 cache
        sw = await pg.evaluate("""(async()=>{ if(!('serviceWorker' in navigator)) return 'unsupported'; const r = await navigator.serviceWorker.ready; await new Promise(r=>setTimeout(r,1500)); const keys = await caches.keys(); return { active: !!r.active, controlled: !!navigator.serviceWorker.controller, keys }; })()""")
        check(sw != 'unsupported' and sw['active'] and 'budget-v2' in sw['keys'] and 'budget-v1' not in sw['keys'], 'service worker active with cache budget-v2 only', sw)

        # ---- every screen: RTL and no overflow
        await no_overflow('overview')
        for v in ['tx', 'budgets', 'recurring', 'reports']:
            await view(v); await no_overflow(v)
        await view('tx')
        await click('#app .tx:not(.planned)'); await pg.wait_for_selector('#fSave'); await pg.wait_for_timeout(500); await no_overflow('edit-sheet'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await click('#fab'); await pg.wait_for_selector('#fAmt'); await pg.wait_for_timeout(500); await no_overflow('add-sheet'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await click('#btnSettings'); await pg.wait_for_timeout(600); await no_overflow('settings'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await view('recurring'); await click('#addRec'); await pg.wait_for_selector('#rSave'); await pg.wait_for_timeout(500); await no_overflow('recurring-sheet'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        # ---- receipts: photo + PDF upload, then view through a signed URL
        for fx, title, kind in [('receipt-photo.jpg', 'קבלה-צילום', 'image'), ('receipt.pdf', 'קבלה-PDF', 'pdf')]:
            await click('#fab'); await pg.wait_for_selector('#fAmt')
            await pg.fill('#fAmt', '64.5'); await pg.fill('#fTitle', title); await click('#fCats button')
            await pg.set_input_files('#fFile', str(FX / fx)); await pg.wait_for_timeout(900)
            await click('#fSave'); await pg.wait_for_selector('#fSave', state='detached', timeout=40000); await pg.wait_for_timeout(800)
            path = await pg.evaluate(f"window.__budget.txs.find(t=>t.title==='{title}')?.receipt_path")
            check(bool(path) and path.count('/') == 2, f'{kind} receipt uploaded to the private folder', path)
            await view('tx'); await click(f'#app .tx:has-text("{title}")'); await pg.wait_for_selector('#rcView'); await click('#rcView')
            if kind == 'image':
                await pg.wait_for_selector('#vw img', timeout=20000)
                ok = await pg.wait_for_function("(()=>{const i=document.querySelector('#vw img');return i&&i.complete&&i.naturalWidth>0})()", timeout=20000)
                check(bool(ok), 'photo receipt opens in viewer')
            else:
                await pg.wait_for_selector('#vw iframe', timeout=20000)
                src = await pg.get_attribute('#vw iframe', 'src')
                ct = await pg.evaluate("(async u=>{const r=await fetch(u);return r.status+' '+r.headers.get('content-type')})", src)
                check('/sign/' in src and ct.startswith('200') and 'pdf' in ct, 'PDF receipt opens via signed URL', ct)
            await no_overflow(f'receipt-viewer-{kind}')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
            await pg.evaluate("document.querySelectorAll('#host .overlay').forEach(o=>o.remove())")

        # ---- exports
        await view('reports')
        for k, ext in [('csv', '.csv'), ('xlsx', '.xlsx'), ('zip', '.zip')]:
            async with pg.expect_download(timeout=60000) as dl:
                await click(f'[data-rp="{k}"]')
            d = await dl.value; fp = await d.path(); size = os.path.getsize(fp)
            good = d.suggested_filename.endswith(ext) and size > 200
            if k == 'zip': good = good and len(zipfile.ZipFile(fp).namelist()) >= 2
            if k == 'csv': good = good and 'קבלה-צילום' in open(fp, encoding='utf-8-sig').read()
            check(good, f'export {k.upper()} downloads', f'{d.suggested_filename} {size}')
        await pg.evaluate("window.print = () => { window.__printed = true }")
        await click('[data-rp="pdf"]'); await pg.wait_for_function("window.__printed === true", timeout=60000)
        await pg.wait_for_function("document.querySelector('#rpMsg').textContent.includes('מוכן')", timeout=20000)
        rows = await pg.evaluate("document.querySelectorAll('#printArea tr, .print-area tr, [id*=print] tr').length")
        check(rows > 5, 'PDF report prepared (print dialog) with transaction table', rows)

        check(not [l for l in log if l.startswith('pageerror') or 'NATIVE' in l], 'no page errors / native dialogs', log)
        await b.close()
    print('PLATFORM', PLATFORM, 'RESULT', 'FAIL ' + str(fails) if fails else 'ALL PASS')
asyncio.run(main())
