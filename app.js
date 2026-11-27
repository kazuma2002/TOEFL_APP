/* TOEFL 5.5 Trainer — 2026年新形式対応のオフライン学習アプリ
   依存ライブラリなし。データは data/content.json、記録は IndexedDB に保存する。 */
(() => {
'use strict';

const APP_VERSION = '0.2.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = s => esc(s).replace(/\n/g, '<br>');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c, n) => n ? Math.round(c / n * 100) : 0;
const words = s => (s.trim().match(/\S+/g) || []).length;
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
function today(d = new Date()) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function addDays(n, base = today()) { const d = new Date(base + 'T00:00:00'); d.setDate(d.getDate() + n); return today(d); }
const fmt = s => { const neg = s < 0; s = Math.abs(Math.round(s)); return (neg ? '+' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- 保存（IndexedDB → 失敗時 localStorage） ---------- */
const Store = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const rq = indexedDB.open('toefl_app', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.onsuccess = () => { this.db = rq.result; res(); };
        rq.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  get(k) {
    return new Promise(res => {
      if (!this.db) { try { res(JSON.parse(localStorage.getItem(k))); } catch (e) { res(null); } return; }
      const rq = this.db.transaction('kv').objectStore('kv').get(k);
      rq.onsuccess = () => res(rq.result ?? null);
      rq.onerror = () => res(null);
    });
  },
  set(k, v) {
    return new Promise(res => {
      if (!this.db) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} res(); return; }
      const tx = this.db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = res; tx.onerror = res;
    });
  }
};
const DEFAULTS = () => ({
  v: 1, attempts: [], srs: {}, vintro: { d: '', n: 0 }, wrong: {}, writings: [], days: [], vstar: {}, dictLog: [],
  settings: { rate: 0.95, voice1: '', voice2: '', examDate: '', practice: false, asr: false, newPerDay: 10,
    vdir: 'en', vcat: 'all', jaVoice: true, listenEx: true, gap: 1.2, lsRange: 'all', lsOrder: 'seq', dRange: 'studied' }
});
let S = DEFAULTS();
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => Store.set('state', S), 250); }
function mergeState(x) {
  const d = DEFAULTS();
  if (!x || typeof x !== 'object') return d;
  return { ...d, ...x, settings: { ...d.settings, ...(x.settings || {}) }, vintro: { ...d.vintro, ...(x.vintro || {}) } };
}

/* ---------- 問題データとタスク定義 ---------- */
let C = null;
const SEC = { R: 'Reading', L: 'Listening', W: 'Writing', S: 'Speaking' };
const TASKS = {
  ctw:      { sec: 'R', name: 'Complete the Words', items: () => C.reading.ctw, time: 150, min: 3 },
  daily:    { sec: 'R', name: 'Read in Daily Life', items: () => C.reading.daily, time: 110, min: 2 },
  academic: { sec: 'R', name: 'Read an Academic Passage', items: () => C.reading.academic, time: 390, min: 7 },
  lresp:    { sec: 'L', name: 'Listen and Choose a Response', items: () => C.listening.responseSets, qtime: 20, min: 3 },
  lconv:    { sec: 'L', name: 'Listen to a Conversation', items: () => C.listening.conversation, qtime: 30, min: 3 },
  lann:     { sec: 'L', name: 'Listen to an Announcement', items: () => C.listening.announcement, qtime: 30, min: 2 },
  ltalk:    { sec: 'L', name: 'Listen to an Academic Talk', items: () => C.listening.talk, qtime: 30, min: 4 },
  build:    { sec: 'W', name: 'Build a Sentence', items: () => C.writing.buildSets, time: 360, min: 6 },
  email:    { sec: 'W', name: 'Write an Email', items: () => C.writing.email, time: 420, min: 10 },
  disc:     { sec: 'W', name: 'Write for an Academic Discussion', items: () => C.writing.discussion, time: 600, min: 13 },
  repeat:   { sec: 'S', name: 'Listen and Repeat', items: () => C.speaking.repeat, min: 4 },
  interview:{ sec: 'S', name: 'Take an Interview', items: () => C.speaking.interview, min: 6 }
};
const itemTitle = (k, it) => it.title || it.topic || (it.recipient ? `To: ${it.recipient}` : '') || (it.course ? `${it.course}` : it.id);
function findItem(k, id) { const t = TASKS[k]; return t ? t.items().find(x => x.id === id) : null; }

/* ---------- 記録 ---------- */
function record(task, id, c, n, sec, extra = {}) {
  const d = today();
  S.attempts.push({ t: task, id, c: Math.round(c * 100) / 100, n, s: Math.round(sec), d, ts: Date.now(), ...extra });
  if (!S.days.includes(d)) S.days.push(d);
  save();
}
const attemptsOf = (t, id) => S.attempts.filter(a => a.t === t && (id == null || a.id === id));
function streak() {
  const set = new Set(S.days); let d = today(), n = 0;
  if (!set.has(d)) d = addDays(-1);
  while (set.has(d)) { n++; d = addDays(-1, d); }
  return n;
}
function secStats(sec, last = 10) {
  const keys = Object.keys(TASKS).filter(k => TASKS[k].sec === sec);
  const a = S.attempts.filter(x => keys.includes(x.t)).slice(-last);
  const c = a.reduce((s, x) => s + x.c, 0), n = a.reduce((s, x) => s + x.n, 0);
  return { n: a.length, p: pct(c, n) };
}
function addWrong(task, id, qi) { S.wrong[`${task}|${id}|${qi}`] = { d: today() }; }
function clearWrong(task, id, qi) { delete S.wrong[`${task}|${id}|${qi}`]; }

/* ---------- 音声（読み上げ） ---------- */
const TTS = {
  ok: 'speechSynthesis' in window, voices: [], all: [], token: 0,
  load() {
    if (!this.ok) return;
    const all = speechSynthesis.getVoices();
    this.all = all;
    this.voices = all.filter(v => /^en[-_]/i.test(v.lang) || v.lang === 'en');
  },
  ja() { return this.all.find(v => /^ja/i.test(v.lang)) || null; },
  speakJa(text) {
    const v = this.ja(); if (!v) return sleep(900);
    const my = this.token;
    return new Promise(res => {
      if (my !== this.token) return res();
      const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.rate = 1.1;
      let done = false; const fin = () => { if (!done) { done = true; clearTimeout(t); res(); } };
      u.onend = fin; u.onerror = fin; const t = setTimeout(fin, text.length * 250 + 3000);
      speechSynthesis.speak(u);
    });
  },
  pick(slot) {
    const want = slot === 2 ? S.settings.voice2 : S.settings.voice1;
    let v = this.voices.find(x => x.voiceURI === want);
    if (v) return v;
    const us = this.voices.filter(x => /en[-_]US/i.test(x.lang));
    const pool = us.length ? us : this.voices;
    if (slot === 2) return this.voices.find(x => x !== this.pick(1) && /en[-_](GB|AU|IN|CA)/i.test(x.lang)) || pool[1] || pool[0] || null;
    return pool[0] || null;
  },
  async speak(text, { slot = 1, pitch = 1 } = {}) {
    if (!this.ok) throw new Error('no-tts');
    const my = this.token;
    const parts = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/);
    for (const p of parts) {
      if (my !== this.token) return;
      await this.one(p, slot, pitch);
    }
  },
  one(text, slot, pitch) {
    return new Promise(res => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pick(slot);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.rate = S.settings.rate; u.pitch = pitch;
      let done = false; const fin = () => { if (!done) { done = true; clearTimeout(t); res(); } };
      u.onend = fin; u.onerror = fin;
      const t = setTimeout(fin, (words(text) * 0.55 / S.settings.rate + 4) * 1000);
      speechSynthesis.speak(u);
    });
  },
  async lines(lines) {
    const map = {}; let n = 0;
    const single = this.voices.length < 2; const my = this.token;
    for (const l of lines) {
      if (my !== this.token) return;
      if (!(l.sp in map)) map[l.sp] = (n++ % 2) + 1;
      const slot = map[l.sp];
      await this.speak(l.text, { slot, pitch: single ? (slot === 1 ? 1.12 : 0.85) : 1 });
      await sleep(250);
    }
  },
  cancel() { this.token++; if (this.ok) speechSynthesis.cancel(); }
};
if (TTS.ok) { TTS.load(); speechSynthesis.onvoiceschanged = () => TTS.load(); }

/* ---------- 録音・音声認識・効果音 ---------- */
let actx = null;
function beep(f = 880, ms = 160) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = f; g.gain.value = 0.12;
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000);
  } catch (e) {}
  return sleep(ms + 60);
}
const Rec = {
  stream: null, mr: null, timer: 0,
  async ensure() {
    if (this.stream) return true;
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); return true; }
    catch (e) { return false; }
  },
  record(ms) {
    return new Promise(res => {
      if (!this.stream || !window.MediaRecorder) { setTimeout(() => res(null), ms); this.stopNow = () => res(null); return; }
      const chunks = []; let mr;
      try { mr = new MediaRecorder(this.stream); } catch (e) { setTimeout(() => res(null), ms); return; }
      this.mr = mr;
      mr.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
      mr.onstop = () => { clearTimeout(this.timer); res(chunks.length ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null); };
      mr.start();
      this.timer = setTimeout(() => this.stopNow(), ms);
      this.stopNow = () => { try { if (mr.state !== 'inactive') mr.stop(); } catch (e) { res(null); } };
    });
  },
  stopNow() {},
  release() { clearTimeout(this.timer); try { this.mr && this.mr.state !== 'inactive' && this.mr.stop(); } catch (e) {} if (this.stream) this.stream.getTracks().forEach(t => t.stop()); this.stream = null; this.mr = null; }
};
const SRCls = window.SpeechRecognition || window.webkitSpeechRecognition;
const asrOn = () => !!(SRCls && S.settings.asr && navigator.onLine);
const ASR = {
  cur: null, stopped: false,
  listen(ms) {
    return new Promise(res => {
      const deadline = Date.now() + ms; let text = ''; this.stopped = false; let finished = false;
      const fin = () => { if (finished) return; finished = true; clearTimeout(t); res(text.trim()); };
      const startOne = () => {
        let r; try { r = new SRCls(); } catch (e) { fin(); return; }
        r.lang = 'en-US'; r.continuous = true; r.interimResults = false;
        r.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += ' ' + e.results[i][0].transcript; };
        r.onend = () => { if (!this.stopped && Date.now() < deadline - 600) startOne(); else fin(); };
        r.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'network') { this.stopped = true; } };
        this.cur = r;
        try { r.start(); } catch (e) { fin(); }
      };
      const t = setTimeout(() => this.stopNow(), ms);
      this.stopNow = () => { this.stopped = true; try { this.cur && this.cur.stop(); } catch (e) {} setTimeout(fin, 900); };
      startOne();
    });
  },
  stopNow() {},
  abort() { this.stopped = true; try { this.cur && this.cur.abort(); } catch (e) {} }
};
const norm = s => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
function lcsMatch(target, hyp) {
  const a = norm(target), b = norm(hyp);
  const m = a.length, n = b.length, dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array(m).fill(false); let i = 0, j = 0;
  while (i < m && j < n) { if (a[i] === b[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return hit;
}

/* ---------- 共通 UI ---------- */
let cleanups = [];
let session = 0; let lastRoute = 'today';
const onCleanup = f => cleanups.push(f);
function cleanup() { session++; cleanups.splice(0).forEach(f => { try { f(); } catch (e) {} }); TTS.cancel(); ASR.abort(); Rec.release(); }
function toast(msg, action, fn, ms = 4000) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn" id="tbtn">${esc(action)}</button>` : ''}`;
  t.hidden = false;
  if (action) $('#tbtn').onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーした。Claudeに貼り付けて使う。'); return; } catch (e) {}
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('コピーした。'); } catch (e) { toast('コピーできなかった。'); }
  ta.remove();
}
function makeTimer(el, seconds, { onEnd, overtime = false } = {}) {
  const start = Date.now(); let ended = false;
  const tick = () => {
    const left = seconds - (Date.now() - start) / 1000;
    if (left <= 0 && !overtime) { el.textContent = '0:00'; el.className = 'timer over'; if (!ended) { ended = true; clearInterval(iv); onEnd && onEnd(); } return; }
    if (left <= 0 && !ended) { ended = true; onEnd && onEnd(); }
    el.textContent = left <= 0 ? fmt(-left) : fmt(left);
    el.className = 'timer' + (left <= 0 ? ' over' : left <= 30 ? ' low' : '');
  };
  tick(); const iv = setInterval(tick, 250);
  const api = { stop: () => clearInterval(iv), elapsed: () => (Date.now() - start) / 1000 };
  onCleanup(api.stop);
  return api;
}
function ring(el, ms, color) {
  const R = 60, L = 2 * Math.PI * R; const t0 = Date.now();
  el.innerHTML = `<div class="ring" style="--c:${color}"><svg viewBox="0 0 140 140"><circle class="bgc" cx="70" cy="70" r="${R}"/><circle class="fgc" cx="70" cy="70" r="${R}" stroke-dasharray="${L}" stroke-dashoffset="0"/></svg><b>0</b></div>`;
  const fg = $('.fgc', el), b = $('b', el);
  const iv = setInterval(() => {
    const p = clamp((Date.now() - t0) / ms, 0, 1);
    fg.setAttribute('stroke-dashoffset', String(L * p));
    b.textContent = Math.ceil((ms - (Date.now() - t0)) / 1000 > 0 ? (ms - (Date.now() - t0)) / 1000 : 0);
    if (p >= 1) clearInterval(iv);
  }, 100);
  onCleanup(() => clearInterval(iv));
}
function playShell(k, it, sub = '') {
  const t = TASKS[k];
  document.body.classList.add('playing');
  const v = $('#view');
  v.innerHTML = `<div class="playbar"><button class="iconbtn" id="quit" aria-label="中断">✕</button>
    <div class="ttl">${esc(t.name)}<small>${esc(sub || itemTitle(k, it))}</small></div><span class="row" style="flex-wrap:nowrap;gap:4px"><span id="tm"></span><button class="iconbtn qbtn" id="guide" aria-label="解き方ガイド">?</button></span></div><div id="body"></div>`;
  $('#guide').onclick = () => openGuide(k);
  $('#quit').onclick = () => { if (!playShell.done && !confirm('中断して戻りますか？（この回の記録は保存されない）')) return; location.hash = '#' + lastRoute; };
  playShell.done = false;
  return { body: $('#body'), tm: $('#tm') };
}
const finishPlay = () => { playShell.done = true; const t = $('#tm'); if (t) t.innerHTML = ''; };
function noVoiceNotice() {
  if (TTS.ok && TTS.voices.length) return '';
  return `<div class="notice w">英語の読み上げ音声が見つからない。Androidの「設定 → システム → 言語 → 音声出力（テキスト読み上げ）」でGoogleの英語音声データをダウンロードすると、オフラインでも再生できる。音声がない間は「文字で読む」で代用できる。</div>`;
}
function resultHead(c, n, label = '正答') {
  return `<div class="result-head"><div class="muted">${label}</div><div class="score">${Math.round(c * 10) / 10} / ${n}</div><div class="muted">${pct(c, n)}%</div></div>`;
}
function endButtons(k, id) {
  return `<div class="row" style="margin-top:18px"><a class="btn" href="#play/${k}/${id}" id="again">もう一度</a><a class="btn pri" href="#today">Todayへ</a><a class="btn ghost" href="#drill">Drillへ</a></div>`;
}

/* ---------- 画面：Today ---------- */
function pickToday() {
  const d = today(); const dayNo = Math.floor(new Date(d).getTime() / 864e5);
  const lastOf = k => { const a = attemptsOf(k); return a.length ? a[a.length - 1].ts : 0; };
  const pickTask = sec => Object.keys(TASKS).filter(k => TASKS[k].sec === sec).sort((a, b) => lastOf(a) - lastOf(b))[0];
  const pickItem = k => {
    const items = TASKS[k].items();
    const scored = items.map(it => { const a = attemptsOf(k, it.id); const last = a[a.length - 1]; return { it, n: a.length, p: last ? last.c / last.n : -1, ts: last ? last.ts : 0 }; });
    const fresh = scored.find(x => x.n === 0);
    if (fresh) return fresh.it;
    return scored.sort((a, b) => (a.p - b.p) || (a.ts - b.ts))[0].it;
  };
  const secs = ['S', 'W', dayNo % 2 ? 'L' : 'R'];
  return secs.map(sec => { const k = pickTask(sec); return { k, it: pickItem(k) }; });
}
function phaseText() {
  if (!S.settings.examDate) return `<div class="phase">受験予定日を Stats → 設定 で入力すると、残り日数と学習フェーズを表示する。</div>`;
  const days = Math.round((new Date(S.settings.examDate) - new Date(today())) / 864e5);
  const m = days / 30.4;
  const ph = m > 24 ? ['基礎期', 'アカデミック語彙・発音・タイピング速度を固め、R/Lの取りこぼしをなくす。']
    : m > 12 ? ['強化期', 'Speaking・Writingの型を身につけ、各タスクを制限時間内に安定させる。']
      : m > 3 ? ['実戦期', '模試形式で時間配分を固め、弱点タスクを集中して補強する。']
        : ['直前期', '本番と同じ順序（R→L→W→S）で通し練習し、体調と時間感覚を整える。'];
  return `<div class="phase"><b>受験まで ${days} 日・${ph[0]}</b><br>${ph[1]}</div>`;
}
function viewToday(v) {
  const d = today();
  const menu = pickToday();
  const dueV = vocabQueue().length;
  const doneToday = (k, id) => S.attempts.some(a => a.t === k && a.id === id && a.d === d);
  const mins = S.attempts.filter(a => a.d === d).reduce((s, a) => s + a.s, 0) / 60;
  v.innerHTML = `
    <section class="hero">
      <h1>今日のメニュー</h1>
      <p class="muted">${d}・目安 ${menu.reduce((s, m) => s + TASKS[m.k].min, 0) + 3} 分。上から順に進める。</p>
    </section>
    ${menu.map(m => {
      const t = TASKS[m.k];
      return `<a class="card task sec-${t.sec}" href="#play/${m.k}/${m.it.id}">
        <span class="bar"></span>
        <span><span class="badge">${SEC[t.sec]}</span><div class="t">${esc(t.name)}</div><div class="s">${esc(itemTitle(m.k, m.it))}</div></span>
        <span class="r">${doneToday(m.k, m.it.id) ? '<span class="done">✓ 完了</span>' : `約${t.min}分`}</span></a>`;
    }).join('')}
    <a class="card task sec-V" href="#words">
      <span class="bar"></span>
      <span><span class="badge">Vocab</span><div class="t">アカデミック語彙</div><div class="s">間隔反復で復習</div></span>
      <span class="r">${dueV ? `${dueV}枚` : '<span class="done">✓ 完了</span>'}</span></a>
    <div class="kpis">
      <div class="kpi"><b>${streak()}</b><span>連続学習日数</span></div>
      <div class="kpi"><b>${Math.round(mins)}</b><span>今日の分数</span></div>
      <div class="kpi"><b>${Object.keys(S.wrong).length}</b><span>誤答ノート</span></div>
    </div>
    ${phaseText()}
    <div class="card tip"><b>今日のTip</b><p style="margin:6px 0 0">${esc(C.tips.daily[Math.floor(new Date(d).getTime() / 864e5) % C.tips.daily.length])}</p><a class="small" href="#tips">Tipsをもっと見る ›</a></div>
    <h2>直近10回の正答率</h2>
    <div class="card">
      ${['R', 'L', 'W', 'S'].map(s => { const st = secStats(s); return `<div class="meter sec-${s}"><b>${s}</b><div class="track"><div class="fill" style="width:${st.p}%"></div></div><span class="v">${st.n ? st.p + '%' : '—'}</span></div>`; }).join('')}
      <p class="muted small" style="margin:10px 0 0">W・Sは自己チェック項目の達成率。公式スコアの換算ではない。</p>
    </div>`;
}

/* ---------- 画面：Drill ---------- */
const drillOpen = new Set();
function viewDrill(v) {
  const nw = Object.keys(S.wrong).length;
  v.innerHTML = `<h1>Drill</h1><p class="muted">本番と同じ制限時間で解く。画面上部の「？」で解き方ガイドを開ける。</p>
    <a class="card task sec-V" href="#wrong"><span class="bar"></span><span><div class="t">誤答ノート</div><div class="s">間違えた設問を解き直す</div></span><span class="r">${nw ? `${nw}件` : '<span class="done">0件</span>'}</span></a>` +
    ['R', 'L', 'W', 'S'].map(sec => `<h2><span class="badge sec-${sec}">${SEC[sec]}</span></h2>` +
      Object.keys(TASKS).filter(k => TASKS[k].sec === sec).map(k => {
        const t = TASKS[k]; const its = t.items(); const doneN = its.filter(it => attemptsOf(k, it.id).length).length;
        return `<details class="tgroup" data-k="${k}" ${drillOpen.has(k) ? 'open' : ''}><summary><span>${esc(t.name)}</span><span class="muted small">${doneN} / ${its.length} 着手</span></summary>` + its.map(it => {
          const a = attemptsOf(k, it.id); const best = a.length ? Math.max(...a.map(x => pct(x.c, x.n))) : null;
          return `<a class="card task sec-${sec}" href="#play/${k}/${it.id}"><span class="bar"></span>
            <span><div class="t">${esc(itemTitle(k, it))}</div><div class="s">${it.list && it.list[0].g ? esc([...new Set(it.list.map(x => x.g))].slice(0, 4).join('・')) + '…<br>' : ''}${a.length ? `${a.length}回・最高 ${best}%` : '未着手'}</div></span><span class="r">約${t.min}分</span></a>`;
        }).join('') + '</details>';
      }).join('')).join('');
  $$('details.tgroup', v).forEach(d => d.addEventListener('toggle', () => { d.open ? drillOpen.add(d.dataset.k) : drillOpen.delete(d.dataset.k); }));
}

/* ---------- プレイヤー：Complete the Words ---------- */
function playCTW(k, it) {
  const { body, tm } = playShell(k, it);
  const gaps = []; let gi = 0;
  const html = esc(it.text).replace(/\[([A-Za-z]+)\]/g, (_, w) => {
    const vis = w.slice(0, Math.ceil(w.length / 2)), miss = w.slice(vis.length);
    gaps.push({ w, vis, miss });
    return `<span class="gapw">${esc(vis)}<input class="gap" data-i="${gi++}" style="--n:${miss.length}" maxlength="${miss.length}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" aria-label="${miss.length}文字"></span>`;
  });
  body.innerHTML = `<p class="muted">段落を読み、欠けている文字を入力する（各空欄の文字数どおり）。</p>
    <div class="card ctw" id="ctw">${html}</div>
    <button class="btn pri big" id="done" style="margin-top:16px">採点する</button>`;
  const timer = makeTimer(tm, TASKS[k].time, { overtime: true });
  const ins = $$('.gap', body);
  ins.forEach((el, i) => el.addEventListener('input', () => { if (el.value.length >= +el.maxLength && ins[i + 1]) ins[i + 1].focus(); }));
  $('#done', body).onclick = () => {
    timer.stop(); finishPlay();
    let c = 0;
    ins.forEach((el, i) => {
      const g = gaps[i]; const ok = el.value.trim().toLowerCase() === g.miss.toLowerCase();
      if (ok) { c++; clearWrong(k, it.id, i); } else addWrong(k, it.id, i);
      el.classList.add(ok ? 'ok' : 'ng'); el.readOnly = true;
      if (!ok) el.insertAdjacentHTML('afterend', `<span class="fix">(${esc(g.miss)})</span>`);
    });
    record(k, it.id, c, gaps.length, timer.elapsed());
    $('#done', body).remove();
    body.insertAdjacentHTML('afterbegin', resultHead(c, gaps.length));
    body.insertAdjacentHTML('beforeend', `<p class="muted" style="margin-top:12px">所要 ${fmt(timer.elapsed())}（目安 ${fmt(TASKS[k].time)}）。前後の文法（品詞・時制・単複）と文脈の両方から語を特定する。</p>` + endButtons(k, it.id));
  };
}

/* ---------- プレイヤー：選択式（Reading / Listening） ---------- */
function passageHTML(it) {
  if (it.paragraphs) return `<h3>${esc(it.title)}</h3><div class="passage">` + it.paragraphs.map((p, i) => `<p><span class="pn">¶${i + 1}</span>${esc(p).replace(/\[([A-D])\]/g, '<span class="ins">■$1</span>')}</p>`).join('') + '</div>';
  return `<div class="muted small">${esc(it.kind || '')}</div><h3>${esc(it.title)}</h3><div class="passage pre">${esc(it.text)}</div>`;
}
function transcriptHTML(it) {
  if (it.lines) return it.lines.map(l => `<p><b>${l.sp === 'W' ? 'Woman' : 'Man'}:</b> ${esc(l.text)}</p>`).join('');
  return `<p>${esc(it.text)}</p>`;
}
function playMCQ(k, it) {
  const t = TASKS[k]; const isL = t.sec === 'L';
  const { body, tm } = playShell(k, it);
  const qs = it.questions; const ans = new Array(qs.length).fill(null); let qi = 0; let timer = null; let qtimer = null; const t0 = Date.now();
  let textMode = false;
  body.innerHTML = `<div class="stim" id="stim"></div><div id="qbox"></div>`;
  const stim = $('#stim', body), qbox = $('#qbox', body);
  if (!isL) {
    stim.innerHTML = `<div class="card">${passageHTML(it)}</div>`;
    timer = makeTimer(tm, t.time, { overtime: true });
    showQ();
  } else {
    stim.innerHTML = `${noVoiceNotice()}<div class="card stage"><div class="state">${esc(it.title)}</div>
      <p class="muted">音声は1回だけ流れる${S.settings.practice ? '（練習モード：繰り返し可）' : ''}。聞き終えると設問が表示される。</p>
      <button class="btn pri big" id="playA">▶ 再生する</button>
      <button class="btn ghost wide" id="readA" style="margin-top:8px">文字で読む（音声なしの代用）</button></div>`;
    $('#playA', body).onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '再生中…'; $('#readA', body).hidden = true;
      const my = session;
      try { it.lines ? await TTS.lines(it.lines) : await TTS.speak(it.text); } catch (err) { toast('音声を再生できなかった。'); }
      if (my !== session) return;
      if (S.settings.practice) { b.disabled = false; b.textContent = '↻ もう一度聞く'; } else b.closest('.card').innerHTML = `<div class="state">${esc(it.title)}</div><p class="muted" style="margin:0">再生終了。設問に答える。</p>`;
      if (qbox.innerHTML === '') showQ();
    };
    $('#readA', body).onclick = () => { textMode = true; stim.innerHTML = `<div class="card">${transcriptHTML(it)}</div>`; showQ(); };
  }
  function showQ() {
    const q = qs[qi];
    qbox.innerHTML = `<div class="card"><div class="spread"><span class="muted small">設問 ${qi + 1} / ${qs.length}</span>${isL ? '<span id="qt" class="timer"></span>' : ''}</div>
      <div class="q">${nl(q.q)}</div>
      <div class="opts">${q.options.map((o, i) => `<button class="opt ${ans[qi] === i ? 'sel' : ''}" data-i="${i}">${String.fromCharCode(65 + i)}. ${esc(o)}</button>`).join('')}</div>
      <div class="qnav"><button class="btn" id="prev" ${qi === 0 || isL ? 'hidden' : ''}>← 前へ</button>
        <span class="dots">${qs.map((_, i) => `<i class="${ans[i] != null ? 'a' : ''} ${i === qi ? 'c' : ''}"></i>`).join('')}</span>
        <button class="btn pri" id="next">${qi === qs.length - 1 ? '解答を終える' : '次へ →'}</button></div></div>`;
    $$('.opt', qbox).forEach(b => b.onclick = () => { ans[qi] = +b.dataset.i; $$('.opt', qbox).forEach(x => x.classList.toggle('sel', x === b)); });
    $('#prev', qbox).onclick = () => { qi--; showQ(); };
    $('#next', qbox).onclick = next;
    if (isL) { qtimer && qtimer.stop(); qtimer = makeTimer($('#qt', qbox), t.qtime, { onEnd: () => { toast('時間切れ。次の設問へ。', null, null, 1500); next(); } }); }
    if (!isL && innerWidth < 900) qbox.scrollIntoView({ block: 'nearest' });
  }
  function next() { qtimer && qtimer.stop(); if (qi < qs.length - 1) { qi++; showQ(); } else finish(); }
  function finish() {
    timer && timer.stop(); qtimer && qtimer.stop(); TTS.cancel(); finishPlay();
    let c = 0; qs.forEach((q, i) => { if (ans[i] === q.answer) { c++; clearWrong(k, it.id, i); } else addWrong(k, it.id, i); });
    const sec = (Date.now() - t0) / 1000;
    record(k, it.id, c, qs.length, sec, textMode ? { text: 1 } : {});
    tm.innerHTML = '';
    body.innerHTML = resultHead(c, qs.length) + (timer ? `<p class="muted" style="text-align:center">所要 ${fmt(sec)}（目安 ${fmt(t.time)}）</p>` : '') +
      qs.map((q, i) => `<div class="card"><div class="q">${i + 1}. ${nl(q.q)}</div><div class="opts">${q.options.map((o, j) => `<div class="opt ${j === q.answer ? 'ok' : ''} ${ans[i] === j && j !== q.answer ? 'ng' : ''}">${String.fromCharCode(65 + j)}. ${esc(o)}${j === q.answer ? ' ✓' : ''}${ans[i] === j && j !== q.answer ? '（あなたの解答）' : ''}</div>`).join('')}</div>
        <p class="muted" style="margin:10px 0 0">${esc(q.explain)}</p></div>`).join('') +
      `<details ${isL ? '' : 'hidden'}><summary>スクリプトを見る</summary>${isL ? transcriptHTML(it) : ''}<button class="btn sm" id="replay">▶ もう一度聞く</button></details>
       <details><summary>本文を見る</summary>${isL ? '' : passageHTML(it)}</details>` + endButtons(k, it.id);
    const rp = $('#replay', body); if (rp) rp.onclick = () => { TTS.cancel(); it.lines ? TTS.lines(it.lines) : TTS.speak(it.text); };
    if (isL) $$('details', body)[1].remove();
    window.scrollTo(0, 0);
  }
}

/* ---------- プレイヤー：Listen and Choose a Response ---------- */
function playResp(k, set) {
  const t = TASKS[k]; const { body, tm } = playShell(k, set);
  const list = set.list; const ans = new Array(list.length).fill(null); let i = 0; let qt = null; const t0 = Date.now(); let textMode = false; const my = session;
  body.innerHTML = `${noVoiceNotice()}<div class="card stage"><p>短い発言を聞き、最も適切な応答を選ぶ。各問 ${t.qtime} 秒。発言は1回だけ流れる。</p>
    <button class="btn pri big" id="go">開始する</button><button class="btn ghost wide" id="txt" style="margin-top:8px">文字で読む（音声なしの代用）</button></div>`;
  $('#go', body).onclick = () => step();
  $('#txt', body).onclick = () => { textMode = true; step(); };
  async function step() {
    const it = list[i];
    body.innerHTML = `<div class="card"><div class="spread"><span class="muted small">${i + 1} / ${list.length}</span><span class="timer" id="qt">${t.qtime}</span></div>
      <div class="stage" id="st" style="padding:12px 0">${textMode ? `<div class="bubble">${esc(it.prompt)}</div>` : '<div class="state">再生中…</div>'}</div>
      <div class="opts" id="op" hidden>${it.options.map((o, j) => `<button class="opt" data-i="${j}">${String.fromCharCode(65 + j)}. ${esc(o)}</button>`).join('')}</div>
      <div class="qnav"><span></span><button class="btn pri" id="nx" hidden>${i === list.length - 1 ? '解答を終える' : '次へ →'}</button></div></div>`;
    if (!textMode) { try { await TTS.speak(it.prompt); } catch (e) {} if (my !== session) return; $('#st', body).innerHTML = '<div class="state">応答を選ぶ</div>'; }
    $('#op', body).hidden = false; $('#nx', body).hidden = false;
    $$('.opt', body).forEach(b => b.onclick = () => { ans[i] = +b.dataset.i; $$('.opt', body).forEach(x => x.classList.toggle('sel', x === b)); });
    qt = makeTimer($('#qt', body), t.qtime, { onEnd: adv });
    $('#nx', body).onclick = adv;
  }
  function adv() { qt && qt.stop(); if (i < list.length - 1) { i++; step(); } else finish(); }
  function finish() {
    finishPlay(); TTS.cancel(); let c = 0;
    list.forEach((it, j) => { if (ans[j] === it.answer) { c++; clearWrong(k, set.id, j); } else addWrong(k, set.id, j); });
    record(k, set.id, c, list.length, (Date.now() - t0) / 1000);
    body.innerHTML = resultHead(c, list.length) + list.map((it, j) => `<div class="card"><div class="bubble">${esc(it.prompt)} <button class="btn sm ghost" data-say="${j}">▶</button></div>
      <div class="opts">${it.options.map((o, m) => `<div class="opt ${m === it.answer ? 'ok' : ''} ${ans[j] === m && m !== it.answer ? 'ng' : ''}">${esc(o)}${m === it.answer ? ' ✓' : ''}</div>`).join('')}</div>
      <p class="muted" style="margin:10px 0 0">${esc(it.explain)}</p></div>`).join('') + endButtons(k, set.id);
    $$('[data-say]', body).forEach(b => b.onclick = () => { TTS.cancel(); TTS.speak(list[+b.dataset.say].prompt); });
    tm.innerHTML = ''; window.scrollTo(0, 0);
  }
}

/* ---------- プレイヤー：Build a Sentence ---------- */
function playBuild(k, set) {
  const { body, tm } = playShell(k, set);
  const list = set.list; const res = []; let i = 0; const t0 = Date.now(); let over = false;
  const timer = makeTimer(tm, TASKS[k].time, { onEnd: () => { over = true; toast('時間切れ。残りは不正解として採点する。', null, null, 2500); finish(); } });
  step();
  function step() {
    const it = list[i];
    const bank = shuffle(it.chunks.concat(it.extra ? [it.extra] : []).map((c, j) => ({ c, j })));
    const picked = [];
    body.innerHTML = `<p class="muted">語句を並べて、応答文を完成させる。不要な語句が1つ含まれる。（${i + 1} / ${list.length}）</p>
      <div class="bubble">${esc(it.context)}</div><div class="answer" id="ans"></div><div class="bank" id="bank"></div>
      <div class="qnav"><button class="btn" id="clr">やり直す</button><button class="btn pri" id="nx">${i === list.length - 1 ? '解答を終える' : '次へ →'}</button></div>`;
    const draw = () => {
      $('#ans', body).innerHTML = picked.map((p, m) => `<button class="chip" data-m="${m}">${esc(p.c)}</button>`).join('');
      $('#bank', body).innerHTML = bank.map((b, m) => `<button class="chip ${picked.includes(b) ? 'used' : ''}" data-b="${m}">${esc(b.c)}</button>`).join('');
      $$('[data-m]', body).forEach(x => x.onclick = () => { picked.splice(+x.dataset.m, 1); draw(); });
      $$('[data-b]', body).forEach(x => x.onclick = () => { const b = bank[+x.dataset.b]; if (!picked.includes(b)) picked.push(b); draw(); });
    };
    draw();
    $('#clr', body).onclick = () => { picked.length = 0; draw(); };
    $('#nx', body).onclick = () => { res[i] = picked.map(p => p.c); if (i < list.length - 1) { i++; step(); } else finish(); };
    step.cur = () => picked.map(p => p.c);
  }
  function finish() {
    if (playShell.done) return;
    if (res[i] == null && step.cur) res[i] = step.cur();
    timer.stop(); finishPlay();
    let c = 0;
    const rows = list.map((it, j) => {
      const mine = res[j] || []; const ok = mine.join(' ') === it.chunks.join(' ');
      if (ok) { c++; clearWrong(k, set.id, j); } else addWrong(k, set.id, j);
      return `<div class="card"><div class="bubble">${esc(it.context)}</div>
        <div class="${ok ? 'okline' : 'ngline'}"><b>${ok ? '✓' : '✗'}</b> ${esc(mine.join(' ') || '（未解答）')}</div>
        ${ok ? '' : `<div class="okline">正解：${esc(it.chunks.join(' '))}</div>`}
        <p class="muted small" style="margin:6px 0 0">${esc(it.explain)}${it.extra ? `（不要語：${esc(it.extra)}）` : ''}</p></div>`;
    });
    record(k, set.id, c, list.length, (Date.now() - t0) / 1000, over ? { over: 1 } : {});
    body.innerHTML = resultHead(c, list.length) + `<p class="muted" style="text-align:center">所要 ${fmt(timer.elapsed())}（制限 ${fmt(TASKS[k].time)}）</p>` + rows.join('') + endButtons(k, set.id);
    window.scrollTo(0, 0);
  }
}

/* ---------- プレイヤー：Write an Email / Academic Discussion ---------- */
function promptHTML(k, it) {
  if (k === 'email') return `<div class="prompt"><p>${esc(it.scenario)}</p><p><b>Write an email to ${esc(it.recipient)}. In your email, do the following:</b></p><ul>${it.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
  return `<div class="prompt"><p class="muted small">Your professor is teaching a class on ${esc(it.course)}. Write a post responding to the professor's question. In your response, express and support your opinion and make a contribution to the discussion.</p>
    <div class="post"><b>Professor</b>${esc(it.professor)}</div>${it.students.map(s => `<div class="post"><b>${esc(s.name)}</b>${esc(s.text)}</div>`).join('')}</div>`;
}
function feedbackPrompt(k, it, text, secs) {
  const name = TASKS[k].name; const lim = TASKS[k].time / 60;
  const task = k === 'email' ? `状況：${it.scenario}\n宛先：${it.recipient}\n必須事項：\n- ${it.points.join('\n- ')}`
    : `授業：${it.course}\n教授：${it.professor}\n${it.students.map(s => `${s.name}：${s.text}`).join('\n')}`;
  return `あなたはTOEFL iBT（2026年1月以降の新形式）のWritingの採点に詳しい英語講師です。以下の解答を評価してください。

【タスク】${name}（制限${lim}分、所要${Math.round(secs / 6) / 10}分、${words(text)}語）
【問題】
${task}

【私の解答】
${text}

【出力してほしいもの】
1. 0〜5点の推定スコアと、その根拠（内容・構成・語彙・文法・トーン）
2. 文法・語法の誤りの一覧（誤→正、理由を一言）
3. 同じ内容をC1レベルの英語で書き直した例
4. 次回意識すべき点を3つ（日本語で簡潔に）`;
}
function playWrite(k, it) {
  const { body, tm } = playShell(k, it);
  const t0 = Date.now(); let locked = false;
  body.innerHTML = `<div class="card">${promptHTML(k, it)}</div>
    <div class="spread" style="margin:12px 0 6px"><b>解答</b><span class="wc muted" id="wc">0 語</span></div>
    <textarea class="write" id="ta" spellcheck="false" autocorrect="off" autocapitalize="sentences" placeholder="ここに英語で書く"></textarea>
    <button class="btn pri big" id="sub" style="margin-top:12px">提出する</button>`;
  const ta = $('#ta', body), wc = $('#wc', body);
  ta.addEventListener('input', () => { wc.textContent = `${words(ta.value)} 語`; });
  const timer = makeTimer(tm, TASKS[k].time, { onEnd: () => { locked = true; ta.readOnly = true; toast('時間切れ。入力を締め切った。', null, null, 2500); submit(); } });
  $('#sub', body).onclick = () => { if (words(ta.value) < 20 && !confirm('20語未満だが提出しますか？')) return; submit(); };
  function submit() {
    if (playShell.done) return;
    timer.stop(); finishPlay();
    const text = ta.value.trim(); const secs = Math.min(timer.elapsed(), TASKS[k].time); const wn = words(text);
    const entry = { t: k, id: it.id, d: today(), ts: Date.now(), text, w: wn, s: Math.round(secs), self: null };
    S.writings.push(entry); save();
    body.innerHTML = `<div class="result-head"><div class="muted">提出完了</div><div class="score">${wn} 語</div><div class="muted">所要 ${fmt(secs)} / 制限 ${fmt(TASKS[k].time)}${locked ? '（時間切れ）' : ''}</div></div>
      <div class="card"><b>あなたの解答</b><div class="model" style="margin-top:8px">${esc(text) || '（空欄）'}</div></div>
      <h2>自己チェック</h2><div class="card" id="chk">${it.checklist.map((c, i) => `<label class="check"><input type="checkbox" data-i="${i}"><span>${esc(c)}</span></label>`).join('')}</div>
      <button class="btn pri wide" id="rec" style="margin-top:12px">自己チェックを記録する</button>
      <h2>AI添削（オンライン時）</h2>
      <p class="muted">問題・解答・採点観点をまとめた依頼文をコピーし、Claudeに貼り付ける。</p>
      <button class="btn wide" id="cp">添削依頼文をコピー</button>
      <details><summary>模範解答を見る</summary><div class="model">${esc(it.model)}</div><p class="muted small" style="margin-top:8px">${words(it.model)}語。語数は目安であり、必須事項の網羅と論理の明確さが優先である。</p></details>
      <details><summary>C1に近づける言い換え表現</summary><table><tr><th>基本</th><th>言い換え</th></tr>${C.tips.phrases.map(p => `<tr><td>${esc(p.basic)}</td><td>${esc(p.upgrade)}<div class="muted small">${esc(p.use)}</div></td></tr>`).join('')}</table></details>` + endButtons(k, it.id);
    $('#cp', body).onclick = () => copyText(feedbackPrompt(k, it, text, secs));
    $('#rec', body).onclick = e => {
      const c = $$('#chk input:checked', body).length; entry.self = c;
      record(k, it.id, c, it.checklist.length, secs, { w: wn });
      e.currentTarget.disabled = true; e.currentTarget.textContent = `記録した（${c} / ${it.checklist.length}）`;
    };
    window.scrollTo(0, 0);
  }
}

/* ---------- プレイヤー：Listen and Repeat ---------- */
async function micGate(body, color, onGo) {
  const asr = asrOn();
  body.innerHTML = `${noVoiceNotice()}<div class="card stage" style="--c:${color}">
    <p>${asr ? '音声認識モード（オンライン）：話した内容を文字にして自動照合する。録音の再生はできない。' : '録音モード：話した声を録音し、あとで聞き比べて自己チェックする。'}</p>
    <p class="muted small">準備時間はない。ビープ音のあとすぐに話す。初回はマイクの許可を求められる。</p>
    <button class="btn pri big" id="go">開始する</button></div>`;
  $('#go', body).onclick = async () => {
    beep(660, 1);
    if (!asr) { const ok = await Rec.ensure(); if (!ok) toast('マイクを使えないため、録音なしで進める。', null, null, 3500); }
    onGo(asr);
  };
}
function playRepeat(k, it) {
  const { body } = playShell(k, it);
  const color = 'var(--S)';
  const out = []; const t0 = Date.now();
  const my = session;
  micGate(body, color, async asr => {
    for (let i = 0; i < it.sentences.length; i++) {
      if (my !== session) return;
      const s = it.sentences[i];
      body.innerHTML = `<div class="card stage" style="--c:${color}"><div class="state">${i + 1} / ${it.sentences.length}</div><div class="big">聞く</div>${S.settings.practice ? `<p>${esc(s)}</p>` : ''}<div id="rg"></div><button class="btn" id="skip" hidden>話し終えた →</button></div>`;
      try { await TTS.speak(s); } catch (e) {}
      if (my !== session) return;
      await beep();
      const ms = clamp(3000 + words(s) * 600, 6000, 14000);
      $('.big', body).innerHTML = '<span class="rec-dot"></span>復唱する';
      ring($('#rg', body), ms, color);
      const sk = $('#skip', body); sk.hidden = false;
      if (asr) { sk.onclick = () => ASR.stopNow(); const txt = await ASR.listen(ms); out.push({ s, txt, hit: lcsMatch(s, txt) }); }
      else { sk.onclick = () => Rec.stopNow(); const blob = await Rec.record(ms); out.push({ s, blob, hit: norm(s).map(() => true) }); }
      await sleep(400);
    }
    if (my !== session) return;
    Rec.release(); finishPlay();
    review();
  });
  function review() {
    const urls = out.map(o => o.blob ? URL.createObjectURL(o.blob) : null);
    onCleanup(() => urls.forEach(u => u && URL.revokeObjectURL(u)));
    body.innerHTML = `<h2 style="margin-top:4px">自己チェック</h2><p class="muted">${out[0] && out[0].txt != null ? '自動照合の結果を確認し、誤判定があればタップで修正する。' : '自分の録音を聞き、言えなかった・誤った語をタップして赤にする。'}</p>` +
      out.map((o, i) => `<div class="card"><div class="spread"><b>${i + 1}.</b><button class="btn sm ghost" data-say="${i}">▶ 原文</button></div>
        <div class="words" data-row="${i}">${norm(o.s).map((w, j) => `<button class="word ${o.hit[j] ? '' : 'miss'}" data-j="${j}">${esc(w)}</button>`).join('')}</div>
        ${urls[i] ? `<audio controls src="${urls[i]}"></audio>` : ''}${o.txt != null ? `<p class="muted small">認識結果：${esc(o.txt || '（認識できなかった）')}</p>` : ''}</div>`).join('') +
      `<div class="card" style="margin-top:12px"><div class="spread"><b>正確さ</b><span id="sc" class="score" style="font-size:28px"></span></div><p class="muted small" style="margin:4px 0 0">語単位の一致率。完全に一致した文の数も記録する。</p></div>
       <button class="btn pri big" id="rec" style="margin-top:12px">記録する</button>
       <div class="notice" style="margin-top:12px">コツ：意味のかたまり（句）ごとに区切って記憶し、機能語（a / the / of / to）と語尾（-s / -ed）まで再現する。</div>` + endButtons(k, it.id);
    const calc = () => { const r = out.map(o => o.hit.filter(Boolean).length / o.hit.length); const avg = r.reduce((a, b) => a + b, 0) / r.length; $('#sc', body).textContent = Math.round(avg * 100) + '%'; return { sum: r.reduce((a, b) => a + b, 0), perfect: r.filter(x => x === 1).length }; };
    $$('.words', body).forEach(row => row.addEventListener('click', e => { const b = e.target.closest('.word'); if (!b) return; const o = out[+row.dataset.row]; const j = +b.dataset.j; o.hit[j] = !o.hit[j]; b.classList.toggle('miss', !o.hit[j]); calc(); }));
    $$('[data-say]', body).forEach(b => b.onclick = () => { TTS.cancel(); TTS.speak(out[+b.dataset.say].s); });
    calc();
    $('#rec', body).onclick = e => { const r = calc(); record(k, it.id, r.sum, out.length, (Date.now() - t0) / 1000, { perfect: r.perfect }); e.currentTarget.disabled = true; e.currentTarget.textContent = `記録した（完全一致 ${r.perfect} / ${out.length} 文）`; };
    window.scrollTo(0, 0);
  }
}

/* ---------- プレイヤー：Take an Interview ---------- */
const IV_CHECK = [
  '4問すべてで、最初の1文が質問への直接の答えになっていた',
  '各回答に理由または具体例を入れた',
  '45秒の大半を使い、長い沈黙がなかった',
  '同じ語や表現の繰り返しを避けた',
  '時制（特に経験を語る過去形）を正しく使えた',
  '語尾まで明瞭に発音し、速すぎなかった'
];
function playInterview(k, it) {
  const { body } = playShell(k, it);
  const color = 'var(--S)'; const RESP = 45000; const out = []; const t0 = Date.now(); const my = session;
  micGate(body, color, async asr => {
    body.innerHTML = `<div class="card stage" style="--c:${color}"><div class="state">インタビュアー</div><div class="big">導入</div>${S.settings.practice ? `<p>${esc(it.intro)}</p>` : ''}</div>`;
    try { await TTS.speak(it.intro, { slot: 2 }); } catch (e) {}
    for (let i = 0; i < it.questions.length; i++) {
      if (my !== session) return;
      const q = it.questions[i];
      body.innerHTML = `<div class="card stage" style="--c:${color}"><div class="state">質問 ${i + 1} / ${it.questions.length}</div><div class="big">聞く</div>${S.settings.practice ? `<p>${esc(q)}</p>` : ''}<div id="rg"></div><button class="btn" id="skip" hidden>話し終えた →</button></div>`;
      try { await TTS.speak(q, { slot: 2 }); } catch (e) {}
      if (my !== session) return;
      await beep();
      $('.big', body).innerHTML = '<span class="rec-dot"></span>回答する（45秒）';
      ring($('#rg', body), RESP, color);
      const sk = $('#skip', body); sk.hidden = false; const ts = Date.now();
      if (asr) { sk.onclick = () => ASR.stopNow(); const txt = await ASR.listen(RESP); out.push({ q, txt, sec: (Date.now() - ts) / 1000 }); }
      else { sk.onclick = () => Rec.stopNow(); const blob = await Rec.record(RESP); out.push({ q, blob, sec: (Date.now() - ts) / 1000 }); }
      await sleep(500);
    }
    if (my !== session) return;
    Rec.release(); finishPlay(); review();
  });
  function review() {
    const urls = out.map(o => o.blob ? URL.createObjectURL(o.blob) : null);
    onCleanup(() => urls.forEach(u => u && URL.revokeObjectURL(u)));
    body.innerHTML = `<h2 style="margin-top:4px">振り返り</h2>` + out.map((o, i) => {
      const wn = o.txt ? words(o.txt) : 0;
      return `<div class="card"><b>Q${i + 1}.</b> ${esc(o.q)}${urls[i] ? `<audio controls src="${urls[i]}"></audio>` : ''}
        ${o.txt != null ? `<p class="small" style="margin:8px 0 0">${esc(o.txt || '（認識できなかった）')}</p><p class="muted small" style="margin:4px 0 0">${wn}語・約${Math.round(wn / Math.max(o.sec, 1) * 60)}語/分（目安 120〜150語/分）</p>` : `<p class="muted small" style="margin:4px 0 0">回答時間 ${Math.round(o.sec)} 秒</p>`}</div>`;
    }).join('') +
      `<h2>自己チェック</h2><div class="card" id="chk">${IV_CHECK.map((c, i) => `<label class="check"><input type="checkbox" data-i="${i}"><span>${esc(c)}</span></label>`).join('')}</div>
      <button class="btn pri wide" id="rec" style="margin-top:12px">自己チェックを記録する</button>
      <details open><summary>回答の型とコツ</summary><ul>${it.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
      <details><summary>AI添削（オンライン時）</summary><p class="muted">${out.some(o => o.txt) ? '認識した文字起こしを含む依頼文をコピーする。' : '録音モードでは文字起こしがないため、自分で回答を書き起こしてから貼り付ける。'}</p><button class="btn wide" id="cp">添削依頼文をコピー</button></details>` + endButtons(k, it.id);
    $('#cp', body).onclick = () => copyText(`あなたはTOEFL iBT（2026年1月以降の新形式）のSpeaking「Take an Interview」の採点に詳しい英語講師です。各質問に45秒で答えた私の回答（音声認識による文字起こし）を評価してください。\n\n【テーマ】${it.topic}\n\n${out.map((o, i) => `Q${i + 1}: ${o.q}\nA${i + 1}: ${o.txt || '（ここに自分の回答を書き起こす）'}`).join('\n\n')}\n\n【出力してほしいもの】\n1. 0〜5点の推定スコアと根拠（応答の適切さ・展開・流暢さの推定・語彙・文法）\n2. 誤りの訂正一覧\n3. 各質問へのC1レベルの模範回答（45秒で話せる長さ）\n4. 次回意識すべき点を3つ（日本語で簡潔に）`);
    $('#rec', body).onclick = e => { const c = $$('#chk input:checked', body).length; record(k, it.id, c, IV_CHECK.length, (Date.now() - t0) / 1000); e.currentTarget.disabled = true; e.currentTarget.textContent = `記録した（${c} / ${IV_CHECK.length}）`; };
    window.scrollTo(0, 0);
  }
}

/* ---------- 単語帳 ---------- */
const INTERVALS = [0, 1, 2, 4, 8, 16, 32, 64];
const MASTER = 4;
const catLabel = id => (C.vcats.find(c => c.id === id) || {}).label || id;
const vStatus = w => { const s = S.srs[w]; return !s ? 'new' : s.b >= MASTER ? 'master' : 'learning'; };
function vocabQueue() {
  const d = today();
  const due = C.vocab.filter(v => S.srs[v.w] && S.srs[v.w].due <= d);
  const introduced = S.vintro.d === d ? S.vintro.n : 0;
  const pool = C.vocab.filter(v => !S.srs[v.w] && (S.settings.vcat === 'all' || v.c === S.settings.vcat));
  return due.concat(pool.slice(0, Math.max(0, S.settings.newPerDay - introduced)));
}
function gradeCard(w, g) {
  const d = today(); const st = S.srs[w] || { b: 0, due: d };
  if (!S.srs[w]) { if (S.vintro.d !== d) S.vintro = { d, n: 0 }; S.vintro.n++; }
  if (g === 0) { st.b = 0; st.due = d; }
  else if (g === 1) { st.b = Math.max(1, st.b); st.due = addDays(INTERVALS[st.b]); }
  else { st.b = Math.min(st.b + 1, INTERVALS.length - 1); st.due = addDays(INTERVALS[st.b]); }
  st.last = d; S.srs[w] = st; if (!S.days.includes(d)) S.days.push(d); save();
}
function rangeList(range) {
  if (range === 'learning') return C.vocab.filter(v => vStatus(v.w) === 'learning');
  if (range === 'star') return C.vocab.filter(v => S.vstar[v.w]);
  if (range === 'studied') return C.vocab.filter(v => S.srs[v.w]);
  if (range && range !== 'all') return C.vocab.filter(v => v.c === range);
  return C.vocab.slice();
}
const rangeOptions = sel => [['all', 'すべて'], ['studied', '学習済みの語'], ['learning', '学習中の語'], ['star', '苦手★の語']].concat(C.vcats.map(c => [c.id, c.label]))
  .map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const starBtn = w => `<button class="iconbtn star ${S.vstar[w] ? 'on' : ''}" data-star="${esc(w)}" aria-label="苦手に登録">${S.vstar[w] ? '★' : '☆'}</button>`;
function bindStars(root) {
  $$('[data-star]', root).forEach(b => b.onclick = e => {
    e.stopPropagation(); const w = b.dataset.star;
    if (S.vstar[w]) delete S.vstar[w]; else S.vstar[w] = 1; save();
    b.classList.toggle('on', !!S.vstar[w]); b.textContent = S.vstar[w] ? '★' : '☆';
  });
}
const say = t => { TTS.cancel(); TTS.speak(t).catch(() => {}); };

let wordsTab = 'card';
function viewWords(v) {
  const learned = Object.keys(S.srs).length, master = C.vocab.filter(x => vStatus(x.w) === 'master').length;
  v.innerHTML = `<h1>単語帳</h1>
    <p class="muted">${C.vocab.length}語・学習済み ${learned}・習得 ${master}・苦手★ ${Object.keys(S.vstar).length}</p>
    <div class="seg seg4"><button data-t="card">カード</button><button data-t="listen">聞き流し</button><button data-t="dict">書き取り</button><button data-t="list">一覧</button></div><div id="wv"></div>`;
  $$('.seg button', v).forEach(b => { b.classList.toggle('on', b.dataset.t === wordsTab); b.onclick = () => { cleanup(); wordsTab = b.dataset.t; viewWords(v); }; });
  const box = $('#wv', v);
  ({ card: wordCards, listen: wordListen, dict: wordDict, list: wordList })[wordsTab](box);
}

function wordCards(box) {
  const dirs = [['en', '英→日'], ['ja', '日→英'], ['audio', '音声→意味']];
  const q = vocabQueue(); const total = q.length; const requeued = new Set();
  const head = `<div class="row" style="margin-bottom:10px">
      <select id="vdir" class="sel" aria-label="出題方向">${dirs.map(([k, l]) => `<option value="${k}" ${S.settings.vdir === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="vcat" class="sel" aria-label="新出語の分野"><option value="all">新出：すべての分野</option>${C.vcats.map(c => `<option value="${c.id}" ${S.settings.vcat === c.id ? 'selected' : ''}>新出：${esc(c.label)}</option>`).join('')}</select></div>`;
  const show = () => {
    if (!q.length) {
      box.innerHTML = head + `<div class="card flash"><div class="w">✓</div><p>今日のカードは完了した。</p><p class="muted">新出語は1日 ${S.settings.newPerDay} 語ずつ追加される（Statsで変更可）。聞き流しや書き取りで復習を続けられる。</p></div>`;
      bindHead(); return;
    }
    const v = q[0]; const isNew = !S.srs[v.w]; const dir = S.settings.vdir;
    const front = dir === 'ja' ? `<div class="ja big">${esc(v.ja)}</div><div class="pos">${esc(v.pos)}・${esc(catLabel(v.c))}</div>`
      : dir === 'audio' ? `<button class="btn pri" id="sayw" style="margin:0 auto">▶ もう一度聞く</button><p class="muted" style="margin-top:10px">音声を聞いて意味を思い出す</p>`
        : `<div class="w">${esc(v.w)}</div><div class="pos">${esc(v.pos)}・${esc(catLabel(v.c))}</div>`;
    box.innerHTML = head + `<div class="spread muted small"><span>残り ${q.length} / ${total}</span><span>${isNew ? '新出' : `段階 ${S.srs[v.w].b}`}</span></div>
      <div class="card flash" id="fc"><div class="fr">${front}</div>
        <div id="back" hidden>${dir !== 'en' ? `<div class="w">${esc(v.w)}</div><div class="pos">${esc(v.pos)}</div>` : ''}${dir !== 'ja' ? `<div class="ja">${esc(v.ja)}</div>` : ''}<div class="en">${esc(v.en)}</div><div class="ex">${esc(v.ex)}</div></div></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="say">▶ 単語</button><button class="btn" id="sayex" hidden>▶ 例文</button>${starBtn(v.w)}</div>
      <button class="btn pri big" id="flip" style="margin-top:10px">答えを見る</button>
      <div class="grade" id="gr" hidden><button class="btn g0" data-g="0">わからない</button><button class="btn" data-g="1">あいまい</button><button class="btn g2" data-g="2">わかった</button></div>`;
    bindHead(); bindStars(box);
    if (dir === 'ja') $('#say', box).hidden = true;
    $('#say', box).onclick = () => say(v.w);
    const sw = $('#sayw', box); if (sw) sw.onclick = e => { e.stopPropagation(); say(v.w); };
    $('#sayex', box).onclick = () => say(v.ex);
    if (dir !== 'ja') say(v.w);
    const flip = () => {
      if (!$('#back', box).hidden) return;
      $('#back', box).hidden = false; $('#flip', box).hidden = true; $('#gr', box).hidden = false; $('#sayex', box).hidden = false; $('#say', box).hidden = false;
      if (dir === 'ja') say(v.w);
    };
    $('#flip', box).onclick = flip; $('#fc', box).onclick = flip;
    $$('#gr button', box).forEach(b => b.onclick = () => {
      const g = +b.dataset.g; gradeCard(v.w, g); q.shift();
      if (g === 0 && !requeued.has(v.w)) { requeued.add(v.w); q.push(v); }
      show();
    });
  };
  function bindHead() {
    $('#vdir', box).onchange = e => { S.settings.vdir = e.target.value; save(); wordCards(box); };
    $('#vcat', box).onchange = e => { S.settings.vcat = e.target.value; save(); wordCards(box); };
  }
  show();
}

function wordListen(box) {
  const st = S.settings;
  let list = [], idx = 0, running = false, token = 0, lock = null;
  const build = () => { list = rangeList(st.lsRange); if (st.lsOrder === 'random') list = shuffle(list); idx = 0; };
  build();
  box.innerHTML = `<div class="card">
      <div class="row"><select id="lr" class="sel" aria-label="範囲">${rangeOptions(st.lsRange)}</select>
      <select id="lo" class="sel" aria-label="順序"><option value="seq" ${st.lsOrder === 'seq' ? 'selected' : ''}>順番どおり</option><option value="random" ${st.lsOrder === 'random' ? 'selected' : ''}>ランダム</option></select></div>
      <label class="check" style="border:0"><input type="checkbox" id="lj" ${st.jaVoice ? 'checked' : ''}><span>日本語訳も読み上げる${TTS.ja() ? '' : '（日本語音声が見つからないため表示のみ）'}</span></label>
      <label class="check" style="border:0;padding-top:0"><input type="checkbox" id="le" ${st.listenEx ? 'checked' : ''}><span>例文も読み上げる</span></label>
      <div class="field" style="border:0;padding:0"><label for="lg">間の長さ <span id="lgv">${st.gap.toFixed(1)}</span>秒</label><input type="range" id="lg" min="0.5" max="3" step="0.1" value="${st.gap}"></div></div>
    <div class="card flash listen-card" id="lc"></div>
    <div class="player"><button class="iconbtn big" id="pv" aria-label="前へ">⏮</button><button class="btn pri" id="pp" style="min-width:120px">▶ 開始</button><button class="iconbtn big" id="nx" aria-label="次へ">⏭</button></div>
    <p class="muted small" style="text-align:center">画面を点けたまま使う。画面を消すと再生が止まる場合がある。</p>`;
  const lc = $('#lc', box), pp = $('#pp', box);
  const draw = (phase = '') => {
    if (!list.length) { lc.innerHTML = '<p>この範囲に該当する単語がない。</p>'; return; }
    const v = list[Math.min(idx, list.length - 1)];
    lc.innerHTML = `<div class="muted small">${Math.min(idx + 1, list.length)} / ${list.length}・${esc(catLabel(v.c))}</div>
      <div class="w">${esc(v.w)}</div><div class="pos">${esc(v.pos)}</div>
      <div class="ja" ${phase === 'w' ? 'style="visibility:hidden"' : ''}>${esc(v.ja)}</div>
      <div class="ex" ${phase === 'w' || phase === 'ja' ? 'style="visibility:hidden"' : ''}>${esc(v.ex)}</div>${starBtn(v.w)}`;
    bindStars(lc);
  };
  draw('w');
  const wake = async on => {
    try { if (on && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen'); else if (!on && lock) { await lock.release(); lock = null; } } catch (e) {}
  };
  async function run() {
    const my = ++token; running = true; pp.textContent = '⏸ 一時停止'; wake(true);
    const gap = () => sleep(st.gap * 1000);
    while (my === token && idx < list.length) {
      const v = list[idx];
      draw('w'); await TTS.speak(v.w).catch(() => {}); if (my !== token) return; await gap(); if (my !== token) return;
      draw('ja'); if (st.jaVoice) { await TTS.speakJa(v.ja); if (my !== token) return; } else await sleep(st.gap * 700);
      await gap(); if (my !== token) return;
      draw('ex');
      if (st.listenEx) { await TTS.speak(v.ex).catch(() => {}); if (my !== token) return; await gap(); }
      else await gap();
      if (my !== token) return;
      idx++;
    }
    if (my === token) { running = false; pp.textContent = '↻ 最初から'; idx = 0; wake(false); toast('最後まで再生した。'); }
  }
  const stop = () => { token++; running = false; TTS.cancel(); pp.textContent = '▶ 再開'; wake(false); };
  pp.onclick = () => running ? stop() : run();
  $('#nx', box).onclick = () => { const r = running; stop(); idx = Math.min(idx + 1, list.length - 1); draw(''); if (r) run(); };
  $('#pv', box).onclick = () => { const r = running; stop(); idx = Math.max(idx - 1, 0); draw(''); if (r) run(); };
  $('#lr', box).onchange = e => { stop(); st.lsRange = e.target.value; save(); build(); draw('w'); pp.textContent = '▶ 開始'; };
  $('#lo', box).onchange = e => { stop(); st.lsOrder = e.target.value; save(); build(); draw('w'); pp.textContent = '▶ 開始'; };
  $('#lj', box).onchange = e => { st.jaVoice = e.target.checked; save(); };
  $('#le', box).onchange = e => { st.listenEx = e.target.checked; save(); };
  $('#lg', box).oninput = e => { st.gap = +e.target.value; $('#lgv', box).textContent = st.gap.toFixed(1); save(); };
  onCleanup(() => { token++; wake(false); });
}

function wordDict(box) {
  const st = S.settings;
  box.innerHTML = `<div class="card"><p>音声を聞いて単語のつづりを入力する。Complete the Wordsのつづり対策を兼ねる。1回10語。</p>
    <div class="row"><select id="dr" class="sel" aria-label="範囲">${rangeOptions(st.dRange)}</select><button class="btn pri" id="go">開始する</button></div>
    ${S.dictLog.length ? `<p class="muted small" style="margin:10px 0 0">直近の結果：${S.dictLog.slice(-5).map(x => `${x.c}/${x.n}`).join('・')}</p>` : ''}</div>`;
  $('#dr', box).onchange = e => { st.dRange = e.target.value; save(); };
  $('#go', box).onclick = () => {
    const pool = rangeList(st.dRange);
    if (!pool.length) { toast('この範囲に該当する単語がない。'); return; }
    const items = shuffle(pool).slice(0, 10); const res = []; let i = 0;
    const step = () => {
      const v = items[i];
      const masked = v.ex.replace(new RegExp(v.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'i'), '_____');
      box.innerHTML = `<div class="spread muted small"><span>${i + 1} / ${items.length}</span><span>${esc(catLabel(v.c))}</span></div>
        <div class="card stage"><div class="row" style="justify-content:center"><button class="btn pri" id="sw">▶ 単語</button><button class="btn" id="se">▶ 例文</button><button class="btn ghost" id="hint">ヒント</button></div>
        <p class="muted" id="hn" hidden style="margin-top:10px">${esc(v.ja)}（${esc(v.pos)}）<br>${esc(masked)}</p>
        <input id="ans" class="dict-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="聞こえた単語を入力" aria-label="つづり">
        <div id="fb" style="min-height:48px;margin-top:10px"></div>
        <button class="btn pri big" id="ok">判定する</button></div>`;
      const inp = $('#ans', box);
      $('#sw', box).onclick = () => say(v.w); $('#se', box).onclick = () => say(v.ex);
      $('#hint', box).onclick = () => { $('#hn', box).hidden = false; };
      say(v.w); inp.focus();
      let judged = false;
      const judge = () => {
        if (judged) { i++; if (i < items.length) step(); else done(); return; }
        judged = true;
        const a = inp.value.trim().toLowerCase(); const ok = a === v.w.toLowerCase();
        res.push({ v, a, ok }); if (!ok) { S.vstar[v.w] = 1; save(); }
        inp.readOnly = true; inp.classList.add(ok ? 'ok' : 'ng');
        $('#fb', box).innerHTML = ok ? `<b class="okline">✓ 正解</b> ${esc(v.ja)}` : `<b class="ngline">✗</b> 正解：<b>${esc(v.w)}</b>・${esc(v.ja)}<div class="muted small">苦手★に登録した。</div>`;
        $('#ok', box).textContent = i < items.length - 1 ? '次へ →' : '結果を見る';
      };
      $('#ok', box).onclick = judge;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') judge(); });
    };
    const done = () => {
      const c = res.filter(r => r.ok).length;
      S.dictLog.push({ d: today(), c, n: res.length }); if (!S.days.includes(today())) S.days.push(today()); save();
      box.innerHTML = resultHead(c, res.length) + res.map(r => `<div class="card"><div class="spread"><span><b class="${r.ok ? 'okline' : 'ngline'}">${r.ok ? '✓' : '✗'}</b> <b>${esc(r.v.w)}</b> ${esc(r.v.ja)}</span><button class="btn sm ghost" data-say="${esc(r.v.w)}">▶</button></div>${r.ok ? '' : `<div class="muted small">あなたの解答：${esc(r.a || '（空欄）')}</div>`}</div>`).join('') +
        `<button class="btn pri big" id="again2" style="margin-top:12px">もう1回</button>`;
      $$('[data-say]', box).forEach(b => b.onclick = () => say(b.dataset.say));
      $('#again2', box).onclick = () => wordDict(box);
    };
    step();
  };
}

function wordList(box) {
  const f = { q: '', c: 'all', s: 'all' };
  box.innerHTML = `<div class="row" style="margin-bottom:8px"><input id="wq" class="search" type="search" placeholder="英語・日本語で検索" aria-label="検索"></div>
    <div class="row" style="margin-bottom:10px"><select id="wc" class="sel" aria-label="分野"><option value="all">すべての分野</option>${C.vcats.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select>
    <select id="ws" class="sel" aria-label="状態"><option value="all">すべての状態</option><option value="new">未学習</option><option value="learning">学習中</option><option value="master">習得</option><option value="star">苦手★</option></select></div>
    <p class="muted small" id="wn"></p><div id="wl" class="card" style="padding:0 14px"></div>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const rows = C.vocab.filter(v => (f.c === 'all' || v.c === f.c) && (f.s === 'all' || (f.s === 'star' ? S.vstar[v.w] : vStatus(v.w) === f.s)) && (!q || v.w.toLowerCase().includes(q) || v.ja.includes(f.q)));
    $('#wn', box).textContent = `${rows.length}語`;
    $('#wl', box).innerHTML = rows.map(v => `<div class="wrow" data-w="${esc(v.w)}"><div class="wmain"><span><b>${esc(v.w)}</b> <span class="muted small">${esc(v.pos)}</span><span class="st st-${vStatus(v.w)}"></span><br><span class="small">${esc(v.ja)}</span></span>
      <span class="row" style="flex-wrap:nowrap;gap:0"><button class="iconbtn" data-say="${esc(v.w)}" aria-label="発音">▶</button>${starBtn(v.w)}</span></div>
      <div class="wdet" hidden><div class="muted small">${esc(v.en)}</div><div class="small" style="margin-top:4px"><i>${esc(v.ex)}</i> <button class="btn sm ghost" data-say="${esc(v.ex)}">▶ 例文</button></div></div></div>`).join('') || '<p class="muted" style="padding:12px 0">該当する単語がない。</p>';
    $$('[data-say]', box).forEach(b => b.onclick = e => { e.stopPropagation(); say(b.dataset.say); });
    bindStars(box);
    $$('.wrow', box).forEach(r => r.onclick = () => { const d = $('.wdet', r); d.hidden = !d.hidden; });
  };
  $('#wq', box).oninput = e => { f.q = e.target.value.trim(); draw(); };
  $('#wc', box).onchange = e => { f.c = e.target.value; draw(); };
  $('#ws', box).onchange = e => { f.s = e.target.value; draw(); };
  draw();
}

/* ---------- 誤答ノート ---------- */
function viewWrong(v) {
  v.innerHTML = `<div class="row" style="margin-bottom:6px"><a class="btn sm ghost" href="#drill">← Drill</a></div><h1>誤答ノート</h1><div id="rv"></div>`;
  wrongList($('#rv', v));
}
function wrongList(box) {
  const keys = Object.keys(S.wrong).sort((a, b) => (S.wrong[b].d > S.wrong[a].d ? 1 : -1));
  if (!keys.length) { box.innerHTML = `<div class="card"><p>誤答はない。間違えた設問はここに集まり、解き直して正解すると消える。</p></div>`; return; }
  box.innerHTML = `<p class="muted">${keys.length}件。解き直して正解すると自動で消える。</p>` + keys.map(key => {
    const [k, id, qi] = key.split('|'); const t = TASKS[k]; const it = t && findItem(k, id); if (!it) return '';
    let q = '', a = '', ex = '';
    if (k === 'ctw') { const w = [...it.text.matchAll(/\[([A-Za-z]+)\]/g)][+qi]; q = `空欄 ${+qi + 1}`; a = w ? w[1] : ''; }
    else if (k === 'build') { const b = it.list[+qi]; if (!b) return ''; q = b.context; a = b.chunks.join(' '); ex = b.explain; }
    else if (k === 'lresp') { const b = it.list[+qi]; if (!b) return ''; q = b.prompt; a = b.options[b.answer]; ex = b.explain; }
    else if (it.questions) { const b = it.questions[+qi]; if (!b) return ''; q = b.q; a = b.options[b.answer]; ex = b.explain; }
    return `<div class="card"><div class="row"><span class="badge sec-${t.sec}">${t.sec}</span><span class="muted small">${esc(t.name)}・${esc(itemTitle(k, it))}</span></div>
      <div class="q" style="margin-top:6px">${nl(q)}</div><div class="okline small">正解：${esc(a)}</div>${ex ? `<p class="muted small" style="margin:4px 0 0">${esc(ex)}</p>` : ''}
      <div class="row" style="margin-top:8px"><a class="btn sm" href="#play/${k}/${id}">解き直す</a><button class="btn sm ghost" data-del="${esc(key)}">削除</button></div></div>`;
  }).join('');
  $$('[data-del]', box).forEach(b => b.onclick = () => { delete S.wrong[b.dataset.del]; save(); wrongList(box); });
}

/* ---------- Tips ---------- */
const sayable = s => s.split('/')[0].replace(/\.\.\./g, '').trim();
function guideHTML(k) {
  const g = C.tips.tasks[k]; const t = TASKS[k];
  if (!g) return '';
  const ul = (h, arr, tag = 'ul') => arr && arr.length ? `<h3 style="margin-top:16px">${h}</h3><${tag} class="glist">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</${tag}>` : '';
  return `<div class="row"><span class="badge sec-${t.sec}">${SEC[t.sec]}</span></div><h2 style="margin-top:6px">${esc(t.name)}</h2>
    <p>${esc(g.summary)}</p>${ul('形式', g.facts)}${ul('解く手順（推奨）', g.steps, 'ol')}${ul('よくある失敗', g.pitfalls)}${ul('練習法（推奨）', g.practice)}`;
}
function viewTips(v, sub, id) {
  if (sub === 't' && TASKS[id]) {
    const first = TASKS[id].items()[0];
    v.innerHTML = `<div class="row" style="margin-bottom:6px"><a class="btn sm ghost" href="#tips">← Tips</a></div><div class="card guide">${guideHTML(id)}</div>
      <a class="btn pri big" href="#play/${id}/${first.id}" style="margin-top:14px">このタスクを練習する</a>`;
    return;
  }
  if (sub === 's') {
    const s = C.tips.strategy.find(x => x.id === id);
    if (s) {
      v.innerHTML = `<div class="row" style="margin-bottom:6px"><a class="btn sm ghost" href="#tips">← Tips</a></div><h1>${esc(s.title)}</h1><p>${esc(s.lead)}</p>` +
        s.sections.map(sec => `<div class="card guide"><h3>${esc(sec.h)}</h3><ul class="glist">${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('') +
        `<p class="muted small" style="margin-top:14px">${esc(C.tips.note)}</p>`;
      return;
    }
  }
  if (sub === 'phrases') {
    const cats = [...new Set(C.tips.phrases.map(p => p.cat))];
    v.innerHTML = `<div class="row" style="margin-bottom:6px"><a class="btn sm ghost" href="#tips">← Tips</a></div><h1>表現集</h1><p class="muted">Writing・Speakingで、B2の表現をC1に近づける言い換え。▶で発音を確認できる。</p>` +
      cats.map(c => `<h2>${esc(c)}</h2><div class="card" style="padding:0 14px">${C.tips.phrases.filter(p => p.cat === c).map(p => `<div class="wrow"><div class="wmain"><span><span class="muted small">${esc(p.basic)} →</span><br><b>${esc(p.upgrade)}</b><br><span class="muted small">${esc(p.use)}</span></span><button class="iconbtn" data-say="${esc(sayable(p.upgrade))}" aria-label="発音">▶</button></div></div>`).join('')}</div>`).join('');
    $$('[data-say]', v).forEach(b => b.onclick = () => say(b.dataset.say));
    return;
  }
  v.innerHTML = `<h1>Tips</h1><p class="muted">解き方・戦略・表現をまとめた。練習中も画面上部の「？」から該当タスクのガイドを開ける。</p>
    <h2>戦略ガイド</h2>${C.tips.strategy.map(s => `<a class="card task sec-V" href="#tips/s/${s.id}"><span class="bar"></span><span><div class="t">${esc(s.title)}</div><div class="s">${esc(s.lead)}</div></span><span class="r">›</span></a>`).join('')}
    <h2>表現集</h2><a class="card task sec-W" href="#tips/phrases"><span class="bar"></span><span><div class="t">C1に近づける言い換え表現</div><div class="s">${C.tips.phrases.length}個・メール・意見・スピーキング</div></span><span class="r">›</span></a>
    <h2>タスク別ガイド</h2>` + ['R', 'L', 'W', 'S'].map(sec => `<h3 style="margin:14px 0 6px"><span class="badge sec-${sec}">${SEC[sec]}</span></h3>` +
      Object.keys(TASKS).filter(k => TASKS[k].sec === sec).map(k => `<a class="card task sec-${sec}" href="#tips/t/${k}"><span class="bar"></span><span><div class="t">${esc(TASKS[k].name)}</div><div class="s">${esc(C.tips.tasks[k] ? C.tips.tasks[k].summary : '')}</div></span><span class="r">›</span></a>`).join('')).join('') +
    `<p class="muted small" style="margin-top:16px">${esc(C.tips.note)}</p>`;
}
function openGuide(k) {
  const sh = document.createElement('div'); sh.className = 'sheet';
  sh.innerHTML = `<div class="sheet-in" role="dialog" aria-modal="true" aria-label="解き方ガイド"><div class="spread"><b>解き方ガイド</b><button class="iconbtn" id="shx" aria-label="閉じる">✕</button></div>${guideHTML(k)}<p class="muted small">タイマーは止まらない。</p></div>`;
  document.body.appendChild(sh);
  const close = () => sh.remove();
  $('#shx', sh).onclick = close; sh.onclick = e => { if (e.target === sh) close(); };
  onCleanup(close);
}

/* ---------- 画面：Stats（記録・設定・バックアップ） ---------- */
function viewStats(v) {
  const totalMin = Math.round(S.attempts.reduce((s, a) => s + a.s, 0) / 60);
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(i - 6));
  const perDay = last7.map(d => S.attempts.filter(a => a.d === d).reduce((s, a) => s + a.s, 0) / 60);
  const mx = Math.max(10, ...perDay);
  const voices = TTS.voices;
  const vopt = sel => `<option value="">自動</option>` + voices.map(x => `<option value="${esc(x.voiceURI)}" ${x.voiceURI === sel ? 'selected' : ''}>${esc(x.name)}（${esc(x.lang)}）${x.localService ? '' : '・要通信'}</option>`).join('');
  v.innerHTML = `<h1>Stats</h1>
    <div class="kpis"><div class="kpi"><b>${S.days.length}</b><span>学習日数</span></div><div class="kpi"><b>${streak()}</b><span>連続日数</span></div><div class="kpi"><b>${totalMin}</b><span>累計分数</span></div></div>
    <div class="card"><b>直近7日の学習時間（分）</b><div class="bars7">${perDay.map(m => `<div style="height:${Math.max(2, m / mx * 100)}%" title="${Math.round(m)}分"></div>`).join('')}</div>
      <div class="bars7l">${last7.map((d, i) => `<span>${i === 6 ? '今日' : d.slice(5).replace('-', '/')}</span>`).join('')}</div></div>
    <h2>タスク別</h2><div class="card"><table class="stack"><thead><tr><th>タスク</th><th class="n">回数</th><th class="n">平均</th><th class="n">最終</th></tr></thead><tbody>
      ${Object.keys(TASKS).map(k => { const a = attemptsOf(k); const c = a.reduce((s, x) => s + x.c, 0), n = a.reduce((s, x) => s + x.n, 0); return `<tr><td><span class="badge sec-${TASKS[k].sec}">${TASKS[k].sec}</span> ${esc(TASKS[k].name)}</td><td class="n">${a.length}</td><td class="n">${a.length ? pct(c, n) + '%' : '—'}</td><td class="n">${a.length ? a[a.length - 1].d.slice(5) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <h2>単語帳</h2>
    <div class="card">${(() => { const n = C.vocab.length; const st = { new: 0, learning: 0, master: 0 }; C.vocab.forEach(x => st[vStatus(x.w)]++);
      return `<div class="meter sec-V"><b>習得</b><div class="track"><div class="fill" style="width:${pct(st.master, n)}%"></div></div><span class="v">${st.master}</span></div>
        <div class="meter sec-V"><b>学習</b><div class="track"><div class="fill" style="width:${pct(st.learning + st.master, n)}%;opacity:.55"></div></div><span class="v">${st.learning + st.master}</span></div>
        <p class="muted small" style="margin:8px 0 0">全${n}語・未学習 ${st.new}・苦手★ ${Object.keys(S.vstar).length}・書き取り ${S.dictLog.length}回（直近の正答率 ${(() => { const l = S.dictLog.slice(-5); const c = l.reduce((a, x) => a + x.c, 0), m = l.reduce((a, x) => a + x.n, 0); return m ? pct(c, m) + '%' : '—'; })()}）。習得＝間隔反復の段階${MASTER}以上。</p>`; })()}</div>
    <h2>Writingの履歴</h2>
    ${S.writings.length ? S.writings.slice(-10).reverse().map(w => `<details><summary>${w.d.slice(5)} ${esc(TASKS[w.t].name)}・${w.w}語</summary><div class="model">${esc(w.text)}</div></details>`).join('') : '<p class="muted">まだない。</p>'}

    <h2>設定</h2>
    <div class="card">
      <div class="field"><label for="exam">受験予定日</label><input type="date" id="exam" value="${esc(S.settings.examDate)}"></div>
      <div class="field"><label for="rate">読み上げ速度 <span id="rv">${S.settings.rate.toFixed(2)}</span>倍</label><input type="range" id="rate" min="0.7" max="1.3" step="0.05" value="${S.settings.rate}"><span class="muted small">本番に近いのは0.95〜1.0倍程度（類推）。</span></div>
      <div class="field"><label for="v1">音声1（主音声）</label><select id="v1">${vopt(S.settings.voice1)}</select></div>
      <div class="field"><label for="v2">音声2（会話の相手・面接官）</label><select id="v2">${vopt(S.settings.voice2)}</select><button class="btn sm" id="vt" style="justify-self:start">▶ 試聴</button></div>
      <div class="field"><div class="switch"><label for="pr">練習モード<div class="muted small" style="font-weight:400">リスニングの繰り返し再生と、音声の文字表示を許可する</div></label><input type="checkbox" id="pr" ${S.settings.practice ? 'checked' : ''}></div></div>
      <div class="field"><div class="switch"><label for="asr">音声認識で自動判定（オンライン時）<div class="muted small" style="font-weight:400">${SRCls ? 'Speakingで話した内容を文字にする。オフライン時は自動的に録音モードになる' : 'このブラウザは音声認識に非対応'}</div></label><input type="checkbox" id="asr" ${S.settings.asr ? 'checked' : ''} ${SRCls ? '' : 'disabled'}></div></div>
      <div class="field"><div class="switch"><label for="jv">聞き流しで日本語訳も読み上げる<div class="muted small" style="font-weight:400">${TTS.ja() ? '日本語音声：' + esc(TTS.ja().name) : '日本語音声が見つからない（表示のみになる）'}</div></label><input type="checkbox" id="jv" ${S.settings.jaVoice ? 'checked' : ''}></div></div>
      <div class="field"><label for="np">1日の新出単語数</label><input type="number" id="np" min="0" max="50" value="${S.settings.newPerDay}"></div>
    </div>

    <h2>オフライン準備チェック</h2><div class="card" id="chk"><p class="muted">確認中…</p></div>

    <h2>バックアップ</h2>
    <div class="card"><p class="muted">学習記録はこの端末のブラウザ内にだけ保存される。機種変更やブラウザのデータ削除に備えて、ときどき書き出す。</p>
      <div class="row"><button class="btn" id="ex">ファイルに書き出す</button><label class="btn" for="im">ファイルから復元</label><input type="file" id="im" accept="application/json,.json" hidden></div></div>
    <p class="muted small" style="margin-top:16px">バージョン ${APP_VERSION}・<button class="btn sm ghost" id="upd">更新を確認</button></p>`;

  const set = (key, val) => { S.settings[key] = val; save(); };
  $('#exam', v).onchange = e => set('examDate', e.target.value);
  $('#rate', v).oninput = e => { set('rate', +e.target.value); $('#rv', v).textContent = (+e.target.value).toFixed(2); };
  $('#v1', v).onchange = e => set('voice1', e.target.value);
  $('#v2', v).onchange = e => set('voice2', e.target.value);
  $('#vt', v).onclick = async () => { TTS.cancel(); try { await TTS.speak('This is voice one.'); await TTS.speak('And this is voice two.', { slot: 2 }); } catch (e) { toast('読み上げを使えない。'); } };
  $('#pr', v).onchange = e => set('practice', e.target.checked);
  $('#asr', v).onchange = e => set('asr', e.target.checked);
  $('#jv', v).onchange = e => set('jaVoice', e.target.checked);
  $('#np', v).onchange = e => set('newPerDay', clamp(parseInt(e.target.value, 10) || 0, 0, 50));
  $('#ex', v).onclick = () => {
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `toefl-backup-${today()}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  $('#im', v).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const x = JSON.parse(await f.text());
      if (!x || !Array.isArray(x.attempts)) throw new Error('bad');
      if (!confirm(`記録 ${x.attempts.length} 件で現在のデータを上書きしますか？`)) return;
      S = mergeState(x); await Store.set('state', S); toast('復元した。'); render();
    } catch (err) { toast('このファイルは読み込めない。'); }
  };
  $('#upd', v).onclick = async () => {
    if (!('serviceWorker' in navigator)) return toast('このブラウザは更新確認に非対応。');
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return toast('オフライン機能が未登録。');
    await reg.update(); toast(reg.waiting || reg.installing ? '新しい版を取得中…' : '最新版である。');
  };
  offlineCheck($('#chk', v));
}
async function offlineCheck(el) {
  const rows = [];
  const sw = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  rows.push([sw, 'オフライン起動', sw ? '有効。通信なしでも起動できる' : '未有効。一度オンラインで開いたあと、再読み込みすると有効になる']);
  let cached = false;
  try { cached = (await caches.keys()).some(k => k.startsWith('toefl-')); } catch (e) {}
  rows.push([cached, 'ファイルの保存', cached ? 'アプリ一式を端末に保存済み' : '未保存']);
  const en = TTS.voices.length, local = TTS.voices.filter(v => v.localService).length;
  rows.push([en > 0 ? (local > 0 ? true : null) : false, '英語の読み上げ音声', en ? `${en}種類（端末内 ${local}種類）。オフラインでは端末内の音声のみ使える可能性が高い` : '見つからない。Androidの設定 → テキスト読み上げで英語の音声データを入れる']);
  let pers = null;
  try { pers = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) {}
  rows.push([pers, '記録の永続保存', pers ? '許可済み（自動削除されにくい）' : '未許可。ホーム画面に追加して使うと許可されやすい']);
  rows.push([!!window.MediaRecorder, '録音', window.MediaRecorder ? '対応' : '非対応']);
  el.innerHTML = rows.map(([ok, t, d]) => `<div class="check"><span class="${ok ? 'okline' : ok === null ? 'wline' : 'ngline'}" style="font-weight:800;width:22px">${ok ? '✓' : ok === null ? '!' : '✗'}</span><span><b>${t}</b><div class="muted small">${esc(d)}</div></span></div>`).join('');
}

/* ---------- ルーター ---------- */
const PLAYERS = { ctw: playCTW, daily: playMCQ, academic: playMCQ, lconv: playMCQ, lann: playMCQ, ltalk: playMCQ, lresp: playResp, build: playBuild, email: playWrite, disc: playWrite, repeat: playRepeat, interview: playInterview };
function render() {
  cleanup();
  document.body.classList.remove('playing');
  const h = (location.hash || '#today').slice(1);
  const v = $('#view');
  const [route, k, id] = h.split('/');
  const tab = route === 'wrong' ? 'drill' : route;
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (route === 'review') { location.replace('#words'); return; }
  if (route !== 'play') lastRoute = ['drill', 'words', 'tips', 'stats', 'wrong'].includes(route) ? route : 'today';
  if (route === 'play') {
    const it = findItem(k, id);
    if (it && PLAYERS[k]) { PLAYERS[k](k, it); window.scrollTo(0, 0); return; }
    location.hash = '#drill'; return;
  }
  if (route === 'tips') { viewTips(v, k, id); window.scrollTo(0, 0); return; }
  ({ drill: viewDrill, words: viewWords, wrong: viewWrong, stats: viewStats }[route] || viewToday)(v);
  window.scrollTo(0, 0);
}
function netState() { const n = $('#net'); n.textContent = navigator.onLine ? 'オンライン' : 'オフライン'; n.classList.toggle('off', !navigator.onLine); }

/* ---------- Service Worker（オフライン化と更新通知） ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const prompt = w => toast('新しいバージョンがある。', '更新する', () => w.postMessage('SKIP_WAITING'), 0);
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
}

/* ---------- 起動 ---------- */
async function boot() {
  netState(); addEventListener('online', netState); addEventListener('offline', netState);
  await Store.open();
  S = mergeState(await Store.get('state'));
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  try {
    const names = ['reading', 'listening', 'writing', 'speaking', 'vocab', 'tips'];
    const parts = await Promise.all(names.map(n => fetch(`./data/${n}.json`).then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
    const [reading, listening, writing, speaking, vocab, tips] = parts;
    C = { reading, listening, writing, speaking, vocab: vocab.words, vcats: vocab.cats, tips, phrases: tips.phrases };
  } catch (e) {
    $('#view').innerHTML = '<div class="card"><p>問題データを読み込めなかった。一度オンラインで開き直す。</p></div>';
    return;
  }
  addEventListener('hashchange', render);
  document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); render(); } });
  render();
  registerSW();
}
boot();
})();
