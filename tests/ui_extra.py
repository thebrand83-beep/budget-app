# Extra preview shots: Gemini tips (key injected into an ephemeral context only) + login screen.
import asyncio, os, pathlib, re
from playwright.async_api import async_playwright
BASE = 'http://127.0.0.1:8841/'; OUT = pathlib.Path('/workspace/budget-app-preview')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, locale='he-IL')
        pg = await ctx.new_page(); pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        sent = []
        pg.on('request', lambda r: sent.append(r.post_data or '') if 'generativelanguage' in r.url and r.method == 'POST' else None)
        await pg.goto(BASE); await pg.wait_for_timeout(1200)
        await pg.click('#btnSettings'); await pg.click('#sDemo'); await pg.wait_for_timeout(2500)
        await pg.evaluate("k => localStorage.setItem('budget.geminiKey', k)", os.environ['GEMINI_API_KEY'])
        await pg.reload(); await pg.wait_for_selector('#aiBtn'); await pg.click('#aiBtn')
        await pg.wait_for_function("document.querySelectorAll('.tip.ai').length > 0 || /Gemini|מכסה|עמוס|זמן/.test(document.querySelector('#aiStatus').textContent) && !document.querySelector('#aiStatus .spin')", timeout=200000)
        print('ai tips:', await pg.locator('.tip.ai').count(), '|', await pg.inner_text('#aiStatus'))
        body = sent[0] if sent else ''
        print('payload has notes/titles?', any(w in body for w in ['עדשה Sigma', 'קבלה מס', 'משפחת לוי']), 'len', len(body))
        await pg.evaluate('window.scrollTo(0,0)'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(OUT / '13-desktop-gemini-tips.png'), full_page=True)
        await ctx.close()
        # login screen with a dummy cloud config (no real backend contacted until sign-in)
        m = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True, locale='he-IL')
        pg = await m.new_page()
        async def cfg(route):
            r = await route.fetch(); t = await r.text()
            t = re.sub(r"supabaseUrl: '.*?'", "supabaseUrl: 'https://example-preview.supabase.co'", t); t = re.sub(r"supabaseAnonKey: '.*?'", "supabaseAnonKey: 'preview'", t)
            await route.fulfill(response=r, body=t)
        await pg.route('**/js/config.js', cfg)
        await pg.goto(BASE); await pg.wait_for_selector('#loginF', timeout=20000); await pg.wait_for_timeout(600)
        await pg.screenshot(path=str(OUT / '26-mobile-login.png'))
        await b.close()
asyncio.run(main())
