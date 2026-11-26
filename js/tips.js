// Financial tips: rule-based (always on, offline) + optional Gemini tips from aggregated numbers only.
import { CONFIG } from './config.js';
import { monthSummary, trend, budgets, turnover, byCategory, addMonths, byScope } from './model.js';

export function ruleTips(S, fmt) {
  const { txs, cats, recurring, month, scope, settings } = S;
  const tips = [];
  const sm = monthSummary(txs, recurring, month, scope);
  const tr = trend(txs, month, 4, scope);
  const prev = tr.slice(0, 3).filter(m => m.income || m.expense);
  const avgExp = prev.length ? prev.reduce((a, m) => a + m.expense, 0) / prev.length : 0;
  const avgInc = prev.length ? prev.reduce((a, m) => a + m.income, 0) / prev.length : 0;
  const add = (level, icon, title, text) => tips.push({ level, icon, title, text });

  if (!sm.income && !sm.expense && !sm.planned.length) { add('info', '✦', 'בוא נתחיל', 'הוסף כמה הכנסות והוצאות של החודש, וכאן יופיעו טיפים שמבוססים על הנתונים שלך.'); return tips; }

  // savings rate
  const inc = sm.income + sm.plannedIncome, exp = sm.expense + sm.plannedExpense;
  if (inc > 0) {
    const rate = (inc - exp) / inc;
    if (rate < 0) add('warn', '!', 'החודש צפוי להסתיים במינוס', `לפי ההכנסות, ההוצאות והחיובים הקבועים, החודש צפוי להסתיים ב-${fmt(sm.projected)}. כדאי לדחות הוצאות שאינן הכרחיות או להקדים גבייה מלקוחות.`);
    else if (rate < 0.1) add('warn', '%', `שיעור חיסכון נמוך: ${Math.round(rate * 100)}%`, `נשאר רק ${Math.round(rate * 100)}% מההכנסות. יעד בריא הוא 15%–20%. נסה להעביר בתחילת כל חודש סכום קבוע לחיסכון, לפני שמתחילים להוציא.`);
    else if (rate >= 0.2) add('good', '✓', `חוסך ${Math.round(rate * 100)}% מההכנסות`, 'מצוין. את העודף כדאי להעביר לחיסכון או לקרן חירום (3–6 חודשי הוצאות), במקום שיישאר בעו"ש.');
    else add('info', '%', `שיעור חיסכון: ${Math.round(rate * 100)}%`, 'אתה ברווח. עוד דחיפה קטנה תביא אותך ליעד של 20%.');
  }
  // budgets
  const b = budgets(txs, cats, month, scope);
  const over = b.filter(x => x.state === 'over'), near = b.filter(x => x.state === 'mid');
  if (over.length) add('warn', '▲', `חריגה בתקציב: ${over.map(x => x.cat.name).join(', ')}`, over.map(x => `${x.cat.name}: ${fmt(x.spent)} מתוך ${fmt(x.budget)}`).join(' · ') + '. כדאי לעצור הוצאות בקטגוריה עד סוף החודש.');
  if (near.length) add('info', '◔', `מתקרב לגבול: ${near.map(x => x.cat.name).join(', ')}`, near.map(x => `${x.cat.name} ${Math.round(x.pct * 100)}%`).join(' · '));
  if (!b.some(x => x.budget) && cats.some(c => c.kind === 'expense')) add('info', '◎', 'עדיין לא הגדרת תקציבים', 'הגדרת תקרה חודשית לקטגוריות כמו מזון, בילויים ושיווק היא הדרך הכי פשוטה לשלוט בהוצאות. אפשר לעשות את זה בלשונית "תקציבים".');
  // trend vs average
  if (avgExp > 0 && sm.expense > avgExp * 1.2 && sm.isCurrent === false) add('warn', '↗', 'הוצאות גבוהות מהרגיל', `ההוצאות החודש (${fmt(sm.expense)}) גבוהות ב-${Math.round((sm.expense / avgExp - 1) * 100)}% מהממוצע של החודשים הקודמים (${fmt(avgExp)}).`);
  if (avgExp > 0 && sm.isCurrent && sm.expense > avgExp) add('warn', '↗', 'עברת את ממוצע ההוצאות כבר עכשיו', `הוצאת ${fmt(sm.expense)} החודש, יותר מהממוצע החודשי (${fmt(avgExp)}), ועוד לא נגמר החודש.`);
  if (avgInc > 0 && sm.isCurrent === false && sm.income < avgInc * 0.75) add('info', '↘', 'חודש חלש בהכנסות', `ההכנסות נמוכות ב-${Math.round((1 - sm.income / avgInc) * 100)}% מהממוצע. לעסק עונתי כמו צילום כדאי לבנות כרית מהחודשים החזקים.`);
  // top category
  const top = byCategory(sm.list, cats, 'expense')[0];
  if (top && sm.expense > 0 && top.total / sm.expense > 0.35) add('info', '◕', `${top.name} = ${Math.round(top.total / sm.expense * 100)}% מההוצאות`, 'זו הקטגוריה הגדולה ביותר החודש. בדיקה של ספקים או חבילות בקטגוריה הזאת תחסוך הכי הרבה.');
  // subscriptions
  const subs = recurring.filter(r => r.active && r.kind === 'expense');
  const subsTotal = subs.reduce((a, r) => a + +r.amount, 0);
  if (subs.length >= 3) add('info', '↻', `${subs.length} חיובים קבועים: ${fmt(subsTotal)} בחודש`, 'פעם ברבעון כדאי לעבור על המנויים ולבטל את מה שלא בשימוש. זה ' + fmt(subsTotal * 12) + ' בשנה.');
  // business: receipts + profit + taxes
  const bizExp = sm.list.filter(t => t.scope === 'business' && t.kind === 'expense');
  const noRc = bizExp.filter(t => !t.receipt_path);
  if (noRc.length) add('warn', '🧾', `${noRc.length} הוצאות עסקיות בלי קבלה`, 'רואה החשבון יכול להכיר בהוצאה רק עם קבלה. צלם את הקבלה עכשיו, לפני שהיא הולכת לאיבוד.');
  const bizSm = monthSummary(txs, recurring, month, 'business');
  if (scope !== 'personal' && bizSm.income > 0) {
    const margin = (bizSm.income - bizSm.expense) / bizSm.income;
    add(margin > 0.4 ? 'good' : 'info', '₪', `רווחיות העסק החודש: ${Math.round(margin * 100)}%`, `הכנסות עסקיות ${fmt(bizSm.income)}, הוצאות עסקיות ${fmt(bizSm.expense)}. כעוסק פטור אתה עדיין משלם מס הכנסה וביטוח לאומי, אז כדאי לשים בצד חלק קבוע מהרווח למקדמות. את השיעור המדויק כדאי לבדוק מול רואה החשבון.`);
  }
  // turnover
  const year = +month.slice(0, 4);
  const to = turnover(txs, year, +settings.turnoverCeiling || CONFIG.turnover.ceiling2026);
  if (to.ytd > 0 && scope !== 'personal') {
    if (to.state === 'over') add('warn', '⚠', 'עברת את תקרת עוסק פטור', `המחזור העסקי השנה הוא ${fmt(to.ytd)}, מעל התקרה (${fmt(to.ceiling)}). לפי החוק צריך להודיע למע"מ תוך 15 יום ולעבור לעוסק מורשה. דבר עם רואה החשבון בהקדם.`);
    else if (to.projection > to.ceiling) add('warn', '⚠', 'בקצב הנוכחי תעבור את תקרת עוסק פטור', `צפי לסוף השנה: ${fmt(to.projection)} (התקרה ${fmt(to.ceiling)}). נשאר מרווח של ${fmt(to.left)}. כדאי לתכנן מול רואה החשבון עכשיו.`);
    else add('good', '✓', `מחזור עסקי: ${Math.round(to.pct * 100)}% מהתקרה`, `נשאר מרווח של ${fmt(to.left)} עד תקרת עוסק פטור לשנת ${year}.`);
  }
  // emergency fund hint (6-month avg expense)
  const t6 = trend(txs, addMonths(month, -1), 6, 'all').filter(m => m.expense);
  if (t6.length >= 3) { const avg = t6.reduce((a, m) => a + m.expense, 0) / t6.length; add('info', '☂', `קרן חירום מומלצת: בין ${fmt(avg * 3)} ל-${fmt(avg * 6)}`, 'לפי ממוצע ההוצאות שלך, 3 עד 6 חודשי הוצאות. לעצמאי עם הכנסה משתנה עדיף לכוון לצד הגבוה.'); }
  const order = { warn: 0, good: 1, info: 2 };
  return tips.sort((a, b) => order[a.level] - order[b.level]).slice(0, 8);
}

/** Only aggregated numbers + category names leave the device. No notes, titles, receipts or dates of individual items. */
export function aggregatesForAI(S) {
  const { txs, cats, recurring, month, scope, settings } = S;
  const sm = monthSummary(txs, recurring, month, scope);
  const r = n => Math.round(n);
  return {
    month, scope, currency: 'ILS', business_type: 'סטודיו לצילום, עוסק פטור בישראל',
    this_month: { income: r(sm.income), expense: r(sm.expense), planned_income: r(sm.plannedIncome), planned_expense: r(sm.plannedExpense), projected_end_balance: r(sm.projected), days_left: sm.daysLeft },
    expenses_by_category: byCategory(sm.list, cats, 'expense').map(c => ({ category: c.name, total: r(c.total) })),
    income_by_category: byCategory(sm.list, cats, 'income').map(c => ({ category: c.name, total: r(c.total) })),
    budgets: budgets(txs, cats, month, scope).filter(b => b.budget).map(b => ({ category: b.cat.name, budget: r(b.budget), spent: r(b.spent) })),
    last_6_months: trend(txs, month, 6, scope).map(m => ({ month: m.key, income: r(m.income), expense: r(m.expense) })),
    business_vs_personal: ['business', 'personal'].map(s => { const x = monthSummary(txs, recurring, month, s); return { scope: s, income: r(x.income), expense: r(x.expense) }; }),
    recurring_monthly: { expense: r(recurring.filter(x => x.active && x.kind === 'expense').reduce((a, x) => a + +x.amount, 0)), income: r(recurring.filter(x => x.active && x.kind === 'income').reduce((a, x) => a + +x.amount, 0)) },
    osek_patur: (() => { const t = turnover(txs, +month.slice(0, 4), +settings.turnoverCeiling || CONFIG.turnover.ceiling2026); return { ytd_turnover: r(t.ytd), ceiling: t.ceiling, projected_year_end: r(t.projection) }; })(),
  };
}

export async function aiTips(apiKey, agg, signal) {
  const prompt = `אתה יועץ פיננסי אישי מנוסה לעצמאים בישראל. לפניך נתונים מצרפיים (בשקלים) של צלם עם סטודיו שהוא עוסק פטור, ומנהל באותה אפליקציה גם את התקציב הפרטי שלו.
כתוב 5 טיפים קונקרטיים, מעשיים ומותאמים בדיוק למספרים האלה (ציין מספרים ספציפיים מהנתונים). אל תמציא נתונים שלא קיימים. אל תיתן ייעוץ השקעות ספציפי (מניות/קרנות). בנושאי מס, כתוב שכדאי לאמת מול רואה חשבון.
ענה ב-JSON בלבד: {"tips":[{"title":"כותרת קצרה עד 8 מילים","text":"1–2 משפטים","level":"warn|good|info"}]}.
הנתונים:\n${JSON.stringify(agg)}`;
  let lastErr;
  for (const model of CONFIG.gemini.models) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), CONFIG.gemini.timeoutMs);
    signal?.addEventListener('abort', () => ctl.abort());
    try {
      const res = await fetch(`${CONFIG.gemini.apiBase}/models/${model}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.6 } }),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error(j.error?.message || 'מפתח Gemini לא תקין'), { fatal: true }); }
      if (!res.ok) { lastErr = new Error(res.status === 429 ? 'המכסה היומית של Gemini נוצלה' : res.status === 503 ? 'שרתי Gemini עמוסים' : 'שגיאת Gemini ' + res.status); continue; }
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      const parsed = JSON.parse(text.replace(/^```json|```$/g, '').trim());
      return { model, tips: (parsed.tips || []).slice(0, 6).map(t => ({ level: 'ai', icon: '✦', title: String(t.title || ''), text: String(t.text || '') })) };
    } catch (e) {
      if (e.fatal) throw e; lastErr = e.name === 'AbortError' ? new Error('Gemini לא ענה בזמן') : e;
    } finally { clearTimeout(to); }
  }
  throw lastErr || new Error('Gemini לא זמין כרגע');
}

/** Cheap key check that doesn't depend on model load (lists models). */
export async function checkKey(apiKey) {
  const r = await fetch(`${CONFIG.gemini.apiBase}/models?pageSize=1`, { headers: { 'x-goog-api-key': apiKey } });
  return r.ok;
}
