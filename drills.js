/*
 * Тренировка окончаний:
 *   существительные — где? куда? откуда?, множественное число, «мой»;
 *   глаголы — настоящее, прошедшее и будущее время, отрицание;
 *   связка — «я врач», «ты дома»: həkiməm, evdəsən.
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
      acc: endsVowel(w) ? w + 'n' + four(w) : v + four(w),
      gen: endsVowel(w) ? w + 'n' + four(w) + 'n' : v + four(w) + 'n',
    };
  }

  // v.s — основа перед гласной, если она другая: getmək → ged-ir, ged-əcək; etmək → ed-ir
  function verbForms(v) {
    const words = v.az.split(' ');
    const last = words.pop();
    const pre = words.length ? words.join(' ') + ' ' : '';
    const stem = last.replace(/(maq|mək)$/, '');
    const ps = v.s || stem;
    const h = four(stem);
    const back4 = 'ıu'.includes(h);
    const back = isBack(stem);
    const persons = [back4 ? 'am' : 'əm', back4 ? 'san' : 'sən', '', h + (back4 ? 'q' : 'k'), 's' + h + 'n' + h + 'z', back4 ? 'lar' : 'lər'];
    const presBase = endsVowel(ps) ? ps + 'y' + h + 'r' : ps + h + 'r';
    const pastEnd = ['m', 'n', '', back4 ? 'q' : 'k', 'n' + h + 'z', back4 ? 'lar' : 'lər'];
    // после -ma / -mə гласная прошедшего времени уже только ı / i
    const negPastEnd = ['m', 'n', '', back ? 'q' : 'k', back ? 'nız' : 'niz', back ? 'lar' : 'lər'];
    const futStem = (endsVowel(ps) ? ps + 'y' : ps) + (back ? 'aca' : 'əcə');
    const fut = back
      ? ['ğam', 'qsan', 'q', 'ğıq', 'qsınız', 'qlar']
      : ['yəm', 'ksən', 'k', 'yik', 'ksiniz', 'klər'];
    // «magic table» (давай, пусть, следует, можно, чтобы): gedim, gedəsən, getsin, gedək, gedəsiniz, getsinlər
    const vs = endsVowel(ps) ? ps + 'y' : ps;
    const opt = [vs + h + 'm', vs + (back ? 'asan' : 'əsən'), stem + 's' + h + 'n', vs + (back ? 'aq' : 'ək'),
      vs + (back ? 'asınız' : 'əsiniz'), stem + 's' + h + 'n' + (back ? 'lar' : 'lər')];
    return {
      pres: persons.map((e) => pre + presBase + e),
      past: pastEnd.map((e) => pre + stem + 'd' + h + e),
      negp: persons.map((e) => pre + stem + 'm' + h + 'r' + e),
      negd: negPastEnd.map((e) => pre + stem + (back ? 'mad' + 'ı' : 'məd' + 'i') + e),
      fut: fut.map((e) => pre + futStem + e),
      opt: opt.map((f) => pre + f),
    };
  }

  // связка: həkim → həkiməm, yaxşı → yaxşıyam, uşaq → uşağam
  function copulaForms(c) {
    const w = c.az, v = c.v || w, h = four(w), back = isBack(w), back4 = 'ıu'.includes(h), vow = endsVowel(w);
    return [
      vow ? w + 'y' + (back ? 'am' : 'əm') : v + (back ? 'am' : 'əm'),
      w + (back ? 'san' : 'sən'),
      w + 'd' + h + 'r',
      vow ? w + 'y' + h + (back4 ? 'q' : 'k') : v + h + (back4 ? 'q' : 'k'),
      w + 's' + h + 'n' + h + 'z',
      w + 'd' + h + 'r' + (back ? 'lar' : 'lər'),
    ];
  }

  /* ---------- задания ---------- */

  const PERSONS = ['mən', 'sən', 'o', 'biz', 'siz', 'onlar'];
  const PERSONS_RU = ['я', 'ты', 'он / она', 'мы', 'вы', 'они'];
  const NOUN_TYPES = {
    loc: { ask: 'где?', label: 'где' },
    dat: { ask: 'куда?', label: 'куда' },
    abl: { ask: 'откуда?', label: 'откуда' },
    pl: { ask: 'много', label: 'много' },
    my: { ask: 'мой, моя', label: 'мой' },
    acc: { ask: 'кого? что? (именно это)', label: 'что (вин.)' },
    gen: { ask: 'чей? кого?', label: 'чей' },
  };
  const VERB_TYPES = {
    pres: { ask: 'сейчас, обычно', other: 'past' },
    past: { ask: 'вчера', other: 'pres' },
    negp: { ask: 'не … (сейчас)', other: 'pres' },
    negd: { ask: 'не … (вчера)', other: 'past' },
    fut: { ask: 'завтра', other: 'pres' },
    opt: { ask: 'давай, пусть, чтобы', other: 'pres' },
  };
  // «magic table»: слово-сигнал перед глаголом, по лицам — [начало фразы, что оно значит]
  const OPT_LEADS = [
    [['Qoy mən', 'позволь, я …'], ['Gərək mən', 'мне следует …'], ['Olar mən', 'можно я …?'], ['İstəyirsən ki, mən', 'ты хочешь, чтобы я …']],
    [['Gərək sən', 'тебе следует …'], ['İstəyirəm ki, sən', 'я хочу, чтобы ты …']],
    [['Qoy o', 'пусть он …'], ['Gərək o', 'ему следует …'], ['Olar o', 'можно он …?'], ['İstəyirəm ki, o', 'я хочу, чтобы он …']],
    [['Gəl', 'давай …'], ['Gəlin', 'давайте …'], ['Gərək biz', 'нам следует …'], ['Olar biz', 'можно мы …?']],
    [['Gərək siz', 'вам следует …'], ['İstəyirəm ki, siz', 'я хочу, чтобы вы …']],
    [['Qoy onlar', 'пусть они …'], ['Gərək onlar', 'им следует …'], ['İstəyirəm ki, onlar', 'я хочу, чтобы они …']],
  ];
  const RULES = {
    loc: 'Где? → -da / -də. После a, ı, o, u — -da, после e, ə, i, ö, ü — -də.',
    dat: 'Куда? → -a / -ə, после гласной -ya / -yə. Конечные q и k перед гласной переходят в ğ и y: otaq → otağa.',
    abl: 'Откуда? → -dan / -dən, по той же гармонии, что и -da / -də.',
    pl: 'Много → -lar / -lər: после a, ı, o, u — -lar, после e, ə, i, ö, ü — -lər.',
    my: 'Мой → -ım / -im / -um / -üm по последней гласной слова, после гласной просто -m: ana → anam.',
    acc: 'Определённый объект («именно это») → -ı / -i / -u / -ü, после гласной -nı / -ni / -nu / -nü: kitabı oxuyuram — читаю (эту) книгу.',
    gen: 'Чей? → -ın / -in / -un / -ün, после гласной -nın / -nin / -nun / -nün. У предмета при этом окончание «его»: evin qapısı — дверь дома.',
    num: 'Число читается слева направо: десятки, потом единицы — qırx yeddi (40 + 7). Сотни: iki yüz, тысячи: üç min. После числа существительное остаётся в единственном числе: iki kitab.',
    pres: 'Сейчас, обычно: основа + -ır / -ir / -ur / -ür (после гласной -yır…) + лицо: -am/-əm, -san/-sən, —, -ıq/-ik, -sınız/-siniz, -lar/-lər.',
    past: 'Вчера: основа + -dı / -di / -du / -dü + лицо: -m, -n, —, -q/-k, -nız/-niz, -lar/-lər.',
    negp: 'Не (сейчас): после основы вставляется -m-: gəl-ir → gəl-m-ir, işlə-yir → işlə-m-ir. Лицо как обычно.',
    negd: 'Не (вчера): основа + -ma / -mə + -dı / -di + лицо: gəl-mə-di-m, al-ma-dı-m.',
    fut: 'Завтра: основа + -acaq / -əcək (после гласной -yacaq / -yəcək). В «я» и «мы» q → ğ, k → y: alacağam, gələcəyik.',
    opt: 'После Gəl (давай), Qoy (пусть), Gərək (следует), Olar (можно) и «… ki,» (чтобы): mən -ım/-im/-um/-üm, sən -asan/-əsən, o -sın/-sin/-sun/-sün, biz -aq/-ək, siz -asınız/-əsiniz, onlar -sınlar/-sinlər. После гласной вставляется y: oxuyum, işləyək.',
    cop: 'Я — …, ты — …: к слову добавляется лицо: -am/-əm, -san/-sən, -dır/-dir/-dur/-dür, -ıq/-ik/-uq/-ük, -sınız…, -dırlar. После гласной в «я» и «мы» вставляется y: yaxşıyam.',
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

  const NEAR = { 0: 1, 1: 0, 2: 5, 3: 4, 4: 3, 5: 2 }; // путают «я ↔ ты», «мы ↔ вы», «он ↔ они»

  function nounDrill(n, stats, allow) {
    const all = Object.keys(NOUN_TYPES).filter((t) => n.f[t]);
    const types = all.filter(allow);
    if (!types.length) return null;
    const type = weighted(types, stats);
    const correct = n.f[type];
    const others = shuffle(all.filter((t) => t !== type).map((t) => n.f[t]));
    const base = n.v || n.az;
    // одна ошибка в гармонии, остальное — другие падежи этого же слова
    const wrong = shuffle(harmonyErrors(correct, base)).slice(0, 1).concat(others, harmonyErrors(correct, base));
    return {
      type, word: n.az, ru: n.ru, ask: NOUN_TYPES[type].ask,
      options: finish(correct, wrong),
      rule: RULES[type],
      table: all.map((t) => [NOUN_TYPES[t].label, n.f[t]]),
    };
  }

  function verbDrill(v, stats, allow) {
    const types = Object.keys(VERB_TYPES).filter((t) => v[t] && allow(t));
    if (!types.length) return null;
    const type = weighted(types, stats);
    const p = Math.floor(Math.random() * 6);
    const forms = v[type];
    const correct = forms[p];
    const stem = v.az.replace(/(maq|mək)$/, '');
    const wrong = [forms[NEAR[p]]].concat(
      shuffle(harmonyErrors(correct, stem)).slice(0, 1),
      [v[VERB_TYPES[type].other][p]],
      shuffle(forms.filter((_, i) => i !== p && i !== NEAR[p])));
    // в «magic table» вместо местоимения показываем начало фразы: «Qoy o …», «Gəl …»
    const lead = type === 'opt' ? pick(OPT_LEADS[p]) : null;
    return {
      type, word: v.az, ru: v.ru, person: lead ? lead[0] : PERSONS[p], ask: lead ? lead[1] : VERB_TYPES[type].ask,
      options: finish(correct, wrong),
      rule: RULES[type],
      table: forms.map((f, i) => [PERSONS[i], f]),
    };
  }

  function copulaDrill(c) {
    const p = Math.floor(Math.random() * 6);
    const correct = c.f[p];
    const wrong = [c.f[NEAR[p]]].concat(
      shuffle(harmonyErrors(correct, c.v || c.az)).slice(0, 1),
      shuffle(c.f.filter((_, i) => i !== p && i !== NEAR[p])));
    return {
      type: 'cop', word: c.az, ru: c.ru, person: PERSONS[p], ask: `«${PERSONS_RU[p]} — …»`,
      options: finish(correct, wrong),
      rule: RULES.cop,
      table: c.f.map((f, i) => [PERSONS[i], f]),
    };
  }

  /* ---------- числа ---------- */

  const UNITS_AZ = ['sıfır', 'bir', 'iki', 'üç', 'dörd', 'beş', 'altı', 'yeddi', 'səkkiz', 'doqquz'];
  const TENS_AZ = ['', 'on', 'iyirmi', 'otuz', 'qırx', 'əlli', 'altmış', 'yetmiş', 'səksən', 'doxsan'];

  // 47 → «qırx yeddi», 250 → «iki yüz əlli», 3500 → «üç min beş yüz»
  function numberWords(n) {
    if (n === 0) return UNITS_AZ[0];
    const parts = [];
    const th = Math.floor(n / 1000), h = Math.floor((n % 1000) / 100), t = Math.floor((n % 100) / 10), u = n % 10;
    if (th) parts.push(th === 1 ? 'min' : UNITS_AZ[th] + ' min');
    if (h) parts.push(h === 1 ? 'yüz' : UNITS_AZ[h] + ' yüz');
    if (t) parts.push(TENS_AZ[t]);
    if (u) parts.push(UNITS_AZ[u]);
    return parts.join(' ');
  }

  function randomNumber() {
    const r = Math.random();
    if (r < 0.15) return 1 + Math.floor(Math.random() * 10);
    if (r < 0.7) return 11 + Math.floor(Math.random() * 89);
    if (r < 0.9) return 100 + Math.floor(Math.random() * 900);
    return (1 + Math.floor(Math.random() * 9)) * 1000 + Math.floor(Math.random() * 10) * 100;
  }

  // число ↔ слова; в неправильных вариантах переставлены разряды и соседние числа
  function numberDrill(type) {
    const n = randomNumber();
    const swap = n >= 10 && n < 100 ? (n % 10) * 10 + Math.floor(n / 10) : n >= 100 ? n + 100 : n + 2;
    const near = shuffle([swap, n + 1, n - 1, n + 10, n - 10, n + 3, n * 10]).filter((x) => x > 0 && x !== n && x < 10000);
    const toWords = type === 'numw';
    const text = (x) => (toWords ? numberWords(x) : String(x));
    return {
      type, number: true,
      word: toWords ? String(n) : numberWords(n),
      ru: toWords ? 'Как это сказать?' : 'Какое это число?',
      ask: toWords ? 'словами' : 'цифрами',
      options: finish(text(n), near.map(text)),
      rule: RULES.num,
      table: [20, 30, 40, 50, 60, 70, 80, 90, 100, 1000].map((x) => [String(x), numberWords(x)]),
    };
  }

  /*
   * only — список видов заданий: для урока по одной теме (например, ['loc', 'dat', 'abl'])
   * или набор, доступный в ежедневной тренировке.
   */
  function make(data, stats, only) {
    if (!data) return null;
    const allow = (t) => !only || only.includes(t);
    const kinds = [];
    if (data.nouns && Object.keys(NOUN_TYPES).some(allow)) kinds.push('n', 'n');
    if (data.verbs && Object.keys(VERB_TYPES).some(allow)) kinds.push('v', 'v');
    if (data.cops && allow('cop')) kinds.push('c');
    const nums = ['numw', 'numr'].filter(allow);
    if (only && nums.length) kinds.push('#');
    for (let attempt = 0; attempt < 12 && kinds.length; attempt++) {
      const k = pick(kinds);
      const d = k === 'n' ? nounDrill(pick(data.nouns), stats, allow)
        : k === 'v' ? verbDrill(pick(data.verbs), stats, allow)
          : k === '#' ? numberDrill(pick(nums))
            : copulaDrill(pick(data.cops));
      if (d) return d;
    }
    return null;
  }

  global.AzDrills = { make, nounForms, verbForms, copulaForms, numberWords, PERSONS, RULES };
})(typeof window !== 'undefined' ? window : globalThis);
