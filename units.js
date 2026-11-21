/*
 * Курс по блокам, как в Duolingo: смысловые темы (слова из конспекта и базовый словарь,
 * разложенные по темам) чередуются с грамматическими (предложения из конспекта, задания
 * на окончания и шпаргалка). Порядок — как в начальных учебниках азербайджанского:
 * звуки → «я есть» → гармония → принадлежность → падежи → времена → сложные формы.
 *
 * Смысловой блок: topic — код темы слов, phrases — тема разговорника.
 * Грамматический блок:
 *   drills — виды заданий на окончания (см. drills.js);
 *   sent   — какие предложения из уроков подходят: по теме разметки (topics) и/или по форме (re);
 *   focus  — какое слово убирать в задании «вставьте слово» (noCloze — таких заданий нет, только сборка);
 *   quiz   — готовые вопросы с вариантами (q, a — верный ответ, w — неверные);
 *   guide  — шпаргалка: абзацы (p) и примеры (ex: [азербайджанский, русский]).
 */
(function (global) {
  'use strict';

  // частые слова, которые только похожи на форму с окончанием (üçün — не «чей?», çətin — не «твой»)
  const PLAIN = /^(üçün|gün|bütün|lazım|yaxın|uzun|çətin|dərin|qadın|min|yəqin|mümkün|müəllim|həkim|qədim|yeni|kimi|bəzən|zaman|dükan|yalan|plan|heyvan|ünvan|haqqında|dünən|əsasən|təxminən|ümumən)$/;
  // местоимения в падежах: bundan, kimdə, onun, sizdə
  const PRON = /^(bun|on|kim|nəy|siz|biz|mən|sən)(lar|lər)?(un|ün|in|ım|im|dan|dən|da|də|a|ə|u|ü|i|ı)?$/;
  // глаголы на -d: их настоящее время (edir, gedir) выглядит как связка -dir
  const D_VERB = '(?:ed|ged|qayıd|eşid|unud|dad)[ıiuü]r';
  // «magic table»: слова-сигналы и окончания глагола после них (getsin, gedəsən, gedək, edim, alım).
  // -dım и -acaq в конце — это прошедшее и будущее время, а не форма из таблицы.
  const SIGNALS = ['qoy', 'gəl', 'gərək', 'olar'];
  const OPT_END = '(?:s[ıiuü]n(?:lar|lər)?|[aə]s[aə]n|[aə]s[ıi]n[ıi]z|(?<![a-zəğıöüşç])(?:ge|e)dim|(?<!d)[ıiuü]m|(?<!c)[aə][qk])';

  const UNITS = [
    {
      id: 'g-abc', kind: 'g', title: 'Буквы и звуки', sub: 'ə, ı, ö, ü, c, ç, ş, x, q, ğ', drills: [],
      guide: [
        { p: 'Алфавит латинский, 32 буквы. Читается всё, что написано, одна буква — один звук. Ударение обычно на последнем слоге.' },
        { ex: [
          ['ə — mən, gəl', 'открытое «э», между «а» и «э»'],
          ['ı — qız, altı', '«ы»'],
          ['ö — göz, dörd', '«ё» без «й», как немецкое ö'],
          ['ü — gül, üç', '«ю» без «й», как немецкое ü'],
          ['e — ev, yer', '«э»'],
          ['c — can, cavab', '«дж»'],
          ['ç — çay, çox', '«ч»'],
          ['ş — şəhər, beş', '«ш»'],
          ['j — jurnal', '«ж»'],
          ['x — xoş, yox', '«х»'],
          ['q — qapı, qız', 'звонкое твёрдое «г»'],
          ['ğ — dağ, oğul', 'мягкое «г» на выдохе, как украинское «г»'],
          ['g — gəl, gün', 'мягкое «гь»'],
          ['h — həkim, hava', 'лёгкий выдох'],
          ['y — yol, ay', '«й»'],
        ] },
        { p: 'k перед e, ə, i, ö, ü звучит мягко («кь»): kitab, kənd. В конце многосложных слов q и k перед гласной окончания переходят в ğ и y: otaq → otağa, çörək → çörəyi. В части заимствований k сохраняется: aptek → aptekə.' },
      ],
      quiz: [
        { q: 'Как читается буква c?', a: 'дж', w: ['ц', 'с', 'к'] },
        { q: 'Как читается буква ç?', a: 'ч', w: ['ц', 'щ', 'с'] },
        { q: 'Как читается буква ş?', a: 'ш', w: ['с', 'щ', 'ж'] },
        { q: 'Как читается буква ı (без точки)?', a: 'ы', w: ['и', 'й', 'э'] },
        { q: 'Как читается буква x?', a: 'х', w: ['кс', 'з', 'г'] },
        { q: 'Как читается буква q?', a: 'г (твёрдое, звонкое)', w: ['к', 'кв', 'х'] },
        { q: 'Как читается буква j?', a: 'ж', w: ['дж', 'й', 'з'] },
        { q: 'Как читается буква y?', a: 'й', w: ['ы', 'у', 'и'] },
        { q: 'Как читается буква ə?', a: 'между «а» и «э»', w: ['о', 'ы', 'йэ'] },
        { q: 'Как читается буква ü?', a: 'как «ю» без «й»', w: ['у', 'ы', 'и'] },
        { q: 'Как читается буква ö?', a: 'как «ё» без «й»', w: ['о', 'э', 'у'] },
        { q: 'Как читается буква ğ?', a: 'мягкое «г» на выдохе', w: ['к', 'ж', 'й'] },
        { q: 'Как прочитать слово çay?', a: 'чай', w: ['цай', 'сай', 'кай'] },
        { q: 'Как прочитать слово can?', a: 'джан', w: ['цан', 'кан', 'сан'] },
        { q: 'Как прочитать слово şəhər?', a: 'шэхэр', w: ['сехер', 'щахар', 'чэхэр'] },
        { q: 'Как прочитать слово qız?', a: 'гыз', w: ['киз', 'гиз', 'кыз'] },
        { q: 'Как прочитать слово yox?', a: 'йох', w: ['ёкс', 'ыох', 'йокс'] },
        { q: 'Как прочитать слово cavab?', a: 'джаваб', w: ['цаваб', 'каваб', 'саваб'] },
      ],
    },
    {
      id: 's-talk', kind: 's', title: 'Приветствия и общение', sub: 'salam, sağ ol, bəli, demək', topic: 'talk',
      guide: [
        { p: '«Ты» — sən, «вы» (вежливо или нескольким людям) — siz. С незнакомыми и старшими говорят siz.' },
        { p: '«Да» — bəli (вежливо) или hə (в разговоре). «Нет» — xeyr (вежливо) или yox.' },
        { ex: [['Necəsiniz?', 'Как вы поживаете?'], ['Sağ olun.', 'Спасибо (вам).'], ['Zəhmət olmasa.', 'Пожалуйста (когда просят).'], ['Buyurun.', 'Пожалуйста (когда подают или приглашают).']] },
      ],
    },
    {
      id: 'g-cop', kind: 'g', title: 'Я — врач, ты — дома', sub: 'связка: -am, -san, -dır', drills: ['cop'],
      sent: { re: new RegExp('(?<![a-zəğıöüşç])(?!' + D_VERB + ')[a-zəğıöüşç]+d[ıiuü]r(lar|lər)?[.!?]*$|deyil(əm|sən|ik|siniz|lər)?[.!?]*$', 'i'), maxLevel: 2 },
      focus: new RegExp('^(?!' + D_VERB + '$)[a-zəğıöüşç]+d[ıiuü]r(lar|lər)?$|^deyil'),
      guide: [
        { p: 'В азербайджанском «я есть, ты есть» — не отдельное слово, а окончание, которое присоединяется к слову.' },
        { ex: [['Mən həkiməm.', 'Я врач.'], ['Sən evdəsən.', 'Ты дома.'], ['O, müəllimdir.', 'Он учитель.'], ['Biz hazırıq.', 'Мы готовы.'], ['Siz məşğulsunuz?', 'Вы заняты?']] },
        { p: 'Гласная в окончании подстраивается под последнюю гласную слова. После гласной в формах «я» и «мы» вставляется y: yaxşıyam, evdəyik.' },
        { p: 'Отрицание — слово deyil с тем же окончанием.' },
        { ex: [['Mən həkim deyiləm.', 'Я не врач.'], ['Bu mənim deyil.', 'Это не моё.']] },
      ],
    },
    { id: 's-people', kind: 's', title: 'Люди и семья', sub: 'ana, qardaş, həkim, dost', topic: 'people' },
    {
      id: 'g-harm', kind: 'g', title: 'Гармония гласных', sub: '-lar / -lər, -ım / -im / -um / -üm', drills: ['pl', 'loc', 'my'],
      guide: [
        { p: 'Почти у всех окончаний есть варианты. Какой взять, решает последняя гласная слова.' },
        { p: 'Два варианта (a / ə): после a, ı, o, u — вариант с a, после e, ə, i, ö, ü — вариант с ə.' },
        { ex: [['kitablar', 'книги'], ['evlər', 'дома'], ['parkda', 'в парке'], ['şəhərdə', 'в городе']] },
        { p: 'Четыре варианта (ı / i / u / ü): после a, ı — ı; после e, ə, i — i; после o, u — u; после ö, ü — ü.' },
        { ex: [['qızım', 'моя дочь'], ['evim', 'мой дом'], ['dostum', 'мой друг'], ['gözüm', 'мой глаз']] },
      ],
    },
    {
      id: 's-num', kind: 's', title: 'Числа, цвета, размеры', sub: 'bir, iki, qırmızı, böyük', topic: 'num', drills: ['numw', 'numr'],
      guide: [
        { p: 'Число читается слева направо: тысячи, сотни, десятки, единицы.' },
        { ex: [['on bir', '11'], ['iyirmi beş', '25'], ['yüz əlli', '150'], ['iki min', '2000']] },
        { p: 'После числа существительное остаётся в единственном числе.' },
        { ex: [['üç kitab', 'три книги'], ['beş manat', 'пять манатов']] },
        { p: 'Порядковые: -ıncı / -inci / -uncu / -üncü (после гласной без первой гласной).' },
        { ex: [['birinci', 'первый'], ['ikinci', 'второй'], ['üçüncü', 'третий'], ['altıncı', 'шестой']] },
      ],
    },
    {
      id: 'g-poss', kind: 'g', title: 'Мой дом, у меня есть', sub: 'evim, maşınım var, yoxdur', drills: ['my', 'pl'],
      sent: { topics: ['possession'] },
      focus: {
        test(w) {
          if (/^(var|yox|yoxdur)$/.test(w)) return true;
          if (w.length < 4 || PLAIN.test(w) || PRON.test(w)) return false;
          return /([ıiuü]m|[ıiuü]n|s[ıiuü]|m[ıiuü]z|n[ıiuü]z)(d[aə]n?|[aəıiuü])?$/.test(w);
        },
      },
      guide: [
        { p: 'Чьё это — показывает окончание на самом предмете: -ım / -im / -um / -üm (после гласной -m) — мой, -ın / -in / -un / -ün (после гласной -n) — твой, -ı / -i / -u / -ü (после гласной -sı / -si / -su / -sü) — его, её.' },
        { ex: [['evim', 'мой дом'], ['evin', 'твой дом'], ['evi', 'его дом'], ['anam', 'моя мама'], ['anası', 'его мама'], ['maşınımız', 'наша машина']] },
        { p: '«У меня есть» строится через var, «нет» — через yox.' },
        { ex: [['Mənim maşınım var.', 'У меня есть машина.'], ['Mənim vaxtım yoxdur.', 'У меня нет времени.'], ['Sənin qardaşın var?', 'У тебя есть брат?']] },
      ],
    },
    { id: 's-food', kind: 's', title: 'Еда и напитки', sub: 'çörək, çay, yemək, dadlı', topic: 'food' },
    {
      id: 'g-case', kind: 'g', title: 'Где? Куда? Откуда?', sub: 'evdə, evə, evdən', drills: ['loc', 'dat', 'abl'],
      sent: { topics: ['cases'] },
      focus: /(d[aə]n?|y[aə])$/,
      guide: [
        { p: 'Вместо предлогов «в, на, из» — окончания.' },
        { ex: [['Mən evdəyəm.', 'Я дома. (где? -da / -də)'], ['Mən evə gedirəm.', 'Я иду домой. (куда? -a / -ə, после гласной -ya / -yə)'], ['Mən evdən gəlirəm.', 'Я иду из дома. (откуда? -dan / -dən)']] },
        { ex: [['Bakıda', 'в Баку (где)'], ['Bakıya', 'в Баку (куда)'], ['Bakıdan', 'из Баку']] },
        { p: 'В многосложных словах конечные q и k перед гласной меняются: otaq → otağa, çörək → çörəyə. В односложных и в части заимствований — нет: park → parka, aptek → aptekə.' },
      ],
    },
    { id: 's-city', kind: 's', title: 'Город и транспорт', sub: 'küçə, yol, getmək, dönmək', topic: 'city', phrases: 'taxi' },
    {
      id: 'g-order', kind: 'g', title: 'Порядок слов', sub: 'глагол в конце', drills: [], noCloze: true,
      sent: { maxLevel: 1 },
      guide: [
        { p: 'Глагол стоит в конце предложения. Обычный порядок: кто — когда — где — что — делает.' },
        { ex: [['Mən çay içirəm.', 'Я пью чай.'], ['Mən bu gün evdə kitab oxuyuram.', 'Я сегодня дома читаю книгу.']] },
        { p: 'Определение стоит перед словом, а вопросительное слово — там, где будет ответ.' },
        { ex: [['böyük ev', 'большой дом'], ['Sən nə içirsən?', 'Что ты пьёшь?']] },
      ],
    },
    { id: 's-home', kind: 's', title: 'Дом, вещи и доставка', sub: 'otaq, qapı, açar, paltar', topic: 'home', phrases: 'courier' },
    {
      id: 'g-pres', kind: 'g', title: 'Сейчас: -ır', sub: 'gəlirəm, işləyirsən, oxuyur', drills: ['pres'],
      sent: { topics: ['present'] },
      focus: /[ıiuü]r([aə]m|s[aə]n|[ıiuü][qk]|s[ıiuü]n[ıiuü]z|l[aə]r)?$/,
      guide: [
        { p: 'Настоящее время: основа глагола + -ır / -ir / -ur / -ür + лицо. Гласная выбирается по последней гласной основы: al-ır, gəl-ir, ol-ur, gör-ür. После гласной вставляется y: oxu-yur, işlə-yir.' },
        { ex: [['Mən işləyirəm.', 'Я работаю.'], ['Sən nə edirsən?', 'Что ты делаешь?'], ['O, kitab oxuyur.', 'Он читает книгу.'], ['Biz Bakıda yaşayırıq.', 'Мы живём в Баку.']] },
        { p: 'У getmək и etmək перед гласной t переходит в d: gedirəm, edirəm.' },
      ],
    },
    { id: 's-shop', kind: 's', title: 'Покупки и деньги', sub: 'pul, qiymət, almaq, ödəmək', topic: 'shop', phrases: 'shop' },
    {
      id: 'g-neg', kind: 'g', title: 'Не: -m-, deyil, yox', sub: 'bilmirəm, gəlmədi, deyil', drills: ['negp', 'negd'],
      sent: { re: /(m[ıiuü]r([aə]m|s[aə]n|[ıiuü][qk]|s[ıiuü]n[ıiuü]z|l[aə]r)?|m[aə]d[ıi](m|n|q|k|nız|niz|lar|lər)?|deyil(əm|sən|ik|siniz|lər)?|yoxdur|yox)[.,!?]*(\s|$)/i },
      focus: /m[ıiuü]r|m[aə]d[ıi]|^deyil|^yox/,
      guide: [
        { p: 'Отрицание глагола — -m- перед -ır или -ma / -mə перед остальными окончаниями.' },
        { ex: [['Mən bilmirəm.', 'Я не знаю.'], ['O, gəlmədi.', 'Он не пришёл.'], ['Getmə!', 'Не уходи!']] },
        { p: '«Не является» — deyil. «Нет в наличии» — yox, yoxdur.' },
        { ex: [['Bu mənim deyil.', 'Это не моё.'], ['Vaxtım yoxdur.', 'У меня нет времени.']] },
      ],
    },
    {
      id: 's-time', kind: 's', title: 'Время и календарь', sub: 'bu gün, sabah, saat, həftə', topic: 'time',
      guide: [
        { ex: [['Saat neçədir?', 'Который час?'], ['Saat beşdir.', 'Пять часов.'], ['Saat beşdə görüşək.', 'Давай встретимся в пять.'], ['Bu gün bazar ertəsidir.', 'Сегодня понедельник.']] },
        { p: '«В такой-то день» — название дня и günü: bazar günü — в воскресенье. «В таком-то месяце» — -da / -də: mayda — в мае.' },
      ],
    },
    {
      id: 'g-acc', kind: 'g', title: 'Кого? Чей?', sub: 'kitabı oxuyuram, evin qapısı', drills: ['acc', 'gen'],
      // пара «чей? + чьё» (evin qapısı, onun sözlərini) или «кого?» после гласной (qapını, onu)
      sent: { re: /(?<![a-zəğıöüşç])(?!(?:üçün|bütün|çətin|yaxın|uzun|gün|mümkün|dərin|qadın|yəqin)\s)[a-zəğıöüşç]{2,}(n[ıiuü]n|[^aeəiıoöuü][ıiuü]n)\s+[a-zəğıöüşç]{2,}(s[ıiuü]|[^aeəiıoöuü][ıiuü])(n(d[aə]n?|[aəıiuü]|[ıiuü]n))?[\s.,!?]|(?<![a-zəğıöüşç])(?!yeni)[a-zəğıöüşç]+[aeəiıoöuü]n[ıiuü](?=[\s.,!?])/i, maxLevel: 2 },
      // «кого?» после гласной видно сразу (qapını, məni), а «чей?» — только в паре: evin qapısı
      focus: {
        test(w, i, all) {
          if (PLAIN.test(w)) return false;
          if (/[aeəiıoöuü]n[ıiuü]$/.test(w)) return true;
          return w.length >= 4 && /(n[ıiuü]n|[^aeəiıoöuü][ıiuü]n)$/.test(w) && !!all && i + 1 < all.length &&
            /(s[ıiuü]|[^aeəiıoöuü][ıiuü])(n(d[aə]n?|[aəıiuü]|[ıiuü]n))?$/.test(all[i + 1]);
        },
      },
      guide: [
        { p: 'Определённый объект действия («именно эту книгу») получает -ı / -i / -u / -ü, после гласной -nı / -ni / -nu / -nü.' },
        { ex: [['Mən kitab oxuyuram.', 'Я читаю книгу (какую-то).'], ['Mən kitabı oxuyuram.', 'Я читаю эту книгу.'], ['Qapını bağla.', 'Закрой дверь.']] },
        { p: '«Чей?» — -ın / -in / -un / -ün (после гласной -nın…), а у самого предмета — окончание «его».' },
        { ex: [['evin qapısı', 'дверь дома'], ['Anarın maşını', 'машина Анара'], ['dostumun adı', 'имя моего друга']] },
      ],
    },
    { id: 's-work', kind: 's', title: 'Работа и учёба', sub: 'iş, sənəd, iclas, öyrənmək', topic: 'work' },
    {
      id: 'g-past', kind: 'g', title: 'Вчера: -dı', sub: 'gəldim, aldın, getdik', drills: ['past'],
      sent: { topics: ['past'] },
      focus: /d[ıiuü](m|n|q|k|n[ıiuü]z|l[aə]r)?$|^idi/,
      guide: [
        { p: 'Прошедшее время: основа + -dı / -di / -du / -dü + лицо (-m, -n, —, -q / -k, -nız / -niz / -nuz / -nüz, -lar / -lər).' },
        { ex: [['Mən gəldim.', 'Я пришёл.'], ['Sən nə aldın?', 'Что ты купил?'], ['O, mənə zəng etdi.', 'Он мне позвонил.'], ['Biz kinoya getdik.', 'Мы ходили в кино.']] },
        { p: '«Был» — idi, «было, имелось» — var idi.' },
        { ex: [['O, evdə idi.', 'Он был дома.'], ['Vaxtım var idi.', 'У меня было время.']] },
      ],
    },
    { id: 's-health', kind: 's', title: 'Тело и здоровье', sub: 'baş, əl, həkim, ağrımaq', topic: 'health' },
    {
      id: 'g-q', kind: 'g', title: 'Вопросы', sub: 'kim, nə, harada, niyə, neçə', drills: [],
      sent: { re: /\?\s*$/, maxLevel: 2 },
      focus: /^(kim|nə|hara|harada|haradan|haraya|niyə|necə|neçə|hansı|nəyə|kimin|kimi|kimə|nədən|haçan)/,
      guide: [
        { p: 'Вопросительные слова: kim — кто, nə — что, harada — где, hara — куда, haradan — откуда, nə vaxt — когда, niyə — почему, necə — как, neçə — сколько, hansı — какой.' },
        { p: 'Порядок слов как в обычной фразе: вопросительное слово стоит там, где будет ответ.' },
        { ex: [['Sən harada yaşayırsan?', 'Где ты живёшь?'], ['Bu neçəyədir?', 'Сколько это стоит?'], ['Siz nə vaxt gələcəksiniz?', 'Когда вы придёте?']] },
        { p: 'Вопрос «да или нет» задаётся интонацией или частицей -mı / -mi / -mu / -mü.' },
        { ex: [['Bu sənindir?', 'Это твоё?'], ['Bu sənindirmi?', 'Это твоё? (то же с частицей)']] },
      ],
    },
    { id: 's-feel', kind: 's', title: 'Чувства и характер', sub: 'sevinmək, kədərli, mehriban', topic: 'feel' },
    {
      id: 'g-fut', kind: 'g', title: 'Завтра: -acaq', sub: 'gələcəyəm, alacaqsan, gedəcək', drills: ['fut'],
      sent: { topics: ['future'] },
      focus: /[aə]c[aə][qkğy]/,
      guide: [
        { p: 'Будущее время: основа + -acaq / -əcək + лицо. После гласной вставляется y: oxu-yacaq. В формах «я» и «мы» q → ğ, k → y.' },
        { ex: [['Mən sabah gələcəyəm.', 'Я приду завтра.'], ['Sən nə alacaqsan?', 'Что ты купишь?'], ['O, zəng edəcək.', 'Он позвонит.'], ['Biz gedəcəyik.', 'Мы пойдём.']] },
      ],
    },
    { id: 's-nature', kind: 's', title: 'Природа и погода', sub: 'hava, yağış, dəniz, it', topic: 'nature' },
    {
      id: 'g-imp', kind: 'g', title: 'Просьбы и пожелания', sub: 'gəl, verin, getmə, gedək', drills: [],
      sent: { topics: ['imperative'] },
      focus: /([ıiuü]n|m[aə]|m[aə]y[ıi]n|[aə][qk]|s[ıiuü]n)[.,!]*$|^(qoy|gəl|gəlin)$/,
      guide: [
        { p: 'Просьба к одному человеку — просто основа глагола: gəl — приди, ver — дай. Вежливо или к нескольким людям — -ın / -in / -un / -ün (после гласной -yın / -yin / -yun / -yün): gəlin, verin, oxuyun.' },
        { p: 'Запрет — -ma / -mə: getmə — не уходи, getməyin — не уходите.' },
        { p: '«Давай(те)» — -aq / -ək: gedək — пойдём. «Пусть» — qoy и глагол на -sın.' },
        { ex: [['Zəhmət olmasa, burada saxlayın.', 'Пожалуйста, остановите здесь.'], ['Gəl, çay içək.', 'Давай попьём чаю.'], ['Narahat olma.', 'Не волнуйся.'], ['Qoy gəlsin.', 'Пусть придёт.']] },
      ],
    },
    {
      // «Magic table» из конспекта: одна таблица окончаний на «давай», «пусть», «следует», «можно» и «чтобы»
      id: 'g-magic', kind: 'g', title: 'Magic table: давай, пусть, чтобы', sub: 'gəl gedək, qoy gəlsin, gərək biləsən',
      drills: ['opt'], quizPer: 3,
      // фраза начинается со слова-сигнала или содержит «ki,», а кончается глаголом с окончанием из таблицы
      sent: { re: new RegExp('^(?=(qoy|gəl|gəlin|gərək|olar)[\\s,]|.*\\ski,?\\s).*' + OPT_END + '[.!?]*$', 'i') },
      // пропуск — либо слово-сигнал в начале, либо глагол в конце
      focus: {
        random: true,
        test(w, i, all) {
          if (i === 0) return SIGNALS.includes(w) || w === 'gəlin';
          return !!all && i === all.length - 1 && new RegExp(OPT_END + '$').test(w);
        },
      },
      variants(w) {
        if (SIGNALS.includes(w)) return SIGNALS.filter((x) => x !== w);
        if (w === 'gəlin') return SIGNALS.filter((x) => x !== 'gəl');
        return global.AzGrammar ? global.AzGrammar.optForms(w) : [];
      },
      guide: [
        { p: 'Одна таблица окончаний работает сразу в пяти случаях: «давай», «пусть / позволь», «следует», «можно?» и «чтобы». В начале фразы стоит слово-сигнал, в конце — глагол с окончанием по лицу.' },
        { ex: [
          ['Gəl … / Gəlin …', 'давай / давайте'],
          ['Qoy …', 'пусть, позволь, разреши'],
          ['Gərək …', 'следует, надо бы'],
          ['Olar …?', 'можно …?'],
          ['… ki, …', '…, чтобы …'],
        ] },
        { p: 'Окончания. Гласная выбирается по гармонии; если основа кончается на гласную, перед гласной окончания вставляется y: oxu-y-um, но oxu-sun.' },
        { ex: [
          ['mən — gedim, alım, oxuyum', '-ım / -im / -um / -üm'],
          ['sən — gedəsən, alasan, oxuyasan', '-asan / -əsən'],
          ['o — getsin, alsın, oxusun', '-sın / -sin / -sun / -sün'],
          ['biz — gedək, alaq, oxuyaq', '-aq / -ək'],
          ['siz — gedəsiniz, alasınız, oxuyasınız', '-asınız / -əsiniz'],
          ['onlar — getsinlər, alsınlar, oxusunlar', '-sınlar / -sinlər / -sunlar / -sünlər'],
        ] },
        { ex: [
          ['Gəl birlikdə işləyək!', 'Давай работать вместе!'],
          ['Qoy o, axşam zəng vursun.', 'Пусть он позвонит вечером.'],
          ['Qoy mən sənə kömək edim.', 'Позволь, я тебе помогу.'],
          ['Gərək siz diqqətli olasınız.', 'Вам следует быть внимательными.'],
          ['Olar, biz girək?', 'Можно нам войти?'],
          ['Mən istəyirəm ki, sən ora gedəsən.', 'Я хочу, чтобы ты пошёл туда.'],
        ] },
        { p: 'Отрицание — -ma / -mə перед окончанием: Qoy o gəlməsin — пусть он не приходит. Bacım xahiş etdi ki, onlar gecikməsinlər — сестра попросила, чтобы они не опаздывали.' },
        { p: 'У getmək и etmək перед гласной t переходит в d: gedim, gedək, edəsən, но getsin, etsin.' },
      ],
      quiz: [
        { q: 'С какого слова начинается «Давай…»?', a: 'Gəl', w: ['Qoy', 'Gərək', 'Olar'] },
        { q: 'С какого слова начинается «Пусть он…» или «Позволь мне…»?', a: 'Qoy', w: ['Gəl', 'Gərək', 'Olar'] },
        { q: 'С какого слова начинается «Тебе следует…»?', a: 'Gərək', w: ['Qoy', 'Gəl', 'Olar'] },
        { q: 'С какого слова начинается «Можно я…?»', a: 'Olar', w: ['Qoy', 'Gəl', 'Gərək'] },
        { q: 'Как начать «Я хочу, чтобы ты…»?', a: 'Mən istəyirəm ki, sən …', w: ['Mən istəyirəm üçün sən …', 'Mən istəyirəm çünki sən …', 'Mən istəyirəm əgər sən …'] },
        { q: 'Какое окончание в magic table у «biz»?', a: '-aq / -ək', w: ['-sın / -sin', '-asan / -əsən', '-ım / -im'] },
        { q: 'Какое окончание в magic table у «o»?', a: '-sın / -sin / -sun / -sün', w: ['-aq / -ək', '-asan / -əsən', '-ım / -im / -um / -üm'] },
        { q: 'Какое окончание в magic table у «sən»?', a: '-asan / -əsən', w: ['-sın / -sin', '-aq / -ək', '-asınız / -əsiniz'] },
        { q: 'Какое окончание в magic table у «mən»?', a: '-ım / -im / -um / -üm', w: ['-aq / -ək', '-sın / -sin / -sun / -sün', '-asan / -əsən'] },
        { q: '«Пусть он придёт»: Qoy o … (gəlmək)', a: 'gəlsin', w: ['gələk', 'gələsən', 'gəlim'] },
        { q: '«Давай пойдём»: Gəl … (getmək)', a: 'gedək', w: ['getsin', 'gedim', 'gedəsən'] },
        { q: '«Тебе следует знать»: Gərək sən … (bilmək)', a: 'biləsən', w: ['bilsin', 'bilək', 'bilim'] },
        { q: '«Позволь, я скажу»: Qoy mən … (demək)', a: 'deyim', w: ['desin', 'deyək', 'deyəsən'] },
        { q: '«Пусть они подождут»: Qoy onlar … (gözləmək)', a: 'gözləsinlər', w: ['gözləyək', 'gözləyəsiniz', 'gözləyim'] },
        { q: '«Вам следует быть внимательными»: Gərək siz diqqətli … (olmaq)', a: 'olasınız', w: ['olsunlar', 'olaq', 'olasan'] },
        { q: '«Можно мы войдём?»: Olar, biz … (girmək)', a: 'girək', w: ['girsin', 'girim', 'girəsiniz'] },
        { q: 'Как сказать «Пусть он не приходит»?', a: 'Qoy o gəlməsin.', w: ['Qoy o gəlmir.', 'Qoy o gəlmədi.', 'Qoy o gəlməyək.'] },
        { q: 'Как сказать «Я хочу, чтобы вы это прочитали»?', a: 'Mən istəyirəm ki, siz bunu oxuyasınız.', w: ['Mən istəyirəm ki, siz bunu oxusun.', 'Mən istəyirəm ki, siz bunu oxuyaq.', 'Mən istəyirəm ki, siz bunu oxuyursunuz.'] },
      ],
    },
    { id: 's-act', kind: 's', title: 'Действия', sub: 'etmək, başlamaq, dəyişmək', topic: 'act' },
    {
      id: 'g-modal', kind: 'g', title: 'Хочу, нужно, можно, могу', sub: 'istəyirəm, lazımdır, olar', drills: [],
      sent: { topics: ['modal'] },
      focus: /^(lazım|gərək|olar|olmaz)|bil(ər|mir|mər|ir|di)|m[aə]l[ıi]|^istə/,
      guide: [
        { ex: [
          ['Mən getmək istəyirəm.', 'Я хочу пойти. (глагол на -maq / -mək и istəmək — хотеть)'],
          ['Mənə kömək lazımdır.', 'Мне нужна помощь. (lazımdır — нужно)'],
          ['Mən getməliyəm.', 'Я должен идти. (-malı / -məli — должен)'],
          ['Burada siqaret çəkmək olar?', 'Здесь можно курить? (olar — можно, olmaz — нельзя)'],
          ['Mən gələ bilərəm.', 'Я могу прийти. (-a / -ə bilmək — мочь)'],
          ['Mən gələ bilmirəm.', 'Я не могу прийти.'],
        ] },
      ],
    },
    { id: 's-qual', kind: 's', title: 'Качества', sub: 'yaxşı, çətin, tez, yavaş', topic: 'qual' },
    {
      id: 'g-post', kind: 'g', title: 'Послелоги', sub: 'üçün, ilə, haqqında, sonra', drills: [],
      sent: { re: /(^|\s)(üçün|ilə|haqqında|barədə|sonra|əvvəl|qədər|kimi|görə)[\s.,!?]/i },
      focus: /^(üçün|ilə|haqqında|sonra|əvvəl|qədər|kimi|görə)$/,
      guide: [
        { p: 'В азербайджанском не предлоги, а послелоги: они стоят после слова.' },
        { ex: [['sənin üçün', 'для тебя'], ['dostum ilə', 'с моим другом'], ['iş haqqında', 'о работе'], ['dərsdən sonra', 'после урока'], ['yeməkdən əvvəl', 'перед едой'], ['axşama qədər', 'до вечера'], ['sənin kimi', 'как ты'], ['buna görə', 'поэтому']] },
        { p: 'Некоторые послелоги требуют падежа: sonra и əvvəl — «откуда» (-dan / -dən), qədər и görə — «куда» (-a / -ə).' },
      ],
    },
    { id: 's-func', kind: 's', title: 'Служебные слова', sub: 'amma, çünki, üçün, hələ', topic: 'func' },
    {
      id: 'g-cmp', kind: 'g', title: 'Сравнение: daha, ən', sub: 'daha yaxşı, ən böyük', drills: [],
      sent: { re: /(^|\s)(daha|ən)\s/i },
      focus: /^(daha|ən)$|d[aə]n$/,
      guide: [
        { p: 'daha — «более», ən — «самый». «Чем» выражается окончанием -dan / -dən у того, с чем сравнивают.' },
        { ex: [['Bu daha ucuzdur.', 'Это дешевле.'], ['Bakı Gəncədən böyükdür.', 'Баку больше Гянджи.'], ['Bu ən yaxşı restorandır.', 'Это самый лучший ресторан.']] },
      ],
    },
    {
      id: 'g-perf', kind: 'g', title: 'Уже сделал: -mış, -ıb', sub: 'baxmışam, gəlib, yemisən', drills: [],
      // vacibdir, səbəbdir — не перфект, хотя кончаются на -ibdir
      sent: { re: /(?<![a-zəğıöüşç])(?!vacib|səbəb|cavab|kitab)[a-zəğıöüşç]+(m[ıiuü]ş([aə]m|s[aə]n|d[ıiuü]r|[ıiuü][qk]|s[ıiuü]n[ıiuü]z|l[aə]r)?|[^aeəiıoöuü][ıiuü]b(s[aə]n|d[ıiuü]r|l[aə]r)?)[.!?]*$/i },
      focus: /^(?!vacib|səbəb|cavab|kitab).+(m[ıiuü]ş|[ıiuü]b(s[aə]n|d[ıiuü]r|l[aə]r)?$)/,
      guide: [
        { p: 'Результат к настоящему моменту («уже сделал») — -mış / -miş / -muş / -müş и лицо; во втором лице ş обычно выпадает: yemisən, gəlmisiniz. В разговоре во втором и третьем лице чаще -ıb / -ib / -ub / -üb.' },
        { ex: [['Mən bu filmə baxmışam.', 'Я (уже) смотрел этот фильм.'], ['O gəlib.', 'Он пришёл (и сейчас здесь).'], ['Sən yemək yemisən?', 'Ты поел?']] },
      ],
    },
    {
      id: 'g-cond', kind: 'g', title: 'Если: -sa', sub: 'gəlsəm, olsa, bilsəydim', drills: [],
      sent: { topics: ['conditional'] },
      focus: /s[aə](m|n|q|k|n[ıi]z|l[aə]r)?$|s[aə]yd[ıi]|^əgər$/,
      guide: [
        { p: 'Условие: основа + -sa / -sə + лицо (-m, -n, —, -q / -k, -nız / -niz, -lar / -lər). Слово əgər («если») можно поставить в начало, но оно не обязательно.' },
        { ex: [['Vaxtım olsa, gələrəm.', 'Если будет время, приду.'], ['Əgər yağış yağsa, evdə qalacağıq.', 'Если пойдёт дождь, останемся дома.'], ['Bilsəydim, deyərdim.', 'Если бы знал, сказал бы.']] },
      ],
    },
    {
      id: 'g-rel', kind: 'g', title: 'Который: -an, -dığı', sub: 'gələn adam, oxuduğum kitab', drills: [],
      sent: { topics: ['relative'] },
      // причастия: oxuduğum, gələn (но не mən, gedəsən, evdən и не слова вроде zaman)
      focus: {
        test(w) {
          if (/d[ıiuü][ğy]/.test(w) || w === 'ki') return true;
          return w.length >= 4 && !PLAIN.test(w) && !/(s[aə]n|d[aə]n)$/.test(w) && /[^aeəiıoöuü][aə]n$/.test(w);
        },
      },
      guide: [
        { p: 'Вместо слова «который» — причастие перед существительным.' },
        { ex: [['gələn adam', 'человек, который пришёл (-an / -ən: кто сам делает)'], ['oxuduğum kitab', 'книга, которую я читаю (-dığ- и «чей»: что с этим делают)'], ['Sənin dediyin düzdür.', 'То, что ты сказал, верно.']] },
        { p: '«Что» в придаточном — ki.' },
        { ex: [['Bilirəm ki, o gələcək.', 'Я знаю, что он придёт.']] },
      ],
    },
    {
      id: 'g-conv', kind: 'g', title: 'Когда, сделав: -anda, -ıb', sub: 'gələndə, yeyib, işləyərək', drills: [],
      sent: { topics: ['converb'] },
      focus: /([ıiuü]b|[aə]r[aə][qk]|[aə]nd[aə]|m[aə]d[aə]n|d[ıiuü]qd[aə]|[aə]rkən)$/,
      guide: [
        { ex: [
          ['Evə gələndə zəng et.', 'Когда придёшь домой, позвони. (-anda / -əndə — когда)'],
          ['Yeməyi yeyib getdi.', 'Поев, он ушёл. (-ıb / -ib / -ub / -üb — сделав)'],
          ['Fikirləşmədən cavab verdi.', 'Он ответил не подумав. (-madan / -mədən — не сделав)'],
          ['İşləyərək öyrənirəm.', 'Учусь, работая. (-araq / -ərək — делая)'],
        ] },
      ],
    },
    {
      id: 'g-voice', kind: 'g', title: 'Сделано и «попросил сделать»', sub: 'açıldı, oxunur, kəsdirdim', drills: [],
      sent: { topics: ['voice'] },
      // açıldı, oxunur, etdirdim, təmizlətdi — после суффикса залога обязательно идёт время
      focus: /[ıiuü]l(d[ıiuü]|[ıiuü]r|m[ıiuü]ş|[aə]c[aə][qk])|[ıiuü]n[ıiuü]r|d[ıiuü]r(d[ıiuü]|[ıiuü]r|m[ıiuü]ş|[aə]c[aə][qk])|.{3}[aə]td[ıiuü]/,
      guide: [
        { ex: [
          ['Qapı açıldı.', 'Дверь открылась. (-ıl / -il / -ul / -ül, после l — -ın, после гласной — -n: «сделано»)'],
          ['Bu kitab çox oxunur.', 'Эту книгу много читают.'],
          ['Mən saçımı kəsdirdim.', 'Я постригся, то есть дал себя постричь. (-dır / -dir / -dur / -dür, после гласной -t: «попросить, заставить сделать»)'],
        ] },
      ],
    },
    { id: 's-abstract', kind: 's', title: 'Общество и понятия', sub: 'səbəb, nəticə, şərt, mədəniyyət', topic: 'abstract' },
    { id: 's-idiom', kind: 's', title: 'Выражения', sub: 'готовые фразы и идиомы', topic: 'idiom', sent: { topics: ['idiom'] } },
    { id: 's-misc', kind: 's', title: 'Новое из конспекта', sub: 'слова, которые ещё не разложены по темам', topic: 'misc' },
  ];

  const byId = new Map(UNITS.map((u) => [u.id, u]));

  global.AzUnits = { UNITS, byId };
})(typeof window !== 'undefined' ? window : globalThis);
