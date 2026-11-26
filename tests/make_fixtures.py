# Creates a realistic Hebrew receipt photo (JPG) and a PDF receipt for tests.
import asyncio, pathlib
from playwright.async_api import async_playwright
F = pathlib.Path(__file__).parent / 'fixtures'
HTML = '''<html dir=rtl><body style="margin:0;background:#cfc9bd;font-family:Heebo,Arial;display:grid;place-items:center;height:100vh">
<div style="width:420px;background:#fffdf7;padding:28px 26px;box-shadow:0 10px 30px rgba(0,0,0,.25);transform:rotate(-2deg)">
<div style="text-align:center;font-weight:800;font-size:22px">צילום פלוס בע"מ</div><div style="text-align:center;font-size:13px;color:#555">רח' העצמאות 12, חיפה · ח.פ 514523119</div>
<hr style="border:0;border-top:1px dashed #999;margin:14px 0"><div style="font-weight:700">חשבונית מס / קבלה מס' 88213</div><div style="font-size:13px;color:#555">תאריך: 24/11/2026</div>
<table style="width:100%;margin-top:12px;font-size:15px"><tr><td>עדשה 50mm f/1.8</td><td style="text-align:left">₪ 1,120.00</td></tr><tr><td>פילטר UV 58mm</td><td style="text-align:left">₪ 170.00</td></tr></table>
<hr style="border:0;border-top:1px dashed #999;margin:14px 0"><div style="display:flex;justify-content:space-between;font-weight:800;font-size:18px"><span>סה"כ לתשלום</span><span>₪ 1,290.00</span></div>
<div style="font-size:12px;color:#777;margin-top:16px;text-align:center">שולם באשראי ****4417 · תודה ולהתראות!</div></div></body></html>'''
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 900, 'height': 1200}, device_scale_factor=2)
        await pg.set_content(HTML); await pg.wait_for_timeout(500)
        await pg.screenshot(path=str(F / 'receipt-photo.jpg'), type='jpeg', quality=90)
        await pg.pdf(path=str(F / 'receipt.pdf'), format='A5')
        await b.close()
asyncio.run(main())
