import { uuid } from './store.js';
import { addMonths, monthKey, pad } from './model.js';

// Starter categories tuned for a photography studio owner + household.
export const DEFAULT_CATEGORIES = [
  { kind: 'income', name: 'חתונות ואירועים', icon: '💍', color: '#d4af6a' },
  { kind: 'income', name: 'צילומי סטודיו', icon: '📸', color: '#5fd39a' },
  { kind: 'income', name: 'אלבומים והדפסות', icon: '📔', color: '#7aa7ff' },
  { kind: 'income', name: 'מדריכים דיגיטליים', icon: '🎓', color: '#c38bff' },
  { kind: 'income', name: 'הכנסה אחרת', icon: '➕', color: '#a3b6c9' },
  { kind: 'expense', name: 'שכירות סטודיו', icon: '🏠', color: '#d4af6a' },
  { kind: 'expense', name: 'ציוד צילום', icon: '📷', color: '#7aa7ff' },
  { kind: 'expense', name: 'תוכנות ומנויים', icon: '💻', color: '#c38bff' },
  { kind: 'expense', name: 'שיווק ופרסום', icon: '📣', color: '#ff9f5a' },
  { kind: 'expense', name: 'רכב ודלק', icon: '🚗', color: '#4fd1d9' },
  { kind: 'expense', name: 'מס הכנסה וביטוח לאומי', icon: '🏛️', color: '#a3b6c9' },
  { kind: 'expense', name: 'מזון וסופר', icon: '🛒', color: '#5fd39a' },
  { kind: 'expense', name: 'חשבונות בית', icon: '💡', color: '#f1b649' },
  { kind: 'expense', name: 'בילויים ומסעדות', icon: '🍷', color: '#ff8a91' },
  { kind: 'expense', name: 'בריאות וביטוחים', icon: '🩺', color: '#9be7c0' },
  { kind: 'expense', name: 'אחר', icon: '•', color: '#6f6a62' },
];

/** Realistic sample data for the preview only (local mode). */
export function sampleData(cats, today) {
  const C = n => cats.find(c => c.name === n)?.id || null;
  const cur = monthKey(today); const txs = []; const recurring = [];
  const rec = (kind, amount, cat, scope, title, day) => { const r = { id: uuid(), kind, amount, category_id: C(cat), scope, title, day_of_month: day, start_month: addMonths(cur, -5) + '-01', active: true }; recurring.push(r); return r; };
  rec('expense', 3200, 'שכירות סטודיו', 'business', 'שכירות סטודיו קריית ביאליק', 1);
  rec('expense', 89, 'תוכנות ומנויים', 'business', 'Adobe Photography Plan', 5);
  rec('expense', 45, 'תוכנות ומנויים', 'business', 'Google Workspace', 12);
  rec('expense', 1250, 'מס הכנסה וביטוח לאומי', 'business', 'מקדמות מס + ביטוח לאומי', 15);
  rec('expense', 380, 'חשבונות בית', 'personal', 'חשמל, מים וארנונה', 20);
  rec('expense', 240, 'בריאות וביטוחים', 'personal', 'ביטוח בריאות', 28);
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 5; i >= 0; i--) {
    const k = addMonths(cur, -i); const lastDay = k === cur ? +today.slice(8, 10) : 28;
    const d = n => `${k}-${pad(Math.min(n, lastDay))}`;
    const add = (kind, amount, cat, scope, title, day, extra = {}) => { if (day <= lastDay || k !== cur) txs.push({ id: uuid(), kind, amount, date: d(day), category_id: C(cat), scope, title, ...extra }); };
    const wed = 1 + Math.round(rnd() * 2);
    for (let w = 0; w < wed; w++) add('income', [6500, 7800, 9200][Math.floor(rnd() * 3)], 'חתונות ואירועים', 'business', ['חתונה – משפחת לוי', 'בר מצווה – משפחת כהן', 'חתונה – אולמי הגליל'][w % 3], 6 + w * 9, { payment_method: 'העברה בנקאית', receipt_name: null });
    add('income', 900 + Math.round(rnd() * 8) * 150, 'צילומי סטודיו', 'business', 'צילומי משפחה בסטודיו', 9, { payment_method: 'ביט / פייבוקס' });
    add('income', 650 + Math.round(rnd() * 6) * 100, 'צילומי סטודיו', 'business', 'צילומי תדמית', 17, { payment_method: 'אשראי' });
    if (rnd() > .4) add('income', 1200 + Math.round(rnd() * 5) * 200, 'אלבומים והדפסות', 'business', 'אלבום חתונה', 22, { payment_method: 'העברה בנקאית' });
    add('income', 300 + Math.round(rnd() * 8) * 50, 'מדריכים דיגיטליים', 'business', 'מכירות מדריכים באתר', 25, { payment_method: 'אשראי' });
    add('expense', 1800 + Math.round(rnd() * 10) * 60, 'מזון וסופר', 'personal', 'סופר', 4, { payment_method: 'אשראי' });
    add('expense', 420 + Math.round(rnd() * 6) * 40, 'רכב ודלק', 'business', 'דלק', 11, { payment_method: 'אשראי' });
    add('expense', 300 + Math.round(rnd() * 8) * 60, 'בילויים ומסעדות', 'personal', 'מסעדה', 14, { payment_method: 'אשראי' });
    add('expense', 500 + Math.round(rnd() * 8) * 100, 'שיווק ופרסום', 'business', 'קמפיין פייסבוק ואינסטגרם', 8, { payment_method: 'אשראי' });
    if (i === 2) add('expense', 4890, 'ציוד צילום', 'business', 'עדשה Sigma 85mm', 19, { payment_method: 'אשראי', notes: 'קבלה מס׳ 55821' });
    if (i === 0) add('expense', 690, 'ציוד צילום', 'business', 'כרטיסי זיכרון וסוללות', 21, { payment_method: 'אשראי' });
  }
  // budgets on a few categories
  const budgets = { 'מזון וסופר': 2200, 'בילויים ומסעדות': 600, 'שיווק ופרסום': 1200, 'רכב ודלק': 700, 'ציוד צילום': 1000 };
  const catsOut = cats.filter(c => c.name in budgets).map(c => ({ ...c, monthly_budget: budgets[c.name] }));
  return { cats: catsOut, txs, recurring };
}
