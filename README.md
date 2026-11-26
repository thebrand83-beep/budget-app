# התקציב שלי · Studio Image — Budget app (v1)

Personal + business budget PWA for a photography studio owner (osek patur, Israel). Hebrew RTL, mobile-first,
static site (no build step), Supabase for auth, data and receipts.

## Features
- Income / expenses: amount, date, category, business vs personal, payment method, notes, receipt.
- **"How much will I be left with this month"** = recorded income − expenses + recurring items still expected this month, plus a per-day allowance.
- Donut chart by category (income / expenses) and a 6-month trend chart (hand-rolled SVG, works offline).
- Receipts: phone camera capture or file (image/PDF). Photos are downscaled to 2400px JPEG. Stored in a **private** bucket, opened via short-lived signed URLs.
- Tips: rule-based (always on) + optional Gemini tips (key in Settings, localStorage). Only aggregated totals per category are sent.
- Per-category monthly budgets with progress bars and warnings; recurring items auto-added once per month (idempotent across devices).
- Osek patur turnover tracker (business income, before expenses) with year-end projection. 2026 ceiling **₪122,833** (editable in Settings).
- Exports: CSV (Excel-friendly), real .xlsx (2 sheets), ZIP of all receipts, printable A4 PDF report with receipts appendix.
- Search + filters (period, kind, category, receipt yes/no), business/personal filter everywhere.
- Installable PWA (manifest + service worker; Supabase/Gemini traffic is never cached).

## Layout
```
index.html  css/app.css  manifest.webmanifest  sw.js  assets/
js/app.js (UI) · js/store.js (Supabase + IndexedDB backends) · js/model.js (pure calculations)
js/charts.js · js/tips.js · js/export.js · js/defaults.js · js/config.js (public URL + anon key only)
supabase/schema.sql   tables, RLS, private bucket + policies, sign-up allowlist trigger
scripts/provision.mjs  creates/configures the Supabase project (uses SUPABASE_ACCESS_TOKEN from env)
tests/                 model tests, local RLS suite (embedded Postgres), cloud E2E security test, UI screenshot run
```

## Security model
- Every table has RLS (enabled + forced): `user_id = auth.uid()` for select/insert/update/delete; `anon` has no grants.
- Composite foreign keys `(category_id, user_id)` stop linking another user's rows.
- Receipts bucket `budget-receipts` is private; storage policies only allow `<auth.uid()>/…` paths; viewing uses signed URLs (10 min).
- Sign-ups: open to anyone (email confirmation required); each account is fully isolated by RLS and per-user storage folders. Optional single-owner lock: `supabase/signup_allowlist.sql` + `--private`.
- Only the anon key ships to the browser. No service key client-side.

## Run locally (preview mode)
`python3 -m http.server 8841` and open http://127.0.0.1:8841/ — with an empty `js/config.js` the app runs on IndexedDB (Settings → "טען נתוני דוגמה").

## Tests
```
node tests/model_test.mjs
tests/run_rls_local.sh          # needs a local Postgres on /tmp:54329 (see tests/README)
node tests/cloud_e2e.mjs         # real project; creates & deletes 2 throw-away users
python3 tests/ui_preview.py      # screenshots to /workspace/budget-app-preview
```

## Deployment status
- Target: dedicated Supabase project **budget-app** (Frankfurt), open sign-up with email confirmation. Provision with
  `node scripts/provision.mjs --ref <ref>` (add `--private` for a single-owner lock via `supabase/signup_allowlist.sql`).
- Until then `js/config.js` is empty and the app runs in local preview mode.
- Everything budget-related was removed from the photo-guides project (`aqsdvzesnqtmnlkyrkeo`).
- Public users need custom SMTP: see `docs/email-smtp-he.md`.
- Not published: GitHub Pages is off, repo is private.
