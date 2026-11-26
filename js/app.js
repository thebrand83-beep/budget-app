import { CONFIG } from './config.js';
import { createStore, uuid } from './store.js';
import * as M from './model.js';
import { donut, trendChart } from './charts.js';
import { ruleTips, aiTips, aggregatesForAI, checkKey } from './tips.js';
import { exportCSV, exportXLSX, exportReceiptsZip, printReport } from './export.js';
import { DEFAULT_CATEGORIES, sampleData } from './defaults.js';

// ---------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (id, cls = 'i') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const nf0 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = n => { n = +n || 0; return (Number.isInteger(Math.round(n * 100) / 100) ? nf0 : nf2).format(n); };
const fmtR = n => nf0.format(Math.round(+n || 0));
const fmtShort = v => { const a = Math.abs(v); return (v < 0 ? '-' : '') + (a >= 1000 ? (a / 1000).toLocaleString('he-IL', { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + 'K' : Math.round(a)); };
const monthName = k => new Date(k + '-15').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
const monthShort = k => new Date(k + '-15').toLocaleDateString('he-IL', { month: 'short' });
const dayLabel = d => new Date(d + 'T12:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' });
const KIND = { income: 'הכנסה', expense: 'הוצאה' }, SCOPE = { business: 'עסקי', personal: 'פרטי' };
const PAY = ['אשראי', 'העברה בנקאית', 'ביט / פייבוקס', 'מזומן', 'הוראת קבע', 'צ׳ק'];
const GKEY = 'budget.geminiKey';
const APP_VERSION = document.querySelector('meta[name=app-version]')?.content || '1';

function toast(msg, ms = 2600) { $$('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function errMsg(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'מייל או סיסמה שגויים';
  if (/Email not confirmed/i.test(m)) return 'צריך לאשר את המייל (בדוק את תיבת הדואר)';
  if (/User already registered/i.test(m)) return 'כבר קיים חשבון עם המייל הזה. עבור ל"כניסה" או "שכחתי סיסמה"';
  if (/not allowed for otp|User not found|Signups not allowed/i.test(m)) return 'לא נמצא חשבון עם המייל הזה. עבור ל"הרשמה"';
  if (/Error sending|confirmation email|smtp/i.test(m)) return 'שליחת המייל נכשלה כרגע. נסה שוב מאוחר יותר';
  if (/Password should be|weak/i.test(m)) return 'הסיסמה חלשה מדי. בחר סיסמה ארוכה יותר';
  if (/rate limit|too many/i.test(m)) return 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'אין חיבור לאינטרנט. נסה שוב';
  if (/mime|file type/i.test(m)) return 'סוג הקובץ לא נתמך (תמונה או PDF בלבד)';
  if (/size|too large|exceeded/i.test(m)) return 'הקובץ גדול מדי (עד 15MB)';
  if (e?.code === 'FILE_TOO_BIG') return 'הקובץ גדול מדי (עד 25MB)';
  if (e?.code === 'OFFLINE' || e?.code === 'TIMEOUT' || /TIMEOUT|Failed to fetch|Load failed|NetworkError/.test(m)) return 'אין חיבור לשרת כרגע. השינויים נשמרים במכשיר ויישלחו אוטומטית';
  if (e?.code === 'SESSION_EXPIRED' || /JWT|token is expired|refresh token/i.test(m)) return 'פג תוקף ההתחברות. צא והתחבר מחדש';
  if (e?.code === 'NOT_FOUND') return 'התנועה כבר לא קיימת (אולי נמחקה ממכשיר אחר). מרענן…';
  if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'אין הרשאה לשנות את הפריט הזה';
  if (e?.code === '23505' || /duplicate key/i.test(m)) return 'הפריט הזה כבר קיים';
  if (e?.code === '23503' || /foreign key/i.test(m)) return 'הקטגוריה או התנועה הקבועה כבר לא קיימות. רענן ונסה שוב';
  if (e?.code === '23514' || /check constraint/i.test(m)) return 'אחד הערכים לא תקין (סכום, תאריך או אורך טקסט)';
  if (e?.code === 'PGRST204' || /schema cache|column/i.test(m)) return 'האפליקציה התעדכנה. רענן את הדף ונסה שוב';
  console.error(e);
  return m ? 'שגיאה: ' + m : 'משהו השתבש. נסה שוב';
}

// ---------------------------------------------------------------- state
const S = {
  store: createStore(), user: null, cats: [], txs: [], recurring: [], settings: {},
  month: M.monthKey(M.todayStr()), scope: localStorage.getItem('budget.scope') || 'all', view: 'overview',
  filters: { q: '', kind: 'all', cat: 'all', receipt: 'all', period: 'month' }, pieKind: 'expense', ai: null,
};
window.__budget = S; // for debugging / tests

const VIEWS = [['overview', 'סקירה', 'home'], ['tx', 'תנועות', 'list'], ['budgets', 'תקציבים', 'target'], ['recurring', 'קבועות', 'repeat'], ['reports', 'דוחות', 'doc']];

// ---------------------------------------------------------------- boot
async function boot() {
  try { S.user = await S.store.init(); }
  catch (e) { $('#app').innerHTML = `<div class="auth"><div class="card"><h1>שגיאת התחברות</h1><div class="msg err">${esc(errMsg(e))}</div><button class="btn gold block" style="margin-top:14px" onclick="location.reload()">נסה שוב</button></div></div>`; return; }
  S.store.warm();
  S.store.onStatus(onSyncStatus);
  S.store.onFailed((e) => { toast('שינוי אחד לא נשמר בענן: ' + errMsg(e) + '. הנתונים עודכנו מהשרת', 6000); refresh(false, true); });
  S.store.onAuth((ev, user) => {
    if (ev === 'PASSWORD_RECOVERY') { S.user = user; afterLogin().then(() => openSettings(true)); return; }
    if (ev === 'SIGNED_OUT') { S.user = null; renderAuth(); }
    else if (ev === 'SIGNED_IN' && user && !S.loaded) { S.user = user; afterLogin(); }
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadSW = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => addEventListener('focus', () => reg.update().catch(() => {}))).catch(() => {});
    // a new version took over: reload once (only when no form is open) so the new code runs
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadSW || reloaded) return; const go = () => { if ($('.overlay')) return setTimeout(go, 3000); reloaded = true; location.reload(); }; go(); });
  }
  $('#btnSettings').onclick = () => S.user ? openSettings() : null;
  $('#sync').onclick = () => { const st = S.store.status || {}; if (st.state === 'auth') return renderAuth('login'); if (st.pending) { toast('מנסה לשלוח שוב…'); S.store.syncNow(); } else if (S.store.mode === 'cloud') refresh(false, true); };
  $('#fab').onclick = () => openTxForm();
  if (!S.user) return renderAuth();
  await afterLogin();
}

async function afterLogin() {
  S.loaded = true;
  $('#app').innerHTML = '<div class="empty" style="padding-top:30vh"><span class="spin"></span><div style="margin-top:10px">טוען נתונים…</div></div>';
  try {
    await loadAll();
    if (!S.cats.length) { await S.store.insertCategories(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: uuid(), sort: i }))); S.cats = await S.store.listCategories(); }
    await runRecurring();
  } catch (e) { toast(errMsg(e), 5000); }
  setSync(); renderNav(); $('#fab').classList.remove('hidden'); $('#bnav').classList.remove('hidden');
  window.addEventListener('focus', () => refresh(true));
  render();
}
async function loadAll() {
  const { cats, txs, recurring, settings } = await S.store.loadAll();
  Object.assign(S, { cats, txs, recurring, settings }); setSync();
}
let lastRefresh = 0;
async function refresh(quiet, force) {
  if (S.store.mode !== 'cloud' || !S.user || (!force && (Date.now() - lastRefresh < 20000 || $('.overlay')))) return;
  lastRefresh = Date.now();
  try { await loadAll(); await runRecurring(); render(); } catch (e) { if (!quiet) toast(errMsg(e)); }
}
async function runRecurring() {
  const due = M.dueRecurring(S.recurring, S.txs);
  if (!due.length) return;
  const added = await S.store.insertGenerated(due.map(t => ({ ...t, id: uuid() })));
  if (added.length) { S.txs = [...added, ...S.txs].sort((a, b) => b.date.localeCompare(a.date)); toast(`נוספו ${added.length} חיובים/הכנסות קבועים אוטומטית`); }
}
// Sync status chip + "saving / waiting" badges on rows that are not in the cloud yet
let lastPending = 0;
function setSync() {
  const el = $('#sync'); if (!el) return;
  const st = S.store.status || {};
  if (S.store.mode !== 'cloud') { el.dataset.s = 'local'; $('#syncTxt').textContent = 'תצוגה מקדימה'; return; }
  const off = st.state === 'offline' || st.offline || !navigator.onLine;
  let s = 'cloud', txt = 'הכל שמור בענן';
  if (st.state === 'auth') { s = 'off'; txt = 'צריך להתחבר מחדש'; }
  else if (st.upload && st.state === 'syncing') { s = 'busy'; txt = `מעלה קבלה ${st.upload.pct || 0}%`; }
  else if (off) { s = 'off'; txt = st.pending ? `לא מקוון · ${st.changes} ממתינים` : 'לא מקוון'; }
  else if (st.pending) { s = 'busy'; txt = `שומר… (${st.changes})`; }
  el.dataset.s = s; $('#syncTxt').textContent = txt;
  el.title = s === 'off' && st.pending ? 'השינויים שמורים במכשיר ויישלחו לענן אוטומטית כשהחיבור יחזור. לחץ כדי לנסות עכשיו' : '';
  document.body.dataset.net = off ? 'off' : 'on';
}
function onSyncStatus(st) {
  setSync();
  $$('[data-tx]').forEach(b => b.classList.toggle('pending', !!S.store.isPending(b.dataset.tx)));
  if (lastPending && !st.pending && st.state === 'idle') setTimeout(() => { if (!$('.overlay')) refresh(true, true); }, 400); // queue drained: pull the server's view
  lastPending = st.pending;
}
addEventListener('online', setSync); addEventListener('offline', setSync);

// ---------------------------------------------------------------- auth
function renderAuth(mode = 'login') {
  $('#fab').classList.add('hidden'); $('#bnav').classList.add('hidden'); $('#tabs').innerHTML = ''; $('#sync').classList.add('hidden'); $('#btnSettings').classList.add('hidden');
  const signup = mode === 'signup';
  $('#app').innerHTML = `<div class="auth"><div class="card">
    <div class="brand-mark" style="width:52px;height:52px;border-radius:15px">${ic('wallet')}</div>
    <h1>התקציב שלי</h1><p class="muted small">ניהול הכנסות, הוצאות וקבלות. לכל משתמש חשבון אישי ונפרד: הנתונים והקבלות שלך נגישים רק לך, ומסתנכרנים בין הטלפון למחשב.</p>
    <div class="kind-seg" style="margin-top:16px"><button data-auth="login" class="${!signup ? 'on' : ''}" style="${!signup ? 'background:rgba(212,175,106,.14);color:var(--gold2)' : ''}">כניסה</button><button data-auth="signup" class="${signup ? 'on' : ''}" style="${signup ? 'background:rgba(212,175,106,.14);color:var(--gold2)' : ''}">הרשמה</button></div>
    <form id="loginF">
      <div class="field"><label>מייל</label><input class="inp" type="email" id="lEmail" autocomplete="username" required value="${esc(localStorage.getItem('budget.lastEmail') || '')}" placeholder="name@example.com" dir="ltr"></div>
      <div class="field"><label>סיסמה${signup ? ' (לפחות 8 תווים)' : ''}</label><input class="inp" type="password" id="lPass" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="8"' : ''} dir="ltr"></div>
      <button class="btn gold block" id="lBtn">${signup ? 'יצירת חשבון' : 'כניסה'}</button>
    </form>
    ${signup ? '' : `<div class="btn-row" style="margin-top:10px;justify-content:space-between">
      <button class="btn sm" id="lMagic">${ic('spark')} שלח לי קישור כניסה למייל</button>
      <button class="btn sm" id="lReset">שכחתי סיסמה</button></div>`}
    <div id="lMsg"></div>
    <p class="dim small" style="margin-top:16px;display:flex;gap:6px;align-items:center">${ic('shield')} ${signup ? 'אחרי ההרשמה יישלח אליך מייל לאישור הכתובת.' : 'כל חשבון מבודד: אף משתמש לא רואה נתונים של משתמש אחר.'}</p>
  </div></div>`;
  $$('[data-auth]').forEach(b => b.onclick = () => renderAuth(b.dataset.auth));
  const msg = (t, ok) => $('#lMsg').innerHTML = `<div class="msg ${ok ? 'ok' : 'err'}">${esc(t)}</div>`;
  const email = () => { const e = $('#lEmail').value.trim().toLowerCase(); localStorage.setItem('budget.lastEmail', e); return e; };
  $('#loginF').onsubmit = async ev => {
    ev.preventDefault(); const b = $('#lBtn'); const label = b.textContent; b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try {
      if (signup) {
        if ($('#lPass').value.length < 8) throw new Error('הסיסמה צריכה לכלול לפחות 8 תווים');
        const d = await S.store.signUp(email(), $('#lPass').value);
        if (d.session) { S.user = d.user; } else { msg('נרשמת! שלחנו לך מייל לאישור הכתובת. לחץ על הקישור במייל כדי להיכנס.', true); b.disabled = false; b.textContent = label; return; }
      } else S.user = await S.store.signIn(email(), $('#lPass').value);
      $('#sync').classList.remove('hidden'); $('#btnSettings').classList.remove('hidden'); await afterLogin();
    } catch (e) { msg(errMsg(e)); b.disabled = false; b.textContent = label; }
  };
  if (!signup) {
    $('#lMagic').onclick = async () => { if (!$('#lEmail').value) return msg('הזן מייל'); try { await S.store.magicLink(email()); msg('שלחתי קישור כניסה למייל. פתח אותו במכשיר הזה.', true); } catch (e) { msg(errMsg(e)); } };
    $('#lReset').onclick = async () => { if (!$('#lEmail').value) return msg('הזן מייל'); try { await S.store.resetPassword(email()); msg('שלחתי מייל לאיפוס סיסמה.', true); } catch (e) { msg(errMsg(e)); } };
  }
}

// ---------------------------------------------------------------- nav
function renderNav() {
  const b = ([v, label, icon]) => `<button data-view="${v}" class="${S.view === v ? 'on' : ''}">${ic(icon)}<span>${label}</span></button>`;
  $('#tabs').innerHTML = VIEWS.map(b).join(''); $('#bnav').innerHTML = VIEWS.map(b).join('');
  $$('[data-view]').forEach(el => el.onclick = () => { S.view = el.dataset.view; renderNav(); render(); scrollTo({ top: 0, behavior: 'smooth' }); });
}
function toolbar() {
  const seg = [['all', 'הכל'], ['business', 'עסקי'], ['personal', 'פרטי']].map(([k, l]) => `<button data-scope="${k}" class="${S.scope === k ? 'on' : ''}">${l}</button>`).join('');
  return `<div class="toolbar"><div class="month"><button data-m="-1" aria-label="חודש קודם">${ic('chev-r')}</button><b>${monthName(S.month)}</b><button data-m="1" aria-label="חודש הבא">${ic('chev-l')}</button></div><div class="seg">${seg}</div></div>
    ${S.store.mode === 'local' ? `<div class="banner">${ic('warn')}<div><b>תצוגה מקדימה.</b> הנתונים נשמרים רק בדפדפן הזה. אחרי חיבור לענן הם יסתנכרנו בין הטלפון למחשב, מאחורי כניסה עם המייל שלך.</div></div>` : ''}`;
}
function bindToolbar() {
  $$('[data-m]').forEach(b => b.onclick = () => { S.month = M.addMonths(S.month, +b.dataset.m); S.ai = null; render(); });
  $$('[data-scope]').forEach(b => b.onclick = () => { S.scope = b.dataset.scope; localStorage.setItem('budget.scope', S.scope); S.ai = null; render(); });
}
function render() {
  const fn = { overview: viewOverview, tx: viewTx, budgets: viewBudgets, recurring: viewRecurring, reports: viewReports }[S.view];
  $('#app').innerHTML = `<section class="view">${toolbar()}${fn()}</section><div class="foot">הנתונים מוגנים: כל שורה וכל קבלה שייכות רק לחשבון שלך · גרסה ${APP_VERSION}</div>`;
  bindToolbar(); bindView();
}
const cat = id => S.cats.find(c => c.id === id);

// ---------------------------------------------------------------- overview
function viewOverview() {
  const sm = M.monthSummary(S.txs, S.recurring, S.month, S.scope);
  const items = M.byCategory(sm.list, S.cats, S.pieKind);
  const tr = M.trend(S.txs, S.month, 6, S.scope);
  const tips = ruleTips({ ...S }, fmtR);
  const ceiling = +S.settings.turnoverCeiling || CONFIG.turnover.ceiling2026;
  const to = M.turnover(S.txs, +S.month.slice(0, 4), ceiling);
  const bw = M.budgets(S.txs, S.cats, S.month, S.scope).filter(b => b.state === 'over' || b.state === 'mid');
  const label = sm.isCurrent ? 'עם כמה תישאר בסוף החודש' : sm.key > M.monthKey(M.todayStr()) ? 'צפי לחודש' : 'מאזן החודש';
  const plannedTxt = sm.planned.length ? `כולל ${sm.planned.length} תנועות קבועות שעוד צפויות החודש` : 'לפי ההכנסות וההוצאות שנרשמו';
  return `<div class="grid two">
    <div class="card hero">
      <div class="lbl">${ic('wallet')} ${label}${S.scope !== 'all' ? ` · ${SCOPE[S.scope]}` : ''}</div>
      <div class="big num ${sm.projected < 0 ? 'neg' : 'gold-text'}">${fmt(sm.projected)}</div>
      <div class="sub">${plannedTxt}</div>
      <div class="stats">
        <div class="stat in"><span>הכנסות</span><b class="num">${fmtR(sm.income)}</b></div>
        <div class="stat out"><span>הוצאות</span><b class="num">${fmtR(sm.expense)}</b></div>
        <div class="stat plan"><span>צפוי עוד</span><b class="num">${sm.plannedIncome - sm.plannedExpense >= 0 ? '+' : ''}${fmtR(sm.plannedIncome - sm.plannedExpense)}</b></div>
      </div>
      ${sm.isCurrent && sm.projected > 0 ? `<div class="daily">${ic('target')}<span>אפשר להוציא בערך <b class="num">${fmtR(sm.perDay)}</b> ליום ב-${sm.daysLeft} הימים שנשארו</span></div>` : ''}
      ${sm.isCurrent && sm.projected < 0 ? `<div class="daily neg">${ic('warn')}<span>בקצב הזה החודש ייגמר במינוס</span></div>` : ''}
    </div>
    <div class="card">
      <h3>${ic('pie')} התפלגות לפי קטגוריה<span class="sp"></span><span class="seg small"><button data-pie="expense" class="${S.pieKind === 'expense' ? 'on' : ''}">הוצאות</button><button data-pie="income" class="${S.pieKind === 'income' ? 'on' : ''}">הכנסות</button></span></h3>
      ${donut(items, { centerLabel: S.pieKind === 'expense' ? 'הוצאות' : 'הכנסות', fmt: fmtR })}
    </div>
    <div class="card">
      <h3>${ic('chart')} מגמה חודשית<span class="sp"></span><span class="muted small">6 חודשים</span></h3>
      <div class="trend">${tr.some(m => m.income || m.expense) ? trendChart(tr, { fmtShort, monthLabel: monthShort, current: S.month }) : '<div class="empty">אין עדיין נתונים</div>'}</div>
    </div>
    <div class="card">
      <h3>${ic('bulb')} טיפים לפי הנתונים שלך</h3>
      <div id="aiTips">${S.ai?.tips ? S.ai.tips.map(tipHTML).join('') : ''}</div>
      ${tips.map(tipHTML).join('')}
      <div class="ai-row">${localStorage.getItem(GKEY) ? `<button class="btn sm" id="aiBtn">${ic('spark')} ${S.ai?.tips ? 'רענן' : 'קבל'} טיפים חכמים מ-Gemini</button>` : `<button class="btn sm" id="aiSetup">${ic('spark')} טיפים חכמים עם Gemini (הגדרה)</button>`}<span class="dim small" id="aiStatus">${S.ai?.model ? 'נוצר עם ' + esc(S.ai.model) + ' · נשלחים רק סכומים מצרפיים' : 'נשלחים רק סכומים מצרפיים, בלי פרטים או קבלות'}</span></div>
    </div>
    ${recentCard(sm)}
    ${S.scope !== 'personal' ? turnoverCard(to) : ''}
    ${bw.length ? `<div class="card"><h3>${ic('target')} תקציבים שדורשים תשומת לב</h3>${bw.map(budgetRow).join('')}</div>` : ''}
  </div>`;
}
function recentCard(sm) {
  const list = [...sm.list].sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 6);
  return `<div class="card"><h3>${ic('list')} תנועות אחרונות<span class="sp"></span><button class="btn sm" data-view="tx">לכל התנועות</button></h3>
    ${list.length ? list.map(txRow).join('') + '<div class="dim small" style="margin-top:6px">לחיצה על תנועה פותחת עריכה ומחיקה</div>' : '<div class="empty">אין עדיין תנועות החודש. לחץ על + כדי להוסיף.</div>'}</div>`;
}
const tipHTML = t => `<div class="tip ${t.level}"><div class="ic">${esc(t.icon)}</div><div><b>${esc(t.title)}</b><p>${esc(t.text)}</p></div></div>`;
function turnoverCard(to) {
  const p = Math.min(1, to.pct), pp = Math.min(1, to.projPct);
  return `<div class="card turn"><h3>${ic('shield')} מחזור עוסק פטור ${to.year}<span class="sp"></span><span class="badge ${to.state === 'over' ? 'over' : to.state === 'mid' ? 'warn' : 'gold'}">${Math.round(to.pct * 100)}%</span></h3>
    <div class="big num">${fmt(to.ytd)} <span class="muted small" style="font-weight:400">מתוך ${fmtR(to.ceiling)}</span></div>
    <div class="bar ${to.state}" style="margin-top:10px"><i style="width:${pp * 100}%;opacity:.28"></i><i style="width:${p * 100}%"></i></div>
    <div class="row"><span>נשאר עד התקרה: <b class="num" style="color:var(--text)">${fmtR(Math.max(0, to.left))}</b></span><span>צפי לסוף השנה: <b class="num" style="color:${to.projection > to.ceiling ? 'var(--red)' : 'var(--text)'}">${fmtR(to.projection)}</b></span></div>
    <div class="src">נספרות הכנסות עסקיות לפני הוצאות (מחזור, לא רווח). תקרה ${to.year === 2026 ? '2026' : ''}: ${fmtR(to.ceiling)} לפי <a href="${CONFIG.turnover.sourceUrl}" target="_blank" rel="noopener">${esc(CONFIG.turnover.sourceLabel)}</a>. ניתן לעדכן בהגדרות.</div></div>`;
}
function budgetRow(b) {
  const c = b.cat; const pct = b.pct == null ? 0 : Math.min(1, b.pct);
  const badge = b.state === 'over' ? `<span class="badge over">חריגה ${fmtR(b.spent - b.budget)}</span>` : b.state === 'mid' ? `<span class="badge warn">${Math.round(b.pct * 100)}%</span>` : b.budget ? `<span class="badge">${Math.round(b.pct * 100)}%</span>` : '';
  return `<div class="budget-row"><div class="hd"><span class="cat-ic" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</span><span class="nm">${esc(c.name)}</span>${badge}<span class="amt num">${fmtR(b.spent)}${b.budget ? ' / ' + fmtR(b.budget) : ''}</span></div>
    ${b.budget ? `<div class="bar ${b.state}"><i style="width:${pct * 100}%"></i></div><div class="ft"><span>${b.state === 'over' ? 'עברת את התקציב' : 'נשאר ' + fmtR(b.budget - b.spent)}</span><span>${M.monthSummary(S.txs, S.recurring, S.month).daysLeft ? M.monthSummary(S.txs, S.recurring, S.month).daysLeft + ' ימים לסוף החודש' : ''}</span></div>` : ''}</div>`;
}

// ---------------------------------------------------------------- transactions
function txList() {
  const f = S.filters; const [y] = S.month.split('-');
  const range = f.period === 'month' ? { from: S.month + '-01', to: S.month + '-31' } : f.period === 'year' ? { from: y + '-01-01', to: y + '-12-31' } : {};
  const list = M.filterTx(S.txs, { ...f, ...range, scope: S.scope }, S.cats);
  const planned = f.period === 'month' && f.receipt === 'all' && !f.q ? M.filterTx(M.plannedFor(S.recurring, S.txs, S.month), { ...f, scope: S.scope }, S.cats) : [];
  return { list, planned };
}
function viewTx() {
  const f = S.filters; const { list, planned } = txList();
  const catOpts = `<option value="all">כל הקטגוריות</option>` + ['expense', 'income'].map(k => `<optgroup label="${k === 'expense' ? 'הוצאות' : 'הכנסות'}">${S.cats.filter(c => c.kind === k).map(c => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
  const inc = list.filter(t => t.kind === 'income').reduce((a, t) => a + +t.amount, 0), exp = list.filter(t => t.kind === 'expense').reduce((a, t) => a + +t.amount, 0);
  const groups = {}; for (const t of [...planned, ...list].sort((a, b) => b.date.localeCompare(a.date))) (groups[t.date] ||= []).push(t);
  const chip = (key, val, label) => `<button class="chip ${f[key] === val ? 'on' : ''}" data-f="${key}" data-v="${val}">${label}</button>`;
  return `<div class="filters">
      <div class="search">${ic('search')}<input id="q" placeholder="חיפוש לפי תיאור, הערה, קטגוריה או סכום" value="${esc(f.q)}"></div>
      <div class="chips">${chip('period', 'month', 'החודש')}${chip('period', 'year', 'כל השנה')}${chip('period', 'all', 'הכל')}
        ${chip('kind', 'all', 'הכל')}${chip('kind', 'expense', 'הוצאות')}${chip('kind', 'income', 'הכנסות')}
        <select class="chip ${f.cat !== 'all' ? 'on' : ''}" id="fCat">${catOpts}</select>
        ${chip('receipt', 'all', 'כל הקבלות')}${chip('receipt', 'yes', 'עם קבלה')}${chip('receipt', 'no', 'בלי קבלה')}</div>
      <div class="sum-strip"><span>${list.length} תנועות</span><span>הכנסות <b class="num pos">${fmtR(inc)}</b></span><span>הוצאות <b class="num neg">${fmtR(exp)}</b></span><span>מאזן <b class="num">${fmtR(inc - exp)}</b></span></div>
    </div>
    ${Object.keys(groups).length ? Object.entries(groups).map(([d, l]) => `<div class="tx-day"><span>${dayLabel(d)}</span></div>${l.map(txRow).join('')}`).join('') : `<div class="card empty">לא נמצאו תנועות. לחץ על + כדי להוסיף.</div>`}`;
}
function txRow(t) {
  const c = cat(t.category_id);
  return `<button class="tx ${t.planned ? 'planned' : ''} ${!t.planned && S.store.isPending(t.id) ? 'pending' : ''}" data-tx="${t.id}">
    <span class="cat-ic" style="background:${c ? c.color : '#6f6a62'}22;color:${c ? c.color : '#a39c90'}">${esc(c ? c.icon : '•')}</span>
    <span class="mid"><span class="t1">${esc(t.title || c?.name || KIND[t.kind])}</span>
      <span class="t2">${t.planned ? '<span class="badge warn">צפוי</span>' : ''}${c ? esc(c.name) : ''}${t.scope === 'business' ? ' <span class="badge biz">עסקי</span>' : ''}${t.recurring_id && !t.planned ? ` <span class="badge rec">${ic('repeat')}חוזר</span>` : ''}<span class="pend-b"><span class="p-on">שומר…</span><span class="p-off">ממתין לחיבור</span></span>${t.receipt_path ? `<span class="rc">${ic('receipt').replace('class="i"', 'class="i" style="width:14px;height:14px"')}</span>` : ''}</span></span>
    <span class="amt num ${t.kind === 'income' ? 'in' : ''}">${t.kind === 'income' ? '+' : '-'}${fmt(t.amount)}</span><span class="edit-hint" aria-hidden="true">${ic('edit')}</span></button>`;
}

// ---------------------------------------------------------------- budgets
function viewBudgets() {
  const list = M.budgets(S.txs, S.cats, S.month, S.scope);
  const set = list.filter(b => b.budget), total = set.reduce((a, b) => a + b.budget, 0), spent = set.reduce((a, b) => a + b.spent, 0);
  return `<div class="grid two">
    <div class="card"><h3>${ic('target')} תקציב חודשי לפי קטגוריה<span class="sp"></span><button class="btn sm" id="editBudgets">עריכת תקציבים</button></h3>
      ${set.length ? `<div class="budget-row"><div class="hd"><span class="nm"><b>סה"כ בקטגוריות עם תקציב</b></span><span class="amt num">${fmtR(spent)} / ${fmtR(total)}</span></div><div class="bar ${spent > total ? 'over' : spent / total >= .8 ? 'mid' : 'ok'}"><i style="width:${Math.min(100, spent / total * 100)}%"></i></div></div>` : `<div class="empty">עוד לא הגדרת תקציבים. לחץ "עריכת תקציבים" וקבע תקרה חודשית לכל קטגוריה.</div>`}
      ${list.filter(b => b.budget).map(budgetRow).join('')}
    </div>
    <div class="card"><h3>${ic('list')} קטגוריות בלי תקציב</h3>${list.filter(b => !b.budget).map(budgetRow).join('') || '<div class="empty">לכל הקטגוריות יש תקציב</div>'}</div>
  </div>`;
}
function openBudgetEditor() {
  const exp = S.cats.filter(c => c.kind === 'expense' && !c.archived);
  const avg = id => { const t = M.trend(S.txs.filter(x => x.category_id === id), M.addMonths(S.month, -1), 3); const n = t.filter(m => m.expense).length; return n ? t.reduce((a, m) => a + m.expense, 0) / n : 0; };
  sheet(`<h2>${ic('target')} עריכת תקציבים חודשיים<span class="sp"></span><button class="icon-btn" data-close>${ic('x')}</button></h2>
    <p class="muted small" style="margin-bottom:12px">השאר ריק לקטגוריה בלי תקציב. ההצעה מבוססת על ממוצע 3 החודשים האחרונים.</p>
    ${exp.map(c => { const a = avg(c.id); return `<div class="row-item"><span class="cat-ic" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</span><div class="mid">${esc(c.name)}<div class="t2">${a ? 'ממוצע: ' + fmtR(a) : 'אין היסטוריה'}</div></div><input class="inp" style="width:120px;height:42px" inputmode="decimal" data-bud="${c.id}" value="${c.monthly_budget ?? ''}" placeholder="${a ? Math.ceil(a / 50) * 50 : '—'}"></div>`; }).join('')}
    <div class="sheet-actions"><button class="btn gold" id="saveBud">שמירה</button></div>`);
  $('#saveBud').onclick = async () => {
    try {
      for (const inp of $$('[data-bud]')) {
        const c = cat(inp.dataset.bud); const v = inp.value.trim() === '' ? null : Math.max(0, +inp.value.replace(/[^\d.]/g, ''));
        if ((c.monthly_budget ?? null) !== v && !(c.monthly_budget != null && +c.monthly_budget === v)) Object.assign(c, await S.store.saveCategory({ ...c, monthly_budget: v }));
      }
      closeSheet(); toast('התקציבים נשמרו'); render();
    } catch (e) { toast(errMsg(e)); }
  };
}

// ---------------------------------------------------------------- recurring
function viewRecurring() {
  const act = S.recurring.filter(r => r.active), mon = k => act.filter(r => r.kind === k).reduce((a, r) => a + +r.amount, 0);
  const row = r => { const c = cat(r.category_id); return `<div class="row-item"><span class="cat-ic" style="background:${c ? c.color : '#6f6a62'}22;color:${c ? c.color : '#a39c90'}">${esc(c ? c.icon : '•')}</span>
    <div class="mid" data-rec="${r.id}" style="cursor:pointer"><div>${esc(r.title)} ${r.scope === 'business' ? '<span class="badge biz">עסקי</span>' : ''}</div><div class="t2">כל חודש ב-${r.day_of_month} · ${c ? esc(c.name) : 'ללא קטגוריה'}${r.end_month ? ' · עד ' + monthName(M.monthKey(r.end_month)) : ''}</div></div>
    <b class="num ${r.kind === 'income' ? 'pos' : ''}">${r.kind === 'income' ? '+' : '-'}${fmt(r.amount)}</b><button class="switch ${r.active ? 'on' : ''}" data-toggle="${r.id}" aria-label="פעיל"></button></div>`; };
  return `<div class="grid two">
    <div class="card"><h3>${ic('repeat')} הוצאות קבועות<span class="sp"></span><span class="muted small num">${fmtR(mon('expense'))} בחודש</span></h3>${S.recurring.filter(r => r.kind === 'expense').map(row).join('') || '<div class="empty">אין עדיין. למשל: שכירות סטודיו, Adobe, ביטוח ציוד.</div>'}</div>
    <div class="card"><h3>${ic('repeat')} הכנסות קבועות<span class="sp"></span><span class="muted small num">${fmtR(mon('income'))} בחודש</span></h3>${S.recurring.filter(r => r.kind === 'income').map(row).join('') || '<div class="empty">אין עדיין. למשל: ריטיינר קבוע מלקוח.</div>'}</div>
    <div class="card span2"><p class="muted small">תנועה קבועה נרשמת אוטומטית ביום שלה בכל חודש, פעם אחת בלבד, גם אם האפליקציה פתוחה בטלפון ובמחשב. עד אז היא מופיעה כ"צפויה" ונכללת בחישוב של כמה יישאר לך בסוף החודש.</p>
    <button class="btn gold" id="addRec" style="margin-top:12px">${ic('plus')} תנועה קבועה חדשה</button></div>
  </div>`;
}
function openRecForm(r = null) {
  const isNew = !r; r = r ? { ...r } : { kind: 'expense', scope: 'business', day_of_month: 1, active: true, start_month: S.month + '-01' };
  sheet(`<h2>${ic('repeat')} ${isNew ? 'תנועה קבועה חדשה' : 'עריכת תנועה קבועה'}<span class="sp"></span><button class="icon-btn" data-close>${ic('x')}</button></h2>
    <div class="kind-seg"><button data-k="expense" class="${r.kind === 'expense' ? 'on' : ''}">הוצאה</button><button data-k="income" class="${r.kind === 'income' ? 'on' : ''}">הכנסה</button></div>
    <div class="amount-box"><span>₪</span><input id="rAmt" inputmode="decimal" placeholder="0" value="${r.amount ?? ''}"></div>
    <div class="field"><label>שם</label><input class="inp" id="rTitle" value="${esc(r.title || '')}" placeholder="למשל: שכירות סטודיו"></div>
    <div class="field"><label>קטגוריה</label><div class="cat-pick" id="rCats"></div></div>
    <div class="two-col"><div class="field"><label>יום בחודש</label><input class="inp" id="rDay" type="number" min="1" max="31" value="${r.day_of_month}"></div>
      <div class="field"><label>עסקי / פרטי</label><div class="seg" id="rScope" style="height:48px"><button data-s="business" class="${r.scope === 'business' ? 'on' : ''}" style="flex:1">עסקי</button><button data-s="personal" class="${r.scope === 'personal' ? 'on' : ''}" style="flex:1">פרטי</button></div></div></div>
    <div class="two-col"><div class="field"><label>מתחיל מחודש</label><input class="inp" id="rStart" type="month" value="${M.monthKey(r.start_month || S.month)}"></div>
      <div class="field"><label>עד חודש (לא חובה)</label><input class="inp" id="rEnd" type="month" value="${r.end_month ? M.monthKey(r.end_month) : ''}"></div></div>
    <div class="field"><label>הערות</label><input class="inp" id="rNotes" value="${esc(r.notes || '')}"></div>
    <div class="sheet-actions">${!isNew ? `<button class="btn danger" id="rDel">${ic('trash')}</button>` : ''}<button class="btn gold" id="rSave">שמירה</button></div>`);
  const drawCats = () => $('#rCats').innerHTML = S.cats.filter(c => c.kind === r.kind && !c.archived).map(c => `<button data-c="${c.id}" class="${r.category_id === c.id ? 'on' : ''}" style="--c:${c.color}">${esc(c.icon)} ${esc(c.name)}</button>`).join('');
  drawCats();
  $$('.kind-seg button').forEach(b => b.onclick = () => { r.kind = b.dataset.k; r.category_id = null; $$('.kind-seg button').forEach(x => x.classList.toggle('on', x === b)); drawCats(); });
  $('#rCats').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; r.category_id = b.dataset.c; drawCats(); };
  $$('#rScope button').forEach(b => b.onclick = () => { r.scope = b.dataset.s; $$('#rScope button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#rSave').onclick = async () => {
    const amount = +$('#rAmt').value.replace(/[^\d.]/g, ''); const title = $('#rTitle').value.trim();
    if (!(amount > 0)) return toast('הזן סכום'); if (!title) return toast('הזן שם');
    Object.assign(r, { amount, title, day_of_month: Math.min(31, Math.max(1, +$('#rDay').value || 1)), start_month: ($('#rStart').value || S.month) + '-01', end_month: $('#rEnd').value ? $('#rEnd').value + '-01' : null, notes: $('#rNotes').value.trim() || null });
    if (!r.id) r.id = uuid();
    try { const saved = await S.store.saveRecurring(r); S.recurring = S.recurring.filter(x => x.id !== saved.id).concat(saved); await runRecurring(); closeSheet(); toast('נשמר'); render(); } catch (e) { toast(errMsg(e)); }
  };
  if (!isNew) $('#rDel').onclick = async () => { if (await ask('למחוק את התנועה הקבועה?', 'תנועות שכבר נרשמו יישארו ברשימה.', [{ k: 'del', label: 'מחיקה', cls: 'danger' }]) !== 'del') return; try { await S.store.deleteRecurring(r.id); S.recurring = S.recurring.filter(x => x.id !== r.id); closeSheet(); render(); } catch (e) { toast(errMsg(e)); } };
}

// ---------------------------------------------------------------- reports
function viewReports() {
  const y = S.month.slice(0, 4);
  return `<div class="grid two">
    <div class="card span2"><h3>${ic('doc')} דוחות לרואה החשבון</h3>
      <div class="two-col" style="margin-bottom:12px"><div class="field"><label>תקופה</label><select class="inp" id="rpPeriod">
        <option value="month">${monthName(S.month)}</option><option value="bimonth">חודשיים (${monthName(M.addMonths(S.month, -1))} – ${monthShort(S.month)})</option><option value="year" selected>שנת ${y}</option><option value="all">כל הנתונים</option></select></div>
        <div class="field"><label>אילו תנועות</label><select class="inp" id="rpScope"><option value="business" selected>עסקי בלבד</option><option value="all">עסקי + פרטי</option><option value="personal">פרטי בלבד</option></select></div></div>
      <div class="report-btns">
        <button class="report-btn" data-rp="pdf"><span class="cat-ic">${ic('print')}</span><span><b>דוח PDF להדפסה</b><span>סיכום, קטגוריות, כל התנועות ונספח קבלות. בוחרים "שמור כ-PDF"</span></span></button>
        <button class="report-btn" data-rp="xlsx"><span class="cat-ic">${ic('sheet')}</span><span><b>קובץ Excel</b><span>גיליון תנועות + גיליון סיכום לפי קטגוריה</span></span></button>
        <button class="report-btn" data-rp="csv"><span class="cat-ic">${ic('download')}</span><span><b>קובץ CSV</b><span>נפתח בכל תוכנה, כולל Excel ו-Google Sheets</span></span></button>
        <button class="report-btn" data-rp="zip"><span class="cat-ic">${ic('zip')}</span><span><b>כל הקבלות בקובץ ZIP</b><span>שמות קבצים מסודרים לפי תאריך, סכום ותיאור</span></span></button>
      </div><div id="rpMsg" class="small muted" style="margin-top:10px"></div>
    </div>
    ${turnoverCard(M.turnover(S.txs, +y, +S.settings.turnoverCeiling || CONFIG.turnover.ceiling2026))}
    <div class="card"><h3>${ic('chart')} סיכום שנתי ${y}</h3>${yearTable(y)}</div>
  </div>`;
}
function yearTable(y) {
  const t = M.trend(M.byScope(S.txs, S.scope), `${y}-12`, 12);
  const rows = t.filter(m => m.income || m.expense);
  if (!rows.length) return '<div class="empty">אין נתונים לשנה הזאת</div>';
  return rows.map(m => `<div class="row-item"><div class="mid">${monthName(m.key)}</div><span class="num pos small">${fmtR(m.income)}</span><span class="num neg small">${fmtR(m.expense)}</span><b class="num" style="min-width:80px;text-align:left">${fmtR(m.net)}</b></div>`).join('');
}
function reportSelection() {
  const p = $('#rpPeriod').value, sc = $('#rpScope').value, y = S.month.slice(0, 4);
  let list = S.txs, period = 'כל הנתונים', from = '', to = '';
  if (p === 'month') { from = S.month + '-01'; to = S.month + '-31'; period = monthName(S.month); }
  if (p === 'bimonth') { from = M.addMonths(S.month, -1) + '-01'; to = S.month + '-31'; period = `${monthName(M.addMonths(S.month, -1))} – ${monthName(S.month)}`; }
  if (p === 'year') { from = y + '-01-01'; to = y + '-12-31'; period = 'שנת ' + y; }
  list = M.filterTx(list, { from, to, scope: sc }, S.cats);
  const scopeLbl = { business: 'עסקי', personal: 'פרטי', all: 'עסקי ופרטי' }[sc];
  const name = `דוח-${scopeLbl}-${p === 'year' ? y : p === 'all' ? 'הכל' : S.month}`.replace(/\s+/g, '-');
  return { list, period: `${period} · ${scopeLbl}`, name };
}

// ---------------------------------------------------------------- tx form
function openTxForm(t = null) {
  const isNew = !t; t = t ? { ...t } : { kind: 'expense', scope: S.scope === 'personal' ? 'personal' : 'business', date: M.monthKey(M.todayStr()) === S.month ? M.todayStr() : S.month + '-01' };
  let file = null, removeReceipt = false;
  const linked = t.recurring_id ? S.recurring.find(r => r.id === t.recurring_id) || null : null;
  const origDate = t.date;
  sheet(`<h2>${isNew ? 'תנועה חדשה' : 'עריכת תנועה'}<span class="sp"></span><button class="icon-btn" data-close>${ic('x')}</button></h2>
    <div class="kind-seg"><button data-k="expense" class="${t.kind === 'expense' ? 'on' : ''}">הוצאה</button><button data-k="income" class="${t.kind === 'income' ? 'on' : ''}">הכנסה</button></div>
    <div class="amount-box"><span>₪</span><input id="fAmt" inputmode="decimal" placeholder="0" value="${t.amount ?? ''}" autocomplete="off"></div>
    <div class="field"><label>תיאור</label><input class="inp" id="fTitle" value="${esc(t.title || '')}" placeholder="למשל: צילומי חתונה – משפחת כהן" autocomplete="off"></div>
    <div class="field"><label>קטגוריה</label><div class="cat-pick" id="fCats"></div></div>
    <div class="two-col"><div class="field"><label>תאריך</label><input class="inp" type="date" id="fDate" value="${t.date}"></div>
      <div class="field"><label>עסקי / פרטי</label><div class="seg" id="fScope" style="height:48px"><button data-s="business" class="${t.scope === 'business' ? 'on' : ''}" style="flex:1">עסקי</button><button data-s="personal" class="${t.scope === 'personal' ? 'on' : ''}" style="flex:1">פרטי</button></div></div></div>
    <div class="field"><label>אמצעי תשלום</label><select class="inp" id="fPay"><option value="">—</option>${PAY.map(p => `<option ${t.payment_method === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="field"><label>קבלה</label><div class="receipt-box" id="rcBox"></div>
      <input type="file" id="fCam" accept="image/*" capture="environment" hidden><input type="file" id="fFile" accept="image/*,application/pdf" hidden></div>
    <div class="field"><label>הערות</label><textarea class="inp" id="fNotes" placeholder="מספר קבלה, פרטי לקוח, כל מה שיעזור לרואה החשבון">${esc(t.notes || '')}</textarea></div>
    <label class="rec-toggle" for="fRec"><span class="rt-txt"><b>${ic('repeat')} חוזר כל חודש</b><span class="dim small" id="fRecHint"></span></span><input type="checkbox" id="fRec" class="sw-input" ${linked ? 'checked' : ''}><span class="switch-ui" aria-hidden="true"></span></label>
    ${linked ? `<label class="check small" id="fRecUpdWrap"><input type="checkbox" id="fRecUpd" checked> לעדכן את הסכום והפרטים גם בחודשים הבאים</label>` : ''}
    <div class="sheet-actions">${!isNew ? `<button class="btn danger" id="fDel" aria-label="מחיקה">${ic('trash')}</button>` : ''}<button class="btn gold" id="fSave">${isNew ? 'הוספה' : 'שמירה'}</button></div>`);
  const drawCats = () => $('#fCats').innerHTML = S.cats.filter(c => c.kind === t.kind && !c.archived).map(c => `<button data-c="${c.id}" class="${t.category_id === c.id ? 'on' : ''}" style="--c:${c.color}">${esc(c.icon)} ${esc(c.name)}</button>`).join('');
  const drawRc = async () => {
    const box = $('#rcBox');
    const pick = `<button class="btn sm" id="rcCam">${ic('camera')} צילום</button><button class="btn sm" id="rcFile">${ic('clip')} קובץ / PDF</button>`;
    if (file) {
      const isImg = file.type.startsWith('image/');
      box.innerHTML = `<div class="thumb">${isImg ? `<img src="${URL.createObjectURL(file)}">` : 'PDF'}</div><div class="meta">${esc(file.name)}<div class="dim small">${(file.size / 1024 / 1024).toFixed(2)}MB · יעלה בשמירה</div></div><button class="btn sm" id="rcClear">${ic('x')}</button>`;
    } else if (t.receipt_path && !removeReceipt) {
      box.innerHTML = `<div class="thumb">${(t.receipt_type || '').startsWith('image/') ? ic('receipt') : 'PDF'}</div><div class="meta">${esc(t.receipt_name || 'קבלה')}<div class="dim small">שמורה בענן</div></div><button class="btn sm" id="rcView">צפייה</button><button class="btn sm" id="rcClear">${ic('trash')}</button>`;
    } else box.innerHTML = `<div class="meta muted">צלם את הקבלה או צרף קובץ (תמונה או PDF)</div>${pick}`;
    $('#rcCam') && ($('#rcCam').onclick = () => $('#fCam').click());
    $('#rcFile') && ($('#rcFile').onclick = () => $('#fFile').click());
    $('#rcClear') && ($('#rcClear').onclick = () => { if (file) file = null; else removeReceipt = true; drawRc(); });
    $('#rcView') && ($('#rcView').onclick = () => openReceipt(t, true));
  };
  const onFile = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (f.size > 25 * 1024 * 1024) return toast('הקובץ גדול מדי'); file = await compressImage(f); removeReceipt = false; drawRc(); };
  $('#fCam').onchange = onFile; $('#fFile').onchange = onFile;
  drawCats(); drawRc();
  $$('.kind-seg button').forEach(b => b.onclick = () => { t.kind = b.dataset.k; t.category_id = null; $$('.kind-seg button').forEach(x => x.classList.toggle('on', x === b)); drawCats(); });
  $('#fCats').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; t.category_id = t.category_id === b.dataset.c ? null : b.dataset.c; drawCats(); };
  $$('#fScope button').forEach(b => b.onclick = () => { t.scope = b.dataset.s; $$('#fScope button').forEach(x => x.classList.toggle('on', x === b)); });
  const recHint = () => { const on = $('#fRec').checked, d = +($('#fDate').value || t.date).slice(8, 10);
    $('#fRecHint').textContent = on ? `יירשם אוטומטית ב-${d} בכל חודש${linked ? '' : ', החל מהחודש של התאריך'}` : linked ? 'כיבוי יפסיק את החזרה מהחודש הזה והלאה' : 'כבוי: תנועה חד-פעמית';
    $('#fRecUpdWrap')?.classList.toggle('hidden', !on); };
  $('#fRec').onchange = recHint; $('#fDate').onchange = recHint; recHint();
  if (isNew) setTimeout(() => $('#fAmt')?.focus(), 250);
  $('#fSave').onclick = async () => {
    const amount = +String($('#fAmt').value).replace(/[^\d.]/g, '');
    if (!(amount > 0)) return toast('הזן סכום'); if (!$('#fDate').value) return toast('בחר תאריך');
    const btn = $('#fSave'), label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    Object.assign(t, { amount: M.round2(amount), date: $('#fDate').value, title: $('#fTitle').value.trim() || null, notes: $('#fNotes').value.trim() || null, payment_method: $('#fPay').value || null });
    if (!t.id) t.id = uuid();
    const oldPath = t.receipt_path, wantRec = $('#fRec').checked;
    let newRule = null;
    try {
      if (file) Object.assign(t, await S.store.uploadReceipt(t.id, file));
      else if (removeReceipt) Object.assign(t, { receipt_path: null, receipt_name: null, receipt_type: null });
      const ruleFields = () => ({ kind: t.kind, amount: t.amount, category_id: t.category_id || null, scope: t.scope, title: (t.title || cat(t.category_id)?.name || KIND[t.kind]).slice(0, 120), day_of_month: +t.date.slice(8, 10) });
      if (wantRec && !linked) { // turn ON: new monthly rule from this entry, starting in its month
        newRule = await S.store.saveRecurring({ id: uuid(), ...ruleFields(), start_month: M.monthKey(t.date) + '-01', active: true, notes: t.notes, skip_months: [] });
        S.recurring.push(newRule); t.recurring_id = newRule.id;
      } else if (wantRec && linked) {
        let r = { ...linked };
        if ($('#fRecUpd')?.checked) r = { ...r, ...ruleFields() };
        // moved to another month: don't let the rule re-create the occurrence in the month it left
        if (M.monthKey(origDate) !== M.monthKey(t.date)) r.skip_months = [...new Set([...(r.skip_months || []), M.monthKey(origDate)])];
        if (JSON.stringify(r) !== JSON.stringify(linked)) Object.assign(linked, await S.store.saveRecurring(r));
      } else if (!wantRec && linked) t.recurring_id = null;
      const saved = await S.store.saveTransaction(t);
      if (!wantRec && linked) await stopRule(linked, t.date, t.id);
      if (oldPath && oldPath !== saved.receipt_path) S.store.deleteReceipt(oldPath).catch(() => {});
      S.txs = [saved, ...S.txs.filter(x => x.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date));
      closeSheet(); toast(savedToast(isNew ? 'נוסף ✓' : 'נשמר ✓'));
      if (wantRec) await runRecurring().catch(e => toast(errMsg(e), 5000));
      render();
    } catch (e) {
      if (file && t.receipt_path && t.receipt_path !== oldPath) S.store.deleteReceipt(t.receipt_path).catch(() => {});
      if (newRule) { S.store.deleteRecurring(newRule.id).catch(() => {}); S.recurring = S.recurring.filter(r => r.id !== newRule.id); t.recurring_id = null; }
      t.receipt_path = oldPath; btn.disabled = false; btn.textContent = label;
      toast(errMsg(e), 5000); if (e?.code === 'NOT_FOUND') { closeSheet(); refresh(false, true); }
    }
  };
  if (!isNew) $('#fDel').onclick = async () => {
    const rc = t.receipt_path ? ' והקבלה שלה' : '';
    const k = linked
      ? await ask('למחוק את התנועה' + rc + '?', 'זו תנועה שחוזרת כל חודש.', [{ k: 'one', label: 'למחוק רק את החודש הזה', cls: 'danger' }, { k: 'stop', label: 'למחוק ולהפסיק את החזרה', cls: 'danger' }])
      : await ask('למחוק את התנועה' + rc + '?', 'אי אפשר לבטל את הפעולה.', [{ k: 'one', label: 'מחיקה', cls: 'danger' }]);
    if (!k) return;
    const btn = $('#fDel'); btn.disabled = true;
    try {
      if (linked && k === 'one') { // skip this month so the rule doesn't add it back
        Object.assign(linked, await S.store.saveRecurring({ ...linked, skip_months: [...new Set([...(linked.skip_months || []), M.monthKey(origDate)])] }));
      }
      await S.store.deleteTransaction({ ...t, date: origDate });
      if (linked && k === 'stop') await stopRule(linked, origDate, t.id);
      S.txs = S.txs.filter(x => x.id !== t.id); closeSheet(); toast(savedToast('נמחק ✓')); render();
    } catch (e) {
      btn.disabled = false; toast(errMsg(e), 5000);
      if (e?.code === 'NOT_FOUND') { S.txs = S.txs.filter(x => x.id !== t.id); closeSheet(); render(); }
    }
  };
}

const savedToast = ok => (S.store.mode === 'cloud' && (S.store.status?.offline || S.store.status?.state === 'offline' || !navigator.onLine)) ? ok.replace(' ✓', '') + ' במכשיר · יישלח לענן כשהחיבור יחזור' : ok;
/** Stop a recurring rule from the month of `date` onward. Deletes the rule if nothing else uses it. */
async function stopRule(rule, date, exceptTxId) {
  const others = S.txs.filter(x => x.recurring_id === rule.id && x.id !== exceptTxId);
  const startKey = M.monthKey(rule.start_month || date);
  if (!others.length || M.monthKey(date) <= startKey) {
    await S.store.deleteRecurring(rule.id).catch(e => { if (e?.code !== 'NOT_FOUND') throw e; });
    S.recurring = S.recurring.filter(r => r.id !== rule.id);
    S.txs = S.txs.map(x => x.recurring_id === rule.id ? { ...x, recurring_id: null } : x);
  } else Object.assign(rule, await S.store.saveRecurring({ ...rule, end_month: M.addMonths(M.monthKey(date), -1) + '-01' }));
}

async function compressImage(f) {
  if (!f.type.startsWith('image/') || /heic|heif|gif|svg/i.test(f.type)) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const max = CONFIG.receiptMaxSide, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (sc === 1 && f.size < 1.5 * 1024 * 1024) return f;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', CONFIG.receiptJpegQuality));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], (f.name || 'receipt').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}

async function openReceipt(t, stacked) {
  const host = stacked ? document.createElement('div') : null;
  const html = `<h2>${ic('receipt')} ${esc(t.receipt_name || 'קבלה')}<span class="sp"></span><button class="icon-btn" data-close>${ic('x')}</button></h2><div class="viewer" id="vw"><div class="empty"><span class="spin"></span></div></div>
    <div class="sheet-actions"><a class="btn gold" id="vDl" download="${esc(t.receipt_name || 'receipt')}">${ic('download')} הורדה</a></div>`;
  const ov = sheet(html, { wide: true, stacked });
  try {
    const url = await S.store.receiptUrl(t.receipt_path);
    const isImg = (t.receipt_type || '').startsWith('image/');
    $('#vw', ov).innerHTML = isImg ? `<img src="${url}" alt="קבלה">` : `<iframe src="${url}" title="קבלה"></iframe>`;
    $('#vDl', ov).href = S.store.mode === 'cloud' ? await S.store.receiptUrl(t.receipt_path, true) : url;
  } catch (e) { $('#vw', ov).innerHTML = `<div class="msg err">${esc(errMsg(e))}</div>`; }
}

// ---------------------------------------------------------------- settings
function openSettings(recovery = false) {
  const key = localStorage.getItem(GKEY) || '';
  const cloud = S.store.mode === 'cloud';
  sheet(`<h2>${ic('gear')} הגדרות<span class="sp"></span><button class="icon-btn" data-close>${ic('x')}</button></h2>
    ${recovery ? `<div class="msg ok" style="margin-bottom:12px">בחר סיסמה חדשה</div>` : ''}
    <div class="card" style="margin-bottom:12px"><h3>${ic('shield')} חשבון</h3>
      ${cloud ? `<p class="small muted">מחובר כ-<b dir="ltr">${esc(S.user.email)}</b>. הנתונים מסונכרנים ומוצפנים בתעבורה, ונגישים רק לחשבון הזה.</p>
        <div class="field" style="margin-top:10px"><label>סיסמה חדשה</label><div style="display:flex;gap:8px"><input class="inp" type="password" id="sPass" autocomplete="new-password" dir="ltr" placeholder="לפחות 8 תווים"><button class="btn" id="sPassBtn">עדכון</button></div></div>
        <button class="btn sm danger" id="sOut">${ic('logout')} התנתקות</button>`
      : `<p class="small muted">מצב תצוגה מקדימה: הנתונים נשמרים רק בדפדפן הזה, בלי ענן ובלי כניסה.</p><div class="btn-row" style="margin-top:10px"><button class="btn sm" id="sDemo">טען נתוני דוגמה</button><button class="btn sm danger" id="sWipe">מחק את כל הנתונים המקומיים</button></div>`}
    </div>
    <div class="card" style="margin-bottom:12px"><h3>${ic('spark')} טיפים חכמים (Gemini, לא חובה)</h3>
      <p class="small muted">המפתח נשמר רק בדפדפן הזה. ל-Gemini נשלחים רק סכומים מצרפיים לפי קטגוריה, בלי תיאורים, הערות או קבלות. אפשר להשתמש באותו מפתח חינמי של אפליקציית היוטיוב.</p>
      <div style="display:flex;gap:8px;margin-top:10px"><input class="inp" id="sKey" type="password" dir="ltr" placeholder="AIza…" value="${esc(key)}"><button class="btn" id="sKeyBtn">שמירה</button></div><div id="sKeyMsg"></div></div>
    <div class="card" style="margin-bottom:12px"><h3>${ic('shield')} תקרת עוסק פטור</h3>
      <div class="field"><label>תקרת מחזור שנתית (₪)</label><input class="inp" id="sCeil" inputmode="numeric" value="${S.settings.turnoverCeiling || CONFIG.turnover.ceiling2026}"></div>
      <p class="src">ברירת המחדל ל-2026: ${fmtR(CONFIG.turnover.ceiling2026)}, לפי <a href="${CONFIG.turnover.sourceUrl}" target="_blank" rel="noopener">${esc(CONFIG.turnover.sourceLabel)}</a>. הסכום מתעדכן בינואר בכל שנה, אז כדאי לעדכן כאן כשמתפרסם הסכום ל-2027.</p>
      <button class="btn sm" id="sCeilBtn">שמירה</button></div>
    <div class="card"><h3>${ic('tag')} קטגוריות</h3><p class="small muted">הוספה, שינוי שם, צבע ואייקון.</p><button class="btn sm" id="sCats" style="margin-top:8px">ניהול קטגוריות</button></div>`);
  if (cloud) {
    $('#sOut').onclick = async () => { const n = S.store.status?.pending || 0; if (n && await ask('יש ' + n + ' שינויים שעוד לא נשמרו בענן', 'התנתקות עכשיו תמחק אותם מהמכשיר. כדאי לחכות שהחיבור יחזור.', [{ k: 'out', label: 'להתנתק בכל זאת', cls: 'danger' }]) !== 'out') return; await S.store.signOut(); S.loaded = false; closeSheet(); location.reload(); };
    $('#sPassBtn').onclick = async () => { const p = $('#sPass').value; if (p.length < 8) return toast('לפחות 8 תווים'); try { await S.store.setPassword(p); $('#sPass').value = ''; toast('הסיסמה עודכנה ✓'); } catch (e) { toast(errMsg(e)); } };
  } else {
    $('#sDemo').onclick = async () => { if (S.txs.length && await ask('להוסיף נתוני דוגמה?', 'הם יתווספו לנתונים הקיימים.') !== 'ok') return; await loadSample(); closeSheet(); render(); toast('נטענו נתוני דוגמה'); };
    $('#sWipe').onclick = async () => { if (await ask('למחוק את כל הנתונים המקומיים?', '', [{ k: 'del', label: 'מחיקה', cls: 'danger' }]) !== 'del') return; await S.store.wipe(); location.reload(); };
  }
  $('#sKeyBtn').onclick = async () => {
    const k = $('#sKey').value.trim(); const m = $('#sKeyMsg');
    if (!k) { localStorage.removeItem(GKEY); m.innerHTML = '<div class="msg ok">המפתח הוסר</div>'; return; }
    m.innerHTML = '<div class="msg ok"><span class="spin"></span> בודק…</div>';
    try { if (await checkKey(k)) { localStorage.setItem(GKEY, k); m.innerHTML = '<div class="msg ok">המפתח תקין ונשמר ✓</div>'; render(); } else m.innerHTML = '<div class="msg err">המפתח לא תקין</div>'; }
    catch { localStorage.setItem(GKEY, k); m.innerHTML = '<div class="msg ok">נשמר (לא הצלחתי לבדוק כרגע, אין חיבור)</div>'; }
  };
  $('#sCeilBtn').onclick = async () => { const v = +$('#sCeil').value.replace(/[^\d.]/g, ''); if (!(v > 0)) return toast('סכום לא תקין'); S.settings = { ...S.settings, turnoverCeiling: v }; try { await S.store.saveSettings(S.settings); toast('נשמר ✓'); render(); } catch (e) { toast(errMsg(e)); } };
  $('#sCats').onclick = () => openCategories();
}
const PALETTE = ['#d4af6a', '#5fd39a', '#7aa7ff', '#ff8a91', '#f1b649', '#c38bff', '#4fd1d9', '#ff9f5a', '#9be7c0', '#e9a3c9', '#a3b6c9', '#b08d57'];
function openCategories() {
  const draw = () => sheet(`<h2>${ic('tag')} קטגוריות<span class="sp"></span><button class="icon-btn" data-close>${ic('x')}</button></h2>
    ${['expense', 'income'].map(k => `<div class="lbl2" style="margin-top:8px">${k === 'expense' ? 'הוצאות' : 'הכנסות'}</div>${S.cats.filter(c => c.kind === k).map(c => `<div class="row-item" style="${c.archived ? 'opacity:.45' : ''}">
      <input class="inp" style="width:52px;text-align:center;padding:0" maxlength="4" data-ci="${c.id}" value="${esc(c.icon)}">
      <input class="inp" data-cn="${c.id}" value="${esc(c.name)}"><input type="color" data-cc="${c.id}" value="${c.color}" style="width:42px;height:42px;border:0;background:none">
      <button class="btn sm" data-ca="${c.id}">${c.archived ? 'החזר' : 'הסתר'}</button></div>`).join('')}
      <button class="btn sm" data-add="${k}" style="margin-top:8px">${ic('plus')} קטגוריה</button>`).join('')}
    <div class="sheet-actions"><button class="btn gold" id="cSave">שמירה</button></div>`);
  draw();
  const bind = () => {
    $$('[data-add]').forEach(b => b.onclick = async () => { const name = prompt('שם הקטגוריה'); if (!name) return; try { const c = await S.store.saveCategory({ id: uuid(), name: name.trim().slice(0, 60), kind: b.dataset.add, color: PALETTE[S.cats.length % PALETTE.length], icon: '•', sort: S.cats.length }); S.cats.push(c); draw(); bind(); } catch (e) { toast(errMsg(e)); } });
    $$('[data-ca]').forEach(b => b.onclick = async () => { const c = cat(b.dataset.ca); try { Object.assign(c, await S.store.saveCategory({ ...c, archived: !c.archived })); draw(); bind(); } catch (e) { toast(errMsg(e)); } });
    $('#cSave').onclick = async () => {
      try { for (const c of S.cats) { const n = $(`[data-cn="${c.id}"]`).value.trim(), i = $(`[data-ci="${c.id}"]`).value.trim() || '•', col = $(`[data-cc="${c.id}"]`).value; if (n && (n !== c.name || i !== c.icon || col !== c.color)) Object.assign(c, await S.store.saveCategory({ ...c, name: n, icon: i, color: col })); } closeSheet(); toast('נשמר ✓'); render(); } catch (e) { toast(errMsg(e)); }
    };
  };
  bind();
}
async function loadSample() {
  const { cats, txs, recurring } = sampleData(S.cats, M.todayStr());
  for (const c of cats) await S.store.saveCategory(c);
  for (const r of recurring) await S.store.saveRecurring(r);
  for (const t of txs) await S.store.saveTransaction(t);
  await loadAll(); await runRecurring();
}

// ---------------------------------------------------------------- sheet
function sheet(html, { wide, stacked } = {}) {
  if (!stacked) closeSheet();
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) ov.remove(); });
  $('#host').appendChild(ov); document.body.style.overflow = 'hidden';
  new MutationObserver(() => { if (!$('.overlay')) document.body.style.overflow = ''; }).observe($('#host'), { childList: true });
  return ov;
}
/** In-app confirm dialog. buttons: [{ k, label, cls }]. Resolves with the chosen k, or null if dismissed. */
function ask(title, text, buttons = [{ k: 'ok', label: 'אישור', cls: 'gold' }]) {
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'overlay ask-ov';
    ov.innerHTML = `<div class="sheet ask" role="alertdialog" aria-modal="true"><h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="ask-btns">${buttons.map(b => `<button class="btn ${b.cls || ''}" data-ask="${b.k}">${esc(b.label)}</button>`).join('')}<button class="btn" data-ask="">ביטול</button></div></div>`;
    const done = k => { ov.remove(); res(k || null); };
    ov.addEventListener('click', e => { if (e.target === ov) return done(null); const b = e.target.closest('[data-ask]'); if (b) done(b.dataset.ask); });
    document.body.appendChild(ov);
  });
}
function closeSheet() { $('#host').innerHTML = ''; document.body.style.overflow = ''; }
addEventListener('keydown', e => { if (e.key === 'Escape') { const a = $('.ask-ov'); if (a) return a.querySelector('[data-ask=""]').click(); const o = $$('#host .overlay').pop(); o?.remove(); } });

// ---------------------------------------------------------------- view bindings
function bindView() {
  $$('#app [data-view]').forEach(el => el.onclick = () => { S.view = el.dataset.view; renderNav(); render(); scrollTo({ top: 0, behavior: 'smooth' }); });
  $$('[data-pie]').forEach(b => b.onclick = () => { S.pieKind = b.dataset.pie; render(); });
  $('#aiSetup') && ($('#aiSetup').onclick = () => openSettings());
  $('#aiBtn') && ($('#aiBtn').onclick = async () => {
    const b = $('#aiBtn'); b.disabled = true; $('#aiStatus').innerHTML = '<span class="spin"></span> Gemini מנתח את הנתונים…';
    try { S.ai = await aiTips(localStorage.getItem(GKEY), aggregatesForAI(S)); render(); }
    catch (e) { $('#aiStatus').textContent = errMsg(e) + '. הטיפים הרגילים ממשיכים לעבוד.'; b.disabled = false; }
  });
  $$('[data-tx]').forEach(b => b.onclick = () => {
    const id = b.dataset.tx; const t = S.txs.find(x => x.id === id);
    if (t) return openTxForm(t);
    const p = M.plannedFor(S.recurring, S.txs, S.month).find(x => x.id === id);
    if (p) openRecForm(S.recurring.find(r => r.id === p.recurring_id));
  });
  if ($('#q')) {
    let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { S.filters.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }, 200); };
    $$('[data-f]').forEach(b => b.onclick = () => { S.filters[b.dataset.f] = b.dataset.v; render(); });
    $('#fCat').onchange = e => { S.filters.cat = e.target.value; render(); };
  }
  $('#editBudgets') && ($('#editBudgets').onclick = openBudgetEditor);
  $('#addRec') && ($('#addRec').onclick = () => openRecForm());
  $$('[data-rec]').forEach(el => el.onclick = () => openRecForm(S.recurring.find(r => r.id === el.dataset.rec)));
  $$('[data-toggle]').forEach(b => b.onclick = async () => { const r = S.recurring.find(x => x.id === b.dataset.toggle); try { Object.assign(r, await S.store.saveRecurring({ ...r, active: !r.active })); if (r.active) await runRecurring(); render(); } catch (e) { toast(errMsg(e)); } });
  $$('[data-rp]').forEach(b => b.onclick = async () => {
    const { list, period, name } = reportSelection(); const msg = $('#rpMsg');
    if (!list.length) return msg.textContent = 'אין תנועות בתקופה שנבחרה';
    msg.innerHTML = '<span class="spin"></span> מכין…';
    try {
      const k = b.dataset.rp;
      if (k === 'csv') exportCSV(list, S.cats, name);
      if (k === 'xlsx') await exportXLSX(list, S.cats, name);
      if (k === 'zip') await exportReceiptsZip(list, S.store, name, (i, n) => msg.textContent = `מוריד קבלות ${i}/${n}…`);
      if (k === 'pdf') await printReport({ list, cats: S.cats, title: 'דוח הכנסות והוצאות – Studio Image', period, fmt, store: S.store, includeReceipts: list.some(t => t.receipt_path), owner: S.store.mode === 'cloud' ? S.user.email : '' });
      msg.textContent = `מוכן ✓ (${list.length} תנועות)`;
    } catch (e) { msg.textContent = errMsg(e); }
  });
}

boot();
