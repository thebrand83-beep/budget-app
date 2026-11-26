# v2 UI test against the REAL cloud backend with a throw-away test user (budget-e2e-ui-*):
# edit, delete, the "חוזר כל חודש" toggle (on/off in add + edit), no-duplicate recurring generation,
# delete-one-month vs stop-recurring, and visible Hebrew errors (network failure, already-deleted row).
# env: BUDGET_TEST_EMAIL, BUDGET_TEST_PASSWORD, BASE, MOBILE=1, ENGINE=webkit
import asyncio, os, json, datetime
from playwright.async_api import async_playwright
import sys; sys.path.insert(0, os.path.dirname(__file__)); from platforms import launch
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
        ctx = await b.new_context(**kw)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: log.append('pageerror: ' + str(e)))
        pg.on('dialog', lambda d: (log.append('NATIVE DIALOG (should not happen): ' + d.message), asyncio.ensure_future(d.dismiss())))
        tap = (lambda sel: pg.locator(sel).first.tap()) if MOBILE else (lambda sel: pg.locator(sel).first.click())
        async def server(): return await pg.evaluate(SERVER)
        async def toast(): return await pg.evaluate("[...document.querySelectorAll('.toast')].map(x=>x.textContent).join(' | ')")
        async def goto_view(v): await tap(f'{"#bnav" if MOBILE else "#tabs"} [data-view="{v}"]'); await pg.wait_for_timeout(600)
        async def open_row(title): await tap(f'#app .tx:has-text("{title}")'); await pg.wait_for_selector('#fSave', timeout=8000)
        async def save(): await tap('#fSave'); await pg.wait_for_selector('#fSave', state='detached', timeout=30000); await pg.wait_for_timeout(700)
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
            await pg.reload(); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(1500)

        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        if await pg.is_visible('#loginF'):
            await pg.fill('#lEmail', EMAIL); await pg.fill('#lPass', PASSWORD); await pg.click('#lBtn')
        await pg.wait_for_selector('.hero', timeout=30000)
        # start clean (this throw-away test user's own rows only; RLS limits it to this account anyway)
        await pg.evaluate("(async()=>{const S=window.__budget, sb=S.store.sb; if(!S.user.email.startsWith('budget-e2e-ui-')) throw new Error('not a test user'); await sb.from('budget_transactions').delete().neq('id','00000000-0000-0000-0000-000000000000'); await sb.from('budget_recurring').delete().neq('id','00000000-0000-0000-0000-000000000000');})()")
        await reload()
        ver = await pg.evaluate("document.querySelector('meta[name=app-version]')?.content")
        check(ver == '2', 'serves app version 2', ver)

        # 1) plain expense: edit from the overview "recent" card, then delete
        await add('בדיקה-רגילה', 120, date=today.isoformat())
        check(await pg.locator('#app .tx:has-text("בדיקה-רגילה")').count() > 0, 'overview shows recent transactions')
        await open_row('בדיקה-רגילה'); await pg.fill('#fAmt', '345'); await pg.fill('#fTitle', 'בדיקה-רגילה-ערוכה'); await save()
        s = await server(); row = [t for t in s['tx'] if t['title'] == 'בדיקה-רגילה-ערוכה']
        check(len(row) == 1 and float(row[0]['amount']) == 345, 'edit saved on server', s)
        if SHOTS: await goto_view('tx'); await pg.screenshot(path=f'{SHOTS}/31-list-badges.png')
        await open_row('בדיקה-רגילה-ערוכה'); await tap('#fDel'); await pg.wait_for_selector('.ask')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/33-delete-confirm.png')
        await tap('[data-ask="one"]'); await pg.wait_for_timeout(1500)
        s = await server(); check(not any(t['title'].startswith('בדיקה-רגילה') for t in s['tx']), 'delete removed it on server')
        check('נמחק' in await toast(), 'delete shows confirmation toast')

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
        # 8) errors are visible in Hebrew: network failure on save, and a row already deleted elsewhere
        await add('בדיקה-שגיאה', 77, date=today.isoformat())
        await goto_view('tx')
        await pg.evaluate("window.__realFetch = window.fetch; window.fetch = (u, o) => (String(u).includes('/rest/v1/budget_transactions') && o && /POST|PATCH|DELETE/.test(o.method || '')) ? Promise.reject(new TypeError('Failed to fetch')) : window.__realFetch(u, o)")
        await open_row('בדיקה-שגיאה'); await pg.fill('#fAmt', '78'); await tap('#fSave'); await pg.wait_for_timeout(2500)
        t1 = await toast(); check('אין חיבור' in t1 and await pg.is_visible('#fSave') and await pg.is_enabled('#fSave'), 'network error shows Hebrew message, form stays open', t1)
        await pg.evaluate("window.fetch = window.__realFetch")
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/34-error-message.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        await pg.evaluate("(async()=>{const S=window.__budget;const t=S.txs.find(x=>x.title==='בדיקה-שגיאה');await S.store.sb.from('budget_transactions').delete().eq('id',t.id)})()")
        await open_row('בדיקה-שגיאה'); await tap('#fDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="one"]'); await pg.wait_for_timeout(2000)
        t2 = await toast(); check('כבר לא קיימת' in t2, 'already-deleted row shows Hebrew message (not silent)', t2)
        check(not [l for l in log if l.startswith('pageerror') or 'NATIVE' in l], 'no page errors / native dialogs', log)
        await b.close()
    print('PLATFORM', PLATFORM)
    print('RESULT', 'FAIL ' + str(fails) if fails else 'ALL PASS')
asyncio.run(main())
