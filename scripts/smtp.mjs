// Configure Gmail SMTP + Hebrew RTL email templates on the budget-app project.
// Needs SUPABASE_ACCESS_TOKEN and GMAIL_APP_PASSWORD in env (never printed).  node scripts/smtp.mjs --ref <ref>
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2); const ref = args[args.indexOf('--ref') + 1];
const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); if (!pass) throw new Error('GMAIL_APP_PASSWORD missing');
const T = n => readFileSync(new URL(`../supabase/email/${n}.html`, import.meta.url), 'utf8');
const body = {
  smtp_host: 'smtp.gmail.com', smtp_port: '465', smtp_user: 'studioimage1983@gmail.com', smtp_pass: pass,
  smtp_admin_email: 'studioimage1983@gmail.com', smtp_sender_name: 'ניהול תקציב', smtp_max_frequency: 60,
  rate_limit_email_sent: 30,   // per hour; Gmail allows ~500/day
  mailer_subjects_confirmation: 'אישור ההרשמה לאפליקציית התקציב', mailer_templates_confirmation_content: T('confirmation'),
  mailer_subjects_magic_link: 'קישור כניסה לאפליקציית התקציב', mailer_templates_magic_link_content: T('magic_link'),
  mailer_subjects_recovery: 'איפוס סיסמה לאפליקציית התקציב', mailer_templates_recovery_content: T('recovery'),
};
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!r.ok) throw new Error('PATCH config/auth ' + r.status + ' ' + (await r.text()).slice(0, 300));
const a = await r.json();
console.log(JSON.stringify({ smtp_host: a.smtp_host, smtp_port: a.smtp_port, smtp_user: a.smtp_user, smtp_pass_set: !!a.smtp_pass, sender: a.smtp_sender_name, admin_email: a.smtp_admin_email, rate_limit_email_sent: a.rate_limit_email_sent, subjects: [a.mailer_subjects_confirmation, a.mailer_subjects_magic_link, a.mailer_subjects_recovery], templates_rtl: [a.mailer_templates_confirmation_content, a.mailer_templates_magic_link_content, a.mailer_templates_recovery_content].map(x => x?.includes('dir="rtl"')) }));
