// 闯关配置。opponents 中 level 为 AI 难度；holes 为局数（总分最低者胜）
// stars: 赢下即 1 星；总分 ≤ t2 得 2 星；总分 ≤ t3 得 3 星
export const AI_NAMES = [
  { name: '小兔球童', avatar: '🐰' },
  { name: '熊猫教练', avatar: '🐼' },
  { name: '狐狸老K', avatar: '🦊' },
  { name: '猫头鹰博士', avatar: '🦉' },
  { name: '老虎大师', avatar: '🐯' },
  { name: '企鹅杰克', avatar: '🐧' },
];

export const LEVELS = [
  { id: 1, name: '新手果岭', desc: '1 位新手对手，1 局定胜负', holes: 1, opponents: [{ ai: 0, level: 'easy' }], rules: {}, t2: 12, t3: 6 },
  { id: 2, name: '晨练草坪', desc: '2 局累计，熟悉配对抵消', holes: 2, opponents: [{ ai: 0, level: 'easy' }], rules: {}, t2: 22, t3: 12 },
  { id: 3, name: '教练陪练', desc: '会算牌的普通对手', holes: 2, opponents: [{ ai: 1, level: 'normal' }], rules: {}, t2: 20, t3: 10 },
  { id: 4, name: '三人同行', desc: '两位对手同桌竞技', holes: 2, opponents: [{ ai: 0, level: 'easy' }, { ai: 1, level: 'normal' }], rules: {}, t2: 20, t3: 10 },
  { id: 5, name: '小丑来袭', desc: '牌堆加入 2 张王牌（-2 分）', holes: 2, opponents: [{ ai: 2, level: 'normal' }, { ai: 1, level: 'normal' }], rules: { jokers: true }, t2: 18, t3: 8 },
  { id: 6, name: '迷雾果岭', desc: '开局只翻 1 张牌', holes: 2, opponents: [{ ai: 3, level: 'normal' }, { ai: 2, level: 'normal' }], rules: { startFlips: 1 }, t2: 20, t3: 10 },
  { id: 7, name: '高手过招', desc: '一对一挑战高手，3 局', holes: 3, opponents: [{ ai: 4, level: 'hard' }], rules: {}, t2: 28, t3: 15 },
  { id: 8, name: '国王之怒', desc: 'K 变成 +12 分，小心！', holes: 2, opponents: [{ ai: 2, level: 'normal' }, { ai: 4, level: 'hard' }], rules: { kingValue: 12 }, t2: 22, t3: 12 },
  { id: 9, name: '四人混战', desc: '三位对手 · 四条奖励 -10', holes: 2, opponents: [{ ai: 1, level: 'normal' }, { ai: 3, level: 'hard' }, { ai: 5, level: 'normal' }], rules: { quadBonus: -10 }, t2: 18, t3: 8 },
  { id: 10, name: '大师杯', desc: '三位高手 + 王牌，3 局决冠军', holes: 3, opponents: [{ ai: 4, level: 'hard' }, { ai: 3, level: 'hard' }, { ai: 2, level: 'hard' }], rules: { jokers: true }, t2: 25, t3: 12 },
];

export const QUICK_LEVEL = { id: 0, name: '自由对局', desc: '两位普通对手，3 局', holes: 3, opponents: [{ ai: 1, level: 'normal' }, { ai: 2, level: 'normal' }], rules: {}, t2: 25, t3: 12 };

export function getLevel(id) { return id === 0 ? QUICK_LEVEL : LEVELS.find((l) => l.id === id); }

export function starsFor(level, myTotal, won) {
  if (!won) return 0;
  if (myTotal <= level.t3) return 3;
  if (myTotal <= level.t2) return 2;
  return 1;
}
