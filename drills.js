/*
 * Тренировка окончаний: падежи существительных (где? куда? откуда?), множественное число,
 * «мой» и спряжение глаголов в настоящем и прошедшем времени.
 *
 * Правильные формы лежат в data/drill-words.json (сгенерированы правилами и вычитаны).
 * Неправильные варианты строятся здесь: нарушенная гармония гласных (evda вместо evdə),
 * другой падеж того же слова, другое лицо или время глагола.
 */
(function (global) {
  'use strict';

  const VOWELS = 'aıoueəiöü';
  const lastVowel = (s) => { for (let i = s.length - 1; i >= 0; i--) if (VOWELS.includes(s[i])) return s[i]; return 'a'; };
  const endsVowel = (s) => VOWELS.includes(s[s.length - 1]);
  const isBack = (s) => 'aıou'.includes(lastVowel(s));
  const four = (s) => ({ a: 'ı', ı: 'ı', o: 'u', u: 'u', e: 'i', ə: 'i', i: 'i', ö: 'ü', ü: 'ü' }[lastVowel(s)]);

  /* ---------- генерация правильных форм (для подготовки данных) ---------- */

  // n.v — основа перед гласной, если конечная q/k меняется: otaq → otağ-a, çörək → çörəy-im
  function nounForms(n) {
    const w = n.az, v = n.v || w, back = isBack(w);
    return {
      loc: w + (back ? 'da' : 'də'),
      dat: endsVowel(w) ? w + (back ? 'ya' : 'yə') : v + (back ? 'a' : 'ə'),
      abl: w + (back ? 'dan' : 'dən'),
      pl: w + (back ? 'lar' : 'lər'),
      my: endsVowel(w) ? w + 'm' : v + four(w) + 'm',
    };
  }

  // v.s — основа настоящего времени, если она другая: getmək → ged-ir, etmək → ed-ir
  function verbForms(v) {
    const words = v.az.split(' ');
    const last = words.pop();
    const pre = words.length ? words.join(' ') + ' ' : '';
    const stem = last.replace(/(maq|mək)$/, '');
    const ps = v.s || stem;
    const h = four(stem);
    const back = 'ıu'.includes(h);
    const base = endsVowel(ps) ? ps + 'y' + h + 'r' : ps + h + 'r';
    const pres = [back ? 'am' : 'əm', back ? 'san' : 'sən', '', h + (back ? 'q' : 'k'), 's' + h + 'n' + h + 'z', back ? 'lar' : 'lər']
      .map((e) => pre + base + e);
    const past = ['m', 'n', '', back ? 'q' : 'k', 'n' + h + 'z', back ? 'lar' : 'lər']
      .map((e) => pre + stem + 'd' + h + e);
    return { pres, past };
  }

  /* ---------- задания ---------- */

  const PERSONS = ['mən', 'sən', 'o', 'biz', 'siz', 'onlar'];
  const NOUN_TYPES = {
    loc: { ask: 'где?', label: 'где' },
    dat: { ask: 'куда?', label: 'куда' },
    abl: { ask: 'откуда?', label: 'откуда' },
    pl: { ask: 'много', label: 'много' },
    my: { ask: 'мой, моя', label: 'мой' },
  };
  const RULES = {
    loc: 'Где? → -da / -də. После a, ı, o, u — -da, после e, ə, i, ö, ü — -də.',
    dat: 'Куда? → -a / -ə, после гласной -ya / -yə. Конечные q и k перед гласной переходят в ğ и y: otaq → otağa.',
    abl: 'Откуда? → -dan / -dən, по той же гармонии, что и -da / -də.',
    pl: 'Много → -lar / -lər: после a, ı, o, u — -lar, после e, ə, i, ö, ü — -lər.',
    my: 'Мой → -ım / -im / -um / -üm по последней гласной слова, после гласной просто -m: ana → anam.',
    pres: 'Сейчас, обычно: основа + -ır / -ir / -ur / -ür (после гласной -yır…) + лицо: -am/-əm, -san/-sən, —, -ıq/-ik, -sınız/-siniz, -lar/-lər.',
    past: 'Вчера: основа + -dı / -di / -du / -dü + лицо: -m, -n, —, -q/-k, -nız/-niz, -lar/-lər.',
  };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // та же форма с нарушенной гармонией: меняются гласные только в окончании
  function harmonyErrors(form, base) {
    let i = 0;
    while (i < form.length && i < base.length && form[i] === base[i]) i++;
    const head = form.slice(0, i), tail = form.slice(i);
    const two = { a: 'ə', ə: 'a', ı: 'i', i: 'ı', u: 'ü', ü: 'u' };
    const fourSwap = { ı: 'u', u: 'ı', i: 'ü', ü: 'i' };
    return [head + tail.replace(/[aəıiuü]/g, (c) => two[c]), head + tail.replace(/[ıiuü]/g, (c) => fourSwap[c])]
      .filter((x) => x !== form);
  }

  // чаще даём те виды заданий, в которых больше ошибок
  function weighted(types, stats) {
    const w = types.map((t) => {
      const s = (stats && stats[t]) || { c: 0, w: 0 };
      return 1 + (2 * s.w) / (s.c + s.w + 1);
    });
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < types.length; i++) { r -= w[i]; if (r <= 0) return types[i]; }
    return types[types.length - 1];
  }

  function finish(correct, wrong) {
    const seen = new Set([correct]);
    const opts = [];
    for (const x of wrong) {
      if (opts.length >= 3) break;
      if (!x || seen.has(x)) continue;
      seen.add(x);
      opts.push(x);
    }
    return shuffle([correct].concat(opts)).map((text) => ({ text, correct: text === correct }));
  }

  function nounDrill(n, stats) {
    const types = Object.keys(NOUN_TYPES).filter((t) => n.f[t]);
    const type = weighted(types, stats);
    const correct = n.f[type];
    const others = shuffle(types.filter((t) => t !== type).map((t) => n.f[t]));
    // одна ошибка в гармонии, остальное — другие падежи этого же слова
    const wrong = shuffle(harmonyErrors(correct, n.v || n.az)).slice(0, 1).concat(others, harmonyErrors(correct, n.v || n.az));
    return {
      type,
      word: n.az,
      ru: n.ru,
      ask: NOUN_TYPES[type].ask,
      options: finish(correct, wrong),
      rule: RULES[type],
      table: types.map((t) => [NOUN_TYPES[t].label, n.f[t]]),
    };
  }

  function verbDrill(v, stats) {
    const type = weighted(['pres', 'past'], stats);
    const other = type === 'pres' ? 'past' : 'pres';
    const p = Math.floor(Math.random() * 6);
    const forms = v[type];
    const correct = forms[p];
    // путают чаще всего «я ↔ ты», «мы ↔ вы» и время
    const near = { 0: 1, 1: 0, 2: 5, 3: 4, 4: 3, 5: 2 }[p];
    const wrong = [forms[near]].concat(shuffle(harmonyErrors(correct, v.az.replace(/(maq|mək)$/, ''))).slice(0, 1),
      [v[other][p]], shuffle(forms.filter((_, i) => i !== p && i !== near)));
    return {
      type,
      word: v.az,
      ru: v.ru,
      person: PERSONS[p],
      ask: type === 'pres' ? 'сейчас, обычно' : 'вчера',
      options: finish(correct, wrong),
      rule: RULES[type],
      table: forms.map((f, i) => [PERSONS[i], f]),
    };
  }

  function make(data, stats) {
    if (!data || !data.nouns || !data.verbs) return null;
    return Math.random() < 0.55 ? nounDrill(pick(data.nouns), stats) : verbDrill(pick(data.verbs), stats);
  }

  global.AzDrills = { make, nounForms, verbForms, PERSONS };
})(typeof window !== 'undefined' ? window : globalThis);
