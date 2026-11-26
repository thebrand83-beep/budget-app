import assert from 'node:assert/strict';
import * as M from '../js/model.js';
const rec = [{ id: 'r1', kind: 'expense', amount: 3200, day_of_month: 1, start_month: '2026-09-01', active: true, scope: 'business', title: 'שכירות' },
             { id: 'r2', kind: 'income', amount: 9000, day_of_month: 31, start_month: '2026-11-01', active: true, scope: 'personal', title: 'משכורת' },
             { id: 'r3', kind: 'expense', amount: 50, day_of_month: 28, start_month: '2026-11-01', active: false, scope: 'personal', title: 'כבוי' }];
const today = '2026-11-26';
let txs = [{ id: 'a', kind: 'expense', amount: 3200, date: '2026-10-01', recurring_id: 'r1', scope: 'business' }];
const due = M.dueRecurring(rec, txs, today);
assert.deepEqual(due.map(d => d.recurring_id + d.date), ['r12026-09-01', 'r12026-11-01']);
txs = txs.concat(due.map((d, i) => ({ ...d, id: 'g' + i })));
assert.equal(M.dueRecurring(rec, txs, today).length, 0, 'idempotent');
const plan = M.plannedFor(rec, txs, '2026-11', today);
assert.deepEqual(plan.map(p => p.date), ['2026-11-30'], 'r2 clamps day 31 to Nov 30');
txs.push({ id: 'i1', kind: 'income', amount: 1800.5, date: '2026-11-10', scope: 'business', category_id: 'c1' });
const s = M.monthSummary(txs, rec, '2026-11', 'all', today);
assert.equal(s.income, 1800.5); assert.equal(s.expense, 3200); assert.equal(s.net, -1399.5); assert.equal(s.projected, 7600.5); assert.equal(s.daysLeft, 5);
assert.equal(M.monthSummary(txs, rec, '2026-11', 'business', today).projected, -1399.5);
const t = M.turnover(txs, 2026, 122833, today);
assert.equal(t.ytd, 1800.5); assert.ok(t.projection > t.ytd);
assert.equal(M.addMonths('2026-12', 1), '2027-01');

// v2: one occurrence per rule per month (an occurrence whose date was edited is not re-added), and skipped months
{
  const r = [{ id: 'm1', active: true, kind: 'expense', amount: 100, day_of_month: 5, start_month: '2026-10-01', scope: 'personal', title: 'x' }];
  const moved = [{ id: 'a', recurring_id: 'm1', date: '2026-10-05', kind: 'expense', amount: 100, scope: 'personal' },
                 { id: 'b', recurring_id: 'm1', date: '2026-11-09', kind: 'expense', amount: 100, scope: 'personal' }]; // Nov occurrence moved from 5th to 9th
  assert.equal(M.dueRecurring(r, moved, '2026-11-26').length, 0, 'edited date inside the month is not duplicated');
  assert.equal(M.plannedFor(r, moved, '2026-11', '2026-11-02').length, 0, 'not planned again either');
  const skipped = [{ ...r[0], skip_months: ['2026-11'] }];
  assert.deepEqual(M.dueRecurring(skipped, [moved[0]], '2026-11-26').map(d => d.date), [], 'deleted-on-purpose month stays deleted');
  assert.deepEqual(M.dueRecurring(skipped, [moved[0]], '2026-12-26').map(d => d.date), ['2026-12-05'], 'following months continue');
  const ended = [{ ...r[0], end_month: '2026-10-01' }];
  assert.equal(M.dueRecurring(ended, [moved[0]], '2026-12-26').length, 0, 'stopped rule adds nothing after end_month');
}
console.log('model tests: PASS');
