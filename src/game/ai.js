// AI 对手：基于“期望分”估算的启发式策略
//  easy   —— 简单阈值 + 较大随机噪声，不会算牌
//  normal —— 期望值估算 + 少量噪声
//  hard   —— 期望值估算 + 计算“摸牌”的期望收益 + 收尾时机判断（领先才收尾）
import { COLUMNS, rankValue, buildDeck, faceDownSlots, allUp, scoreGrid } from './rules.js';

const NOISE = { easy: 3.5, normal: 1.2, hard: 0.15 };
export const TUNING = { closePenalty: { normal: 3, hard: 6 }, closeMargin: { normal: 0, hard: 2 }, closeBonus: { normal: 0, hard: 0 }, highKnown: { normal: 0, hard: 0 }, flipInfo: { normal: 0, hard: 0 }, feed: { normal: 0.3, hard: 0.6 } };

// 从玩家 p 的视角，统计还没见过的牌（按点数）
export function unseenDistribution(s, p) {
  const counts = {};
  for (const c of buildDeck(s.rules)) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const see = (c) => { if (c && counts[c.rank] > 0) counts[c.rank]--; };
  for (const pl of s.players) for (const g of pl.grid) if (g.up) see(g.card);
  for (const c of s.discard) see(c);
  if (s.held) see(s.held);
  let total = 0;
  for (const k in counts) total += counts[k];
  const dist = [];
  for (const k in counts) if (counts[k] > 0) dist.push({ rank: +k, p: counts[k] / total, v: rankValue(+k, s.rules) });
  return dist;
}

// 估算一个 6 格手牌的期望得分；known[i] = rank 或 null（未知）
export function estimateGrid(known, dist, rules) {
  const E = dist.reduce((a, d) => a + d.p * d.v, 0);
  const pairE = dist.reduce((a, d) => a + d.p * d.p * d.v, 0);
  let total = 0;
  for (const [a, b] of COLUMNS) {
    const ra = known[a], rb = known[b];
    if (ra !== null && rb !== null) {
      total += ra === rb ? 0 : rankValue(ra, rules) + rankValue(rb, rules);
    } else if (ra !== null || rb !== null) {
      const r = ra !== null ? ra : rb;
      const v = rankValue(r, rules);
      const pr = dist.find((d) => d.rank === r)?.p ?? 0;
      const vr = rankValue(r, rules);
      total += (1 - pr) * v + (E - pr * vr);
    } else {
      total += 2 * E - 2 * pairE;
    }
  }
  return total;
}

function knownOf(grid) { return grid.map((g) => (g.up ? g.card.rank : null)); }

function opponentsBest(s, p, dist) {
  let best = Infinity;
  s.players.forEach((pl, i) => {
    if (i === p) return;
    best = Math.min(best, estimateGrid(knownOf(pl.grid), dist, s.rules));
  });
  return best;
}

// 列出“手里拿着 rank 这张牌”时所有可选动作及估值
function placementOptions(s, p, rank, fromDeck, dist, level) {
  const grid = s.players[p].grid;
  const base = knownOf(grid);
  const opts = [];
  const closes = (k) => k.every((x) => x !== null);
  for (let i = 0; i < 6; i++) {
    const k = base.slice(); k[i] = rank;
    opts.push({ type: 'swap', slot: i, value: estimateGrid(k, dist, s.rules), closes: closes(k) });
  }
  if (fromDeck) {
    const down = faceDownSlots(s.players[p]);
    if (down.length === 0) {
      opts.push({ type: 'discard', slot: null, value: estimateGrid(base, dist, s.rules), closes: true });
    }
    for (const j of down) {
      let ev = 0;
      for (const d of dist) { const k = base.slice(); k[j] = d.rank; ev += d.p * estimateGrid(k, dist, s.rules); }
      const k2 = base.slice(); k2[j] = 0;
      opts.push({ type: 'discard', slot: j, value: ev, closes: closes(k2) });
    }
  }
  // 喂牌惩罚：扔到弃牌堆的牌如果对下家很有用，就扣分
  const feedW = TUNING.feed[level] || 0;
  if (feedW > 0) {
    const nextP = (p + 1) % s.players.length;
    if (nextP !== p && !(s.finisher !== null && nextP === s.finisher)) {
      const ng = knownOf(s.players[nextP].grid);
      const nBase = estimateGrid(ng, dist, s.rules);
      const gain = (r) => {
        let best = 0;
        for (let i = 0; i < 6; i++) { const k = ng.slice(); k[i] = r; best = Math.max(best, nBase - estimateGrid(k, dist, s.rules)); }
        return best;
      };
      const cache = {};
      const g = (r) => (cache[r] ??= gain(r));
      for (const o of opts) {
        if (o.type === 'swap' && !grid[o.slot].up) {
          // 换掉的是暗牌：自己也不知道是什么，按期望计算（不偷看）
          o.value += feedW * dist.reduce((a, d) => a + d.p * g(d.rank), 0);
        } else {
          const r = o.type === 'swap' ? grid[o.slot].card.rank : rank;
          o.value += feedW * g(r);
        }
      }
    }
  }
  // 收尾判断：如果这一步会让自己全部翻开（触发终局），但估计不领先，就加惩罚
  if (level !== 'easy' && s.finisher === null) {
    const opp = opponentsBest(s, p, dist);
    const margin = TUNING.closeMargin[level];
    for (const o of opts) {
      if (!o.closes) continue;
      if (o.value > opp - margin) o.value += TUNING.closePenalty[level];
      else o.value -= TUNING.closeBonus[level];
    }
  }
  return opts;
}

function pickBest(opts, rng, level) {
  const n = NOISE[level] ?? 1;
  let best = null, bv = Infinity;
  for (const o of opts) {
    const v = o.value + (rng() - 0.5) * 2 * n;
    if (v < bv) { bv = v; best = o; }
  }
  return best;
}

export function chooseInitialFlips(s, p, rng) {
  // 尽量翻不同列，方便后面配对
  const cols = [0, 1, 2].sort(() => rng() - 0.5);
  const picks = [];
  for (let i = 0; i < s.players[p].flipsLeft; i++) {
    const c = cols[i % 3];
    const row = rng() < 0.5 ? 0 : 1;
    let slot = COLUMNS[c][row];
    if (picks.includes(slot)) slot = COLUMNS[c][1 - row];
    picks.push(slot);
  }
  return picks;
}

export function chooseDraw(s, p, level, rng) {
  const top = s.discard[s.discard.length - 1];
  if (!top) return 'deck';
  const dist = unseenDistribution(s, p);
  const grid = s.players[p].grid;
  if (level === 'easy') {
    const v = rankValue(top.rank, s.rules);
    const pairs = grid.some((g) => g.up && g.card.rank === top.rank);
    return (v <= 3 || pairs) && rng() < 0.85 ? 'discard' : 'deck';
  }
  const takeOpts = placementOptions(s, p, top.rank, false, dist, level);
  const takeBest = Math.min(...takeOpts.map((o) => o.value));
  // 摸牌的期望：对每种可能摸到的牌，取最优动作
  let drawEV = 0;
  for (const d of dist) {
    const opts = placementOptions(s, p, d.rank, true, dist, level);
    drawEV += d.p * Math.min(...opts.map((o) => o.value));
  }
  const noise = (rng() - 0.5) * 2 * (NOISE[level] ?? 1) * 0.5;
  return takeBest <= drawEV + noise ? 'discard' : 'deck';
}

export function choosePlacement(s, p, level, rng) {
  const dist = unseenDistribution(s, p);
  const opts = placementOptions(s, p, s.held.rank, s.heldFrom === 'deck', dist, level);
  const best = pickBest(opts, rng, level);
  return { type: best.type, slot: best.slot };
}

export { allUp, scoreGrid };
