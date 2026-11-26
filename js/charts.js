// Hand-rolled SVG charts (no external library, works offline inside the PWA).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

export function donut(items, { total, centerLabel, fmt }) {
  const sum = items.reduce((a, i) => a + i.total, 0);
  if (!sum) return '<div class="empty">אין עדיין נתונים לחודש הזה</div>';
  const cx = 100, cy = 100, R = 92, r = 62; let a0 = -Math.PI / 2; const gap = items.length > 1 ? 0.012 : 0;
  const paths = items.map((it, idx) => {
    const frac = it.total / sum; const a1 = a0 + frac * Math.PI * 2;
    let d;
    if (frac >= 0.9999) d = `M${cx} ${cy - R}A${R} ${R} 0 1 1 ${cx - .01} ${cy - R}L${cx - .01} ${cy - r}A${r} ${r} 0 1 0 ${cx} ${cy - r}Z`;
    else {
      const s = a0 + gap, e = a1 - gap, large = e - s > Math.PI ? 1 : 0;
      const [x1, y1] = polar(cx, cy, R, s), [x2, y2] = polar(cx, cy, R, e), [x3, y3] = polar(cx, cy, r, e), [x4, y4] = polar(cx, cy, r, s);
      d = `M${x1} ${y1}A${R} ${R} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${large} 0 ${x4} ${y4}Z`;
    }
    a0 = a1;
    return `<path d="${d}" fill="${it.color}" data-i="${idx}"><title>${esc(it.name)}: ${esc(fmt(it.total))} (${Math.round(frac * 100)}%)</title></path>`;
  }).join('');
  const legend = items.map(it => `<div class="li"><span class="dot" style="background:${it.color}"></span><span class="nm">${esc(it.icon)} ${esc(it.name)}</span><b class="num">${esc(fmt(it.total))}</b><span class="pc">${Math.round(it.total / sum * 100)}%</span></div>`).join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 200 200" role="img" aria-label="${esc(centerLabel)}">${paths}
    <text x="100" y="94" text-anchor="middle" font-size="12" fill="#a39c90">${esc(centerLabel)}</text>
    <text x="100" y="118" text-anchor="middle" font-size="19" font-weight="800">${esc(fmt(total ?? sum))}</text></svg>
    <div class="legend">${legend}</div></div>`;
}

export function trendChart(data, { fmtShort, monthLabel, current }) {
  const W = 640, H = 240, P = { l: 52, r: 10, t: 14, b: 30 };
  const max = Math.max(1, ...data.flatMap(d => [d.income, d.expense]));
  const minNet = Math.min(0, ...data.map(d => d.net));
  const top = niceCeil(max), bottom = minNet < 0 ? -niceCeil(-minNet) : 0, span = top - bottom;
  const y = v => P.t + (top - v) / span * (H - P.t - P.b);
  const bw = (W - P.l - P.r) / data.length; const barW = Math.min(22, bw / 3.4);
  // RTL: newest month on the left side visually reads naturally right→left (oldest at right)
  const xc = i => W - P.r - bw * (i + .5);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = bottom + span * k / 4, yy = y(v); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" stroke="rgba(255,255,255,${v === 0 ? .18 : .06})"/><text x="${P.l - 8}" y="${yy + 4}" text-anchor="end">${fmtShort(v)}</text>`; }
  const bars = data.map((d, i) => {
    const x = xc(i), y0 = y(0);
    return `<rect x="${x + 2}" y="${y(d.income)}" width="${barW}" height="${Math.max(0, y0 - y(d.income))}" rx="4" fill="url(#gIn)"><title>הכנסות ${fmtShort(d.income)}</title></rect>
      <rect x="${x - barW - 2}" y="${y(d.expense)}" width="${barW}" height="${Math.max(0, y0 - y(d.expense))}" rx="4" fill="url(#gOut)"><title>הוצאות ${fmtShort(d.expense)}</title></rect>
      <text x="${x}" y="${H - 9}" text-anchor="middle" ${d.key === current ? 'fill="#f3dca4" font-weight="700"' : ''}>${monthLabel(d.key)}</text>`;
  }).join('');
  const pts = data.map((d, i) => `${xc(i)},${y(d.net)}`).join(' ');
  const dots = data.map((d, i) => `<circle cx="${xc(i)}" cy="${y(d.net)}" r="4" fill="#0e0e12" stroke="#f3dca4" stroke-width="2"><title>מאזן ${fmtShort(d.net)}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="מגמה חודשית"><defs>
    <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fe0b0"/><stop offset="1" stop-color="#2f9a68"/></linearGradient>
    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a91"/><stop offset="1" stop-color="#b8333b"/></linearGradient></defs>
    ${g}${bars}<polyline points="${pts}" fill="none" stroke="#d4af6a" stroke-width="2.2" stroke-linejoin="round"/>${dots}</svg>
    <div class="chart-legend"><span><i style="background:#5fd39a"></i>הכנסות</span><span><i style="background:#ff5a63"></i>הוצאות</span><span><i style="background:#d4af6a;height:3px;vertical-align:3px"></i>מאזן חודשי</span></div>`;
}
function niceCeil(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
