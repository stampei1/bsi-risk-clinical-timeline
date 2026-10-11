'use strict';
// BSI Timeline — a clinician's step-through view of one patient's stay.
const ORGS = ['ecoli', 'entero'];
const NAME = { ecoli: 'E. coli', entero: 'Enterococcus' };
const TIER = { high: 'High', watch: 'Watch', low: 'Low' };
const SENS_HIGH = [0.3, 0.4, 0.5, 0.6, 0.7], SENS_WATCH = [0.75, 0.8, 0.85, 0.9, 0.95];
const BUILD = document.querySelector('meta[name="build"]')?.content || '';
const $ = (id) => document.getElementById(id);
const pct = (v, d) => v == null ? '—' : (v * 100).toFixed(d ?? (v < 0.01 ? 2 : 1)) + '%';
const abTxt = (v) => v == null ? '—' : v === 0 ? 'not detected' : v < 0.001 ? '<0.1%' : (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dayTxt = (d) => (d > 0 ? '+' : '') + d;
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
const get = async (u) => { const r = await fetch(`${u}?v=${BUILD}`); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };
const COVERED = { ecoli: (a) => a === 'Escherichia', entero: (a) => a.startsWith('Enterococcus') };
const AGENT = { Escherichia: 'E. coli', Enterococcus_Faecium: 'E. faecium', Enterococcus_Faecalis: 'E. faecalis',
  Enterococcus_Faecium_Vancomycin_Resistant: 'VRE (E. faecium)', Enterococcus_Vancomycin_Resistant: 'VRE',
  Klebsiella_Pneumoniae: 'K. pneumoniae', Stenotrophomonas_Maltophilia: 'S. maltophilia', Streptococcus_Viridans_Group: 'viridans strep' };
const agent = (a) => AGENT[a] || a.replace(/_/g, ' ');

const S = { meta: null, cohort: null, cases: [], pat: null, label: '', category: null, cur: 0, revealed: false, auto: false,
  sens: store('bt-sens') || { high: 0.5, watch: 0.9 }, win: store('bt-win') || '60', thr: {}, stats: {} };

// ------------------------------------------------------------------ thresholds with statistics
function computeTiers() {
  const s = S.cohort.samples;
  for (const o of ORGS) {
    const rows = []; for (let i = 0; i < s.day.length; i++) if (s[o + '_p'][i] != null) rows.push([s[o + '_p'][i], s[o + '_y'][i]]);
    const pos = rows.filter(r => r[1] === 1).map(r => r[0]).sort((a, b) => b - a);
    const cut = (sens) => pos[Math.ceil(sens * pos.length) - 1];
    const hi = cut(S.sens.high), wa = cut(S.sens.watch);
    const grp = { high: rows.filter(r => r[0] >= hi), watch: rows.filter(r => r[0] >= wa && r[0] < hi), low: rows.filter(r => r[0] < wa) };
    const st = {};
    for (const [t, g] of Object.entries(grp)) {
      const ev = g.filter(r => r[1] === 1).length;
      st[t] = { n: g.length, share: g.length / rows.length, events: ev, rate: g.length ? ev / g.length : 0, caught: ev / pos.length };
    }
    S.thr[o] = { high: hi, watch: wa }; S.stats[o] = { ...st, base: pos.length / rows.length, nPos: pos.length, n: rows.length };
  }
}
const tierOf = (o, p) => p >= S.thr[o].high ? 'high' : p >= S.thr[o].watch ? 'watch' : 'low';
const oneIn = (r) => r > 0 ? `1 in ${Math.max(1, Math.round(1 / r))}` : '—';
function tierLine(o, t) {
  const st = S.stats[o][t];
  if (t === 'low') return `${pct(st.rate)} of samples at this level were followed by ${NAME[o]} BSI within 14 days`;
  return `About <b>${oneIn(st.rate)}</b> samples at this level were followed by ${NAME[o]} BSI within 14 days`;
}

// ------------------------------------------------------------------ init + UI
async function init() {
  const th = store('bt-theme'); if (th) document.documentElement.dataset.theme = th;
  [S.meta, S.cohort, S.cases] = await Promise.all([get('data/meta.json'), get('data/cohort.json'), get('data/cases.json')]);
  computeTiers();
  const ex = $('exampleSel');
  ex.add(new Option('Examples…', ''));
  S.cases.forEach((c, i) => ex.add(new Option(`Example ${i + 1}`, c.pid)));
  ex.onchange = () => { const c = S.cases.find(x => x.pid === ex.value); if (c) open(c.pid, `Example ${S.cases.indexOf(c) + 1}`, c.category); };
  const fillIds = () => { const dl = $('pidList'); dl.replaceChildren(...filtered().map(p => new Option(p.pid))); };
  $('filterSel').onchange = fillIds; fillIds();
  $('pidInput').onchange = (e) => { const v = e.target.value.trim(); if (S.cohort.patients.some(p => p.pid === v)) open(v); };
  $('randomBtn').onclick = () => { const ps = filtered().filter(p => p.n >= 3); const p = ps[Math.floor(Math.random() * ps.length)]; if (p) open(p.pid); };
  $('prevBtn').onclick = () => step(-1); $('nextBtn').onclick = () => step(1);
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  });
  $('themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store('bt-theme', document.documentElement.dataset.theme); render();
  };
  $('settingsBtn').onclick = () => { settings(); $('settings').classList.remove('hidden'); };
  $('aboutBtn').onclick = () => { about(); $('about').classList.remove('hidden'); };
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden'); }));
  for (const [id, opts, key] of [['hiSel', SENS_HIGH, 'high'], ['waSel', SENS_WATCH, 'watch']]) {
    const sel = $(id); opts.forEach(v => sel.add(new Option(`${Math.round(v * 100)}% of pre-infection samples`, v)));
    sel.value = S.sens[key]; sel.onchange = () => { S.sens[key] = +sel.value; store('bt-sens', S.sens); computeTiers(); settings(); render(); };
  }
  $('winSel').value = S.win; $('winSel').onchange = (e) => { S.win = e.target.value; store('bt-win', S.win); render(); };
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  const c0 = S.cases[0]; await open(c0.pid, 'Example 1', c0.category);
}
function filtered() {
  const f = $('filterSel').value, L = (p, o) => p.bsiL[o] != null;
  return S.cohort.patients.filter(p => f === 'all' || (f === 'ecoli' && L(p, 'ecoli')) || (f === 'entero' && L(p, 'entero')) ||
    (f === 'either' && (L(p, 'ecoli') || L(p, 'entero'))) || (f === 'none' && !L(p, 'ecoli') && !L(p, 'entero')));
}
async function open(pid, label, category) {
  const seq = S.seq = (S.seq || 0) + 1;
  const p = await get(`data/patients/${encodeURIComponent(pid)}.json`);
  if (seq !== S.seq) return;
  S.pat = p; S.label = label || `Patient ${pid}`; S.category = category || null; S.cur = 0; S.auto = false;
  S.first = {};
  for (const o of ORGS) { const ds = p.infections.filter(([, a, l]) => l && COVERED[o](a)).map(([d]) => d); S.first[o] = ds.length ? Math.min(...ds) : null; }
  const f = ORGS.map(o => S.first[o]).filter(x => x != null); S.stop = f.length ? Math.min(...f) : null;
  S.revealed = S.stop != null && p.samples[0].day >= S.stop;
  $('exampleSel').value = S.cases.some(c => c.pid === pid) ? pid : ''; $('pidInput').value = '';
  render();
}
function step(k) { if (!S.pat) return; S.cur = Math.max(0, Math.min(S.pat.samples.length - 1, S.cur + k)); render(); }

// ------------------------------------------------------------------ render
function render() {
  if (!S.pat) return;
  const p = S.pat, cur = p.samples[S.cur], d = cur.day;
  if (!S.revealed && ((S.stop != null && d >= S.stop) || S.cur === p.samples.length - 1)) { S.revealed = true; S.auto = true; }
  $('who').innerHTML = `${S.label.startsWith('Example') ? S.label : 'Patient ' + p.pid}${S.label.startsWith('Example') ? `<small>${p.pid}</small>` : ''}`;
  $('dayNum').textContent = dayTxt(d);
  $('sampleNum').textContent = `sample ${S.cur + 1}/${p.samples.length}`;
  $('prevBtn').disabled = S.cur === 0; $('nextBtn').disabled = S.cur === p.samples.length - 1;
  timeline(p, d);
  today(p, cur, d);
  outcome(p);
}

// ------------------------------------------------------------------ context + plain-language reasons
function context(p, d) {
  const anc = p.anc.filter(([t]) => t <= d && d - t <= 3), ad = anc.length ? Math.max(...anc.map(a => a[0])) : null;
  const ancV = ad != null ? Math.max(...anc.filter(a => a[0] === ad).map(a => a[1])) : null;
  const t = p.temp.filter(([x]) => x <= d && d - x <= 1), tmax = t.length ? Math.max(...t.map(a => a[1])) : null;
  const abx = [...new Set(p.drugs.filter(([, a, b]) => a <= d && d <= b).map(([i]) => S.meta.drugs[i]))];
  return { anc: ancV, tmax, abx, hct: d };
}
const PHRASE = {
  'E. coli abundance and trend': (c, s) => `E. coli in stool: ${abTxt(s.ab_ecoli)}`,
  'Enterococcus abundance and trend': (c, s) => `Enterococcus in stool: ${abTxt(s.ab_entero)}`,
  'Lineages containing Enterococcus': () => 'Enterococcus-related bacteria in stool',
  'Pathogen vs commensal ratios': () => 'Balance of Enterococcus vs commensal anaerobes',
  'Protective commensal indices': () => 'Protective commensal bacteria pattern',
  'Antibiotics, prior 14 days': (c) => c.abx.length ? `Antibiotics in the last 2 weeks (now: ${c.abx.slice(0, 2).join(', ')})` : 'Antibiotics in the last 2 weeks',
  'Antibiotics by class': (c) => c.abx.length ? `Recent antibiotics (now: ${c.abx.slice(0, 2).join(', ')})` : 'Recent antibiotic exposure',
  'Antibiotic groups': () => 'Broad-spectrum / anti-anaerobe exposure',
  'Antibiotic intensification': () => 'Recent escalation of antibiotics',
  'Antibiotic → commensal-loss cascade': () => 'Antibiotic-associated loss of anaerobes',
  'Neutrophil count (ANC)': (c) => c.anc != null && c.anc < 0.5 ? `Neutropenia (ANC ${c.anc})` : null,
  'ANC trend, prior 14 days': () => 'Falling or low neutrophils over 2 weeks',
  'Neutropenia × Enterococcus': () => 'Neutropenia while Enterococcus is present',
  'Day relative to transplant': (c) => c.hct >= 0 && c.hct <= 30 ? `Early after transplant (day +${c.hct})` : null,
};
function reasons(o, s, c) {
  const g = s['g_' + o]; if (!g) return [];
  const names = S.meta.groups[o], seen = new Set(), out = [];
  g.map((v, i) => [v, i]).filter(([v]) => v > Math.log(1.1)).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    const f = PHRASE[names[i]], txt = f ? f(c, s) : null;
    if (txt && !seen.has(txt) && out.length < 2) { seen.add(txt); out.push(txt); }
  });
  return out;
}

// ------------------------------------------------------------------ today panel
function lastScored(o) {
  for (let i = S.cur; i >= 0; i--) if (S.pat.samples[i]['p_' + o] != null) return [S.pat.samples[i], i];
  return [null, -1];
}
function today(p, cur, d) {
  const c = context(p, d);
  let h = `<h3>Day ${dayTxt(d)} after transplant</h3><div class="meta">Stool sample ${S.cur + 1} of ${p.samples.length}</div>`;
  for (const o of ORGS) {
    const pv = cur['p_' + o];
    if (pv == null) {
      const after = S.first[o] != null && d >= S.first[o];
      h += `<div class="org"><div class="hl"><span class="oname">${NAME[o]}</span><span class="score na">${after ? 'after BSI' : 'not scored'}</span></div>
        <p class="say">${after ? 'Samples after an infection with this organism are not scored.' : 'No score for this sample.'}</p></div>`;
      continue;
    }
    const t = tierOf(o, pv), rs = t === 'low' ? [] : reasons(o, cur, c);
    h += `<div class="org ${t}"><div class="hl"><span class="oname">${NAME[o]}</span><span class="score ${t}">${TIER[t]}</span></div>
      <div class="big"><span class="num">${pct(pv)}</span><span class="unit">risk of BSI in 14 days</span></div>
      <p class="say">${tierLine(o, t)}.</p>${rs.length ? `<ul class="why">${rs.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}</div>`;
  }
  const ctx = [];
  if (c.anc != null) ctx.push(`<span class="${c.anc < 0.5 ? 'flag' : ''}">ANC ${c.anc}${c.anc < 0.5 ? ' (neutropenic)' : ''}</span>`);
  if (c.tmax != null) ctx.push(`<span class="${c.tmax >= 100.4 ? 'flag' : ''}">${c.tmax} °F</span>`);
  if (c.abx.length) ctx.push(`<span>${c.abx.slice(0, 3).join(', ')}${c.abx.length > 3 ? ` +${c.abx.length - 3}` : ''}</span>`);
  if (ctx.length) h += `<div class="ctx">${ctx.join('<i>·</i>')}</div>`;
  $('today').innerHTML = h;
}
function outcome(p) {
  const el = $('outcome');
  if (!S.revealed) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const lk = p.infections.filter(([, , l]) => l);
  let h = `<h3>Outcome</h3>`;
  if (S.auto) h += `<div class="meta">${S.stop != null && p.samples[S.cur].day >= S.stop ? 'Shown because the timeline has reached the infection.' : 'End of the stay.'}</div>`;
  h += lk.length ? `<ul>${lk.map(([d, a]) => `<li>Bloodstream infection on day <b>${dayTxt(d)}</b>: ${agent(a)}</li>`).join('')}</ul>`
    : `<p class="meta" style="margin-top:6px">No bloodstream infection within 14 days of a stool sample.</p>`;
  for (const o of ORGS) {
    const b = S.first[o]; if (b == null) continue;
    const pre = p.samples.filter(s => s['p_' + o] != null && s.day < b && s.day >= b - 14);
    const hit = pre.find(s => tierOf(o, s['p_' + o]) !== 'low');
    h += `<p class="meta" style="margin-top:6px">${NAME[o]}: ${!pre.length ? 'no stool sample in the 14 days before.'
      : hit ? `first High/Watch score ${b - hit.day} days before (day ${dayTxt(hit.day)}).` : 'no High/Watch score in the 14 days before.'}</p>`;
  }
  el.innerHTML = h;
}

// ------------------------------------------------------------------ timeline
function timeline(p, d) {
  const host = $('timeline'), W = Math.max(560, host.clientWidth || 900);
  const vis = (t) => S.revealed || t <= d;
  const days = p.samples.map(s => s.day), lastDay = Math.max(...days);
  let lo = Math.min(...days) - 2, hi = lastDay + 15;
  if (S.revealed) hi = Math.max(hi, ...p.infections.filter(([, , l]) => l).map(([t]) => t + 3));
  let d0 = lo, d1 = hi;
  if (S.win !== 'all' && hi - lo > +S.win) { d1 = Math.min(hi, d + 15); d0 = d1 - +S.win; if (d0 < lo) { d0 = lo; d1 = lo + +S.win; } }
  const G = 132, R = 12, PW = W - G - R, x = (t) => G + (t - d0) / (d1 - d0) * PW;
  const drugs = [...new Set(p.drugs.filter(([, a, b]) => vis(a) && b >= d0 && a <= d1).map(([i]) => i))].sort((a, b) => a - b);
  const H = { risk: 74, ab: 64, lane: 13, anc: 56, temp: 56, gap: 14 };
  const rows = []; let y = 26;
  const add = (k, h) => { rows.push({ k, y, h }); y += h + H.gap; };
  add('ecoli', H.risk); add('entero', H.risk); add('ab', H.ab); add('abx', Math.max(1, drugs.length) * H.lane + 18); add('anc', H.anc); add('temp', H.temp);
  const total = y + 10, top = rows[0].y, bot = y - H.gap;
  let o = `<svg viewBox="0 0 ${W} ${total}" role="img" aria-label="Patient timeline"><defs><clipPath id="pc"><rect x="${G}" y="0" width="${PW}" height="${total}"/></clipPath></defs>`;
  let P = '';                                        // clipped plot content
  const lbl = (r, t, s) => o += `<text x="0" y="${r.y + 13}" class="t-lbl">${t}</text>${s ? `<text x="0" y="${r.y + 27}" class="t-sub">${s}</text>` : ''}`;
  const bg = (r) => o += `<rect x="${G}" y="${r.y}" width="${PW}" height="${r.h}" class="t-bg"/>`;
  const tip = (html) => ` data-tip="${html.replace(/"/g, '&quot;')}"`;
  const step = (d1 - d0) > 90 ? 14 : 7;
  for (let t = Math.ceil(d0 / step) * step; t <= d1; t += step)
    o += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${bot}" class="t-grid"/><text x="${x(t)}" y="${total - 1}" text-anchor="middle" class="t-tick">${dayTxt(t)}</text>`;
  o += `<text x="0" y="${total - 1}" class="t-tick">day vs transplant</text>`;
  for (const r of rows) {
    if (r.k === 'ecoli' || r.k === 'entero') {
      const org = r.k, a = Math.log10(0.002), b = Math.log10(0.5);
      const ly = (v) => r.y + r.h - (Math.log10(Math.max(0.002, Math.min(0.5, v))) - a) / (b - a) * r.h;
      bg(r); lbl(r, NAME[org], 'risk of BSI, 14 d');
      o += `<rect x="${G}" y="${r.y}" width="${PW}" height="${ly(S.thr[org].high) - r.y}" class="t-hband"/>
        <rect x="${G}" y="${ly(S.thr[org].high)}" width="${PW}" height="${ly(S.thr[org].watch) - ly(S.thr[org].high)}" class="t-wband"/>
        <text x="${G - 6}" y="${ly(S.thr[org].high) - 2}" text-anchor="end" class="t-sub">High</text>
        <text x="${G - 6}" y="${(ly(S.thr[org].high) + ly(S.thr[org].watch)) / 2 + 4}" text-anchor="end" class="t-sub">Watch</text>`;
      const pts = p.samples.filter(s => s['p_' + org] != null && vis(s.day));
      if (pts.length) {
        let path = ''; pts.forEach((s, i) => { path += i ? `H${x(s.day)}V${ly(s['p_' + org])}` : `M${x(s.day)},${ly(s['p_' + org])}`; });
        const end = S.revealed ? x(pts[pts.length - 1].day + 2) : x(Math.max(pts[pts.length - 1].day, d));
        P += `<path d="${path}H${end}" class="t-risk"/>`;
        for (const s of pts) { const v = s['p_' + org], t = tierOf(org, v);
          P += `<circle cx="${x(s.day)}" cy="${ly(v)}" r="${t === 'low' ? 3 : 4.4}" class="t-pt ${t}"${tip(`<b>${NAME[org]}</b> · day ${dayTxt(s.day)}<br>${pct(v)} · ${TIER[t]}`)}/>`; }
      }
    } else if (r.k === 'ab') {
      const a = Math.log10(0.0005), b = 0, ly = (v) => r.y + r.h - (Math.log10(Math.max(0.0005, Math.min(1, v))) - a) / (b - a) * r.h;
      bg(r); lbl(r, 'In stool', 'relative abundance');
      o += `<line x1="${G + 8}" x2="${G + 26}" y1="${r.y + 9}" y2="${r.y + 9}" class="t-ab-a"/><text x="${G + 30}" y="${r.y + 12}" class="t-sub">E. coli</text>
        <line x1="${G + 78}" x2="${G + 96}" y1="${r.y + 9}" y2="${r.y + 9}" class="t-ab-b"/><text x="${G + 100}" y="${r.y + 12}" class="t-sub">Enterococcus</text>`;
      for (const v of [0.001, 0.01, 0.1, 1]) o += `<text x="${G - 6}" y="${ly(v) + 3}" text-anchor="end" class="t-tick">${v * 100 >= 1 ? v * 100 : v * 100}%</text>`;
      for (const [org, cls, dash] of [['ecoli', 'a', ''], ['entero', 'b', '']]) {
        const pts = p.samples.filter(s => s['ab_' + org] != null && vis(s.day));
        if (!pts.length) continue;
        P += `<path d="${pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.day)},${ly(s['ab_' + org])}`).join('')}" class="t-ab-${cls}"/>`;
        P += pts.map(s => `<circle cx="${x(s.day)}" cy="${ly(s['ab_' + org])}" r="2.4" class="t-dot-${cls}"${tip(`<b>${NAME[org]}</b> in stool · day ${dayTxt(s.day)}<br>${abTxt(s['ab_' + org])}`)}/>`).join('');
      }
    } else if (r.k === 'abx') {
      lbl(r, 'Antibiotics', '');
      if (!drugs.length) o += `<text x="${G + 6}" y="${r.y + 22}" class="t-sub">none in this window</text>`;
      drugs.forEach((i, k) => {
        const yy = r.y + 18 + k * H.lane, nm = S.meta.drugs[i];
        o += `<text x="${G - 6}" y="${yy + 9}" text-anchor="end" class="t-tick">${nm.length > 22 ? nm.slice(0, 21) + '…' : nm}</text>`;
        for (const [j, a, b] of p.drugs) if (j === i && vis(a) && b >= d0 && a <= d1) {
          const e = S.revealed ? b : Math.min(b, d), xa = x(a - 0.4), xb = x(e + 0.4);
          P += `<rect x="${xa}" y="${yy + 1}" width="${Math.max(2, xb - xa)}" height="${H.lane - 3}" rx="2" class="t-abx"${tip(`<b>${nm}</b><br>day ${dayTxt(a)} to ${dayTxt(e)}${!S.revealed && b > d ? ' (ongoing)' : ''}`)}/>`;
        }
      });
    } else if (r.k === 'anc') {
      const a = Math.log10(0.05), b = Math.log10(30), ly = (v) => r.y + r.h - (Math.log10(Math.max(0.05, Math.min(30, v))) - a) / (b - a) * r.h;
      bg(r); lbl(r, 'Neutrophils', 'ANC ×10³/µL');
      o += `<rect x="${G}" y="${ly(0.5)}" width="${PW}" height="${r.y + r.h - ly(0.5)}" class="t-nband"/>`;
      for (const v of [0.1, 1, 10]) o += `<text x="${G - 6}" y="${ly(v) + 3}" text-anchor="end" class="t-tick">${v}</text>`;
      const byDay = new Map(); for (const [t, v] of p.anc) if (vis(t)) byDay.set(t, Math.max(byDay.get(t) ?? -1, v));
      const ds = [...byDay.keys()].sort((m, n) => m - n);
      if (!ds.length) o += `<text x="${G + 8}" y="${r.y + r.h / 2 + 3}" class="t-sub">no data recorded</text>`;
      else P += `<path d="${ds.map((t, i) => `${i ? 'L' : 'M'}${x(t)},${ly(byDay.get(t))}`).join('')}" class="t-thin"/>` +
        ds.map(t => `<circle cx="${x(t)}" cy="${ly(byDay.get(t))}" r="2" class="t-dot"${tip(`ANC day ${dayTxt(t)}: ${byDay.get(t)}`)}/>`).join('');
    } else if (r.k === 'temp') {
      const a = 96, b = 104, ly = (v) => r.y + r.h - (Math.max(a, Math.min(b, v)) - a) / (b - a) * r.h;
      bg(r); lbl(r, 'Temperature', 'daily max, °F');
      o += `<rect x="${G}" y="${r.y}" width="${PW}" height="${ly(100.4) - r.y}" class="t-fband"/>`;
      for (const v of [98, 100, 102]) o += `<text x="${G - 6}" y="${ly(v) + 3}" text-anchor="end" class="t-tick">${v}</text>`;
      const pts = p.temp.filter(([t]) => vis(t));
      if (!pts.length) o += `<text x="${G + 8}" y="${r.y + r.h / 2 + 3}" class="t-sub">no data recorded</text>`;
      else P += `<path d="${pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t)},${ly(v)}`).join('')}" class="t-thin"/>` +
        pts.map(([t, v]) => `<circle cx="${x(t)}" cy="${ly(v)}" r="${v >= 100.4 ? 2.8 : 2}" class="${v >= 100.4 ? 't-fever' : 't-dot'}"${tip(`Temperature day ${dayTxt(t)}: ${v} °F`)}/>`).join('');
    }
  }
  if (!S.revealed) P += `<rect x="${x(d) + 4}" y="${top}" width="${Math.max(0, x(d1) - x(d) - 4)}" height="${bot - top}" class="t-future"/>`;
  for (const [t, a, l] of p.infections) {
    if (!vis(t)) continue;
    if (!l) { P += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${bot}" class="t-unlinked"${tip(`${agent(a)} BSI, day ${dayTxt(t)}<br>no stool sample in the 14 days before`)}/>`; continue; }
    P += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${bot}" class="t-bsi"/><text x="${x(t)}" y="${top - 10}" text-anchor="middle" class="t-bsi-txt">BSI · ${agent(a)}</text>`;
  }
  P += `<line x1="${x(d)}" x2="${x(d)}" y1="${top - 4}" y2="${bot}" class="t-today"/>`;
  if (!S.revealed) P += `<text x="${x(d)}" y="${top - 10}" text-anchor="middle" class="t-sub">today</text>`;
  const shown = p.samples.filter(s => vis(s.day)), nL = shown.filter(s => s.day < d0).length, nR = shown.filter(s => s.day > d1).length;
  if (nL) o += `<text x="${G + 2}" y="12" class="t-sub">◀ ${plural(nL, 'earlier sample')}</text>`;
  if (nR) o += `<text x="${W - R}" y="12" text-anchor="end" class="t-sub">${plural(nR, 'later sample')} ▶</text>`;
  host.innerHTML = o + `<g clip-path="url(#pc)">${P}</g></svg>`;
  host.querySelectorAll('[data-tip]').forEach(n => {
    n.addEventListener('mouseenter', (e) => { $('tip').innerHTML = n.dataset.tip; $('tip').classList.remove('hidden'); moveTip(e); });
    n.addEventListener('mousemove', moveTip); n.addEventListener('mouseleave', () => $('tip').classList.add('hidden'));
  });
}
function moveTip(e) {
  const t = $('tip'); let X = e.clientX + 14, Y = e.clientY + 14;
  if (X + t.offsetWidth > innerWidth - 8) X = e.clientX - t.offsetWidth - 14;
  if (Y + t.offsetHeight > innerHeight - 8) Y = e.clientY - t.offsetHeight - 14;
  t.style.left = X + 'px'; t.style.top = Y + 'px';
}

// ------------------------------------------------------------------ settings + about
function settings() {
  const row = (o) => {
    const st = S.stats[o];
    return `<tr><td rowspan="3"><b>${NAME[o]}</b><br><span class="fine">baseline ${pct(st.base)}</span></td>
      <td><span class="score high">High</span></td><td>≥ ${pct(S.thr[o].high)}</td><td>${pct(st.high.share, 0)}</td><td>${pct(st.high.caught, 0)}</td><td>${pct(st.high.rate)} (${oneIn(st.high.rate)})</td></tr>
      <tr><td><span class="score watch">Watch</span></td><td>${pct(S.thr[o].watch)}–${pct(S.thr[o].high)}</td><td>${pct(st.watch.share, 0)}</td><td>${pct(st.watch.caught, 0)}</td><td>${pct(st.watch.rate)} (${oneIn(st.watch.rate)})</td></tr>
      <tr><td><span class="score low">Low</span></td><td>&lt; ${pct(S.thr[o].watch)}</td><td>${pct(st.low.share, 0)}</td><td>${pct(st.low.caught, 0)}</td><td>${pct(st.low.rate)} (${oneIn(st.low.rate)})</td></tr>`;
  };
  $('tierStats').innerHTML = `<table class="stats"><thead><tr><th></th><th>Tier</th><th>Risk score</th><th>Share of samples</th>
    <th>Pre-infection samples in tier</th><th>Followed by BSI ≤ 14 d</th></tr></thead><tbody>${row('ecoli')}${row('entero')}</tbody></table>`;
}
function about() {
  const h = Math.round(S.sens.high * 100), w = Math.round(S.sens.watch * 100), e = S.stats.ecoli, n = S.stats.entero;
  $('aboutHigh').innerHTML = `Catches ${h}% of samples taken before an infection. ${oneIn(e.high.rate)} (E. coli) and ${oneIn(n.high.rate)} (Enterococcus) of these samples were followed by that infection within 14 days.`;
  $('aboutWatch').innerHTML = `Together with High, catches ${w}% of pre-infection samples. ${oneIn(e.watch.rate)} and ${oneIn(n.watch.rate)} followed by infection.`;
  $('aboutLow').innerHTML = `The remaining samples: ${pct(e.low.rate)} (E. coli) and ${pct(n.low.rate)} (Enterococcus) followed by infection, vs ${pct(e.base)} and ${pct(n.base)} overall.`;
}

init().catch(e => { document.querySelector('main').innerHTML = `<p style="padding:24px">Could not load data (${e.message}). Serve this folder over http.</p>`; });
