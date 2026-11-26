// Cloud end-to-end security test against the real Supabase project.
// Creates 2 throw-away test users, exercises data + receipts, proves RLS isolation, then deletes everything.
// Secrets come from env / Management API at runtime and are never printed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const cfg = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const URL_ = cfg.match(/supabaseUrl: '(.*?)'/)[1], ANON = cfg.match(/supabaseAnonKey: '(.*?)'/)[1];
const REF = new URL(URL_).hostname.split('.')[0];
const T = process.env.SUPABASE_ACCESS_TOKEN;
const mgmt = async (p, o = {}) => { const r = await fetch('https://api.supabase.com/v1' + p, { ...o, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); };
const sql = q => mgmt(`/projects/${REF}/database/query`, { method: 'POST', body: JSON.stringify({ query: q }) });
const SERVICE = (await mgmt(`/projects/${REF}/api-keys?reveal=true`)).find(k => k.name === 'service_role').api_key;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const stamp = Date.now(), pw = randomBytes(18).toString('base64url');
const A = `budget-e2e-a-${stamp}@example.com`, B = `budget-e2e-b-${stamp}@example.com`;
const ok = m => console.log('PASS:', m);
const users = [];
const KEEP = process.env.KEEP_TEST_USER === '1';  // keep user A for the UI screenshot run, cleaned by --cleanup
if (process.argv.includes('--cleanup')) { await cleanup(); process.exit(0); }
try {
  // stranger sign-up must fail (signups disabled + allowlist)
  const anonC = createClient(URL_, ANON, { auth: { persistSession: false } });
  const su = await anonC.auth.signUp({ email: `stranger-${stamp}@example.com`, password: pw });
  assert.ok(su.error, 'stranger sign-up should fail'); ok('public sign-up blocked (' + su.error.message + ')');
  // test users: allowlist temporarily, created by admin
  await sql(`insert into budget_private.allowed_emails(email) values ('${A}'),('${B}') on conflict do nothing`);
  for (const e of [A, B]) { const { data, error } = await admin.auth.admin.createUser({ email: e, password: pw, email_confirm: true }); if (error) throw error; users.push(data.user); }
  const notAllowed = await admin.auth.admin.createUser({ email: `notallowed-${stamp}@example.com`, password: pw, email_confirm: true });
  assert.ok(notAllowed.error, 'allowlist trigger should block non-allowlisted user even via admin'); ok('allowlist trigger blocks unknown emails even for admin API');
  const a = createClient(URL_, ANON, { auth: { persistSession: false } }); await a.auth.signInWithPassword({ email: A, password: pw });
  const b = createClient(URL_, ANON, { auth: { persistSession: false } }); await b.auth.signInWithPassword({ email: B, password: pw });
  const uidA = users[0].id;
  // A: categories, transactions, recurring, receipt
  const { data: cat, error: ce } = await a.from('budget_categories').insert({ name: 'ציוד צילום', kind: 'expense', monthly_budget: 1000 }).select().single(); if (ce) throw ce;
  const { data: catI } = await a.from('budget_categories').insert({ name: 'חתונות', kind: 'income' }).select().single();
  const month = new Date().toISOString().slice(0, 7);
  const { data: rec, error: re } = await a.from('budget_recurring').insert({ kind: 'expense', amount: 3200, title: 'שכירות', scope: 'business', day_of_month: 1, start_month: month + '-01' }).select().single(); if (re) throw re;
  const txId = crypto.randomUUID();
  const file = readFileSync(new URL('./fixtures/receipt-photo.jpg', import.meta.url));
  const path = `${uidA}/${txId}/receipt.jpg`;
  const up = await a.storage.from('budget-receipts').upload(path, file, { contentType: 'image/jpeg' }); if (up.error) throw up.error; ok('A uploaded receipt to private bucket');
  const ins = await a.from('budget_transactions').insert([
    { id: txId, kind: 'expense', amount: 1290, date: month + '-02', category_id: cat.id, scope: 'business', title: 'עדשה', receipt_path: path, receipt_name: 'receipt.jpg', receipt_type: 'image/jpeg' },
    { kind: 'income', amount: 7800, date: month + '-03', category_id: catI.id, scope: 'business', title: 'חתונה' },
    { kind: 'expense', amount: 3200, date: month + '-01', recurring_id: rec.id, scope: 'business', title: 'שכירות' },
  ]).select(); if (ins.error) throw ins.error;
  const dup = await a.from('budget_transactions').upsert({ kind: 'expense', amount: 3200, date: month + '-01', recurring_id: rec.id, scope: 'business', title: 'שכירות' }, { onConflict: 'user_id,recurring_id,date', ignoreDuplicates: true }).select();
  assert.equal(dup.data.length, 0); ok('recurring auto-add is idempotent (unique per date)');
  const { data: mine } = await a.from('budget_transactions').select('*');
  const inc = mine.filter(t => t.kind === 'income').reduce((s, t) => s + +t.amount, 0), exp = mine.filter(t => t.kind === 'expense').reduce((s, t) => s + +t.amount, 0);
  assert.equal(inc - exp, 3310); ok(`A balance correct: ${inc} - ${exp} = ${inc - exp}`);
  const signed = await a.storage.from('budget-receipts').createSignedUrl(path, 60); if (signed.error) throw signed.error;
  const sr = await fetch(signed.data.signedUrl); assert.equal(sr.status, 200); ok('A opens own receipt via signed URL (200)');
  const pub = await fetch(`${URL_}/storage/v1/object/public/budget-receipts/${path}`); assert.notEqual(pub.status, 200); ok(`public URL for receipt refused (${pub.status})`);
  const anonList = await anonC.from('budget_transactions').select('*'); assert.ok(anonList.error || anonList.data.length === 0); ok('anonymous client sees no rows');
  // B: isolation
  for (const t of ['budget_transactions', 'budget_categories', 'budget_recurring', 'budget_settings']) { const { data, error } = await b.from(t).select('*'); if (error) throw error; assert.equal(data.length, 0, t); }
  ok('B sees 0 of A\'s rows in all 4 tables');
  const bUpd = await b.from('budget_transactions').update({ amount: 1 }).eq('id', txId).select(); assert.equal(bUpd.data?.length || 0, 0); ok('B cannot update A\'s transaction');
  const bDel = await b.from('budget_transactions').delete().eq('id', txId).select(); assert.equal(bDel.data?.length || 0, 0); ok('B cannot delete A\'s transaction');
  const bIns = await b.from('budget_transactions').insert({ user_id: uidA, kind: 'expense', amount: 5 }); assert.ok(bIns.error); ok('B cannot insert rows as A');
  const bLink = await b.from('budget_transactions').insert({ kind: 'expense', amount: 5, category_id: cat.id }); assert.ok(bLink.error); ok('B cannot attach A\'s category');
  const bDl = await b.storage.from('budget-receipts').download(path); assert.ok(bDl.error); ok('B cannot download A\'s receipt');
  const bSign = await b.storage.from('budget-receipts').createSignedUrl(path, 60); assert.ok(bSign.error); ok('B cannot sign a URL for A\'s receipt');
  const bList = await b.storage.from('budget-receipts').list(uidA); assert.equal(bList.data?.length || 0, 0); ok('B cannot list A\'s receipt folder');
  const bUp = await b.storage.from('budget-receipts').upload(`${uidA}/evil.jpg`, file, { contentType: 'image/jpeg' }); assert.ok(bUp.error); ok('B cannot upload into A\'s folder');
  const bRm = await b.storage.from('budget-receipts').remove([path]); const still = await a.storage.from('budget-receipts').download(path); assert.ok(!still.error); ok('B cannot delete A\'s receipt');
  const { data: after } = await a.from('budget_transactions').select('amount').eq('id', txId).single(); assert.equal(+after.amount, 1290); ok('A\'s data unchanged after attacks');
  console.log('ALL CLOUD CHECKS PASSED');
  if (KEEP) console.log('KEPT_TEST_USER', A, '(password in env BUDGET_TEST_PASSWORD of this run only)');
} finally { if (!KEEP) await cleanup(); }

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users.filter(u => /^budget-e2e-/.test(u.email))) {
    const { data: objs } = await admin.storage.from('budget-receipts').list(u.id, { limit: 1000 });
    for (const d of objs || []) { const { data: files } = await admin.storage.from('budget-receipts').list(`${u.id}/${d.name}`); await admin.storage.from('budget-receipts').remove((files || []).map(f => `${u.id}/${d.name}/${f.name}`)); }
    await admin.auth.admin.deleteUser(u.id); // rows cascade via on delete cascade
  }
  await sql(`delete from budget_private.allowed_emails where email like 'budget-e2e-%'`);
  const left = await sql(`select (select count(*) from auth.users where email like 'budget-e2e-%') u, (select count(*) from public.budget_transactions t join auth.users x on x.id=t.user_id where x.email like 'budget-e2e-%') t, (select count(*) from storage.objects where bucket_id='budget-receipts' and (storage.foldername(name))[1] not in (select id::text from auth.users)) orphan_receipts`);
  console.log('cleanup done:', JSON.stringify(left));
}
