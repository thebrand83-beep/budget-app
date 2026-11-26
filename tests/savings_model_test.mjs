// Pure-logic tests for the savings area (js/savings.js + the "left" allocation in js/model.js). No network.
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as SV from '../js/savings.js';
const today = '2026-11-26', ok = m => console.log('PASS:', m);
const E = (goal_id, kind, amount, date, extra = {}) => ({ id: `${goal_id}${kind}${date}${amount}`, goal_id, kind, amount, date, ...extra });
const G = (o = {}) => ({ id: 'g1', name: 'חופשה', icon: '🏝️', color: '#4fd1d9', target_amount: 12000, target_date: null, scope: null, auto_amount: null, auto_day: 1, auto_start: null, auto_skip: [], ...o });

// balance, withdrawals, rounding
{
  const g = G(), es = [E('g1', 'deposit', 1000.1, '2026-10-01'), E('g1', 'deposit', 500.2, '2026-10-05'), E('g1', 'withdrawal', 300.3, '2026-10-20'), E('other', 'deposit', 9999, '2026-10-01')];
  assert.equal(SV.goalSaved(g, es), 1200); ok('balance = deposits - withdrawals, per goal, no float drift');
  const st = SV.goalStats(g, es, today);
  assert.equal(st.saved, 1200); assert.equal(st.remaining, 10800); assert.equal(st.pct, 0.1); assert.equal(st.done, false); assert.equal(st.status, 'open'); assert.equal(st.needed, 0);
  ok('stats without a date: no monthly need, status open');
}
// needed per month: current + target months inclusive
{
  const g = G({ target_date: '2027-04-15' }), es = [E('g1', 'deposit', 2000, '2026-11-02')];
  const st = SV.goalStats(g, es, today);
  assert.equal(st.monthsLeft, 6); assert.equal(st.needed, 1666.67); ok('needed per month: (12000-2000)/6 months (Nov..Apr)');
  assert.equal(SV.goalStats(G({ target_date: '2026-11-30' }), [], today).monthsLeft, 1); ok('target inside this month = 1 month');
  assert.equal(SV.goalStats(G({ target_date: '2026-10-01' }), [], today).status, 'overdue'); ok('past date = overdue');
  assert.equal(SV.goalStats(G(), [E('g1', 'deposit', 12000, '2026-11-01')], today).status, 'done'); ok('reaching the target = done');
  assert.equal(SV.goalStats(g, [E('g1', 'deposit', 300, '2026-08-02'), E('g1', 'deposit', 300, '2026-09-02'), E('g1', 'deposit', 300, '2026-10-02')], today).status, 'behind');
  assert.equal(SV.goalStats(G({ target_date: '2027-04-15' }), [E('g1', 'deposit', 3000, '2026-08-02'), E('g1', 'deposit', 3000, '2026-09-02'), E('g1', 'deposit', 3000, '2026-10-02')], today).status, 'ontrack'); ok('pace vs need: behind / on track');
}
// scope filter
{
  const gs = [G({ id: 'b', scope: 'business' }), G({ id: 'p', scope: 'personal' }), G({ id: 'n', scope: null })];
  assert.deepEqual(SV.totals(gs, [], 'business', today).stats.map(s => s.goal.id), ['b']);
  assert.deepEqual(SV.totals(gs, [], 'all', today).stats.map(s => s.goal.id), ['b', 'p', 'n']); ok('business/personal tag filters goals; "all" shows everything');
}
// automatic monthly deposit: once per month, from auto_start, skip months, stop at target, max 12 months back
{
  const g = G({ auto_amount: 1000, auto_day: 5, auto_start: '2026-09-01' });
  let due = SV.dueAuto([g], [], today);
  assert.deepEqual(due.map(d => d.auto_date), ['2026-09-05', '2026-10-05', '2026-11-05']); assert.ok(due.every(d => d.kind === 'deposit' && d.amount === 1000)); ok('auto deposits generated for each due month');
  const es = due.map((d, i) => ({ ...d, id: 'x' + i }));
  assert.equal(SV.dueAuto([g], es, today).length, 0); ok('idempotent: nothing generated twice');
  const moved = es.map(e => e.auto_date === '2026-11-05' ? { ...e, date: '2026-11-09' } : e);
  assert.equal(SV.dueAuto([g], moved, today).length, 0); ok('an edited date inside the month is not duplicated');
  assert.deepEqual(SV.dueAuto([{ ...g, auto_skip: ['2026-10'] }], [], today).map(d => d.auto_date), ['2026-09-05', '2026-11-05']); ok('skipped (deleted) month stays skipped');
  assert.equal(SV.dueAuto([{ ...g, auto_start: '2020-01-01' }], [], today).length, 12); ok('never back-fills more than 12 months');
  assert.equal(SV.dueAuto([{ ...g, target_amount: 1500 }], [], today).length, 2); ok('stops once the goal is reached (1000 + 1000 >= 1500)');
  assert.equal(SV.dueAuto([{ ...g, auto_day: 31 }], [], '2026-11-26').map(d => d.date).includes('2026-11-30'), false); ok('day later than today is not due yet');
  assert.equal(SV.dueAuto([{ ...g, auto_day: 31, auto_start: '2026-10-01' }], [], today)[0].date, '2026-10-31'); ok('day 31 clamps to month length (Nov 30 / Oct 31)');
  assert.equal(SV.dueAuto([G()], [], today).length, 0); ok('goal without auto amount generates nothing');
}
// month allocation: deposits reduce "left", NOT counted as expense; planned auto counted
{
  const rec = [], txs = [{ id: 't1', kind: 'income', amount: 10000, date: '2026-11-03', scope: 'personal' }, { id: 't2', kind: 'expense', amount: 4000, date: '2026-11-04', scope: 'personal' }];
  const g = G({ auto_amount: 700, auto_day: 28, auto_start: '2026-11-01' }), es = [E('g1', 'deposit', 1500, '2026-11-10'), E('g1', 'withdrawal', 200, '2026-11-12'), E('g1', 'deposit', 999, '2026-10-12')];
  const al = SV.monthAllocation([g], es, '2026-11', 'all', today);
  assert.equal(al.deposits, 1500); assert.equal(al.withdrawals, 200); assert.equal(al.net, 1300); assert.equal(al.plannedAmount, 700); assert.equal(al.planned.length, 1);
  const sm = M.monthSummary(txs, rec, '2026-11', 'all', today, al);
  assert.equal(sm.expense, 4000); assert.equal(sm.income, 10000); assert.equal(sm.net, 6000); ok('expense/income/net are unaffected by savings');
  assert.equal(sm.saved, 1300); assert.equal(sm.plannedSaved, 700); assert.equal(sm.projected, 6000); assert.equal(sm.left, 4000); ok('left = projected - net deposits - planned auto deposits');
  assert.equal(M.monthSummary(txs, rec, '2026-11', 'all', today).left, 6000); ok('no savings given: left == projected (backward compatible)');
  assert.equal(M.byCategory(txs, [], 'expense').reduce((a, c) => a + c.total, 0), 4000); ok('expense charts ignore savings');
  assert.equal(SV.monthAllocation([{ ...g, scope: 'business' }], es, '2026-11', 'personal', today).net, 0); ok('allocation respects the business/personal scope');
  const w = SV.monthAllocation([g], [E('g1', 'withdrawal', 500, '2026-11-12')], '2026-11', 'all', today);
  assert.equal(M.monthSummary(txs, rec, '2026-11', 'all', today, w).saved, -500); ok('a withdrawal gives money back to the month');
}
// range + tips
{
  const g = G(), es = [E('g1', 'deposit', 1, '2026-09-30'), E('g1', 'deposit', 2, '2026-10-01'), E('g1', 'deposit', 3, '2026-10-31'), E('g1', 'deposit', 4, '2026-11-01')];
  assert.deepEqual(SV.entriesInRange([g], es, { from: '2026-10-01', to: '2026-10-31' }).map(e => e.amount), [2, 3]); ok('report range is inclusive');
  const txs = []; for (const m of ['2026-08', '2026-09', '2026-10']) { txs.push({ id: 'i' + m, kind: 'income', amount: 12000, date: m + '-03', scope: 'personal' }, { id: 'e' + m, kind: 'expense', amount: 8000, date: m + '-04', scope: 'personal' }); }
  const tips = SV.savingsTips({ goals: [G({ target_date: '2027-04-15' })], entries: [], txs, month: '2026-11', scope: 'all', today, fmt: v => '₪' + v });
  assert.ok(tips.length >= 1 && tips.length <= 6); assert.ok(tips.some(t => /הצעה: ₪2000/.test(t.title)), 'suggestion = half of the 4000 average surplus'); ok('tips: suggested amount from the average monthly surplus');
  assert.ok(SV.savingsTips({ goals: [], entries: [], txs: [], month: '2026-11', today, fmt: v => v }).length >= 1); ok('tips never empty (fallback)');
}
console.log('ALL SAVINGS MODEL CHECKS PASSED');
