// 每日挑战。日历日用 Asia/Shanghai（北京时间，无夏令时），不用浏览器本地时区。
// 这样所有玩家在同一时刻拿到同一天的牌，换日点是北京时间 00:00。
// seed = hashSeed('daily', 'YYYY-MM-DD')，再按对局同样的方式派生子局 seed：
//   hashSeed(dailySeed, 'hole', holeIndex)
import { hashSeed } from './rng.js';

export const DAILY_TIMEZONE = 'Asia/Shanghai';

export function dailyDateKey(now = new Date(), timeZone = DAILY_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) throw new Error('无法计算每日挑战日期');
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey, delta) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86400000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export function dailySeed(dateKey) {
  return hashSeed('daily', dateKey) || 1;
}

export function dailyHoleSeed(dateKey, holeIndex = 0) {
  return hashSeed(dailySeed(dateKey), 'hole', holeIndex) || 1;
}

export function formatShareDate(dateKey) {
  const [, m, d] = dateKey.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function formatLongDate(dateKey) {
  const [y, m, d] = dateKey.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export function officialDates(history) {
  if (!history || typeof history !== 'object') return [];
  return Object.keys(history)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && history[k] && history[k].official && typeof history[k].score === 'number')
    .sort();
}

function bestStreak(dates) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of dates) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    prev = day;
    if (run > best) best = run;
  }
  return best;
}

// 今天已打：连续天数算到今天。今天没打但昨天打了：连续天数还在（今天还没断）。
// 昨天也没打：当前连续归零。中间空一天，新的一天从 1 重新计，最佳连续保留。
export function computeStreak(history, todayKey) {
  const dates = officialDates(history);
  const set = new Set(dates);
  const playedToday = set.has(todayKey);
  let cursor = playedToday ? todayKey : addDays(todayKey, -1);
  let current = 0;
  if (set.has(cursor)) {
    while (set.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }
  return { current, best: bestStreak(dates), playedToday };
}

export function bestOfficialScore(history) {
  let best = null;
  for (const key of officialDates(history)) {
    const score = history[key].score;
    best = best == null ? score : Math.min(best, score);
  }
  return best;
}

// 每一天只记录第一次正式成绩。同一天再打（练习或重复提交）不改分数、不加连续天数。
export function applyDailyResult(history, dateKey, entry, { practice = false } = {}) {
  const src = history && typeof history === 'object' ? history : {};
  const prev = src[dateKey];
  const already = !!(prev && prev.official && typeof prev.score === 'number');
  if (practice || already) {
    return {
      history: src,
      recorded: false,
      practice: true,
      streak: computeStreak(src, dateKey),
      today: already ? prev : null,
    };
  }
  const row = { score: entry.score, seed: entry.seed, official: true };
  const next = { ...src, [dateKey]: row };
  return {
    history: next,
    recorded: true,
    practice: false,
    streak: computeStreak(next, dateKey),
    today: row,
  };
}

export function monthCells(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (firstDow + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ day, key, today: day === d, future: key > dateKey });
  }
  return { year: y, month: m, cells };
}

export function dailyShareText({ dateKey, score, streak, url }) {
  const line = `高尔夫纸牌 每日挑战 ${formatShareDate(dateKey)} · 得分 ${score} · 连续 ${streak} 天 🔥`;
  return url ? `${line}\n${url}` : line;
}
