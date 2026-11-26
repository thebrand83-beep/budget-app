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

# ---- NO REAL E-MAIL FROM TESTS -------------------------------------------------------------
# Installed in every test context BEFORE the app loads (works in Chromium, Firefox and WebKit, unlike
# page.route, which WebKit does not apply to these cross-origin requests). Any auth call that would make
# Supabase send an e-mail (sign-up confirmation, magic link / OTP, password reset, resend, invite) never
# leaves the browser: /signup gets a fake "confirmation sent" answer, the rest are rejected.
# window.__blockedEmailCalls lists what was intercepted; tests assert on it.
EMAIL_GUARD = r"""(() => {
  const real = window.fetch.bind(window); window.__blockedEmailCalls = [];
  const EMAIL_PATHS = /\/auth\/v1\/(signup|otp|magiclink|recover|resend|invite|admin\/generate_link)\b/;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' && EMAIL_PATHS.test(url)) {
      window.__blockedEmailCalls.push(url.replace(/\?.*/, ''));
      if (/\/signup\b/.test(url)) return Promise.resolve(new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: '', email: 'mock@example.invalid', identities: [{}], created_at: '2026-01-01T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } }));
      return Promise.resolve(new Response(JSON.stringify({ code: 400, msg: 'blocked by test email guard' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    }
    return real(input, init);
  };
})();"""

async def guard(ctx):
    await ctx.add_init_script(EMAIL_GUARD)
    # (context-level page.route is deliberately NOT used: it crashes Playwright WebKit on these cross-origin calls
    #  and WebKit ignores it anyway. Runs are additionally verified against the Supabase auth log: zero e-mail events.)
    return ctx
