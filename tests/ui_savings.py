# v5 savings area, UI test against the REAL cloud backend with a throw-away test user (budget-e2e-ui-*), one platform per run.
# goal create (template + opening balance + monthly need + auto deposit), deposit / withdraw (over-withdraw blocked), the
# overview "left" allocation (deposits are NOT expenses), automatic monthly deposits generated exactly once (also after
# reloads), deleting an auto deposit skips that month, edit + delete, goal delete cascades, business/personal tag filter,
# offline deposit -> exactly one server row after reconnect, savings in the PDF report, layout (RTL, no overflow).
# env: BUDGET_TEST_EMAIL, BUDGET_TEST_PASSWORD, BASE, PLATFORM, SHOTS
import asyncio, os, re, datetime, sys
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__)); from platforms import launch, guard
BASE = os.environ.get('BASE', 'http://127.0.0.1:8841/')
EMAIL, PASSWORD = os.environ['BUDGET_TEST_EMAIL'], os.environ['BUDGET_TEST_PASSWORD']
assert EMAIL.startswith('budget-e2e-ui-'), 'test users only'
PLATFORM = os.environ.get('PLATFORM', 'chrome'); SHOTS = os.environ.get('SHOTS')
fails, log = [], []
def check(cond, name, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{str(extra)[:300]}]' if extra and not cond else ''))
    if not cond: fails.append(name)
today = datetime.date.today(); month = today.isoformat()[:7]
def add_months(d, n):
    y, m = d.year, d.month - 1 + n; return datetime.date(y + m // 12, m % 12 + 1, 1)
num = lambda s: float(re.sub(r'[^\d.\-]', '', s.replace('−', '-').replace('\u200e', '').replace('\u200f', '')) or 0)

SERVER = """async () => { const sb = window.__budget.store.sb;
  const g = await sb.from('budget_savings_goals').select('*'); const e = await sb.from('budget_savings_entries').select('*').order('date');
  const t = await sb.from('budget_transactions').select('id,kind,amount'); return { goals: g.data, entries: e.data, tx: t.data, err: g.error || e.error || t.error }; }"""
CLEAN = """async () => { const S = window.__budget, sb = S.store.sb; if (!S.user.email.startsWith('budget-e2e-ui-')) throw new Error('not a test user');
  const z = '00000000-0000-0000-0000-000000000000';
  await sb.from('budget_savings_goals').delete().neq('id', z); await sb.from('budget_transactions').delete().neq('id', z); await sb.from('budget_recurring').delete().neq('id', z); }"""

async def main():
    async with async_playwright() as p:
        b, kw, MOBILE = await launch(p, PLATFORM)
        ctx = await guard(await b.new_context(**kw))
        await ctx.add_init_script("""if (sessionStorage.getItem('__nosav')) { const f = window.fetch.bind(window); window.fetch = (u, o) => { const url = String((u && u.url) || u);
          if (url.includes('budget_savings_')) return Promise.resolve(new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.budget_savings_goals' in the schema cache" }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
          return f(u, o); }; }""")
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: log.append('pageerror: ' + str(e)))
        pg.on('dialog', lambda d: (log.append('NATIVE DIALOG: ' + d.message), asyncio.ensure_future(d.dismiss())))
        tap = (lambda sel: pg.locator(sel).first.tap()) if MOBILE else (lambda sel: pg.locator(sel).first.click())
        async def server(): await drain(); return await pg.evaluate(SERVER)
        async def toast(): return await pg.evaluate("[...document.querySelectorAll('.toast')].map(x=>x.textContent).join(' | ')")
        async def goto_view(v): await tap(f'{"#bnav" if MOBILE else "#tabs"} [data-view="{v}"]'); await pg.wait_for_timeout(700)
        async def drain(ms=60000): await pg.wait_for_function("window.__budget?.store?.status?.pending === 0", timeout=ms); await pg.wait_for_timeout(300)
        async def reload():
            await drain(); await pg.reload(); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(1800); await drain()
        async def overflow(): return await pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
        async def hero_left(): await goto_view('overview'); return num(await pg.inner_text('.hero .big'))
        async def entry_form(goal_name, kind, amount, note=None):
            await tap('#svAddEntry'); await pg.wait_for_selector('#eAmt')
            await tap(f'#eKind button[data-k="{kind}"]'); await pg.fill('#eAmt', str(amount))
            await tap(f'#eGoals button:has-text("{goal_name}")')
            if note: await pg.fill('#eNote', note)
            await tap('#eSave')

        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        if await pg.is_visible('#loginF'):
            await pg.fill('#lEmail', EMAIL); await pg.fill('#lPass', PASSWORD); await pg.click('#lBtn')
        await pg.wait_for_selector('.hero', timeout=30000)
        await pg.evaluate(CLEAN); await reload()
        check(await pg.evaluate("document.querySelector('meta[name=app-version]')?.content") == '5', 'serves app version 5')

        # baseline: income 10000 + expense 2000 this month, written by the app's own store
        await pg.evaluate("""async (d) => { const S = window.__budget; const cat = S.cats.find(c => c.kind === 'expense'), ci = S.cats.find(c => c.kind === 'income');
          await S.store.saveTransaction({ id: crypto.randomUUID(), kind: 'income', amount: 10000, date: d, category_id: ci?.id || null, scope: 'personal', title: 'בדיקה-הכנסה' });
          await S.store.saveTransaction({ id: crypto.randomUUID(), kind: 'expense', amount: 2000, date: d, category_id: cat?.id || null, scope: 'personal', title: 'בדיקה-הוצאה' }); }""", today.isoformat())
        await reload()
        base_left = await hero_left(); check(base_left == 8000, 'baseline: left this month = 10,000 - 2,000 = 8,000', base_left)

        # 1) empty state + template
        await goto_view('savings')
        check(await pg.is_visible('#svAddGoal') and await pg.locator('[data-tpl]').count() == 4, 'empty state: create button + 4 quick-start templates')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-sv-empty.png')
        check(await overflow(), 'empty savings screen does not overflow')
        await tap('[data-tpl="1"]'); await pg.wait_for_selector('#gName')
        check(await pg.input_value('#gName') == 'חופשה', 'template prefills the name')
        await pg.fill('#gName', 'קרן-בדיקה'); await pg.fill('#gTarget', '6000')
        await pg.fill('#gDate', add_months(today, 5).replace(day=15).isoformat()); await pg.fill('#gOpen', '1000')
        await pg.wait_for_timeout(300)
        need = await pg.inner_text('#gNeed'); check('לבדוק'  not in need and re.search(r'\d', need) is not None, 'form shows the monthly amount needed for the target date', need)
        check(await overflow(), 'goal form does not overflow')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-sv-goalform.png')
        await tap('#gUseNeed'); check(num(await pg.input_value('#gAutoAmt')) > 0 and await pg.is_checked('#gAuto'), '"use this amount" turns on the automatic deposit with the needed amount')
        day = 28 if today.day < 28 else 1; await pg.fill('#gAutoDay', str(day)); await pg.wait_for_timeout(200)
        auto_amt = num(await pg.input_value('#gAutoAmt'))
        await tap('#gSave'); await pg.wait_for_selector('#gSave', state='detached', timeout=30000); await drain()
        s = await server(); g = [x for x in s['goals'] if x['name'] == 'קרן-בדיקה']
        check(len(g) == 1 and float(g[0]['target_amount']) == 6000 and g[0]['auto_day'] == day and g[0]['auto_start'] is not None, 'goal saved to the cloud with target / auto fields', g)
        goal_id = g[0]['id'] if g else ''
        ents = [e for e in s['entries'] if e['goal_id'] == goal_id]
        check(len(ents) == 1 and float(ents[0]['amount']) == 1000 and ents[0]['kind'] == 'deposit', 'opening balance recorded as one deposit', ents)
        check(await pg.is_visible('.goal:has-text("קרן-בדיקה")') and '1,000' in await pg.inner_text('.goal:has-text("קרן-בדיקה")'), 'goal card shows name and saved amount')
        check(await pg.locator('.goal:has-text("קרן-בדיקה") .ring svg').count() == 1, 'goal card has a progress ring')

        # 2) deposit / withdraw / over-withdraw
        await entry_form('קרן-בדיקה', 'deposit', 500, 'בונוס'); await pg.wait_for_selector('#eSave', state='detached', timeout=20000); await drain()
        await entry_form('קרן-בדיקה', 'withdrawal', 200); await pg.wait_for_selector('#eSave', state='detached', timeout=20000); await drain()
        await entry_form('קרן-בדיקה', 'withdrawal', 5000); await pg.wait_for_timeout(600)
        check(await pg.is_visible('#eSave') and 'אפשר למשוך עד' in await toast(), 'withdrawing more than the balance is blocked with a clear message', await toast())
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500)
        s = await server(); ents = [e for e in s['entries'] if e['goal_id'] == goal_id]
        net = sum((1 if e['kind'] == 'deposit' else -1) * float(e['amount']) for e in ents)
        check(len(ents) == 3 and net == 1300, 'server: 3 entries, balance 1,300 (blocked withdrawal never reached the server)', (len(ents), net))
        check(any(e['notes'] == 'בונוס' for e in ents), 'note saved')
        await goto_view('savings')
        check('1,300' in await pg.inner_text('.sv-hero .big') or '1,300' in await pg.inner_text('.goal:has-text("קרן-בדיקה") .g-amt'), 'savings screen shows the new balance')
        check(await pg.locator('#app [data-sent]').count() >= 3, 'activity list shows the movements')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-sv-main.png')

        # 3) the overview: deposits reduce "left", they are NOT expenses
        left = await hero_left()
        planned = await pg.evaluate("""async () => { const S = window.__budget; const SV = await import('./js/savings.js'); const t = new Date(); const k = t.toISOString().slice(0,7);
          return SV.monthAllocation(S.goals, S.sentries, k, 'all', new Date().toLocaleDateString('sv')).plannedAmount; }""")
        check(abs(left - (8000 - 1300 - planned)) < 0.01, f'overview left = 8,000 - net deposits 1,300 - planned auto {planned}', (left, planned))
        check('לחיסכון' in await pg.inner_text('.hero'), 'overview hero explains the savings allocation')
        out = num(await pg.inner_text('.hero .stat.out b')); check(out == 2000, 'overview expenses still 2,000 (savings are not expenses)', out)
        check(await pg.locator('#app .card:has-text("חיסכון") .mini-goal').count() >= 1, 'overview has a savings card with goal progress')
        s = await server(); check(len(s['tx']) == 2 and sum(float(t['amount']) for t in s['tx'] if t['kind'] == 'expense') == 2000, 'server: no savings rows in transactions, expenses 2,000')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-sv-overview.png')

        # 4) automatic deposits generated once (goal created in the past via the store; boot generates them)
        d0 = add_months(today, -2).isoformat()
        await pg.evaluate("""async (d) => { const S = window.__budget; await S.store.saveGoal({ id: crypto.randomUUID(), name: 'חיסכון-אוטו', icon: '🎯', color: '#7aa7ff', target_amount: 20000, target_date: null, scope: 'business', auto_amount: 300, auto_day: 1, auto_start: d, auto_skip: [] }); }""", d0)
        await reload(); await reload()
        s = await server(); ag = [x for x in s['goals'] if x['name'] == 'חיסכון-אוטו']; ae = [e for e in s['entries'] if ag and e['goal_id'] == ag[0]['id']]
        check(len(ae) == 3 and sorted(e['auto_date'] for e in ae) == [add_months(today, i).isoformat() for i in (-2, -1, 0)], 'automatic deposits created for each due month, exactly once, after two reloads', [e['auto_date'] for e in ae])
        check(all(float(e['amount']) == 300 for e in ae), 'automatic deposit amount from the goal')
        await goto_view('savings')
        check(await pg.locator('#app .badge.rec').count() >= 1 or await pg.locator('#app [data-sent]:has-text("אוטומטי")').count() >= 1, 'auto deposits are marked in the activity list')

        # 5) deleting this month's auto deposit: it is not re-created; next month's still will be
        await tap(f'#app [data-sent="{[e for e in ae if e["auto_date"] == add_months(today, 0).isoformat()][0]["id"]}"]'); await pg.wait_for_selector('#eDel')
        await tap('#eDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="del"]'); await pg.wait_for_timeout(800); await drain()
        await reload()
        s = await server(); ag = [x for x in s['goals'] if x['name'] == 'חיסכון-אוטו'][0]; ae = [e for e in s['entries'] if e['goal_id'] == ag['id']]
        check(len(ae) == 2 and month in (ag['auto_skip'] or []), "deleted month's auto deposit stays deleted (month added to auto_skip)", (len(ae), ag['auto_skip']))

        # 6) edit an entry, then delete
        await goto_view('savings'); await tap('#app [data-sent]:has-text("בונוס")'); await pg.wait_for_selector('#eAmt')
        await pg.fill('#eAmt', '650'); await tap('#eSave'); await pg.wait_for_selector('#eSave', state='detached', timeout=20000); await drain()
        s = await server(); check(any(float(e['amount']) == 650 and e['notes'] == 'בונוס' for e in s['entries']) and len([e for e in s['entries'] if e['notes'] == 'בונוס']) == 1, 'edit changes the entry (no duplicate)')
        await tap('#app [data-sent]:has-text("בונוס")'); await tap('#eDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="del"]'); await pg.wait_for_timeout(800); await drain()
        s = await server(); check(not any(e['notes'] == 'בונוס' for e in s['entries']), 'delete removes the entry')

        # 7) business / personal tag filter
        await tap('#scopeSeg [data-scope="business"], [data-scope="business"]'); await pg.wait_for_timeout(500)
        txt = await pg.inner_text('#app')
        check('חיסכון-אוטו' in txt and 'קרן-בדיקה' not in txt, 'business filter shows only business-tagged goals')
        await tap('[data-scope="all"]'); await pg.wait_for_timeout(400)

        # 8) offline deposit -> exactly one server row after reconnect
        await goto_view('savings'); await ctx.set_offline(True); await pg.wait_for_timeout(500)
        await entry_form('קרן-בדיקה', 'deposit', 111, 'אופליין-חיסכון'); await pg.wait_for_timeout(1200)
        check('במכשיר' in await toast() or await pg.locator('#app .pending').count() >= 1, 'offline deposit saved on the device', await toast())
        check(await pg.is_visible('#app [data-sent].pending:has-text("אופליין-חיסכון") .p-off'), 'offline deposit shows the "waiting for connection" badge')
        await ctx.set_offline(False); await pg.wait_for_timeout(1500); await drain(90000)
        s = await server(); n = [e for e in s['entries'] if e['notes'] == 'אופליין-חיסכון']
        check(len(n) == 1 and float(n[0]['amount']) == 111, 'back online: synced automatically, exactly one row', len(n))
        await reload(); await reload(); s = await server(); check(len([e for e in s['entries'] if e['notes'] == 'אופליין-חיסכון']) == 1, 'still exactly one after reloads')
        log[:] = [l for l in log if not re.search(r'ERR_INTERNET_DISCONNECTED|Failed to fetch|Load failed|NetworkError', l)]

        # 9) savings in the PDF report
        await goto_view('reports'); await pg.select_option('#rpPeriod', 'month'); await pg.select_option('#rpScope', 'all')
        await pg.evaluate("window.__rpText = ''; window.__rpTimer = setInterval(() => { const h = document.getElementById('rpBuild'); if (h && h.innerText.length > 200) window.__rpText = h.innerText; }, 30)")
        await tap('[data-rp="pdf"]'); await pg.wait_for_selector('#rvDl:not([disabled])', timeout=120000)
        txt = await pg.evaluate("clearInterval(window.__rpTimer), window.__rpText")
        check('מטרות חיסכון' in txt and 'קרן-בדיקה' in txt and 'תנועות חיסכון בתקופה' in txt, 'PDF report has the savings section: goals + movements')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)

        # 10) edit goal, delete goal cascades
        await goto_view('savings'); await tap('.goal:has-text("חיסכון-אוטו") [data-gedit]'); await pg.wait_for_selector('#gName')
        await pg.fill('#gTarget', '25000'); await tap('#gSave'); await pg.wait_for_selector('#gSave', state='detached', timeout=20000); await drain()
        s = await server(); check(any(float(x['target_amount']) == 25000 for x in s['goals'] if x['name'] == 'חיסכון-אוטו'), 'goal edit saved')
        await tap('.goal:has-text("חיסכון-אוטו") [data-gedit]'); await tap('#gDel'); await pg.wait_for_selector('.ask'); await tap('[data-ask="del"]'); await pg.wait_for_timeout(800); await drain()
        s = await server(); check(not [x for x in s['goals'] if x['name'] == 'חיסכון-אוטו'] and len(s['entries']) == len([e for e in s['entries'] if e['goal_id'] == goal_id]), 'goal delete cascades to its entries on the server')
        check(await overflow(), 'savings screen does not overflow')
        if SHOTS: await pg.screenshot(path=f'{SHOTS}/{PLATFORM}-sv-after.png')

        await pg.evaluate(CLEAN)
        # 11) tolerance: if the savings tables were missing (older database), the rest of the app still works
        await pg.evaluate("sessionStorage.setItem('__nosav', '1')"); await pg.reload(); await pg.wait_for_selector('.hero', timeout=30000); await pg.wait_for_timeout(1500)
        check(await pg.is_visible('.hero'), 'app loads normally when the savings tables are missing')
        await goto_view('savings'); check(await pg.is_visible('#svAddGoal'), 'savings tab shows the empty state instead of an error')
        await pg.evaluate("sessionStorage.removeItem('__nosav')")
        log[:] = [l for l in log if 'PGRST205' not in l]
        check(not [l for l in log if l.startswith('pageerror') or 'NATIVE' in l], 'no page errors / native dialogs', log)
        await b.close()
    print('PLATFORM', PLATFORM)
    print('RESULT', 'FAIL ' + str(fails) if fails else 'ALL PASS')
asyncio.run(main())
