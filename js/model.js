// Pure calculations (no DOM): months, balances, recurring generation, aggregates, turnover.
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = s => s.slice(0, 7);
export const todayStr = () => ymd(new Date());
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1..12
export function addMonths(key, n) { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function monthRange(fromKey, toKey) { const out = []; for (let k = fromKey; k <= toKey; k = addMonths(k, 1)) out.push(k); return out; }
export function occurrenceDate(rec, key) { const [y, m] = key.split('-').map(Number); return `${key}-${pad(Math.min(rec.day_of_month || 1, daysInMonth(y, m)))}`; }
export const round2 = x => Math.round((+x + Number.EPSILON) * 100) / 100;

function recActiveIn(rec, key) {
  if (!rec.active) return false;
  if (rec.start_month && key < monthKey(rec.start_month)) return false;
  if (rec.end_month && key > monthKey(rec.end_month)) return false;
  return true;
}

/** Recurring occurrences whose date has arrived (<= today) and that aren't recorded yet. */
export function dueRecurring(recurring, txs, today = todayStr()) {
  const have = new Set(txs.filter(t => t.recurring_id).map(t => t.recurring_id + '|' + t.date));
  const out = [];
  for (const r of recurring) {
    if (!r.active) continue;
    const from = monthKey(r.start_month || today);
    // never back-fill more than 12 months in one go
    const start = from < addMonths(monthKey(today), -11) ? addMonths(monthKey(today), -11) : from;
    for (const key of monthRange(start, monthKey(today))) {
      if (!recActiveIn(r, key)) continue;
      const date = occurrenceDate(r, key);
      if (date > today || have.has(r.id + '|' + date)) continue;
      out.push({ kind: r.kind, amount: +r.amount, date, category_id: r.category_id || null, scope: r.scope, title: r.title, notes: r.notes || null, recurring_id: r.id });
    }
  }
  return out;
}

/** Recurring items still expected later in the given month (not yet recorded). */
export function plannedFor(recurring, txs, key, today = todayStr()) {
  const have = new Set(txs.filter(t => t.recurring_id).map(t => t.recurring_id + '|' + t.date));
  const out = [];
  if (key < monthKey(today)) return out;
  for (const r of recurring) {
    if (!recActiveIn(r, key)) continue;
    const date = occurrenceDate(r, key);
    if (date <= today && key === monthKey(today)) continue; // already due → auto-added
    if (have.has(r.id + '|' + date)) continue;
    out.push({ planned: true, id: 'plan-' + r.id + '-' + date, kind: r.kind, amount: +r.amount, date, category_id: r.category_id, scope: r.scope, title: r.title, recurring_id: r.id });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const byScope = (list, scope) => scope === 'all' ? list : list.filter(t => t.scope === scope);

export function monthSummary(txs, recurring, key, scope = 'all', today = todayStr()) {
  const list = byScope(txs.filter(t => monthKey(t.date) === key), scope);
  const planned = byScope(plannedFor(recurring, txs, key, today), scope);
  const sum = (l, k) => round2(l.filter(t => t.kind === k).reduce((a, t) => a + +t.amount, 0));
  const income = sum(list, 'income'), expense = sum(list, 'expense');
  const plannedIncome = sum(planned, 'income'), plannedExpense = sum(planned, 'expense');
  const net = round2(income - expense);
  const projected = round2(net + plannedIncome - plannedExpense);
  const [y, m] = key.split('-').map(Number);
  const dim = daysInMonth(y, m);
  const isCurrent = key === monthKey(today);
  const daysLeft = isCurrent ? dim - +today.slice(8, 10) + 1 : (key > monthKey(today) ? dim : 0);
  return { key, list, planned, income, expense, net, plannedIncome, plannedExpense, projected, daysLeft, perDay: daysLeft > 0 ? Math.max(0, projected) / daysLeft : 0, isCurrent };
}

export function byCategory(list, cats, kind) {
  const map = new Map();
  for (const t of list) {
    if (t.kind !== kind) continue;
    const c = cats.find(c => c.id === t.category_id);
    const id = c ? c.id : 'none';
    const cur = map.get(id) || { id, name: c ? c.name : 'ללא קטגוריה', color: c ? c.color : '#6f6a62', icon: c ? c.icon : '•', total: 0, count: 0 };
    cur.total = round2(cur.total + +t.amount); cur.count++; map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function trend(txs, endKey, n = 6, scope = 'all') {
  const keys = monthRange(addMonths(endKey, -(n - 1)), endKey);
  const list = byScope(txs, scope);
  return keys.map(k => {
    const l = list.filter(t => monthKey(t.date) === k);
    const income = round2(l.filter(t => t.kind === 'income').reduce((a, t) => a + +t.amount, 0));
    const expense = round2(l.filter(t => t.kind === 'expense').reduce((a, t) => a + +t.amount, 0));
    return { key: k, income, expense, net: round2(income - expense) };
  });
}

export function budgets(txs, cats, key, scope = 'all') {
  const list = byScope(txs.filter(t => monthKey(t.date) === key && t.kind === 'expense'), scope);
  return cats.filter(c => c.kind === 'expense' && !c.archived).map(c => {
    const spent = round2(list.filter(t => t.category_id === c.id).reduce((a, t) => a + +t.amount, 0));
    const budget = c.monthly_budget == null ? null : +c.monthly_budget;
    const pct = budget ? spent / budget : null;
    return { cat: c, spent, budget, pct, state: pct == null ? 'none' : pct > 1 ? 'over' : pct >= .8 ? 'mid' : 'ok' };
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.spent - a.spent);
}

/** Osek patur: business income (turnover, before expenses) in a calendar year + straight-line projection. */
export function turnover(txs, year, ceiling, today = todayStr()) {
  const ytd = round2(txs.filter(t => t.kind === 'income' && t.scope === 'business' && t.date.startsWith(String(year))).reduce((a, t) => a + +t.amount, 0));
  const yNow = +today.slice(0, 4);
  let projection = ytd;
  if (year === yNow) {
    const start = new Date(year, 0, 1), now = new Date(today + 'T12:00:00');
    const day = Math.max(1, Math.round((now - start) / 864e5) + 1), days = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
    projection = round2(ytd / day * days);
  }
  const pct = ceiling ? ytd / ceiling : 0;
  return { year, ytd, ceiling, left: round2(ceiling - ytd), pct, projection, projPct: ceiling ? projection / ceiling : 0, state: pct >= 1 ? 'over' : (pct >= .85 || projection > ceiling) ? 'mid' : 'ok' };
}

export function filterTx(txs, f, cats) {
  const q = (f.q || '').trim().toLowerCase();
  return txs.filter(t => {
    if (f.kind && f.kind !== 'all' && t.kind !== f.kind) return false;
    if (f.scope && f.scope !== 'all' && t.scope !== f.scope) return false;
    if (f.cat && f.cat !== 'all' && (t.category_id || 'none') !== f.cat) return false;
    if (f.receipt === 'yes' && !t.receipt_path) return false;
    if (f.receipt === 'no' && t.receipt_path) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q) {
      const c = cats.find(c => c.id === t.category_id);
      const hay = [t.title, t.notes, c?.name, t.payment_method, String(t.amount)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
