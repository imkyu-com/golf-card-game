import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/game/rules.js';
import * as AI from '../src/game/ai.js';
import { mulberry32, hashSeed } from '../src/game/rng.js';
import { LEVELS, starsFor } from '../src/game/levels.js';
import { encodeChallenge, decodeChallenge, challengeUrl, pageBase } from '../src/social/share.js';
import {
  addDays, applyDailyResult, computeStreak, dailyDateKey, dailyHoleSeed, dailySeed, dailyShareText,
} from '../src/game/daily.js';
import { newColumnPairs, pairFloaterLabel, resultFeedback } from '../src/game/feedback.js';

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

function snapshot(s) {
  return {
    phase: s.phase,
    current: s.current,
    turn: s.turn,
    finisher: s.finisher,
    held: s.held,
    heldFrom: s.heldFrom,
    deck: s.deck.map((c) => c.id),
    discard: s.discard.map((c) => c.id),
    grids: s.players.map((p) => p.grid.map((g) => ({ id: g.card.id, up: g.up, rank: g.card.rank }))),
    scores: s.players.map((p) => R.scoreGrid(p.grid, s.rules, true).total),
  };
}

test('discard pick can be returned and is not a taken card', () => {
  for (const numPlayers of [2, 3, 4]) {
    const s = R.createHole({ seed: 80 + numPlayers, numPlayers, startPlayer: numPlayers - 1 });
    for (let p = 0; p < numPlayers; p++) {
      R.initialFlip(s, p, 0);
      R.initialFlip(s, p, 1);
    }
    assert.equal(s.phase, 'draw');
    const before = snapshot(s);
    const top = s.discard[s.discard.length - 1];
    const only = s.discard.length === 1 ? top : null;

    R.takeDiscard(s);
    assert.equal(s.phase, 'hold');
    assert.equal(s.heldFrom, 'discard');
    assert.equal(s.held, top);
    assert.equal(s.turn, before.turn);
    assert.equal(s.current, before.current);
    assert.throws(() => R.discardHeld(s));

    R.returnDiscard(s);
    assert.deepEqual(snapshot(s), before);
    assert.equal(s.discard[s.discard.length - 1], top);
    if (only) assert.equal(s.discard.length, 1);

    // 放回后再拿、再放，仍然和拿之前一样，随机数也不前进。
    const twin = R.createHole({ seed: 80 + numPlayers, numPlayers, startPlayer: numPlayers - 1 });
    for (let p = 0; p < numPlayers; p++) {
      R.initialFlip(twin, p, 0);
      R.initialFlip(twin, p, 1);
    }
    R.takeDiscard(s);
    R.returnDiscard(s);
    R.takeDiscard(s);
    R.returnDiscard(s);
    assert.deepEqual(snapshot(s), before);
    assert.equal(s.rng(), twin.rng());

    // 放回之后可以改从牌堆摸。牌堆摸到的牌不能放回，弃牌选项仍在。
    const deckTop = s.deck[s.deck.length - 1];
    R.drawFromDeck(s);
    assert.equal(s.held, deckTop);
    assert.equal(s.heldFrom, 'deck');
    assert.equal(s.phase, 'hold');
    const heldId = s.held.id;
    const deckLen = s.deck.length;
    assert.throws(() => R.returnDiscard(s));
    assert.equal(s.held.id, heldId);
    assert.equal(s.heldFrom, 'deck');
    assert.equal(s.phase, 'hold');
    assert.equal(s.deck.length, deckLen);
    assert.equal(s.turn, before.turn);
  }
});

test('returned discard pick does not change the rest of the hole or the score', () => {
  function play(seed, numPlayers, fidget) {
    const s = R.createHole({ seed, numPlayers, rules: { startFlips: 0, quadBonus: -10 } });
    if (fidget) {
      R.takeDiscard(s);
      R.returnDiscard(s);
      R.takeDiscard(s);
      R.returnDiscard(s);
    }
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 500) {
      R.drawFromDeck(s);
      const down = s.players[s.current].grid.findIndex((g) => !g.up);
      R.swapHeld(s, down >= 0 ? down : 0);
    }
    assert.equal(s.phase, 'over');
    return { scores: s.scores.map((x) => x.total), turns: s.turn, deck: s.deck.map((c) => c.id), discard: s.discard.map((c) => c.id) };
  }
  for (const numPlayers of [2, 3, 4]) {
    for (const seed of [11, 99, 1234]) {
      assert.deepEqual(play(seed, numPlayers, true), play(seed, numPlayers, false));
    }
  }
});

test('AI never puts a discard pick back', () => {
  for (let i = 0; i < 24; i++) {
    const s = R.createHole({ seed: 3000 + i, numPlayers: 3, rules: { jokers: i % 2 === 0 } });
    for (let p = 0; p < 3; p++) {
      for (const slot of AI.chooseInitialFlips(s, p, mulberry32(i + p))) R.initialFlip(s, p, slot);
    }
    assert.equal(s.phase, 'draw');
    R.takeDiscard(s);
    for (const level of ['easy', 'normal', 'hard']) {
      const d = AI.choosePlacement(s, s.current, level, mulberry32(9000 + i));
      assert.equal(d.type, 'swap');
      assert.equal(typeof d.slot, 'number');
    }
    assert.equal(s.phase, 'hold');
    assert.equal(s.heldFrom, 'discard');
  }
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

test('daily seed is the Asia/Shanghai date, and the deal does not change', () => {
  // 北京时间 = UTC+8，没有夏令时。15:59:59Z 仍是当天，16:00:00Z 已经是下一天。
  assert.equal(dailyDateKey(new Date('2026-10-22T15:59:59.000Z')), '2026-10-22');
  assert.equal(dailyDateKey(new Date('2026-10-22T16:00:00.000Z')), '2026-10-23');
  assert.equal(dailyDateKey(new Date('2025-12-31T15:59:59.000Z')), '2025-12-31');
  assert.equal(dailyDateKey(new Date('2025-12-31T16:00:00.000Z')), '2026-01-01');
  assert.equal(dailyDateKey(new Date('2026-10-23T00:30:00+08:00')), '2026-10-23');

  const seed = dailySeed('2026-10-23');
  assert.equal(dailySeed('2026-10-23'), seed);
  assert.equal(dailySeed(dailyDateKey(new Date('2026-10-22T16:00:00.000Z'))), seed);
  assert.notEqual(dailySeed('2026-10-22'), seed);
  assert.notEqual(dailySeed('2026-10-24'), seed);
  assert.equal(dailyHoleSeed('2026-10-23', 0), hashSeed(seed, 'hole', 0) || 1);

  const deal = (key) => {
    const hole = R.createHole({ seed: dailyHoleSeed(key, 0), numPlayers: 2 });
    return {
      grids: hole.players.map((p) => p.grid.map((g) => g.card.id)),
      deck: hole.deck.map((c) => c.id),
      discard: hole.discard.map((c) => c.id),
    };
  };
  assert.deepEqual(deal('2026-10-23'), deal('2026-10-23'));
  assert.notDeepEqual(deal('2026-10-23'), deal('2026-10-24'));

  const seen = new Set();
  let day = '2026-01-01';
  for (let i = 0; i < 400; i++) {
    seen.add(dailySeed(day));
    day = addDays(day, 1);
  }
  assert.equal(seen.size, 400);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('daily streak: missed day resets, same-day replay does not double count', () => {
  let history = {};
  let r = applyDailyResult(history, '2026-10-20', { score: 10, seed: 1 });
  history = r.history;
  assert.equal(r.recorded, true);
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.best, 1);
  assert.equal(r.streak.playedToday, true);

  r = applyDailyResult(history, '2026-10-21', { score: 8, seed: 2 });
  history = r.history;
  assert.equal(r.streak.current, 2);
  assert.equal(r.streak.best, 2);

  r = applyDailyResult(history, '2026-10-21', { score: 1, seed: 2 });
  assert.equal(r.recorded, false);
  assert.equal(r.history['2026-10-21'].score, 8);
  assert.equal(r.streak.current, 2);
  assert.equal(r.streak.best, 2);
  r = applyDailyResult(history, '2026-10-21', { score: 1, seed: 2 }, { practice: true });
  assert.equal(r.recorded, false);
  assert.equal(r.history['2026-10-21'].score, 8);
  assert.equal(r.streak.current, 2);

  // 今天还没打，但昨天打了：连续天数先保持。
  assert.deepEqual(computeStreak(history, '2026-10-22'), { current: 2, best: 2, playedToday: false });
  // 空过 10/22 之后，10/23 开局前连续天数归零，最佳连续还在。
  assert.deepEqual(computeStreak(history, '2026-10-23'), { current: 0, best: 2, playedToday: false });

  r = applyDailyResult(history, '2026-10-23', { score: 4, seed: 3 });
  history = r.history;
  assert.equal(r.recorded, true);
  assert.equal(r.streak.current, 1);
  assert.equal(r.streak.best, 2);
  assert.equal(history['2026-10-23'].score, 4);
  r = applyDailyResult(history, '2026-10-23', { score: 0, seed: 3 });
  assert.equal(r.recorded, false);
  assert.equal(r.streak.current, 1);
  assert.equal(r.history['2026-10-23'].score, 4);

  history = applyDailyResult(history, '2026-10-31', { score: 5, seed: 4 }).history;
  r = applyDailyResult(history, '2026-11-01', { score: 6, seed: 5 });
  assert.equal(r.streak.current, 2);
  assert.equal(r.streak.best, 2);
  const replay = applyDailyResult(r.history, '2026-11-01', { score: 0, seed: 5 }, { practice: true });
  assert.equal(replay.recorded, false);
  assert.equal(replay.streak.current, 2);
  assert.equal(replay.history['2026-11-01'].score, 6);
});

test('daily share text', () => {
  assert.equal(
    dailyShareText({ dateKey: '2026-10-23', score: 4, streak: 5, url: 'https://golf-card-game.app.imkyu.com/#c=abc' }),
    '高尔夫纸牌 每日挑战 10/23 · 得分 4 · 连续 5 天 🔥\nhttps://golf-card-game.app.imkyu.com/#c=abc',
  );
  const ch = { v: 1, seed: dailySeed('2026-10-23'), level: -1, score: 4, name: '肯尼', avatar: '⛳', stars: 0, daily: '2026-10-23', streak: 5 };
  assert.deepEqual(decodeChallenge(encodeChallenge(ch)), ch);
});

test('pair floater shows the cancelled points', () => {
  const tens = newColumnPairs(grid([10, 1, 2, 3, 4, 5]), grid([10, 1, 2, 10, 4, 5]));
  assert.equal(tens.pairs.length, 1);
  assert.equal(tens.pairs[0].cancelled, 20);
  assert.equal(pairFloaterLabel(tens.pairs[0].cancelled), '-20');

  const twos = newColumnPairs(grid([2, 1, 3, 4, 5, 6]), grid([2, 1, 3, 2, 5, 6]));
  assert.equal(twos.pairs[0].cancelled, -4);
  assert.equal(pairFloaterLabel(twos.pairs[0].cancelled), '+4');
  assert.equal(pairFloaterLabel(0), '');

  const hidden = grid([8, 3, 1, 8, 4, 2]);
  hidden[3].up = false;
  const revealed = hidden.map((g) => ({ card: g.card, up: true }));
  const flip = newColumnPairs(hidden, revealed);
  assert.equal(flip.pairs.length, 1);
  assert.equal(flip.pairs[0].cancelled, 16);
  assert.equal(pairFloaterLabel(16), '-16');
  assert.equal(newColumnPairs(revealed, revealed).pairs.length, 0);
});

test('result near-miss copy and personal best', () => {
  const level = LEVELS[0];
  const closeToStars = resultFeedback({ level, my: 8, won: true, bestOpponent: 10, previousBest: 14 });
  assert.deepEqual(closeToStars.lines, ['再少 2 分就能拿 ⭐⭐⭐']);
  assert.equal(closeToStars.personalBest, '新的个人最佳 8 分');

  const closeToWin = resultFeedback({ level, my: 9, won: false, bestOpponent: 8, previousBest: 9 });
  assert.deepEqual(closeToWin.lines, ['差 1 分就赢了']);
  assert.equal(closeToWin.personalBest, '追平个人最佳 9 分');

  const oneStar = resultFeedback({ level, my: 14, won: true, bestOpponent: 20, previousBest: 10 });
  assert.deepEqual(oneStar.lines, ['再少 2 分就能拿 ⭐⭐']);
  assert.equal(oneStar.personalBest, '个人最佳 10 分');
  assert.equal(oneStar.improved, false);
});
