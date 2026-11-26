# Service-worker update test: serves a copy of the app locally, loads it (v2, SW controlling),
# then "deploys" v3 (new sw.js cache name + app-version), fires the app's focus check and expects
# the page to pick up the new version by itself (controllerchange -> reload) with the old cache removed.
import asyncio, os, sys, shutil, subprocess, time, pathlib
sys.path.insert(0, os.path.dirname(__file__))
from platforms import launch
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
PLATFORM = os.environ.get('PLATFORM', 'chrome'); PORT = 8843

async def main():
    d = pathlib.Path('/tmp/swtest'); shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(ROOT, d, ignore=shutil.ignore_patterns('.git', 'node_modules', 'tests', 'supabase', 'docs', 'scripts'))
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=d, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    ok = False
    try:
        async with async_playwright() as p:
            b, kw, _ = await launch(p, PLATFORM)
            ctx = await b.new_context(**kw); pg = await ctx.new_page()
            url = f'http://localhost:{PORT}/'
            await pg.goto(url); await pg.evaluate("navigator.serviceWorker.ready.then(()=>1)")
            await pg.reload(); await pg.wait_for_timeout(1500)
            before = await pg.evaluate("(async()=>({ctl:!!navigator.serviceWorker.controller, keys: await caches.keys(), v: document.querySelector('meta[name=app-version]').content}))()")
            # deploy "v3"
            (d / 'sw.js').write_text((d / 'sw.js').read_text().replace("'budget-v2'", "'budget-v3test'"))
            (d / 'index.html').write_text((d / 'index.html').read_text().replace('name="app-version" content="2"', 'name="app-version" content="3"'))
            async with pg.expect_navigation(timeout=30000):
                await pg.evaluate("dispatchEvent(new Event('focus'))")
            await pg.wait_for_timeout(2000)
            after = await pg.evaluate("(async()=>({ctl:!!navigator.serviceWorker.controller, keys: await caches.keys(), v: document.querySelector('meta[name=app-version]').content}))()")
            ok = before['ctl'] and before['v'] == '2' and after['v'] == '3' and after['keys'] == ['budget-v3test']
            print('before', before, 'after', after)
            await b.close()
    finally:
        srv.terminate()
    print('PLATFORM', PLATFORM, 'SW UPDATE', 'PASS' if ok else 'FAIL')
asyncio.run(main())
