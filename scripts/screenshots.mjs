// 无头浏览器冒烟测试 + 截图：node scripts/screenshots.mjs [url]
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const OUT = new globalThis.URL('../screenshots/', import.meta.url).pathname;
const errors = [];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function newPage(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return page;
}
// 自动代打：遇到需要玩家点击时，随便选一个合法目标
const AUTOPLAY = () => {
  window.__auto = setInterval(() => {
    const g = window.__golf; if (!g) return;
    const hl = g.scene.highlight;
    const btn = [...document.querySelectorAll('#n')][0]; // 局结算“下一局”
    if (btn) { btn.click(); return; }
    if (hl.deck) g.scene.onPick({ kind: 'deck' });
    else if (hl.slots.size) g.scene.onPick({ kind: 'slot', slot: [...hl.slots][Math.floor(Math.random() * hl.slots.size)] });
  }, 400);
};

// 1) 首次进入：资料设置 → 首页
const page = await newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(1500);
await page.$eval('#nm', (el) => (el.value = 'Kenny'));
await page.click('#ok');
await sleep(1800);
await page.screenshot({ path: OUT + '01-home.png' });
console.log('home ok');

// 2) 地图
await page.click('#play');
await sleep(800);
await page.screenshot({ path: OUT + '02-level-map.png' });

// 3) 第 1 关对局中
await page.evaluate(() => document.querySelector('.node .disc').click());
await sleep(400);
await page.click('#go');
await sleep(3500);
// 玩家翻两张
await page.evaluate(() => { window.__golf.scene.onPick({ kind: 'slot', slot: 0 }); });
await sleep(900);
await page.evaluate(() => { window.__golf.scene.onPick({ kind: 'slot', slot: 4 }); });
await sleep(1200);
await page.evaluate(() => { const g = window.__golf; if (g.scene.highlight.deck) g.scene.onPick({ kind: 'deck' }); });
await sleep(1500);
await page.screenshot({ path: OUT + '03-in-game.png' });
console.log('in-game ok');

// 4) 自动打完，截结算页
await page.evaluate(AUTOPLAY);
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  if (await page.$('#chal')) break;
  await sleep(1000);
}
await page.evaluate(() => clearInterval(window.__auto));
if (!(await page.$('#chal'))) errors.push('match did not finish in time');
await sleep(1500);
await page.screenshot({ path: OUT + '04-result.png' });
// 战绩卡
await page.click('#share');
await sleep(800);
await page.screenshot({ path: OUT + '05-share-card.png' });
const lsDump = await page.evaluate(() => localStorage.getItem('golf3d.v1'));
const store = JSON.parse(lsDump);
console.log('progress', JSON.stringify(store.progress), 'scores', store.scores.length);

// 5) 挑战链接：用新的浏览器上下文（模拟好友）打开
const { encodeChallenge } = await import('../src/social/share.js');
const code = encodeChallenge({ v: 1, seed: store.scores[0].seed, level: 1, score: store.scores[0].score, name: 'Kenny', avatar: '😎', stars: store.scores[0].stars });
const ctx = await browser.createBrowserContext();
const friend = await ctx.newPage();
friend.on('pageerror', (e) => errors.push(`[friend pageerror] ${e.message}`));
await friend.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await friend.goto(URL + '#c=' + code, { waitUntil: 'networkidle0' });
await sleep(1200);
await friend.click('#ok'); // 好友首次进入设资料
await sleep(1200);
await friend.screenshot({ path: OUT + '06-mobile-challenge.png' });
await friend.click('#go');
await sleep(4000);
await friend.screenshot({ path: OUT + '07-mobile-in-game.png' });
// 验证好友拿到同一副牌
const sameDeal = await friend.evaluate(() => window.__golf.match.seed);
console.log('friend seed', sameDeal, 'expected', store.scores[0].seed, sameDeal === store.scores[0].seed ? 'SAME DEAL ✓' : 'MISMATCH');
if (sameDeal !== store.scores[0].seed) errors.push('challenge seed mismatch');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS ✓');
process.exit(errors.length ? 1 : 0);
