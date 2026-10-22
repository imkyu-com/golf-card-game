import './style.css';
import { TableScene } from './scene/scene3d.js';
import * as R from './game/rules.js';
import * as AI from './game/ai.js';
import { mulberry32, hashSeed, randomSeed } from './game/rng.js';
import { LEVELS, AI_NAMES, getLevel, starsFor } from './game/levels.js';
import { newColumnPairs, pairFloaterLabel, resultFeedback } from './game/feedback.js';
import {
  DAILY_TIMEZONE, dailyDateKey, dailySeed, dailyShareText, formatLongDate, formatShareDate, monthCells,
} from './game/daily.js';
import { LocalBackend } from './social/backend.js';
import { challengeUrl, readChallengeFromUrl, resultText, resultCardImage, dailyCardImage } from './social/share.js';
import { sfx, setSoundEnabled, unlockAudio, haptic, isSoundEnabled } from './audio.js';

// ---------------------------------------------------------------- 基础
const backend = new LocalBackend(); // 以后替换为 RemoteBackend 即可接入真实服务端
const ui = document.getElementById('ui');
const labels = document.getElementById('labels');
const scene = new TableScene(document.getElementById('stage'));
setSoundEnabled(backend.getSettings().sound !== false);
window.addEventListener('pointerdown', unlockAudio, { once: false });

const AVATARS = ['😎', '🦄', '🐯', '🐼', '🦊', '🐸', '🐵', '🐧', '🐙', '🦁', '🐨', '🐶', '🐱', '🐻', '🐲', '🌟', '🍀', '⛳'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const starStr = (n) => '★'.repeat(n) + `<span class="star-off">${'★'.repeat(3 - n)}</span>`;
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
function show(el) { ui.innerHTML = ''; if (el) ui.appendChild(el); return el; }
function modal(el) { ui.appendChild(el); return el; }
function toast(msg, cls = '') {
  const t = h(`<div class="toast-msg ${cls}">${esc(msg)}</div>`);
  const box = document.getElementById('toast'); box.innerHTML = ''; box.appendChild(t);
  setTimeout(() => t.remove(), 2300);
}
const fxLayer = document.createElement('div');
fxLayer.id = 'fx';
document.body.appendChild(fxLayer);
const isCampaign = (level) => level.id > 0;
const motionOk = () => !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function snapGrids(s) {
  return s.players.map((pl) => pl.grid.map((g) => ({ card: g.card, up: g.up })));
}
function chipAnchor(player) {
  if (player === 0) {
    const el = document.getElementById('mechip');
    if (el && el.getBoundingClientRect().width) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  } else {
    const el = labels.querySelectorAll('.label-abs')[player - 1];
    if (el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return { x: window.innerWidth / 2, y: 78 };
}
function spawnFloater(text, from, to, { delay = 0, good = true } = {}) {
  const el = document.createElement('div');
  el.className = `score-floater ${good ? 'good' : 'bad'}`;
  el.textContent = text;
  fxLayer.appendChild(el);
  const anim = el.animate([
    { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(.55)`, opacity: 0 },
    { transform: `translate(${from.x}px, ${from.y - 34}px) translate(-50%, -50%) scale(1.18)`, opacity: 1, offset: 0.22 },
    { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(.45)`, opacity: 0 },
  ], { duration: 780, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
  anim.onfinish = () => el.remove();
}
// 新凑成的对子：一声、两张牌闪光、抵消的分数飞向计分牌。不 await，不拉长回合。
function playPairJuice(s, beforeSnaps) {
  const groups = [];
  s.players.forEach((pl, i) => {
    if (!beforeSnaps[i]) return;
    const found = newColumnPairs(beforeSnaps[i], pl.grid, s.rules);
    if (found.pairs.length || found.bonusDelta) groups.push({ player: i, ...found });
  });
  if (!groups.some((g) => g.pairs.length)) return;
  sfx.pair();
  haptic();
  if (isSoundEnabled() && motionOk()) scene.shake(0.2);
  scene.celebrateCards(groups.flatMap((g) => g.pairs.flatMap((p) => p.ids)));
  for (const g of groups) {
    const to = chipAnchor(g.player);
    g.pairs.forEach((p, idx) => {
      const label = pairFloaterLabel(p.cancelled);
      const a = scene.cardScreenPos(p.ids[0]);
      const b = scene.cardScreenPos(p.ids[1]);
      if (!label || !a || !b) return;
      spawnFloater(label, { x: (a.x + b.x) / 2 + idx * 18, y: (a.y + b.y) / 2 }, to, { delay: idx * 40, good: p.cancelled > 0 });
    });
    if (g.bonusDelta && g.pairs[0]) {
      const a = scene.cardScreenPos(g.pairs[0].ids[0]);
      if (a) spawnFloater(`四条${g.bonusDelta}`, { x: a.x, y: a.y - 26 }, to, { delay: 70, good: g.bonusDelta < 0 });
    }
  }
}
function noteAction(s, before) {
  if (s.phase === 'over') { s._revealBaseline = before; return; }
  playPairJuice(s, before);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

// ---------------------------------------------------------------- 流程控制（可中断）
let token = 0; // 每次开新对局/退出时递增，旧流程的 await 会抛出 ABORT
const ABORT = Symbol('abort');
const sleep = (ms, tk) => new Promise((res, rej) => setTimeout(() => (tk !== token ? rej(ABORT) : res()), ms));
let pending = null; // 等待玩家点击 { accept(hit)→bool, resolve, reject }
scene.onPick = (hit) => {
  if (!pending) return;
  if (pending.accept(hit)) { const p = pending; pending = null; scene.setHighlight(); p.resolve(hit); }
};
function waitPick({ deck = false, discard = false, slots = [] }, tk) {
  scene.setHighlight({ deck, discard, slots });
  return new Promise((resolve, reject) => {
    pending = {
      tk, resolve, reject,
      accept: (hit) => (hit.kind === 'deck' && deck) || (hit.kind === 'discard' && discard) || (hit.kind === 'slot' && slots.includes(hit.slot)),
    };
  });
}
function abortAll() {
  token++;
  if (pending) { pending.reject(ABORT); pending = null; }
  scene.setHighlight();
  labels.innerHTML = '';
}

// ---------------------------------------------------------------- 首页 3D 背景
function demoTable() {
  const s = R.createHole({ seed: 2026, numPlayers: 4 });
  s.players.forEach((pl, p) => pl.grid.forEach((g, i) => { if ((i + p) % 2 === 0 || p === 0) g.up = true; }));
  scene.setupSeats(4);
  scene.setupHole(s);
  scene.setPaired([]);
  scene.layout(s, { stagger: 0.02 });
}

// ---------------------------------------------------------------- 资料
function profile() { return backend.getProfile(); }
function profileModal(first = false) {
  return new Promise((resolve) => {
    const cur = profile() || { name: '玩家' + Math.floor(1000 + Math.random() * 9000), avatar: AVATARS[Math.floor(Math.random() * 6)] };
    let av = cur.avatar;
    const el = h(`<div class="overlay"><div class="panel">
      <h2>${first ? '👋 欢迎来到 3D 高尔夫纸牌' : '编辑个人资料'}</h2>
      <p class="muted">昵称和头像会显示在排行榜和分享给好友的挑战里。</p>
      <input class="text" id="nm" maxlength="12" value="${esc(cur.name)}" placeholder="输入昵称" />
      <div class="av-grid">${AVATARS.map((a) => `<button data-a="${a}" class="${a === av ? 'sel' : ''}">${a}</button>`).join('')}</div>
      <div class="row center"><button class="btn" id="ok">${first ? '开始游戏' : '保存'}</button></div>
    </div></div>`);
    el.querySelectorAll('.av-grid button').forEach((b) => b.onclick = () => { av = b.dataset.a; el.querySelectorAll('.av-grid button').forEach((x) => x.classList.toggle('sel', x === b)); sfx.click(); });
    el.querySelector('#ok').onclick = () => {
      const name = el.querySelector('#nm').value.trim() || cur.name;
      backend.saveProfile({ name, avatar: av });
      sfx.click(); el.remove(); resolve();
    };
    modal(el);
  });
}

// ---------------------------------------------------------------- 首页
function renderHome() {
  abortAll();
  demoTable();
  const p = profile();
  const el = show(h(`<div class="overlay home">
    <div class="logo">⛳ 3D 高尔夫纸牌</div>
    <div class="sub">翻牌、换牌、凑对子 —— 总分越低越好</div>
    <div class="profile-chip" id="prof"><span class="av">${p.avatar}</span><span><b>${esc(p.name)}</b><br/><span class="stars-total">★ ${backend.totalStars()} / ${LEVELS.length * 3}</span></span></div>
    <div class="menu">
      <button class="btn daily" id="daily">📅 每日挑战${backend.getDailyState().done ? '' : '<span class="badge">未完成</span>'}</button>
      <button class="btn" id="play">🏌️ 闯关模式</button>
      <button class="btn green" id="quick">🎲 自由对局</button>
      <button class="btn secondary" id="lb">🏆 排行榜</button>
      <button class="btn secondary" id="rules">📖 玩法教程</button>
    </div>
    <div class="row center"><button class="icon-btn" id="snd">${backend.getSettings().sound !== false ? '🔊' : '🔇'}</button></div>
  </div>`));
  el.querySelector('#daily').onclick = () => { sfx.click(); renderDaily(); };
  el.querySelector('#play').onclick = () => { sfx.click(); renderMap(); };
  el.querySelector('#quick').onclick = () => { sfx.click(); startMatch(0, {}); };
  el.querySelector('#lb').onclick = () => { sfx.click(); renderLeaderboard(); };
  el.querySelector('#rules').onclick = () => { sfx.click(); renderRules(); };
  el.querySelector('#prof').onclick = async () => { await profileModal(); renderHome(); };
  el.querySelector('#snd').onclick = (e) => {
    const on = backend.getSettings().sound === false;
    backend.saveSettings({ sound: on }); setSoundEnabled(on);
    e.target.textContent = on ? '🔊' : '🔇'; sfx.click();
  };
}

// ---------------------------------------------------------------- 关卡地图
function renderMap() {
  abortAll();
  const prog = backend.getProgress();
  const el = show(h(`<div class="map-wrap">
    <div class="topbar"><button class="icon-btn" id="back">←</button><div class="title">闯关地图</div><div class="stars-total">★ ${backend.totalStars()} / ${LEVELS.length * 3}</div></div>
    <div class="map" id="map"></div></div>`));
  el.querySelector('#back').onclick = () => { sfx.click(); renderHome(); };
  const map = el.querySelector('#map');
  const W = Math.min(map.clientWidth || window.innerWidth, 560), off = ((map.clientWidth || window.innerWidth) - W) / 2;
  const stepY = 118, H = LEVELS.length * stepY + 80;
  const pts = LEVELS.map((lv, i) => ({ x: off + W / 2 + Math.sin(i * 1.15) * W * 0.3, y: H - 70 - i * stepY }));
  let path = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; path += ` C ${a.x} ${a.y - stepY / 2}, ${b.x} ${b.y + stepY / 2}, ${b.x} ${b.y}`; }
  const inner = h(`<div style="position:relative;height:${H}px"><svg width="${off * 2 + W}" height="${H}"><path d="${path}" stroke="rgba(255,255,255,.35)" stroke-width="10" stroke-dasharray="2 18" stroke-linecap="round" fill="none"/></svg></div>`);
  let current = 1;
  for (const lv of LEVELS) if (backend.isUnlocked(lv.id)) current = lv.id;
  LEVELS.forEach((lv, i) => {
    const unlocked = backend.isUnlocked(lv.id);
    const st = prog[lv.id]?.stars || 0;
    const node = h(`<div class="node ${unlocked ? '' : 'locked'} ${lv.id === current && st === 0 ? 'current' : ''}" style="left:${pts[i].x}px;top:${pts[i].y}px">
      <div class="st">${unlocked ? starStr(st) : ''}</div><div class="disc">${unlocked ? lv.id : '🔒'}</div><div class="nm">${esc(lv.name)}</div></div>`);
    node.onclick = () => { sfx.click(); if (!unlocked) return toast('先通过上一关解锁', 'info'); levelInfo(lv); };
    inner.appendChild(node);
  });
  map.appendChild(inner);
  map.scrollTop = Math.max(0, pts[current - 1].y - map.clientHeight / 2);
}

function opponentsHtml(lv) {
  const lvName = { easy: '新手', normal: '普通', hard: '高手' };
  return lv.opponents.map((o) => `${AI_NAMES[o.ai].avatar} ${AI_NAMES[o.ai].name}<span class="tag">${lvName[o.level]}</span>`).join('<br/>');
}
function levelInfo(lv) {
  const pr = backend.getProgress()[lv.id];
  const el = modal(h(`<div class="overlay"><div class="panel">
    <h2>第 ${lv.id} 关 · ${esc(lv.name)}</h2>
    <p>${esc(lv.desc)}</p>
    <p><b>对手：</b><br/>${opponentsHtml(lv)}</p>
    <p><b>局数：</b>${lv.holes} 局（总分最低者获胜）</p>
    <p><b>星级：</b>获胜 ★ ｜ 总分 ≤ ${lv.t2} ★★ ｜ 总分 ≤ ${lv.t3} ★★★</p>
    ${pr ? `<p class="muted">最佳成绩：${pr.best} 分 · 已玩 ${pr.plays} 次</p>` : ''}
    <div class="row center"><button class="btn secondary" id="x">返回</button><button class="btn" id="go">开始挑战</button></div>
  </div></div>`));
  el.querySelector('#x').onclick = () => { sfx.click(); el.remove(); };
  el.querySelector('#go').onclick = () => { sfx.click(); startMatch(lv.id, {}); };
}

// ---------------------------------------------------------------- 教程
function renderRules(onDone) {
  const el = modal(h(`<div class="overlay"><div class="panel">
    <h2>📖 玩法教程</h2>
    <h3>🎯 目标</h3><p>每人 6 张牌（2 行 × 3 列），<b>总分越低越好</b>，像高尔夫一样比谁“杆数”少。</p>
    <h3>🃏 开局</h3><p>所有牌背面朝上发出，每人先翻开 2 张（部分关卡只翻 1 张）。</p>
    <h3>🔁 每回合</h3><ol>
      <li><b>摸牌：</b>点<b>左边牌堆</b>摸一张新牌，或点<b>右边弃牌堆</b>拿走最上面那张。</li>
      <li><b>换牌：</b>点你的任意一张牌（明牌或暗牌）与它交换，换下来的牌放进弃牌堆。</li>
      <li><b>或者弃掉：</b>如果是从牌堆摸的牌，也可以直接弃掉，然后<b>翻开自己一张暗牌</b>。从牌堆摸的牌不能放回牌堆。</li>
      <li><b>放回：</b>从弃牌堆拿起的牌，在换进自己的牌阵之前不算拿走。可以点<b>「放回」</b>或再点弃牌堆，把牌放回去，重新选择牌堆或弃牌堆。这一步不消耗回合。</li></ol>
    <h3>✅ 配对抵消</h3><p>同一<b>列</b>上下两张点数相同 → 这一列直接记 <b>0 分</b>，牌上也会改成 0。一对 2 或一对王牌是 0，不是 -4；特殊关里 K 即使是 +12，一对 K 仍是 0。横排或斜角不算对子。</p>
    <h3>🏁 结束</h3><p>有人 6 张全部翻开后，其他人<b>各再走最后一回合</b>，然后全部亮牌计分。</p>
    <h3>🔢 分值</h3><div class="cards-demo">
      <div>A<small>1 分</small></div><div>2<small>-2 分</small></div><div>3~10<small>牌面分</small></div><div>J / Q<small>10 分</small></div><div>K<small>0 分</small></div><div>★王<small>-2 分</small></div></div>
    <h3>⭐ 闯关</h3><p>每关打若干局，累计总分最低即获胜。赢下得 1 星，总分低于目标再拿 2、3 星。通关解锁下一关，后面会有更多对手和特殊规则（王牌、只翻 1 张、K 变 12 分、四条奖励…）。</p>
    <h3>🤝 挑战好友</h3><p>结算时点「挑战好友」会生成一个链接，里面包含这一关的<b>同一副牌</b>和你的分数。好友打开后用同样的发牌比拼分数，对方成绩也会进入你本机的排行榜。</p>
    <h3>📅 每日挑战</h3><p>按<b>北京时间</b>每天一副牌，所有人相同。当天第一次打完才记分，并累计连续天数。同一天再打是练习，不改成绩。</p>
    <div class="row center"><button class="btn" id="ok">明白了</button></div>
  </div></div>`));
  el.querySelector('#ok').onclick = () => { sfx.click(); el.remove(); onDone && onDone(); };
}

// ---------------------------------------------------------------- 排行榜
function renderLeaderboard() {
  abortAll();
  let sel = 'all';
  const el = show(h(`<div class="overlay"><div class="panel">
    <h2>🏆 排行榜</h2>
    <div class="row"><select class="text" id="lv"><option value="all">全部关卡</option><option value="0">自由对局</option>${LEVELS.map((l) => `<option value="${l.id}">第 ${l.id} 关 · ${esc(l.name)}</option>`).join('')}</select></div>
    <p class="muted">原型版排行榜保存在本机：包含你的成绩，以及好友挑战链接里带来的对方成绩。接入服务器后可升级为全球榜。</p>
    <div id="list"></div>
    <div class="row center"><button class="btn secondary" id="back">返回</button></div>
  </div></div>`));
  const draw = () => {
    const list = backend.getLeaderboard(sel === 'all' ? {} : { levelId: +sel });
    const me = profile();
    el.querySelector('#list').innerHTML = list.length ? list.map((s, i) => `<div class="lb-item"><div class="rk">${i + 1}</div><div class="av">${s.avatar}</div>
      <div class="nm">${esc(s.name)}${s.source === 'friend' ? '<span class="tag friend">好友挑战</span>' : s.name === me.name ? '<span class="tag">我</span>' : ''}
      <div class="muted">${s.levelId > 0 ? `第 ${s.levelId} 关` : s.levelId === -1 ? '每日挑战' : '自由对局'} · ${new Date(s.date).toLocaleDateString('zh-CN')} · <span style="color:#ffd166">${'★'.repeat(s.stars || 0)}</span></div></div>
      <div class="sc">${s.score}</div></div>`).join('') : '<p class="muted" style="text-align:center">还没有成绩，快去打一局吧！</p>';
  };
  el.querySelector('#lv').onchange = (e) => { sel = e.target.value; draw(); };
  el.querySelector('#back').onclick = () => { sfx.click(); renderHome(); };
  draw();
}

// ---------------------------------------------------------------- 对局
let match = null;

async function startMatch(levelId, { seed, challenge, daily } = {}) {
  abortAll();
  const tk = token;
  const level = getLevel(levelId);
  const me = profile();
  match = {
    level, seed: seed ?? randomSeed(), challenge, daily: daily || null, hole: 0, tk,
    players: [{ name: me.name, avatar: me.avatar, human: true }, ...level.opponents.map((o) => ({ ...AI_NAMES[o.ai], ai: o.level }))],
    totals: [], holeScores: [],
  };
  match.totals = match.players.map(() => 0);
  scene.setupSeats(match.players.length);
  try {
    for (let hIdx = 0; hIdx < level.holes; hIdx++) {
      match.hole = hIdx;
      const scores = await playHole(hIdx, tk);
      scores.forEach((s, i) => (match.totals[i] += s));
      match.holeScores.push(scores);
      await holeResult(scores, hIdx === level.holes - 1, tk);
    }
    matchResult();
  } catch (e) {
    if (e !== ABORT) { console.error(e); toast('出错了：' + e.message); }
  }
}

function hudTitle(level) {
  if (level.daily) return '每日挑战';
  return `${level.id ? `第 ${level.id} 关 · ` : ''}${esc(level.name)}`;
}
function hudSub() {
  const { level, hole, daily, challenge } = match;
  const bits = [`第 ${hole + 1} / ${level.holes} 局`];
  if (daily) bits.push(formatShareDate(daily.date) + (daily.practice ? ' · 练习' : ''));
  if (challenge) bits.push(`挑战 ${challenge.name}（${challenge.score} 分）`);
  return bits.join(' · ');
}
function renderHud() {
  const { level } = match;
  const el = show(h(`<div>
    <div class="hud-top">
      <button class="icon-btn" id="menu">☰</button>
      <div class="hud-title"><b>${hudTitle(level)}</b><small>${esc(hudSub())}</small></div>
      <button class="icon-btn" id="help">?</button>
    </div>
    <div class="me-chip" id="mechip"></div>
    <div class="hud-bottom"><div class="hint" id="hint">发牌中…</div><div class="row center" id="actions"></div></div>
  </div>`));
  el.querySelector('#help').onclick = () => { sfx.click(); renderRules(); };
  el.querySelector('#menu').onclick = () => {
    sfx.click();
    const m = modal(h(`<div class="overlay"><div class="panel" style="width:min(340px,100%)"><h2>暂停</h2><div class="col">
      <button class="btn" id="c">继续游戏</button><button class="btn secondary" id="r">重新开始本关</button>
      <button class="btn secondary" id="m">返回${match.level.daily ? '每日挑战' : match.level.id ? '地图' : '首页'}</button></div></div></div>`));
    m.querySelector('#c').onclick = () => m.remove();
    m.querySelector('#r').onclick = () => {
      if (match.daily) startDaily({ practice: !!match.daily.practice });
      else startMatch(match.level.id, { seed: match.challenge ? match.seed : undefined, challenge: match.challenge });
    };
    m.querySelector('#m').onclick = () => (match.level.daily ? renderDaily() : match.level.id ? renderMap() : renderHome());
  };
}

function setHint(text, mine = false, buttons = []) {
  const hint = document.getElementById('hint'), act = document.getElementById('actions');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle('mine', mine);
  act.innerHTML = '';
  for (const b of buttons) {
    const el = h(`<button class="btn small ${b.cls || ''}">${b.label}</button>`);
    el.onclick = () => { sfx.click(); b.onClick(); };
    act.appendChild(el);
  }
}

// 玩家标签：投影 3D 座位位置到屏幕
function updateLabels(s) {
  if (!match || !s) return;
  const portrait = window.innerWidth < window.innerHeight;
  const chips = match.players.map((pl, i) => {
    const visScore = R.scoreGrid(s.players[i].grid, s.rules, true);
    const bonus = visScore.bonus ? ` · 四条${visScore.bonus}` : '';
    const cls = `pchip ${s.phase !== 'over' && s.current === i && s.phase !== 'initial' ? 'turn' : ''} ${s.finisher === i ? 'finisher' : ''}`;
    const detail = portrait && i > 0
      ? `${visScore.total} 分`
      : `明牌 ${visScore.total}${bonus} · 总分 ${match.totals[i]}`;
    return `<div class="${cls}"><span class="av">${pl.avatar}</span><span class="meta"><b>${esc(pl.name)}</b><br/><span>${detail}</span></span></div>`;
  });
  const me = document.getElementById('mechip');
  if (me) me.innerHTML = chips[0];
  let html = '';
  for (let i = 1; i < chips.length; i++) {
    if (portrait) {
      const a = scene.seatAnchor(i);
      if (!a) continue;
      const x = Math.min(window.innerWidth - 58, Math.max(58, a.x));
      const y = Math.max(68, a.y);
      html += `<div class="label-abs above" style="left:${x}px;top:${y}px">${chips[i]}</div>`;
    } else {
      const p = scene.seatScreenPos(i);
      if (!p) continue;
      const x = Math.min(window.innerWidth - 80, Math.max(80, p.x)), y = Math.min(window.innerHeight - 90, Math.max(110, p.y));
      html += `<div class="label-abs" style="left:${x}px;top:${y}px">${chips[i]}</div>`;
    }
  }
  labels.innerHTML = html;
}
let labelState = null;
scene.onFrame = (() => { let n = 0; return () => { if (labelState && (n++ % 6 === 0)) updateLabels(labelState); }; })();

async function playHole(hIdx, tk) {
  const n = match.players.length;
  const s = R.createHole({ rules: match.level.rules, seed: hashSeed(match.seed, 'hole', hIdx), numPlayers: n, startPlayer: hIdx % n });
  const aiRng = match.players.map((_, i) => mulberry32(hashSeed(match.seed, 'ai', hIdx, i)));
  renderHud();
  labelState = s;
  scene.setPaired([]);
  scene.setupHole(s);
  await sleep(150, tk);
  sfx.draw();
  await scene.layout(s, { stagger: 0.03, duration: 0.5 });
  if (tk !== token) throw ABORT;

  // AI 开局翻牌
  const beforeAiFlip = snapGrids(s);
  for (let p = 1; p < n; p++) {
    for (const slot of AI.chooseInitialFlips(s, p, aiRng[p])) R.initialFlip(s, p, slot);
  }
  sfx.flip();
  await scene.layout(s);
  playPairJuice(s, beforeAiFlip);
  // 玩家开局翻牌
  while (s.players[0].flipsLeft > 0) {
    setHint(`点击你面前的牌，翻开 ${s.players[0].flipsLeft} 张`, true);
    const hit = await waitPick({ slots: R.faceDownSlots(s.players[0]) }, tk);
    const beforeFlip = snapGrids(s);
    R.initialFlip(s, 0, hit.slot);
    sfx.flip();
    await scene.layout(s);
    playPairJuice(s, beforeFlip);
  }
  let warned = false;
  while (s.phase !== 'over') {
    if (tk !== token) throw ABORT;
    if (s.finisher !== null && !warned) {
      warned = true; sfx.lastRound();
      toast(`${match.players[s.finisher].name} 已全部翻开 —— 最后一轮！`);
      await sleep(900, tk);
    }
    if (s.current === 0) await humanTurn(s, tk);
    else await aiTurn(s, s.current, aiRng[s.current], tk);
  }
  // 终局分只在全部翻开之后现算一次。结算表、明牌、列高亮、牌上的 0 分都用这一份。
  for (const pl of s.players) for (const g of pl.grid) g.up = true;
  const finalScores = s.players.map((pl) => R.scoreGrid(pl.grid, s.rules));
  s.scores = finalScores;
  if (match) match.holeBreakdown = finalScores;
  setHint('亮牌计分…');
  sfx.flip();
  await scene.layout(s, { stagger: 0.02 });
  if (s._revealBaseline) playPairJuice(s, s._revealBaseline);
  updateLabels(s);
  await sleep(1600, tk);
  return finalScores.map((x) => x.total);
}

function formatCols(sc) {
  if (!sc) return '';
  const body = sc.columns.map((c) => (c.paired ? '0' : String(c.score))).join('·');
  return sc.bonus ? `${body}·四条${sc.bonus}` : body;
}

async function humanTurn(s, tk) {
  const all = [0, 1, 2, 3, 4, 5];
  const before = snapGrids(s);
  for (;;) {
    if (tk !== token) throw ABORT;
    const top = s.discard[s.discard.length - 1];
    setHint(`你的回合：点左边牌堆摸牌，或点右边弃牌堆拿 ${top ? R.rankLabel(top.rank) : ''}`, true);
    const hit = await waitPick({ deck: true, discard: !!top, slots: [] }, tk);
    if (hit.kind === 'deck') R.drawFromDeck(s); else R.takeDiscard(s);
    sfx.draw();
    await scene.layout(s);
    if (tk !== token) throw ABORT;
    const held = s.held;
    const v = R.cardValue(held, s.rules);
    const fromDiscard = s.heldFrom === 'discard';
    let choice;
    if (fromDiscard) {
      setHint(`拿了 ${R.rankLabel(held.rank)}（${v} 分）：点你的一张牌交换，或放回弃牌堆`, true, [{ label: '↩ 放回', cls: 'secondary', onClick: () => pending && pending.resolve({ kind: 'return' }) }]);
      choice = await waitPick({ slots: all, discard: true }, tk);
    } else {
      setHint(`摸到 ${R.rankLabel(held.rank)}（${v} 分）：点你的一张牌交换，或弃掉它`, true, [{ label: '🗑️ 弃掉这张', cls: 'secondary', onClick: () => pending && pending.resolve({ kind: 'discard' }) }]);
      choice = await waitPick({ slots: all, discard: true }, tk);
    }
    pending = null; scene.setHighlight(); setHint('…');
    if (fromDiscard && (choice.kind === 'return' || choice.kind === 'discard')) {
      R.returnDiscard(s);
      sfx.place();
      await scene.layout(s);
      continue;
    }
    if (choice.kind === 'slot') {
      R.swapHeld(s, choice.slot);
      sfx.place();
      await scene.layout(s);
      noteAction(s, before);
    } else {
      R.discardHeld(s);
      sfx.place();
      await scene.layout(s);
      if (s.phase === 'flip') {
        setHint('翻开你的一张暗牌', true);
        const f = await waitPick({ slots: R.faceDownSlots(s.players[0]) }, tk);
        R.flipAfterDiscard(s, f.slot);
        sfx.flip();
        await scene.layout(s);
      }
      noteAction(s, before);
    }
    return;
  }
}

async function aiTurn(s, p, rng, tk) {
  const pl = match.players[p];
  const before = snapGrids(s);
  setHint(`${pl.avatar} ${pl.name} 思考中…`);
  await sleep(450 + rng() * 350, tk);
  const src = AI.chooseDraw(s, p, pl.ai, rng);
  if (src === 'discard') R.takeDiscard(s); else R.drawFromDeck(s);
  setHint(`${pl.avatar} ${pl.name} ${src === 'discard' ? '从弃牌堆拿了' : '摸到了'} ${R.rankLabel(s.held.rank)}`);
  sfx.draw();
  await scene.layout(s);
  await sleep(500, tk);
  const d = AI.choosePlacement(s, p, pl.ai, rng);
  if (d.type === 'swap') {
    R.swapHeld(s, d.slot);
    sfx.place();
    await scene.layout(s);
  } else {
    R.discardHeld(s);
    sfx.place();
    await scene.layout(s);
    if (s.phase === 'flip') {
      await sleep(250, tk);
      R.flipAfterDiscard(s, d.slot ?? R.faceDownSlots(s.players[p])[0]);
      sfx.flip();
      await scene.layout(s);
    }
  }
  noteAction(s, before);
  await sleep(200, tk);
}

function holeResult(scores, last, tk) {
  return new Promise((resolve, reject) => {
    if (tk !== token) return reject(ABORT);
    const best = Math.min(...match.totals);
    const rows = match.players.map((pl, i) => `<tr class="${match.totals[i] === best ? 'best' : ''} ${i === 0 ? 'me' : ''}"><td><span class="who">${pl.avatar} ${esc(pl.name)}</span><div class="cols">${formatCols(match.holeBreakdown?.[i])}</div></td><td>${scores[i]}</td><td>${match.totals[i]}</td></tr>`).join('');
    const el = modal(h(`<div class="overlay clear" style="align-items:flex-end;padding-bottom:90px"><div class="panel" style="width:min(420px,100%)">
      <h2>第 ${match.hole + 1} 局结束</h2>
      <table class="score"><tr><th>玩家</th><th>本局</th><th>总分</th></tr>${rows}</table>
      <p class="muted">三列里的 0 是同列对子（含一对 2、一对王牌、一对 K），不计入本局，也不加进总分。绿色发光的牌同样记 0 分。</p>
      <div class="row center"><button class="btn" id="n">${last ? '查看结果' : '下一局 →'}</button></div></div></div>`));
    el.querySelector('#n').onclick = () => { sfx.click(); el.remove(); tk === token ? resolve() : reject(ABORT); };
  });
}

function matchResult() {
  const { level, totals, players, seed, challenge, daily } = match;
  labelState = null; labels.innerHTML = '';
  const my = totals[0];
  const won = totals.every((t, i) => i === 0 || my <= t);
  const stars = starsFor(level, my, won);
  const me = profile();
  const bestOpponent = totals.length > 1 ? Math.min(...totals.slice(1)) : null;
  const dailyBefore = daily ? backend.getDailyState() : null;
  let prevStars = 0;
  let previousBest = null;
  let dailyRec = null;
  if (isCampaign(level)) {
    previousBest = backend.getProgress()[level.id]?.best ?? null;
    prevStars = backend.getProgress()[level.id]?.stars || 0;
    backend.saveLevelResult(level.id, { stars, score: my });
    backend.submitScore({ name: me.name, avatar: me.avatar, levelId: level.id, score: my, stars, seed, source: 'self' });
  } else if (!level.daily) {
    previousBest = backend.getBest('quick');
    backend.rememberBest('quick', my);
    backend.submitScore({ name: me.name, avatar: me.avatar, levelId: level.id, score: my, stars, seed, source: 'self' });
  } else if (daily && !daily.practice) {
    previousBest = dailyBefore.bestScore;
    dailyRec = backend.recordDailyResult({ date: daily.date, score: my, seed, name: me.name, avatar: me.avatar });
  } else if (dailyBefore) {
    previousBest = dailyBefore.bestScore;
  }
  const feedback = resultFeedback({ level, my, won, bestOpponent, previousBest });
  const nearLines = feedback.lines;
  const pbLine = daily && daily.practice
    ? (dailyBefore.today ? `练习局，不记分 · 今日成绩 ${dailyBefore.today.score} 分` : '练习局，不计入成绩和连续天数')
    : feedback.personalBest;
  const streak = dailyRec?.streak || dailyBefore?.streak;
  won ? sfx.win() : sfx.lose();
  const ch = { v: 1, seed, level: level.id, score: my, name: me.name, avatar: me.avatar, stars };
  const url = challengeUrl(ch);
  const order = players.map((p, i) => ({ ...p, total: totals[i], i })).sort((a, b) => a.total - b.total);
  const nextLv = isCampaign(level) ? LEVELS.find((l) => l.id === level.id + 1) : null;
  let vs = '';
  if (challenge) {
    const res = my < challenge.score ? '🎉 你赢了好友！' : my === challenge.score ? '🤝 打平了！' : '😅 好友更胜一筹';
    vs = `<div class="vs">同一副牌对决：你 <b>${my}</b> 分 vs ${challenge.avatar} ${esc(challenge.name)} <b>${challenge.score}</b> 分<br/><b>${res}</b></div>`;
  }
  const title = daily
    ? (daily.practice ? '练习结束' : '📅 每日挑战完成')
    : (won ? '🏆 胜利！' : '惜败…');
  const officialScore = daily ? (dailyRec?.today?.score ?? dailyBefore?.today?.score ?? null) : null;
  const shareStreak = streak?.current ?? 0;
  const el = show(h(`<div class="overlay"><div class="panel">
    <p class="result-title" style="color:${won ? '#7ee787' : '#ff9b9b'}">${title}</p>
    <div class="bigstars">${[0, 1, 2].map((i) => `<span style="animation-delay:${0.2 + i * 0.25}s" class="${i < stars ? '' : 'star-off'}">★</span>`).join('')}</div>
    ${nearLines.map((t) => `<div class="near-miss">${t}</div>`).join('')}
    ${isCampaign(level) && stars > prevStars && prevStars > 0 ? '<p style="text-align:center;color:#ffd166">星级提升！</p>' : ''}
    <p class="pb-line">${pbLine}</p>
    ${streak ? `<p class="streak-line">连续 ${streak.current} 天 🔥 · 最佳连续 ${streak.best} 天</p>` : ''}
    ${vs}
    <table class="score"><tr><th>名次</th><th>玩家</th><th>总分</th></tr>${order.map((p, r) => `<tr class="${r === 0 ? 'best' : ''} ${p.i === 0 ? 'me' : ''}"><td>${r + 1}</td><td><span class="who">${p.avatar} ${esc(p.name)}</span></td><td>${p.total}</td></tr>`).join('')}</table>
    <p class="muted" style="text-align:center">★★ 需 ≤ ${level.t2} 分 · ★★★ 需 ≤ ${level.t3} 分</p>
    <div class="col">
      <button class="btn xl" id="again">再来一局</button>
      ${daily ? '<p class="muted" style="text-align:center;margin:-6px 0 0">再来一局只练习，不改今日成绩，也不增加连续天数。</p>' : ''}
      <div class="row center">
        ${daily ? (officialScore == null ? '' : '<button class="btn green" id="share">📤 分享今日成绩</button>') : '<button class="btn green" id="chal">🤝 挑战好友</button><button class="btn green" id="share">📸 分享战绩</button>'}
        ${nextLv && backend.isUnlocked(nextLv.id) ? '<button class="btn" id="next">下一关 →</button>' : ''}
      </div>
      <div class="row center"><button class="btn secondary small" id="map">${daily ? '返回每日挑战' : isCampaign(level) ? '返回地图' : '返回首页'}</button><button class="btn secondary small" id="lb">排行榜</button></div>
    </div></div></div>`));
  stars && [0, 1, 2].slice(0, stars).forEach((i) => setTimeout(() => sfx.star(i), 300 + i * 250));
  const chal = el.querySelector('#chal');
  if (chal) chal.onclick = async () => {
    sfx.click();
    const text = resultText({ name: me.name, levelName: level.name, levelId: level.id, score: my, stars, won, url });
    const ok = await copyText(text);
    const m = modal(h(`<div class="overlay"><div class="panel"><h2>🤝 挑战好友</h2>
      <p>${ok ? '✅ 挑战链接已复制，发给好友吧！' : '复制下面的链接发给好友：'}好友打开后会拿到<b>完全相同的发牌</b>，和你的 ${my} 分比拼。</p>
      <input class="text" readonly value="${esc(url)}" onclick="this.select()" />
      <div class="row center" style="margin-top:12px">${navigator.share ? '<button class="btn green" id="sys">系统分享</button>' : ''}<button class="btn secondary" id="x">关闭</button></div></div></div>`));
    m.querySelector('#x').onclick = () => m.remove();
    const sys = m.querySelector('#sys');
    if (sys) sys.onclick = () => navigator.share({ title: '3D 高尔夫纸牌挑战', text, url }).catch(() => {});
  };
  const shareBtn = el.querySelector('#share');
  if (shareBtn) shareBtn.onclick = () => {
    sfx.click();
    if (daily) {
      openDailyShare({
        date: daily.date,
        score: officialScore,
        streak: shareStreak,
        bestStreak: streak?.best ?? shareStreak,
        seed,
      });
      return;
    }
    const img = resultCardImage({ name: me.name, avatar: me.avatar, levelName: level.name, levelId: level.id, score: my, stars, won, players: order });
    const text = resultText({ name: me.name, levelName: level.name, levelId: level.id, score: my, stars, won, url });
    const m = modal(h(`<div class="overlay"><div class="panel"><h2>📸 战绩卡</h2>
      <img class="share-img" src="${img}" alt="战绩卡" />
      <div class="row center"><a class="btn green" id="dl" href="${img}" download="golf-card-${level.id}-${my}.png" style="text-decoration:none">下载图片</a>
      <button class="btn secondary" id="cp">复制文字</button><button class="btn secondary" id="x">关闭</button></div></div></div>`));
    m.querySelector('#cp').onclick = async () => { toast((await copyText(text)) ? '已复制战绩文字' : '复制失败', 'info'); };
    m.querySelector('#x').onclick = () => m.remove();
  };
  el.querySelector('#again').onclick = () => {
    sfx.click();
    if (daily) startDaily({ practice: true });
    else startMatch(level.id, {});
  };
  const nx = el.querySelector('#next');
  if (nx) nx.onclick = () => { sfx.click(); levelInfo(nextLv); };
  el.querySelector('#map').onclick = () => { sfx.click(); daily ? renderDaily() : isCampaign(level) ? renderMap() : renderHome(); };
  el.querySelector('#lb').onclick = () => { sfx.click(); renderLeaderboard(); };
}

// ---------------------------------------------------------------- 每日挑战
function startDaily({ practice = false } = {}) {
  const state = backend.getDailyState();
  startMatch(-1, {
    seed: dailySeed(state.date),
    daily: { date: state.date, practice: practice || state.done },
  });
}

function calendarHtml(state) {
  const { year, month, cells } = monthCells(state.date);
  const playedKeys = Object.keys(state.history).filter((k) => state.history[k]?.official).sort();
  const first = playedKeys[0];
  const dows = ['一', '二', '三', '四', '五', '六', '日'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  const body = cells.map((cell) => {
    if (!cell) return '<div class="cal-day pad"></div>';
    const row = state.history[cell.key];
    const played = !!(row && row.official);
    const missed = !!(first && !cell.future && !cell.today && cell.key > first && cell.key < state.date && !played);
    const cls = ['cal-day', played ? 'played' : '', cell.today ? 'today' : '', cell.future ? 'future' : '', missed ? 'miss' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}">${cell.day}${played ? `<small>${row.score}</small>` : ''}</div>`;
  }).join('');
  return `<div class="cal-title">${year}年${month}月</div><div class="cal">${dows}${body}</div>`;
}

function dailyBoardHtml(date) {
  const board = backend.getDailyLeaderboard({ date });
  if (board.available && board.entries?.length) {
    return board.entries.map((s, i) => `<div class="lb-item"><div class="rk">${s.rank ?? i + 1}</div><div class="av">${esc(s.avatar || '⛳')}</div><div class="nm">${esc(s.name)}</div><div class="sc">${s.score}</div></div>`).join('');
  }
  return '<p class="muted">全球每日排行榜即将上线。接入服务器后，今天的成绩会从这里提交并显示名次。</p>';
}

function openDailyShare({ date, score, streak, bestStreak, seed }) {
  const me = profile();
  const payload = { v: 1, seed: seed || dailySeed(date), level: -1, score, name: me.name, avatar: me.avatar, stars: 0, daily: date, streak };
  const url = challengeUrl(payload);
  const text = dailyShareText({ dateKey: date, score, streak, url });
  const img = dailyCardImage({
    name: me.name, avatar: me.avatar, dateLabel: formatShareDate(date), score, streak, bestStreak,
  });
  const m = modal(h(`<div class="overlay"><div class="panel"><h2>📤 分享每日挑战</h2>
    <img class="share-img" src="${img}" alt="每日挑战分享卡" />
    <p class="share-copy">${esc(text)}</p>
    <div class="row center"><a class="btn green" href="${img}" download="golf-daily-${date}.png" style="text-decoration:none">下载图片</a>
    <button class="btn" id="cp">复制文字</button>${navigator.share ? '<button class="btn secondary" id="sys">系统分享</button>' : ''}<button class="btn secondary" id="x">关闭</button></div></div></div>`));
  m.querySelector('#cp').onclick = async () => { toast((await copyText(text)) ? '已复制分享文字' : '复制失败', 'info'); };
  m.querySelector('#x').onclick = () => m.remove();
  const sys = m.querySelector('#sys');
  if (sys) sys.onclick = () => navigator.share({ title: '高尔夫纸牌每日挑战', text, url }).catch(() => {});
}

function renderDaily() {
  abortAll();
  demoTable();
  const state = backend.getDailyState();
  const el = show(h(`<div class="overlay"><div class="panel daily-panel">
    <h2>📅 每日挑战</h2>
    <p class="muted" style="text-align:center">${formatLongDate(state.date)} · 按北京时间换日<br/>全世界同一副牌。当天第一次成绩才会计入连续天数。</p>
    <div class="daily-stats">
      <div class="daily-stat"><b>${state.today ? state.today.score : '—'}</b><span>今日得分</span></div>
      <div class="daily-stat"><b>${state.streak.current}</b><span>连续天数</span></div>
      <div class="daily-stat"><b>${state.streak.best}</b><span>最佳连续</span></div>
    </div>
    ${state.bestScore == null ? '' : `<p class="pb-line">历史最佳 ${state.bestScore} 分</p>`}
    ${calendarHtml(state)}
    <div id="daily-board">${dailyBoardHtml(state.date)}</div>
    <div class="col">
      ${state.done
        ? '<button class="btn secondary" id="go">再练一局</button><button class="btn green" id="share">📤 分享今日成绩</button>'
        : '<button class="btn xl" id="go">开始今日挑战</button>'}
      <button class="btn secondary" id="back">返回首页</button>
    </div>
  </div></div>`));
  el.querySelector('#go').onclick = () => { sfx.click(); unlockAudio(); startDaily({ practice: state.done }); };
  el.querySelector('#back').onclick = () => { sfx.click(); renderHome(); };
  const share = el.querySelector('#share');
  if (share) share.onclick = () => {
    sfx.click();
    openDailyShare({
      date: state.date,
      score: state.today.score,
      streak: state.streak.current,
      bestStreak: state.streak.best,
      seed: state.today.seed,
    });
  };
}

// ---------------------------------------------------------------- 好友挑战入口
function challengeIntro(ch) {
  const lv = getLevel(ch.level);
  if (!lv) return false;
  if (lv.daily) return dailyChallengeIntro(ch);
  backend.recordChallenge(ch);
  const el = modal(h(`<div class="overlay"><div class="panel" style="text-align:center">
    <div style="font-size:64px">${esc(ch.avatar)}</div>
    <h2>${esc(ch.name)} 向你发起挑战！</h2>
    <p>${lv.id ? `第 ${lv.id} 关「${esc(lv.name)}」` : esc(lv.name)}<br/>TA 的成绩：<b style="color:#ffd166;font-size:22px">${ch.score}</b> 分 ${'★'.repeat(ch.stars || 0)}</p>
    <p class="muted">你会拿到和 TA 完全相同的发牌，分数更低就赢！</p>
    <div class="row center"><button class="btn secondary" id="later">稍后再说</button><button class="btn" id="go">接受挑战</button></div></div></div>`));
  el.querySelector('#later').onclick = () => { sfx.click(); el.remove(); };
  el.querySelector('#go').onclick = () => { sfx.click(); unlockAudio(); startMatch(lv.id, { seed: ch.seed, challenge: ch }); };
  return true;
}

function dailyChallengeIntro(ch) {
  const today = dailyDateKey();
  const canonical = ch.daily === today && ch.seed === dailySeed(today);
  const state = backend.getDailyState();
  backend.recordChallenge(ch);
  const practice = !canonical || state.done;
  const el = modal(h(`<div class="overlay"><div class="panel" style="text-align:center">
    <div style="font-size:64px">${esc(ch.avatar)}</div>
    <h2>${esc(ch.name)} 的每日挑战</h2>
    <p>${ch.daily ? formatLongDate(ch.daily) : '同一副牌'}<br/>TA 的成绩：<b style="color:#ffd166;font-size:22px">${ch.score}</b> 分${ch.streak ? ` · 连续 ${ch.streak} 天` : ''}</p>
    <p class="muted">${canonical ? (state.done ? '你今天已经记过分了，再打一局只作练习。' : '这就是今天的牌。打完会计入你的每日成绩。') : '这不是今天的正式挑战，这一局只作练习。'}</p>
    <div class="row center"><button class="btn secondary" id="later">稍后再说</button><button class="btn" id="go">${practice ? '练习这一局' : '接受挑战'}</button></div></div></div>`));
  el.querySelector('#later').onclick = () => { sfx.click(); el.remove(); };
  el.querySelector('#go').onclick = () => {
    sfx.click(); unlockAudio();
    startMatch(-1, {
      seed: ch.seed,
      challenge: ch,
      daily: { date: canonical ? today : (ch.daily || today), practice },
    });
  };
  return true;
}

async function demoPairJuice() {
  abortAll();
  const s = R.createHole({ seed: 1, numPlayers: 2, rules: { startFlips: 0 } });
  const paint = (card, rank, suit) => { card.rank = rank; card.suit = suit; };
  paint(s.players[0].grid[0].card, 10, 'H');
  paint(s.players[0].grid[3].card, 4, 'S');
  paint(s.deck[s.deck.length - 1], 10, 'D');
  for (const pl of s.players) for (const g of pl.grid) g.up = true;
  const me = profile() || { name: 'Kenny', avatar: '😎' };
  match = {
    level: getLevel(1), seed: 1, challenge: null, daily: null, hole: 0,
    players: [{ name: me.name, avatar: me.avatar, human: true }, { ...AI_NAMES[0], ai: 'easy' }],
    totals: [0, 0], holeScores: [],
  };
  scene.setupSeats(2);
  renderHud();
  labelState = s;
  scene.setupHole(s);
  await scene.layout(s, { duration: 0.05 });
  updateLabels(s);
  const before = snapGrids(s);
  R.drawFromDeck(s);
  R.swapHeld(s, 3);
  await scene.layout(s, { duration: 0.2 });
  updateLabels(s);
  playPairJuice(s, before);
  setHint('这一列凑成一对', true);
}

function demoResult() {
  abortAll();
  const me = profile() || { name: 'Kenny', avatar: '😎' };
  if (backend.getProgress()[1]?.best == null) backend.saveLevelResult(1, { stars: 1, score: 14 });
  match = {
    level: getLevel(1), seed: 99, challenge: null, daily: null, hole: 0,
    players: [{ name: me.name, avatar: me.avatar, human: true }, { ...AI_NAMES[0], ai: 'easy' }],
    totals: [8, 10], holeScores: [[8, 10]],
  };
  matchResult();
}

// ---------------------------------------------------------------- 启动
(async function boot() {
  const ch = readChallengeFromUrl();
  if (ch) history.replaceState(null, '', location.pathname);
  if (!profile()) { demoTable(); await profileModal(true); }
  renderHome();
  if (ch) challengeIntro(ch);
  window.__golf = {
    backend, scene, R, DAILY_TIMEZONE,
    get match() { return match; },
    renderDaily, startDaily, demoPairJuice, demoResult,
  };
})();
