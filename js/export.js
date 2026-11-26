// Exports for the accountant: CSV (Excel-friendly, UTF-8 BOM), real .xlsx (SheetJS, lazy-loaded),
// ZIP of receipts (JSZip, lazy-loaded). The designed PDF report lives in report.js + pdf.js.
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

export async function exportXLSX(list, cats, name, savings = null) {
  if (!window.XLSX) await loadScript(XLSX_URL);
  const X = window.XLSX; const wb = X.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  const ws = X.utils.json_to_sheet(rows(list, cats)); ws['!cols'] = [12, 8, 11, 18, 9, 28, 12, 30, 40, 6].map(w => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws, 'תנועות');
  const sum = [];
  for (const kind of ['income', 'expense']) for (const scope of ['business', 'personal'])
    for (const c of byCategory(list.filter(t => t.scope === scope), cats, kind)) sum.push({ 'סוג': KIND[kind], 'עסקי/פרטי': SCOPE[scope], 'קטגוריה': c.name, 'סה"כ': c.total, 'מספר תנועות': c.count });
  const ws2 = X.utils.json_to_sheet(sum); ws2['!cols'] = [8, 9, 20, 12, 10].map(w => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws2, 'סיכום לפי קטגוריה');
  if (savings?.goals?.length) { // savings goals + movements (allocations, not expenses)
    const gn = id => savings.goals.find(g => g.id === id)?.name || '';
    const inR = savings.entries.filter(x => (!savings.from || x.date >= savings.from) && (!savings.to || x.date <= savings.to));
    const gs = X.utils.json_to_sheet(savings.goals.map(g => { const ent = savings.entries.filter(x => x.goal_id === g.id); const saved = ent.reduce((a, x) => a + (x.kind === 'deposit' ? 1 : -1) * +x.amount, 0);
      return { 'יעד': g.name, 'עסקי/פרטי': SCOPE[g.scope] || 'כללי', 'סכום יעד': +g.target_amount, 'נחסך': Math.round(saved * 100) / 100, 'תאריך יעד': g.target_date || '', 'הפקדה חודשית': g.auto_amount ? +g.auto_amount : '' }; }));
    gs['!cols'] = [22, 9, 11, 11, 12, 12].map(w => ({ wch: w })); X.utils.book_append_sheet(wb, gs, 'מטרות חיסכון');
    if (inR.length) { const es = X.utils.json_to_sheet(inR.map(x => ({ 'תאריך': x.date, 'יעד': gn(x.goal_id), 'סוג': x.kind === 'deposit' ? 'הפקדה' : 'משיכה', 'סכום': +x.amount, 'הערות': x.notes || '', 'אוטומטי': x.auto_date ? 'כן' : '' })));
      es['!cols'] = [12, 22, 8, 11, 30, 8].map(w => ({ wch: w })); X.utils.book_append_sheet(wb, es, 'תנועות חיסכון'); }
  }
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
