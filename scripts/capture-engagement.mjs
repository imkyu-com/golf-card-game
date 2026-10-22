// 截每日挑战、对子反馈和结算页。先在 5173 上跑 npm run preview。
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
function addDays(dateKey, delta) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
async function shot(page, name) {
  await page.screenshot({ path: OUT + name });
  console.log('saved', name);
}

const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'networkidle0' });
await sleep(800);
await page.$eval('#nm', (el) => { el.value = 'Kenny'; });
await page.click('#ok');
await sleep(700);

if (!(await page.$('#daily .badge'))) errors.push('home badge missing before today is played');
await shot(page, '10-home-badge-desktop.png');

const today = await page.evaluate(() => window.__golf.backend.getDailyState().date);
const rows = [];
for (let i = 4; i >= 1; i--) rows.push({ date: addDays(today, -i), score: 6 + i, seed: i, name: 'Kenny', avatar: '😎' });
rows.push({ date: today, score: 4, seed: 99, name: 'Kenny', avatar: '😎' });
await page.evaluate((list) => {
  for (const row of list) window.__golf.backend.recordDailyResult(row);
}, rows);
await page.click('#daily');
await sleep(600);
const dailyText = await page.$eval('.daily-panel', (el) => el.innerText);
if (!dailyText.includes('今日得分') || !dailyText.includes('4')) errors.push('daily screen missing today score: ' + dailyText.slice(0, 200));
if (!dailyText.includes('连续天数') || !dailyText.includes('5')) errors.push('daily streak not 5: ' + dailyText.slice(0, 240));
if (!dailyText.includes('全球每日排行榜即将上线')) errors.push('leaderboard hook missing');
await shot(page, '11-daily-desktop.png');

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(400);
await shot(page, '12-daily-mobile.png');

await page.evaluate(() => window.__golf.demoPairJuice());
await sleep(200);
const floater = await page.$eval('.score-floater', (el) => el.textContent).catch(() => '');
if (floater !== '-20') errors.push('pair floater expected -20, got ' + floater);
await shot(page, '13-pair-burst-mobile.png');

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await sleep(200);
await page.evaluate(() => window.__golf.demoPairJuice());
await sleep(200);
await shot(page, '14-pair-burst-desktop.png');

await page.evaluate(() => window.__golf.demoResult());
await sleep(400);
const result = await page.$eval('.panel', (el) => el.innerText);
if (!result.includes('再少 2 分就能拿 ⭐⭐⭐')) errors.push('near-miss copy missing: ' + result.slice(0, 300));
if (!result.includes('再来一局')) errors.push('replay button missing');
if (!result.includes('新的个人最佳')) errors.push('personal best missing: ' + result.slice(0, 300));
await shot(page, '15-result-desktop.png');

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(300);
await shot(page, '16-result-mobile.png');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
process.exit(errors.length ? 1 : 0);
