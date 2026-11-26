// Savings: pure calculations (no DOM). Goals + deposit/withdrawal entries, the monthly automatic deposit
// (same rules as recurring items: one per goal per month, never duplicated, deleting one skips that month),
// month allocation for the "left" balance, and data-based tips.
// Deposits are allocations: they are NOT expenses and never enter the expense charts or the expense totals.
import { addMonths, monthKey, monthRange, occurrenceDate, round2, todayStr, trend } from './model.js';

export const GOAL_ICONS = ['🎯', '🛡️', '🏝️', '🏠', '🚗', '📷', '💻', '🎓', '💍', '👶', '🎁', '🏛️', '💼', '📈', '🛠️', '✈️'];
export const GOAL_COLORS = ['#d4af6a', '#5fd39a', '#7aa7ff', '#c38bff', '#ff9f5a', '#4fd1d9', '#ff7a8a', '#a3b6c9'];
export const GOAL_TEMPLATES = [
  { name: 'קרן חירום', icon: '🛡️', color: '#5fd39a', hint: 'ביטחון ליום סגריר' },
  { name: 'חופשה', icon: '🏝️', color: '#4fd1d9', hint: 'לצאת לנוח בלי ללחוץ' },
  { name: 'ציוד חדש לסטודיו', icon: '📷', color: '#7aa7ff', scope: 'business', hint: 'מצלמה, עדשה, תאורה' },
  { name: 'הפרשה למיסים', icon: '🏛️', color: '#a3b6c9', scope: 'business', hint: 'כדי שלא יפתיעו אותך' },
];

export const inScope = (g, scope) => !scope || scope === 'all' || g.scope === scope;
const sgn = e => e.kind === 'withdrawal' ? -1 : 1;
export const entriesOf = (goal, entries) => entries.filter(e => e.goal_id === goal.id);
export const goalSaved = (goal, entries) => round2(entriesOf(goal, entries).reduce((a, e) => a + sgn(e) * +e.amount, 0));
export const monthsBetween = (fromKey, toKey) => (+toKey.slice(0, 4) - +fromKey.slice(0, 4)) * 12 + (+toKey.slice(5, 7) - +fromKey.slice(5, 7));

/** Net deposits per month for the last n completed months (current month excluded). */
function pace(goal, entries, today, n = 3) {
  const cur = monthKey(today), keys = monthRange(addMonths(cur, -n), addMonths(cur, -1));
  const es = entriesOf(goal, entries).filter(e => keys.includes(monthKey(e.date)));
  const dep = es.filter(e => e.kind === 'deposit').reduce((a, e) => a + +e.amount, 0);
  return round2(dep / n);
}

export function goalStats(goal, entries, today = todayStr()) {
  const saved = goalSaved(goal, entries), target = +goal.target_amount;
  const remaining = round2(Math.max(0, target - saved)), done = saved >= target;
  const pct = target ? Math.max(0, Math.min(1, saved / target)) : 0;
  const cur = monthKey(today);
  const hasDate = !!goal.target_date, tKey = hasDate ? monthKey(goal.target_date) : null;
  const overdue = hasDate && !done && goal.target_date < today;
  const monthsLeft = hasDate && !overdue ? Math.max(1, monthsBetween(cur, tKey) + 1) : null;
  const needed = monthsLeft && !done ? round2(remaining / monthsLeft) : 0;
  const currentPace = Math.max(pace(goal, entries, today), +goal.auto_amount || 0);
  let status = 'open';
  if (done) status = 'done';
  else if (overdue) status = 'overdue';
  else if (hasDate) status = currentPace <= 0 ? 'start' : currentPace >= needed * 0.95 ? 'ontrack' : 'behind';
  const etaMonths = !hasDate && !done && currentPace > 0 ? Math.ceil(remaining / currentPace) : null;
  return { goal, saved, target, remaining, pct, done, overdue, monthsLeft, needed, pace: currentPace, status, etaMonths, hasDate,
    daysLeft: hasDate ? Math.round((new Date(goal.target_date + 'T12:00') - new Date(today + 'T12:00')) / 864e5) : null };
}

export function totals(goals, entries, scope = 'all', today = todayStr()) {
  const gs = goals.filter(g => inScope(g, scope)).map(g => goalStats(g, entries, today));
  const saved = round2(gs.reduce((a, s) => a + s.saved, 0)), target = round2(gs.reduce((a, s) => a + s.target, 0));
  return { stats: gs, saved, target, remaining: round2(gs.reduce((a, s) => a + s.remaining, 0)), pct: target ? Math.min(1, saved / target) : 0,
    needed: round2(gs.reduce((a, s) => a + s.needed, 0)), done: gs.filter(s => s.done).length, count: gs.length };
}

// ---------------------------------------------------------------- automatic monthly deposit
const autoActiveIn = (g, key) => !!(+g.auto_amount > 0) && !(g.auto_skip || []).includes(key) && (!g.auto_start || key >= monthKey(g.auto_start));
const ruleDay = g => ({ day_of_month: g.auto_day || 1 });
const haveAuto = (g, entries) => new Set(entries.filter(e => e.goal_id === g.id && e.auto_date).map(e => monthKey(e.auto_date)));

/** Automatic deposits whose date has arrived and that are not recorded yet (never more than 12 months back). */
export function dueAuto(goals, entries, today = todayStr()) {
  const out = [];
  for (const g of goals) {
    if (!(+g.auto_amount > 0)) continue;
    const have = haveAuto(g, entries), cur = monthKey(today);
    const from = monthKey(g.auto_start || today), start = from < addMonths(cur, -11) ? addMonths(cur, -11) : from;
    let running = goalSaved(g, entries);
    for (const key of monthRange(start, cur)) {
      if (!autoActiveIn(g, key) || have.has(key)) continue;
      const date = occurrenceDate(ruleDay(g), key);
      if (date > today) continue;
      if (running >= +g.target_amount) break;          // goal reached: the automatic deposit stops by itself
      out.push({ goal_id: g.id, kind: 'deposit', amount: +g.auto_amount, date, notes: 'הפקדה חודשית אוטומטית', auto_date: date });
      running = round2(running + +g.auto_amount);
    }
  }
  return out;
}

/** Automatic deposits still expected later in the given month (they reduce the projected "left" balance). */
export function plannedAuto(goals, entries, key, today = todayStr()) {
  const out = [];
  if (key < monthKey(today)) return out;
  for (const g of goals) {
    if (!autoActiveIn(g, key) || haveAuto(g, entries).has(key)) continue;
    const date = occurrenceDate(ruleDay(g), key);
    if (key === monthKey(today) && date <= today) continue;   // already due: it is added by dueAuto
    if (goalSaved(g, entries) >= +g.target_amount) continue;
    out.push({ planned: true, goal_id: g.id, kind: 'deposit', amount: +g.auto_amount, date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** What the month sets aside: actual net deposits + automatic deposits still ahead. Goals are filtered by the scope tag. */
export function monthAllocation(goals, entries, key, scope = 'all', today = todayStr()) {
  const ids = new Set(goals.filter(g => inScope(g, scope)).map(g => g.id));
  const es = entries.filter(e => ids.has(e.goal_id) && monthKey(e.date) === key);
  const deposits = round2(es.filter(e => e.kind === 'deposit').reduce((a, e) => a + +e.amount, 0));
  const withdrawals = round2(es.filter(e => e.kind === 'withdrawal').reduce((a, e) => a + +e.amount, 0));
  const planned = plannedAuto(goals.filter(g => ids.has(g.id)), entries, key, today);
  const plannedAmount = round2(planned.reduce((a, p) => a + p.amount, 0));
  return { deposits, withdrawals, net: round2(deposits - withdrawals), planned, plannedAmount, count: es.length };
}

export function entriesInRange(goals, entries, { from = '', to = '', scope = 'all' } = {}) {
  const ids = new Set(goals.filter(g => inScope(g, scope)).map(g => g.id));
  return entries.filter(e => ids.has(e.goal_id) && (!from || e.date >= from) && (!to || e.date <= to));
}

// ---------------------------------------------------------------- tips
const roundTo = (v, step) => Math.max(step, Math.floor(v / step) * step);
/** Data-based savings tips: from the real average monthly surplus / expenses of the last 3 completed months. */
export function savingsTips({ goals, entries, txs, month, scope = 'all', today = todayStr(), fmt }) {
  const out = [], add = (level, icon, title, text) => out.push({ level, icon, title, text });
  const gs = goals.filter(g => inScope(g, scope)).map(g => goalStats(g, entries, today));
  const cur = monthKey(today);
  const tr = trend(txs, addMonths(cur, -1), 3, scope).filter(m => m.income || m.expense);
  const avgNet = tr.length ? round2(tr.reduce((a, m) => a + m.net, 0) / tr.length) : null;
  const avgExp = tr.length ? round2(tr.reduce((a, m) => a + m.expense, 0) / tr.length) : null;
  const open = gs.filter(s => !s.done);
  for (const s of gs.filter(s => s.done)) add('good', '🎉', `הגעת ליעד: ${s.goal.name}`, `חסכת ${fmt(s.saved)} מתוך ${fmt(s.target)}. אפשר לסגור את היעד, או להגדיל אותו ולהמשיך.`);
  for (const s of open.filter(s => s.status === 'behind')) add('warn', '⏳', `${s.goal.name}: צריך להגביר קצב`, `כדי להגיע ל-${fmt(s.target)} עד ${new Date(s.goal.target_date + 'T12:00').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })} נדרשים ${fmt(s.needed)} בחודש, ובפועל אתה מפקיד בממוצע ${fmt(s.pace)}.`);
  for (const s of open.filter(s => s.status === 'overdue')) add('warn', '📅', `${s.goal.name}: תאריך היעד עבר`, `חסרים עוד ${fmt(s.remaining)}. אפשר לקבוע תאריך חדש והאפליקציה תחשב כמה להפקיד בחודש.`);
  if (avgNet != null && avgNet > 0) {
    const sug = roundTo(avgNet * 0.5, 50), head = open.sort((a, b) => a.remaining - b.remaining)[0];
    const eta = head ? Math.ceil(head.remaining / sug) : null;
    add('info', '💡', `הצעה: ${fmt(sug)} בחודש לחיסכון`, `העודף החודשי הממוצע שלך ב-${tr.length} החודשים האחרונים הוא ${fmt(avgNet)}. הפרשה של חצי ממנו משאירה לך מרווח לחודשים חלשים${eta ? `, ו"${head.goal.name}" יושלם בערך בעוד ${eta} חודשים` : ''}.`);
    const needed = round2(open.reduce((a, s) => a + s.needed, 0));
    if (needed > avgNet && open.some(s => s.needed)) add('warn', '⚖️', 'היעדים דורשים יותר מהעודף שלך', `סך ההפקדות הנדרשות לפי התאריכים הוא ${fmt(needed)} בחודש, מעל העודף הממוצע (${fmt(avgNet)}). כדאי להרחיק תאריך או להקטין יעד.`);
    const mo = monthAllocation(goals, entries, cur, scope, today);
    if (month === cur && open.length && mo.deposits === 0 && !mo.planned.length && +today.slice(8, 10) >= 12) add('info', '🗓️', 'עוד לא הפקדת החודש', `יש עודף ממוצע של ${fmt(avgNet)}. הפקדה קטנה עכשיו שומרת על הרצף.`);
  } else if (avgNet != null && avgNet <= 0) {
    add('warn', '🧭', 'כרגע אין עודף חודשי', 'ב-3 החודשים האחרונים ההוצאות היו גבוהות מההכנסות או שוות להן. אפשר להתחיל בהפקדה קבועה קטנה, למשל 100 ₪, כדי לבנות הרגל.');
  }
  if (avgExp && !goals.some(g => /חירום/.test(g.name))) add('info', '🛡️', 'קרן חירום: 3 חודשי הוצאות', `ההוצאות החודשיות הממוצעות שלך הן ${fmt(avgExp)}, כלומר קרן חירום של ${fmt(avgExp * 3)}. כעצמאי עם הכנסה משתנה היא מקנה שקט.`);
  if (!out.length) add('info', '🌱', 'אפשר להתחיל בקטן', 'הגדר יעד אחד עם סכום ותאריך, והאפליקציה תחשב כמה להפקיד בכל חודש.');
  return out.slice(0, 6);
}
