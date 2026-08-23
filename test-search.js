// 独立测试脚本：验证搜索模块（不依赖 Electron）。
// 运行：npm test  （等价于 node test-search.js）
const {
  buildUrl,
  expandKeyword,
  buildQueries,
  rankVndb,
  matchAbbreviationsByIndex,
  resolveCompanyAlias,
  producerMatches,
  vndbProducerSearch,
  vndbWorksByProducer,
  sameWork,
  searchWorkOnHtmlSite,
  vndbSearch,
  htmlSearch,
  extractResults,
} = require('./search');

const fetchImpl = (url, opts) => fetch(url, opts);

const shionSite = {
  url: 'https://shionlib.com/zh/search/game?q={keyword}',
  selector: '.game-grid a[href^="/zh/game/"]',
  titleSelector: 'img',
};

// 模拟的 shionlib 标题索引
const fakeIndex = [
  { id: 1, titles: ['星空列车与白的旅行', 'Hoshizora Tetsudou to Shiro no Tabi', '星空列車と白の旅'] },
  { id: 2, titles: ['巧克甜恋2', 'Amairo Chocolata 2', 'あまいろショコラータ2'] },
  { id: 3, titles: ['CLANNAD', 'クラナド'] },
  { id: 4, titles: ['星空のメモリア', 'Hoshizora no Memoria'] },
];

function sampleHtml() {
  return `
    <html><body>
      <nav><a href="/">首页</a><a href="/login">登录</a></nav>
      <div class="results">
        <a class="search_result_row" href="/game/123"><span class="title">CLANNAD</span></a>
        <a class="search_result_row" href="/game/456"><span class="title">Kanon</span></a>
      </div>
      <footer><a href="/about">关于</a></footer>
    </body></html>`;
}

(async () => {
  console.log('== buildUrl ==');
  console.log(buildUrl('https://x.com/search?q={keyword}', 'CLANNAD 光'));

  console.log('\n== 缩写展开（英/中） ==');
  for (const k of ['fsn', 'FS/N', 'cl', 'lb', 'wa2', '白学', '白2', '石头门', 'fate']) {
    const e = expandKeyword(k);
    console.log(k, '->', e ? JSON.stringify(e.expansions) : '(无)');
  }
  console.log('buildQueries("fs/n"):', JSON.stringify(buildQueries('fs/n')));
  console.log('buildQueries("白学"):', JSON.stringify(buildQueries('白学')));
  console.log('buildQueries("clannad"):', JSON.stringify(buildQueries('clannad')));

  console.log('\n== 中文缩写索引匹配（通用） ==');
  console.log('星白 ->', JSON.stringify(matchAbbreviationsByIndex('星白', fakeIndex)));
  console.log('巧2 ->', JSON.stringify(matchAbbreviationsByIndex('巧2', fakeIndex)));
  console.log('cl ->', JSON.stringify(matchAbbreviationsByIndex('cl', fakeIndex)), '（英文不处理）');

  console.log('\n== rankVndb（缩写 lb 时 Little Busters 应排前） ==');
  const ranked = rankVndb(
    [
      { id: 'v4', title: 'CLANNAD', url: 'https://vndb.org/v4' },
      { id: 'v5', title: 'Little Busters!', url: 'https://vndb.org/v5' },
      { id: 'v12', title: 'Tomoyo After', url: 'https://vndb.org/v12' },
    ],
    'lb'
  );
  console.log(ranked.map((x) => x.title).join(' | '));

  console.log('\n== extractResults (selector mode) ==');
  const withSelector = extractResults(
    sampleHtml(),
    { selector: 'a.search_result_row', titleSelector: '.title' },
    'https://x.com/',
    'clannad'
  );
  console.log(JSON.stringify(withSelector, null, 2));

  console.log('\n== 会社识别 ==');
  for (const k of ['key', '柚子社', '型月', 'key社', '键社', 'minori', '八月社', 'clannad']) {
    const alias = resolveCompanyAlias(k);
    console.log(k, '-> 词典:', alias || '(无)');
  }
  console.log('\n== 会社作品（live） ==');
  for (const [kw, search] of [['柚子社', '柚子社'], ['Key', 'Key'], ['type-moon', 'Type-Moon']]) {
    try {
      const list = await vndbProducerSearch(search, fetchImpl);
      const top = list[0];
      console.log(kw, '->', top && top.id + ' ' + top.name, '匹配:', producerMatches(top, kw));
      if (producerMatches(top, kw)) {
        const works = await vndbWorksByProducer(top.id, fetchImpl);
        console.log('  作品:', works.slice(0, 4).map((w) => w.title).join(' | '));
      }
    } catch (e) { console.log(kw, 'ERR', e.message); }
  }

  console.log('\n== 同名校验 ==');
  console.log("sameWork('千恋＊万花', ['Senren * Banka','千恋＊万花']) =", sameWork('千恋＊万花', ['Senren * Banka', '千恋＊万花']));
  console.log("sameWork('Sanoba Witch', ['サノバウィッチ']) =", sameWork('Sanoba Witch', ['サノバウィッチ']));
  console.log("sameWork('SNOW', ['CLANNAD']) =", sameWork('SNOW', ['CLANNAD']));

  console.log('\n== 会社作品（live，含别名） ==');
  try {
    const works = await vndbWorksByProducer('p98', fetchImpl);
    console.log('Yuzusoft 作品数:', works.length);
    console.log('前3:', works.slice(0, 3).map((w) => w.title + (w.alttitle ? '/' + w.alttitle : '') + ' [别名' + w.aliases.length + '个]').join(' | '));
  } catch (e) { console.log('ERR', e.message); }

  console.log('\n== 在 shionlib 上检索单个作品（live） ==');
  try {
    const found = await searchWorkOnHtmlSite({ title: 'DRACU-RIOT!', alttitle: '', aliases: [] }, shionSite, fetchImpl);
    console.log('DRACU-RIOT! ->', found.map((f) => f.title + ' ' + f.url).join(' | ') || '(未找到)');
  } catch (e) { console.log('ERR', e.message); }
  try {
    const found = await searchWorkOnHtmlSite({ title: 'Sanoba Witch', alttitle: '', aliases: ['サノバウィッチ'] }, shionSite, fetchImpl);
    console.log('Sanoba Witch ->', found.map((f) => f.title + ' ' + f.url).join(' | ') || '(未找到)');
  } catch (e) { console.log('ERR', e.message); }

  console.log('\n== shionlib 实站解析（live） ==');
  for (const q of ['clannad', '白色相簿2', 'fsn']) {
    try {
      const list = await htmlSearch(q, shionSite, fetchImpl);
      console.log(q, '->', list.length, '条:', list.slice(0, 4).map((x) => x.title).join(' | '));
    } catch (e) {
      console.log(q, 'ERR', e.message);
    }
  }
})();
