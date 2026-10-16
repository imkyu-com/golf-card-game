// 用 Canvas 程序化绘制牌面/牌背纹理（无需任何外部美术资源）
import * as THREE from 'three';
import { SUIT_SYMBOL, rankLabel, rankValue } from '../game/rules.js';

export const TEX_W = 256, TEX_H = 360;
const FONT = '"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';
const cache = new Map();
let maxAniso = 4;
export function setMaxAnisotropy(a) { maxAniso = a; }

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function makeTexture(draw) {
  const cv = document.createElement('canvas');
  cv.width = TEX_W; cv.height = TEX_H;
  const g = cv.getContext('2d');
  draw(g);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

function baseCard(g, fill = '#fbf6ea') {
  g.clearRect(0, 0, TEX_W, TEX_H);
  roundRect(g, 4, 4, TEX_W - 8, TEX_H - 8, 24);
  g.fillStyle = fill; g.fill();
  g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.18)'; g.stroke();
}

export function faceTexture(card, rules) {
  const key = `f${card.rank}${card.suit}k${rules.kingValue}`;
  if (cache.has(key)) return cache.get(key);
  const t = makeTexture((g) => {
    baseCard(g);
    const red = card.suit === 'H' || card.suit === 'D';
    const joker = card.rank === 0;
    const color = joker ? '#7b2cbf' : red ? '#d62839' : '#1d2433';
    const sym = SUIT_SYMBOL[card.suit];
    const label = rankLabel(card.rank);
    g.fillStyle = color;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // 角标
    const corner = (rot) => {
      g.save();
      if (rot) { g.translate(TEX_W, TEX_H); g.rotate(Math.PI); }
      g.font = `bold ${label.length > 1 ? 44 : 52}px ${FONT}`;
      g.fillText(label, 40, 46);
      g.font = `40px ${FONT}`;
      g.fillText(sym, 40, 92);
      g.restore();
    };
    corner(false); corner(true);
    // 中央
    const cx = TEX_W / 2, cy = TEX_H / 2 - 6;
    if (card.rank >= 11 || joker) {
      g.fillStyle = joker ? '#efe2ff' : red ? '#ffe3e6' : '#e2e8f3';
      g.beginPath(); g.arc(cx, cy, 70, 0, Math.PI * 2); g.fill();
      g.fillStyle = color;
      g.font = `bold 78px ${FONT}`;
      g.fillText(joker ? '★' : label, cx, cy - 4);
      g.font = `bold 26px ${FONT}`;
      g.fillText(joker ? '王牌' : { 11: '骑士', 12: '皇后', 13: '国王' }[card.rank], cx, cy + 48);
    } else {
      g.font = `bold 96px ${FONT}`;
      g.fillText(sym, cx, cy - 18);
      g.font = `bold 60px ${FONT}`;
      g.fillText(label, cx, cy + 62);
    }
    // 分值徽章
    const v = rankValue(card.rank, rules);
    const bg = v < 0 ? '#2a9d8f' : v === 0 ? '#577590' : v >= 10 ? '#e76f51' : '#8d99ae';
    g.fillStyle = bg;
    roundRect(g, cx - 46, TEX_H - 62, 92, 38, 19); g.fill();
    g.fillStyle = '#fff';
    g.font = `bold 26px ${FONT}`;
    g.fillText(`${v > 0 ? '+' : ''}${v}分`, cx, TEX_H - 42);
  });
  cache.set(key, t);
  return t;
}

export function backTexture() {
  if (cache.has('back')) return cache.get('back');
  const t = makeTexture((g) => {
    baseCard(g, '#fbf6ea');
    roundRect(g, 16, 16, TEX_W - 32, TEX_H - 32, 16);
    const grd = g.createLinearGradient(0, 0, TEX_W, TEX_H);
    grd.addColorStop(0, '#1b7a4b'); grd.addColorStop(1, '#0d4d2e');
    g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    // 高尔夫球窝点纹理
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 20; y < TEX_H; y += 22) for (let x = (y / 22) % 2 ? 22 : 11; x < TEX_W; x += 22) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
    g.restore();
    g.lineWidth = 5; g.strokeStyle = '#e9c46a';
    roundRect(g, 26, 26, TEX_W - 52, TEX_H - 52, 12); g.stroke();
    // 中央旗帜徽记
    const cx = TEX_W / 2, cy = TEX_H / 2;
    g.fillStyle = '#fbf6ea';
    g.beginPath(); g.arc(cx, cy, 52, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#333'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx - 8, cy + 32); g.lineTo(cx - 8, cy - 34); g.stroke();
    g.fillStyle = '#e63946';
    g.beginPath(); g.moveTo(cx - 6, cy - 34); g.lineTo(cx + 30, cy - 22); g.lineTo(cx - 6, cy - 10); g.closePath(); g.fill();
    g.fillStyle = '#2a9d8f';
    g.beginPath(); g.ellipse(cx - 8, cy + 34, 22, 6, 0, 0, Math.PI * 2); g.fill();
  });
  cache.set('back', t);
  return t;
}
