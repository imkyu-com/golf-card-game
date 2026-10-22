// 配对反馈和结算文案。纯函数，方便测试，也不碰动画。
import { COLUMNS, cardValue, scoreGrid } from './rules.js';

export function newColumnPairs(beforeGrid, afterGrid, rules) {
  const prev = scoreGrid(beforeGrid, rules, true);
  const next = scoreGrid(afterGrid, rules, true);
  const pairs = [];
  for (let i = 0; i < next.columns.length; i++) {
    if (!next.columns[i].paired || prev.columns[i].paired) continue;
    const [a, b] = COLUMNS[i];
    const cancelled = cardValue(afterGrid[a].card, rules) + cardValue(afterGrid[b].card, rules);
    pairs.push({
      column: i,
      slots: [a, b],
      ids: [afterGrid[a].card.id, afterGrid[b].card.id],
      cancelled,
    });
  }
  return { pairs, bonusDelta: (next.bonus || 0) - (prev.bonus || 0) };
}

// 两张 10 抵消 20 分，显示 -20。两张 2 本来各 -2，凑成对子后不再是 -4，显示 +4。
export function pairFloaterLabel(cancelled) {
  if (!cancelled) return '';
  return cancelled > 0 ? `-${cancelled}` : `+${-cancelled}`;
}

export function resultFeedback({ level, my, won, bestOpponent, previousBest }) {
  const lines = [];
  if (!won && Number.isFinite(bestOpponent) && my > bestOpponent) {
    lines.push(`差 ${my - bestOpponent} 分就赢了`);
  } else if (won && level && Number.isFinite(level.t2) && Number.isFinite(level.t3)) {
    if (my > level.t2) lines.push(`再少 ${my - level.t2} 分就能拿 ⭐⭐`);
    else if (my > level.t3) lines.push(`再少 ${my - level.t3} 分就能拿 ⭐⭐⭐`);
  }
  let personalBest;
  if (previousBest == null || my < previousBest) personalBest = `新的个人最佳 ${my} 分`;
  else if (my === previousBest) personalBest = `追平个人最佳 ${my} 分`;
  else personalBest = `个人最佳 ${previousBest} 分`;
  return {
    lines,
    personalBest,
    improved: previousBest == null || my < previousBest,
  };
}
