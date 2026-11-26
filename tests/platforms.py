# Shared Playwright platform presets for the cross-platform test matrix.
#   chrome / firefox / webkit : desktop 1440x900
#   iphone  : WebKit with the iPhone 15 device profile (Safari UA, touch, 393x659 @3x)
#   android : Chrome with the Pixel 7 device profile (Chrome Android UA, touch, 412x839)
CHROME = '/usr/bin/google-chrome'
NAMES = ['chrome', 'firefox', 'webkit', 'iphone', 'android']

async def launch(p, name):
    base = dict(locale='he-IL', timezone_id='Asia/Jerusalem', accept_downloads=True)
    if name == 'chrome':
        return await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']), {**base, 'viewport': {'width': 1440, 'height': 900}}, False
    if name == 'firefox':
        return await p.firefox.launch(), {**base, 'viewport': {'width': 1440, 'height': 900}}, False
    if name == 'webkit':
        return await p.webkit.launch(), {**base, 'viewport': {'width': 1440, 'height': 900}}, False
    if name == 'iphone':
        return await p.webkit.launch(), {**base, **p.devices['iPhone 15']}, True
    if name == 'android':
        return await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']), {**base, **p.devices['Pixel 7']}, True
    raise SystemExit('unknown platform ' + name)
