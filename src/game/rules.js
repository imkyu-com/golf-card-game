// 6 张牌 Golf 纸牌规则（纯逻辑，无 DOM / Three.js 依赖，可在 Node 中测试，也可以直接搬到服务端做联机裁判）
import { mulberry32, shuffle } from './rng.js';

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣', J: '★' };
export const RANK_LABEL = { 0: '王', 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
// 布局：slot 0,1,2 为上排（远离自己），3,4,5 为下排；列 = (0,3) (1,4) (2,5)
export const COLUMNS = [[0, 3], [1, 4], [2, 5]];

export const DEFAULT_RULES = {
  startFlips: 2,      // 开局翻开几张
  jokers: false,      // 是否加入两张大小王（-2 分）
  kingValue: 0,       // K 的分值
  quadBonus: 0,       // 两列成对且点数相同（四条）额外奖励，如 -10
};

export function rankLabel(rank) {
  return RANK_LABEL[rank] ?? String(rank);
}

export function rankValue(rank, rules = DEFAULT_RULES) {
  if (rank === 0) return -2; // 王
  if (rank === 1) return 1;
  if (rank === 2) return -2;
  if (rank === 11 || rank === 12) return 10;
  if (rank === 13) return rules.kingValue ?? 0;
  return rank;
}

export function cardValue(card, rules) {
  return rankValue(card.rank, rules);
}

export function buildDeck(rules = DEFAULT_RULES) {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) deck.push({ id: id++, rank, suit });
  if (rules.jokers) { deck.push({ id: id++, rank: 0, suit: 'J' }); deck.push({ id: id++, rank: 0, suit: 'J' }); }
  return deck;
}

export function createHole({ rules: r = {}, seed, numPlayers, startPlayer = 0 }) {
  const rules = { ...DEFAULT_RULES, ...r };
  const rng = mulberry32(seed);
  const deck = shuffle(buildDeck(rules), rng);
  const players = [];
  for (let p = 0; p < numPlayers; p++) players.push({ grid: [], flipsLeft: rules.startFlips });
  for (let i = 0; i < 6; i++) for (const pl of players) pl.grid.push({ card: deck.pop(), up: false });
  const discard = [deck.pop()];
  return {
    rules, rng, deck, discard, players,
    current: startPlayer, startPlayer,
    phase: rules.startFlips > 0 ? 'initial' : 'draw',
    held: null, heldFrom: null,
    finisher: null, turn: 0, scores: null,
  };
}

function assert(cond, msg) { if (!cond) throw new Error('非法操作: ' + msg); }

export function allUp(player) { return player.grid.every((g) => g.up); }
export function faceDownSlots(player) { return player.grid.map((g, i) => (g.up ? -1 : i)).filter((i) => i >= 0); }

export function initialFlip(s, p, slot) {
  assert(s.phase === 'initial', 'phase');
  const pl = s.players[p];
  assert(pl.flipsLeft > 0, 'no flips left');
  assert(!pl.grid[slot].up, 'already up');
  pl.grid[slot].up = true;
  pl.flipsLeft--;
  if (s.players.every((x) => x.flipsLeft === 0)) s.phase = 'draw';
}

function refillDeck(s) {
  // 牌堆摸完：把弃牌堆（除最上面一张）洗回去
  const top = s.discard.pop();
  s.deck = shuffle(s.discard, s.rng);
  s.discard = [top];
}

export function drawFromDeck(s) {
  assert(s.phase === 'draw', 'phase');
  if (s.deck.length === 0) refillDeck(s);
  assert(s.deck.length > 0, 'deck empty');
  s.held = s.deck.pop();
  s.heldFrom = 'deck';
  s.phase = 'hold';
  return s.held;
}

export function takeDiscard(s) {
  assert(s.phase === 'draw', 'phase');
  assert(s.discard.length > 0, 'discard empty');
  s.held = s.discard.pop();
  s.heldFrom = 'discard';
  s.phase = 'hold';
  return s.held;
}

export function swapHeld(s, slot) {
  assert(s.phase === 'hold', 'phase');
  const g = s.players[s.current].grid;
  const old = g[slot].card;
  g[slot] = { card: s.held, up: true };
  s.discard.push(old);
  s.held = null; s.heldFrom = null;
  endTurn(s);
  return old;
}

export function discardHeld(s) {
  assert(s.phase === 'hold' && s.heldFrom === 'deck', 'can only discard a card drawn from deck');
  s.discard.push(s.held);
  s.held = null; s.heldFrom = null;
  if (faceDownSlots(s.players[s.current]).length > 0) s.phase = 'flip';
  else endTurn(s);
}

export function flipAfterDiscard(s, slot) {
  assert(s.phase === 'flip', 'phase');
  const g = s.players[s.current].grid[slot];
  assert(!g.up, 'already up');
  g.up = true;
  endTurn(s);
}

function endTurn(s) {
  const p = s.current;
  s.turn++;
  if (s.finisher === null && allUp(s.players[p])) s.finisher = p;
  const next = (p + 1) % s.players.length;
  if (s.finisher !== null && next === s.finisher) return finish(s);
  s.current = next;
  s.phase = 'draw';
}

function finish(s) {
  for (const pl of s.players) for (const g of pl.grid) g.up = true;
  s.scores = s.players.map((pl) => scoreGrid(pl.grid, s.rules));
  s.phase = 'over';
}

// 计分：同列两张同点数 → 该列 0 分
export function scoreGrid(grid, rules = DEFAULT_RULES, onlyVisible = false) {
  let total = 0;
  const columns = [];
  const pairedRanks = {};
  for (const [a, b] of COLUMNS) {
    const ga = grid[a], gb = grid[b];
    const va = !onlyVisible || ga.up, vb = !onlyVisible || gb.up;
    let score = 0, paired = false;
    if (va && vb && ga.card.rank === gb.card.rank) {
      paired = true;
      pairedRanks[ga.card.rank] = (pairedRanks[ga.card.rank] || 0) + 1;
    } else {
      if (va) score += cardValue(ga.card, rules);
      if (vb) score += cardValue(gb.card, rules);
    }
    total += score;
    columns.push({ slots: [a, b], paired, score });
  }
  let bonus = 0;
  if (rules.quadBonus) for (const n of Object.values(pairedRanks)) if (n >= 2) bonus += rules.quadBonus;
  total += bonus;
  return { total, columns, bonus };
}
