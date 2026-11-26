#!/usr/bin/env node
// Supabase setup for the budget app (run on the box, never in the browser). Token from env only; secrets never printed.
//   node scripts/provision.mjs --ref <project-ref>            open sign-up (shared app): anyone registers, email confirmation on
//   node scripts/provision.mjs --ref <project-ref> --private  single-owner: allowlist trigger + public sign-ups off
// Writes only the PUBLIC url + anon key to js/config.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN; if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing');
const OWNER = 'studioimage1983@gmail.com', SITE = 'https://thebrand83-beep.github.io/budget-app/';
const args = process.argv.slice(2); const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null; const PRIVATE = args.includes('--private');
if (!ref) throw new Error('usage: --ref <project-ref> [--private]');
const api = async (path, opt = {}) => {
  const r = await fetch('https://api.supabase.com/v1' + path, { ...opt, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${opt.method || 'GET'} ${path} -> ${r.status} ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null;
};
const sql = q => api(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: q }) });
const proj = await api(`/projects/${ref}`);
if (proj.name !== 'budget-app') throw new Error(`refusing: project ${ref} is "${proj.name}", expected a dedicated "budget-app" project`);
console.log('project', ref, proj.region, proj.status);

await sql(readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8')); console.log('schema + RLS + private bucket applied');
if (PRIVATE) { await sql(readFileSync(join(ROOT, 'supabase', 'signup_allowlist.sql'), 'utf8')); console.log('allowlist trigger installed'); }
else console.log('open sign-up: no allowlist trigger');

const allow = [SITE, SITE + '**', 'http://localhost:8841/**', 'http://127.0.0.1:8841/**'].join(',');
await api(`/projects/${ref}/config/auth`, { method: 'PATCH', body: JSON.stringify({
  site_url: SITE, uri_allow_list: allow, external_email_enabled: true,
  mailer_autoconfirm: false,           // email confirmation required
  password_min_length: 8, disable_signup: PRIVATE,
}) });
const keys = await api(`/projects/${ref}/api-keys?reveal=true`);
const anon = keys.find(k => k.name === 'anon')?.api_key, service = keys.find(k => k.name === 'service_role')?.api_key;
const url = `https://${ref}.supabase.co`;
const admin = (p, o = {}) => fetch(url + '/auth/v1/admin' + p, { ...o, headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' } });
const list = await (await admin('/users?per_page=1000')).json();
if (!list.users?.some(u => u.email === OWNER)) { const r = await admin('/users', { method: 'POST', body: JSON.stringify({ email: OWNER, email_confirm: true }) }); console.log('owner user created (confirmed, no password yet):', r.status); }
else console.log('owner user exists');
const a = await api(`/projects/${ref}/config/auth`);
console.log('auth:', JSON.stringify({ disable_signup: a.disable_signup, mailer_autoconfirm: a.mailer_autoconfirm, site_url: a.site_url, uri_allow_list: a.uri_allow_list, smtp_host: a.smtp_host || '(built-in)' }));
const cfgPath = join(ROOT, 'js', 'config.js');
writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replace(/supabaseUrl: '.*?'/, `supabaseUrl: '${url}'`).replace(/supabaseAnonKey: '.*?'/, `supabaseAnonKey: '${anon}'`));
console.log('js/config.js updated with public URL + anon key');
