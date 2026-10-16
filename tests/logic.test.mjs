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
  // 2 配对也是 0
  assert.equal(R.scoreGrid(grid([2, 1, 4, 2, 1, 6])).total, 0 + 0 + 10);
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
