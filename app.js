(function () {
  'use strict';

  const DEFAULT_DOC_ID = '1TN74tj97SLnw1BxeuqXdbRkjQadCYb42mW59qdJBM7Y';
  const PDF_URL = 'data/konspekt-pdf.txt';
  // вычитанные предложения: id → [азерб., рус.] — исправлено, 1 — проверено, 0 — не подходит
  const FIXES_URL = 'data/sentences-fixes.json';
  const KEY_STATE = 'soz.state.v1';
  const KEY_DOC = 'soz.doc.v1';
  // интервалы повторения по «коробкам» Лейтнера, в днях
  const INTERVALS = [0, 1, 2, 4, 7, 14, 30, 60, 120];
  const LEARNED_BOX = 4;
  const MAX_BOX = INTERVALS.length - 1;
  const SESSION_MAX = 40;
  const SENT_SESSION_MAX = 15;
  const AUTO_SYNC_MS = 3 * 3600 * 1000;

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const $sheet = document.getElementById('sheet');

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
        sentPerDay: 5,
        sentLevel: 'medium',
        sentTopic: 'all',
        dailyGoal: 20,
        direction: 'auto',
        includeEn: true,
        includePdf: true,
        order: 'fresh',
        autoSync: true,
      },
      progress: {},   // слово id → { b: коробка, d: день повтора, s: показов, c: верно, w: ошибок, f: день знакомства, l: последний день }
      sprogress: {},  // предложение id → то же самое
      hidden: {},     // скрытые слова
      shidden: {},    // скрытые предложения
      overrides: {},  // id слова → исправленный перевод
      discovered: {}, // id → когда слово впервые появилось в источниках (для «сначала свежие»)
      known: {},      // id → 1, все когда-либо виденные слова
      knownInit: false,
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
  let pdfText = null;
  let FIXES = null;
  // готовые примеры для слов, которых нет в предложениях конспекта: az → [пример, перевод, форма слова]
  const EXAMPLES_URL = 'data/examples.json';
  // разметка предложений: id → [уровень 1–3, тема]
  const META_URL = 'data/sentences-meta.json';
  let META = null;
  let EXAMPLES = null;
  try { docText = localStorage.getItem(KEY_DOC); } catch (e) { /* нет доступа */ }

  function save() {
    try { localStorage.setItem(KEY_STATE, JSON.stringify(S)); }
    catch (e) { toast('Не удалось сохранить прогресс'); }
  }

  let ALL = [];
  let byId = new Map();
  let ACTIVE = [];
  let SENTS = [];
  let sById = new Map();
  let SACTIVE = [];
  let LEX = null;

  function normM(s) {
    return s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  }

  function splitMeanings(g) {
    return g.split(/\s*[;,]\s*|\s+\/\s+|\s+=\s+/).map((x) => x.trim()).filter(Boolean);
  }

  // Слова из PDF дополняют слова из документа: совпавшие пары получают новые значения
  function mergeCards(docCards, pdfCards) {
    const map = new Map();
    for (const c of docCards) map.set(c.id, Object.assign(c, { origin: 'doc' }));
    for (const c of pdfCards) {
      const have = map.get(c.id);
      if (!have) { map.set(c.id, Object.assign(c, { origin: 'pdf' })); continue; }
      const seen = new Set(have.meanings);
      for (const g of [c.gloss].concat(c.alts)) {
        for (const m of splitMeanings(g)) {
          const k = normM(m);
          if (!seen.has(k)) { seen.add(k); have.alts.push(m); }
        }
      }
      have.meanings = [...seen];
      have.alts = have.alts.slice(0, 6);
      if (!have.examples.length) have.examples = c.examples;
      have.inPdf = true;
    }
    return [...map.values()];
  }

  function patchOverride(c) {
    const o = S.overrides[c.id];
    if (c.origGloss == null) c.origGloss = c.gloss;
    c.gloss = o || c.origGloss;
    c.edited = !!o;
    if (o) {
      const seen = new Set(c.meanings);
      for (const m of splitMeanings(o)) seen.add(normM(m));
      c.meanings = [...seen];
      c.alts = c.alts.filter((a) => normM(a) !== normM(o));
    }
  }

  function rebuild() {
    const docCards = docText ? AzParser.parse(docText) : [];
    const pdfCards = pdfText ? AzParser.parse(pdfText) : [];
    ALL = mergeCards(docCards, pdfCards);
    ALL.forEach(patchOverride);
    byId = new Map(ALL.map((c) => [c.id, c]));

    const sents = new Map();
    for (const s of AzGrammar.extract(docText, 'doc').concat(AzGrammar.extract(pdfText, 'pdf'))) {
      const fix = FIXES ? FIXES[s.id] : undefined;
      if (fix === 0) continue;
      if (Array.isArray(fix)) { s.az = fix[0]; s.ru = fix[1]; }
      // новые предложения из документа ещё никто не вычитывал
      s.checked = fix !== undefined || s.origin === 'pdf';
      const meta = META ? META[s.id] : null;
      if (meta) { s.level = meta[0]; s.topic = meta[1]; }
      else Object.assign(s, AzGrammar.classify(s.az));
      if (!sents.has(s.id)) sents.set(s.id, s);
    }
    SENTS = [...sents.values()];
    sById = new Map(SENTS.map((s) => [s.id, s]));
    LEX = AzGrammar.buildLexicon(SENTS, ALL);
    EX_INDEX = null;
    exCache.clear();
    refreshActive();
  }

  function refreshActive() {
    ACTIVE = ALL.filter((c) => !S.hidden[c.id] &&
      (S.settings.includeEn || c.lang === 'ru') &&
      (S.settings.includePdf || c.origin !== 'pdf'));
    SACTIVE = SENTS.filter((s) => !S.shidden[s.id] && (S.settings.includePdf || s.origin !== 'pdf'));
  }

  // Новые слова (которых раньше не было ни в одном источнике) идут в тренировку первыми
  function markKnown() {
    const now = Date.now();
    let added = 0;
    if (!S.knownInit) {
      // первое знакомство с источниками; у тех, кто уже занимался, слова из PDF считаем новыми
      const veteran = S.lastSync > 0;
      for (const c of ALL) {
        S.known[c.id] = 1;
        if (veteran && c.origin === 'pdf') { S.discovered[c.id] = now; added++; }
      }
      S.knownInit = true;
    } else {
      for (const c of ALL) {
        if (S.known[c.id]) continue;
        S.known[c.id] = 1;
        S.discovered[c.id] = now;
        added++;
      }
    }
    save();
    return added;
  }

  function statusOf(item, store) {
    const p = store[item.id];
    if (!p) return 'new';
    return p.b >= LEARNED_BOX ? 'learned' : 'learning';
  }

  // сколько новых начато сегодня — в пределах набора (у каждого уровня предложений свой лимит)
  function newToday(store, list) {
    const t = today();
    let n = 0;
    if (list) { for (const c of list) if (store[c.id] && store[c.id].f === t) n++; }
    else { for (const id in store) if (store[id].f === t) n++; }
    return n;
  }

  function countsFor(list, store, perDay) {
    const t = today();
    let due = 0, fresh = 0, learning = 0, learned = 0;
    for (const c of list) {
      const p = store[c.id];
      if (!p) { fresh++; continue; }
      if (p.d <= t) due++;
      if (p.b >= LEARNED_BOX) learned++; else learning++;
    }
    const newLeft = Math.min(fresh, Math.max(0, perDay - newToday(store, list)));
    return { due, fresh, learning, learned, newLeft, total: list.length };
  }

  const counts = () => countsFor(ACTIVE, S.progress, S.settings.newPerDay);
  const sentCounts = () => countsFor(sentPool(), S.sprogress, S.settings.sentPerDay);

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

  // строчные буквы без диакритики; длина строки сохраняется (нужно для подсветки найденного)
  function fold(s) {
    return AzParser.azLower(s)
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

  /* ---------- источники ---------- */

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

  // Распознанный рукописный конспект лежит рядом с приложением и кешируется вместе с ним
  async function loadPdf() {
    try {
      const res = await fetch(PDF_URL);
      if (res.ok) pdfText = await res.text();
    } catch (e) { /* без PDF работаем только с документом */ }
  }

  async function loadMeta() {
    try {
      const res = await fetch(META_URL);
      if (res.ok) META = await res.json();
    } catch (e) { /* без разметки уровень и тема определяются по окончаниям */ }
  }

  async function loadExamples() {
    try {
      const res = await fetch(EXAMPLES_URL);
      if (res.ok) EXAMPLES = await res.json();
    } catch (e) { /* примеры будут только из конспекта */ }
  }

  async function loadFixes() {
    try {
      const res = await fetch(FIXES_URL);
      if (res.ok) FIXES = await res.json();
    } catch (e) { /* без исправлений предложения берутся как есть */ }
  }

  let syncing = false;
  let syncError = '';

  function applyDocText(text) {
    const hadDoc = !!docText;
    docText = text;
    try { localStorage.setItem(KEY_DOC, text); } catch (e) { /* текст документа просто не закешируется */ }
    rebuild();
    const added = markKnown();
    S.lastSync = Date.now();
    S.lastAdded = hadDoc ? added : 0;
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
      syncError = '';
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

  /* ---------- общая логика повторения ---------- */

  let view = 'home';
  let session = null;
  let q = null;
  let wordsUi = { tab: 'words', query: '', filter: 'all', topic: 'all', limit: 150 };

  function orderNew(list) {
    const o = S.settings.order;
    if (o === 'random') return shuffle(list.slice());
    if (o === 'doc') return list.slice().sort((a, b) => (a.origin === b.origin ? a.line - b.line : a.origin === 'doc' ? -1 : 1));
    return list.slice().sort((a, b) => (S.discovered[b.id] || 0) - (S.discovered[a.id] || 0) || b.line - a.line);
  }

  function buildQueueFor(list, store, perDay, max, extraNew, arrange) {
    const t = today();
    const due = list
      .filter((c) => { const p = store[c.id]; return p && p.d <= t; })
      .sort((a, b) => store[a.id].d - store[b.id].d || store[a.id].b - store[b.id].b);
    const quota = extraNew != null ? extraNew : Math.max(0, perDay - newToday(store, list));
    const unseen = orderNew(list.filter((c) => !store[c.id]));
    const fresh = (arrange ? arrange(unseen) : unseen).slice(0, quota);
    const reviews = due.slice(0, Math.max(Math.ceil(max / 4), max - fresh.length));
    // новые равномерно между повторениями
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

  const buildQueue = (extraNew) => buildQueueFor(ACTIVE, S.progress, S.settings.newPerDay, SESSION_MAX, extraNew);
  // Каждое предложение размечено уровнем (1–3) и грамматической темой;
  // тренировка берёт только предложения выбранного уровня и темы
  const SENT_LEVELS = {
    easy: { label: 'Лёгкий', n: 1 },
    medium: { label: 'Средний', n: 2 },
    hard: { label: 'Сложный', n: 3 },
  };
  const LEVEL_BY_N = { 1: 'easy', 2: 'medium', 3: 'hard' };
  const sentLevel = () => SENT_LEVELS[S.settings.sentLevel] ? S.settings.sentLevel : 'medium';
  const sentTopic = () => AzGrammar.TOPICS[S.settings.sentTopic] ? S.settings.sentTopic : 'all';
  function sentPool(level, topic) {
    const n = SENT_LEVELS[level || sentLevel()].n;
    const tp = topic || sentTopic();
    return SACTIVE.filter((s) => s.level === n && (tp === 'all' || s.topic === tp));
  }
  // при «Все темы» новые предложения чередуются по темам, чтобы сессия не была на одно правило
  function mixTopics(list) {
    if (sentTopic() !== 'all') return list;
    const groups = new Map();
    for (const s of list) {
      if (!groups.has(s.topic)) groups.set(s.topic, []);
      groups.get(s.topic).push(s);
    }
    const queues = shuffle([...groups.values()]);
    const out = [];
    while (queues.some((g) => g.length)) for (const g of queues) if (g.length) out.push(g.shift());
    return out;
  }
  const buildSentQueue = (extraNew) => buildQueueFor(sentPool(), S.sprogress, S.settings.sentPerDay, SENT_SESSION_MAX, extraNew, mixTopics);

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

  function startSession(queue, kind, mode) {
    if (!queue.length) { toast(kind === 'sent' ? 'Нет предложений для тренировки' : 'Нет слов для тренировки'); return; }
    session = { kind, queue, idx: 0, answered: 0, correct: 0, failed: new Set(), requeued: {}, newIds: new Set(), mode: mode || 'daily' };
    view = 'quiz';
    window.scrollTo(0, 0);
    nextQuestion();
  }

  function gradeItem(store, id, ok) {
    const t = today();
    let p = store[id];
    const isNew = !p;
    if (!p) p = store[id] = { b: 0, d: t, s: 0, c: 0, w: 0, f: t, l: t };
    p.s++;
    p.l = t;
    if (ok) {
      p.c++;
      if (!session.failed.has(id)) {
        // сразу справился с новым — скорее всего, уже знаком
        p.b = isNew ? 2 : Math.min(MAX_BOX, p.b + 1);
        p.d = t + INTERVALS[p.b];
      }
    } else {
      p.w++;
      p.b = p.b >= LEARNED_BOX ? 2 : 1;
      p.d = t + 1;
      session.failed.add(id);
      // вернуть через несколько карточек, не больше двух раз за сессию
      const n = session.requeued[id] || 0;
      if (n < 2) {
        session.requeued[id] = n + 1;
        const pos = Math.min(session.queue.length, session.idx + 3 + Math.floor(Math.random() * 3));
        session.queue.splice(pos, 0, id);
      }
    }
    if (isNew) session.newIds.add(id);
    const ds = S.days[t] || (S.days[t] = { a: 0, c: 0 });
    ds.a++;
    if (ok) ds.c++;
    session.answered++;
    if (ok) session.correct++;
    save();
  }

  function nextQuestion() {
    const lookup = session.kind === 'sent' ? sById : byId;
    while (session.idx < session.queue.length && !lookup.get(session.queue[session.idx])) session.idx++;
    if (session.idx >= session.queue.length) { view = 'summary'; q = null; render(); return; }
    if (session.kind === 'sent') nextSentence(); else nextWord();
    render();
  }

  function advance() {
    if (!q) return;
    if (q.kind === 'word' && q.picked === null) return;
    if (q.kind === 'sent' && !q.result) return;
    session.idx++;
    nextQuestion();
  }

  /* ---------- слова ---------- */

  function chooseDir(level) {
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

  function nextWord() {
    const card = byId.get(session.queue[session.idx]);
    const p = S.progress[card.id];
    const level = session.failed.has(card.id) ? 0 : (p ? p.b : 0);
    const dir = chooseDir(level);
    const options = shuffle([card].concat(pickDistractors(card, dir, level))).map((c) => ({ id: c.id, correct: c.id === card.id }));
    q = { kind: 'word', card, dir, options, picked: null, isNew: !p };
  }

  function optionText(o) {
    const c = byId.get(o.id);
    return q.dir === 'fwd' ? c.gloss : c.az;
  }

  function answer(i) {
    if (!q || q.kind !== 'word' || q.picked !== null) return;
    q.picked = i;
    const ok = i >= 0 && q.options[i].correct;
    gradeItem(S.progress, q.card.id, ok);
    if (!ok && navigator.vibrate) navigator.vibrate(60);
    render();
  }

  /* ---------- предложения ---------- */

  function nextSentence() {
    const sent = sById.get(session.queue[session.idx]);
    const p = S.sprogress[sent.id];
    const level = sentLevel();
    q = { kind: 'sent', sent, level, task: AzGrammar.makeTask(sent, level, LEX), chosen: [], result: null, isNew: !p };
  }

  function addTile(id) {
    if (!q || q.kind !== 'sent' || q.result || q.chosen.includes(id)) return;
    q.chosen.push(id);
    render();
  }

  function removeTile(pos) {
    if (!q || q.kind !== 'sent' || q.result) return;
    q.chosen.splice(pos, 1);
    render();
  }

  function checkSentence(giveUp) {
    if (!q || q.kind !== 'sent' || q.result) return;
    if (!giveUp && !q.chosen.length) return;
    const keys = q.chosen.map((id) => q.task.tiles[id].key);
    q.result = giveUp ? { ok: false, gaveUp: true } : AzGrammar.check(keys, q.task.answer, q.level === 'hard');
    gradeItem(S.sprogress, q.sent.id, q.result.ok);
    if (!q.result.ok && navigator.vibrate) navigator.vibrate(60);
    render();
  }

  function updateBadge() {
    if (!('setAppBadge' in navigator)) return;
    const c = counts(), s = sentCounts();
    const n = c.due + c.newLeft + s.due + s.newLeft;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }

  /* ---------- примеры употребления ---------- */

  // окончания существительных: множественное число, принадлежность, падеж (qonşu → qonşularımızdan)
  const NOUN_REST = /^(lar|lər)?(ım|im|um|üm|m|ın|in|un|ün|n|ı|i|u|ü|sı|si|su|sü|ımız|imiz|umuz|ümüz|mız|miz|muz|müz|ınız|iniz|unuz|ünüz|nız|niz|nuz|nüz|ları|ləri)?(n)?(da|də|dan|dən|a|ə|ya|yə|na|nə|ı|i|u|ü|nı|ni|nu|nü|ın|in|un|ün|nın|nin|nun|nün|la|lə|dır|dir|dur|dür)?$/;
  // окончания глагола после основы (tələs → tələsir, tələsmə, tələsdi, tələsəcək…)
  const VERB_REST = /^(y?[ıiuü]r|m[aə]|m[ıiuü]r|d[ıiuü]|t[ıiuü]|y?[aə]c[aə][kqğy]|[aə]r|y?[ıiuü]b|y?[aə]r[aə]k|y?[aə]n|d[ıiuü][kqğy]|m[ıiuü]ş|s[aə]|y?[ıiuü]n|y?[aə]k|y?[aə]q|y?[aə]$|y?[ıiuü]m|y?[ıiuü]z)/;
  let EX_INDEX = null;
  const exCache = new Map();

  // слово → вычитанные предложения, где оно встречается
  function exampleIndex() {
    if (EX_INDEX) return EX_INDEX;
    const byToken = new Map();
    for (const s of SENTS) {
      if (!s.checked || S.shidden[s.id]) continue;
      for (const t of new Set(AzGrammar.tokens(s.az).map((x) => AzParser.azLower(x)))) {
        if (!byToken.has(t)) byToken.set(t, []);
        byToken.get(t).push(s);
      }
    }
    EX_INDEX = { byToken, tokens: [...byToken.keys()] };
    return EX_INDEX;
  }

  // форма слова в предложении: «tələsmək» → «tələsir», «qonşu» → «qonşumuz».
  // Короткие слова — только целиком, чтобы «il» не находилось в «ilə».
  function formMatches(t, w) {
    if (t === w) return true;
    if (/(maq|mək)$/.test(w)) {
      const stem = w.slice(0, -3);
      return stem.length >= 3 && t.startsWith(stem) && VERB_REST.test(t.slice(stem.length));
    }
    return w.length >= 4 && t.startsWith(w) && NOUN_REST.test(t.slice(w.length));
  }

  function sentenceExample(card) {
    const idx = exampleIndex();
    let best = null;
    for (const alt of card.az.split(/\s*[\/=,;]\s*/)) {
      const words = AzParser.azLower(alt.replace(/\([^)]*\)/g, '')).trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const last = words[words.length - 1];
      const head = words.slice(0, -1);
      for (const t of idx.tokens) {
        if (!formMatches(t, last)) continue;
        for (const s of idx.byToken.get(t)) {
          const toks = AzGrammar.tokens(s.az).map((x) => AzParser.azLower(x));
          if (head.length) {
            // во фразе «qəbul etmək» все слова, кроме последнего, должны стоять перед ним как есть
            const i = toks.indexOf(t);
            if (i < head.length || !head.every((w, j) => toks[i - head.length + j] === w)) continue;
          }
          const score = Math.abs(toks.length - 6) + (s.ru.length > 70 ? 3 : 0);
          if (!best || score < best.score) best = { az: s.az, ru: s.ru, form: head.concat(t).join(' '), score };
        }
      }
    }
    return best;
  }

  /*
   * Пример для слова:
   *   1) проверенный пример из data/examples.json (предложение из конспекта или написанное заново);
   *   2) для слов, появившихся позже, — вычитанное предложение конспекта с этим словом;
   *   3) пример из той же строки конспекта, без перевода.
   */
  function exampleFor(card) {
    if (exCache.has(card.id)) return exCache.get(card.id);
    let ex = null;
    const g = EXAMPLES ? EXAMPLES[card.az] : undefined;
    if (Array.isArray(g)) ex = { az: g[0], ru: g[1], form: g[2] || '' };
    else if (g === undefined) ex = sentenceExample(card);
    if (!ex && card.examples.length) ex = { az: card.examples[0], ru: '', form: '' };
    exCache.set(card.id, ex);
    return ex;
  }

  function markForm(text, form) {
    if (!form) return esc(text);
    const at = AzParser.azLower(text).indexOf(AzParser.azLower(form));
    if (at < 0) return esc(text);
    return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + form.length)) + '</mark>' + esc(text.slice(at + form.length));
  }

  /* ---------- поиск перевода в источниках ---------- */

  function sources() {
    const out = [];
    if (docText) out.push({ name: 'Google Docs', text: docText, pdf: false });
    if (pdfText) out.push({ name: 'PDF-конспект', text: pdfText, pdf: true });
    return out;
  }

  // «tələsmək» ищем по основе «tələs», чтобы найти и «tələsir», и «tələsmə»
  function azAlts(az) {
    return az.split(/\s*[\/=,;]\s*/).map((a) => fold(a.replace(/\([^)]*\)/g, '')).trim()).filter(Boolean);
  }

  // Ключи поиска. У глаголов ищем по основе, у остальных слов — целиком
  function searchKeys(card) {
    const keys = new Map();
    for (const k of azAlts(card.az)) {
      const stem = k.replace(/(maq|mek)$/, '');
      if (stem !== k && stem.length >= 4) keys.set(stem, true);
      else if (k.length >= 2) keys.set(k, false);
    }
    return [...keys].map(([k, stem]) => ({ k, stem }));
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function searchSources(card) {
    const keys = searchKeys(card);
    const res = { hits: [], cands: [] };
    if (!keys.length) return res;
    const re = new RegExp('(^|[^a-zа-я0-9])(' + keys.map((x) => escRe(x.k)).join('|') + ')', 'g');
    // в контексте показываем и формы слова, а переводы берём только у самого слова
    const keyMatch = (az) => azAlts(az).some((f) => keys.some((x) => f === x.k || (x.stem && f.startsWith(x.k) && /^(mek|maq)$/.test(f.slice(x.k.length)))));
    const cur = new Set(splitMeanings(card.gloss).map(normM));
    const tally = new Map();
    const wantCyr = card.lang === 'ru';
    const addCand = (g, src) => {
      g = g.replace(/^[\s,.;:—–-]+|[\s,.;:—–-]+$/g, '').trim();
      if (!g || g.length > 60 || g.replace(/[^\p{L}]/gu, '').length < 3) return;
      const cyr = /[Ѐ-ӿ]/.test(g), lat = /[A-Za-z]/.test(g);
      if (wantCyr ? (!cyr || lat) : (!lat || cyr)) return;
      const k = normM(g);
      if (cur.has(k)) return;
      const t = tally.get(k) || { text: g, n: 0, src: new Set() };
      t.n++;
      t.src.add(src);
      tally.set(k, t);
    };

    for (const src of sources()) {
      const lines = src.text.split('\n');
      let page = '';
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const pm = /^#\s*p(\d+)/.exec(raw);
        if (pm) { page = String(+pm[1]); continue; }
        if (!raw.trim() || raw.length > 1500) continue;
        const f = fold(raw);
        re.lastIndex = 0;
        const m = re.exec(f);
        if (!m) continue;
        const pos = m.index + m[1].length;
        const found = [];

        // 1) пары «слово - перевод» в этой строке
        for (const c of AzParser.parse(raw.replace(/^\s*>.*$/, ''))) {
          if (keyMatch(c.az)) {
            found.push(c.gloss);
            for (const g of [c.gloss].concat(c.alts)) addCand(g, src.name);
          }
        }
        // само слово, а не однокоренное: «qonşu», но не «qonşuluqda»
        const word = (f.slice(pos).match(/^[a-zа-яё-]+/) || [''])[0];
        const exact = keyMatch(word);
        // 2) перевод в скобках сразу после слова: «hündür (высокий)»
        const after = raw.slice(pos).match(/^[^\s()]*\s*\(([^()]{1,40})\)/);
        if (exact && after) { found.push(after[1]); addCand(after[1], src.name); }
        // 3) столбики: слово на одной строке, перевод на соседней
        const short = (s, sc) => s && s.trim() && AzParser.util.wordCount(s) <= 4 && AzParser.util.script(s.trim()) === sc;
        if (exact && short(raw, 'l')) {
          for (const nb of [lines[i + 1], lines[i - 1]]) {
            if (short(nb, 'c')) { found.push(nb.trim()); addCand(nb.trim(), src.name); break; }
          }
        }
        // 4) предложение «> az | ru» из PDF — покажем как контекст
        let text = raw.trim().replace(/^>\s*/, '');
        let hl = pos - (raw.length - raw.trimStart().length) - (raw.trim().startsWith('>') ? raw.trim().match(/^>\s*/)[0].length : 0);
        let start = 0;
        if (text.length > 170) {
          start = Math.max(0, hl - 70);
          text = (start ? '…' : '') + text.slice(start, start + 170) + (start + 170 < text.length ? '…' : '');
          hl = hl - start + (start ? 1 : 0);
        }
        res.hits.push({
          src: src.name + (src.pdf && page ? `, стр. ${page}` : src.pdf ? '' : `, строка ${i + 1}`),
          text, hl, len: m[2].length, found: found.length,
        });
      }
    }
    res.hits.sort((a, b) => b.found - a.found);
    res.hits = res.hits.slice(0, 25);
    res.cands = [...tally.values()].sort((a, b) => b.n - a.n).slice(0, 10).map((t) => ({ text: t.text, n: t.n, src: [...t.src].join(', ') }));
    return res;
  }

  let sheet = null;

  function openFix(id) {
    const card = byId.get(id);
    if (!card) return;
    sheet = { card, res: searchSources(card), value: card.gloss };
    renderSheet();
  }

  function closeSheet() {
    sheet = null;
    $sheet.hidden = true;
    $sheet.innerHTML = '';
    document.body.classList.remove('sheet-open');
  }

  function setOverride(card, value) {
    value = (value || '').trim();
    if (!value || value === card.origGloss) delete S.overrides[card.id];
    else S.overrides[card.id] = value;
    save();
    patchOverride(card);
  }

  function highlight(text, at, len) {
    if (at < 0 || at >= text.length) return esc(text);
    let end = at + len;
    while (end < text.length && /[\p{L}-]/u.test(text[end])) end++;
    return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, end)) + '</mark>' + esc(text.slice(end));
  }

  function renderSheet() {
    if (!sheet) return;
    const c = sheet.card;
    const { hits, cands } = sheet.res;
    const hidden = !!S.hidden[c.id];
    $sheet.innerHTML = `
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Перевод слова">
        <div class="sheet-head">
          <div>
            <div class="muted small">Перевод слова</div>
            <h2 lang="az">${esc(c.az)}</h2>
          </div>
          <button class="icon" data-sact="close" aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="sheet-body">
          <div class="cur muted">Сейчас: <b>${esc(c.gloss)}</b>${c.edited ? ` <em class="chip">исправлено</em>` : ''}${c.edited && c.origGloss ? `<br>Было в конспекте: ${esc(c.origGloss)}` : ''}</div>
          <div class="sheet-sec">
            <h3>Варианты из конспекта</h3>
            ${cands.length
              ? `<div class="cands">${cands.map((x, i) => `<button class="cand" data-sact="cand" data-i="${i}">${esc(x.text)}${x.n > 1 ? ` <span class="muted">×${x.n}</span>` : ''}</button>`).join('')}</div>`
              : '<p class="muted small">Других переводов в документах не нашлось — можно вписать свой.</p>'}
          </div>
          <label class="field">
            <span>Правильный перевод</span>
            <input id="fixval" type="text" value="${esc(sheet.value)}" autocomplete="off" spellcheck="false">
          </label>
          <div class="row">
            <button class="btn primary" data-sact="save">Сохранить</button>
            ${c.edited ? '<button class="btn" data-sact="reset">Вернуть исходный</button>' : ''}
            <button class="btn ${hidden ? '' : 'danger'}" data-sact="hide">${hidden ? 'Вернуть в тренировку' : 'Скрыть карточку'}</button>
          </div>
          <div class="sheet-sec">
            <h3>Где встречается <span class="muted">${hits.length}</span></h3>
            ${hits.length
              ? `<ul class="hits">${hits.map((h) => `<li><div class="hit-src muted">${esc(h.src)}</div><div class="hit-text">${highlight(h.text, h.hl, h.len)}</div></li>`).join('')}</ul>`
              : '<p class="muted small">Слово не найдено в тексте источников.</p>'}
          </div>
        </div>
      </div>`;
    $sheet.hidden = false;
    document.body.classList.add('sheet-open');
  }

  function sheetAction(act, el) {
    if (!sheet) return;
    const c = sheet.card;
    const input = document.getElementById('fixval');
    if (input) sheet.value = input.value;
    if (act === 'close') { closeSheet(); render(); return; }
    if (act === 'cand') {
      sheet.value = sheet.res.cands[+el.dataset.i].text;
      renderSheet();
      const inp = document.getElementById('fixval');
      if (inp) inp.focus();
      return;
    }
    if (act === 'save') {
      setOverride(c, sheet.value);
      toast(S.overrides[c.id] ? 'Перевод исправлен' : 'Перевод как в конспекте');
      closeSheet();
      render();
      return;
    }
    if (act === 'reset') {
      setOverride(c, '');
      toast('Вернул перевод из конспекта');
      closeSheet();
      render();
      return;
    }
    if (act === 'hide') {
      const wasHidden = !!S.hidden[c.id];
      if (wasHidden) delete S.hidden[c.id]; else S.hidden[c.id] = true;
      save();
      refreshActive();
      closeSheet();
      if (!wasHidden && view === 'quiz' && q && q.kind === 'word' && q.card.id === c.id) {
        toast('Карточка скрыта. Вернуть можно в разделе «Слова».');
        if (q.picked === null) { q.picked = -2; }
        advance();
        return;
      }
      render();
    }
  }

  /* ---------- экраны ---------- */

  const ICONS = {
    home: '<svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/></svg>',
    words: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5zM8 9h8M8 13h8M8 17h5"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    hide: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12a14 14 0 0 1-3 3.7M6.6 6.6A14 14 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/></svg>',
    unhide: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6"/></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.2-4 2.5-5 .2 2 1 3 2 3.5C11 9 11 5 12 2z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  function tabbar(active) {
    const tab = (id, label) =>
      `<button class="tab ${active === id ? 'on' : ''}" data-act="go" data-view="${id}" aria-label="${label}">${ICONS[id]}<span>${label}</span></button>`;
    return `<nav class="tabbar">${tab('home', 'Сегодня')}${tab('words', 'Слова')}${tab('settings', 'Настройки')}</nav>`;
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
    const sc = sentCounts();
    const st = streak();
    const td = dayStat(today());
    const goal = S.settings.dailyGoal;
    const pct = Math.min(100, Math.round((td.a / goal) * 100));
    const planned = Math.min(c.due, SESSION_MAX) + c.newLeft;
    const sPlanned = Math.min(sc.due, SENT_SESSION_MAX) + sc.newLeft;
    let main;
    if (!ALL.length) {
      main = `<div class="card hero"><h2>Слов пока нет</h2><p class="muted">${syncError ? esc(syncError) : 'Загрузите документ, чтобы начать.'}</p>
        <button class="btn primary" data-act="sync">Загрузить из Google Docs</button></div>`;
    } else if (planned > 0) {
      main = `<div class="card hero">
        <div class="hero-title">Слова</div>
        <div class="hero-nums">
          <div><b>${c.due}</b><span>${plural(c.due, 'повторение', 'повторения', 'повторений')}</span></div>
          <div><b>${c.newLeft}</b><span>${plural(c.newLeft, 'новое слово', 'новых слова', 'новых слов')}</span></div>
        </div>
        <button class="btn primary big" data-act="start">Начать тренировку</button>
      </div>`;
    } else {
      main = `<div class="card hero done">
        <div class="hero-title">Слова</div>
        <h2>На сегодня всё</h2>
        <p class="muted">Все повторения сделаны. Следующие слова появятся завтра.</p>
        <div class="row">
          ${c.fresh ? '<button class="btn primary" data-act="more">Ещё 10 новых</button>' : ''}
          ${buildHardQueue().length ? '<button class="btn" data-act="hard">Трудные слова</button>' : ''}
        </div>
      </div>`;
    }
    let sent = '';
    if (SACTIVE.length) {
      const lvl = sentLevel();
      sent = `<section class="card hero sent-card">
        <div class="hero-title">Предложения <span class="muted">· соберите фразу из слов</span></div>
        ${seg('sentLevel', lvl, Object.entries(SENT_LEVELS).map(([k, v]) => [k, `${v.label} <span class="seg-n">${sentPool(k, 'all').length}</span>`]))}
        <p class="muted small level-hint">${{
          easy: 'Простые фразы в одно действие, 2–3 лишних слова, видно число слов.',
          medium: '«Нужно», «можно», просьбы, «ki». Лишних около половины, многие похожи.',
          hard: 'Причастия, условия, деепричастия. Лишних столько же, сколько нужных. Порядок — только точный.',
        }[lvl]}</p>
        ${topicSelect(lvl)}
        ${sPlanned > 0
          ? `<div class="hero-line"><span><b>${sc.due}</b> ${plural(sc.due, 'повторение', 'повторения', 'повторений')}</span><span><b>${sc.newLeft}</b> ${plural(sc.newLeft, 'новое', 'новых', 'новых')}</span></div>
             <button class="btn primary big" data-act="start-sent">Собрать предложения</button>`
          : `<p class="muted">${sc.total ? 'На сегодня всё.' : 'В этой теме на этом уровне предложений нет.'}</p>
             ${sc.fresh ? '<div class="row"><button class="btn" data-act="more-sent">Ещё 5 предложений</button></div>' : ''}`}
      </section>`;
    }
    $app.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">ə</span><div><h1>Söz</h1><p>азербайджанские слова</p></div></div>
        <div class="streak ${st.todayDone ? 'lit' : ''}" title="Дней подряд с выполненной целью">${ICONS.flame}<b>${st.n}</b></div>
      </header>
      <section class="card goal">
        <div class="goal-head"><span>Цель на сегодня</span><b>${td.a} / ${goal}</b></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="week">${weekDots()}</div>
      </section>
      ${main}
      ${sent}
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
        <button class="btn small ${syncing ? 'spin' : ''}" data-act="sync" ${syncing ? 'disabled' : ''} aria-label="Обновить слова из документа">${ICONS.sync}Обновить</button>
      </section>
      ${tabbar('home')}`;
  }

  function quizTop() {
    const done = session.idx;
    const total = session.queue.length;
    return `<header class="quiz-top">
      <button class="icon" data-act="quit" aria-label="Закончить">${ICONS.close}</button>
      <div class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div>
      <span class="count">${Math.min(done + 1, total)}/${total}</span>
    </header>`;
  }

  function renderQuiz() {
    if (q.kind === 'sent') return renderSentence();
    const card = q.card;
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
        <kbd>${i + 1}</kbd><span>${esc(optionText(o))}</span></button>`;
    }).join('');

    let fb = '';
    if (answered) {
      const wrongPick = !ok && q.picked >= 0 ? byId.get(q.options[q.picked].id) : null;
      fb = `<div class="feedback ${ok ? 'ok' : 'bad'}" role="status">
        <div class="fb-title">${ok ? 'Верно' : q.picked < 0 ? 'Запомните' : 'Неверно'}</div>
        <div class="fb-pair"><b lang="az">${esc(card.az)}</b> — ${esc(card.gloss)}${card.edited ? ' <em class="chip">исправлено</em>' : ''}</div>
        ${card.alts.length ? `<div class="fb-line"><span class="muted">ещё:</span> ${esc(card.alts.join(', '))}</div>` : ''}
        ${card.notes.length ? `<div class="fb-line"><span class="muted">заметка:</span> ${esc(card.notes.join('; '))}</div>` : ''}
        ${(() => {
          const ex = exampleFor(card);
          if (!ex) return '';
          return `<div class="fb-ex"><div class="fb-ex-label">Пример</div><div lang="az">${markForm(ex.az, ex.form || card.az)}</div>${ex.ru ? `<div class="fb-ex-ru">${esc(ex.ru)}</div>` : ''}</div>`;
        })()}
        ${wrongPick ? `<div class="fb-line wrong-pick"><span class="muted">вы выбрали:</span> <b lang="az">${esc(wrongPick.az)}</b> — ${esc(wrongPick.gloss)}</div>` : ''}
        <div class="fb-actions">
          <button class="link" data-act="fix" title="Найти правильный перевод в конспекте">Неверный перевод?</button>
          <button class="btn primary" data-act="next">Дальше</button>
        </div>
      </div>`;
    }

    $app.innerHTML = `
      <div class="quiz">
        ${quizTop()}
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

  function renderSentence() {
    const { sent, task, chosen, result } = q;
    const chosenSet = new Set(chosen);
    let answerTiles;
    if (result) {
      answerTiles = chosen.map((id, i) => {
        const t = task.tiles[id];
        const cls = t.key === task.answer[i] ? 'good' : task.answer.includes(t.key) ? 'moved' : 'bad';
        return `<span class="tile ${result.ok && result.exact ? 'good' : cls}" lang="az">${esc(t.text)}</span>`;
      }).join('');
    } else {
      answerTiles = chosen.map((id, i) => `<button class="tile" data-act="untile" data-pos="${i}" lang="az">${esc(task.tiles[id].text)}</button>`).join('');
      // на лёгком уровне видно, сколько слов в предложении
      if (q.level === 'easy') {
        for (let i = chosen.length; i < task.answer.length; i++) answerTiles += '<span class="slot" aria-hidden="true"></span>';
      }
    }
    const bank = task.tiles.map((t) => chosenSet.has(t.id)
      ? `<span class="tile ghost" aria-hidden="true">${esc(t.text)}</span>`
      : `<button class="tile" data-act="tile" data-id="${t.id}" lang="az" ${result ? 'disabled' : ''}>${esc(t.text)}</button>`).join('');

    let fb = '';
    if (result) {
      const title = result.ok
        ? (result.exact ? 'Верно' : 'Верно, но в оригинале порядок другой')
        : result.gaveUp ? 'Запомните' : result.order ? 'Слова верные, но порядок неправильный' : 'Неверно';
      fb = `<div class="feedback ${result.ok ? 'ok' : 'bad'}" role="status">
        <div class="fb-title">${title}</div>
        <div class="fb-pair" lang="az"><b>${esc(sent.az)}</b></div>
        <div class="fb-line muted">${esc(sent.ru)}</div>
        ${sent.checked ? '' : '<div class="fb-line"><em class="chip" title="Новое предложение из документа, его ещё не вычитывали">не проверено</em></div>'}
        <div class="fb-actions">
          <button class="link" data-act="hide-sent" title="Если предложение распознано с ошибкой">Ошибка в предложении?</button>
          <button class="btn primary" data-act="next">Дальше</button>
        </div>
      </div>`;
    }

    $app.innerHTML = `
      <div class="quiz">
        ${quizTop()}
        <div class="prompt sent-prompt">
          <div class="label">Соберите по-азербайджански</div>
          <div class="label chips-line"><em class="chip lvl-${q.level}">${SENT_LEVELS[q.level].label.toLowerCase()}</em> <em class="chip topic">${esc(AzGrammar.TOPICS[sent.topic] || '')}</em>${q.isNew ? ' <em class="chip new">новое</em>' : ''}</div>
          <div class="word sent">${esc(sent.ru)}</div>
        </div>
        <div class="answer-zone ${result ? (result.ok ? 'ok' : 'bad') : ''}">${answerTiles || '<span class="placeholder muted">Нажимайте на слова по порядку</span>'}</div>
        <div class="bank">${bank}</div>
        ${result ? fb : `<div class="sent-actions">
          <button class="link" data-act="idk-sent">Не знаю</button>
          ${chosen.length ? '<button class="link" data-act="clear-sent">Сбросить</button>' : ''}
          <button class="btn primary" data-act="check" ${chosen.length ? '' : 'disabled'}>Проверить</button>
        </div>`}
      </div>`;
    const btn = $app.querySelector('.feedback .btn.primary');
    if (btn) btn.focus({ preventScroll: true });
  }

  function renderSummary() {
    const pct = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
    const isSent = session.kind === 'sent';
    const c = counts();
    const st = streak();
    const more = (isSent ? buildSentQueue() : buildQueue()).length;
    const left = Math.max(0, S.settings.dailyGoal - dayStat(today()).a);
    $app.innerHTML = `
      <div class="summary">
        <div class="big-check">${ICONS.check}</div>
        <h2>Тренировка завершена</h2>
        <div class="stats">
          <div><b>${session.answered}</b><span>${plural(session.answered, 'ответ', 'ответа', 'ответов')}</span></div>
          <div><b>${pct}%</b><span>верно</span></div>
          <div><b>${session.newIds.size}</b><span>новых</span></div>
        </div>
        <p class="muted">${st.todayDone ? `Цель дня выполнена. Серия: ${st.n} ${plural(st.n, 'день', 'дня', 'дней')}.` : `До цели дня: ${left} ${plural(left, 'ответ', 'ответа', 'ответов')}.`}
        Выучено слов: ${c.learned}.</p>
        <div class="col">
          ${more ? `<button class="btn primary big" data-act="${isSent ? 'start-sent' : 'start'}">Продолжить</button>` : ''}
          <button class="btn ${more ? '' : 'primary big'}" data-act="go" data-view="home">На главную</button>
        </div>
      </div>`;
  }

  function renderWords() {
    const isSent = wordsUi.tab === 'sents';
    const fq = fold(wordsUi.query.trim());
    const f = wordsUi.filter;
    const t = today();
    const store = isSent ? S.sprogress : S.progress;
    const hiddenMap = isSent ? S.shidden : S.hidden;
    const src = isSent ? SENTS : ALL;
    let list = src.filter((c) => {
      if (f === 'hidden') { if (!hiddenMap[c.id]) return false; }
      else {
        if (hiddenMap[c.id]) return false;
        if (!isSent && !S.settings.includeEn && c.lang === 'en') return false;
        if (!S.settings.includePdf && c.origin === 'pdf') return false;
        if (f === 'edited') { if (isSent || !c.edited) return false; }
        else if (/^l[123]$/.test(f)) { if (c.level !== +f[1]) return false; }
        else if (f !== 'all' && statusOf(c, store) !== f) return false;
      }
      if (isSent && wordsUi.topic && wordsUi.topic !== 'all' && c.topic !== wordsUi.topic) return false;
      if (fq) {
        const hay = isSent ? [c.az, c.ru] : [c.az, c.gloss].concat(c.alts);
        if (!hay.some((h) => fold(h).includes(fq))) return false;
      }
      return true;
    });
    if (!isSent) list.sort((a, b) => a.az.localeCompare(b.az, 'az'));
    const total = list.length;
    const shown = list.slice(0, wordsUi.limit);
    const chip = (id, label) => `<button class="chip-btn ${f === id ? 'on' : ''}" data-act="wfilter" data-f="${id}">${label}</button>`;
    const rows = shown.map((c) => {
      const hidden = !!hiddenMap[c.id];
      const st = hidden ? 'hidden' : statusOf(c, store);
      const p = store[c.id];
      const dueTxt = p ? (p.d <= t ? 'сегодня' : `через ${p.d - t} дн.`) : '';
      const main = isSent
        ? `<b lang="az">${esc(c.az)}</b><span>${esc(c.ru)}</span>
           <span class="tags"><em class="chip lvl-${LEVEL_BY_N[c.level]}">${SENT_LEVELS[LEVEL_BY_N[c.level]].label.toLowerCase()}</em> <em class="chip topic">${esc(AzGrammar.TOPICS[c.topic] || '')}</em></span>`
        : `<b lang="az">${esc(c.az)}</b><span>${esc(c.gloss)}${c.lang === 'en' ? ' <em class="chip">EN</em>' : ''}${c.origin === 'pdf' ? ' <em class="chip">PDF</em>' : ''}${c.edited ? ' <em class="chip new">исправлено</em>' : ''}</span>`;
      return `<li class="w ${st} ${isSent ? 'sentence' : ''}" ${isSent ? '' : `data-act="card" data-id="${c.id}"`}>
        <i class="st"></i>
        <div class="w-main">${main}</div>
        <span class="w-due">${dueTxt}</span>
        <button class="icon" data-act="${isSent ? 'toggle-shide' : 'toggle-hide'}" data-id="${c.id}" aria-label="${hidden ? 'Вернуть' : 'Скрыть'}">${hidden ? ICONS.unhide : ICONS.hide}</button>
      </li>`;
    }).join('');
    $app.innerHTML = `
      <header class="top"><h1 class="page">${isSent ? 'Предложения' : 'Слова'} <span class="muted">${src.length}</span></h1></header>
      <div class="seg top-seg">
        <button class="${isSent ? '' : 'on'}" data-act="wtab" data-tab="words">Слова</button>
        <button class="${isSent ? 'on' : ''}" data-act="wtab" data-tab="sents">Предложения</button>
      </div>
      <div class="search">
        <input type="search" id="wq" placeholder="${isSent ? 'Поиск по предложениям…' : 'Поиск: söz, слово…'}" value="${esc(wordsUi.query)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="chips">${isSent
        ? chip('all', 'Все') + chip('l1', 'Лёгкие') + chip('l2', 'Средние') + chip('l3', 'Сложные') + chip('hidden', 'Скрытые')
        : chip('all', 'Все') + chip('new', 'Новые') + chip('learning', 'Изучаю') + chip('learned', 'Выучено') + chip('edited', 'Исправленные') + chip('hidden', 'Скрытые')}</div>
      ${isSent ? `<div class="list-topic">${topicSelect(null, 'wtopic')}</div>` : ''}
      ${isSent ? `<p class="muted small list-count">Показано: ${total}</p>` : ''}
      <ul class="wlist">${rows || '<li class="empty muted">Ничего не найдено</li>'}</ul>
      ${total > shown.length ? `<button class="btn wide" data-act="wmore">Показать ещё (${total - shown.length})</button>` : ''}
      <p class="hint muted">${isSent
        ? 'Предложения берутся из пар «русское — азербайджанское» в конспекте. Неудачные можно скрыть.'
        : 'Нажмите на слово, чтобы найти другой перевод в конспекте, исправить его или скрыть карточку.'}</p>
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

  // выбор грамматической темы; в списке — темы, которые есть на этом уровне, с количеством
  function topicSelect(level, act) {
    const pool = level ? sentPool(level, 'all') : SACTIVE;
    const cnt = {};
    for (const s of pool) cnt[s.topic] = (cnt[s.topic] || 0) + 1;
    const cur = act === 'wtopic' ? wordsUi.topic || 'all' : sentTopic();
    const opts = [`<option value="all">Все темы (${pool.length})</option>`].concat(
      Object.entries(AzGrammar.TOPICS)
        .filter(([k]) => cnt[k] || k === cur)
        .map(([k, label]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(label)} (${cnt[k] || 0})</option>`));
    return `<label class="topic-pick"><span>Тема</span><select data-act="${act || 'set-topic'}">${opts.join('')}</select></label>`;
  }

  function seg(name, value, options) {
    return `<div class="seg" role="radiogroup">${options.map(([v, label]) =>
      `<button role="radio" aria-checked="${String(value) === String(v)}" class="${String(value) === String(v) ? 'on' : ''}" data-act="set" data-k="${name}" data-v="${v}">${label}</button>`).join('')}</div>`;
  }

  function renderSettings() {
    const s = S.settings;
    const pdfWords = ALL.filter((c) => c.origin === 'pdf' || c.inPdf).length;
    $app.innerHTML = `
      <header class="top"><h1 class="page">Настройки</h1></header>
      <section class="card form">
        <label class="field">
          <span>Документ Google Docs</span>
          <input id="doc" type="url" value="https://docs.google.com/document/d/${esc(s.docId)}/edit" autocomplete="off" spellcheck="false">
          <small class="muted">Доступ по ссылке должен быть открыт. Слова подтягиваются автоматически при запуске и по кнопке «Обновить».</small>
        </label>
        <div class="row"><button class="btn" data-act="save-doc">Сохранить и загрузить</button></div>
        <label class="toggle"><span>Слова из PDF-конспекта <span class="muted">(${pdfWords})</span></span><input type="checkbox" data-act="toggle" data-k="includePdf" ${s.includePdf ? 'checked' : ''}></label>
        <small class="muted">Рукописный «Az lessons.pdf» распознан один раз и встроен в приложение. Появятся новые страницы — его нужно распознать заново.</small>
      </section>

      <section class="card form">
        <div class="field"><span>Новых слов в день</span>${seg('newPerDay', s.newPerDay, [[5, '5'], [10, '10'], [15, '15'], [20, '20'], [30, '30']])}</div>
        <div class="field"><span>Новых предложений в день</span>${seg('sentPerDay', s.sentPerDay, [[3, '3'], [5, '5'], [8, '8'], [10, '10']])}</div>
        <div class="field"><span>Сложность предложений</span>${seg('sentLevel', sentLevel(), Object.entries(SENT_LEVELS).map(([k, v]) => [k, v.label]))}</div>
        <div class="field"><span>Цель на день (ответов)</span>${seg('dailyGoal', s.dailyGoal, [[10, '10'], [20, '20'], [30, '30'], [50, '50']])}</div>
        <div class="field"><span>Направление</span>${seg('direction', s.direction, [['auto', 'Авто'], ['az', 'AZ→RU'], ['ru', 'RU→AZ'], ['mix', 'Микс']])}
          <small class="muted">«Авто»: новые слова — с азербайджанского, выученные — чаще в обратную сторону.</small></div>
        <div class="field"><span>Порядок новых слов</span>${seg('order', s.order, [['fresh', 'Сначала свежие'], ['doc', 'По документу'], ['random', 'Случайно']])}
          <small class="muted">«Сначала свежие» — слова, недавно добавленные в источники (или ближе к концу документа).</small></div>
        <label class="toggle"><span>Пары с английским переводом</span><input type="checkbox" data-act="toggle" data-k="includeEn" ${s.includeEn ? 'checked' : ''}></label>
        <label class="toggle"><span>Проверять документ при запуске</span><input type="checkbox" data-act="toggle" data-k="autoSync" ${s.autoSync ? 'checked' : ''}></label>
      </section>

      <section class="card form">
        <div class="field"><span>Резервная копия прогресса</span>
          <small class="muted">Включает исправленные переводы и скрытые карточки.</small>
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
      <p class="hint muted">Söz · слов: ${ALL.length} · предложений: ${SENTS.length} · парсер v${AzParser.PARSER_VERSION}</p>
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
    const data = JSON.stringify({ app: 'soz', version: 2, exportedAt: new Date().toISOString(), state: S });
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
      rebuild();
      toast('Прогресс восстановлен');
      render();
    } catch (e) {
      toast('Это не файл резервной копии Söz');
    }
  }

  /* ---------- действия ---------- */

  const ACTIONS = {
    go(el) { view = el.dataset.view; if (view === 'home') session = null; render(); window.scrollTo(0, 0); },
    start() { startSession(buildQueue(), 'word', 'daily'); },
    more() { startSession(buildQueue(10), 'word', 'extra'); },
    hard() { startSession(buildHardQueue(), 'word', 'hard'); },
    'start-sent'() { startSession(buildSentQueue(), 'sent', 'daily'); },
    'more-sent'() { startSession(buildSentQueue(5), 'sent', 'extra'); },
    sync() { sync({ silent: false }); },
    pick(el) { answer(+el.dataset.i); },
    idk() { answer(-1); },
    next() { advance(); },
    noop() {},
    tile(el) { addTile(+el.dataset.id); },
    untile(el) { removeTile(+el.dataset.pos); },
    check() { checkSentence(false); },
    'idk-sent'() { checkSentence(true); },
    'clear-sent'() { if (q && q.kind === 'sent' && !q.result) { q.chosen = []; render(); } },
    quit() {
      if (session && session.answered) { view = 'summary'; q = null; }
      else { view = 'home'; session = null; }
      render();
    },
    fix() { if (q && q.kind === 'word') openFix(q.card.id); },
    card(el) { openFix(el.dataset.id); },
    'hide-sent'() {
      if (!q || q.kind !== 'sent') return;
      S.shidden[q.sent.id] = true;
      save();
      refreshActive();
      toast('Предложение скрыто. Вернуть можно в разделе «Слова → Предложения».');
      advance();
    },
    'toggle-hide'(el) {
      const id = el.dataset.id;
      if (S.hidden[id]) delete S.hidden[id]; else S.hidden[id] = true;
      save();
      refreshActive();
      render();
    },
    'toggle-shide'(el) {
      const id = el.dataset.id;
      if (S.shidden[id]) delete S.shidden[id]; else S.shidden[id] = true;
      save();
      refreshActive();
      render();
    },
    wtab(el) { wordsUi = { tab: el.dataset.tab, query: '', filter: 'all', topic: 'all', limit: 150 }; render(); },
    wfilter(el) { wordsUi.filter = el.dataset.f; wordsUi.limit = 150; render(); },
    wmore() { wordsUi.limit += 300; render(); },
    set(el) {
      const v = el.dataset.v;
      S.settings[el.dataset.k] = /^\d+$/.test(v) ? +v : v;
      save();
      render();
      updateBadge();
    },
    toggle(el) {
      S.settings[el.dataset.k] = el.checked;
      save();
      refreshActive();
      updateBadge();
      if (el.dataset.k === 'includePdf') render();
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
      if (!confirm('Сбросить весь прогресс? Слова останутся, но статистика, повторения и исправления обнулятся.')) return;
      S.progress = {};
      S.sprogress = {};
      S.days = {};
      S.hidden = {};
      S.shidden = {};
      S.overrides = {};
      save();
      rebuild();
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
    if (el.matches('select[data-act="set-topic"]')) {
      S.settings.sentTopic = el.value;
      save();
      render();
      updateBadge();
    }
    if (el.matches('select[data-act="wtopic"]')) {
      wordsUi.topic = el.value;
      wordsUi.limit = 150;
      render();
    }
  });

  $sheet.addEventListener('click', (e) => {
    if (e.target === $sheet) { closeSheet(); render(); return; }
    const el = e.target.closest('[data-sact]');
    if (el) sheetAction(el.dataset.sact, el);
  });

  document.addEventListener('keydown', (e) => {
    if (sheet) {
      if (e.key === 'Escape') { closeSheet(); render(); }
      else if (e.key === 'Enter' && e.target.id === 'fixval') sheetAction('save');
      return;
    }
    if (view !== 'quiz' || !q || e.metaKey || e.ctrlKey || e.altKey) return;
    if (q.kind === 'sent') {
      if (e.key === 'Enter') { e.preventDefault(); if (q.result) advance(); else checkSentence(false); }
      else if (e.key === 'Backspace' && !q.result && q.chosen.length) { e.preventDefault(); removeTile(q.chosen.length - 1); }
      return;
    }
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

  (async function boot() {
    rebuild();
    render();
    await Promise.all([loadPdf(), loadFixes(), loadExamples(), loadMeta()]);
    rebuild();
    if (docText) {
      const added = markKnown();
      if (added) { S.lastAdded = added; save(); toast(`Новых слов из PDF-конспекта: ${added}`); }
    }
    if (view !== 'quiz') render();
    updateBadge();
    if (!docText) sync({ silent: false });
    else if (S.settings.autoSync && Date.now() - S.lastSync > AUTO_SYNC_MS && navigator.onLine) sync({ silent: true });
  })();

  // для отладки в консоли
  window.soz = {
    get cards() { return ALL; },
    get sentences() { return SENTS; },
    get state() { return S; },
    get lex() { return LEX; },
    distractors: pickDistractors,
    example: (c) => exampleFor(c),
    search: (az, lang) => searchSources(ALL.find((c) => c.az === az && (!lang || c.lang === lang))),
  };
})();
