(function () {
  'use strict';

  const DEFAULT_DOC_ID = '1TN74tj97SLnw1BxeuqXdbRkjQadCYb42mW59qdJBM7Y';
  const KEY_STATE = 'soz.state.v1';
  const KEY_DOC = 'soz.doc.v1';
  // интервалы повторения по «коробкам» Лейтнера, в днях
  const INTERVALS = [0, 1, 2, 4, 7, 14, 30, 60, 120];
  const LEARNED_BOX = 4;
  const MAX_BOX = INTERVALS.length - 1;
  const SESSION_MAX = 40;
  const AUTO_SYNC_MS = 3 * 3600 * 1000;

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');

  /* ---------- состояние ---------- */

  function today() {
    const d = new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }

  function defaultState() {
    return {
      settings: {
        docId: DEFAULT_DOC_ID,
        newPerDay: 10,
        dailyGoal: 20,
        direction: 'auto',
        includeEn: true,
        order: 'fresh',
        autoSync: true,
      },
      progress: {},   // id → { b: коробка, d: день повтора, s: показов, c: верно, w: ошибок, f: день знакомства, l: последний день }
      hidden: {},     // id → true
      discovered: {}, // id → когда слово впервые появилось в документе (для «сначала свежие»)
      days: {},       // день → { a: ответов, c: верных }
      lastSync: 0,
      lastAdded: 0,
    };
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_STATE));
      if (raw && typeof raw === 'object') {
        const d = defaultState();
        return Object.assign(d, raw, { settings: Object.assign(d.settings, raw.settings || {}) });
      }
    } catch (e) { /* пустое или недоступное хранилище */ }
    return defaultState();
  }

  let S = loadState();
  let docText = null;
  try { docText = localStorage.getItem(KEY_DOC); } catch (e) { /* нет доступа */ }

  function save() {
    try { localStorage.setItem(KEY_STATE, JSON.stringify(S)); }
    catch (e) { toast('Не удалось сохранить прогресс'); }
  }

  let ALL = [];
  let byId = new Map();
  let ACTIVE = [];

  function rebuild() {
    ALL = docText ? AzParser.parse(docText) : [];
    byId = new Map(ALL.map((c) => [c.id, c]));
    refreshActive();
  }

  function refreshActive() {
    ACTIVE = ALL.filter((c) => !S.hidden[c.id] && (S.settings.includeEn || c.lang === 'ru'));
  }

  function statusOf(c) {
    const p = S.progress[c.id];
    if (!p) return 'new';
    return p.b >= LEARNED_BOX ? 'learned' : 'learning';
  }

  function counts() {
    const t = today();
    let due = 0, fresh = 0, learning = 0, learned = 0;
    for (const c of ACTIVE) {
      const p = S.progress[c.id];
      if (!p) { fresh++; continue; }
      if (p.d <= t) due++;
      if (p.b >= LEARNED_BOX) learned++; else learning++;
    }
    const newLeft = Math.min(fresh, Math.max(0, S.settings.newPerDay - newToday()));
    return { due, fresh, learning, learned, newLeft, total: ACTIVE.length };
  }

  function newToday() {
    const t = today();
    let n = 0;
    for (const id in S.progress) if (S.progress[id].f === t) n++;
    return n;
  }

  function dayStat(d) { return S.days[d] || { a: 0, c: 0 }; }

  function streak() {
    const goal = S.settings.dailyGoal;
    const met = (d) => dayStat(d).a >= goal;
    const t = today();
    let d = met(t) ? t : t - 1;
    let n = 0;
    while (met(d)) { n++; d--; }
    return { n, todayDone: met(t) };
  }

  /* ---------- утилиты ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  function suffixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }

  function fold(s) {
    return s.toLowerCase()
      .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
      .replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ё/g, 'е');
  }

  function wc(s) { return s.trim().split(/\s+/).length; }

  let toastTimer = 0;
  function toast(msg, ms) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('show'), ms || 2800);
  }

  function ago(ts) {
    if (!ts) return 'никогда';
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин назад`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ч назад`;
    const d = Math.round(h / 24);
    return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  }

  /* ---------- синхронизация с Google Docs ---------- */

  function parseDocId(input) {
    const s = String(input || '').trim();
    const m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return null;
  }

  async function fetchDoc(id) {
    const url = `https://docs.google.com/document/d/${encodeURIComponent(id)}/export?format=txt`;
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(navigator.onLine ? 'Не удалось связаться с Google Docs' : 'Нет интернета');
    }
    if (!res.ok) throw new Error(res.status === 404 ? 'Документ не найден' : `Google Docs ответил ошибкой ${res.status}`);
    let text;
    try { text = await res.text(); }
    catch (e) { throw new Error('Документ загружался слишком долго, попробуйте ещё раз'); }
    finally { clearTimeout(timer); }
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new Error('Документ закрыт. Откройте доступ «Все, у кого есть ссылка».');
    }
    return text;
  }

  let syncing = false;

  function applyDocText(text) {
    const before = new Set(ALL.map((c) => c.id));
    const hadDoc = !!docText;
    docText = text;
    try { localStorage.setItem(KEY_DOC, text); } catch (e) { /* текст документа просто не закешируется */ }
    rebuild();
    const now = Date.now();
    let added = 0;
    if (hadDoc) {
      for (const c of ALL) {
        if (!before.has(c.id)) { S.discovered[c.id] = now; added++; }
      }
    }
    S.lastSync = now;
    S.lastAdded = added;
    save();
    return { hadDoc, added };
  }

  async function sync(opts) {
    opts = opts || {};
    if (syncing) return;
    syncing = true;
    if (view !== 'quiz') render();
    try {
      const text = await fetchDoc(S.settings.docId);
      const r = applyDocText(text);
      if (!r.hadDoc) toast(`Загружено ${ALL.length} ${plural(ALL.length, 'слово', 'слова', 'слов')}`);
      else if (r.added) toast(`Новых слов из документа: ${r.added}`);
      else if (!opts.silent) toast('Документ проверен — новых слов нет');
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      if (!opts.silent) toast(e.message, 4500);
      syncError = e.message;
    } finally {
      syncing = false;
      if (view !== 'quiz') render();
      updateBadge();
    }
  }
  let syncError = '';

  /* ---------- тренировка ---------- */

  let view = 'home';
  let session = null;
  let q = null;
  let wordsUi = { query: '', filter: 'all', limit: 150 };

  function orderNew(list) {
    const o = S.settings.order;
    if (o === 'random') return shuffle(list.slice());
    if (o === 'doc') return list.slice().sort((a, b) => a.line - b.line);
    return list.slice().sort((a, b) => (S.discovered[b.id] || 0) - (S.discovered[a.id] || 0) || b.line - a.line);
  }

  function buildQueue(extraNew) {
    const t = today();
    const due = ACTIVE
      .filter((c) => { const p = S.progress[c.id]; return p && p.d <= t; })
      .sort((a, b) => S.progress[a.id].d - S.progress[b.id].d || S.progress[a.id].b - S.progress[b.id].b);
    const quota = extraNew != null ? extraNew : Math.max(0, S.settings.newPerDay - newToday());
    const fresh = orderNew(ACTIVE.filter((c) => !S.progress[c.id])).slice(0, quota);
    const reviews = due.slice(0, Math.max(10, SESSION_MAX - fresh.length));
    // новые слова равномерно между повторениями
    const out = [];
    const step = fresh.length ? Math.max(1, Math.floor(reviews.length / fresh.length)) : 0;
    let ri = 0;
    for (const f of fresh) {
      for (let k = 0; k < step && ri < reviews.length; k++) out.push(reviews[ri++].id);
      out.push(f.id);
    }
    while (ri < reviews.length) out.push(reviews[ri++].id);
    return out;
  }

  function buildHardQueue() {
    return ACTIVE
      .filter((c) => { const p = S.progress[c.id]; return p && p.w > 0; })
      .sort((a, b) => {
        const pa = S.progress[a.id], pb = S.progress[b.id];
        return pb.w / pb.s - pa.w / pa.s || pb.w - pa.w;
      })
      .slice(0, 20)
      .map((c) => c.id);
  }

  function startSession(queue, mode) {
    if (!queue.length) { toast('Нет слов для тренировки'); return; }
    session = { queue, idx: 0, answered: 0, correct: 0, failed: new Set(), requeued: {}, newIds: new Set(), mode: mode || 'daily' };
    view = 'quiz';
    nextQuestion();
  }

  function chooseDir(card, level) {
    const m = S.settings.direction;
    if (m === 'az') return 'fwd';
    if (m === 'ru') return 'rev';
    if (m === 'mix') return Math.random() < 0.5 ? 'fwd' : 'rev';
    if (level <= 1) return 'fwd';
    if (level <= 3) return Math.random() < 0.5 ? 'fwd' : 'rev';
    return Math.random() < 0.7 ? 'rev' : 'fwd';
  }

  /*
   * Подбор неправильных вариантов. Кандидаты — того же языка, без пересечения по смыслу.
   * Чем выше уровень слова, тем больше варианты похожи на правильный ответ:
   * та же часть речи, похожая длина, общее окончание, близкое написание.
   */
  function pickDistractors(card, dir, level) {
    const text = (c) => (dir === 'fwd' ? c.gloss : c.az);
    const target = text(card);
    const tMean = new Set(card.meanings);
    const tLen = target.length, tWc = wc(target);
    const tLast = fold(target.split(/[\s,;\/]+/).filter(Boolean).pop() || target);
    const hard = level >= 2;
    const scored = [];
    for (const c of ACTIVE) {
      if (c.id === card.id || c.lang !== card.lang) continue;
      const t = text(c);
      if (t === target || c.meanings.some((m) => tMean.has(m))) continue;
      if (dir === 'rev' && fold(c.az) === fold(card.az)) continue;
      let s = 0;
      if (c.type === card.type) s += 3;
      if (wc(t) === tWc) s += 1;
      s += 1.5 * Math.min(t.length, tLen) / Math.max(t.length, tLen);
      const last = fold(t.split(/[\s,;\/]+/).filter(Boolean).pop() || t);
      const suf = Math.min(3, suffixLen(last, tLast));
      if (suf >= 2) s += hard ? suf * 0.6 : 0.3;
      if (hard) s += 2.5 * (1 - lev(fold(t), fold(target)) / Math.max(t.length, tLen));
      s += Math.random() * (level <= 1 ? 2.5 : level <= 3 ? 1.2 : 0.5);
      scored.push({ c, s, t });
    }
    scored.sort((a, b) => b.s - a.s);
    const window = level <= 1 ? 14 : level <= 3 ? 7 : 4;
    const top = shuffle(scored.slice(0, window));
    const picked = [];
    const seen = new Set([target]);
    for (const x of top.concat(scored.slice(window))) {
      if (picked.length >= 3) break;
      if (seen.has(x.t)) continue;
      seen.add(x.t);
      picked.push(x.c);
    }
    return picked;
  }

  function nextQuestion() {
    while (session.idx < session.queue.length && !byId.get(session.queue[session.idx])) session.idx++;
    if (session.idx >= session.queue.length) { view = 'summary'; q = null; render(); return; }
    const card = byId.get(session.queue[session.idx]);
    const p = S.progress[card.id];
    const level = session.failed.has(card.id) ? 0 : (p ? p.b : 0);
    const dir = chooseDir(card, level);
    const options = shuffle([card].concat(pickDistractors(card, dir, level))).map((c) => ({
      id: c.id,
      text: dir === 'fwd' ? c.gloss : c.az,
      correct: c.id === card.id,
    }));
    q = { card, dir, options, picked: null, isNew: !p };
    render();
  }

  function grade(card, ok) {
    const t = today();
    let p = S.progress[card.id];
    const isNew = !p;
    if (!p) p = S.progress[card.id] = { b: 0, d: t, s: 0, c: 0, w: 0, f: t, l: t };
    p.s++;
    p.l = t;
    if (ok) {
      p.c++;
      if (!session.failed.has(card.id)) {
        // сразу угадал новое слово — скорее всего, уже знаком с ним
        p.b = isNew ? 2 : Math.min(MAX_BOX, p.b + 1);
        p.d = t + INTERVALS[p.b];
      }
    } else {
      p.w++;
      p.b = p.b >= LEARNED_BOX ? 2 : 1;
      p.d = t + 1;
      session.failed.add(card.id);
      // вернуть слово через несколько карточек, не больше двух раз за сессию
      const n = session.requeued[card.id] || 0;
      if (n < 2) {
        session.requeued[card.id] = n + 1;
        const pos = Math.min(session.queue.length, session.idx + 3 + Math.floor(Math.random() * 3));
        session.queue.splice(pos, 0, card.id);
      }
    }
    if (isNew) session.newIds.add(card.id);
    const ds = S.days[t] || (S.days[t] = { a: 0, c: 0 });
    ds.a++;
    if (ok) ds.c++;
    session.answered++;
    if (ok) session.correct++;
    save();
  }

  function answer(i) {
    if (!q || q.picked !== null) return;
    q.picked = i;
    const ok = i >= 0 && q.options[i].correct;
    grade(q.card, ok);
    if (!ok && navigator.vibrate) navigator.vibrate(60);
    render();
  }

  function advance() {
    if (!q || q.picked === null) return;
    session.idx++;
    nextQuestion();
  }

  function updateBadge() {
    if (!('setAppBadge' in navigator)) return;
    const c = counts();
    const n = c.due + c.newLeft;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }

  /* ---------- экраны ---------- */

  function tabbar(active) {
    const tab = (id, label, icon) =>
      `<button class="tab ${active === id ? 'on' : ''}" data-act="go" data-view="${id}" aria-label="${label}">${icon}<span>${label}</span></button>`;
    return `<nav class="tabbar">
      ${tab('home', 'Сегодня', '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/></svg>')}
      ${tab('words', 'Слова', '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5zM8 9h8M8 13h8M8 17h5"/></svg>')}
      ${tab('settings', 'Настройки', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>')}
    </nav>`;
  }

  function weekDots() {
    const t = today();
    const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    let html = '';
    for (let d = t - 6; d <= t; d++) {
      const st = dayStat(d);
      const pct = Math.min(1, st.a / S.settings.dailyGoal);
      const dow = new Date(d * 86400000).getUTCDay();
      html += `<div class="day ${pct >= 1 ? 'met' : st.a ? 'some' : ''} ${d === t ? 'today' : ''}" title="${st.a} ${plural(st.a, 'ответ', 'ответа', 'ответов')}">
        <div class="dot" style="--p:${pct}"></div><span>${names[dow]}</span></div>`;
    }
    return html;
  }

  function renderHome() {
    const c = counts();
    const st = streak();
    const td = dayStat(today());
    const goal = S.settings.dailyGoal;
    const pct = Math.min(100, Math.round((td.a / goal) * 100));
    const planned = Math.min(c.due, SESSION_MAX) + c.newLeft;
    let main;
    if (!ALL.length) {
      main = `<div class="card hero"><h2>Слов пока нет</h2><p class="muted">${syncError ? esc(syncError) : 'Загрузите документ, чтобы начать.'}</p>
        <button class="btn primary" data-act="sync">Загрузить из Google Docs</button></div>`;
    } else if (planned > 0) {
      main = `<div class="card hero">
        <div class="hero-nums">
          <div><b>${c.due}</b><span>${plural(c.due, 'повторение', 'повторения', 'повторений')}</span></div>
          <div><b>${c.newLeft}</b><span>${plural(c.newLeft, 'новое слово', 'новых слова', 'новых слов')}</span></div>
        </div>
        <button class="btn primary big" data-act="start">Начать тренировку</button>
      </div>`;
    } else {
      main = `<div class="card hero done">
        <h2>На сегодня всё</h2>
        <p class="muted">Все повторения сделаны. Следующие слова появятся завтра.</p>
        <div class="row">
          ${c.fresh ? '<button class="btn primary" data-act="more">Ещё 10 новых</button>' : ''}
          ${buildHardQueue().length ? '<button class="btn" data-act="hard">Трудные слова</button>' : ''}
        </div>
      </div>`;
    }
    $app.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">ə</span><div><h1>Söz</h1><p>азербайджанские слова</p></div></div>
        <div class="streak ${st.todayDone ? 'lit' : ''}" title="Дней подряд с выполненной целью">
          <svg viewBox="0 0 24 24"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5 .2 2 1 3 2 3.5C11 9 11 5 12 2z"/></svg>
          <b>${st.n}</b>
        </div>
      </header>
      <section class="card goal">
        <div class="goal-head"><span>Цель на сегодня</span><b>${td.a} / ${goal}</b></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="week">${weekDots()}</div>
      </section>
      ${main}
      <section class="stats">
        <div><b>${c.learned}</b><span>выучено</span></div>
        <div><b>${c.learning}</b><span>изучаю</span></div>
        <div><b>${c.fresh}</b><span>новых</span></div>
      </section>
      <section class="card sync">
        <div>
          <b>Google Docs</b>
          <span class="muted">${syncing ? 'Проверяю документ…' : `обновлено ${ago(S.lastSync)}${S.lastAdded ? ` · +${S.lastAdded} новых` : ''}`}</span>
        </div>
        <button class="btn small ${syncing ? 'spin' : ''}" data-act="sync" ${syncing ? 'disabled' : ''} aria-label="Обновить слова из документа">
          <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>
          Обновить
        </button>
      </section>
      ${tabbar('home')}`;
  }

  function renderQuiz() {
    const card = q.card;
    const done = session.idx;
    const total = session.queue.length;
    const answered = q.picked !== null;
    const ok = answered && q.picked >= 0 && q.options[q.picked].correct;
    const isEn = card.lang === 'en';
    const prompt = q.dir === 'fwd' ? card.az : card.gloss;
    const label = q.dir === 'fwd'
      ? (isEn ? 'Перевод на английский?' : 'Как переводится?')
      : 'Как это по-азербайджански?';

    const opts = q.options.map((o, i) => {
      let cls = 'opt';
      if (answered) {
        if (o.correct) cls += ' right';
        else if (i === q.picked) cls += ' wrong';
        else cls += ' dim';
      }
      return `<button class="${cls}" data-act="${answered ? (o.correct ? 'next' : 'noop') : 'pick'}" data-i="${i}" ${q.dir === 'rev' ? 'lang="az"' : ''}>
        <kbd>${i + 1}</kbd><span>${esc(o.text)}</span></button>`;
    }).join('');

    let fb = '';
    if (answered) {
      const wrongPick = !ok && q.picked >= 0 ? byId.get(q.options[q.picked].id) : null;
      fb = `<div class="feedback ${ok ? 'ok' : 'bad'}" role="status">
        <div class="fb-title">${ok ? 'Верно' : q.picked < 0 ? 'Запомните' : 'Неверно'}</div>
        <div class="fb-pair"><b lang="az">${esc(card.az)}</b> — ${esc(card.gloss)}</div>
        ${card.alts.length ? `<div class="fb-line"><span class="muted">ещё:</span> ${esc(card.alts.join(', '))}</div>` : ''}
        ${card.notes.length ? `<div class="fb-line"><span class="muted">заметка:</span> ${esc(card.notes.join('; '))}</div>` : ''}
        ${card.examples.length ? `<div class="fb-ex" lang="az">${esc(card.examples[0])}</div>` : ''}
        ${wrongPick ? `<div class="fb-line wrong-pick"><span class="muted">вы выбрали:</span> <b lang="az">${esc(wrongPick.az)}</b> — ${esc(wrongPick.gloss)}</div>` : ''}
        <div class="fb-actions">
          <button class="link" data-act="hide-card" title="Если пара распознана неправильно">Скрыть карточку</button>
          <button class="btn primary" data-act="next" autofocus>Дальше</button>
        </div>
      </div>`;
    }

    $app.innerHTML = `
      <div class="quiz">
        <header class="quiz-top">
          <button class="icon" data-act="quit" aria-label="Закончить"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          <div class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div>
          <span class="count">${Math.min(done + 1, total)}/${total}</span>
        </header>
        <div class="prompt">
          <div class="label">${label}${q.isNew ? ' <em class="chip new">новое</em>' : ''}${isEn ? ' <em class="chip">EN</em>' : ''}</div>
          <div class="word" ${q.dir === 'fwd' ? 'lang="az"' : ''}>${esc(prompt)}</div>
        </div>
        <div class="opts">${opts}</div>
        ${answered ? fb : '<button class="link idk" data-act="idk">Не знаю</button>'}
      </div>`;
    const btn = $app.querySelector('.feedback .btn.primary');
    if (btn) btn.focus({ preventScroll: true });
  }

  function renderSummary() {
    const pct = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
    const c = counts();
    const st = streak();
    const more = buildQueue().length;
    $app.innerHTML = `
      <div class="summary">
        <div class="big-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h2>Тренировка завершена</h2>
        <div class="stats">
          <div><b>${session.answered}</b><span>${plural(session.answered, 'ответ', 'ответа', 'ответов')}</span></div>
          <div><b>${pct}%</b><span>верно</span></div>
          <div><b>${session.newIds.size}</b><span>новых</span></div>
        </div>
        <p class="muted">${st.todayDone ? `Цель дня выполнена. Серия: ${st.n} ${plural(st.n, 'день', 'дня', 'дней')}.` : `До цели дня: ${Math.max(0, S.settings.dailyGoal - dayStat(today()).a)} ${plural(Math.max(0, S.settings.dailyGoal - dayStat(today()).a), 'ответ', 'ответа', 'ответов')}.`}
        Выучено слов: ${c.learned}.</p>
        <div class="col">
          ${more ? '<button class="btn primary big" data-act="start">Продолжить</button>' : ''}
          <button class="btn ${more ? '' : 'primary big'}" data-act="go" data-view="home">На главную</button>
        </div>
      </div>`;
  }

  function renderWords() {
    const fq = fold(wordsUi.query.trim());
    const f = wordsUi.filter;
    const t = today();
    let list = ALL.filter((c) => {
      if (f === 'hidden') { if (!S.hidden[c.id]) return false; }
      else {
        if (S.hidden[c.id]) return false;
        if (!S.settings.includeEn && c.lang === 'en') return false;
        if (f !== 'all' && statusOf(c) !== f) return false;
      }
      if (fq && !fold(c.az).includes(fq) && !fold(c.gloss).includes(fq) && !c.alts.some((a) => fold(a).includes(fq))) return false;
      return true;
    });
    list.sort((a, b) => a.az.localeCompare(b.az, 'az'));
    const total = list.length;
    const shown = list.slice(0, wordsUi.limit);
    const chip = (id, label) => `<button class="chip-btn ${f === id ? 'on' : ''}" data-act="wfilter" data-f="${id}">${label}</button>`;
    const rows = shown.map((c) => {
      const st = S.hidden[c.id] ? 'hidden' : statusOf(c);
      const p = S.progress[c.id];
      const dueTxt = p ? (p.d <= t ? 'сегодня' : `через ${p.d - t} дн.`) : '';
      return `<li class="w ${st}">
        <i class="st" title="${{ new: 'новое', learning: 'изучаю', learned: 'выучено', hidden: 'скрыто' }[st]}"></i>
        <div class="w-main"><b lang="az">${esc(c.az)}</b><span>${esc(c.gloss)}${c.lang === 'en' ? ' <em class="chip">EN</em>' : ''}</span></div>
        <span class="w-due">${dueTxt}</span>
        <button class="icon" data-act="toggle-hide" data-id="${c.id}" aria-label="${S.hidden[c.id] ? 'Вернуть' : 'Скрыть'}">
          ${S.hidden[c.id]
            ? '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12a14 14 0 0 1-3 3.7M6.6 6.6A14 14 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/></svg>'}
        </button>
      </li>`;
    }).join('');
    $app.innerHTML = `
      <header class="top"><h1 class="page">Слова <span class="muted">${ALL.length}</span></h1></header>
      <div class="search">
        <input type="search" id="wq" placeholder="Поиск: söz, слово…" value="${esc(wordsUi.query)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="chips">${chip('all', 'Все')}${chip('new', 'Новые')}${chip('learning', 'Изучаю')}${chip('learned', 'Выучено')}${chip('hidden', 'Скрытые')}</div>
      <ul class="wlist">${rows || '<li class="empty muted">Ничего не найдено</li>'}</ul>
      ${total > shown.length ? `<button class="btn wide" data-act="wmore">Показать ещё (${total - shown.length})</button>` : ''}
      <p class="hint muted">Если пара распознана неверно — скройте её, в тренировке она больше не появится.</p>
      ${tabbar('words')}`;
    const inp = document.getElementById('wq');
    inp.addEventListener('input', () => {
      wordsUi.query = inp.value;
      wordsUi.limit = 150;
      const pos = inp.selectionStart;
      renderWords();
      const again = document.getElementById('wq');
      again.focus();
      try { again.setSelectionRange(pos, pos); } catch (e) { /* type=search в некоторых браузерах */ }
    });
  }

  function seg(name, value, options) {
    return `<div class="seg" role="radiogroup">${options.map(([v, label]) =>
      `<button role="radio" aria-checked="${String(value) === String(v)}" class="${String(value) === String(v) ? 'on' : ''}" data-act="set" data-k="${name}" data-v="${v}">${label}</button>`).join('')}</div>`;
  }

  function renderSettings() {
    const s = S.settings;
    $app.innerHTML = `
      <header class="top"><h1 class="page">Настройки</h1></header>
      <section class="card form">
        <label class="field">
          <span>Документ Google Docs</span>
          <input id="doc" type="url" value="https://docs.google.com/document/d/${esc(s.docId)}/edit" autocomplete="off" spellcheck="false">
          <small class="muted">Доступ по ссылке должен быть открыт. Слова подтягиваются автоматически при запуске и по кнопке «Обновить».</small>
        </label>
        <div class="row"><button class="btn" data-act="save-doc">Сохранить и загрузить</button></div>
      </section>

      <section class="card form">
        <div class="field"><span>Новых слов в день</span>${seg('newPerDay', s.newPerDay, [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']])}</div>
        <div class="field"><span>Цель на день (ответов)</span>${seg('dailyGoal', s.dailyGoal, [[10, '10'], [20, '20'], [30, '30'], [50, '50']])}</div>
        <div class="field"><span>Направление</span>${seg('direction', s.direction, [['auto', 'Авто'], ['az', 'AZ→RU'], ['ru', 'RU→AZ'], ['mix', 'Микс']])}
          <small class="muted">«Авто»: новые слова — с азербайджанского, выученные — чаще в обратную сторону.</small></div>
        <div class="field"><span>Порядок новых слов</span>${seg('order', s.order, [['fresh', 'Сначала свежие'], ['doc', 'По документу'], ['random', 'Случайно']])}
          <small class="muted">«Сначала свежие» — слова, недавно добавленные в документ (или ближе к его концу).</small></div>
        <label class="toggle"><span>Пары с английским переводом</span><input type="checkbox" data-act="toggle" data-k="includeEn" ${s.includeEn ? 'checked' : ''}></label>
        <label class="toggle"><span>Проверять документ при запуске</span><input type="checkbox" data-act="toggle" data-k="autoSync" ${s.autoSync ? 'checked' : ''}></label>
      </section>

      <section class="card form">
        <div class="field"><span>Резервная копия прогресса</span>
          <div class="row">
            <button class="btn" data-act="export">Скачать</button>
            <label class="btn">Восстановить<input type="file" accept="application/json,.json" id="imp" hidden></label>
          </div>
        </div>
        <div class="field"><span>Загрузить текст вручную</span>
          <small class="muted">Если Google Docs недоступен: «Файл → Скачать → Обычный текст (.txt)» и выберите файл.</small>
          <div class="row"><label class="btn">Выбрать .txt<input type="file" accept=".txt,text/plain" id="txt" hidden></label></div>
        </div>
        <div class="row"><button class="btn danger" data-act="reset">Сбросить прогресс</button></div>
      </section>
      <p class="hint muted">Söz · слов в документе: ${ALL.length} · парсер v${AzParser.PARSER_VERSION}</p>
      ${tabbar('settings')}`;

    document.getElementById('imp').addEventListener('change', (e) => importProgress(e.target.files[0]));
    document.getElementById('txt').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = applyDocText(await f.text());
      toast(r.hadDoc ? `Новых слов: ${r.added}` : `Загружено слов: ${ALL.length}`);
      render();
    });
  }

  function renderWelcome() {
    $app.innerHTML = `
      <div class="welcome">
        <span class="logo xl">ə</span>
        <h1>Söz</h1>
        <p class="muted">${syncing ? 'Загружаю слова из вашего документа…' : esc(syncError || 'Тренажёр слов по конспекту в Google Docs')}</p>
        ${syncing ? '<div class="loader"></div>' : '<button class="btn primary big" data-act="sync">Загрузить слова</button>'}
      </div>`;
  }

  function render() {
    document.body.dataset.view = view;
    if (!docText && view === 'home') return renderWelcome();
    if (view === 'quiz' && q) return renderQuiz();
    if (view === 'summary' && session) return renderSummary();
    if (view === 'words') return renderWords();
    if (view === 'settings') return renderSettings();
    view = 'home';
    renderHome();
  }

  /* ---------- резервная копия ---------- */

  function exportProgress() {
    const data = JSON.stringify({ app: 'soz', version: 1, exportedAt: new Date().toISOString(), state: S });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `soz-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function importProgress(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'soz' || !data.state || typeof data.state.progress !== 'object') throw new Error('bad');
      const d = defaultState();
      S = Object.assign(d, data.state, { settings: Object.assign(d.settings, data.state.settings || {}) });
      save();
      refreshActive();
      toast('Прогресс восстановлен');
      render();
    } catch (e) {
      toast('Это не файл резервной копии Söz');
    }
  }

  /* ---------- действия ---------- */

  const ACTIONS = {
    go(el) { view = el.dataset.view; session = view === 'home' ? null : session; render(); window.scrollTo(0, 0); },
    start() { startSession(buildQueue(), 'daily'); },
    more() { startSession(buildQueue(10), 'extra'); },
    hard() { startSession(buildHardQueue(), 'hard'); },
    sync() { sync({ silent: false }); },
    pick(el) { answer(+el.dataset.i); },
    idk() { answer(-1); },
    next() { advance(); },
    noop() {},
    quit() {
      if (session && session.answered) { view = 'summary'; q = null; }
      else { view = 'home'; session = null; }
      render();
    },
    'hide-card'() {
      if (!q) return;
      S.hidden[q.card.id] = true;
      save();
      refreshActive();
      toast('Карточка скрыта. Вернуть можно в разделе «Слова».');
      advance();
    },
    'toggle-hide'(el) {
      const id = el.dataset.id;
      if (S.hidden[id]) delete S.hidden[id]; else S.hidden[id] = true;
      save();
      refreshActive();
      render();
    },
    wfilter(el) { wordsUi.filter = el.dataset.f; wordsUi.limit = 150; render(); },
    wmore() { wordsUi.limit += 300; render(); },
    set(el) {
      const k = el.dataset.k;
      const v = el.dataset.v;
      S.settings[k] = /^\d+$/.test(v) ? +v : v;
      save();
      render();
      updateBadge();
    },
    toggle(el) {
      S.settings[el.dataset.k] = el.checked;
      save();
      refreshActive();
      updateBadge();
    },
    'save-doc'() {
      const id = parseDocId(document.getElementById('doc').value);
      if (!id) { toast('Не похоже на ссылку Google Docs'); return; }
      if (id !== S.settings.docId) {
        S.settings.docId = id;
        docText = null;
        try { localStorage.removeItem(KEY_DOC); } catch (e) { /* ignore */ }
        rebuild();
        save();
      }
      sync({ silent: false });
    },
    export() { exportProgress(); },
    reset() {
      if (!confirm('Сбросить весь прогресс? Слова останутся, но статистика и повторения обнулятся.')) return;
      S.progress = {};
      S.days = {};
      S.hidden = {};
      save();
      refreshActive();
      toast('Прогресс сброшен');
      render();
    },
  };

  $app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el, e);
  });
  $app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[type=checkbox][data-act]')) ACTIONS[el.dataset.act](el, e);
  });

  document.addEventListener('keydown', (e) => {
    if (view !== 'quiz' || !q || e.metaKey || e.ctrlKey || e.altKey) return;
    if (q.picked === null) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= q.options.length) { e.preventDefault(); answer(n - 1); }
      else if (e.key === '0' || e.key === '?') { e.preventDefault(); answer(-1); }
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      e.preventDefault();
      advance();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (view === 'home') render();
    if (S.settings.autoSync && Date.now() - S.lastSync > AUTO_SYNC_MS && navigator.onLine) sync({ silent: true });
  });

  /* ---------- PWA ---------- */

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // при самой первой установке баннер «новая версия» не нужен
    const hadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'activated' && hadController) {
              const b = document.getElementById('update');
              if (b) b.hidden = false;
            }
          });
        });
      }).catch(() => {});
    });
  }
  const upd = document.getElementById('update');
  if (upd) upd.addEventListener('click', () => location.reload());

  /* ---------- запуск ---------- */

  rebuild();
  render();
  updateBadge();
  if (!docText) sync({ silent: false });
  else if (S.settings.autoSync && Date.now() - S.lastSync > AUTO_SYNC_MS && navigator.onLine) sync({ silent: true });

  // для отладки в консоли
  window.soz = { get cards() { return ALL; }, get state() { return S; }, distractors: pickDistractors };
})();
