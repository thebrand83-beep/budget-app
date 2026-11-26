// Exports for the accountant: CSV (Excel-friendly, UTF-8 BOM), real .xlsx (SheetJS, lazy-loaded),
// ZIP of receipts (JSZip, lazy-loaded) and a printable A4 report (browser "Save as PDF").
import { byCategory, round2 } from './model.js';
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('טעינת ספרייה נכשלה (בדוק חיבור לאינטרנט)')); document.head.appendChild(s); });
const KIND = { income: 'הכנסה', expense: 'הוצאה' }, SCOPE = { business: 'עסקי', personal: 'פרטי' };

export function rows(list, cats) {
  return list.map(t => ({
    'תאריך': t.date, 'סוג': KIND[t.kind], 'סכום': +t.amount, 'קטגוריה': cats.find(c => c.id === t.category_id)?.name || '',
    'עסקי/פרטי': SCOPE[t.scope], 'תיאור': t.title || '', 'אמצעי תשלום': t.payment_method || '', 'הערות': t.notes || '',
    'קבלה': t.receipt_path ? receiptFileName(t) : '', 'קבוע': t.recurring_id ? 'כן' : '',
  }));
}
export function receiptFileName(t) {
  const ext = (t.receipt_name || '').split('.').pop()?.toLowerCase() || (t.receipt_type?.includes('pdf') ? 'pdf' : 'jpg');
  return `${t.date}_${t.kind === 'income' ? 'הכנסה' : 'הוצאה'}_${Math.round(t.amount)}_${(t.title || 'קבלה').replace(/[\\/:*?"<>|]+/g, '').slice(0, 40)}_${t.id.slice(0, 6)}.${ext}`;
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }

export function exportCSV(list, cats, name) {
  const r = rows(list, cats); const head = Object.keys(r[0] || { 'תאריך': '' });
  const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '\uFEFF' + [head.join(','), ...r.map(o => head.map(h => q(o[h])).join(','))].join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name + '.csv');
}

export async function exportXLSX(list, cats, name) {
  if (!window.XLSX) await loadScript(XLSX_URL);
  const X = window.XLSX; const wb = X.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  const ws = X.utils.json_to_sheet(rows(list, cats)); ws['!cols'] = [12, 8, 11, 18, 9, 28, 12, 30, 40, 6].map(w => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws, 'תנועות');
  const sum = [];
  for (const kind of ['income', 'expense']) for (const scope of ['business', 'personal'])
    for (const c of byCategory(list.filter(t => t.scope === scope), cats, kind)) sum.push({ 'סוג': KIND[kind], 'עסקי/פרטי': SCOPE[scope], 'קטגוריה': c.name, 'סה"כ': c.total, 'מספר תנועות': c.count });
  const ws2 = X.utils.json_to_sheet(sum); ws2['!cols'] = [8, 9, 20, 12, 10].map(w => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws2, 'סיכום לפי קטגוריה');
  X.writeFile(wb, name + '.xlsx');
}

export async function exportReceiptsZip(list, store, name, onProgress) {
  const withRc = list.filter(t => t.receipt_path);
  if (!withRc.length) throw new Error('אין קבלות בתקופה שנבחרה');
  if (!window.JSZip) await loadScript(JSZIP_URL);
  const zip = new window.JSZip(); let i = 0;
  for (const t of withRc) { zip.file(receiptFileName(t), await store.receiptBlob(t.receipt_path)); onProgress?.(++i, withRc.length); }
  download(await zip.generateAsync({ type: 'blob' }), name + '-קבלות.zip');
}

export async function printReport({ list, cats, title, period, fmt, store, includeReceipts, owner }) {
  const area = document.getElementById('printArea');
  const sum = k => round2(list.filter(t => t.kind === k).reduce((a, t) => a + +t.amount, 0));
  const biz = list.filter(t => t.scope === 'business'), bizIn = round2(biz.filter(t => t.kind === 'income').reduce((a, t) => a + +t.amount, 0)), bizOut = round2(biz.filter(t => t.kind === 'expense').reduce((a, t) => a + +t.amount, 0));
  const catTable = kind => { const c = byCategory(list, cats, kind); return c.length ? `<table><tr><th>קטגוריה</th><th>תנועות</th><th class="n">סה"כ</th></tr>${c.map(x => `<tr><td>${esc(x.name)}</td><td>${x.count}</td><td class="n">${esc(fmt(x.total))}</td></tr>`).join('')}</table>` : '<p class="muted">אין</p>'; };
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  let receipts = '';
  if (includeReceipts) {
    for (const t of sorted.filter(t => t.receipt_path)) {
      const isImg = (t.receipt_type || '').startsWith('image/');
      let src = ''; try { src = isImg ? await blobToDataURL(await store.receiptBlob(t.receipt_path)) : ''; } catch { }
      receipts += `<div class="rc"><b>${esc(t.date)} · ${esc(t.title || '')} · ${esc(fmt(t.amount))}</b><br>${isImg && src ? `<img src="${src}">` : `<span class="muted">קובץ PDF: ${esc(receiptFileName(t))} (מצורף בקובץ ה-ZIP)</span>`}</div>`;
    }
  }
  area.innerHTML = `<h1>${esc(title)}</h1><div class="muted">${esc(period)} · ${esc(owner || '')} · הופק ${new Date().toLocaleDateString('he-IL')}</div>
    <h2>סיכום</h2><div class="kpis"><div class="kpi">הכנסות<b>${fmt(sum('income'))}</b></div><div class="kpi">הוצאות<b>${fmt(sum('expense'))}</b></div><div class="kpi">מאזן<b>${fmt(sum('income') - sum('expense'))}</b></div></div>
    <div class="kpis" style="margin-top:3mm"><div class="kpi">הכנסות עסקיות (מחזור)<b>${fmt(bizIn)}</b></div><div class="kpi">הוצאות עסקיות<b>${fmt(bizOut)}</b></div><div class="kpi">רווח עסקי<b>${fmt(bizIn - bizOut)}</b></div></div>
    <h2>הכנסות לפי קטגוריה</h2>${catTable('income')}<h2>הוצאות לפי קטגוריה</h2>${catTable('expense')}
    <h2>פירוט תנועות (${sorted.length})</h2><table><tr><th>תאריך</th><th>סוג</th><th>תיאור</th><th>קטגוריה</th><th>עסקי/פרטי</th><th>תשלום</th><th>קבלה</th><th class="n">סכום</th></tr>
    ${sorted.map(t => `<tr><td>${t.date}</td><td>${KIND[t.kind]}</td><td>${esc(t.title || '')}${t.notes ? `<br><span class="muted">${esc(t.notes)}</span>` : ''}</td><td>${esc(cats.find(c => c.id === t.category_id)?.name || '')}</td><td>${SCOPE[t.scope]}</td><td>${esc(t.payment_method || '')}</td><td>${t.receipt_path ? '✓' : ''}</td><td class="n">${t.kind === 'expense' ? '-' : ''}${esc(fmt(t.amount))}</td></tr>`).join('')}</table>
    ${receipts ? `<h2 class="pb">נספח: קבלות</h2>${receipts}` : ''}`;
  await Promise.all([...area.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  window.print();
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
