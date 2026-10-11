'use strict';
// BSI Timeline — a clinician's step-through view of one patient's stay.
const ORGS = ['ecoli', 'entero'];
const NAME = { ecoli: 'E. coli', entero: 'Enterococcus' };
const NI = { ecoli: '<i>E. coli</i>', entero: '<i>Enterococcus</i>' };       // organism names, italic
const TIER = { high: 'High', watch: 'Watch', low: 'Low' };
const RANK = { low: 0, watch: 1, high: 2 };
const SENS_HIGH = [0.3, 0.4, 0.5, 0.6, 0.7], SENS_WATCH = [0.75, 0.8, 0.85, 0.9, 0.95];
const HORIZON = 14;
// Performance and inputs are taken from the project brief (AGENT_BRIEF), not computed here.
const AUC = { ecoli: { model: 0.897, abundance: 0.827 }, entero: { model: 0.816, abundance: 0.753 } };
const BUILD = document.querySelector('meta[name="build"]')?.content || '';
const $ = (id) => document.getElementById(id);
const pct = (v, d) => v == null ? '—' : (v * 100).toFixed(d ?? (v < 0.01 ? 2 : 1)) + '%';
const abTxt = (v) => v == null ? '—' : v === 0 ? 'not detected' : v < 0.001 ? '<0.1%' : (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dayTxt = (d) => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);
const fmtN = (n) => n.toLocaleString('en-US');
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
const get = async (u) => { const r = await fetch(`${u}?v=${BUILD}`); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };
const COVERED = { ecoli: (a) => a === 'Escherichia', entero: (a) => a.startsWith('Enterococcus') };
const AGENT = { Escherichia: 'E. coli', Enterococcus_Faecium: 'E. faecium', Enterococcus_Faecalis: 'E. faecalis',
  Enterococcus_Faecium_Vancomycin_Resistant: 'VRE (E. faecium)', Enterococcus_Vancomycin_Resistant: 'VRE',
  Klebsiella_Pneumoniae: 'K. pneumoniae', Stenotrophomonas_Maltophilia: 'S. maltophilia', Streptococcus_Viridans_Group: 'viridans strep' };
const agent = (a) => AGENT[a] || a.replace(/_/g, ' ');

const S = { meta: null, cohort: null, cases: [], pat: null, label: '', cur: 0, maxCur: 0, revealed: false, auto: false,
  sens: store('bt-sens') || { high: 0.5, watch: 0.9 }, win: store('bt-win') || '60', thr: {}, stats: {}, calib: {} };

// ------------------------------------------------------------------ thresholds with statistics (from cohort.json)
function scoredRows(o) {
  const s = S.cohort.samples, rows = [];
  for (let i = 0; i < s.day.length; i++) if (s[o + '_p'][i] != null) rows.push([s[o + '_p'][i], s[o + '_y'][i]]);
  return rows;
}
function computeTiers() {
  for (const o of ORGS) {
    const rows = scoredRows(o);
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
function computeCalibration() {                       // reliability: deciles of predicted probability (≥ ~950 samples each)
  for (const o of ORGS) {
    const rows = scoredRows(o).sort((a, b) => a[0] - b[0]), k = 10, bins = [];
    for (let b = 0; b < k; b++) {
      const g = rows.slice(Math.floor(b * rows.length / k), Math.floor((b + 1) * rows.length / k));
      bins.push({ n: g.length, pred: g.reduce((s, r) => s + r[0], 0) / g.length, obs: g.reduce((s, r) => s + r[1], 0) / g.length });
    }
    S.calib[o] = { bins, total: rows.length, binned: bins.reduce((s, b) => s + b.n, 0) };
  }
}
const tierOf = (o, p) => p >= S.thr[o].high ? 'high' : p >= S.thr[o].watch ? 'watch' : 'low';
const oneIn = (r) => r > 0 ? `1 in ${Math.max(1, Math.round(1 / r))}` : '—';
function tierLine(o, t) {
  const st = S.stats[o][t];
  if (t === 'low') return `${pct(st.rate)} of stool samples at this level were followed by an ${NI[o]} BSI within 14 days`;
  return `About <button class="oneinbtn" data-icon="${o}:${t}">${oneIn(st.rate)}</button> stool samples at this level were followed by an ${NI[o]} BSI within 14 days`;
}

// ------------------------------------------------------------------ init + UI
async function init() {
  const th = store('bt-theme'); if (th) document.documentElement.dataset.theme = th;
  [S.meta, S.cohort, S.cases] = await Promise.all([get('data/meta.json'), get('data/cohort.json'), get('data/cases.json')]);
  computeTiers(); computeCalibration(); checkReasonCoverage();
  const ex = $('exampleSel');
  ex.add(new Option('Examples…', ''));
  S.cases.forEach((c, i) => ex.add(new Option(`Example ${i + 1}`, c.pid)));
  ex.onchange = () => { const c = S.cases.find(x => x.pid === ex.value); if (c) open(c.pid, `Example ${S.cases.indexOf(c) + 1}`); };
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
  $('settingsBtn').onclick = () => { settings(); show('settings'); };
  $('aboutBtn').onclick = () => { about(); show('about'); };
  $('factsLink').onclick = () => { $('about').classList.add('hidden'); facts(); show('facts'); };
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden'); }));
  for (const [id, opts, key] of [['hiSel', SENS_HIGH, 'high'], ['waSel', SENS_WATCH, 'watch']]) {
    const sel = $(id); opts.forEach(v => sel.add(new Option(`${Math.round(v * 100)}% of pre-infection samples`, v)));
    sel.value = S.sens[key]; sel.onchange = () => { S.sens[key] = +sel.value; store('bt-sens', S.sens); computeTiers(); settings(); render(); };
  }
  $('winSel').value = S.win; $('winSel').onchange = (e) => { S.win = e.target.value; store('bt-win', S.win); render(); };
  const ph = () => { $('pidInput').placeholder = innerWidth < 600 ? 'ID' : 'Patient ID'; }; ph();
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { ph(); render(); }, 120); });
  await open(S.cases[0].pid, 'Example 1');
}
const show = (id) => $(id).classList.remove('hidden');
function filtered() {
  const f = $('filterSel').value, L = (p, o) => p.bsiL[o] != null;
  return S.cohort.patients.filter(p => f === 'all' || (f === 'ecoli' && L(p, 'ecoli')) || (f === 'entero' && L(p, 'entero')) ||
    (f === 'either' && (L(p, 'ecoli') || L(p, 'entero'))) || (f === 'none' && !L(p, 'ecoli') && !L(p, 'entero')));
}
async function open(pid, label) {
  const seq = S.seq = (S.seq || 0) + 1;
  const p = await get(`data/patients/${encodeURIComponent(pid)}.json`);
  if (seq !== S.seq) return;
  S.pat = p; S.label = label || `Patient ${pid}`; S.cur = 0; S.maxCur = 0; S.auto = false;
  S.first = {};
  for (const o of ORGS) { const ds = p.infections.filter(([, a, l]) => l && COVERED[o](a)).map(([d]) => d); S.first[o] = ds.length ? Math.min(...ds) : null; }
  const f = ORGS.map(o => S.first[o]).filter(x => x != null); S.stop = f.length ? Math.min(...f) : null;
  S.revealed = S.stop != null && p.samples[0].day >= S.stop;
  $('exampleSel').value = S.cases.some(c => c.pid === pid) ? pid : ''; $('pidInput').value = '';
  render();
}
function go(i) { if (!S.pat) return; S.cur = Math.max(0, Math.min(S.pat.samples.length - 1, i)); S.maxCur = Math.max(S.maxCur, S.cur); render(); }
const step = (k) => go(S.cur + k);

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
  const peak = {};                                    // highest abundance in the past 14 days, current sample included, never later ones
  for (const o of ORGS) peak[o] = Math.max(0, ...p.samples.filter(q => q.day <= d && q.day >= d - 14 && q['ab_' + o] != null).map(q => q['ab_' + o]));
  return { anc: ancV, tmax, abx, hct: d, peak };
}
// group name (meta.json groups) -> [phrase(c, s), timeline lane or null, ⓘ note or note(c, s)]
// DRAFT wording (2026-10-11) — for Isaac to approve. Every phrase must return a string: a group that ranks in the
// top 2 is never silently dropped (build/audit_reasons.py checks this).
const DOMINANT = 0.3;                                  // ≥ 30% of the community = domination (Taur et al., Clin Infect Dis 2012)
function abPhrase(o) {
  return (c, s) => {
    const now = s['ab_' + o], pk = c.peak[o], n = now ?? 0;
    const nowTxt = now == null ? 'no reading' : abTxt(now);
    if (pk >= 0.01 && pk >= 10 * n) return `${NI[o]} in stool: now ${nowTxt}, up to ${abTxt(pk)} in the past 2 weeks`;
    return `${NI[o]} in stool: ${nowTxt}${n >= DOMINANT ? ' (dominant)' : ''}`;
  };
}
const abNote = (o) => (c, s) => (s['ab_' + o] ?? 0) >= DOMINANT
  ? `Dominant = at least 30% of the stool community (Taur et al., Clin Infect Dis 2012).` : null;
const REASON = {
  'E. coli abundance and trend': [abPhrase('ecoli'), 'ab', abNote('ecoli')],
  'Enterococcus abundance and trend': [abPhrase('entero'), 'ab', abNote('entero')],
  'Lineages containing Enterococcus': [() => '<i>Enterococcus</i>-related bacteria in stool (not plotted)', null,
    'Higher-level bacterial groups that contain Enterococcus (e.g. its family and order).'],
  'Pathogen vs commensal ratios': [() => 'Balance of <i>Enterococcus</i> vs commensal anaerobes', 'ab',
    'Compares Enterococcus with anaerobic commensal bacteria; only Enterococcus is plotted here.'],
  'Protective commensal indices': [() => 'Protective commensal bacteria pattern (not plotted)', null,
    'An index of gut bacteria reported in the literature as protective (e.g. Blautia, Barnesiella).'],
  'Bacteroides interaction': [() => 'Pattern involving <i>Bacteroides</i> (not plotted)', null,
    'How much Bacteroides there is together with the pathogen.'],
  'Other gut bacteria': [() => 'Pattern of other gut bacteria (not plotted)', null,
    'Current amounts of the many other bacterial groups in the stool sample.'],
  'Other bacteria, trends': [() => 'Recent shifts in other gut bacteria (not plotted)', null,
    'Recent trends (e.g. 7–30-day mean, max, slope) of other bacterial groups.'],
  'Antibiotics, prior 14 days': [(c) => c.abx.length ? `Antibiotics in the last 2 weeks (now: ${c.abx.slice(0, 2).join(', ')})` : 'Antibiotics in the last 2 weeks', 'abx'],
  'Antibiotics by class': [(c) => c.abx.length ? `Recent antibiotics (now: ${c.abx.slice(0, 2).join(', ')})` : 'Recent antibiotic exposure', 'abx'],
  'Antibiotic totals': [() => 'Amount of recent antibiotic exposure', 'abx'],
  'Antibiotic groups': [() => 'Broad-spectrum / anti-anaerobe exposure', 'abx'],
  'Antibiotic intensification': [() => 'Recent escalation of antibiotics', 'abx'],
  'Days since last antibiotic dose': [() => 'Time since the last antibiotic dose', 'abx'],
  'Antibiotic → commensal-loss cascade': [() => 'Antibiotics followed by loss of anaerobes', 'abx'],
  'Neutrophil count (ANC)': [(c) => c.anc == null ? 'Neutrophil data' : c.anc < 0.5 ? `Neutropenia (ANC ${c.anc})` : `Neutrophil count (ANC ${c.anc})`, 'anc'],
  'ANC trend, prior 14 days': [() => 'Neutrophil trend over 2 weeks', 'anc'],
  'Neutropenia × Enterococcus': [() => 'Neutropenia while <i>Enterococcus</i> is present', 'anc'],
  'ANC recovery timing': [() => 'Timing of neutrophil recovery', 'anc'],
  'Day relative to transplant': [(c) => c.hct < 0 ? `Before transplant (day ${dayTxt(c.hct)})`
    : c.hct <= 30 ? `Early after transplant (day ${dayTxt(c.hct)})` : `Day ${dayTxt(c.hct)} after transplant`, null,
    'The number of days since transplant.'],
};
const NO_SINGLE = 'No single factor stood out; the score reflects several small contributions.';   // DRAFT wording
function checkReasonCoverage() {
  for (const o of ORGS) for (const g of S.meta.groups[o])
    if (!(g in REASON)) console.warn(`BSI Timeline: driver group "${g}" (${NAME[o]}) has no REASON phrase`);
}
function reasons(o, s, c) {
  const g = s['g_' + o]; if (!g) return [];
  const names = S.meta.groups[o], seen = new Set(), out = [];
  g.map((v, i) => [v, i]).filter(([v]) => v > Math.log(1.1)).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    const r = REASON[names[i]] || [() => names[i], null];            // never drop a group; fall back to its name
    const txt = r[0](c, s), note = typeof r[2] === 'function' ? r[2](c, s) : r[2] || null;
    if (!seen.has(txt) && out.length < 2) { seen.add(txt); out.push({ txt, lane: r[1], note, group: names[i] }); }
  });
  return out;
}

// ------------------------------------------------------------------ today panel
function prevScored(o) {
  for (let i = S.cur - 1; i >= 0; i--) if (S.pat.samples[i]['p_' + o] != null) return S.pat.samples[i];
  return null;
}
function today(p, cur, d) {
  const c = context(p, d);
  let h = `<h3>Day ${dayTxt(d)} after transplant</h3><div class="meta">Bloodstream infection (BSI) risk from stool sample ${S.cur + 1} of ${p.samples.length} ·
    covers days ${dayTxt(d)} to ${dayTxt(d + HORIZON)}</div>`;
  ORGS.forEach((o, k) => {
    const pv = cur['p_' + o];
    const title = `${NI[o]} BSI risk, next 14 days`;
    if (pv == null) {
      const after = S.first[o] != null && d >= S.first[o];
      h += `<div class="org"><div class="hl"><span class="oname">${title}</span><span class="score na">${after ? 'after BSI' : 'not scored'}</span></div>
        <p class="say">${after ? 'Samples after an infection with this organism are not scored.' : 'No score for this sample.'}</p></div>`;
      return;
    }
    const t = tierOf(o, pv), rs = t === 'low' ? [] : reasons(o, cur, c), pr = prevScored(o);
    let change = '';
    if (pr) {
      const pp = pr['p_' + o], pt = tierOf(o, pp), dir = pv > pp * 1.05 ? '↑ up from' : pv < pp / 1.05 ? '↓ down from' : '→ about the same as';
      change = `<div class="chg">${dir} ${pct(pp)} (day ${dayTxt(pr.day)})${pt !== t ? ` · <b>${TIER[pt]} → ${TIER[t]}</b>` : ''}</div>`;
    }
    h += `<div class="org ${t}"><div class="hl"><span class="oname">${title}</span>
        <span class="hr"><span class="score ${t}">${TIER[t]}</span><button class="info" data-facts="${o}" aria-label="Model facts for ${NAME[o]}" title="Model facts">ⓘ</button></span></div>
      <div class="big"><span class="num">${pct(pv)}</span></div>${change}
      <p class="say">${tierLine(o, t)}.</p>
      ${t === 'low' ? '' : `<div class="whyh">What raised the model's score</div>${rs.length ? `<ul class="why">${rs.map(r =>
        `<li tabindex="0" ${r.lane ? `data-lane="${r.lane}"` : ''} ${r.note ? `title="${r.note}"` : ''}><span>${r.txt}${r.note ? ' <span class="nl">ⓘ</span>' : ''}</span></li>`).join('')}</ul>`
        : `<p class="nosingle">${NO_SINGLE}</p>`}`}</div>`;
  });
  const ctx = [];
  if (c.anc != null) ctx.push(`<span class="${c.anc < 0.5 ? 'flag' : ''}">ANC ${c.anc}${c.anc < 0.5 ? ' (neutropenic)' : ''}</span>`);
  if (c.tmax != null) ctx.push(`<span class="${c.tmax >= 100.4 ? 'flag' : ''}">${c.tmax} °F</span>`);
  if (c.abx.length) ctx.push(`<span>${c.abx.slice(0, 3).join(', ')}${c.abx.length > 3 ? ` +${c.abx.length - 3}` : ''}</span>`);
  if (ctx.length) h += `<div class="ctx">${ctx.join('<i>·</i>')}</div>`;
  $('today').innerHTML = h;
  // reasons <-> timeline lanes
  $('today').querySelectorAll('.why li[data-lane]').forEach(li => {
    const on = (v) => document.querySelectorAll(`#timeline [data-hl="${li.dataset.lane}"]`).forEach(r => r.classList.toggle('on', v));
    li.addEventListener('mouseenter', () => on(true)); li.addEventListener('mouseleave', () => on(false));
    li.addEventListener('focus', () => on(true)); li.addEventListener('blur', () => on(false));
    li.addEventListener('click', () => { const lit = li.classList.toggle('lit'); on(lit); });
  });
  $('today').querySelectorAll('[data-facts]').forEach(b => b.onclick = () => { facts(b.dataset.facts); show('facts'); });
  $('today').querySelectorAll('[data-icon]').forEach(b => b.onclick = () => { const [o, t] = b.dataset.icon.split(':'); iconArray(o, t); show('icons'); });
}
function outcome(p) {
  const el = $('outcome');
  if (!S.revealed) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const lk = p.infections.filter(([, , l]) => l);
  let h = `<h3>Outcome</h3>`;
  if (S.auto) h += `<div class="meta">${S.stop != null && p.samples[S.cur].day >= S.stop ? 'Shown because the timeline has reached the infection.' : 'End of the stay.'}</div>`;
  h += lk.length ? `<ul>${lk.map(([d, a]) => `<li>Bloodstream infection (BSI) on day <b>${dayTxt(d)}</b>: ${agent(a)}</li>`).join('')}</ul>`
    : `<p class="meta" style="margin-top:6px">No bloodstream infection within 14 days of a stool sample.</p>`;
  const lines = [];
  for (const o of ORGS) {
    const b = S.first[o]; if (b == null) continue;
    const pre = p.samples.filter(s => s['p_' + o] != null && s.day < b && s.day >= b - HORIZON);
    if (!pre.length) { lines.push(`${NI[o]}: no stool sample in the 14 days before the BSI.`); continue; }
    const w = pre.find(s => RANK[tierOf(o, s['p_' + o])] >= 1), hi = pre.find(s => tierOf(o, s['p_' + o]) === 'high');
    lines.push(`${NI[o]}: ${w ? `first reached Watch or higher on day ${dayTxt(w.day)} (${b - w.day} days before)` : 'did not reach Watch'}; ${
      hi ? `first reached High on day ${dayTxt(hi.day)} (${b - hi.day} days before)` : 'did not reach High'}.`);
  }
  if (lines.length) h += `<div class="lead"><div class="whyh">Scores in the 14 days before</div>${lines.map(l => `<p>${l}</p>`).join('')}
    <p class="fine">A retrospective observation for this patient, not a measure of model performance.</p></div>`;
  el.innerHTML = h;
}

// ------------------------------------------------------------------ timeline
function timeline(p, d) {
  const host = $('timeline'), W = Math.max(300, host.clientWidth || 900), narrow = W < 560;
  const vis = (t) => S.revealed || t <= d;
  const days = p.samples.map(s => s.day), lastDay = Math.max(...days);
  let lo = Math.min(...days) - 2, hi = lastDay + 15;
  if (S.revealed) hi = Math.max(hi, ...p.infections.filter(([, , l]) => l).map(([t]) => t + 3));
  let d0 = lo, d1 = hi;
  const win = S.win === 'all' ? Infinity : narrow ? Math.min(+S.win, 40) : +S.win;
  if (hi - lo > win) { d1 = Math.min(hi, d + 16); d0 = d1 - win; if (d0 < lo) { d0 = lo; d1 = lo + win; } }
  const G = narrow ? 92 : 132, R = 10, PW = W - G - R, x = (t) => G + (t - d0) / (d1 - d0) * PW;
  const drugs = [...new Set(p.drugs.filter(([, a, b]) => vis(a) && b >= d0 && a <= d1).map(([i]) => i))].sort((a, b) => a - b);
  const short = innerHeight < 760;
  const H = short ? { risk: 60, ab: 54, lane: 12, anc: 46, temp: 46, gap: 10 } : { risk: 74, ab: 64, lane: 13, anc: 56, temp: 56, gap: 14 };
  const rows = []; let y = 28;
  const add = (k, h) => { rows.push({ k, y, h }); y += h + H.gap; };
  add('ecoli', H.risk); add('entero', H.risk); add('ab', H.ab); add('abx', Math.max(1, drugs.length) * H.lane + 18); add('anc', H.anc); add('temp', H.temp);
  const total = y + 10, top = rows[0].y, bot = y - H.gap;
  let o = `<svg viewBox="0 0 ${W} ${total}" role="img" aria-label="Patient timeline"><defs><clipPath id="pc"><rect x="${G}" y="0" width="${PW}" height="${total}"/></clipPath></defs>`;
  let P = '';                                        // clipped plot content
  const lbl = (r, t, s, it) => o += `<text x="0" y="${r.y + 13}" class="t-lbl${it ? ' it' : ''}">${t}</text>${s && !narrow ? `<text x="0" y="${r.y + 27}" class="t-sub">${s}</text>` : ''}`;
  const bg = (r) => o += `<rect x="${G}" y="${r.y}" width="${PW}" height="${r.h}" class="t-bg"/>`;
  const tip = (html) => ` data-tip="${html.replace(/"/g, '&quot;')}"`;
  const tick = (d1 - d0) > 90 ? 14 : 7;
  for (let t = Math.ceil(d0 / tick) * tick; t <= d1; t += tick)
    o += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${bot}" class="t-grid"/><text x="${x(t)}" y="${total - 1}" text-anchor="middle" class="t-tick">${dayTxt(t)}</text>`;
  o += `<text x="0" y="${total - 1}" class="t-tick">day vs transplant</text>`;
  for (const r of rows) o += `<rect x="${G - 4}" y="${r.y - 4}" width="${PW + 8}" height="${r.h + 8}" rx="8" class="t-hl" data-hl="${r.k}"/>`;
  const reach = (s) => S.revealed || p.samples.indexOf(s) <= S.maxCur;   // click-to-jump only to already-shown samples
  for (const r of rows) {
    if (r.k === 'ecoli' || r.k === 'entero') {
      const org = r.k, a = Math.log10(0.002), b = Math.log10(0.5);
      const ly = (v) => r.y + r.h - (Math.log10(Math.max(0.002, Math.min(0.5, v))) - a) / (b - a) * r.h;
      bg(r); lbl(r, NAME[org], '14-day risk', true);
      const th = S.thr[org];
      o += `<rect x="${G}" y="${r.y}" width="${PW}" height="${ly(th.high) - r.y}" class="t-hband"/>
        <rect x="${G}" y="${ly(th.high)}" width="${PW}" height="${ly(th.watch) - ly(th.high)}" class="t-wband"/>
        <text x="${G - 6}" y="${ly(th.high) + 3}" text-anchor="end" class="t-cut">High ${pct(th.high)}</text>
        <text x="${G - 6}" y="${ly(th.watch) + 3}" text-anchor="end" class="t-cut">Watch ${pct(th.watch)}</text>`;
      const pts = p.samples.filter(s => s['p_' + org] != null && vis(s.day));
      if (pts.length) {
        let path = ''; pts.forEach((s, i) => { path += i ? `H${x(s.day)}V${ly(s['p_' + org])}` : `M${x(s.day)},${ly(s['p_' + org])}`; });
        const end = S.revealed ? x(pts[pts.length - 1].day + 2) : x(Math.max(pts[pts.length - 1].day, d));
        P += `<path d="${path}H${end}" class="t-risk"/>`;
        pts.forEach((s, i) => {
          const v = s['p_' + org], t = tierOf(org, v), into = t === 'high' && (i === 0 || tierOf(org, pts[i - 1]['p_' + org]) !== 'high');
          const idx = p.samples.indexOf(s), can = reach(s);
          if (into) P += `<path d="M${x(s.day) - 5},${ly(v) - 9}l5,-7l5,7z" class="t-into"${tip(`Rose into High on day ${dayTxt(s.day)}`)}/>`;
          P += `<circle cx="${x(s.day)}" cy="${ly(v)}" r="${t === 'low' ? 3.2 : 4.6}" class="t-pt ${t}${can ? ' jump' : ''}${idx === S.cur ? ' cur' : ''}" ${can ? `data-go="${idx}"` : ''}${tip(
            `<b><i>${NAME[org]}</i></b> · day ${dayTxt(s.day)}<br>${pct(v)} risk in the next 14 days · ${TIER[t]}${can && idx !== S.cur ? '<br><span class=muted>click to go to this sample</span>' : ''}`)}/>`;
        });
      }
    } else if (r.k === 'ab') {
      const a = Math.log10(0.0005), b = 0, ly = (v) => r.y + r.h - (Math.log10(Math.max(0.0005, Math.min(1, v))) - a) / (b - a) * r.h;
      bg(r); lbl(r, 'In stool', narrow ? 'rel. abundance' : 'relative abundance');
      o += narrow
        ? `<line x1="0" x2="14" y1="${r.y + 24}" y2="${r.y + 24}" class="t-ab-a"/><text x="17" y="${r.y + 27}" class="t-sub it">E. coli</text>
           <line x1="0" x2="14" y1="${r.y + 37}" y2="${r.y + 37}" class="t-ab-b"/><text x="17" y="${r.y + 40}" class="t-sub it">Entero.</text>`
        : `<line x1="${G + 8}" x2="${G + 26}" y1="${r.y + 9}" y2="${r.y + 9}" class="t-ab-a"/><text x="${G + 30}" y="${r.y + 12}" class="t-sub it">E. coli</text>
           <line x1="${G + 66}" x2="${G + 84}" y1="${r.y + 9}" y2="${r.y + 9}" class="t-ab-b"/><text x="${G + 88}" y="${r.y + 12}" class="t-sub it">Enterococcus</text>`;
      for (const v of [0.001, 0.01, 0.1, 1]) o += `<text x="${G - 6}" y="${ly(v) + 3}" text-anchor="end" class="t-tick">${+(v * 100).toPrecision(2)}%</text>`;
      for (const [org, cls] of [['ecoli', 'a'], ['entero', 'b']]) {
        const pts = p.samples.filter(s => s['ab_' + org] != null && vis(s.day));
        if (!pts.length) continue;
        P += `<path d="${pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.day)},${ly(s['ab_' + org])}`).join('')}" class="t-ab-${cls}"/>`;
        P += pts.map(s => `<circle cx="${x(s.day)}" cy="${ly(s['ab_' + org])}" r="2.4" class="t-dot-${cls}"${tip(`<b><i>${NAME[org]}</i></b> in stool · day ${dayTxt(s.day)}<br>${abTxt(s['ab_' + org])}`)}/>`).join('');
      }
    } else if (r.k === 'abx') {
      lbl(r, 'Antibiotics', '');
      if (!drugs.length) o += `<text x="${G + 6}" y="${r.y + 22}" class="t-sub">none in this window</text>`;
      const ML = narrow ? 13 : 22;
      drugs.forEach((i, k) => {
        const yy = r.y + 18 + k * H.lane, nm = S.meta.drugs[i];
        o += `<text x="${G - 6}" y="${yy + 9}" text-anchor="end" class="t-tick">${nm.length > ML ? nm.slice(0, ML - 1) + '…' : nm}</text>`;
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
  // 14-day horizon of the current score, on both risk tracks
  const hx0 = x(d), hx1 = Math.min(x(d + HORIZON), G + PW);
  for (const r of rows.filter(r => r.k === 'ecoli' || r.k === 'entero'))
    P += `<rect x="${hx0}" y="${r.y}" width="${Math.max(0, hx1 - hx0)}" height="${r.h}" class="t-horizon"${tip(`This score covers days ${dayTxt(d)} to ${dayTxt(d + HORIZON)}`)}/>`;
  P += `<text x="${(hx0 + hx1) / 2}" y="${top + 11}" text-anchor="middle" class="t-hz">next 14 days</text>`;
  for (const [t, a, l] of p.infections) {
    if (!vis(t)) continue;
    if (!l) { P += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${bot}" class="t-unlinked"${tip(`${agent(a)} BSI, day ${dayTxt(t)}<br>no stool sample in the 14 days before`)}/>`; continue; }
    P += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${bot}" class="t-bsi"/><text x="${x(t)}" y="${top - 12}" text-anchor="middle" class="t-bsi-txt">BSI · ${agent(a)}</text>`;
  }
  P += `<line x1="${x(d)}" x2="${x(d)}" y1="${top - 4}" y2="${bot}" class="t-today"/>`;
  if (!S.revealed) P += `<text x="${x(d)}" y="${top - 12}" text-anchor="middle" class="t-sub">today</text>`;
  const shown = p.samples.filter(s => vis(s.day)), nL = shown.filter(s => s.day < d0).length, nR = shown.filter(s => s.day > d1).length;
  if (nL) o += `<text x="${G + 2}" y="12" class="t-sub">◀ ${plural(nL, 'earlier sample')}</text>`;
  if (nR) o += `<text x="${W - R}" y="12" text-anchor="end" class="t-sub">${plural(nR, 'later sample')} ▶</text>`;
  host.innerHTML = o + `<g clip-path="url(#pc)">${P}</g></svg>`;
  host.querySelectorAll('[data-tip]').forEach(n => {
    n.addEventListener('mouseenter', (e) => { $('tip').innerHTML = n.dataset.tip; $('tip').classList.remove('hidden'); moveTip(e); });
    n.addEventListener('mousemove', moveTip); n.addEventListener('mouseleave', () => $('tip').classList.add('hidden'));
  });
  host.querySelectorAll('[data-go]').forEach(n => n.addEventListener('click', () => { $('tip').classList.add('hidden'); go(+n.dataset.go); }));
}
function moveTip(e) {
  const t = $('tip'); let X = e.clientX + 14, Y = e.clientY + 14;
  if (X + t.offsetWidth > innerWidth - 8) X = e.clientX - t.offsetWidth - 14;
  if (Y + t.offsetHeight > innerHeight - 8) Y = e.clientY - t.offsetHeight - 14;
  t.style.left = X + 'px'; t.style.top = Y + 'px';
}

// ------------------------------------------------------------------ settings, about, model facts, icon array
function tierTable(orgs) {
  const row = (o) => {
    const st = S.stats[o];
    return `<tr><td rowspan="3">${NI[o]}<br><span class="fine">baseline ${pct(st.base)}</span></td>
      <td><span class="score high">High</span></td><td>≥ ${pct(S.thr[o].high)}</td><td>${pct(st.high.share, 0)}</td><td>${pct(st.high.caught, 0)}</td><td>${pct(st.high.rate)} (${oneIn(st.high.rate)})</td></tr>
      <tr><td><span class="score watch">Watch</span></td><td>${pct(S.thr[o].watch)}–${pct(S.thr[o].high)}</td><td>${pct(st.watch.share, 0)}</td><td>${pct(st.watch.caught, 0)}</td><td>${pct(st.watch.rate)} (${oneIn(st.watch.rate)})</td></tr>
      <tr><td><span class="score low">Low</span></td><td>&lt; ${pct(S.thr[o].watch)}</td><td>${pct(st.low.share, 0)}</td><td>${pct(st.low.caught, 0)}</td><td>${pct(st.low.rate)} (${oneIn(st.low.rate)})</td></tr>`;
  };
  return `<div class="tablewrap"><table class="stats"><thead><tr><th></th><th>Tier</th><th>Risk score</th><th>Share of samples</th>
    <th>Pre-infection samples in tier</th><th>Followed by BSI ≤ 14 d</th></tr></thead><tbody>${orgs.map(row).join('')}</tbody></table></div>`;
}
function settings() {
  const reading = (o) => {
    const st = S.stats[o];
    return `<p class="reading">${NI[o]}: at this setting, ${oneIn(st.high.share)} stool samples is flagged High; ${oneIn(st.high.rate)} of those
      is followed by an ${NI[o]} BSI within 14 days. High + Watch together flag ${pct(st.high.share + st.watch.share, 0)} of samples
      and catch ${pct(st.high.caught + st.watch.caught, 0)} of pre-infection samples.</p>`;
  };
  $('tierStats').innerHTML = reading('ecoli') + reading('entero') + tierTable(ORGS);
}
function about() {
  const h = Math.round(S.sens.high * 100), w = Math.round(S.sens.watch * 100), e = S.stats.ecoli, n = S.stats.entero;
  $('aboutHigh').innerHTML = `Catches ${h}% of stool samples taken in the 14 days before an infection. ${oneIn(e.high.rate)} (<i>E. coli</i>) and ${oneIn(n.high.rate)} (<i>Enterococcus</i>) of these samples were followed by that bloodstream infection (BSI) within 14 days.`;
  $('aboutWatch').innerHTML = `Together with High, catches ${w}% of pre-infection samples. ${oneIn(e.watch.rate)} and ${oneIn(n.watch.rate)} followed by a BSI within 14 days.`;
  $('aboutLow').innerHTML = `The remaining samples: ${pct(e.low.rate)} (<i>E. coli</i>) and ${pct(n.low.rate)} (<i>Enterococcus</i>) followed by a BSI within 14 days.`;
}
function facts(focus) {
  const C = S.cohort, nPat = C.patients.length, nSamp = C.samples.day.length;
  const calib = (o) => {
    const c = S.calib[o], W = 240, Hh = 200, L = 40, B = 30, T = 8, Rr = 8, lo = Math.log10(0.001), hi = Math.log10(0.4);
    const sx = (v) => L + (Math.log10(Math.max(0.001, v)) - lo) / (hi - lo) * (W - L - Rr), sy = (v) => T + (1 - (Math.log10(Math.max(0.001, v)) - lo) / (hi - lo)) * (Hh - T - B);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" class="calsvg" role="img" aria-label="Reliability plot, ${NAME[o]}">`;
    for (const v of [0.001, 0.01, 0.1]) s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${Hh - B}" class="t-grid"/><line x1="${L}" x2="${W - Rr}" y1="${sy(v)}" y2="${sy(v)}" class="t-grid"/>
      <text x="${sx(v)}" y="${Hh - B + 13}" text-anchor="middle" class="t-tick">${v * 100}%</text><text x="${L - 4}" y="${sy(v) + 3}" text-anchor="end" class="t-tick">${v * 100}%</text>`;
    s += `<line x1="${sx(0.001)}" y1="${sy(0.001)}" x2="${sx(0.4)}" y2="${sy(0.4)}" class="cal-diag"/>`;
    s += `<path d="${c.bins.map((b, i) => `${i ? 'L' : 'M'}${sx(b.pred)},${sy(b.obs)}`).join('')}" class="cal-line"/>`;
    s += c.bins.map(b => b.obs === 0
      ? `<circle cx="${sx(b.pred)}" cy="${sy(0.001)}" r="3.6" class="cal-pt zero"><title>predicted ${pct(b.pred)}, no BSIs observed (n = ${fmtN(b.n)})</title></circle><text x="${sx(b.pred)}" y="${sy(0.001) - 6}" text-anchor="middle" class="t-tick">0</text>`
      : `<circle cx="${sx(b.pred)}" cy="${sy(b.obs)}" r="3.4" class="cal-pt"><title>predicted ${pct(b.pred)}, observed ${pct(b.obs)} (n = ${fmtN(b.n)})</title></circle>`).join('');
    s += `<text x="${(L + W - Rr) / 2}" y="${Hh - 2}" text-anchor="middle" class="t-sub">model's estimate</text>
      <text x="10" y="${(T + Hh - B) / 2}" text-anchor="middle" class="t-sub" transform="rotate(-90 10 ${(T + Hh - B) / 2})">observed rate</text></svg>`;
    return `<figure class="cal"><figcaption>${NI[o]}</figcaption>${s}<div class="fine">10 bins of ${fmtN(Math.round(c.total / 10))} samples (total ${fmtN(c.binned)} of ${fmtN(c.total)} scored)</div></figure>`;
  };
  const notHigh = (o) => `${pct(1 - S.stats[o].high.rate, 0)} of ${NI[o]} High samples were not followed by an ${NI[o]} BSI within 14 days`;
  $('factsBody').innerHTML = `
    <dl class="mf">
      <dt>Name</dt><dd>BSI Timeline risk scores (${NI.ecoli} and ${NI.entero}) · build ${BUILD}</dd>
      <dt>Intended use</dt><dd>Research demonstration only. Not for clinical use and not for time-critical decisions.</dd>
      <dt>Population</dt><dd>MSK allogeneic HCT patients, retrospective: ${fmtN(nPat)} patients, ${fmtN(nSamp)} stool samples
        (${fmtN(S.stats.ecoli.n)} scored for ${NI.ecoli}, ${fmtN(S.stats.entero.n)} for ${NI.entero}).</dd>
      <dt>Outcome</dt><dd>Bloodstream infection (BSI) with the organism within 14 days after a stool sample. A BSI is <i>linked</i> to
        the stool data only if a stool sample was taken in the 14 days before it. Samples on or after a patient's first BSI with an organism are not scored for that organism.</dd>
      <dt>Inputs</dt><dd>Only what was known on the day of the sample: stool microbiome composition and its recent trend; antibiotic exposure by class;
        neutrophil count (ANC) level and trend; day relative to transplant; for ${NI.entero}, also commensal-bacteria indices and an antibiotic → anaerobe-loss pattern.
        <b>Temperature is shown for context; it is not a model input.</b></dd>
      <dt>Method</dt><dd>Gradient-boosted survival models (XGBoost, Cox), 61 (${NI.ecoli}) and 640 (${NI.entero}) inputs. Every score shown comes from a model that never saw that patient
        (patient-grouped cross-validation, averaged over 5 repeats).</dd>
      <dt>Performance</dt><dd>Pooled out-of-fold AUC for BSI within 14 days: ${NI.ecoli} <b>${AUC.ecoli.model}</b> (pathogen abundance alone ${AUC.ecoli.abundance});
        ${NI.entero} <b>${AUC.entero.model}</b> (abundance alone ${AUC.entero.abundance}). Baseline rate of BSI within 14 days per stool sample:
        ${pct(S.stats.ecoli.base)} (${NI.ecoli}), ${pct(S.stats.entero.base)} (${NI.entero}).</dd>
    </dl>
    <h3>Tiers at your current settings</h3>${tierTable(focus ? [focus] : ORGS)}
    <h3>Calibration</h3><div class="cals">${(focus ? [focus] : ORGS).map(calib).join('')}</div>
    <p class="fine">Mean model estimate vs observed rate of BSI within 14 days, by tenths of the score; the diagonal is perfect agreement.
      Open circles: no BSIs observed in that bin (drawn at the axis floor). Out-of-fold, retrospective, single cohort.</p>
    <h3>Warnings</h3>
    <ul class="warn">
      <li>The model design was found by an agent-assisted search on this same cohort.</li>
      <li>Tier cut-offs were chosen on the same cohort (in-sample).</li>
      <li>No external or prospective validation.</li>
      <li>"What raised the model's score" describes the model, not causes.</li>
      <li>BSI is uncommon, so most High samples are not followed by BSI: ${notHigh('ecoli')}; ${notHigh('entero')}.</li>
    </ul>`;
}
function iconArray(o, t) {
  const st = S.stats[o][t], k = Math.round(st.rate * 100);
  $('iconsBody').innerHTML = `<p class="lead">${NI[o]} · <span class="score ${t}">${TIER[t]}</span>: of every 100 stool samples at this level,
    about <b>${k}</b> were followed by an ${NI[o]} BSI within 14 days (${pct(st.rate)}; ${fmtN(st.events)} of ${fmtN(st.n)} samples).</p>
    <div class="dots" role="img" aria-label="${k} of 100 filled">${Array.from({ length: 100 }, (_, i) => `<span class="${i < k ? 'f' : ''}"></span>`).join('')}</div>
    <p class="fine">Filled = followed by BSI within 14 days. Retrospective MSK cohort; cut-offs chosen on the same cohort.</p>`;
}

init().catch(e => { document.querySelector('main').innerHTML = `<p style="padding:24px">Could not load data (${e.message}). Serve this folder over http.</p>`; });
