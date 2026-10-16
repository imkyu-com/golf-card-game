import './style.css';
import { TableScene } from './scene/scene3d.js';
import * as R from './game/rules.js';
import * as AI from './game/ai.js';
import { mulberry32, hashSeed, randomSeed } from './game/rng.js';
import { LEVELS, AI_NAMES, getLevel, starsFor } from './game/levels.js';
import { LocalBackend } from './social/backend.js';
import { challengeUrl, readChallengeFromUrl, resultText, resultCardImage } from './social/share.js';
import { sfx, setSoundEnabled, unlockAudio } from './audio.js';

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
      <button class="btn" id="play">🏌️ 闯关模式</button>
      <button class="btn green" id="quick">🎲 自由对局</button>
      <button class="btn secondary" id="lb">🏆 排行榜</button>
      <button class="btn secondary" id="rules">📖 玩法教程</button>
    </div>
    <div class="row center"><button class="icon-btn" id="snd">${backend.getSettings().sound !== false ? '🔊' : '🔇'}</button></div>
  </div>`));
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
      <li><b>或者弃掉：</b>如果是从牌堆摸的牌，也可以直接弃掉，然后<b>翻开自己一张暗牌</b>。从弃牌堆拿的牌必须换入。</li></ol>
    <h3>✅ 配对抵消</h3><p>同一<b>列</b>上下两张点数相同 → 这一列直接记 <b>0 分</b>，牌上也会改成 0。一对 2 或一对王牌是 0，不是 -4；特殊关里 K 即使是 +12，一对 K 仍是 0。横排或斜角不算对子。</p>
    <h3>🏁 结束</h3><p>有人 6 张全部翻开后，其他人<b>各再走最后一回合</b>，然后全部亮牌计分。</p>
    <h3>🔢 分值</h3><div class="cards-demo">
      <div>A<small>1 分</small></div><div>2<small>-2 分</small></div><div>3~10<small>牌面分</small></div><div>J / Q<small>10 分</small></div><div>K<small>0 分</small></div><div>★王<small>-2 分</small></div></div>
    <h3>⭐ 闯关</h3><p>每关打若干局，累计总分最低即获胜。赢下得 1 星，总分低于目标再拿 2、3 星。通关解锁下一关，后面会有更多对手和特殊规则（王牌、只翻 1 张、K 变 12 分、四条奖励…）。</p>
    <h3>🤝 挑战好友</h3><p>结算时点「挑战好友」会生成一个链接，里面包含这一关的<b>同一副牌</b>和你的分数。好友打开后用同样的发牌比拼分数，对方成绩也会进入你本机的排行榜。</p>
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
      <div class="muted">${s.levelId ? `第 ${s.levelId} 关` : '自由对局'} · ${new Date(s.date).toLocaleDateString('zh-CN')} · <span style="color:#ffd166">${'★'.repeat(s.stars || 0)}</span></div></div>
      <div class="sc">${s.score}</div></div>`).join('') : '<p class="muted" style="text-align:center">还没有成绩，快去打一局吧！</p>';
  };
  el.querySelector('#lv').onchange = (e) => { sel = e.target.value; draw(); };
  el.querySelector('#back').onclick = () => { sfx.click(); renderHome(); };
  draw();
}

// ---------------------------------------------------------------- 对局
let match = null;

async function startMatch(levelId, { seed, challenge } = {}) {
  abortAll();
  const tk = token;
  const level = getLevel(levelId);
  const me = profile();
  match = {
    level, seed: seed ?? randomSeed(), challenge, hole: 0, tk,
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

function renderHud() {
  const { level, hole } = match;
  const el = show(h(`<div>
    <div class="hud-top">
      <button class="icon-btn" id="menu">☰</button>
      <div class="hud-title"><b>${level.id ? `第 ${level.id} 关 · ` : ''}${esc(level.name)}</b><small>第 ${hole + 1} / ${level.holes} 局${match.challenge ? ` · 挑战 ${esc(match.challenge.name)}（${match.challenge.score} 分）` : ''}</small></div>
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
      <button class="btn secondary" id="m">返回${match.level.id ? '地图' : '首页'}</button></div></div></div>`));
    m.querySelector('#c').onclick = () => m.remove();
    m.querySelector('#r').onclick = () => startMatch(match.level.id, { seed: match.challenge ? match.seed : undefined, challenge: match.challenge });
    m.querySelector('#m').onclick = () => (match.level.id ? renderMap() : renderHome());
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
  const chips = match.players.map((pl, i) => {
    const visScore = R.scoreGrid(s.players[i].grid, s.rules, true);
    const bonus = visScore.bonus ? ` · 四条${visScore.bonus}` : '';
    const cls = `pchip ${s.phase !== 'over' && s.current === i && s.phase !== 'initial' ? 'turn' : ''} ${s.finisher === i ? 'finisher' : ''}`;
    return `<div class="${cls}"><span class="av">${pl.avatar}</span><span class="meta"><b>${esc(pl.name)}</b><br/><span>明牌 ${visScore.total}${bonus} · 总分 ${match.totals[i]}</span></span></div>`;
  });
  const me = document.getElementById('mechip');
  if (me) me.innerHTML = chips[0];
  let html = '';
  for (let i = 1; i < chips.length; i++) {
    const p = scene.seatScreenPos(i);
    if (!p) continue;
    const x = Math.min(window.innerWidth - 80, Math.max(80, p.x)), y = Math.min(window.innerHeight - 90, Math.max(110, p.y));
    html += `<div class="label-abs" style="left:${x}px;top:${y}px">${chips[i]}</div>`;
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
  for (let p = 1; p < n; p++) {
    for (const slot of AI.chooseInitialFlips(s, p, aiRng[p])) R.initialFlip(s, p, slot);
  }
  sfx.flip();
  await scene.layout(s);
  // 玩家开局翻牌
  while (s.players[0].flipsLeft > 0) {
    setHint(`点击你面前的牌，翻开 ${s.players[0].flipsLeft} 张`, true);
    const hit = await waitPick({ slots: R.faceDownSlots(s.players[0]) }, tk);
    R.initialFlip(s, 0, hit.slot);
    sfx.flip();
    await scene.layout(s);
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
  if (finalScores.some((sc) => sc.columns.some((c) => c.paired))) sfx.pair();
  updateLabels(s);
  await sleep(1600, tk);
  return finalScores.map((x) => x.total);
}

function columnPairedAfter(s, p, slot) {
  const sc = R.scoreGrid(s.players[p].grid, s.rules, true);
  return sc.columns.some((c) => c.paired && c.slots.includes(slot));
}

function formatCols(sc) {
  if (!sc) return '';
  const body = sc.columns.map((c) => (c.paired ? '0' : String(c.score))).join('·');
  return sc.bonus ? `${body}·四条${sc.bonus}` : body;
}

async function humanTurn(s, tk) {
  const top = s.discard[s.discard.length - 1];
  setHint(`你的回合：点左边牌堆摸牌，或点右边弃牌堆拿 ${top ? R.rankLabel(top.rank) : ''}`, true);
  const hit = await waitPick({ deck: true, discard: !!top, slots: [] }, tk);
  if (hit.kind === 'deck') R.drawFromDeck(s); else R.takeDiscard(s);
  sfx.draw();
  await scene.layout(s);
  const held = s.held;
  const v = R.cardValue(held, s.rules);
  const all = [0, 1, 2, 3, 4, 5];
  let choice;
  if (s.heldFrom === 'deck') {
    setHint(`摸到 ${R.rankLabel(held.rank)}（${v} 分）：点你的一张牌交换，或弃掉它`, true, [{ label: '🗑️ 弃掉这张', cls: 'secondary', onClick: () => pending && pending.resolve({ kind: 'discard' }) }]);
    choice = await waitPick({ slots: all, discard: true }, tk);
  } else {
    setHint(`拿了 ${R.rankLabel(held.rank)}（${v} 分）：点你的一张牌进行交换`, true);
    choice = await waitPick({ slots: all }, tk);
  }
  pending = null; scene.setHighlight(); setHint('…');
  if (choice.kind === 'slot') {
    R.swapHeld(s, choice.slot);
    sfx.place();
    await scene.layout(s);
    if (columnPairedAfter(s, 0, choice.slot)) { sfx.pair(); toast('配对成功！这一列 0 分', 'info'); }
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
      if (columnPairedAfter(s, 0, f.slot)) { sfx.pair(); toast('配对成功！这一列 0 分', 'info'); }
    }
  }
}

async function aiTurn(s, p, rng, tk) {
  const pl = match.players[p];
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
    if (columnPairedAfter(s, p, d.slot)) sfx.pair();
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
  const { level, totals, players, seed, challenge } = match;
  labelState = null; labels.innerHTML = '';
  const my = totals[0];
  const won = totals.every((t, i) => i === 0 || my <= t);
  const stars = starsFor(level, my, won);
  const me = profile();
  let prevStars = 0;
  if (level.id) { prevStars = backend.getProgress()[level.id]?.stars || 0; backend.saveLevelResult(level.id, { stars, score: my }); }
  backend.submitScore({ name: me.name, avatar: me.avatar, levelId: level.id, score: my, stars, seed, source: 'self' });
  won ? sfx.win() : sfx.lose();
  const ch = { v: 1, seed, level: level.id, score: my, name: me.name, avatar: me.avatar, stars };
  const url = challengeUrl(ch);
  const order = players.map((p, i) => ({ ...p, total: totals[i], i })).sort((a, b) => a.total - b.total);
  const nextLv = LEVELS.find((l) => l.id === level.id + 1);
  let vs = '';
  if (challenge) {
    const res = my < challenge.score ? '🎉 你赢了好友！' : my === challenge.score ? '🤝 打平了！' : '😅 好友更胜一筹';
    vs = `<div class="vs">同一副牌对决：你 <b>${my}</b> 分 vs ${challenge.avatar} ${esc(challenge.name)} <b>${challenge.score}</b> 分<br/><b>${res}</b></div>`;
  }
  const el = show(h(`<div class="overlay"><div class="panel">
    <p class="result-title" style="color:${won ? '#7ee787' : '#ff9b9b'}">${won ? '🏆 胜利！' : '惜败…'}</p>
    <div class="bigstars">${[0, 1, 2].map((i) => `<span style="animation-delay:${0.2 + i * 0.25}s" class="${i < stars ? '' : 'star-off'}">★</span>`).join('')}</div>
    ${level.id && stars > prevStars && prevStars > 0 ? '<p style="text-align:center;color:#ffd166">新纪录！</p>' : ''}
    ${vs}
    <table class="score"><tr><th>名次</th><th>玩家</th><th>总分</th></tr>${order.map((p, r) => `<tr class="${r === 0 ? 'best' : ''} ${p.i === 0 ? 'me' : ''}"><td>${r + 1}</td><td><span class="who">${p.avatar} ${esc(p.name)}</span></td><td>${p.total}</td></tr>`).join('')}</table>
    ${level.id ? `<p class="muted" style="text-align:center">★★ 需 ≤ ${level.t2} 分 · ★★★ 需 ≤ ${level.t3} 分</p>` : ''}
    <div class="col">
      <div class="row center"><button class="btn green" id="chal">🤝 挑战好友</button><button class="btn green" id="share">📸 分享战绩</button></div>
      <div class="row center">
        <button class="btn secondary" id="again">🔄 再来一次</button>
        ${level.id && nextLv && backend.isUnlocked(nextLv.id) ? '<button class="btn" id="next">下一关 →</button>' : ''}
      </div>
      <div class="row center"><button class="btn secondary small" id="map">${level.id ? '返回地图' : '返回首页'}</button><button class="btn secondary small" id="lb">排行榜</button></div>
    </div></div></div>`));
  stars && [0, 1, 2].slice(0, stars).forEach((i) => setTimeout(() => sfx.star(i), 300 + i * 250));
  el.querySelector('#chal').onclick = async () => {
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
  el.querySelector('#share').onclick = () => {
    sfx.click();
    const img = resultCardImage({ name: me.name, avatar: me.avatar, levelName: level.name, levelId: level.id, score: my, stars, won, players: order });
    const text = resultText({ name: me.name, levelName: level.name, levelId: level.id, score: my, stars, won, url });
    const m = modal(h(`<div class="overlay"><div class="panel"><h2>📸 战绩卡</h2>
      <img class="share-img" src="${img}" alt="战绩卡" />
      <div class="row center"><a class="btn green" id="dl" href="${img}" download="golf-card-${level.id}-${my}.png" style="text-decoration:none">下载图片</a>
      <button class="btn secondary" id="cp">复制文字</button><button class="btn secondary" id="x">关闭</button></div></div></div>`));
    m.querySelector('#cp').onclick = async () => { toast((await copyText(text)) ? '已复制战绩文字' : '复制失败', 'info'); };
    m.querySelector('#x').onclick = () => m.remove();
  };
  el.querySelector('#again').onclick = () => { sfx.click(); startMatch(level.id, {}); };
  const nx = el.querySelector('#next');
  if (nx) nx.onclick = () => { sfx.click(); levelInfo(nextLv); };
  el.querySelector('#map').onclick = () => { sfx.click(); level.id ? renderMap() : renderHome(); };
  el.querySelector('#lb').onclick = () => { sfx.click(); renderLeaderboard(); };
}

// ---------------------------------------------------------------- 好友挑战入口
function challengeIntro(ch) {
  const lv = getLevel(ch.level);
  if (!lv) return false;
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

// ---------------------------------------------------------------- 启动
(async function boot() {
  const ch = readChallengeFromUrl();
  if (ch) history.replaceState(null, '', location.pathname);
  if (!profile()) { demoTable(); await profileModal(true); }
  renderHome();
  if (ch) challengeIntro(ch);
  window.__golf = { backend, scene, R, get match() { return match; } }; // 调试/测试用
})();
