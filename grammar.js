/*
 * Грамматический тренажёр: «соберите предложение из слов».
 *
 * extract(text) — находит в конспекте пары «русское предложение ↔ азербайджанское»:
 *   Я родился в Москве - Mən Moskvada anadan oldum.     одна строка через тире
 *   Они сами приедут на такси.                          две строки подряд
 *   Onlar özləri taksi ilə gələcəklər
 *   > Xörək bişdi və biz yedik. | Обед приготовился…    явная пара из распознанного PDF
 *
 * makeTask(sentence, level) — слова предложения плюс похожие лишние слова:
 * другие лица и падежи тех же слов (gəlirəm → gəlirsən, evdə → evdən),
 * формы местоимений (mənə → sənə, məni) и похожие слова из всего конспекта.
 */
(function (global) {
  'use strict';

  const U = global.AzParser.util;
  const azLower = global.AzParser.azLower;
  const SEP = U.SEP;
  const AZ_DIAC = /[əıöüşçğƏİÖÜŞÇĞ]/;
  const LETTER = /[A-Za-zƏəĞğİıÖöÜüŞşÇç]/;
  const VOWELS = 'aıoueəiöü';

  /* ---------- извлечение пар ---------- */

  function cleanSide(s) {
    let t = s;
    let prev;
    do { prev = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== prev);
    return U.stripDecor(t)
      .replace(/^[\s\-–—•*:;,]+/, '')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripLead(s) {
    return s.replace(/^\s*(?:\(?\d{1,2}[.)]\s*|[-–—•*]\s+|\(!\)\s*)/, '').trim();
  }

  function words(s) {
    return s.split(/\s+/).filter((w) => /[\p{L}]/u.test(w));
  }

  // «gəlMƏZdim», «İNDİ» → строчные; имена собственные («Bakı») не трогаем
  function normAz(s) {
    const toks = s.split(' ').map((w) => {
      const letters = w.replace(/[^\p{L}]/gu, '');
      if (/[a-zəğıöüşç][A-ZƏĞİÖÜŞÇ]/.test(w)) return azLower(w);
      if (letters.length >= 2 && letters === letters.toLocaleUpperCase('az') && /[A-ZƏĞİÖÜŞÇ]/.test(letters)) return azLower(w);
      return w;
    });
    const out = toks.join(' ');
    return out.charAt(0).toLocaleUpperCase('az') + out.slice(1);
  }

  function capFirst(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // «ol-ma-saydı-m», «al-maq» — разбор слова по частям, а не предложение
  function hasMorphemeDashes(s) {
    return s.split(/\s+/).some((w) => {
      const parts = w.replace(/[^\p{L}-]/gu, '').split('-').filter(Boolean);
      if (parts.length < 2) return false;
      if (parts.length === 2 && parts[0] === parts[1]) return false; // tez-tez
      if (/^qeyri$/i.test(parts[0])) return false;
      return parts.length >= 3 || parts.some((p) => p.length <= 4);
    });
  }

  function validAz(s, trusted) {
    if (!s || /[Ѐ-ӿ]/.test(s) || !LETTER.test(s)) return false;
    if (/[\/=+…_*№\d]|\.\.|\?.+\?/.test(s)) return false;
    const n = words(s).length;
    if (n < 3 || n > 12) return false;
    if (!trusted && (!AZ_DIAC.test(s) || hasMorphemeDashes(s))) return false;
    if (U.isEnglish(s)) return false;
    return true;
  }

  const RU_NOTES = /\b(сравн|союз|падеж|глагол|прош|наст|буд|оконч|суффикс|прил|сущ|местоим|инфинитив|причаст|деепр)/i;

  function validRu(s) {
    if (!s || !/[Ѐ-ӿ]/.test(s) || /[A-Za-zƏəĞğİıÖöÜüŞşÇç]/.test(s)) return false;
    if (/[\/=+…_*№]|\.\./.test(s) || RU_NOTES.test(s)) return false;
    const n = words(s).length;
    return n >= 2 && n <= 16;
  }

  function fold(s) {
    return azLower(s).replace(/[^\p{L}\s-]/gu, '').replace(/\s+/g, ' ').trim();
  }

  function extract(text, origin) {
    const lines = U.normalizeText(text || '').split('\n').map(U.fixHomoglyphs);
    const out = [];
    const seen = new Set();

    function push(azRaw, ruRaw, line, trusted) {
      const az = cleanSide(azRaw);
      const ru = cleanSide(ruRaw);
      if (!validAz(az, trusted) || !validRu(ru)) return false;
      const azN = normAz(az);
      const key = fold(azN);
      if (seen.has(key)) return true;
      seen.add(key);
      out.push({ id: 's' + U.hashKey(key), az: azN, ru: capFirst(ru), origin, line });
      return true;
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith('#')) continue;

      if (raw.startsWith('>')) {
        const [a, b] = raw.slice(1).split('|');
        if (a && b) push(a, b, i + 1, true);
        continue;
      }

      const line = stripLead(raw);
      // «Я родился в Москве - Mən Moskvada anadan oldum.»
      const parts = line.split(SEP);
      if (parts.length === 2) {
        const a = cleanSide(parts[0]), b = cleanSide(parts[1]);
        const sa = U.script(a), sb = U.script(b);
        if (sa === 'c' && sb === 'l' && push(b, a, i + 1)) continue;
        if (sa === 'l' && sb === 'c' && push(a, b, i + 1)) continue;
      }

      // «Почему человек всё время спешит? İnsan niyə həmişə tələsir?»
      const mixed = cleanSide(line);
      if (U.script(mixed) === 'm') {
        const m = /^([^A-Za-zƏəĞğİıÖöÜüŞşÇç]+[.?!])\s+([^Ѐ-ӿ]+)$/.exec(mixed) ||
                  /^([^Ѐ-ӿ]+[.?!])\s+([^A-Za-zƏəĞğİıÖöÜüŞşÇç]+)$/.exec(mixed);
        if (m) {
          const first = m[1], second = m[2];
          if (U.script(first) === 'c') push(second, first, i + 1); else push(first, second, i + 1);
          continue;
        }
      }

      // русское предложение, а на следующей строке — азербайджанское
      // (строки таблиц с колонками через несколько пробелов пропускаем)
      const table = (s) => /\S\s{2,}\S/.test(s.trim());
      if (U.script(mixed) === 'c' && i + 1 < lines.length && !table(raw) && !table(lines[i + 1])) {
        const next = cleanSide(stripLead(lines[i + 1].trim()));
        if (next && U.script(next) === 'l' && !SEP.test(' ' + next + ' ')) {
          if (push(next, mixed, i + 2)) i++;
        }
      }
    }
    return out;
  }

  /* ---------- лишние слова ---------- */

  function tokens(az) {
    return az.split(/\s+/)
      .map((w) => w.replace(/^[«"“(]+|[»"”).,!?;:]+$/g, ''))
      .filter((w) => LETTER.test(w));
  }

  function lastVowel(s) {
    for (let i = s.length - 1; i >= 0; i--) if (VOWELS.includes(s[i])) return s[i];
    return 'a';
  }
  const isBack = (s) => 'aıou'.includes(lastVowel(s));
  const endsVowel = (s) => VOWELS.includes(s[s.length - 1]);
  const pick4 = (vClass, forms) => forms['aıou'.includes(vClass) ? ('ou'.includes(vClass) ? 2 : 0) : ('öü'.includes(vClass) ? 3 : 1)];

  // падежи: evdə ↔ evdən ↔ evə
  function caseVariants(w, known) {
    const out = [];
    let stem = null;
    let m = /^(.{2,}?)(da|də|dan|dən|ta|tə|tan|tən)$/.exec(w);
    if (m) stem = m[1];
    // «prezentasiya», «Rusiya» — это не дательный падеж
    if (!stem && !/iya$/.test(w) && (m = /^(.{2,}?)(ya|yə)$/.exec(w)) && endsVowel(m[1])) stem = m[1];
    if (!stem && (m = /^(.{2,}?)(a|ə)$/.exec(w)) && known.has(m[1]) && !endsVowel(m[1])) stem = m[1];
    if (!stem) return out;
    const back = isBack(stem);
    out.push(stem + (back ? 'da' : 'də'), stem + (back ? 'dan' : 'dən'),
      stem + (endsVowel(stem) ? (back ? 'ya' : 'yə') : (back ? 'a' : 'ə')));
    return out.filter((x) => x !== w);
  }

  // лица глагола: gəlirəm → gəlirsən, gəlir, gəlmirəm; getdim → getdin; gələcəyəm → gələcək
  function verbVariants(w) {
    const out = [];
    let m = /^(.{2,}?)(y?)(ır|ir|ur|ür)(am|əm|san|sən|ıq|ik|uq|ük|sınız|siniz|sunuz|sünüz|lar|lər)?$/.exec(w);
    if (m) {
      const base = m[1] + m[2] + m[3];
      const v = m[3][0];
      const back = 'ıu'.includes(v);
      const persons = [back ? 'am' : 'əm', back ? 'san' : 'sən', '', pick4(v, ['ıq', 'ik', 'uq', 'ük']),
        pick4(v, ['sınız', 'siniz', 'sunuz', 'sünüz']), back ? 'lar' : 'lər'];
      for (const p of persons) out.push(base + p);
      out.push(m[1] + 'm' + m[3] + (m[4] || ''));
      return out.filter((x) => x !== w);
    }
    m = /^(.{3,}?)(dı|di|du|dü|tı|ti|tu|tü)(m|n|q|k|nız|niz|nuz|nüz|lar|lər)?$/.exec(w);
    if (m) {
      const base = m[1] + m[2];
      const v = m[2][1];
      const back = 'ıu'.includes(v);
      for (const p of ['m', 'n', '', back ? 'q' : 'k', pick4(v, ['nız', 'niz', 'nuz', 'nüz']), back ? 'lar' : 'lər']) out.push(base + p);
      return out.filter((x) => x !== w);
    }
    m = /^(.{2,}?)(y?)(acaq|acağ|əcək|əcəy)(am|əm|san|sən|ıq|ik|sınız|siniz|lar|lər)?$/.exec(w);
    if (m) {
      const st = m[1] + m[2];
      const back = m[3][0] === 'a';
      const f = back
        ? ['acağam', 'acaqsan', 'acaq', 'acağıq', 'acaqsınız', 'acaqlar']
        : ['əcəyəm', 'əcəksən', 'əcək', 'əcəyik', 'əcəksiniz', 'əcəklər'];
      for (const s of f) out.push(st + s);
      return out.filter((x) => x !== w);
    }
    return out;
  }

  const PRONOUNS = [
    ['mən', 'sən', 'o', 'biz', 'siz', 'onlar'],
    ['mənim', 'sənin', 'onun', 'bizim', 'sizin', 'onların'],
    ['mənə', 'sənə', 'ona', 'bizə', 'sizə', 'onlara'],
    ['məni', 'səni', 'onu', 'bizi', 'sizi', 'onları'],
    ['məndə', 'səndə', 'onda', 'bizdə', 'sizdə', 'onlarda'],
    ['məndən', 'səndən', 'ondan', 'bizdən', 'sizdən', 'onlardan'],
    ['harada', 'haraya', 'haradan', 'hara'],
    ['bu', 'o', 'bunu', 'onu', 'burada', 'orada', 'bura', 'ora'],
    ['nə', 'niyə', 'necə', 'nəyə', 'nədən', 'neçə'],
  ];

  function pronounVariants(w) {
    const out = new Set();
    PRONOUNS.forEach((row, r) => {
      const c = row.indexOf(w);
      if (c < 0) return;
      row.forEach((x) => out.add(x));
      if (r <= 5) PRONOUNS.slice(0, 6).forEach((row2) => row2[c] && out.add(row2[c]));
    });
    out.delete(w);
    return [...out];
  }

  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /*
   * Словарь форм для поиска «соседей»: все слова из предложений и однословные карточки.
   * known — множество для проверки, что основа существует (ev → evə).
   */
  function buildLexicon(sentences, cards) {
    const set = new Set();
    // имена собственные: слова, которые пишутся с большой буквы и в середине предложения
    const proper = new Set();
    for (const s of sentences) {
      tokens(s.az).forEach((t, i) => { if (i > 0 && /^[A-ZƏĞİÖÜŞÇ]/.test(t)) proper.add(azLower(t)); });
    }
    // только вычитанные предложения: опечатки из конспекта не должны попадать в варианты
    const checked = sentences.filter((s) => s.checked);
    for (const s of checked.length ? checked : sentences) for (const t of tokens(s.az)) set.add(azLower(t));
    for (const c of cards || []) {
      if (c.az && !/\s/.test(c.az)) set.add(c.az);
    }
    const list = [...set].filter((w) => w.length >= 2 && /^[\p{L}-]+$/u.test(w));
    const byPrefix = new Map();
    for (const w of list) {
      const k = w.slice(0, 3);
      if (!byPrefix.has(k)) byPrefix.set(k, []);
      byPrefix.get(k).push(w);
    }
    return { set, list, byPrefix, proper };
  }

  function neighbors(w, lex) {
    const bucket = lex.byPrefix.get(w.slice(0, 3)) || [];
    const minPrefix = Math.max(3, Math.min(w.length - 3, 6));
    return bucket
      .filter((x) => x !== w && commonPrefix(x, w) >= minPrefix && Math.abs(x.length - w.length) <= 4)
      .sort((a, b) => commonPrefix(b, w) - commonPrefix(a, w) || Math.abs(a.length - w.length) - Math.abs(b.length - w.length))
      .slice(0, 6);
  }

  /*
   * Средняя сложность по умолчанию: лишних слов примерно половина от длины предложения,
   * у выученных предложений — больше и похожее.
   */
  function makeTask(sentence, level, lex) {
    const answer = tokens(sentence.az);
    const lower = answer.map((t) => azLower(t));
    const display = answer.map((t, i) => {
      // первое слово показываем строчными, если это не имя собственное
      if (i === 0 && !lex.proper.has(azLower(t))) return azLower(t);
      return t;
    });
    const answerSet = new Set(lower);
    const n = answer.length;
    const need = level <= 1
      ? Math.min(5, Math.max(3, Math.round(n * 0.5)))
      : Math.min(7, Math.max(4, Math.round(n * 0.7)));

    const extra = [];
    const used = new Set(lower);
    const take = (w) => {
      if (!w || w.length < 2 || used.has(w)) return false;
      used.add(w);
      extra.push(w);
      return true;
    };

    // сначала по одной похожей форме на каждое слово, начиная с длинных (там окончания)
    const order = shuffle(lower.map((w, i) => i)).sort((a, b) => lower[b].length - lower[a].length);
    for (let pass = 0; pass < 2 && extra.length < need; pass++) {
      for (const i of order) {
        if (extra.length >= need) break;
        const w = lower[i];
        if (w.length < 2) continue;
        const real = shuffle([...pronounVariants(w), ...neighbors(w, lex)]);
        const gen = shuffle([...verbVariants(w), ...caseVariants(w, lex.set)]);
        // настоящие слова из конспекта надёжнее сгенерированных форм
        const pool = pass === 0 ? real.concat(gen) : gen.concat(real);
        for (const v of pool) if (!answerSet.has(v) && take(v)) break;
      }
    }
    // если похожих не хватило — случайные слова похожей длины
    let guard = 0;
    while (extra.length < need && lex.list.length && guard++ < 200) {
      const w = lex.list[Math.floor(Math.random() * lex.list.length)];
      if (Math.abs(w.length - (lower[guard % n] || '').length) <= 3) take(w);
    }

    const tiles = shuffle(
      display.map((t) => ({ text: t, key: azLower(t) })).concat(extra.map((t) => ({ text: t, key: t })))
    ).map((t, i) => Object.assign(t, { id: i }));
    return { answer: lower, tiles };
  }

  // Совпадает ли собранная последовательность с ответом. Порядок слов в азербайджанском
  // довольно гибкий: небольшая перестановка (глагол остаётся в конце) засчитывается с пометкой.
  function check(chosenKeys, answer) {
    const a = chosenKeys.join(' '), b = answer.join(' ');
    if (a === b) return { ok: true, exact: true };
    const sa = chosenKeys.slice().sort().join(' '), sb = answer.slice().sort().join(' ');
    if (sa !== sb) return { ok: false, exact: false };
    const n = answer.length;
    const moved = answer.filter((w, i) => chosenKeys[i] !== w).length;
    if (chosenKeys[n - 1] === answer[n - 1] && moved <= 2) return { ok: true, exact: false };
    return { ok: false, exact: false, order: true };
  }

  global.AzGrammar = { extract, makeTask, buildLexicon, check, tokens, _variants: { verbVariants, caseVariants, pronounVariants } };
})(typeof window !== 'undefined' ? window : globalThis);
