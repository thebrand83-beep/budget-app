// Pages (DOM) -> images -> a real PDF file, entirely in the browser. No server, no print dialog.
// html2canvas-pro (MIT, vendored in js/vendor) draws the A4 pages; a tiny writer wraps the JPEGs in a PDF.
const LIB = new URL('./vendor/html2canvas-pro.min.js', import.meta.url).href;
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('טעינת ספריית ה-PDF נכשלה')); document.head.appendChild(s); });
const PT_W = 595.28, PT_H = 841.89;

export async function renderPages(pageEls, { scale = 2, quality = .88, onPage } = {}) {
  if (!window.html2canvas) await loadScript(LIB);
  if (document.fonts?.ready) await document.fonts.ready;
  const out = [];
  for (let i = 0; i < pageEls.length; i++) {
    const el = pageEls[i];
    const canvas = await window.html2canvas(el, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true, width: el.offsetWidth, height: el.offsetHeight, windowWidth: el.offsetWidth, windowHeight: el.offsetHeight, scrollX: 0, scrollY: 0 });
    const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('canvas')), 'image/jpeg', quality));
    const page = { blob, w: canvas.width, h: canvas.height, url: URL.createObjectURL(blob) };
    canvas.width = canvas.height = 0; // free memory early (iOS)
    out.push(page); onPage?.(page, i, pageEls.length);
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
}

const enc = new TextEncoder();
const hex16 = s => 'FEFF' + [...s].map(ch => ch.codePointAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
/** @param pages [{blob,w,h}] JPEG pages @returns Blob (application/pdf) */
export async function imagesToPdf(pages, { title = 'דוח' } = {}) {
  const parts = []; let len = 0; const offs = [];
  const push = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;                         // objects: 1 catalog, 2 pages, 3 info, then 3 per page
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R /Lang (he-IL) /ViewerPreferences << /DisplayDocTitle true >> >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj(3, `<< /Title <${hex16(title)}> /Producer (Budget App) /Creator (Budget App) >>`);
  for (let i = 0; i < n; i++) {
    const pg = 4 + i * 3, ct = pg + 1, im = pg + 2, jpg = new Uint8Array(await pages[i].blob.arrayBuffer());
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    const c = `q ${PT_W} 0 0 ${PT_H} 0 0 cm /Im0 Do Q`; obj(ct, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    offs[im] = len; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pages[i].w} /Height ${pages[i].h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
  }
  const total = 4 + n * 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/** Hand the finished file to the user in the way that works on this device. Call from a click handler. */
export const isStandalone = () => !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches);
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMobile = () => isIOS() || /Android/i.test(navigator.userAgent);
export async function deliverPdf(blob, name) {
  const file = new File([blob], name + '.pdf', { type: 'application/pdf' });
  // phones / installed app: the system share sheet (Save to Files, Mail, WhatsApp…) is the only dependable route
  if ((isMobile() || isStandalone()) && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; /* fall through to download */ }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.pdf'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return 'downloaded';
}
