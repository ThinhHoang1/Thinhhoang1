#!/usr/bin/env node
// Draws every image on the profile and the README itself from
//   profile.config.json        — words, projects, stack
//   GitHub (live)              — public contribution calendar + repo stars/languages
//   data/private-activity.json — my commits per day in private repos (counts only)
// Zero dependencies. `node scripts/build.mjs` (add --offline to reuse data/github.json).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const cfg = readJson('profile.config.json');
const TOKEN = process.env.GITHUB_TOKEN || '';
const OFFLINE = process.argv.includes('--offline');
const UA = { 'User-Agent': `${cfg.username}-profile-builder` };

// ───────────────────────────── themes ─────────────────────────────

const THEMES = {
  dark: {
    bg: '#060910', panel: '#0b1120', line: '#1a2540', text: '#e8eefc', muted: '#8391ad', dim: '#3d4a66',
    c1: '#22d3ee', c2: '#a78bfa', c3: '#f472b6', ok: '#34d399', warn: '#fbbf24', onAccent: '#ffffff',
    glow: 0.32, ramp: ['#141c2e', '#155e75', '#0ea5c6', '#8b5cf6', '#ec4899'], shade: '#000000',
  },
  light: {
    bg: '#ffffff', panel: '#f7f9fc', line: '#dde4ef', text: '#0b1220', muted: '#56627a', dim: '#a6b0c3',
    c1: '#0891b2', c2: '#7c3aed', c3: '#db2777', ok: '#059669', warn: '#d97706', onAccent: '#ffffff',
    glow: 0.14, ramp: ['#e9eef5', '#a5e9f7', '#22c3e0', '#8b5cf6', '#db2777'], shade: '#1e293b',
  },
};
const SANS = `'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`;
const MONO = `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;

// ───────────────────────────── helpers ─────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n.toLocaleString('en-US');
const r1 = (n) => +n.toFixed(1);
const pts = (list) => list.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const todayIn = (tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function wrap(text, max) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (cur && `${cur} ${word}`.length > max) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

// SMIL keyTimes must not repeat; drop the later of two equal times.
function keyframes(frames) {
  const out = [];
  for (const f of frames) if (!out.length || f[0] > out[out.length - 1][0] + 1e-6) out.push(f);
  return { keyTimes: out.map((f) => r1(f[0] * 1000) / 1000).join(';'), values: out.map((f) => r1(f[1])).join(';') };
}

function svg(w, h, t, { title, desc }, defs, body, css = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc>
<style>
.s{font-family:${SANS}}.m{font-family:${MONO}}
${css}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<defs>
<clipPath id="card"><rect width="${w}" height="${h}" rx="18"/></clipPath>
<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="haze" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="70"/></filter>
<linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.c1}"/><stop offset=".5" stop-color="${t.c2}"/><stop offset="1" stop-color="${t.c3}"/></linearGradient>
${defs}
</defs>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="18" fill="${t.bg}" stroke="${t.line}"/>
<g clip-path="url(#card)">
${body}
</g>
</svg>
`;
}

// Section header shared by the large panels.
const header = (t, x, y, tag, heading) =>
  `<text class="m" x="${x}" y="${y}" font-size="12" letter-spacing="2" fill="${t.c1}">${esc(tag)}</text>
<text class="s" x="${x}" y="${y + 28}" font-size="22" font-weight="700" fill="${t.text}">${esc(heading)}</text>`;

// Soft background: haze blobs + dot grid fading out from the centre.
function backdrop(t, w, h, blobs) {
  return `<g filter="url(#haze)" opacity="${t.glow}">${blobs
    .map(([x, y, r, c], i) => `<circle class="drift d${i % 3}" cx="${x}" cy="${y}" r="${r}" fill="${t[c]}"/>`)
    .join('')}</g>
<rect width="${w}" height="${h}" fill="url(#dots)" mask="url(#fade)"/>`;
}
const backdropDefs = (t, w, h) => `<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1" fill="${t.dim}"/></pattern>
<radialGradient id="fadeG" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="fade"><rect width="${w}" height="${h}" fill="url(#fadeG)"/></mask>`;
const backdropCss = `.drift{animation:drift 18s ease-in-out infinite alternate}.d1{animation-duration:23s}.d2{animation-duration:29s}
@keyframes drift{to{transform:translate(40px,18px)}}`;

// ───────────────────────────── data ─────────────────────────────

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...UA, ...init.headers } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function calendarViaGraphQL(user) {
  const query = 'query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}';
  const body = await fetchJson('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { u: user } }),
  });
  if (body.errors) throw new Error(body.errors[0].message);
  const days = {};
  for (const week of body.data.user.contributionsCollection.contributionCalendar.weeks)
    for (const d of week.contributionDays) days[d.date] = d.contributionCount;
  return days;
}

// Public page, no token needed: each day is a <td data-date id> with a <tool-tip for=id>"N contributions on …"</tool-tip>.
async function calendarViaHtml(user) {
  const res = await fetch(`https://github.com/users/${user}/contributions`, { headers: UA });
  if (!res.ok) throw new Error(`contributions page → HTTP ${res.status}`);
  const html = await res.text();
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) tips.set(m[1], m[2].trim());
  const days = {};
  for (const [tag] of html.matchAll(/<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g)) {
    const date = tag.match(/data-date="([^"]+)"/)[1];
    const tip = tips.get(tag.match(/\bid="([^"]+)"/)?.[1]);
    if (tip === undefined) throw new Error(`contributions page: no tooltip for ${date}`);
    const n = tip.match(/^([\d,]+) contributions?/);
    days[date] = n ? Number(n[1].replace(/,/g, '')) : 0;
  }
  if (!Object.keys(days).length) throw new Error('contributions page: no days parsed');
  return days;
}

async function fetchRepos(user) {
  const list = await fetchJson(`https://api.github.com/users/${user}/repos?per_page=100&type=owner`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  return Object.fromEntries(list.map((r) => [r.name, { stars: r.stargazers_count, language: r.language }]));
}

async function loadGithub() {
  const cachePath = join(ROOT, 'data/github.json');
  const cache = existsSync(cachePath) ? readJson('data/github.json') : { calendar: {}, repos: {} };
  if (OFFLINE) return cache;

  const fresh = { fetchedAt: new Date().toISOString(), calendar: cache.calendar, repos: cache.repos };
  try {
    fresh.calendar = TOKEN
      ? await calendarViaGraphQL(cfg.username).catch((e) => {
          console.warn(`graphql calendar failed (${e.message}); falling back to the public page`);
          return calendarViaHtml(cfg.username);
        })
      : await calendarViaHtml(cfg.username);
  } catch (e) {
    console.warn(`calendar: ${e.message}; keeping cached data`);
  }
  try {
    fresh.repos = await fetchRepos(cfg.username);
  } catch (e) {
    console.warn(`repos: ${e.message}; keeping cached data`);
  }
  writeFileSync(cachePath, `${JSON.stringify(fresh, null, 2)}\n`);
  return fresh;
}

function buildActivity(github, priv, today) {
  const start = addDays(today, -weekday(today) - 52 * 7); // a Sunday; 53 columns end on today's week
  const days = [];
  for (let d = start, i = 0; d <= today; d = addDays(d, 1), i++) {
    const gh = github[d] || 0;
    const pv = priv[d] || 0;
    days.push({ date: d, week: Math.floor(i / 7), day: i % 7, count: gh + pv, gh, pv });
  }

  const year = days.filter((d) => d.date > addDays(today, -365));
  let longest = 0;
  let run = 0;
  for (const d of year) {
    run = d.count ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = year.length - 1 - (year.at(-1).count ? 0 : 1); i >= 0 && year[i].count; i--) current++;
  const best = year.reduce((a, b) => (b.count > a.count ? b : a), year[0]);

  return {
    days,
    today,
    total: year.reduce((s, d) => s + d.count, 0),
    publicTotal: year.reduce((s, d) => s + d.gh, 0),
    privateTotal: year.reduce((s, d) => s + d.pv, 0),
    active: year.filter((d) => d.count).length,
    longest,
    current,
    best,
  };
}

// ───────────────────────────── hero ─────────────────────────────

function hero(t, a) {
  const W = 1200;
  const H = 360;
  const lines = cfg.typed.map((s) => s.replace('{total}', fmt(a.total)));
  const FS = 19;
  const CW = FS * 0.6;
  const X0 = 82;
  const Y = 234;
  const N = lines.length;
  const DUR = N * 4;
  const f = 1 / N;

  const cursorFrames = [[0, 0]];
  const typed = lines
    .map((s, i) => {
      const w = s.length * CW;
      const a0 = i * f;
      const b0 = a0 + f;
      const frames = [[0, 0], [a0, 0], [a0 + 0.42 * f, w], [b0 - 0.1 * f, w], [b0 - 0.04 * f, 0], [1, 0]];
      cursorFrames.push(...frames.slice(1, 5));
      const k = keyframes(frames);
      return `<clipPath id="tc${i}"><rect x="${X0}" y="${Y - FS - 2}" height="${FS * 1.7}" width="0"><animate attributeName="width" dur="${DUR}s" repeatCount="indefinite" keyTimes="${k.keyTimes}" values="${k.values}"/></rect></clipPath>
<text class="m" x="${X0}" y="${Y}" font-size="${FS}" fill="${t.text}" textLength="${r1(w)}" lengthAdjust="spacingAndGlyphs" clip-path="url(#tc${i})">${esc(s)}</text>`;
    })
    .join('\n');
  cursorFrames.push([1, 0]);
  const ck = keyframes(cursorFrames.map(([k, v]) => [k, X0 + v + 3]));

  let cx = 56;
  const chips = cfg.chips
    .map((c) => {
      const w = c.length * 7.8 + 26;
      const out = `<rect x="${cx}" y="268" width="${r1(w)}" height="30" rx="15" fill="${t.panel}" stroke="${t.line}"/><text class="m" x="${r1(cx + w / 2)}" y="288" font-size="13" text-anchor="middle" fill="${t.muted}">${esc(c)}</text>`;
      cx += w + 10;
      return out;
    })
    .join('');

  const ox = 968;
  const oy = 182;
  const R = 140;
  const loopLabels = [
    ['PLAN', 0, -R - 12, 'middle'],
    ['ACT', R + 12, 4, 'start'],
    ['OBSERVE', 0, R + 20, 'middle'],
    ['LEARN', -R - 12, 4, 'end'],
  ]
    .map(([s, x, y, anchor]) => `<text class="m" x="${x}" y="${y}" font-size="11" letter-spacing="2" text-anchor="${anchor}" fill="${t.muted}">${s}</text>`)
    .join('');
  const comet = [0, 0.08, 0.16, 0.24, 0.32]
    .map((lag, i) => `<circle r="${4.5 - i * 0.7}" fill="${t.c1}" opacity="${1 - i * 0.18}"${i ? '' : ' filter="url(#glow)"'}><animateMotion dur="9s" begin="-${lag}s" repeatCount="indefinite"><mpath xlink:href="#loop"/></animateMotion></circle>`)
    .join('');
  const hex = (r) => pts([0, 1, 2, 3, 4, 5].map((k) => [r * Math.cos(((60 * k - 90) * Math.PI) / 180), r * Math.sin(((60 * k - 90) * Math.PI) / 180)]));

  const defs = `${backdropDefs(t, W, H)}
<linearGradient id="nameG" x1="0" y1="0" x2="760" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="reflect">
<stop offset="0" stop-color="${t.c1}"/><stop offset=".5" stop-color="${t.c2}"/><stop offset="1" stop-color="${t.c3}"/>
<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="1520 0" dur="10s" repeatCount="indefinite"/>
</linearGradient>
<linearGradient id="coreG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.c2}"/><stop offset="1" stop-color="${t.c1}"/></linearGradient>
<linearGradient id="scanG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.c1}" stop-opacity="0"/><stop offset=".5" stop-color="${t.c1}" stop-opacity=".07"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></linearGradient>
<linearGradient id="edgeG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.c1}" stop-opacity="0"/><stop offset=".5" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></linearGradient>`;

  const css = `${backdropCss}
.blink{animation:blink 1.6s steps(1) infinite}@keyframes blink{50%{opacity:0}}
.caret{animation:blink 1s steps(1) infinite}
.g1,.g2{opacity:0;animation:g1 7s steps(1) infinite}.g2{animation-name:g2}
@keyframes g1{0%,86%,100%{opacity:0;transform:none}87%{opacity:.85;transform:translate(-5px,1px)}88%{opacity:.5;transform:translate(4px,-2px)}89%{opacity:0}93%{opacity:.6;transform:translate(-2px,0)}94%{opacity:0}}
@keyframes g2{0%,86%,100%{opacity:0;transform:none}87%{opacity:.8;transform:translate(5px,-1px)}88%{opacity:.4;transform:translate(-3px,2px)}89%{opacity:0}93%{opacity:.55;transform:translate(2px,1px)}94%{opacity:0}}
.scan{animation:scan 7s linear infinite}@keyframes scan{from{transform:translateY(-140px)}to{transform:translateY(${H + 140}px)}}
.edge{animation:edge 6s ease-in-out infinite}@keyframes edge{0%{transform:translateX(-700px)}100%{transform:translateX(${W}px)}}
.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 3.2s ease-in-out infinite}@keyframes pulse{50%{transform:scale(1.07)}}
.rise{animation:rise .9s cubic-bezier(.2,.8,.2,1) both}@keyframes rise{from{opacity:0;transform:translateY(14px)}}`;

  const name = (cls, fill) =>
    `<text class="s ${cls}" x="54" y="146" font-size="78" font-weight="800" letter-spacing="1" fill="${fill}">${esc(cfg.name)}</text>`;

  const body = `${backdrop(t, W, H, [[1010, 70, 170, 'c2'], [160, 360, 190, 'c1'], [640, -20, 120, 'c3']])}
<rect class="edge" x="0" y="0" width="700" height="2" fill="url(#edgeG)"/>
<rect class="scan" x="0" y="0" width="${W}" height="140" fill="url(#scanG)"/>

<g class="rise">
<circle class="blink" cx="60" cy="58" r="4" fill="${t.ok}"/>
<text class="m" x="74" y="62" font-size="12" letter-spacing="2.5" fill="${t.muted}">ONLINE · ${esc(cfg.location)}</text>
${name('g1', t.c1)}${name('g2', t.c3)}${name('', 'url(#nameG)')}
<text class="s" x="56" y="184" font-size="19" fill="${t.muted}">${esc(cfg.fullName)}  <tspan fill="${t.dim}">/</tspan>  <tspan fill="${t.text}" font-weight="600">${esc(cfg.role)}</tspan></text>
</g>

<text class="m" x="56" y="${Y}" font-size="${FS}" font-weight="700" fill="${t.c1}">&gt;</text>
${typed}
<rect class="caret" y="${Y - FS + 2}" width="10" height="${FS + 2}" fill="${t.c1}" x="${X0}"><animate attributeName="x" dur="${DUR}s" repeatCount="indefinite" keyTimes="${ck.keyTimes}" values="${ck.values}"/></rect>
${chips}
<text class="m" x="56" y="${H - 24}" font-size="11" fill="${t.dim}">redrawn ${a.today} by scripts/build.mjs · every number is real</text>

<g transform="translate(${ox},${oy})">
<circle r="${R}" fill="none" stroke="${t.line}" stroke-dasharray="2 7"/>
<path id="loop" d="M0,${-R} A${R},${R} 0 1,1 -0.01,${-R}" fill="none"/>
${comet}
${loopLabels}
<g><circle r="104" fill="none" stroke="${t.c2}" stroke-opacity=".55" stroke-dasharray="1 9" stroke-linecap="round" stroke-width="3"/>
<circle cx="104" r="5" fill="${t.c3}" filter="url(#glow)"/><circle cx="-104" r="3.5" fill="${t.c2}"/>
<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="34s" repeatCount="indefinite"/></g>
<g><circle r="80" fill="none" stroke="${t.c1}" stroke-opacity=".5" stroke-dasharray="26 12"/>
<circle cy="-80" r="3.5" fill="${t.c1}"/>
<animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="22s" repeatCount="indefinite"/></g>
<circle r="58" fill="none" stroke="${t.c1}" stroke-opacity=".25"/>
<g class="pulse"><polygon points="${hex(44)}" fill="url(#coreG)" filter="url(#glow)"/></g>
<text class="m" y="6" font-size="18" font-weight="700" text-anchor="middle" fill="${t.onAccent}">AI</text>
</g>`;

  return svg(W, H, t, { title: `${cfg.name} — ${cfg.role}`, desc: lines.join(' · ') }, defs, body, css);
}

// ───────────────────────────── agent core ─────────────────────────────

function core(t) {
  const W = 1200;
  const H = 530;
  const cx = 600;
  const cy = 284;
  const [RX, RY] = [420, 178];
  const BW = 284;
  const BH = 66;
  const accents = [t.c1, t.c2, t.c3];
  const mods = cfg.core.modules.map((m, i) => {
    const ang = ((-90 + (360 / cfg.core.modules.length) * i) * Math.PI) / 180;
    return { ...m, i, x: cx + RX * Math.cos(ang), y: cy + RY * Math.sin(ang), c: accents[i % 3] };
  });

  const spokes = mods
    .map(({ x, y, c, i }) => {
      const d = `M${cx},${cy} L${r1(x)},${r1(y)}`;
      const inbound = i % 2 === 1;
      return `<path d="${d}" stroke="${t.line}" stroke-width="1.5" fill="none"/>
<path class="flow" d="${d}" stroke="${c}" stroke-opacity=".7" stroke-width="1.5" stroke-dasharray="4 14" fill="none" style="animation-delay:-${i * 0.4}s${inbound ? ';animation-direction:reverse' : ''}"/>
<circle r="3.5" fill="${c}" filter="url(#glow)"><animateMotion dur="2.8s" begin="-${(i * 0.35).toFixed(2)}s" repeatCount="indefinite" path="${d}"${inbound ? ' keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}/></circle>`;
    })
    .join('\n');

  const boxes = mods
    .map(({ title, line, x, y, c, i }) => {
      const bx = x - BW / 2;
      const by = y - BH / 2;
      return `<g class="pop" style="animation-delay:${i * 90}ms">
<rect x="${r1(bx)}" y="${r1(by)}" width="${BW}" height="${BH}" rx="12" fill="${t.panel}" stroke="${t.line}"/>
<rect x="${r1(bx)}" y="${r1(by + 14)}" width="3" height="${BH - 28}" rx="1.5" fill="${c}"/>
<text class="m" x="${r1(bx + 18)}" y="${r1(by + 28)}" font-size="12" fill="${c}">0${i + 1}</text>
<text class="s" x="${r1(bx + 46)}" y="${r1(by + 28)}" font-size="18" font-weight="700" fill="${t.text}">${esc(title)}</text>
<text class="m" x="${r1(bx + 46)}" y="${r1(by + 50)}" font-size="13" fill="${t.muted}">${esc(line)}</text>
</g>`;
    })
    .join('\n');

  const hex = (r) => pts([0, 1, 2, 3, 4, 5].map((k) => [cx + r * Math.cos(((60 * k - 90) * Math.PI) / 180), cy + r * Math.sin(((60 * k - 90) * Math.PI) / 180)]));

  const defs = `${backdropDefs(t, W, H)}
<linearGradient id="coreG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.c2}"/><stop offset="1" stop-color="${t.c1}"/></linearGradient>`;
  const css = `${backdropCss}
.flow{animation:flow 1.2s linear infinite}@keyframes flow{to{stroke-dashoffset:-18}}
.pop{animation:pop .7s cubic-bezier(.2,.8,.2,1) both}@keyframes pop{from{opacity:0;transform:translateY(10px)}}
.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 3s ease-in-out infinite}@keyframes pulse{50%{transform:scale(1.06)}}
.ring{transform-box:fill-box;transform-origin:center;animation:spin 30s linear infinite}.ring.r{animation-duration:44s;animation-direction:reverse}@keyframes spin{to{transform:rotate(360deg)}}`;

  const body = `${backdrop(t, W, H, [[600, 270, 200, 'c2'], [120, 80, 140, 'c1'], [1100, 460, 150, 'c3']])}
${header(t, 40, 46, '01 // AGENT CORE', 'What I engineer, end to end')}
<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="none" stroke="${t.line}" stroke-dasharray="3 6"/>
${spokes}
<circle class="ring" cx="${cx}" cy="${cy}" r="92" fill="none" stroke="${t.c1}" stroke-opacity=".45" stroke-dasharray="22 10"/>
<circle class="ring r" cx="${cx}" cy="${cy}" r="108" fill="none" stroke="${t.c2}" stroke-opacity=".5" stroke-width="2.5" stroke-dasharray="1 8" stroke-linecap="round"/>
<polygon class="pulse" points="${hex(66)}" fill="url(#coreG)" filter="url(#glow)"/>
<text class="m" x="${cx}" y="${cy + 2}" font-size="17" font-weight="800" letter-spacing="3" text-anchor="middle" fill="${t.onAccent}">${esc(cfg.core.center)}</text>
<text class="m" x="${cx}" y="${cy + 20}" font-size="10" letter-spacing="1.5" text-anchor="middle" fill="${t.onAccent}" opacity=".85">plan · act · learn</text>
${boxes}`;

  return svg(W, H, t, { title: 'Agent core', desc: mods.map((m) => `${m.title}: ${m.line}`).join('. ') }, defs, body, css);
}

// ───────────────────────────── activity skyline ─────────────────────────────

function skyline(t, a) {
  const W = 1200;
  const H = 540;
  const [ax, ay, bx, by] = [14.6, -4.3, 9.4, 6.1]; // week axis, weekday axis
  const [ox, oy] = [300, 468];
  const P = (w, d) => [ox + w * ax + d * bx, oy + w * ay + d * by];
  const weeks = a.days.at(-1).week + 1;
  const max = Math.max(1, ...a.days.map((d) => d.count));

  const nonzero = a.days.map((d) => d.count).filter(Boolean).sort((x, y) => x - y);
  const q = (p) => nonzero[Math.floor(p * (nonzero.length - 1))] ?? 1;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const level = (n) => (!n ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);
  const height = (n) => (n ? 5 + 112 * Math.sqrt(n / max) : 0);

  const G = 0.13;
  const towers = [...a.days]
    .sort((p, q2_) => p.week * ay + p.day * by - (q2_.week * ay + q2_.day * by))
    .map((d) => {
      const h = height(d.count);
      const c = t.ramp[level(d.count)];
      const p0 = P(d.week + G, d.day + G);
      const p1 = P(d.week + 1 - G, d.day + G);
      const p2 = P(d.week + 1 - G, d.day + 1 - G);
      const p3 = P(d.week + G, d.day + 1 - G);
      const up = ([x, y]) => [x, y - h];
      const top = `<polygon points="${pts([p0, p1, p2, p3].map(up))}" fill="${d.count ? mix(c, '#ffffff', 0.12) : c}"/>`;
      if (!d.count) return top;
      return `<g class="tw" style="animation-delay:${d.week * 26 + d.day * 8}ms"><title>${d.count} on ${prettyDate(d.date)}</title>
<polygon points="${pts([up(p0), up(p3), p3, p0])}" fill="${mix(c, t.shade, 0.22)}"/>
<polygon points="${pts([up(p3), up(p2), p2, p3])}" fill="${mix(c, t.shade, 0.42)}"/>${top}</g>`;
    })
    .join('\n');

  const plate = (() => {
    const [a0, a1, a2, a3] = [P(-0.4, -0.4), P(weeks + 0.4, -0.4), P(weeks + 0.4, 7.4), P(-0.4, 7.4)];
    const down = ([x, y]) => [x, y + 9];
    return `<polygon points="${pts([a0, a3, down(a3), down(a0)])}" fill="${mix(t.panel, t.shade, 0.18)}"/>
<polygon points="${pts([a3, a2, down(a2), down(a3)])}" fill="${mix(t.panel, t.shade, 0.32)}"/>
<polygon points="${pts([a0, a1, a2, a3])}" fill="${t.panel}" stroke="${t.line}"/>`;
  })();

  const angle = r1((Math.atan2(ay, ax) * 180) / Math.PI);
  const months = a.days
    .filter((d) => d.date.endsWith('-01'))
    .map((d) => {
      const [x, y] = P(d.week + 0.2, 7.4);
      return `<text class="m" font-size="11" fill="${t.muted}" transform="translate(${r1(x + 2)},${r1(y + 22)}) rotate(${angle})">${MONTHS[+d.date.slice(5, 7) - 1]}</text>`;
    })
    .join('');

  // Top days get a label each: one row above the skyline, pushed apart so they never overlap.
  const top3 = [...a.days]
    .sort((p, q2_) => q2_.count - p.count)
    .slice(0, 3)
    .filter((d) => d.count)
    .map((d) => {
      const [x, y] = P(d.week + 0.5, d.day + 0.5);
      return { d, x, top: y - height(d.count), text: `${d.count} · ${prettyDate(d.date)}` };
    })
    .sort((p, q2_) => p.x - q2_.x);
  const rowY = Math.min(...top3.map((p) => p.top)) - 46;
  const widthOf = (p) => p.text.length * 7.2 + 16;
  let edge = -Infinity;
  for (const p of top3) {
    p.lx = Math.max(p.x, edge + widthOf(p) / 2 + 10);
    edge = p.lx + widthOf(p) / 2;
  }
  const overflow = Math.max(0, edge - (W - 30));
  const peaks = top3
    .map((p, k) => {
      const lx = p.lx - overflow;
      return `<g class="peak" style="animation-delay:${1.6 + k * 0.2}s">
<polyline points="${pts([[p.x, p.top], [p.x, rowY + 16], [lx, rowY + 8]])}" fill="none" stroke="${t.text}" stroke-opacity=".45"/>
<circle cx="${r1(p.x)}" cy="${r1(p.top)}" r="3" fill="${t.text}"/>
<text class="m" x="${r1(lx)}" y="${r1(rowY)}" font-size="12" text-anchor="middle" fill="${t.text}" stroke="${t.bg}" stroke-width="4" paint-order="stroke">${p.text}</text></g>`;
    })
    .join('\n');

  const stat = (x, y, value, label) =>
    `<text class="s" x="${x}" y="${y}" font-size="26" font-weight="700" fill="${t.text}">${esc(value)}</text>
<text class="m" x="${x}" y="${y + 19}" font-size="11" letter-spacing="1" fill="${t.muted}">${esc(label)}</text>`;

  const legend = t.ramp
    .map((c, i) => `<rect x="${78 + i * 18}" y="${H - 40}" width="13" height="13" rx="3" fill="${c}"/>`)
    .join('');

  const defs = `${backdropDefs(t, W, H)}
<linearGradient id="beamG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.c1}" stop-opacity="0"/><stop offset=".5" stop-color="${t.c1}" stop-opacity=".09"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></linearGradient>`;
  const css = `${backdropCss}
.tw{transform-box:fill-box;transform-origin:50% 100%;animation:grow 1.1s cubic-bezier(.2,.9,.25,1) both}@keyframes grow{from{transform:scaleY(0)}}
.peak{animation:fadein .6s ease-out both}@keyframes fadein{from{opacity:0;transform:translateY(6px)}}
.beam{animation:beam 7s linear infinite}@keyframes beam{from{transform:translateX(-220px)}to{transform:translateX(${W + 220}px)}}`;

  const body = `${backdrop(t, W, H, [[900, 220, 200, 'c2'], [420, 470, 170, 'c1'], [1150, 40, 120, 'c3']])}
${header(t, 40, 46, '02 // ACTIVITY SKYLINE', 'One tower per day, last 12 months')}
<text class="s" x="40" y="158" font-size="64" font-weight="800" fill="url(#brand)">${fmt(a.total)}</text>
<text class="s" x="40" y="186" font-size="15" fill="${t.muted}">contributions · <tspan fill="${t.text}">${fmt(a.privateTotal)}</tspan> private · <tspan fill="${t.text}">${fmt(a.publicTotal)}</tspan> public</text>
${stat(40, 236, String(a.active), 'ACTIVE DAYS')}${stat(160, 236, `${a.longest}d`, 'LONGEST STREAK')}
${stat(40, 296, `${a.current}d`, 'CURRENT STREAK')}${stat(160, 296, String(a.best.count), `BEST · ${prettyDate(a.best.date).toUpperCase()}`)}
${plate}
${towers}
${months}
${peaks}
<rect class="beam" x="0" y="0" width="220" height="${H}" fill="url(#beamG)"/>
<text class="m" x="40" y="${H - 29}" font-size="11" fill="${t.muted}">less</text>${legend}<text class="m" x="${78 + 5 * 18 + 4}" y="${H - 29}" font-size="11" fill="${t.muted}">more</text>
<text class="m" x="${W - 40}" y="${H - 29}" font-size="11" text-anchor="end" fill="${t.dim}">my commits only · public GitHub + private work repos · counts, nothing else</text>`;

  return svg(
    W,
    H,
    t,
    { title: 'Activity skyline', desc: `${a.total} contributions in the last 12 months across ${a.active} active days; best day ${a.best.count} on ${a.best.date}.` },
    defs,
    body,
    css,
  );
}

// ───────────────────────────── field notes ─────────────────────────────

function fieldNotes(t) {
  const W = 1200;
  const COLS = 2;
  const GAP = 20;
  const CW = (W - 80 - GAP) / COLS;
  const LH = 20;
  const WRAP = 60;
  const accents = [t.c3, t.c2, t.c1, t.ok, t.warn, t.c1];
  const rowsOf = (n) => [
    ['SYMPTOM', t.c3, wrap(n.symptom, WRAP)],
    ['CAUSE', t.warn, wrap(n.cause, WRAP)],
    ['FIX', t.ok, wrap(n.fix, WRAP)],
  ];
  const heightOf = (n) => 84 + rowsOf(n).reduce((h, [, , lines]) => h + lines.length * LH + 8, 0) + 8;

  let y = 104;
  let out = '';
  for (let r = 0; r < cfg.notes.length; r += COLS) {
    const row = cfg.notes.slice(r, r + COLS);
    const h = Math.max(...row.map(heightOf));
    row.forEach((n, k) => {
      const i = r + k;
      const x = 40 + k * (CW + GAP);
      const c = accents[i % accents.length];
      let ly = y + 92;
      const body = rowsOf(n)
        .map(([label, lc, lines]) => {
          const block = `<text class="m" x="${x + 22}" y="${ly}" font-size="11" font-weight="700" letter-spacing="1" fill="${lc}">${label}</text>
${lines.map((l, j) => `<text class="s" x="${x + 104}" y="${ly + j * LH}" font-size="14" fill="${label === 'FIX' ? t.text : t.muted}">${esc(l)}</text>`).join('')}`;
          ly += lines.length * LH + 8;
          return block;
        })
        .join('\n');
      const tagW = n.tag.length * 7.2 + 24;
      out += `<g class="pop" style="animation-delay:${i * 110}ms">
<rect x="${x}" y="${y}" width="${CW}" height="${h}" rx="14" fill="${t.panel}" stroke="${t.line}"/>
<rect x="${x}" y="${y + 18}" width="3" height="28" rx="1.5" fill="${c}"/>
<rect x="${x + 22}" y="${y + 18}" width="${r1(tagW)}" height="22" rx="11" fill="${c}" fill-opacity=".12" stroke="${c}" stroke-opacity=".4"/>
<text class="m" x="${r1(x + 22 + tagW / 2)}" y="${y + 33}" font-size="11" font-weight="700" letter-spacing="1" text-anchor="middle" fill="${c}">${esc(n.tag)}</text>
<text class="m" x="${x + CW - 22}" y="${y + 33}" font-size="12" text-anchor="end" fill="${t.dim}">#${String(i + 1).padStart(2, '0')}</text>
<text class="s" x="${x + 22}" y="${y + 68}" font-size="19" font-weight="700" fill="${t.text}">${esc(n.title)}</text>
${body}
</g>`;
    });
    y += h + GAP;
  }
  const H = y + 4;

  const defs = backdropDefs(t, W, H);
  const css = `${backdropCss}
.pop{animation:pop .7s cubic-bezier(.2,.8,.2,1) both}@keyframes pop{from{opacity:0;transform:translateY(10px)}}`;
  const body = `${backdrop(t, W, H, [[1080, 80, 170, 'c3'], [120, H - 60, 170, 'c1']])}
${header(t, 40, 46, '03 // FIELD NOTES', 'Bugs that only show up in production')}
${out}`;
  return svg(W, H, t, { title: 'Field notes', desc: cfg.notes.map((n) => `${n.title}: ${n.fix}`).join(' ') }, defs, body, css);
}

// ───────────────────────────── project cards ─────────────────────────────

function card(t, p, i, repos) {
  const W = 600;
  const H = 272;
  const accent = { private: t.c3, public: t.c1, live: t.ok }[p.status];
  const badge = p.badge || 'PUBLIC REPO';
  const repo = p.repo && repos[p.repo];
  const meta = repo
    ? [repo.stars ? `★ ${repo.stars}` : '', repo.language || ''].filter(Boolean).join('  ·  ')
    : p.status === 'private' ? 'source: private' : '';
  const desc = wrap(p.desc, 58);
  if (desc.length > 4) console.warn(`card ${p.id}: description wraps to ${desc.length} lines, only 4 fit`);
  const perimeter = 2 * (W - 2 + H - 2) - (8 - 2 * Math.PI) * 16;

  let tx = 28;
  const tags = p.tags
    .map((tag) => {
      const w = tag.length * 7.8 + 24;
      const out = `<rect x="${r1(tx)}" y="${H - 52}" width="${r1(w)}" height="28" rx="14" fill="${t.panel}" stroke="${t.line}"/><text class="m" x="${r1(tx + w / 2)}" y="${H - 33}" font-size="13" text-anchor="middle" fill="${t.muted}">${esc(tag)}</text>`;
      tx += w + 8;
      return out;
    })
    .join('');

  const defs = `<radialGradient id="corner" cx="1" cy="0" r="1"><stop offset="0" stop-color="${accent}" stop-opacity=".22"/><stop offset=".6" stop-color="${accent}" stop-opacity="0"/></radialGradient>`;
  const css = `.run{animation:run 9s linear infinite;animation-delay:-${(i * 1.7).toFixed(1)}s}@keyframes run{to{stroke-dashoffset:-${r1(perimeter)}}}
.blink{animation:blink 1.6s steps(1) infinite}@keyframes blink{50%{opacity:.25}}`;

  const body = `<rect width="${W}" height="${H}" fill="url(#corner)"/>
<text class="s" x="${W - 26}" y="88" font-size="84" font-weight="800" text-anchor="end" fill="none" stroke="${t.line}" stroke-width="1.5">${String(i + 1).padStart(2, '0')}</text>
<rect x="28" y="26" width="${r1(badge.length * 6.9 + 34)}" height="24" rx="12" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-opacity=".45"/>
<circle class="blink" cx="42" cy="38" r="3.5" fill="${accent}"/>
<text class="m" x="52" y="42" font-size="11" font-weight="700" letter-spacing="1" fill="${accent}">${esc(badge)}</text>
<text class="s" x="28" y="98" font-size="29" font-weight="700" fill="${t.text}">${esc(p.title)}</text>
${desc.slice(0, 4).map((l, k) => `<text class="s" x="28" y="${132 + k * 23}" font-size="17" fill="${t.muted}">${esc(l)}</text>`).join('\n')}
${tags}
<text class="m" x="${W - 28}" y="${H - 33}" font-size="13" text-anchor="end" fill="${t.muted}">${esc(meta)}</text>
<rect class="run" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="17" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="150 ${r1(perimeter - 150)}" stroke-linecap="round"/>`;

  return svg(W, H, t, { title: p.title, desc: p.desc }, defs, body, css);
}

// ───────────────────────────── arsenal ─────────────────────────────

function arsenal(t) {
  const W = 1200;
  const colors = [t.c1, t.c2, t.c3, t.ok, t.warn];
  const X0 = 232;
  const XMAX = W - 40;
  let y = 104;
  let n = 0;
  const rows = cfg.stack
    .map((g, gi) => {
      const c = colors[gi % colors.length];
      let x = X0;
      const label = `<text class="m" x="40" y="${y + 20}" font-size="12" font-weight="700" letter-spacing="1.5" fill="${c}">${esc(g.group)}</text>`;
      const chips = g.items
        .map((item) => {
          const w = item.length * 7.8 + 42;
          if (x + w > XMAX) {
            x = X0;
            y += 42;
          }
          const out = `<g class="pop" style="animation-delay:${n++ * 35}ms"><rect x="${r1(x)}" y="${y}" width="${r1(w)}" height="30" rx="15" fill="${t.panel}" stroke="${t.line}"/><circle cx="${r1(x + 16)}" cy="${y + 15}" r="4" fill="${c}"/><text class="m" x="${r1(x + 28)}" y="${y + 20}" font-size="13" fill="${t.text}">${esc(item)}</text></g>`;
          x += w + 10;
          return out;
        })
        .join('');
      y += 52;
      return label + chips;
    })
    .join('\n');
  const H = y + 14;

  const defs = backdropDefs(t, W, H);
  const css = `${backdropCss}
.pop{animation:pop .6s cubic-bezier(.2,.8,.2,1) both}@keyframes pop{from{opacity:0;transform:translateY(8px)}}`;
  const body = `${backdrop(t, W, H, [[1050, 60, 160, 'c2'], [200, H, 160, 'c1']])}
${header(t, 40, 46, '05 // ARSENAL', 'Tools I reach for')}
${rows}`;
  return svg(W, H, t, { title: 'Arsenal', desc: cfg.stack.map((g) => `${g.group}: ${g.items.join(', ')}`).join('. ') }, defs, body, css);
}

// ───────────────────────────── README ─────────────────────────────

const picture = (name, alt, width = '100%') =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg"><source media="(prefers-color-scheme: light)" srcset="assets/${name}-light.svg"><img src="assets/${name}-dark.svg" width="${width}" alt="${esc(alt)}"></picture>`;

function readme(a) {
  const cards = cfg.projects
    .map((p) => {
      const pic = picture(`card-${p.id}`, `${p.title} — ${p.desc}`, '49%');
      const href = p.url || (p.repo && `https://github.com/${cfg.username}/${p.repo}`);
      return href ? `<a href="${href}">${pic}</a>` : pic;
    })
    .join('\n');
  const f = cfg.film;
  const film = f
    ? `<a href="${f.watch}"><img src="${f.gif}" width="100%" alt="${esc(`${f.title} (${f.english}): opening of a hand-drawn short film rendered from code`)}"></a>

<b>${esc(f.title)}</b> <i>(${esc(f.english)})</i>: a hand-drawn short film, made entirely in code<br>
<a href="${f.watch}"><b>▶ Watch the full film (1080p, 11:47)</b></a> &nbsp;·&nbsp; <a href="${f.repo}"><b>Source code</b></a><br>
<sub>${esc(f.facts)}</sub><br>
<sub>${esc(f.pipeline)}</sub>

${f.stills.map((s) => `<img src="${s}" width="24%" alt="Still from ${esc(f.title)}">`).join('\n')}

`
    : '';
  const socials = cfg.socials.map((s) => `<a href="${s.url}"><b>${esc(s.label)}</b></a>`).join(' &nbsp;·&nbsp; ');

  return `<!-- Generated by scripts/build.mjs — edit profile.config.json instead. -->
<div align="center">

${picture('hero', `${cfg.name} — ${cfg.role}`)}

${socials}

</div>

> ${cfg.intro}

${picture('core', 'Agent core: what I engineer, end to end')}

${picture('skyline', `Activity skyline: ${a.total} contributions in the last 12 months`)}

${picture('notes', 'Field notes: bugs that only show up in production')}

<div align="center">

### 04 // Selected work

${film}${cards}

</div>

${picture('arsenal', 'Arsenal: tools I reach for')}

<div align="center"><sub>No third-party widgets. A zero-dependency Node script in this repo draws every image above, and a GitHub Action redraws them every night.</sub></div>
`;
}

// ───────────────────────────── main ─────────────────────────────

const github = await loadGithub();
const priv = existsSync(join(ROOT, 'data/private-activity.json')) ? readJson('data/private-activity.json') : {};
const activity = buildActivity(github.calendar, priv, todayIn(cfg.timezone));

mkdirSync(join(ROOT, 'assets'), { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  const out = (name, content) => writeFileSync(join(ROOT, 'assets', `${name}-${mode}.svg`), content);
  out('hero', hero(t, activity));
  out('core', core(t));
  out('skyline', skyline(t, activity));
  out('notes', fieldNotes(t));
  out('arsenal', arsenal(t));
  cfg.projects.forEach((p, i) => out(`card-${p.id}`, card(t, p, i, github.repos)));
}
writeFileSync(join(ROOT, 'README.md'), readme(activity));

console.log(
  `built: ${activity.total} contributions (${activity.privateTotal} private + ${activity.publicTotal} public), ` +
    `${activity.active} active days, best ${activity.best.count} on ${activity.best.date}`,
);
