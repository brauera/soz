/*
 * Извлекает пары «азербайджанское слово — перевод» из свободного конспекта.
 *
 * Понимает:
 *   qonşu – neighbor (пример)        AZ – EN
 *   OLMAQ - быть                      AZ – RU
 *   по-русски - RUSÇA                 RU – AZ
 *   yatmaq - спать      bağlamaq - …  несколько пар в строке (3+ пробела)
 *   Satmaq - продавать // almaq - …   несколько пар через //
 *   (bədən - тело, hissə - часть)     пары в скобках
 *   справа   слева  /  sağda   solda  таблицы из двух строк
 */
(function (global) {
  'use strict';

  const PARSER_VERSION = 4;

  const CYR = /[Ѐ-ӿ]/;
  const LAT = /[A-Za-zƏəĞğİıÖöÜüŞşÇç]/;
  const AZ_ONLY = /[əğıöüşçƏĞİÖÜŞÇ]|[qxQX]/;
  const SEP = /\s+[-–—]+\s+/;
  const PH_RE = /(\d+)/g;
  const ATT_OPEN = '', ATT_CLOSE = '';

  const EN_HINT = /\bto\s|\bthe\b|w|th|sh|ch|ck|ee|oo|ea|ou|ie|igh|ph|ing\b|tion\b|ly\b|ness\b|ful\b|less\b/;
  const EN_WORDS = new Set((
    'a an the to be is are am was were do does did have has had get go come here there this that these those ' +
    'what where when why who how which you he she it we they me him her us them my your his its our their ' +
    'and or but not no yes all any some one two good bad big small large new old long short left right ' +
    'table room house home book door time day year work make take give see look say tell ask answer ' +
    'magic free fine well very much many more most less just only also soon now then again act width ' +
    'can will would should must may might let please thank thanks sorry out up down on in at of for with by from ' +
    'verb noun adjective adverb present past future tense plural singular'
  ).split(' '));
  const PRONOUNS = new Set(['mən', 'sən', 'o', 'biz', 'siz', 'onlar', 'bu', 'o,', 'bu,']);

  const LAT_HOMO = { а: 'a', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', у: 'y', А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X' };
  const CYR_HOMO = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
  const SINGLE_TO_CYR = new Set(['C', 'c', 'B', 'K', 'y', 'Y', 'a', 'A', 'e', 'E', 'x', 'X', 'p', 'P', 'M', 'H', 'T']);

  // «оxuduğum» (первая буква кириллическая) → «oxuduğum», «C числом» → «С числом»
  function fixHomoglyphs(line) {
    const toks = line.split(/(\s+)/);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!t.trim()) continue;
      const cyr = (t.match(/[Ѐ-ӿ]/g) || []).length;
      const lat = (t.match(/[A-Za-zƏəĞğİıÖöÜüŞşÇç]/g) || []).length;
      if (cyr && lat) {
        if (lat > cyr && [...t].every((ch) => !CYR.test(ch) || LAT_HOMO[ch])) {
          toks[i] = [...t].map((ch) => LAT_HOMO[ch] || ch).join('');
        } else if (cyr > lat && [...t].every((ch) => !/[A-Za-z]/.test(ch) || CYR_HOMO[ch])) {
          toks[i] = [...t].map((ch) => (/[A-Za-z]/.test(ch) ? CYR_HOMO[ch] : ch)).join('');
        }
      } else if (lat === 1 && t.length === 1 && SINGLE_TO_CYR.has(t)) {
        const next = toks.slice(i + 1).find((x) => x.trim());
        if (next && CYR.test(next) && !LAT.test(next)) toks[i] = CYR_HOMO[t];
      }
    }
    return toks.join('');
  }

  function normalizeText(t) {
    return t
      .replace(/\r/g, '')
      .replace(/\t/g, '    ')
      .replace(/[   ]/g, ' ')
      .replace(/[​-‍﻿]/g, '')
      .replace(/[ǝә]/g, 'ə')
      .replace(/[ƎӘ]/g, 'Ə')
      .replace(/[’‘`]/g, "'");
  }

  function azLower(s) {
    return s
      .split(/(\s+)/)
      .map((w) => {
        // «Istifadə» в начале предложения — это İ; в словах капсом I — это ı
        if (/^I[a-zəğıöüşç]/.test(w)) w = 'i' + w.slice(1);
        try { return w.toLocaleLowerCase('az'); } catch (e) { return w.toLowerCase(); }
      })
      .join('');
  }

  function script(s) {
    const clean = s.replace(PH_RE, '');
    const c = CYR.test(clean), l = LAT.test(clean);
    if (c && !l) return 'c';
    if (l && !c) return 'l';
    if (c && l) return 'm';
    return 'n';
  }

  function words(s) {
    return s.split(/[\s,;\/=]+/).map((w) => w.replace(/[^A-Za-zƏəĞğİıÖöÜüŞşÇç'Ѐ-ӿ-]/g, '')).filter(Boolean);
  }

  function wordCount(s) {
    return s.split(/\s+/).filter((w) => LAT.test(w) || CYR.test(w)).length;
  }

  function isEnglish(s) {
    if (AZ_ONLY.test(s)) return false;
    const w = words(s.toLowerCase());
    if (!w.length) return false;
    if (EN_HINT.test(s.toLowerCase())) return true;
    return w.filter((x) => EN_WORDS.has(x)).length * 2 >= w.length;
  }

  function stripDecor(s) {
    return s
      .replace(/!{2,}/g, ' ')
      .replace(/\(\s*[!?]\s*\)/g, ' ')
      .replace(/\(:\/\)|:\)|:\(|\){2,}|\({2,}/g, ' ')
      .replace(/[“”«»"„]/g, '')
      .replace(/\p{Extended_Pictographic}️?/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trimPunct(s) {
    return s.replace(/^[\s,.;:!?…'\-–—\/=*•]+|[\s,.;:!?…'\-–—\/=*•]+$/g, '').trim();
  }

  function balanceParens(s) {
    const o = (s.match(/\(/g) || []).length, c = (s.match(/\)/g) || []).length;
    return o === c ? s : s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Заменяет (…) на плейсхолдеры, чтобы тире внутри скобок не считались разделителем.
  // Короткие окончания, приписанные к слову — «yağış(lı)», «давай(те)» — остаются частью слова.
  function protectParens(s, bag) {
    let out = s
      .replace(/([A-Za-zƏəĞğİıÖöÜüŞşÇç])\(([A-Za-zƏəĞğİıÖöÜüŞşÇç]{1,5})\)/g, `$1${ATT_OPEN}$2${ATT_CLOSE}`)
      .replace(/([а-яё])\(([а-яё]{1,4})\)/gi, `$1${ATT_OPEN}$2${ATT_CLOSE}`);
    let prev;
    do {
      prev = out;
      out = out.replace(/\(([^()]*)\)/g, (m, inner) => {
        bag.push(inner);
        return ' ' + (bag.length - 1) + ' ';
      });
    } while (out !== prev);
    // незакрытая скобка — всё после неё считаем комментарием
    const open = out.indexOf('(');
    if (open >= 0) {
      bag.push(out.slice(open + 1));
      out = out.slice(0, open) + ' ' + (bag.length - 1) + '';
    }
    return out.replace(/\)/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function tokenScript(tok) {
    return script(tok.replace(PH_RE, ''));
  }

  // Берёт хвост левой части в нужной письменности (слова перед тире).
  function takeTail(s, want) {
    const toks = s.split(' ');
    const res = [];
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      const sc = tokenScript(t);
      if (sc === want || sc === 'n') {
        if (res.length && sc !== 'n' && /[.?!:]$/.test(t.replace(PH_RE, ''))) break;
        res.unshift(t);
      } else break;
    }
    return res.join(' ');
  }

  // Берёт начало правой части в нужной письменности, остаток возвращает отдельно.
  function takeHead(s, want) {
    const toks = s.split(' ');
    let i = 0;
    for (; i < toks.length; i++) {
      const sc = tokenScript(toks[i]);
      if (!(sc === want || sc === 'n')) break;
    }
    return { head: toks.slice(0, i).join(' '), rest: toks.slice(i).join(' ') };
  }

  function edgeScript(s, fromEnd) {
    const toks = s.split(' ');
    if (fromEnd) toks.reverse();
    for (const t of toks) {
      const sc = tokenScript(t);
      if (sc !== 'n') return sc;
    }
    return 'n';
  }

  // «danış-maq», «yaşa-yır-am», «təriflə/mək», «soyuqlay-ıb» → слитно
  function joinMorphemes(term) {
    return term
      .split(' ')
      .map((w) => {
        const sl = /^([^\/]{2,})\/(maq|mək)$/i.exec(w);
        if (sl) return sl[1] + sl[2];
        const parts = w.split('-');
        if (parts.length >= 3) return parts.join('');
        if (parts.length === 2) {
          if (/^(maq|mək)$/i.test(parts[1])) return parts.join('');
          if (parts[0].length >= 3 && /^[ıiuüaəoö][a-zəğıöüşç]{0,2}$/.test(parts[1]) && parts[0] !== parts[1]) return parts.join('');
        }
        return w;
      })
      .join(' ');
  }

  // «1. уже 2. лишнее» → «уже; лишнее»
  function numberedMeanings(s) {
    const re = /(?:^|[\s,;\/]+)\d+(?:[.)]\s*|\s+)(?=[^\d\s])/;
    if (!re.test(s)) return s;
    return s
      .split(new RegExp(re.source, 'g'))
      .map((x) => x.trim().replace(/[,;\/]$/, '').trim())
      .filter(Boolean)
      .join('; ');
  }

  /*
   * Раскрывает плейсхолдеры одной стороны пары.
   * side: 'az' | 'ru' | 'en'. Примеры и заметки складываются в extra.
   */
  function resolveSide(text, side, bag, extra) {
    return text.replace(PH_RE, (m, idx) => {
      const inner = stripDecor(bag[+idx] || '').replace(/[]/g, (ch) => (ch === ATT_OPEN ? '(' : ')'));
      if (!inner) return '';
      if (SEP.test(' ' + inner + ' ')) {
        extra.nested.push(inner);
        return '';
      }
      const sc = script(inner);
      const short = inner.length <= 26 && wordCount(inner) <= 3;
      if (side === 'ru' && sc === 'c' && short) return '(' + inner + ')';
      if (side === 'en' && sc === 'l' && short && !AZ_ONLY.test(inner)) return '(' + inner + ')';
      if (sc === 'l' && wordCount(inner) >= 2 && AZ_ONLY.test(inner) && !/^=/.test(inner)) {
        extra.examples.push(inner);
      } else {
        const note = trimPunct(inner.replace(/^=\s*/, ''));
        // короткие латинские обрывки («lı», «yin») — это окончания, а не пояснения
        if (note && (CYR.test(note) || note.length >= 4)) extra.notes.push(note);
      }
      return '';
    });
  }

  function restoreAttached(s) {
    return s.replace(//g, '(').replace(//g, ')');
  }

  function cleanTerm(s) {
    const t = trimPunct(stripDecor(restoreAttached(s).replace(/\s*\/\/\s*/g, ' / ').replace(/\s*=\s*/g, ' = ')));
    return balanceParens(t)
      .replace(/\(\s*\)/g, '')
      .replace(/\s+([,;])/g, '$1')
      .replace(/(\s*;\s*)+/g, '; ')
      .replace(/^;\s*|;\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function validAz(az, verb) {
    if (!az || az.length < 2 || az.length > 40) return false;
    if (CYR.test(az) || !LAT.test(az)) return false;
    if (/[0-9№+…_;]|\.\.|^-|\*/.test(az)) return false;
    const wc = wordCount(az);
    if (wc < 1 || wc > (verb ? 4 : 3)) return false;
    const first = az.split(' ')[0];
    if (wc >= 3 && PRONOUNS.has(first)) return false;
    if (/[.?!]/.test(az) && wc >= 3) return false;
    if (isEnglish(az)) return false;
    return true;
  }

  function validGloss(g, lang) {
    if (!g || g.length > 56) return false;
    if (/[…_+№]|\.\./.test(g)) return false;
    const bare = g.replace(/\([^)]*\)/g, '');
    const wc = wordCount(bare);
    if (wc < 1 || wc > (lang === 'ru' ? 5 : 6)) return false;
    if (lang === 'ru') {
      if (!CYR.test(bare) || LAT.test(bare)) return false;
      if (/^(искл|см|напр|т\.е)\.?$/.test(bare.trim())) return false;
    } else if (CYR.test(g) || !LAT.test(g)) {
      return false;
    }
    return true;
  }

  function isVerbAz(az) {
    return az.split(/\s*\/\s*|\s*=\s*/).some((alt) => /(maq|mək)$/.test(alt.trim()));
  }

  function classify(az, gloss, lang) {
    const last = az.split(/\s*\/\s*|\s*=\s*/)[0].split(' ').pop();
    const g = gloss.replace(/\([^)]*\)/g, '').trim();
    const gFirst = g.split(/[\s,;\/]+/)[0] || '';
    if (isVerbAz(az)) return 'verb';
    // «-ость/-есть» — существительные (зрелость), а не глаголы
    if (lang === 'ru' && /(ть|ться|чь|чься|ти|тись)$/.test(gFirst) && !/(ость|есть)$/.test(gFirst)) return 'verb';
    if (lang === 'en' && /^to\s/.test(g)) return 'verb';
    if (wordCount(az) >= 3 || wordCount(g) >= 3) return 'phrase';
    if (lang === 'ru' && /(ый|ий|ой|ая|яя|ое|ые)$/.test(gFirst)) return 'adj';
    if (/(lı|li|lu|lü|sız|siz|suz|süz)$/.test(last)) return 'adj';
    return 'word';
  }

  function makeCard(azRaw, glossRaw, lang, src, line, extra) {
    const rawTrim = restoreAttached(azRaw).trim();
    // «-can / qədər», «...Mİ» — это суффиксы и частицы из грамматических пояснений
    if (/^[-–]\S|^(\.{2,}|…)/.test(rawTrim)) return null;
    const az = joinMorphemes(azLower(cleanTerm(azRaw)));
    // «из-за причин- громкий звук»: дефис с пробелом после слова отделяет уже другую пару
    let gloss = cleanTerm(numberedMeanings(glossRaw).split(/(?<=[а-яёa-z])[-–—]\s/i)[0]);
    if (lang === 'ru') gloss = gloss.toLowerCase();
    else gloss = gloss.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
    gloss = gloss.replace(/\s*\/\s*/g, ' / ').replace(/\s*;\s*/g, '; ').replace(/\s+,/g, ',').replace(/\s+\)/g, ')');
    if (!validAz(az, isVerbAz(az)) || !validGloss(gloss, lang)) return null;
    if (az === gloss.toLowerCase()) return null;
    return {
      az,
      gloss,
      lang,
      src,
      line,
      examples: ((extra && extra.examples) || []).map((e) => restoreAttached(e)),
      notes: ((extra && extra.notes) || []).map((e) => restoreAttached(e)),
    };
  }

  // «görmək / baxmaq - видеть / смотреть» → две карточки, если число вариантов совпадает
  function splitAlternatives(card) {
    if (!card) return [];
    const azAlts = card.az.split(' / ');
    const gAlts = card.gloss.split(' / ');
    if (azAlts.length >= 2 && azAlts.length === gAlts.length &&
        azAlts.every((a) => wordCount(a) <= 2) && gAlts.every((g) => wordCount(g) <= 3)) {
      return azAlts.map((a, i) => Object.assign({}, card, { az: a, gloss: gAlts[i] }));
    }
    return [card];
  }

  // Разбирает кусок текста с одной парой через тире.
  function parsePairChunk(chunk, line, src, out, depth) {
    const bag = [];
    const prot = protectParens(chunk, bag);
    const m = SEP.exec(prot);
    if (!m) return { card: null, bag };

    const leftAll = prot.slice(0, m.index);
    let rightAll = prot.slice(m.index + m[0].length);
    let tail = '';
    const m2 = SEP.exec(rightAll);
    if (m2) {
      tail = rightAll.slice(m2.index);
      rightAll = rightAll.slice(0, m2.index);
    }
    if (/\s\/\/\s/.test(rightAll) && !/\s\/\/\s/.test(leftAll)) {
      rightAll = rightAll.split(/\s\/\/\s/)[0];
    }

    const ls = edgeScript(leftAll, true);
    const rs = edgeScript(rightAll, false);
    let azPart, glossPart, lang, rest = '';

    if (ls === 'l' && rs === 'c') {
      azPart = takeTail(leftAll, 'l');
      const h = takeHead(rightAll, 'c');
      glossPart = h.head; rest = h.rest; lang = 'ru';
    } else if (ls === 'c' && rs === 'l') {
      glossPart = takeTail(leftAll, 'c');
      const h = takeHead(rightAll, 'l');
      azPart = h.head; rest = h.rest; lang = 'ru';
    } else if (ls === 'l' && rs === 'l') {
      const L = takeTail(leftAll, 'l');
      const Lc = L.replace(PH_RE, ''), Rc = rightAll.replace(PH_RE, '');
      if (isEnglish(Rc) && !isEnglish(Lc)) { azPart = L; glossPart = rightAll; lang = 'en'; }
      else if (isEnglish(Lc) && !isEnglish(Rc) && AZ_ONLY.test(Rc)) { azPart = rightAll; glossPart = L; lang = 'en'; }
      else return { card: null, bag };
    } else {
      return { card: null, bag };
    }

    const extra = { examples: [], notes: [], nested: [] };
    const azText = resolveSide(azPart, 'az', bag, extra);
    const glossText = resolveSide(glossPart, lang, bag, extra);
    // из остатка строки берём только примеры: скобки там относятся к другим словам
    const restExtra = { examples: [], notes: [], nested: extra.nested };
    const restText = stripDecor(restoreAttached(resolveSide(rest + ' ' + tail.replace(SEP, ' '), 'az', bag, restExtra)));
    if (restText && script(restText) === 'l' && wordCount(restText) >= 2 && AZ_ONLY.test(restText) && !/^=/.test(restText)) {
      extra.examples.push(restText.replace(/^[\s,;:\-–—]+/, ''));
    }
    extra.examples.push(...restExtra.examples);

    if (depth < 1) {
      for (const n of extra.nested) parseNested(n, line, out);
    }
    return { card: makeCard(azText, glossText, lang, src, line, extra), bag };
  }

  function parseNested(inner, line, out) {
    const pieces = inner.split(/\s*[,;]\s*/);
    const allPairs = pieces.length > 1 && pieces.every((p) => SEP.test(' ' + p + ' '));
    for (const p of allPairs ? pieces : [inner]) {
      const r = parsePairChunk(p, line, 'nested', out, 1);
      splitAlternatives(r.card).forEach((c) => out.push(c));
    }
  }

  function preLine(raw) {
    return raw
      .replace(/^\s*(?:\(?\d{1,2}[.)]\s+|[-–—•*]\s+|\(!\)\s*|!{2,}\s*|\*\s*)/, '')
      .replace(/\s+$/, '');
  }

  function cellsOf(line) {
    return line.trim().split(/\s{2,}/).map((c) => trimPunct(stripDecor(c))).filter(Boolean);
  }

  function parseTables(lines, out) {
    for (let i = 0; i < lines.length - 1; i++) {
      const a = cellsOf(lines[i]);
      if (a.length < 2) continue;
      let j = i + 1;
      while (j < lines.length && j <= i + 2 && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const b = cellsOf(lines[j]);
      if (a.length !== b.length) continue;
      if (![...a, ...b].every((c) => balanceParens(c) === c && wordCount(c) <= 3)) continue;
      const sa = a.map(script), sb = b.map(script);
      let ru, az;
      if (sa.every((x) => x === 'c') && sb.every((x) => x === 'l')) { ru = a; az = b; }
      else if (sa.every((x) => x === 'l') && sb.every((x) => x === 'c')) { az = a; ru = b; }
      else continue;
      for (let k = 0; k < ru.length; k++) {
        splitAlternatives(makeCard(az[k], ru[k], 'ru', 'table', i + 1, null)).forEach((c) => out.push(c));
      }
    }
  }

  function parse(text) {
    const lines = normalizeText(text).split('\n').map(fixHomoglyphs);
    const raw = [];

    for (let li = 0; li < lines.length; li++) {
      const lineNo = li + 1;
      const line = preLine(lines[li]);
      if (!line.trim()) continue;
      let lastCard = null;

      for (let chunk of line.trim().split(/\s{3,}/)) {
        chunk = preLine(chunk);
        if (!chunk) continue;
        const sub = chunk.split(/\s*\/\/\s*/);
        const parts = sub.length > 1 && sub.filter((p) => SEP.test(' ' + p + ' ')).length >= 2 ? sub : [chunk];

        for (const part of parts) {
          const r = parsePairChunk(part, lineNo, 'dash', raw, 0);
          if (r.card) {
            const cards = splitAlternatives(r.card);
            cards.forEach((c) => raw.push(c));
            lastCard = cards[cards.length - 1];
            continue;
          }
          // пример к предыдущей паре, вынесенный через несколько пробелов
          const plain = stripDecor(part.replace(/[()]/g, ' '));
          if (lastCard && !lastCard.examples.length && script(plain) === 'l' &&
              wordCount(plain) >= 2 && AZ_ONLY.test(plain)) {
            lastCard.examples.push(plain);
          }
          // пары в скобках внутри обычного текста
          for (const inner of r.bag) {
            if (SEP.test(' ' + inner + ' ')) parseNested(stripDecor(restoreAttached(inner)), lineNo, raw);
          }
        }
      }
    }

    parseTables(lines, raw);
    return dedupe(raw);
  }

  function hashKey(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function normKey(s) {
    return s.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  }

  function meaningsOf(g) {
    return g.split(/\s*[;,]\s*|\s+\/\s+|\s+=\s+/).map((x) => x.trim()).filter(Boolean);
  }

  function dedupe(raw) {
    const map = new Map();
    const srcRank = { dash: 0, table: 1, nested: 2 };
    for (const c of raw) {
      const key = c.lang + '|' + normKey(c.az);
      const have = map.get(key);
      if (!have) {
        map.set(key, Object.assign({}, c, { id: hashKey(key), glosses: [c.gloss], examples: c.examples.slice(0, 2), notes: c.notes.slice(0, 2) }));
        continue;
      }
      if (srcRank[c.src] < srcRank[have.src]) {
        have.glosses.unshift(c.gloss);
        have.gloss = c.gloss;
        have.src = c.src;
      } else {
        have.glosses.push(c.gloss);
      }
      have.line = Math.max(have.line, c.line);
      for (const e of c.examples) if (have.examples.length < 2 && !have.examples.includes(e)) have.examples.push(e);
      for (const n of c.notes) if (have.notes.length < 2 && !have.notes.includes(n)) have.notes.push(n);
    }

    const cards = [];
    for (const c of map.values()) {
      const primary = meaningsOf(c.gloss).map(normKey);
      const seen = new Set(primary);
      const alts = [];
      for (const g of c.glosses.slice(1)) {
        for (const m of meaningsOf(g)) {
          const k = normKey(m);
          if (!seen.has(k) && wordCount(m) <= 4 && m.replace(/[^\p{L}]/gu, '').length >= 3) { seen.add(k); alts.push(m); }
        }
      }
      cards.push({
        id: c.id,
        az: c.az,
        gloss: c.gloss,
        alts: alts.slice(0, 5),
        meanings: [...seen],
        lang: c.lang,
        src: c.src,
        line: c.line,
        type: classify(c.az, c.gloss, c.lang),
        examples: c.examples,
        notes: c.notes.filter((n) => normKey(n) !== normKey(c.gloss)),
      });
    }
    return cards;
  }

  global.AzParser = { parse, azLower, PARSER_VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
