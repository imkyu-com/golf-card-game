import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/game/rules.js';
import * as AI from '../src/game/ai.js';
import { mulberry32, hashSeed } from '../src/game/rng.js';
import { LEVELS, starsFor } from '../src/game/levels.js';
import { encodeChallenge, decodeChallenge, challengeUrl, pageBase } from '../src/social/share.js';

const c = (rank, suit = 'S') => ({ id: Math.random(), rank, suit });
const grid = (ranks) => ranks.map((r) => ({ card: c(r), up: true }));

test('card values', () => {
  assert.equal(R.rankValue(1), 1);
  assert.equal(R.rankValue(2), -2);
  assert.equal(R.rankValue(11), 10);
  assert.equal(R.rankValue(12), 10);
  assert.equal(R.rankValue(13), 0);
  assert.equal(R.rankValue(7), 7);
  assert.equal(R.rankValue(0), -2);
  assert.equal(R.rankValue(13, { kingValue: 12 }), 12);
});

test('column pairs cancel to 0', () => {
  // 列: (0,3) (1,4) (2,5)
  const s = R.scoreGrid(grid([5, 9, 12, 5, 3, 12]));
  assert.equal(s.total, 0 + 12 + 0);
  assert.deepEqual(s.columns.map((x) => x.paired), [true, false, true]);
  assert.equal(s.contributions.reduce((a, b) => a + b, 0) + s.bonus, s.total);
  // 2 配对也是 0
  assert.equal(R.scoreGrid(grid([2, 1, 4, 2, 1, 6])).total, 0 + 0 + 10);
});

test('each column cancels on its own and contributes 0', () => {
  const base = [3, 4, 5, 6, 7, 8]; // 列分 9 + 11 + 13 = 33
  for (let col = 0; col < 3; col++) {
    const ranks = base.slice();
    ranks[col] = 9;
    ranks[col + 3] = 9;
    const removed = R.rankValue(base[col]) + R.rankValue(base[col + 3]);
    const g = grid(ranks);
    const sc = R.scoreGrid(g);
    assert.equal(sc.columns[col].paired, true, `column ${col} paired`);
    assert.equal(sc.columns[col].score, 0, `column ${col} score`);
    assert.equal(sc.contributions[col], 0);
    assert.equal(sc.contributions[col + 3], 0);
    assert.equal(sc.total, 33 - removed);
    for (const slot of [col, col + 3]) assert.equal(R.shownCardPoints(g[slot].card, true), 0);
    assert.notEqual(sc.total, 33 - removed + 18);
  }
});

// 标准规则：点数相同的一列记 0，即使单张是负分或特殊关的高分 K。不是 -4，也不是 +24。
test('negative pairs and special-rule pairs score 0', () => {
  const twos = R.scoreGrid(grid([2, 3, 5, 2, 4, 6]));
  assert.equal(twos.columns[0].paired, true);
  assert.equal(twos.columns[0].score, 0);
  assert.equal(twos.total, 0 + 7 + 11);
  assert.notEqual(twos.total, -4 + 7 + 11);

  const jokers = R.scoreGrid(grid([0, 4, 6, 0, 1, 6]), { ...R.DEFAULT_RULES, jokers: true });
  assert.equal(jokers.columns[0].score, 0);
  assert.equal(jokers.columns[2].score, 0);
  assert.equal(jokers.total, 5);
  assert.equal(R.shownCardPoints({ rank: 0 }, true), 0);
  assert.equal(R.shownCardPoints({ rank: 0 }, false), -2);

  const kings = R.scoreGrid(grid([13, 3, 8, 13, 4, 8]), { ...R.DEFAULT_RULES, kingValue: 12 });
  assert.equal(kings.columns[0].paired, true);
  assert.equal(kings.columns[0].score, 0);
  assert.equal(kings.columns[2].score, 0);
  assert.equal(kings.total, 7);
  assert.equal(R.shownCardPoints({ rank: 13 }, true, { kingValue: 12 }), 0);
  assert.equal(R.shownCardPoints({ rank: 13 }, false, { kingValue: 12 }), 12);
  assert.notEqual(kings.total, 24 + 7 + 16);
});

test('pair hidden until the final reveal is 0, not the face-up card plus the new card', () => {
  const g = grid([8, 3, 1, 8, 4, 2]);
  g[3].up = false;
  g[2].up = false;
  g[5].up = false;
  const vis = R.scoreGrid(g, R.DEFAULT_RULES, true);
  assert.equal(vis.columns[0].paired, false);
  assert.equal(vis.columns[0].score, 8);
  for (const slot of g.keys()) g[slot].up = true;
  const fin = R.scoreGrid(g, R.DEFAULT_RULES, false);
  assert.equal(fin.columns[0].paired, true);
  assert.equal(fin.columns[0].score, 0);
  assert.equal(fin.contributions[0], 0);
  assert.equal(fin.contributions[3], 0);
  assert.equal(fin.total, 0 + 7 + (1 - 2));
  assert.equal(R.scoreGrid(g, R.DEFAULT_RULES, true).total, fin.total);
  assert.ok(fin.columns.every((c) => !c.paired || c.score === 0));
});

test('game end reveals then scores, so a last-flip pair and an auto-revealed pair are both 0', () => {
  const s = R.createHole({ seed: 42, numPlayers: 2, rules: { kingValue: 12 } });
  R.initialFlip(s, 0, 0); R.initialFlip(s, 0, 1);
  R.initialFlip(s, 1, 0); R.initialFlip(s, 1, 1);
  const put = (p, slot, rank, up) => {
    s.players[p].grid[slot].card = { id: 5000 + p * 10 + slot, rank, suit: 'H' };
    s.players[p].grid[slot].up = up;
  };
  // P0：列 0 已经是明牌一对 2；列 2 的 7 要等最后一次翻牌才配对。
  put(0, 0, 2, true); put(0, 1, 9, true); put(0, 2, 7, true);
  put(0, 3, 2, true); put(0, 4, 4, true); put(0, 5, 7, false);
  // P1：列 0 两张 8 都是暗牌，最后一回合不会去翻它们，终局自动亮牌后才成为对子。
  put(1, 0, 8, false); put(1, 1, 6, true); put(1, 2, 13, true);
  put(1, 3, 8, false); put(1, 4, 3, false); put(1, 5, 13, false);

  const before = R.scoreGrid(s.players[0].grid, s.rules, true);
  assert.equal(before.columns[0].score, 0);
  assert.equal(before.columns[2].score, 7);

  R.drawFromDeck(s);
  R.discardHeld(s);
  R.flipAfterDiscard(s, 5);
  assert.equal(s.finisher, 0);
  assert.equal(s.phase, 'draw');
  R.drawFromDeck(s);
  R.swapHeld(s, 1);
  assert.equal(s.phase, 'over');
  assert.ok(s.players.every((p) => p.grid.every((g) => g.up)));

  const p0 = s.scores[0];
  assert.equal(p0.columns[0].score, 0);
  assert.equal(p0.columns[2].paired, true);
  assert.equal(p0.columns[2].score, 0);
  assert.equal(p0.total, 13);
  const raw0 = s.players[0].grid.reduce((a, g) => a + R.cardValue(g.card, s.rules), 0);
  assert.equal(raw0, 23);
  assert.notEqual(p0.total, raw0);

  const p1 = s.scores[1];
  assert.equal(p1.columns[0].paired, true);
  assert.equal(p1.columns[0].score, 0);
  assert.equal(p1.columns[2].paired, true);
  assert.equal(p1.columns[2].score, 0);
  assert.equal(p1.contributions[0] + p1.contributions[3] + p1.contributions[2] + p1.contributions[5], 0);
});

test('multi-round totals add cancelled hole scores, not raw card values', () => {
  const holes = [
    { ranks: [10, 1, 3, 10, 2, 4], rules: {}, expect: 6 },
    { ranks: [2, 11, 13, 2, 5, 13], rules: { kingValue: 12 }, expect: 15 },
    { ranks: [0, 4, 6, 0, 1, 6], rules: { jokers: true }, expect: 5 },
    { ranks: [7, 7, 3, 7, 7, 4], rules: { quadBonus: -10 }, expect: -3 },
  ];
  let total = 0;
  let raw = 0;
  for (const hole of holes) {
    const rules = { ...R.DEFAULT_RULES, ...hole.rules };
    const sc = R.scoreGrid(grid(hole.ranks), rules);
    assert.equal(sc.total, hole.expect);
    assert.equal(sc.contributions.reduce((a, b) => a + b, 0) + sc.bonus, sc.total);
    assert.ok(sc.columns.every((c) => !c.paired || c.score === 0));
    total += sc.total;
    raw += hole.ranks.reduce((a, r) => a + R.rankValue(r, rules), 0);
  }
  assert.equal(total, 6 + 15 + 5 + -3);
  assert.ok(total < raw);
  const again = holes.reduce((sum, hole) => sum + R.scoreGrid(grid(hole.ranks), { ...R.DEFAULT_RULES, ...hole.rules }).total, 0);
  assert.equal(again, total);
});

test('quad bonus', () => {
  const g = grid([7, 7, 3, 7, 7, 4]);
  assert.equal(R.scoreGrid(g).total, 7);
  assert.equal(R.scoreGrid(g, { ...R.DEFAULT_RULES, quadBonus: -10 }).total, -3);
});

test('same seed → same deal', () => {
  const a = R.createHole({ seed: 1234, numPlayers: 3 });
  const b = R.createHole({ seed: 1234, numPlayers: 3 });
  assert.deepEqual(a.players.map((p) => p.grid.map((g) => g.card.id)), b.players.map((p) => p.grid.map((g) => g.card.id)));
  assert.deepEqual(a.deck.map((x) => x.id), b.deck.map((x) => x.id));
  const d = R.createHole({ seed: 99, numPlayers: 3 });
  assert.notDeepEqual(a.deck.map((x) => x.id), d.deck.map((x) => x.id));
});

test('turn flow + last turn rule', () => {
  const s = R.createHole({ seed: 5, numPlayers: 2 });
  assert.equal(s.phase, 'initial');
  R.initialFlip(s, 0, 0); R.initialFlip(s, 0, 1); R.initialFlip(s, 1, 0); R.initialFlip(s, 1, 1);
  assert.equal(s.phase, 'draw');
  assert.throws(() => R.initialFlip(s, 0, 2));
  // P0 翻完全部
  for (const slot of [2, 3, 4, 5]) {
    assert.equal(s.current, 0);
    R.drawFromDeck(s); R.swapHeld(s, slot);
    if (slot !== 5) { assert.equal(s.current, 1); R.drawFromDeck(s); R.swapHeld(s, 0); }
  }
  assert.equal(s.finisher, 0);
  assert.equal(s.current, 1); // 对手还有最后一回合
  assert.equal(s.phase, 'draw');
  R.takeDiscard(s);
  assert.throws(() => R.discardHeld(s)); // 从弃牌堆拿的牌必须交换
  R.swapHeld(s, 5);
  assert.equal(s.phase, 'over');
  assert.equal(s.scores.length, 2);
  assert.ok(s.players.every((p) => p.grid.every((g) => g.up)));
});

test('card conservation', () => {
  const s = R.createHole({ seed: 77, numPlayers: 4, rules: { jokers: true } });
  const count = () => s.deck.length + s.discard.length + (s.held ? 1 : 0) + s.players.reduce((a, p) => a + p.grid.length, 0);
  assert.equal(count(), 54);
});

function simulate(levels, seed, rules = {}) {
  const s = R.createHole({ seed, numPlayers: levels.length, rules });
  const rngs = levels.map((_, i) => mulberry32(hashSeed(seed, 'ai', i)));
  levels.forEach((lv, p) => { for (const slot of AI.chooseInitialFlips(s, p, rngs[p])) R.initialFlip(s, p, slot); });
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 2000) {
    const p = s.current, lv = levels[p], rng = rngs[p];
    if (AI.chooseDraw(s, p, lv, rng) === 'discard') R.takeDiscard(s); else R.drawFromDeck(s);
    const d = AI.choosePlacement(s, p, lv, rng);
    if (d.type === 'swap') R.swapHeld(s, d.slot);
    else { R.discardHeld(s); if (s.phase === 'flip') R.flipAfterDiscard(s, d.slot ?? R.faceDownSlots(s.players[p])[0]); }
  }
  assert.equal(s.phase, 'over', 'game must terminate');
  return { scores: s.scores.map((x) => x.total), turns: s.turn };
}

test('AI games terminate and hard beats easy', () => {
  const N = 600;
  let hardWins = 0, sum = { easy: 0, normal: 0, hard: 0 }, turns = 0;
  for (let i = 0; i < N; i++) {
    const r = simulate(['hard', 'easy'], 1000 + i);
    if (r.scores[0] < r.scores[1]) hardWins++;
    sum.hard += r.scores[0]; sum.easy += r.scores[1]; turns += r.turns;
    const r2 = simulate(['normal', 'normal', 'normal'], 5000 + i, { jokers: true, quadBonus: -10 });
    sum.normal += r2.scores[0];
  }
  console.log(`hard vs easy: hard wins ${hardWins}/${N}; avg hard=${(sum.hard / N).toFixed(1)} easy=${(sum.easy / N).toFixed(1)} normal(3p)=${(sum.normal / N).toFixed(1)} avgTurns=${(turns / N).toFixed(1)}`);
  assert.ok(hardWins > N * 0.55);
});

test('levels + stars', () => {
  assert.equal(LEVELS.length, 10);
  assert.equal(starsFor(LEVELS[0], 3, true), 3);
  assert.equal(starsFor(LEVELS[0], 10, true), 2);
  assert.equal(starsFor(LEVELS[0], 30, true), 1);
  assert.equal(starsFor(LEVELS[0], 0, false), 0);
});

test('challenge link roundtrip (unicode)', () => {
  const ch = { v: 1, seed: 4294967295, level: 7, score: -3, name: '肯尼 Kenny', avatar: '🦄', stars: 2 };
  assert.deepEqual(decodeChallenge(encodeChallenge(ch)), ch);
  assert.equal(decodeChallenge('garbage!!'), null);
});

test('challenge url uses the page origin and path', () => {
  const ch = { v: 1, seed: 42, level: 3, score: 11, name: '肯尼', avatar: '⛳', stars: 2 };
  const custom = { origin: 'https://golf-card-game.app.imkyu.com', pathname: '/' };
  assert.equal(pageBase(custom), 'https://golf-card-game.app.imkyu.com/');
  assert.equal(
    pageBase({ origin: 'https://golf-card-game.app.imkyu.com', pathname: '/index.html' }),
    'https://golf-card-game.app.imkyu.com/',
  );
  const rootUrl = challengeUrl(ch, pageBase(custom));
  assert.equal(rootUrl.startsWith('https://golf-card-game.app.imkyu.com/#c='), true);
  assert.deepEqual(decodeChallenge(rootUrl.slice(rootUrl.indexOf('#c=') + 3)), ch);

  const pages = { origin: 'https://kenysai.github.io', pathname: '/golf-card-game/' };
  assert.equal(pageBase(pages), 'https://kenysai.github.io/golf-card-game/');
  assert.equal(
    pageBase({ origin: 'https://kenysai.github.io', pathname: '/golf-card-game/index.html' }),
    'https://kenysai.github.io/golf-card-game/',
  );
  assert.equal(
    pageBase({ origin: 'https://example.com', pathname: '/golf-card-game' }),
    'https://example.com/golf-card-game/',
  );
  const url = challengeUrl(ch, pageBase(pages));
  assert.equal(url.startsWith('https://kenysai.github.io/golf-card-game/#c='), true);
  assert.deepEqual(decodeChallenge(url.slice(url.indexOf('#c=') + 3)), ch);
});
