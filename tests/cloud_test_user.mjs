// Creates ONE throw-away UI test user (budget-e2e-ui-*) with the password from env BUDGET_TEST_PASSWORD.
// Remove it afterwards with: node cloud_e2e.mjs --cleanup
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const cfg = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const URL_ = cfg.match(/supabaseUrl: '(.*?)'/)[1], REF = new URL(URL_).hostname.split('.')[0];
const mgmt = async (p, o = {}) => { const r = await fetch('https://api.supabase.com/v1' + p, { ...o, headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
const email = process.env.BUDGET_TEST_EMAIL;
if (!/^budget-e2e-ui-/.test(email)) throw new Error('test email must start with budget-e2e-ui-');
const SERVICE = (await mgmt(`/projects/${REF}/api-keys?reveal=true`)).find(k => k.name === 'service_role').api_key;
await mgmt(`/projects/${REF}/database/query`, { method: 'POST', body: JSON.stringify({ query: `insert into budget_private.allowed_emails(email) values ('${email}') on conflict do nothing` }) });
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const { error } = await admin.auth.admin.createUser({ email, password: process.env.BUDGET_TEST_PASSWORD, email_confirm: true });
if (error) throw error; console.log('UI test user created:', email);
