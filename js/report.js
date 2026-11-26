// Report builder: turns a list of transactions into A4 pages (real DOM, 794x1123 CSS px), paginated by measuring.
// The pages are rendered to images (pdf.js) and shown in the in-app report viewer, so the same look appears on
// every device and the PDF never depends on the browser's print dialog.
import { byCategory, round2, monthKey, monthRange } from './model.js';

export const PAGE_W = 794, PAGE_H = 1123;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mname = k => new Date(k + '-15').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
const dmy = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const SCOPE_LBL = { business: 'עסקי בלבד', personal: 'פרטי בלבד', all: 'עסקי + פרטי' };
const KIND = { income: 'הכנסה', expense: 'הוצאה' };
const WALLET = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#14110c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 5.5"/><circle cx="16.5" cy="13.5" r="1.2" fill="#14110c"/></svg>';

/** Describes the report variant: title, period label and what to show, from the selected period + scope. */
export function describe({ periodKey, month, scope, list, today }) {
  const y = month.slice(0, 4);
  const months = [...new Set(list.map(t => monthKey(t.date)))].sort();
  const first = months[0], last = months[months.length - 1];
  const prev = k => { const [yy, mm] = k.split('-').map(Number); const d = new Date(yy, mm - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const V = {
    month: { title: 'דוח חודשי', period: mname(month), multi: false },
    bimonth: { title: 'דוח דו-חודשי', period: `${mname(prev(month))} – ${mname(month)}`, multi: true },
    year: { title: 'דוח שנתי', period: `שנת ${y}`, multi: true },
    all: { title: 'דוח מלא', period: first ? (first === last ? mname(first) : `${mname(first)} – ${mname(last)}`) : 'כל התקופה', multi: months.length > 1 },
  }[periodKey];
  return { ...V, periodKey, scope, scopeLabel: SCOPE_LBL[scope], months, today };
}

export async function buildReport(o) {
  const { host, list, cats, fmt, business = 'Studio Image', owner = '', recMap = new Set(), turnovers = [], receipts = new Map(), includeReceipts, info } = o;
  // plain "1,234.50 ₪" in an LTR island, so the minus/plus sign and the shekel sign never jump around in RTL text
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const money = (v, sign = '') => `<bdi class="mn">${sign}${nf.format(Math.abs(+v || 0) < 0.005 ? 0 : (sign ? Math.abs(+v) : +v))}&nbsp;₪</bdi>`;
  const sum = (l, k) => round2(l.filter(t => t.kind === k).reduce((a, t) => a + +t.amount, 0));
  const income = sum(list, 'income'), expense = sum(list, 'expense'), net = round2(income - expense);
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || '').localeCompare(b.created_at || ''));
  const dateStr = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const catOf = id => cats.find(c => c.id === id);
  // receipt numbering follows the date order, so the table and the appendix agree
  const rcNo = new Map(); sorted.filter(t => t.receipt_path).forEach((t, i) => rcNo.set(t.id, i + 1));
  const pages = [];

  // ---- page factory + flow
  let page = null, body = null;
  const newPage = (first) => {
    const el = document.createElement('section'); el.className = 'rp-page'; el.dir = 'rtl';
    el.innerHTML = first
      ? `<header class="rp-hero"><div class="rp-brand"><span class="rp-mark">${WALLET}</span><span><small>STUDIO IMAGE</small><b>${esc(business)}</b></span></div>
          <div class="rp-title"><h1>${esc(info.title)}</h1><div class="rp-period">${esc(info.period)}</div></div>
          <div class="rp-chips"><span>${esc(info.scopeLabel)}</span><span>${list.length} תנועות</span><span>הופק ${esc(dateStr)}</span></div></header>`
      : `<header class="rp-mini"><span class="rp-mark sm">${WALLET}</span><b>${esc(business)}</b><span class="sp"></span><span>${esc(info.title)} · ${esc(info.period)}</span></header>`;
    el.insertAdjacentHTML('beforeend', `<div class="rp-body"></div><footer class="rp-foot"><span>${esc(business)} · ${esc(info.title)} · ${esc(info.scopeLabel)}</span><span>הופק ${esc(dateStr)}${owner ? ' · ' + esc(owner) : ''}</span><span class="rp-pg"></span></footer>`);
    host.appendChild(el); pages.push(el); page = el; body = el.querySelector('.rp-body'); return el;
  };
  const over = () => body.scrollHeight > body.clientHeight + 1;
  const place = el => { body.appendChild(el); if (over() && body.children.length > 1) { body.removeChild(el); newPage(false); body.appendChild(el); } return el; };
  // a table that continues on the next page with its header repeated
  const table = (title, head, cls = '', sub = '') => {
    let wrap, tb, count = 0;
    const make = cont => {
      wrap = document.createElement('div'); wrap.className = 'rp-sec ' + cls;
      wrap.innerHTML = `<h2>${esc(title)}${sub ? ` <small>${esc(sub)}</small>` : ''}${cont ? ' <small>· המשך</small>' : ''}</h2><table><thead>${head}</thead><tbody></tbody></table>`;
      tb = wrap.querySelector('tbody'); count = 0; body.appendChild(wrap);
    };
    make(false);
    if (over() && body.children.length > 1) { body.removeChild(wrap); newPage(false); make(false); }
    return {
      row(html, { divider = false } = {}) {
        const tr = document.createElement('tr'); tr.innerHTML = html; if (divider) tr.className = 'div'; tb.appendChild(tr); count++;
        if (over() && !(tb.children.length === 1 && body.children.length === 1)) {
          tb.removeChild(tr);
          // don't leave a month divider alone at the bottom of a page
          let carry = null; const lastRow = tb.lastElementChild; if (!divider && lastRow?.classList.contains('div')) { carry = lastRow; tb.removeChild(lastRow); }
          if (!tb.children.length) { body.removeChild(wrap); } 
          newPage(false); make(true); if (carry) tb.appendChild(carry); tb.appendChild(tr);
        }
      },
      end(html) { if (!html) return; const tr = document.createElement('tr'); tr.className = 'tot'; tr.innerHTML = html; tb.appendChild(tr); if (over()) { tb.removeChild(tr); newPage(false); make(true); tb.appendChild(tr); } },
    };
  };
  const sec = (html, cls = '') => { const d = document.createElement('div'); d.className = 'rp-sec ' + cls; d.innerHTML = html; return place(d); };

  newPage(true);

  // ---- 1. summary cards
  const monthsN = Math.max(1, info.months.length);
  const nRec = list.filter(t => t.recurring_id).length, nRc = list.filter(t => t.receipt_path).length;
  const biggest = [...list].filter(t => t.kind === 'expense').sort((a, b) => b.amount - a.amount)[0];
  const stat = (k, v, sub = '') => `<div class="st"><span>${k}</span><b>${v}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  sec(`<div class="rp-kpis">
      <div class="kpi inc"><span>הכנסות</span><b>${money(income)}</b><i></i></div>
      <div class="kpi exp"><span>הוצאות</span><b>${money(expense)}</b><i></i></div>
      <div class="kpi net ${net < 0 ? 'neg' : 'pos'}"><span>${net < 0 ? 'גירעון' : 'מאזן'}</span><b>${money(net)}</b><i></i></div></div>
    <div class="rp-stats">${stat('תנועות', list.length)}${stat('תנועות חוזרות', nRec)}${stat('קבלות מצורפות', nRc)}
      ${info.multi ? stat('ממוצע הוצאות לחודש', money(expense / monthsN), `${monthsN} חודשים`) : stat('ההוצאה הגדולה', biggest ? money(biggest.amount) : '—', biggest ? esc((biggest.title || catOf(biggest.category_id)?.name || '').slice(0, 22)) : '')}</div>`);

  // ---- 2. scope split (business + personal)
  if (info.scope === 'all') {
    const row = (lbl, l) => { const i = sum(l, 'income'), e = sum(l, 'expense'); return `<tr><td><b>${lbl}</b></td><td class="n">${money(i)}</td><td class="n">${money(e)}</td><td class="n ${i - e < 0 ? 'neg' : 'pos'}">${money(i - e)}</td></tr>`; };
    sec(`<h2>פילוח עסקי / פרטי</h2><table><thead><tr><th>סוג</th><th class="n">הכנסות</th><th class="n">הוצאות</th><th class="n">מאזן</th></tr></thead><tbody>${row('עסקי', list.filter(t => t.scope === 'business'))}${row('פרטי', list.filter(t => t.scope === 'personal'))}</tbody></table>`);
  }

  // ---- 3. pie charts
  const donut = (items, total, label, cls) => {
    const sumv = items.reduce((a, i) => a + i.total, 0);
    if (!sumv) return `<div class="rp-card"><h3>${label}</h3><div class="rp-none">אין תנועות בתקופה</div></div>`;
    const top = items.slice(0, 6), rest = items.slice(6);
    const shown = rest.length ? [...top, { name: 'אחר', color: '#9a9284', total: round2(rest.reduce((a, i) => a + i.total, 0)) }] : top;
    const cx = 100, cy = 100, R = 94, r = 60; let a0 = -Math.PI / 2;
    const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const paths = shown.map(it => {
      const frac = it.total / sumv, a1 = a0 + frac * Math.PI * 2; let d;
      if (frac >= .9999) d = `M${cx} ${cy - R}A${R} ${R} 0 1 1 ${cx - .01} ${cy - R}L${cx - .01} ${cy - r}A${r} ${r} 0 1 0 ${cx} ${cy - r}Z`;
      else { const s = a0 + (shown.length > 1 ? .014 : 0), e = a1 - (shown.length > 1 ? .014 : 0), lg = e - s > Math.PI ? 1 : 0; const [x1, y1] = pt(R, s), [x2, y2] = pt(R, e), [x3, y3] = pt(r, e), [x4, y4] = pt(r, s); d = `M${x1.toFixed(2)} ${y1.toFixed(2)}A${R} ${R} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}L${x3.toFixed(2)} ${y3.toFixed(2)}A${r} ${r} 0 ${lg} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}Z`; }
      a0 = a1; return `<path d="${d}" fill="${esc(it.color)}"/>`;
    }).join('');
    const legend = shown.map(it => `<li><i style="background:${esc(it.color)}"></i><span>${esc(it.name)}</span><em>${Math.round(it.total / sumv * 100)}%</em><b>${money(it.total)}</b></li>`).join('');
    return `<div class="rp-card ${cls}"><h3>${label}</h3><div class="rp-donut"><svg viewBox="0 0 200 200" width="150" height="150">${paths}</svg><div class="ctr"><small>סה״כ</small><b>${money(total)}</b></div></div><ul class="rp-leg">${legend}</ul></div>`;
  };
  sec(`<div class="rp-two">${donut(byCategory(list, cats, 'expense'), expense, 'הוצאות לפי קטגוריה', 'exp')}${donut(byCategory(list, cats, 'income'), income, 'הכנסות לפי קטגוריה', 'inc')}</div>`);

  // ---- 4. month by month (multi-month periods)
  if (info.multi && info.months.length > 1) {
    const keys = monthRange(info.months[0], info.months[info.months.length - 1]);
    const data = keys.map(k => { const l = list.filter(t => monthKey(t.date) === k); const i = sum(l, 'income'), e = sum(l, 'expense'); return { k, i, e, n: round2(i - e) }; });
    const mx = Math.max(1, ...data.map(d => Math.max(d.i, d.e)));
    const tb = table('פירוט לפי חודשים', '<tr><th>חודש</th><th class="n">הכנסות</th><th class="n">הוצאות</th><th class="n">מאזן</th><th class="bars"></th></tr>');
    for (const d of data) tb.row(`<td><b>${mname(d.k)}</b></td><td class="n">${money(d.i)}</td><td class="n">${money(d.e)}</td><td class="n ${d.n < 0 ? 'neg' : 'pos'}">${money(d.n)}</td><td class="bars"><div class="b i" style="width:${(d.i / mx * 100).toFixed(1)}%"></div><div class="b e" style="width:${(d.e / mx * 100).toFixed(1)}%"></div></td>`);
    tb.end(`<td><b>סה״כ</b></td><td class="n">${money(income)}</td><td class="n">${money(expense)}</td><td class="n ${net < 0 ? 'neg' : 'pos'}">${money(net)}</td><td></td>`);
  }

  // ---- 5. category tables
  for (const [kind, ttl, total] of [['expense', 'הוצאות לפי קטגוריה', expense], ['income', 'הכנסות לפי קטגוריה', income]]) {
    const items = byCategory(list, cats, kind); if (!items.length) continue;
    const tb = table(ttl, `<tr><th>קטגוריה</th><th class="c">תנועות</th><th class="share">חלק מהסך</th><th class="n">סה״כ</th></tr>`);
    for (const c of items) { const p = total ? c.total / total * 100 : 0; tb.row(`<td><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)}</td><td class="c">${c.count}</td><td class="share"><div class="pb"><div style="width:${p.toFixed(1)}%;background:${esc(c.color)}"></div></div><em>${p.toFixed(0)}%</em></td><td class="n">${money(c.total)}</td>`); }
    tb.end(`<td><b>סה״כ</b></td><td class="c">${items.reduce((a, c) => a + c.count, 0)}</td><td></td><td class="n"><b>${money(total)}</b></td>`);
  }

  // ---- 6. osek patur turnover
  if (info.scope !== 'personal' && turnovers.length) {
    const cards = turnovers.map(t => {
      const pct = Math.min(100, t.pct * 100), st = { ok: 'תקין', mid: 'קרוב לתקרה', over: 'חריגה מהתקרה' }[t.state];
      return `<div class="to ${t.state}"><div class="hd"><b>שנת ${t.year}</b><span class="tag">${st}</span></div>
        <div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div>
        <div class="nums"><div><small>מחזור מצטבר</small><b>${money(t.ytd)}</b></div><div><small>תקרה שנתית</small><b>${money(t.ceiling)}</b></div><div><small>${t.left >= 0 ? 'נותר עד התקרה' : 'חריגה'}</small><b>${money(Math.abs(t.left))}</b></div><div><small>ניצול</small><b>${(t.pct * 100).toFixed(0)}%</b></div></div></div>`;
    }).join('');
    sec(`<h2>מעקב מחזור – עוסק פטור</h2>${cards}<p class="rp-note">מחזור = סך ההכנסות העסקיות מתחילת השנה, לפני הוצאות. התקרה ניתנת לעדכון בהגדרות האפליקציה.</p>`);
  }

  // ---- 7. transactions
  const multiMonth = info.multi && info.months.length > 1;
  const tcols = `<tr><th class="d">תאריך</th><th>תיאור</th><th>קטגוריה</th>${info.scope === 'all' ? '<th class="c">סוג</th>' : ''}<th>תשלום</th><th class="c">קבלה</th><th class="n">סכום</th></tr>`;
  const tx = table('פירוט תנועות', tcols, 'rp-txs', `${sorted.length} תנועות`);
  let curM = null;
  for (const t of sorted) {
    if (multiMonth && monthKey(t.date) !== curM) {
      curM = monthKey(t.date); const l = sorted.filter(x => monthKey(x.date) === curM); const i = sum(l, 'income'), e = sum(l, 'expense');
      tx.row(`<td colspan="${info.scope === 'all' ? 7 : 6}"><b>${mname(curM)}</b><span>הכנסות ${money(i)} · הוצאות ${money(e)}</span></td>`, { divider: true });
    }
    const c = catOf(t.category_id);
    tx.row(`<td class="d">${dmy(t.date)}</td>
      <td class="ti"><b>${esc(t.title || c?.name || KIND[t.kind])}</b>${t.recurring_id ? '<span class="bd rec">↻ חוזר</span>' : ''}${t.notes ? `<div class="nt">${esc(t.notes.slice(0, 140))}</div>` : ''}</td>
      <td>${c ? `<i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)}` : '<span class="mut">—</span>'}</td>
      ${info.scope === 'all' ? `<td class="c"><span class="bd ${t.scope === 'business' ? 'biz' : 'prv'}">${t.scope === 'business' ? 'עסקי' : 'פרטי'}</span></td>` : ''}
      <td>${esc(t.payment_method || '')}</td>
      <td class="c">${rcNo.has(t.id) ? `<span class="bd rc">קבלה ${rcNo.get(t.id)}</span>` : '<span class="mut">—</span>'}</td>
      <td class="n ${t.kind === 'income' ? 'pos' : 'neg'}">${money(t.amount, t.kind === 'income' ? '+' : '−')}</td>`);
  }
  tx.end(`<td colspan="${info.scope === 'all' ? 6 : 5}"><b>מאזן התקופה</b></td><td class="n ${net < 0 ? 'neg' : 'pos'}"><b>${money(net)}</b></td>`);

  // ---- 8. receipts appendix
  const withRc = sorted.filter(t => t.receipt_path);
  if (includeReceipts && withRc.length) {
    let slot = 0;
    for (const t of withRc) {
      if (slot % 2 === 0) { newPage(false); body.classList.add('apx'); body.insertAdjacentHTML('beforeend', slot === 0 ? '<h2 class="rp-apx">נספח: קבלות</h2>' : ''); }
      const r = receipts.get(t.id); const c = catOf(t.category_id);
      const card = document.createElement('div'); card.className = 'rp-rc' + (slot === 0 ? ' first' : '');
      card.innerHTML = `<div class="rc-hd"><span class="bd rc">קבלה ${rcNo.get(t.id)}</span><b>${esc(t.title || c?.name || KIND[t.kind])}</b><span>${dmy(t.date)}</span><span>${esc(c?.name || '')}</span><span class="sp"></span><strong>${money(t.amount)}</strong></div>
        <div class="rc-img">${r?.src ? `<img src="${r.src}" alt="">` : `<div class="rc-ph"><b>${r?.kind === 'pdf' ? 'קובץ PDF' : 'הקבלה לא זמינה'}</b><span>${esc(t.receipt_name || '')}</span>${r?.kind === 'pdf' ? '<span>הקובץ המקורי מצורף ב-ZIP הקבלות</span>' : ''}</div>`}</div>`;
      body.appendChild(card); slot++;
      if (slot % 2 === 1) { /* second card on the same page follows */ } 
    }
  }

  // ---- finishing: numbering + wait for images
  pages.forEach((p, i) => { p.querySelector('.rp-pg').textContent = `עמוד ${i + 1} מתוך ${pages.length}`; });
  await Promise.all([...host.querySelectorAll('img')].map(i => i.complete && i.naturalWidth ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  return pages;
}

/** Downscale a receipt blob to a JPEG data URL (keeps the PDF light). */
export async function receiptToSrc(blob, maxSide = 1500) {
  if (!blob) return null;
  if ((blob.type || '').startsWith('image/') && !/heic|heif/i.test(blob.type)) {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
      return { src: c.toDataURL('image/jpeg', .85), kind: 'image' };
    } catch { }
    try { return { src: await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); }), kind: 'image' }; } catch { }
  }
  return { src: null, kind: (blob.type || '').includes('pdf') ? 'pdf' : 'other' };
}
