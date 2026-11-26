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
- Sign-ups: `before insert` trigger on `auth.users` rejects any email not in `budget_private.allowed_emails` (only studioimage1983@gmail.com), **and** public sign-ups are disabled in Auth settings after the owner user is created.
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

## Current deployment (v1 preview)
- Supabase project: **shared** with photo-guides (`aqsdvzesnqtmnlkyrkeo`, region ap-northeast-2), because the access token could not create a new project (403).
  All objects are `budget_*` / `budget_private` / bucket `budget-receipts`; photo-guides tables and its Auth `site_url` were not changed (only redirect URLs were added).
- The allowlist trigger on `auth.users` now applies to the whole shared project: to add any future user (also for photo-guides),
  first `insert into budget_private.allowed_emails(email) values ('new@email')`.
- Not published: GitHub Pages is off, repo is private.
