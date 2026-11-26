#!/usr/bin/env node
// One-shot Supabase setup for the budget app (run on the box, never in the browser).
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs            -> new free project "budget-app"
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --ref XXX  -> reuse an existing project
// Reads the token from env only; never prints secrets. Writes only the PUBLIC url + anon key to js/config.js.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN; if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing');
const OWNER = 'studioimage1983@gmail.com';
const SITE = 'https://thebrand83-beep.github.io/budget-app/';
const args = process.argv.slice(2); let ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null;
const api = async (path, opt = {}) => {
  const r = await fetch('https://api.supabase.com/v1' + path, { ...opt, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${opt.method || 'GET'} ${path} -> ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
export const sql = (r, query) => api(`/projects/${r}/database/query`, { method: 'POST', body: JSON.stringify({ query }) });

if (!ref) {
  const projects = await api('/projects');
  let orgs; try { orgs = await api('/organizations'); } catch { orgs = [...new Set(projects.map(p => p.organization_id))].map(id => ({ id })); } // scoped tokens may lack organizations_read
  if (!orgs.length) throw new Error('no organization');
  const existing = projects.find(p => p.name === 'budget-app'); 
  if (existing) ref = existing.id;
  else {
    const org = orgs[0];
    const dbPass = randomBytes(24).toString('base64url');
    mkdirSync(join(ROOT, '.secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(ROOT, '.secrets', 'db-password'), dbPass, { mode: 0o600 }); // gitignored, never printed
    const p = await api('/projects', { method: 'POST', body: JSON.stringify({ name: 'budget-app', organization_id: org.id, region: 'eu-central-1', db_pass: dbPass }) });
    ref = p.id; console.log('created project', ref);
  }
}
console.log('project ref:', ref);
for (let i = 0; i < 90; i++) { const p = await api(`/projects/${ref}`); if (p.status === 'ACTIVE_HEALTHY') break; if (i % 6 === 0) console.log('waiting for project…', p.status); await new Promise(r => setTimeout(r, 10000)); }
await new Promise(r => setTimeout(r, 5000));

// 1) schema + RLS + storage + allowlist trigger
await sql(ref, readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8')); console.log('schema applied');

// 2) auth settings. Shared project (--ref of another app): keep its site_url / password policy, only ADD our redirect URLs.
const cur = await api(`/projects/${ref}/config/auth`);
const proj = await api(`/projects/${ref}`); const shared = proj.name !== 'budget-app';
const ours = [SITE + '**', 'http://localhost:8841/**', 'http://127.0.0.1:8841/**'];
const allow = [...new Set([...(cur.uri_allow_list || '').split(',').filter(Boolean), ...ours])].join(',');
await api(`/projects/${ref}/config/auth`, { method: 'PATCH', body: JSON.stringify(shared
  ? { uri_allow_list: allow }
  : { site_url: SITE, uri_allow_list: allow, external_email_enabled: true, mailer_autoconfirm: false, password_min_length: Math.max(8, cur.password_min_length || 0), disable_signup: false }) });
console.log(shared ? 'shared project: added redirect URLs only' : 'auth configured');

// 3) keys (anon is public; service role stays in memory for the admin step only)
const keys = await api(`/projects/${ref}/api-keys?reveal=true`);
const anon = keys.find(k => k.name === 'anon')?.api_key, service = keys.find(k => k.name === 'service_role')?.api_key;
const url = `https://${ref}.supabase.co`;

// 4) create Ziv's user (confirmed, no password: he signs in with a magic link or "forgot password")
const admin = (p, o = {}) => fetch(url + '/auth/v1/admin' + p, { ...o, headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' } });
const list = await (await admin('/users?per_page=200')).json();
if (!list.users?.some(u => u.email === OWNER)) { const r = await admin('/users', { method: 'POST', body: JSON.stringify({ email: OWNER, email_confirm: true }) }); console.log('owner user created:', r.status); }
else console.log('owner user exists');

// 5) lock public sign-ups (defence in depth on top of the allowlist trigger)
await api(`/projects/${ref}/config/auth`, { method: 'PATCH', body: JSON.stringify({ disable_signup: true }) });
console.log('public sign-ups disabled');

// 6) write PUBLIC client config
const cfgPath = join(ROOT, 'js', 'config.js');
writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replace(/supabaseUrl: '.*?'/, `supabaseUrl: '${url}'`).replace(/supabaseAnonKey: '.*?'/, `supabaseAnonKey: '${anon}'`));
console.log('js/config.js updated with public URL + anon key');
