// 数据层抽象。原型阶段用 LocalBackend（localStorage）。
// 以后接真实后端时，实现同样接口的 RemoteBackend（REST/WebSocket），在 main.js 里替换即可：
//   getProfile() / saveProfile(p)
//   getProgress() / saveLevelResult(levelId, {stars, best})
//   submitScore(entry) / getLeaderboard({levelId})
//   recordChallenge(challenge)   —— 收到好友挑战时记录对方成绩
//   getDailyState() / recordDailyResult({ date, score, seed, name, avatar })
//   submitDailyScore(entry) / getDailyLeaderboard({ date })
//     —— 全球每日排行榜的挂钩。LocalBackend 不上传；RemoteBackend 覆盖这两个方法即可。
//     服务端用 dailySeed(date) 重放 rules.js 校验成绩。seed 必须等于 hashSeed('daily', date)。
// 联机对战可以复用 src/game/rules.js 作为服务端裁判（纯函数、可复现的 seed）。
import { applyDailyResult, bestOfficialScore, computeStreak, dailyDateKey } from '../game/daily.js';

const KEY = 'golf3d.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 隐私模式 */ } }

export class LocalBackend {
  constructor() {
    this.d = load();
    this.d.progress ??= {};
    this.d.scores ??= [];
    this.d.settings ??= { sound: true };
    this.d.bests ??= {};
    this.d.daily ??= { results: {} };
  }
  _save() { save(this.d); }
  getProfile() { return this.d.profile || null; }
  saveProfile(p) { this.d.profile = { name: String(p.name).slice(0, 12), avatar: p.avatar, id: this.d.profile?.id || crypto.randomUUID?.() || String(Date.now()) }; this._save(); return this.d.profile; }
  getSettings() { return this.d.settings; }
  saveSettings(s) { this.d.settings = { ...this.d.settings, ...s }; this._save(); }
  getProgress() { return this.d.progress; }
  saveLevelResult(levelId, { stars, score }) {
    const cur = this.d.progress[levelId] || { stars: 0, best: null, plays: 0 };
    cur.stars = Math.max(cur.stars, stars);
    cur.best = cur.best === null ? score : Math.min(cur.best, score);
    cur.plays++;
    this.d.progress[levelId] = cur; this._save();
    return cur;
  }
  totalStars() { return Object.values(this.d.progress).reduce((a, p) => a + p.stars, 0); }
  isUnlocked(levelId) { return levelId <= 1 || (this.d.progress[levelId - 1]?.stars || 0) > 0; }
  submitScore(entry) {
    this.d.scores.push({ ...entry, date: Date.now() });
    if (this.d.scores.length > 300) this.d.scores = this.d.scores.slice(-300);
    this._save();
  }
  recordChallenge(ch) {
    const dup = this.d.scores.some((s) => s.source === 'friend' && s.seed === ch.seed && s.name === ch.name && s.levelId === ch.level);
    if (!dup) this.submitScore({ name: ch.name, avatar: ch.avatar, levelId: ch.level, score: ch.score, stars: ch.stars ?? 0, seed: ch.seed, source: 'friend' });
  }
  getLeaderboard({ levelId } = {}) {
    return this.d.scores
      .filter((s) => levelId === undefined || s.levelId === levelId)
      .slice()
      .sort((a, b) => a.score - b.score || b.stars - a.stars || a.date - b.date)
      .slice(0, 30);
  }
  getBest(key) {
    const v = this.d.bests?.[key];
    return typeof v === 'number' ? v : null;
  }
  rememberBest(key, score) {
    this.d.bests ??= {};
    const previous = this.getBest(key);
    if (previous == null || score < previous) this.d.bests[key] = score;
    this._save();
    return { previous, best: this.d.bests[key], improved: previous == null || score < previous };
  }
  getDailyState(now = new Date()) {
    const date = dailyDateKey(now);
    const history = this.d.daily?.results || {};
    const today = history[date]?.official ? history[date] : null;
    return {
      date,
      history,
      today,
      done: !!today,
      streak: computeStreak(history, date),
      bestScore: bestOfficialScore(history),
    };
  }
  recordDailyResult({ date, score, seed, name, avatar }) {
    this.d.daily ??= { results: {} };
    const applied = applyDailyResult(this.d.daily.results, date, { score, seed });
    this.d.daily.results = applied.history;
    this._save();
    const leaderboard = applied.recorded
      ? this.submitDailyScore({ date, score, seed, name, avatar, streak: applied.streak.current })
      : { submitted: false, reason: 'not-recorded' };
    return { ...applied, leaderboard };
  }
  // 全球每日榜挂钩。本地原型只表示「还没提交」。RemoteBackend 应 POST 这条成绩并返回名次。
  submitDailyScore(_entry) {
    return { submitted: false, reason: 'local-only' };
  }
  // RemoteBackend 返回 { available: true, date, entries: [{ rank, name, avatar, score }] }。
  getDailyLeaderboard({ date } = {}) {
    return { available: false, date: date ?? null, entries: [] };
  }
}
