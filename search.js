// 搜索模块：独立于 Electron，便于单独测试。
// fetchImpl 由调用方注入（Electron 主进程传 net.fetch，测试脚本传全局 fetch）。
const { parse } = require('node-html-parser');

const MAX_RESULTS = 30;
const SEARCH_TIMEOUT = 15000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 常见 galgame 缩写/俗称 -> 全名列表（按顺序尝试；匹配时不区分大小写，并忽略空格/符号）。
// 大部分已内置本地，联网索引仅作补充。每项可配多个写法（英文全名 + 中文名 + 日文名），适配各网站。
const ABBREVIATIONS = {
  // ---------- Key / VisualArts ----------
  cl: ['CLANNAD'],
  lb: ['Little Busters!'],
  lbex: ['Little Busters! EX'],
  kud: ['Kud Wafter'],
  rew: ['Rewrite'],
  罚抄: ['Rewrite'],
  air: ['AIR'],
  kanon: ['Kanon'],
  雪之少女: ['Kanon'],
  sp: ['Summer Pockets'],
  夏兜: ['Summer Pockets'],
  夏日口袋: ['Summer Pockets'],
  星之梦: ['Planetarian', 'planetarian 〜ちいさなほしのゆめ〜'],
  charlotte: ['Charlotte'],
  ab: ['Angel Beats!'],
  // ---------- TYPE-MOON ----------
  fsn: ['Fate/stay night'],
  fha: ['Fate/hollow ataraxia'],
  fgo: ['Fate/Grand Order'],
  fz: ['Fate/Zero'],
  fe: ['Fate/EXTRA'],
  命运之夜: ['Fate/stay night'],
  月姬: ['Tsukihime', '月姫'],
  魔夜: ['Mahoutsukai no Yoru', '魔法使いの夜'],
  mahoyo: ['Mahoutsukai no Yoru'],
  tsukihime: ['Tsukihime'],
  空境: ['Kara no Kyoukai', '空之境界'],
  空之境界: ['Kara no Kyoukai'],
  // ---------- 白学（Leaf） ----------
  wa1: ['WHITE ALBUM', '白色相簿'],
  wa2: ['WHITE ALBUM 2', '白色相簿2'],
  白1: ['WHITE ALBUM', '白色相簿'],
  白2: ['WHITE ALBUM 2', '白色相簿2'],
  白学: ['WHITE ALBUM 2', '白色相簿2'],
  // ---------- Muv-Luv ----------
  muv: ['Muv-Luv'],
  muvluv: ['Muv-Luv'],
  mla: ['Muv-Luv Alternative'],
  // ---------- SciADV（5pb/MAGES） ----------
  sg: ['STEINS;GATE'],
  's;g': ['STEINS;GATE'],
  石头门: ['STEINS;GATE', '命运石之门'],
  命运石之门: ['STEINS;GATE'],
  sg0: ['STEINS;GATE 0'],
  石头门0: ['STEINS;GATE 0'],
  命运石之门0: ['STEINS;GATE 0'],
  'c;h': ['Chaos;Head'],
  混沌之脑: ['Chaos;Head'],
  'c;c': ['Chaos;Child'],
  混沌之子: ['Chaos;Child'],
  'r;n': ['Robotics;Notes'],
  'o;n': ['Occultic;Nine'],
  'a;c': ['Anonymous;Code'],
  // ---------- 柚子社 Yuzusoft ----------
  千恋万花: ['Senren Banka', '千恋＊万花'],
  千恋: ['Senren Banka', '千恋＊万花'],
  魔女夜宴: ['Sanoba Witch', 'サノバウィッチ'],
  魔宴: ['Sanoba Witch', 'サノバウィッチ'],
  sanoba: ['Sanoba Witch'],
  サノバウィッチ: ['Sanoba Witch', 'サノバウィッチ'],
  dri: ['DRACU-RIOT!'],
  天神乱漫: ['Amatsukaze Ranman', '天神乱漫'],
  夏空彼方: ['Natsukage Kanata', '夏空カナタ'],
  天色: ['Amairo Islenauts', '天色＊アイルノーツ'],
  星光咖啡: ['Cafe Stella to Shinigami no Chou', '喫茶ステラと死神の蝶', '星光咖啡馆与死神之蝶'],
  星光咖啡馆: ['Cafe Stella to Shinigami no Chou', '喫茶ステラと死神の蝶', '星光咖啡馆与死神之蝶'],
  咖啡馆死神: ['Cafe Stella to Shinigami no Chou', '喫茶ステラと死神の蝶'],
  死神之蝶: ['Cafe Stella to Shinigami no Chou', '喫茶ステラと死神の蝶'],
  rj: ['RIDDLE JOKER'],
  谜题小丑: ['RIDDLE JOKER'],
  天使: ['Tenshi Souzou RE-BOOT!', '天使☆騒々RE-BOOT!'],
  天使骚骚: ['Tenshi Souzou RE-BOOT!', '天使☆騒々RE-BOOT!'],
  // ---------- AUGUST ----------
  fa: ['FORTUNE ARTERIAL'],
  夜明: ['Yoake Mae yori Ruriiro na', '夜明け前より瑠璃色な'],
  夜明け: ['Yoake Mae yori Ruriiro na', '夜明け前より瑠璃色な'],
  秽翼: ['Aiyoku no Eustia', '穢翼のユースティア'],
  穢翼: ['Aiyoku no Eustia', '穢翼のユースティア'],
  大图书馆: ['Oushitsu Kyoushi Haine', '大図書館の羊飼い'],
  大图: ['Oushitsu Kyoushi Haine', '大図書館の羊飼い'],
  大图书馆的牧羊人: ['Oushitsu Kyoushi Haine', '大図書館の羊飼い'],
  // ---------- minori ----------
  ef: ['ef - a fairy tale of the two'],
  eden: ['eden*'],
  // ---------- Nitro+ ----------
  沙耶: ['Saya no Uta'],
  沙耶之歌: ['Saya no Uta'],
  saya: ['Saya no Uta'],
  sayanouta: ['Saya no Uta'],
  村正: ['Soukou Akki Muramasa', '装甲悪鬼村正', 'Full Metal Daemon Muramasa'],
  装甲恶鬼村正: ['Soukou Akki Muramasa', '装甲悪鬼村正'],
  鬼哭街: ['Kikokugai', '鬼哭街'],
  君彼女: ['Kimi to Kanojo to Kanojo no Koi', '君と彼女と彼女の恋'],
  你与她与她的恋爱: ['Kimi to Kanojo to Kanojo no Koi', '君と彼女と彼女の恋'],
  // ---------- Alicesoft ----------
  兰斯: ['Rance', 'ランス'],
  rance: ['Rance'],
  兰斯10: ['Rance X', 'ランス10'],
  夏娃: ['Evenicle', 'イブニクル'],
  夏娃年代记: ['Evenicle', 'イブニクル'],
  evenicle: ['Evenicle'],
  // ---------- Eushully ----------
  战女神: ['Ikusa Megami', '戦女神'],
  魔导巧壳: ['Madou Koukaku', '魔導巧殻'],
  // ---------- Leaf / Aquaplus ----------
  th: ['ToHeart'],
  toheart: ['ToHeart'],
  th2: ['ToHeart2'],
  toheart2: ['ToHeart2'],
  传颂之物: ['Utawarerumono', 'うたわれるもの'],
  传颂: ['Utawarerumono', 'うたわれるもの'],
  うたわれ: ['Utawarerumono', 'うたわれるもの'],
  utaware: ['Utawarerumono'],
  // ---------- Frontwing ----------
  灰色: ['Grisaia', 'グリザイア'],
  灰色的果实: ['Grisaia no Kajitsu', 'グリザイアの果実'],
  灰色的迷宫: ['Grisaia no Meikyuu', 'グリザイアの迷宮'],
  灰色的乐园: ['Grisaia no Rakuen', 'グリザイアの楽園'],
  grisaia: ['Grisaia no Kajitsu'],
  // ---------- sprite ----------
  苍彼: ['Aokana', '蒼の彼方のフォーリズム', '苍之彼方的四重奏'],
  苍之彼方: ['Aokana', '蒼の彼方のフォーリズム', '苍之彼方的四重奏'],
  苍之彼方的四重奏: ['Aokana', '蒼の彼方のフォーリズム'],
  aokana: ['Aokana'],
  // ---------- Circus ----------
  dc: ['D.C. 〜Da Capo〜', '初音岛'],
  初音岛: ['D.C. 〜Da Capo〜'],
  dc2: ['D.C.II 〜Da Capo II〜'],
  // ---------- 07th Expansion ----------
  寒蝉: ['Higurashi no Naku Koro ni', 'ひぐらしのなく頃に', '寒蝉鸣泣之时'],
  寒蝉鸣泣之时: ['Higurashi no Naku Koro ni', 'ひぐらしのなく頃に'],
  海猫: ['Umineko no Naku Koro ni', 'うみねこのなく頃に', '海猫鸣泣之时'],
  海猫鸣泣之时: ['Umineko no Naku Koro ni', 'うみねこのなく頃に'],
  // ---------- Neko Works ----------
  neko: ['NEKOPARA', 'ネコぱら'],
  nekopara: ['NEKOPARA', 'ネコぱら'],
  猫娘乐园: ['NEKOPARA', 'ネコぱら'],
  巧克力与香子兰: ['NEKOPARA', 'ネコぱら'],
  猫帕拉: ['NEKOPARA', 'ネコぱら'],
  // ---------- 其他经典/热门 ----------
  缘之空: ['Yosuga no Sora', '緣之空'],
  星空列车: ['星空列车与白的旅行', 'Hoshizora Tetsudou to Shiro no Tabi'],
  星白: ['星空列车与白的旅行', 'Hoshizora Tetsudou to Shiro no Tabi'],
  巧2: ['巧克甜恋2', 'Amairo Chocolata 2'],
  巧1: ['巧克甜恋', 'Amairo Chocolata'],
  巧克甜恋: ['あまいろショコラータ', 'Amairo Chocolata'],
  巧克甜恋2: ['あまいろショコラータ2', 'Amairo Chocolata 2'],
  多娜多娜: ['Dohna Dohna', 'ドーナドーナ', '多娜多娜 一起干坏事吧'],
  dohna: ['Dohna Dohna', 'ドーナドーナ'],
  勇战: ['Monster Girl Quest', 'もんむす・クエスト', '勇者大战魔物娘'],
  勇者大战魔物娘: ['Monster Girl Quest', 'もんむす・クエスト'],
  mgq: ['Monster Girl Quest'],
  妹调: ['Imouto Chousetsu Nikki', '妹調教日記', '妹调教日记'],
  万华镜: ['Bishoujo Mangekyou', '美少女万華鏡', '美少女万华镜'],
  美少女万华镜: ['Bishoujo Mangekyou', '美少女万華鏡'],
  爱上火车: ['Maitetsu', 'まいてつ'],
  火车: ['Maitetsu', 'まいてつ'],
  maitetsu: ['Maitetsu'],
  '9nine': ['9-nine-', '9-nine-ここのつここのかここのいろ'],
  '九-nine': ['9-nine-', '9-nine-ここのつここのかここのいろ'],
  纸魔: ['Kami no Ue no Mahoutsukai', '紙の上の魔法使い', '纸上的魔法使'],
  纸上的魔法使: ['Kami no Ue no Mahoutsukai', '紙の上の魔法使い'],
  樱之诗: ['Sakura no Uta', 'サクラノ詩'],
  樱诗: ['Sakura no Uta', 'サクラノ詩'],
  樱之刻: ['Sakura no Toki', 'サクラノ刻'],
  樱刻: ['Sakura no Toki', 'サクラノ刻'],
  素晴日: ['Subarashiki Hibi', '素晴らしき日々'],
  美好的每一天: ['Subarashiki Hibi', '素晴らしき日々'],
  ddlc: ['Doki Doki Literature Club!'],
  心跳文学部: ['Doki Doki Literature Club!'],
  纯白: ['Mashiroiro Symphony', 'ましろ色シンフォニー', '纯白交响曲'],
  纯白交响曲: ['Mashiroiro Symphony', 'ましろ色シンフォニー'],
  mashiro: ['Mashiroiro Symphony'],
  近月: ['Tsuki ni Yorisou Otome no Sahou', '近月少女的礼仪'],
  少女理论: ['Otome Riron to Sono go no Shuuhen', '乙女理論とその後の周辺', '少女理论及其周边'],
  少女理论及其周边: ['Otome Riron to Sono go no Shuuhen', '乙女理論とその後の周辺'],
  遥仰凰华: ['Haruka ni Aogi, Uruwashiki', '遥かに仰ぎ、麗しの'],
  晓护: ['Akatsuki no Goei', '暁の護衛'],
  晓之护卫: ['Akatsuki no Goei', '暁の護衛'],
  真剑: ['Maji de Watashi ni Koishinasai!', '真剣で私に恋しなさい!!'],
  majikoi: ['Maji de Watashi ni Koishinasai!'],
  架向星空之桥: ['Hoshizora e Kakaru Hashi', '星空へ架かる橋'],
  星桥: ['Hoshizora e Kakaru Hashi', '星空へ架かる橋'],
  夕阳染红的坡道: ['Akane-iro ni Somaru Saka', 'あかね色に染まる坂'],
  恋爱与选举与巧克力: ['Koi to Senkyo to Chocolate', '恋と選挙とチョコレート'],
  恋选巧: ['Koi to Senkyo to Chocolate', '恋と選挙とチョコレート'],
  家族计划: ['Kazoku Keikaku', '家族計画'],
  家族计画: ['Kazoku Keikaku', '家族計画'],
  夏之雨: ['Natsu no Ame', '夏ノ雨'],
  甜蜜女友: ['Amakano', 'アマカノ'],
  甜蜜女友2: ['Amakano 2', 'アマカノ2'],
  金辉恋曲: ['Kinkoi', '金色ラブリッチェ'],
  壳之少女: ['Kara no Shoujo', '殻ノ少女'],
  虚之少女: ['Utsurowazaru Mono', '虚ノ少女'],
  天之少女: ['Ama no Shoujo', '天ノ少女'],
  恋狱月狂病: ['Kartagra', 'カルタグラ 〜ツキ狂イノ病〜'],
  海市蜃楼之馆: ['The House in Fata Morgana', 'ファタモルガーナの館'],
  fata: ['The House in Fata Morgana'],
  女装山脉: ['Josou Sanmyaku', '女装山脈'],
  女装海峡: ['Josou Kaikyou', '女装海峡'],
  女装神社: ['Josou Jinja', '女装神社'],
  供牺姬: ['Kugyou Hime', '供犠姫フィーナの冒険'],
  供牺姬菲娜: ['Kugyou Hime', '供犠姫フィーナの冒険'],
  极限脱出: ['Nine Hours, Nine Persons, Nine Doors', '極限脱出9時間9人9の扉'],
  ever17: ['Ever17 -the out of infinity-'],
  remember11: ['Remember11 -the age of infinity-'],
  尸体派对: ['Corpse Party', 'コープスパーティー'],
  corpse: ['Corpse Party', 'コープスパーティー'],
  katawa: ['Katawa Shoujo'],
  // ---------- 更多厂商/系列 ----------
  // FAVORITE
  五彩斑斓: ['Irotoridori no Sekai', 'いろとりどりのセカイ', '五彩斑斓的世界'],
  五彩斑斓的世界: ['Irotoridori no Sekai', 'いろとりどりのセカイ'],
  星空的记忆: ['Hoshizora no Memoria', '星空のメモリア'],
  星空回忆: ['Hoshizora no Memoria', '星空のメモリア'],
  hoshimemo: ['Hoshizora no Memoria'],
  // SAGA PLANETS
  初雪樱: ['Hatsuyuki Sakura', 'はつゆきさくら'],
  初雪: ['Hatsuyuki Sakura', 'はつゆきさくら'],
  花咲workspring: ['Hanasaki Workspring', '花咲ワークスプリング'],
  金辉恋曲四重奏: ['Kinkoi', '金色ラブリッチェ'],
  kinkoi: ['Kinkoi', '金色ラブリッチェ'],
  // Lump of Sugar
  游魂: ['Tayutama', 'タユタマ'],
  游魂2: ['Tayutama 2', 'タユタマ2'],
  タユタマ: ['Tayutama', 'タユタマ'],
  // Purple software
  天津罪: ['Amatsutsumi', 'アマツツミ'],
  // minori
  天使不在的十二月: ['Tenshi no Inai Juunigatsu', '天使のいない十二月'],
  天使不在的12月: ['Tenshi no Inai Juunigatsu', '天使のいない十二月'],
  // Innocent Grey
  恋狱: ['Kartagra', 'カルタグラ 〜ツキ狂イノ病〜'],
  壳虚天: ['Kara no Shoujo', '殻ノ少女'],
  // Nitro+
  尘骸魔京: ['Jinkai Makyou', '塵骸魔京'],
  幻灵镇魂曲: ['Phantom -PHANTOM OF INFERNO-'],
  // Liar-soft
  腐姬: ['Kusarihime', '腐り姫'],
  // Alicesoft
  母烂漫: ['Haha Ranman', '母爛漫'],
  // Eushully
  神采: ['Kamidori Alchemy Meister', '神采りアルケミーマイスター'],
  神采り: ['Kamidori Alchemy Meister', '神采りアルケミーマイスター'],
  天结: ['Amayui Castle Meister', '天結いキャッスルマイスター'],
  天结城堡大师: ['Amayui Castle Meister', '天結いキャッスルマイスター'],
  // 八月社
  千之刃涛: ['Sen no Hatou, Tsukishima no Kouki', '千の刃濤、桃花染の皇姫'],
  千之刃涛桃花染之皇姬: ['Sen no Hatou, Tsukishima no Kouki', '千の刃濤、桃花染の皇姫'],
  桃花染: ['Sen no Hatou, Tsukishima no Kouki', '千の刃濤、桃花染の皇姫'],
  // GIGA / AKABEiSOFT2
  少女爱上姐姐: ['Otome wa Oneesama ni Koishiteru', '乙女はお姉さまに恋してる'],
  // 其他经典
  秋之回忆: ['Memories Off', 'メモリーズオフ'],
  交响乐之雨: ['Symphonic Rain', 'シンフォニック＝レイン'],
  弹丸论破: ['Danganronpa', 'ダンガンロンパ'],
  枪弹辩驳: ['Danganronpa', 'ダンガンロンパ'],
  弹丸: ['Danganronpa', 'ダンガンロンパ'],
  danganronpa: ['Danganronpa', 'ダンガンロンパ'],
  // ---------- 知名角色 -> 所属作品（顺带搜到作品） ----------
  小木曾雪菜: ['WHITE ALBUM 2', '白色相簿2'],
  小木曽雪菜: ['WHITE ALBUM 2', '白色相簿2'],
  冬马和纱: ['WHITE ALBUM 2', '白色相簿2'],
  冬馬かずさ: ['WHITE ALBUM 2', '白色相簿2'],
  丛雨: ['Senren Banka', '千恋＊万花'],
  叢雨: ['Senren Banka', '千恋＊万花'],
  枣铃: ['Little Busters!'],
  棗鈴: ['Little Busters!'],
  观铃: ['AIR'],
  神尾观铃: ['AIR'],
  神尾観鈴: ['AIR'],
  智代: ['CLANNAD', 'Tomoyo After'],
  古河渚: ['CLANNAD'],
  远野秋叶: ['Tsukihime', '月姫'],
  爱尔奎特: ['Tsukihime', '月姫'],
  两仪式: ['Kara no Kyoukai', '空之境界'],
  黑桐鲜花: ['Kara no Kyoukai', '空之境界'],
  // ---------- 其他英文/罗马音简称 ----------
  fate: ['Fate/stay night'],
  hf: ["Fate/stay night [Heaven's Feel]"],
  ubw: ['Fate/stay night [Unlimited Blade Works]'],
  littlebusters: ['Little Busters!'],
  angelbeats: ['Angel Beats!'],
  tomoyo: ['Tomoyo After'],
  subahibi: ['Subarashiki Hibi', '素晴らしき日々'],
  yosuga: ['Yosuga no Sora', '緣之空'],
  aiyoku: ['Aiyoku no Eustia', '穢翼のユースティア'],
  eustia: ['Aiyoku no Eustia', '穢翼のユースティア'],
  amakano: ['Amakano', 'アマカノ'],
  月姬r: ['Tsukihime -A piece of blue glass moon-', '月姫 -A piece of blue glass moon-'],
  // 角色名（含常见错字修正）：御園莓華（巧克甜恋2）
  御园莓华: ['御園莓華'],
  御园梅华: ['御園莓華'],
  御園梅華: ['御園莓華'],
  御園莓華: ['御園莓華'],
};

// 常见会社中文别称/简称 -> VNDB 规范名（用于识别会社；作品列表实时从 VNDB 获取）
const COMPANY_ALIASES = {
  'key社': 'Key',
  键社: 'Key',
  型月: 'TYPE-MOON',
  蘑菇社: 'TYPE-MOON',
  柚子社: 'Yuzusoft',
  ゆずソフト: 'Yuzusoft',
  八月社: 'AUGUST',
  八月: 'AUGUST',
  中二社: 'minori',
  巨乳社: 'minori',
  叶子社: 'Leaf',
  叶社: 'Leaf',
  雪碧社: 'Sprite',
  马戏团: 'CIRCUS',
  枕头社: 'Makura',
  戏画: 'GIGA',
  戯画: 'GIGA',
  调色板: 'Palette',
  大魔王: 'Alice Soft',
  软屋: 'soft-house chara',
  'N+': 'Nitroplus',
};

// 关键词是否命中会社别名词典；返回 VNDB 规范名或 null。
function resolveCompanyAlias(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return null;
  if (Object.prototype.hasOwnProperty.call(COMPANY_ALIASES, k)) return COMPANY_ALIASES[k];
  const stripped = k.replace(/(社|会社|工作室|スタジオ|ソフト)$/i, '');
  if (stripped !== k && Object.prototype.hasOwnProperty.call(COMPANY_ALIASES, stripped)) {
    return COMPANY_ALIASES[stripped];
  }
  return null;
}

// 判断厂商搜索的榜首结果是否与关键词强相关（避免误触发）
function producerMatches(top, keyword) {
  const name = String((top && top.name) || '').toLowerCase();
  const aliasList = String((top && top.aliases) || '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const k = String(keyword || '').trim().toLowerCase();
  if (!k) return false;
  if (name === k) return true;
  if (aliasList.includes(k)) return true;
  if (k.length >= 3 && (name.includes(k) || k.includes(name))) return true;
  return false;
}

// VNDB 厂商搜索：按名称/别名匹配，返回 {id, name, aliases} 列表。
async function vndbProducerSearch(keyword, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const res = await fetchImpl('https://api.vndb.org/kana/producer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'galgame-finder/1.0' },
      body: JSON.stringify({ filters: ['search', '=', keyword], fields: 'id, name, aliases', results: 8 }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map((r) => ({ id: r.id, name: r.name, aliases: r.aliases || '' }));
  } finally {
    clearTimeout(timer);
  }
}

// VNDB 按厂商 ID 取作品（id 如 "p98"，去掉短横线）。
async function vndbWorksByProducer(producerId, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const res = await fetchImpl('https://api.vndb.org/kana/vn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'galgame-finder/1.0' },
      body: JSON.stringify({
        filters: ['developer', '=', ['id', '=', String(producerId).replace('-', '')]],
        fields: 'id, title, alttitle, aliases, image.url',
        results: 30,
        sort: 'rating',
        reverse: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map((r) => ({
      id: r.id,
      title: r.title,
      alttitle: r.alttitle || '',
      aliases: Array.isArray(r.aliases) ? r.aliases.filter(Boolean) : [],
      url: 'https://vndb.org/' + r.id,
      image: (r.image && r.image.url) || null,
    }));
  } finally {
    clearTimeout(timer);
  }
}

// 标题归一化（用于同名匹配）
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

// 判断某个网站结果标题是否为某作品的同款（标题/别名 归一化相等或互相包含）
function sameWork(resultTitle, workTitles) {
  const rt = normTitle(resultTitle);
  if (!rt) return false;
  for (const wt of workTitles || []) {
    const n = normTitle(wt);
    if (!n) continue;
    if (rt === n) return true;
    if (n.length >= 4 && (rt.includes(n) || n.includes(rt))) return true;
  }
  return false;
}

// 在普通网站上搜索某个作品：依次用 标题/别名 搜索，取通过同名校验的结果（最多 2 条）。
async function searchWorkOnHtmlSite(work, site, fetchImpl, limit) {
  const workTitles = [work.title, work.alttitle, ...(work.aliases || [])].filter((t) => t && String(t).trim());
  const candidates = [...new Set(workTitles)].slice(0, 4);
  for (const c of candidates) {
    try {
      const list = await fetchHtmlResults(c, site, fetchImpl, limit);
      const matches = list.filter((r) => sameWork(r.title, workTitles));
      if (matches.length) return matches.slice(0, 2).map((m) => ({ title: m.title, url: m.url }));
    } catch (e) {
      // 该写法失败则换下一个
    }
  }
  return [];
}

// 若关键词命中缩写词典，返回 { keyword, expanded, expansions }，否则返回 null。
function expandKeyword(keyword) {
  const k = String(keyword || '').trim().toLowerCase();
  if (!k) return null;
  const stripped = k.replace(/[\s\-_.\/\\:;()\[\]'"!?]/g, '');
  const candidates = [k, stripped];
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(ABBREVIATIONS, c)) {
      const list = Array.isArray(ABBREVIATIONS[c]) ? ABBREVIATIONS[c] : [ABBREVIATIONS[c]];
      return { keyword: String(keyword).trim(), expanded: list[0], expansions: list };
    }
  }
  return null;
}

// 构造依次尝试的查询词：原词 -> 展开后的全名列表 -> 外部补充查询 -> 去空格符号后的形式。
function buildQueries(keyword, extraQueries) {
  const raw = String(keyword || '').trim();
  const qs = [raw];
  const exp = expandKeyword(raw);
  if (exp) {
    for (const e of exp.expansions) {
      if (e !== raw && !qs.includes(e)) qs.push(e);
    }
  }
  if (Array.isArray(extraQueries)) {
    for (const e of extraQueries) {
      if (e !== raw && !qs.includes(e)) qs.push(e);
    }
  }
  const stripped = raw.replace(/[\s,._\-/\\:;()\[\]'"!?]/g, '');
  if (stripped && !qs.includes(stripped)) qs.push(stripped);
  return qs.slice(0, 6);
}

// “拓展”站点：在关键词后追加 gal / 旮旯给木 / galgame / 二创 等词，用于在视频平台找二创
const EXPAND_SUFFIXES = ['gal', '旮旯给木', 'galgame', '二创', '旮旯给木二创'];

// 拓展查询：gal 后缀词排最前（优先找二创），原关键词放最后（仅补位，避免无关结果占满）
function buildExpandQueries(keyword, extraQueries) {
  const raw = String(keyword || '').trim();
  const qs = [];
  for (const suf of EXPAND_SUFFIXES) {
    qs.push(raw + suf);
  }
  if (Array.isArray(extraQueries)) {
    for (const e of extraQueries) {
      if (!qs.includes(e)) qs.push(e);
    }
  }
  qs.push(raw);
  return qs.slice(0, 8);
}

// 用标题索引做通用中文缩写解析：对含中文的短词（2-5 字），按“首字相同 + 字符按顺序出现（子序列）”匹配游戏标题，
// 返回命中最优的若干游戏的全名（各语言标题）作为展开查询词。
function matchAbbreviationsByIndex(keyword, games) {
  const kw = String(keyword || '').trim();
  if (kw.length < 2 || kw.length > 5) return [];
  if (!/[\u4e00-\u9fff]/.test(kw)) return []; // 仅处理含中文的短词
  const first = kw[0];
  const rest = kw.slice(1);
  const hits = [];
  for (const g of games || []) {
    for (const t of g.titles) {
      if (!t || t.length < kw.length) continue;
      if (t[0] !== first) continue;
      // 其余字符必须按顺序出现在标题中
      let pos = 0;
      let ok = true;
      let gap = 0;
      for (const ch of rest) {
        const idx = t.indexOf(ch, pos + 1);
        if (idx === -1) {
          ok = false;
          break;
        }
        gap += idx - pos - 1;
        pos = idx;
      }
      if (!ok) continue;
      const score = 10000 - gap * 10 - t.length;
      hits.push({ titles: g.titles, score });
      break; // 每个游戏只记一次
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const out = [];
  const seen = new Set();
  for (const h of hits.slice(0, 5)) {
    for (const t of h.titles) {
      if (!t || t === kw || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 4) break;
    }
    if (out.length >= 4) break;
  }
  return out;
}

// 用关键词替换网址模板中的占位符（{keyword} 或 {kw}）。
function buildUrl(template, keyword) {
  const kw = encodeURIComponent(keyword);
  let url = template;
  if (url.includes('{keyword}')) url = url.split('{keyword}').join(kw);
  else if (url.includes('{kw}')) url = url.split('{kw}').join(kw);
  return url;
}

// VNDB API 查询：支持翻页（API 单次上限 100，需要更多时按 page 翻页）
async function vndbQuery(keyword, fetchImpl, limit) {
  const want = limit || MAX_RESULTS;
  const perPage = Math.min(want, 100);
  const all = [];
  let page = 1;
  while (all.length < want) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
    let res;
    try {
      res = await fetchImpl('https://api.vndb.org/kana/vn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'galgame-finder/1.0',
        },
        body: JSON.stringify({
          filters: ['search', '=', keyword],
          fields: 'id, title, alttitle, image.url',
          results: perPage,
          page,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      if (all.length) break; // 已有部分结果时容错返回
      throw new Error('HTTP ' + res.status);
    }
    const data = await res.json();
    const items = (data.results || []).map((r) => ({
      id: r.id,
      title: r.alttitle ? r.title + '（' + r.alttitle + '）' : r.title,
      alttitle: r.alttitle || '',
      url: 'https://vndb.org/' + r.id,
      image: (r.image && r.image.url) || null,
    }));
    if (!items.length) break;
    all.push(...items);
    page++;
  }
  return all.slice(0, want);
}

// 本地重排 VNDB 结果：标题精确/前缀/包含、以及首字母缩写匹配优先，避免缩写搜索时无关结果排前面。
function rankVndb(items, keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  const kwNorm = kw.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const initialsOf = (s) =>
    s
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('');
  return items
    .map((it) => {
      const t = (it.title || '').toLowerCase();
      const a = (it.alttitle || '').toLowerCase();
      const tNorm = t.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
      const initials = initialsOf(t);
      let score = 0;
      if (kwNorm && tNorm === kwNorm) score = 100;
      else if (kwNorm && tNorm.startsWith(kwNorm)) score = 80;
      else if (kwNorm && tNorm.includes(kwNorm)) score = 60;
      if (kw && initials === kw) score = Math.max(score, 95); // 首字母缩写完全匹配，如 Little Busters! -> lb
      else if (kw && initials.startsWith(kw)) score = Math.max(score, 90);
      if (kw && t.includes(kw)) score = Math.max(score, 60);
      if (kw && a.includes(kw)) score = Math.max(score, 40);
      return { ...it, score };
    })
    .sort((x, y) => y.score - x.score);
}

// VNDB 搜索：按候选词依次查询（有结果即停止），合并去重后本地重排。
async function vndbSearch(keyword, fetchImpl, extraQueries, limit) {
  const queries = buildQueries(keyword, extraQueries);
  const merged = new Map();
  let lastErr = null;
  for (let i = 0; i < queries.length; i++) {
    if (i > 0 && merged.size > 0) break;
    try {
      const list = await vndbQuery(queries[i], fetchImpl, limit);
      for (const it of list) merged.set(it.id, it);
    } catch (e) {
      lastErr = e;
    }
  }
  if (!merged.size && lastErr) throw lastErr;
  return rankVndb([...merged.values()], keyword)
    .slice(0, limit || MAX_RESULTS)
    .map(({ score, ...it }) => it);
}

// 普通网页搜索：对候选词依次请求并合并去重；若存在展开词，则把标题命中展开词的结果排前面。
async function htmlSearch(keyword, site, fetchImpl, extraQueries, limit) {
  const queries = site.expand ? buildExpandQueries(keyword, extraQueries) : buildQueries(keyword, extraQueries);
  const cap = limit || MAX_RESULTS;
  const seen = new Set();
  const out = [];
  let lastErr = null;
  let gotAny = false;
  for (let i = 0; i < queries.length; i++) {
    let list = [];
    try {
      list = await fetchHtmlResults(queries[i], site, fetchImpl, limit);
      gotAny = gotAny || list.length > 0;
    } catch (e) {
      lastErr = e;
    }
    for (const it of list) {
      if (!seen.has(it.url)) {
        seen.add(it.url);
        out.push(it);
      }
    }
    if (out.length >= cap) break;
  }
  if (!out.length && lastErr && !gotAny) throw lastErr;

  // 有展开词时，标题包含任一展开词的结果排前面（让缩写目标置顶；拓展站点交给后续智能排序）
  if (!site.expand && queries.length > 1) {
    const lowers = queries.slice(1).map((q) => String(q).toLowerCase());
    for (const it of out) {
      const tl = String(it.title || '').toLowerCase();
      it._boost = lowers.some((q) => q.length >= 2 && tl.includes(q)) ? 1 : 0;
    }
    out.sort((a, b) => b._boost - a._boost);
  }

  // 拓展站点：抓取结果页（标题/简介/评论）与关键词比对，相似度高的排前面
  if (site.expand && out.length) {
    const scored = await scoreResultsByKeyword(out.slice(0, cap), keyword, fetchImpl);
    return scored.slice(0, cap);
  }
  return out.slice(0, cap).map(({ _boost, ...it }) => it);
}

// 抓取结果页的标题 / 简介 / 评论（Bilibili 视频页可拿到 aid，再取评论区）
async function fetchResultTexts(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  let html;
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let title = '';
  let desc = '';
  // Bilibili 视频页：从 __INITIAL_STATE__ 的 videoData 提取真实标题与简介
  if (/bilibili\.com\/video/i.test(url)) {
    const seg = html.indexOf('"videoData":{');
    if (seg !== -1) {
      const chunk = html.slice(seg, seg + 3000);
      const unescape = (raw) => {
        try {
          return JSON.parse('"' + raw + '"');
        } catch (e) {
          return raw;
        }
      };
      const mT = chunk.match(/"title":"((?:[^"\\]|\\.)*)"/);
      if (mT) title = unescape(mT[1]);
      const mD = chunk.match(/"desc":"((?:[^"\\]|\\.)*)"/);
      if (mD) desc = unescape(mD[1]);
    }
  }
  const mTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!title && mTitle) title = mTitle[1].trim();
  if (!desc) {
    const mDesc =
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) ||
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) ||
      html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/i);
    if (mDesc) desc = mDesc[1];
  }

  let comments = '';
  if (/bilibili\.com/i.test(url)) {
    const aid = (html.match(/"aid":(\d+)/) || [])[1];
    if (aid) {
      try {
        const cr = await fetchImpl('https://api.bilibili.com/x/v2/reply?type=1&oid=' + aid + '&sort=2&ps=20', {
          headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
        if (cr.ok) {
          const cj = await cr.json();
          const replies = (cj.data && cj.data.replies) || [];
          comments = replies.map((r) => (r.content && r.content.message) || '').join(' ');
        }
      } catch (e) {
        /* 评论抓取失败不影响结果 */
      }
    }
  }
  return { title, desc, comments };
}

// 关键词与（标题+简介+评论）的相似度：关键词出现的位置与次数加权
function computeSimilarity(keyword, texts) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return 1;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const kwNorm = norm(kw);
  const title = String(texts.title || '').toLowerCase();
  const desc = String(texts.desc || '').toLowerCase();
  const comments = String(texts.comments || '').toLowerCase();
  let score = 1; // 保底，避免抓取失败时无法区分
  if (kwNorm && norm(title).includes(kwNorm)) score += 40;
  if (kwNorm && norm(desc).includes(kwNorm)) score += 25;
  if (kwNorm && norm(comments).includes(kwNorm)) score += 20;
  if (kw && title.includes(kw)) score += 15;
  if (kw && desc.includes(kw)) score += 10;
  if (kw && comments.includes(kw)) score += 8;
  return score;
}

async function scoreResultsByKeyword(results, keyword, fetchImpl) {
  const CONC = 4;
  const scored = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONC, results.length) }, async () => {
    while (idx < results.length) {
      const i = idx++;
      let score = 0;
      try {
        const texts = await fetchResultTexts(results[i].url, fetchImpl);
        score = computeSimilarity(keyword, texts);
      } catch (e) {
        score = 0;
      }
      scored.push({ ...results[i], _score: score });
    }
  });
  await Promise.all(workers);
  scored.sort((a, b) => b._score - a._score);
  return scored.map(({ _score, ...it }) => it);
}

async function fetchHtmlResults(keyword, site, fetchImpl, limit) {
  const url = buildUrl(site.url, keyword);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  let html;
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  return extractResults(html, site, url, keyword, limit);
}

function cleanTitle(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// 从元素提取标题：优先文本，其次 img 的 alt、元素的 title / aria-label 属性。
function titleOf(el) {
  let t = cleanTitle(el.text);
  if (!t) {
    const alt = el.getAttribute('alt') || (el.querySelector('img') && el.querySelector('img').getAttribute('alt'));
    if (alt) t = cleanTitle(alt);
    else {
      const attr = el.getAttribute('title') || el.getAttribute('aria-label');
      if (attr) t = cleanTitle(attr);
    }
  }
  return t;
}

function normalizeUrl(rawHref, baseUrl) {
  if (!rawHref) return null;
  const href = String(rawHref).trim();
  if (/^(javascript:|#|mailto:|tel:|data:)/i.test(href)) return null;
  let abs;
  try {
    abs = new URL(href, baseUrl).toString();
  } catch (e) {
    return null;
  }
  if (!/^https?:\/\//i.test(abs)) return null;
  return abs;
}

// 从结果元素中提取缩略图：依次尝试 src / srcset / data-src，过滤占位图。
function extractImage(el, pageUrl) {
  const img = el.querySelector('img');
  if (!img) return null;
  let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
  if (!src || src.length < 10) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const first = (String(srcset).split(',')[0] || '').trim().split(/\s+/)[0];
    if (first) src = first;
  }
  if (!src) return null;
  if (/data:image|1x1|blank|placeholder|pixel/i.test(src) && src.length < 60) return null;
  return normalizeUrl(src, pageUrl);
}

// 从 HTML 中提取结果。site.selector 存在时用选择器精确提取，否则用通用启发式。
function extractResults(html, site, pageUrl, keyword, limit) {
  const cap = limit || MAX_RESULTS;
  let root;
  try {
    root = parse(html);
  } catch (e) {
    return [];
  }
  root.querySelectorAll('script, style, noscript, nav, header, footer, iframe').forEach((n) => {
    try {
      n.remove();
    } catch (e) {
      /* ignore */
    }
  });

  const kw = (keyword || '').toLowerCase();

  if (site.selector) {
    const out = [];
    const seen = new Set();
    let els = [];
    try {
      els = root.querySelectorAll(site.selector);
    } catch (e) {
      els = [];
    }
    for (const el of els) {
      let title = '';
      let href = el.getAttribute('href');
      if (site.titleSelector) {
        const t = el.querySelector(site.titleSelector);
        if (t) title = titleOf(t);
      }
      if (!title) title = titleOf(el);
      if (!href) {
        const a = el.querySelector('a');
        if (a) href = a.getAttribute('href');
      }
      const abs = normalizeUrl(href, pageUrl);
      if (!abs) continue;
      if (title.length < 2 || title.length > 200) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ title, url: abs, image: extractImage(el, pageUrl) });
      if (out.length >= cap) break;
    }
    return out;
  }

  // 通用启发式：收集所有链接，打分排序。
  const candidates = [];
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    const title = cleanTitle(a.text);
    const abs = normalizeUrl(href, pageUrl);
    if (!abs) continue;
    if (title.length < 2 || title.length > 200) continue;
    let score = 0;
    const tl = title.toLowerCase();
    if (kw && tl.includes(kw)) score += 3;
    if (kw && (abs.toLowerCase().includes(kw) || abs.toLowerCase().includes(encodeURIComponent(keyword)))) score += 1;
    if (title.length <= 80) score += 1;
    if (/^(首页|搜索|登录|注册|下一页|上一页|更多|关于|帮助|下载客户端|登录注册|sign ?in|log ?in|register|next|prev|home|search)$/i.test(title)) score -= 5;
    candidates.push({ title, url: abs, score, image: extractImage(a, pageUrl) });
  }
  candidates.sort((x, y) => y.score - x.score);
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({ title: c.title, url: c.url, image: c.image });
    if (out.length >= cap) break;
  }
  return out;
}

module.exports = {
  MAX_RESULTS,
  SEARCH_TIMEOUT,
  BROWSER_UA,
  ABBREVIATIONS,
  COMPANY_ALIASES,
  expandKeyword,
  buildQueries,
  buildExpandQueries,
  buildUrl,
  fetchResultTexts,
  computeSimilarity,
  matchAbbreviationsByIndex,
  resolveCompanyAlias,
  producerMatches,
  vndbProducerSearch,
  vndbWorksByProducer,
  sameWork,
  normTitle,
  searchWorkOnHtmlSite,
  fetchHtmlResults,
  vndbQuery,
  rankVndb,
  vndbSearch,
  htmlSearch,
  extractResults,
};
