// 挑战链接 + 战绩卡片（纯前端，无后端）
const toB64Url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

// challenge = { v, seed, level, score, name, avatar, stars }
export function encodeChallenge(ch) { return toB64Url(JSON.stringify(ch)); }
export function decodeChallenge(code) {
  try {
    const o = JSON.parse(fromB64Url(code));
    if (typeof o !== 'object' || o === null || typeof o.seed !== 'number' || typeof o.level !== 'number') return null;
    o.name = String(o.name ?? '神秘玩家').slice(0, 16);
    o.avatar = String(o.avatar ?? '🙂').slice(0, 4);
    return o;
  } catch { return null; }
}

// 当前页面所在目录（origin + path）。自定义域名挂在根路径，
// 挑战链接仍按实际页面地址拼接，不能写死 base，也不能只使用 origin。
export function pageBase(loc) {
  const here = loc ?? (typeof globalThis.location === 'object' ? globalThis.location : undefined);
  if (!here || typeof here.origin !== 'string' || !here.origin) {
    throw new TypeError('page location is required to build a challenge link');
  }
  let path = String(here.pathname || '/');
  path = path.replace(/index\.html$/i, '');
  if (!path.endsWith('/')) path += '/';
  return here.origin + path;
}

export function challengeUrl(ch, base) {
  const root = base ?? pageBase();
  return `${root}#c=${encodeChallenge(ch)}`;
}

export function readChallengeFromUrl() {
  const m = (location.hash || '').match(/[#&]c=([\w-]+)/) || (location.search || '').match(/[?&]c=([\w-]+)/);
  return m ? decodeChallenge(m[1]) : null;
}

export function resultText({ name, levelName, levelId, score, stars, won, url }) {
  const st = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  return `⛳ 3D 高尔夫纸牌 · 第${levelId}关「${levelName}」\n${name} ${won ? '获胜' : '惜败'}，总分 ${score} 分 ${st}\n同一副牌，你能打得比我低吗？👉 ${url}`;
}

// 生成一张 1080x1350 战绩卡图片（PNG dataURL）
export function resultCardImage({ name, avatar, levelName, levelId, score, stars, won, players }) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#0f5132'); grd.addColorStop(1, '#06281a');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // 草坪纹理
  g.globalAlpha = 0.025;
  for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? '#fff' : '#000'; g.fillRect(0, i * 34, W, 17); }
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.fillStyle = '#ffd166';
  g.font = 'bold 64px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText('⛳ 3D 高尔夫纸牌', W / 2, 140);
  g.fillStyle = '#e9f5ee';
  g.font = '44px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  g.fillText(levelId ? `第 ${levelId} 关 · ${levelName}` : levelName, W / 2, 220);
  g.font = '160px "Noto Color Emoji", "Apple Color Emoji", sans-serif';
  g.fillText(avatar, W / 2, 440);
  g.fillStyle = '#fff';
  g.font = 'bold 60px "Noto Sans CJK SC", "PingFang SC", sans-serif';
  g.fillText(name, W / 2, 530);
  g.fillStyle = won ? '#7ee787' : '#ff9b9b';
  g.font = 'bold 56px "Noto Sans CJK SC", "PingFang SC", sans-serif';
  g.fillText(won ? '🏆 获胜！' : '惜败，再接再厉', W / 2, 620);
  g.fillStyle = '#ffd166';
  g.font = 'bold 200px "Noto Sans CJK SC", sans-serif';
  g.fillText(String(score), W / 2, 830);
  g.font = '40px "Noto Sans CJK SC", sans-serif';
  g.fillStyle = '#cfe8d8';
  g.fillText('总杆数（越低越好）', W / 2, 890);
  g.font = '110px sans-serif';
  g.fillStyle = '#ffd166';
  g.fillText('★'.repeat(stars) + '☆'.repeat(3 - stars), W / 2, 1020);
  if (players) {
    g.font = '36px "Noto Sans CJK SC", "Noto Color Emoji", sans-serif';
    g.fillStyle = '#e9f5ee';
    g.fillText(players.map((p) => `${p.avatar}${p.name} ${p.total}`).join('   '), W / 2, 1120);
  }
  g.fillStyle = '#9fc5b0';
  g.font = '36px "Noto Sans CJK SC", sans-serif';
  g.fillText('同一副牌，来挑战我吧！', W / 2, 1240);
  return cv.toDataURL('image/png');
}
