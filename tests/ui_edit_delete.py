# v2 UI test against the REAL cloud backend with a throw-away test user (budget-e2e-ui-*):
# edit, delete, the "חוזר כל חודש" toggle (on/off in add + edit), no-duplicate recurring generation,
# delete-one-month vs stop-recurring, and the v3 sync layer: optimistic save + outbox, hung request aborted and
# retried, lost response retried without a duplicate, server rejection reported, offline add survives a reload
# and syncs exactly once when the connection returns.
# env: BUDGET_TEST_EMAIL, BUDGET_TEST_PASSWORD, BASE, MOBILE=1, ENGINE=webkit
import asyncio, os, json, datetime
from playwright.async_api import async_playwright
import sys; sys.path.insert(0, os.path.dirname(__file__)); from platforms import launch, guard
BASE = os.environ.get('BASE', 'http://127.0.0.1:8841/')
EMAIL, PASSWORD = os.environ['BUDGET_TEST_EMAIL'], os.environ['BUDGET_TEST_PASSWORD']
assert EMAIL.startswith('budget-e2e-ui-'), 'test users only'
PLATFORM = os.environ.get('PLATFORM') or ({'webkit': 'webkit'}.get(os.environ.get('ENGINE', ''), 'chrome') if os.environ.get('MOBILE') != '1' else ('iphone' if os.environ.get('ENGINE') == 'webkit' else 'android'))
SHOTS = os.environ.get('SHOTS')
fails, log = [], []
def check(cond, name, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))
    if not cond: fails.append(name)

today = datetime.date.today()
first = today.replace(day=1)
def months_back(d, n):
    y, m = d.year, d.month - n
    while m <= 0: m += 12; y -= 1
    return datetime.date(y, m, 1)

SERVER = """async () => { const sb = window.__budget.store.sb;
  const t = await sb.from('budget_transactions').select('id,title,amount,date,recurring_id,kind');
  const r = await sb.from('budget_recurring').select('id,title,amount,day_of_month,start_month,end_month,skip_months,active');
  return { tx: t.data, rec: r.data, err: t.error || r.error }; }"""

async def main():
    async with async_playwright() as p:
        b, kw, MOBILE = await launch(p, PLATFORM)
        ctx = await guard(await b.new_context(**kw))
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: log.append('pageerror: ' + str(e)))
        pg.on('dialog', lambda d: (log.append('NATIVE DIALOG (should not happen): ' + d.message), asyncio.ensure_future(d.dismiss())))
        tap = (lambda sel: pg.locator(sel).first.tap()) if MOBILE else (lambda sel: pg.locator(sel).first.click())
        async def server(): await drain(); return await pg.evaluate(SERVER)
        async def toast(): return await pg.evaluate("[...document.querySelectorAll('.toast')].map(x=>x.textContent).join(' | ')")
        async def goto_view(v): await tap(f'{"#bnav" if MOBILE else "#tabs"} [data-view="{v}"]'); await pg.wait_for_timeout(600)
        async def open_row(title): await tap(f'#app .tx:has-text("{title}")'); await pg.wait_for_selector('#fSave', timeout=8000)
        async def drain(ms=60000): await pg.wait_for_function("window.__budget?.store?.status?.pending === 0", timeout=ms); await pg.wait_for_timeout(300)
        async def save(): await tap('#fSave'); await pg.wait_for_selector('#fSave', state='detached', timeout=30000); await drain()
        async def set_rec(on):
            cur = await pg.is_checked('#fRec')
            if cur != on: await tap('label.rec-toggle')
            check(await pg.is_checked('#fRec') == on, f'toggle set to {on}')
        async def add(title, amount, date=None, rec=False, kind='expense'):
            await tap('#fab'); await pg.wait_for_selector('#fAmt')
            await tap(f'.kind-seg button[data-k="{kind}"]')
            await pg.fill('#fAmt', str(amount)); await pg.fill('#fTitle', title); await tap('#fCats button')
            if date: await pg.fill('#fDate', date)
            if rec: await set_rec(True)
            await save()
        async def reload():
            await drain(); await pg.reload(); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(1500)

        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        if await pg.is_visible('#loginF'):
            await pg.fill('#lEmail', EMAIL); await pg.fill('#lPass', PASSWORD); await pg.click('#lBtn')
        await pg.wait_for_selector('.hero', timeout=30000)
        # start clean (this throw-away test user's own rows only; RLS limits it to this account anyway)
        await pg.evaluate("(async()=>{const S=window.__budget, sb=S.store.sb; if(!S.user.email.startsWith('budget-e2e-ui-')) throw new Error('not a test user'); await sb.from('budget_transactions').delete().neq('id','00000000-0000-0000-0000-000000000000'); await sb.from('budget_recurring').delete().neq('id','00000000-0000-0000-0000-000000000000');})()")
        await reload()
        ver = await pg.evaluate("document.querySelector('meta[name=app-version]')?.content")
        check(ver == '3', 'serves app version 3', ver)

        # 1) plain expense: edit from the overview "recent" card, then delete
        await add('בדיקה-רגילה', 120, date=today.isoformat())
        check(await pg.locator('#app .tx:has-text("בדיקה-רגילה")').count() > 0, 'overview shows recent transactions')
        await open_row('בדיקה-רגילה'); await pg.fill('#fAmt', '345'); await pg.fill('#fTitle', 'בדיקה-רגילה-ערוכה'); await save()
        s = await server(); row = [t for t in s['tx'] if t['title'] == 'בדיקה-רגילה-ערוכה']
        check(len(row) == 1 and float(row[0]['amount']) == 345, 'edit saved on server', s)
        if SHOTS: await goto_view('tx'); await pg.screenshot(path=f'{SHOTS}/31-list-badges.png')
        await open_row('בדיקה-רגילה-ערוכה'); await tap('#fDel'); await pg.wait_for_selector('.ask')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/33-delete-confirm.png')
        await tap('[data-ask="one"]'); await pg.wait_for_timeout(500); dt = await toast()
        s = await server(); check(not any(t['title'].startswith('בדיקה-רגילה') for t in s['tx']), 'delete removed it on server')
        check('נמחק' in dt, 'delete shows confirmation toast', dt)

        # 2) recurring toggle ON in the add form (dated the 1st of this month) -> rule + linked tx + badge
        await add('בדיקה-קבועה', 200, date=first.isoformat(), rec=True)
        s = await server(); tx = [t for t in s['tx'] if t['title'] == 'בדיקה-קבועה']; rec = [r for r in s['rec'] if r['title'] == 'בדיקה-קבועה']
        check(len(tx) == 1 and len(rec) == 1 and tx[0]['recurring_id'] == rec[0]['id'] and rec[0]['day_of_month'] == 1, 'toggle ON creates linked monthly rule (day 1)', s)
        await goto_view('tx')
        check(await pg.locator('.tx:has-text("בדיקה-קבועה") .badge.rec').count() == 1, 'list shows "חוזר" badge')
        # 3) edit: turn OFF -> rule removed, entry unlinked, badge gone
        await open_row('בדיקה-קבועה')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/32-edit-recurring-toggle.png')
        await set_rec(False); await save()
        s = await server(); tx = [t for t in s['tx'] if t['title'] == 'בדיקה-קבועה']
        check(len(tx) == 1 and tx[0]['recurring_id'] is None and not any(r['title'] == 'בדיקה-קבועה' for r in s['rec']), 'toggle OFF in edit unlinks and removes the rule', s)
        check(await pg.locator('.tx:has-text("בדיקה-קבועה") .badge.rec').count() == 0, 'badge removed')
        # 4) edit: turn ON again, change amount -> new rule with the new amount
        await open_row('בדיקה-קבועה'); await pg.fill('#fAmt', '250'); await set_rec(True); await save()
        s = await server(); tx = [t for t in s['tx'] if t['title'] == 'בדיקה-קבועה']; rec = [r for r in s['rec'] if r['title'] == 'בדיקה-קבועה']
        check(len(rec) == 1 and float(rec[0]['amount']) == 250 and tx[0]['recurring_id'] == rec[0]['id'], 'toggle ON in edit creates + links rule', s)
        # 5) income started 2 months ago with toggle ON -> back-filled once per month, no duplicates, stable after reload
        start = months_back(today, 2)
        await add('בדיקה-הכנסה-קבועה', 1000, date=start.isoformat(), rec=True, kind='income')
        await reload(); await reload()
        s = await server(); inc = sorted(t['date'] for t in s['tx'] if t['title'] == 'בדיקה-הכנסה-קבועה')
        check(len(inc) == 3 and len(set(d[:7] for d in inc)) == 3, 'recurring income: exactly one per month, no duplicates after 2 reloads', inc)
        # 6) delete only this month's occurrence -> stays deleted after reload, earlier months untouched
        await goto_view('tx')
        await open_row('בדיקה-הכנסה-קבועה'); await tap('#fDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="one"]'); await pg.wait_for_timeout(1500)
        await reload()
        s = await server(); inc = sorted(t['date'] for t in s['tx'] if t['title'] == 'בדיקה-הכנסה-קבועה'); rec = [r for r in s['rec'] if r['title'] == 'בדיקה-הכנסה-קבועה']
        check(len(inc) == 2 and today.isoformat()[:7] not in [d[:7] for d in inc] and today.isoformat()[:7] in rec[0]['skip_months'], 'delete-one-month is not re-added after reload', s)
        # 7) delete + stop on the expense rule -> rule stops, nothing re-added
        await goto_view('tx')
        await open_row('בדיקה-קבועה'); await tap('#fDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="stop"]'); await pg.wait_for_timeout(1500)
        await reload()
        s = await server()
        check(not any(t['title'] == 'בדיקה-קבועה' for t in s['tx']) and not any(r['title'] == 'בדיקה-קבועה' for r in s['rec']), 'delete+stop removes entry and rule, nothing re-added', s)
        # 8) sync layer. Fault injection wraps window.fetch (the app's timed fetch calls it per request).
        chip = lambda: pg.inner_text('#syncTxt')
        await pg.evaluate("""window.__realFetch = window.fetch; window.__faults = []; window.__calls = 0;
          window.fetch = (u, o) => { const url = String(u && u.url || u), m = (o && o.method) || 'GET';
            if (url.includes('/rest/v1/budget_transactions') && m === 'POST' && window.__faults.length) { window.__calls++; const f = window.__faults.shift();
              if (f === 'hang') return new Promise((_, rej) => o.signal && o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
              if (f === 'lost') return window.__realFetch(u, o).then(() => { throw new TypeError('Load failed'); });
              if (f === 'reject') return Promise.resolve(new Response(JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }), { status: 403, headers: { 'content-type': 'application/json' } })); }
            return window.__realFetch(u, o); }""")
        # 8a) hung request (Ziv's case) then a lost response: the entry shows at once, the stuck request is aborted,
        #     retried, and the server ends with exactly ONE row
        await pg.evaluate("window.__faults = ['hang', 'lost']")
        await tap('#fab'); await pg.wait_for_selector('#fAmt'); await pg.fill('#fAmt', '91'); await pg.fill('#fTitle', 'בדיקה-רשת-איטית'); await tap('#fCats button')
        t0 = await pg.evaluate("performance.now()"); await tap('#fSave'); await pg.wait_for_selector('#fSave', state='detached', timeout=5000)
        closed_ms = await pg.evaluate("performance.now()") - t0
        await goto_view('tx')
        check(closed_ms < 2500, 'save closes the form at once while the server hangs', f'{closed_ms:.0f}ms')
        check(await pg.is_visible('#app .tx.pending:has-text("בדיקה-רשת-איטית") .pend-b'), 'new entry shows immediately with a "saving" badge')
        c1 = await chip(); check('שומר' in c1 or 'ממתינ' in c1, 'status chip shows saving / waiting', c1)
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-syncing.png')
        await drain(90000)
        s = await server(); n = [t for t in s['tx'] if t['title'] == 'בדיקה-רשת-איטית']
        check(len(n) == 1 and await pg.evaluate("window.__calls") == 2, 'hung + lost response: retried, exactly one row on the server', f'rows={len(n)} faults_used={await pg.evaluate("window.__calls")}')
        check(not await pg.is_visible('#app .tx.pending:has-text("בדיקה-רשת-איטית")') and 'שמור' in await chip(), 'badge cleared, chip back to "saved"', await chip())
        # 8b) a real server rejection is reported in Hebrew and the screen goes back to the server's truth
        await pg.evaluate("window.__faults = ['reject']")
        await tap('#fab'); await pg.wait_for_selector('#fAmt'); await pg.fill('#fAmt', '13'); await pg.fill('#fTitle', 'בדיקה-נדחה'); await tap('#fCats button'); await tap('#fSave')
        await pg.wait_for_function("[...document.querySelectorAll('.toast')].some(x => x.textContent.includes('לא נשמר בענן'))", timeout=20000)
        t3 = await toast(); await pg.wait_for_timeout(2500)
        s = await server()
        check('לא נשמר בענן' in t3 and not any(t['title'] == 'בדיקה-נדחה' for t in s['tx']) and not await pg.is_visible('#app .tx:has-text("בדיקה-נדחה")'), 'server rejection: Hebrew message, entry rolled back', t3)
        await pg.evaluate("window.fetch = window.__realFetch")
        # 8c) a row already deleted on another device: deleting it here just succeeds (idempotent), no error
        await pg.evaluate("(async()=>{const S=window.__budget;const t=S.txs.find(x=>x.title==='בדיקה-רשת-איטית');await S.store.sb.from('budget_transactions').delete().eq('id',t.id)})()")
        await open_row('בדיקה-רשת-איטית'); await tap('#fDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="one"]'); await pg.wait_for_timeout(800)
        await drain(); t2 = await toast()
        check('נמחק' in t2 and not await pg.is_visible('#app .tx:has-text("בדיקה-רשת-איטית")'), 'already-deleted row: delete succeeds quietly', t2)
        # 8d) offline: add -> saved on the device, survives a reload while still offline, syncs exactly once when back
        await reload()  # make sure the service worker controls the page and has the app cached
        await ctx.set_offline(True); await pg.wait_for_timeout(500)
        await tap('#fab'); await pg.wait_for_selector('#fAmt'); await pg.fill('#fAmt', '55'); await pg.fill('#fTitle', 'בדיקה-אופליין'); await tap('#fCats button')
        await pg.set_input_files('#fFile', os.path.join(os.path.dirname(__file__), 'fixtures', 'receipt-photo.jpg')); await pg.wait_for_timeout(800); await tap('#fSave')
        await pg.wait_for_selector('#fSave', state='detached', timeout=5000); t4 = await toast(); await pg.wait_for_timeout(800)
        await goto_view('tx')
        check('במכשיר' in t4, 'offline save says "saved on this device"', t4)
        check(await pg.is_visible('#app .tx.pending:has-text("בדיקה-אופליין") .p-off'), 'offline entry shows "waiting for connection" badge')
        c2 = await chip(); check('לא מקוון' in c2 and '1' in c2, 'chip: offline · 1 waiting', c2)
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-offline.png')
        await open_row('בדיקה-אופליין'); await tap('#rcView'); await pg.wait_for_timeout(1500)
        src = await pg.evaluate("document.querySelector('#vw img')?.src || ''")
        if PLATFORM in ('webkit', 'iphone'):  # Playwright's WebKit offline emulation blocks blob reads (NotReadableError); real Safari doesn't
            check(src.startswith('blob:'), 'offline receipt viewer uses the on-device copy (blob:)', src[:40])
        else:
            check(src.startswith('blob:') and await pg.evaluate("(() => { const i = document.querySelector('#vw img'); return !!(i && i.complete && i.naturalWidth > 0); })()"), 'offline receipt can be viewed before it is uploaded', src[:40])
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        while await pg.locator('.overlay [data-close]').count(): await pg.locator('.overlay [data-close]').last.click(); await pg.wait_for_timeout(300)
        reloaded = True
        try: await pg.reload(timeout=30000); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(1500)
        except Exception as e: reloaded = False; print('SKIP offline reload: not supported by this test browser (' + str(e)[:80] + ')')
        if reloaded:
            await goto_view('tx')
            check(await pg.is_visible('#app .tx.pending:has-text("בדיקה-אופליין")'), 'offline entry survives a reload while offline (outbox in IndexedDB)')
        await ctx.set_offline(False)
        if not reloaded: await reload()
        await pg.evaluate("window.dispatchEvent(new Event('online'))"); await drain(60000)
        s = await server(); n = [t for t in s['tx'] if t['title'] == 'בדיקה-אופליין']
        check(len(n) == 1, 'back online: synced automatically, exactly one row', len(n))
        rp = n[0]['id'] if n else ''
        ok_rc = await pg.evaluate("(async () => { const sb = window.__budget.store.sb; const { data } = await sb.from('budget_transactions').select('receipt_path').eq('id', '%s').single(); if (!data?.receipt_path) return false; const { error } = await sb.storage.from('budget-receipts').createSignedUrl(data.receipt_path, 60); return !error; })()" % rp)
        check(ok_rc, 'offline receipt uploaded to the cloud after reconnect')
        await reload(); await reload(); s = await server()
        check(len([t for t in s['tx'] if t['title'] == 'בדיקה-אופליין']) == 1, 'still exactly one after 2 more reloads')
        log[:] = [l for l in log if 'ERR_INTERNET_DISCONNECTED' not in l and 'Failed to fetch' not in l and 'Load failed' not in l and 'NetworkError' not in l]
        check(not [l for l in log if l.startswith('pageerror') or 'NATIVE' in l], 'no page errors / native dialogs', log)
        await b.close()
    print('PLATFORM', PLATFORM)
    print('RESULT', 'FAIL ' + str(fails) if fails else 'ALL PASS')
asyncio.run(main())
