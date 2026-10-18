// Three.js 3D 牌桌：声明式布局 —— 每次状态变化后调用 layout(state)，
// 每张牌根据自己在状态中的位置计算目标位姿，然后做补间动画（移动带抛物线、翻面带抬起）
import * as THREE from 'three';
import { faceTexture, backTexture, setMaxAnisotropy } from './cardTextures.js';
import { scoreGrid, pointsLabel } from '../game/rules.js';

const CW = 0.9, CH = 1.26, GAP = 0.12, SEAT_R = 3.55, STACK_DY = 0.007;
const DECK_POS = new THREE.Vector3(-0.62, 0.03, 0);
const DISCARD_POS = new THREE.Vector3(0.62, 0.03, 0);
// 竖屏：镜头靠近自己，自己的 2×3 放大并略微立起；对手缩进远侧，仍可读。
// 数字是在 390×844 / 360×740 / 320×568 / 768×1024 上投影测出来的，横屏不走这条。
const PORTRAIT = {
  humanR: 3.28, humanScale: 1.2, humanTilt: 0.28, rowSpread: 1.12,
  farR: 2.7, farScale: 1.0,
  sideR: 2.95, sideScale: 0.72, sideAng: 0.34,
  sideAng4: 0.14, sideR4: 2.22, sideScale4: 0.56,
  farR4: 3.15, farScale4: 0.8,
  pileScale: 1.12, pileZ: 0.12, pileX: 0.78,
  fov: 56, camY: 8.4, camZ: 9.0, targetZ: 0.35,
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function zeroBadgeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 112;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 112);
  g.fillStyle = '#1b7a4b';
  roundRect(g, 4, 4, 248, 104, 52);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#d8f3dc';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 72px "Noto Sans CJK SC","WenQuanYi Micro Hei","PingFang SC","Microsoft YaHei",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(pointsLabel(0), 128, 58);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TableScene {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#10231b');
    this.scene.fog = new THREE.Fog('#10231b', 18, 34);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.cameraTarget = new THREE.Vector3(0, 0, 0.7);
    this.cameraShake = 0;

    this._buildEnvironment();
    this.cards = new Map(); // id -> { group, front, back, card, tween, target }
    this.seats = [];
    this.highlight = { deck: false, discard: false, slots: new Set() };
    this.hover = null;
    this.paired = new Set();
    this.onPick = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this._bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this._tick());
  }

  _buildEnvironment() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#fff4e0', '#183024', 0.95));
    const sun = (this.sun = new THREE.DirectionalLight('#fff1d6', 1.9));
    sun.position.set(4.5, 12, 6.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    s.add(sun);
    const fill = new THREE.PointLight('#ffd9a0', 18, 20, 2);
    fill.position.set(-5, 5, 4);
    s.add(fill);

    // 地面
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshStandardMaterial({ color: '#2b3d2f', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -3.6; floor.receiveShadow = true;
    s.add(floor);

    // 桌面（毛毡纹理用 canvas 生成）
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(256, 256, 30, 256, 256, 256);
    grd.addColorStop(0, '#2f9a5f'); grd.addColorStop(0.7, '#227a49'); grd.addColorStop(1, '#16603a');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 3; g.setLineDash([10, 10]);
    g.beginPath(); g.arc(256, 256, 70, 0, Math.PI * 2); g.stroke();
    const feltTex = new THREE.CanvasTexture(cv); feltTex.colorSpace = THREE.SRGBColorSpace;
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.36, 48), [
      new THREE.MeshStandardMaterial({ color: '#145a35', roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: '#145a35' }),
    ]);
    felt.position.y = -0.18; felt.receiveShadow = true;
    s.add(felt);
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a33', roughness: 0.55, flatShading: true });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(6.28, 0.32, 8, 48), wood);
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.02; rim.castShadow = true; rim.receiveShadow = true;
    s.add(rim);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 3.3, 10), wood);
    leg.position.y = -1.95; leg.castShadow = true; s.add(leg);

    // 小装饰：低多边形果岭旗、高尔夫球、背景树
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), new THREE.MeshStandardMaterial({ color: '#eeeeee' }));
    pole.position.y = 0.8; pole.castShadow = true; flag.add(pole);
    const cloth = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.55, 0), new THREE.Vector3(0.6, 1.38, 0), new THREE.Vector3(0, 1.2, 0)]), new THREE.MeshStandardMaterial({ color: '#e63946', side: THREE.DoubleSide, flatShading: true }));
    cloth.geometry.computeVertexNormals(); cloth.castShadow = true; flag.add(cloth);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), new THREE.MeshBasicMaterial({ color: '#0b2416' }));
    hole.rotation.x = -Math.PI / 2; hole.position.y = 0.005; flag.add(hole);
    flag.position.set(3.5, 0, -3.5); s.add(flag);
    this.flagCloth = cloth;
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.4 }));
    ball.position.set(-3.5, 0.16, 3.1); ball.castShadow = true; s.add(ball);
    const treeMat = new THREE.MeshStandardMaterial({ color: '#2d6a4f', flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4226', flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2, rr = 11 + (i % 3) * 2.5;
      const t = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.2 + (i % 2) * 0.4, 3 + (i % 3), 6), treeMat);
      crown.position.y = 2.2; crown.castShadow = true;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 5), trunkMat);
      trunk.position.y = 0.6;
      t.add(crown, trunk); t.position.set(Math.cos(a) * rr, -3.6, Math.sin(a) * rr);
      s.add(t);
    }
    this.geo = new THREE.PlaneGeometry(CW, CH);
    // 弃牌堆被拿空时仍可点这块区域把牌放回去。有牌时上面的牌更近，会先被点到。
    this.discardZone = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    this.discardZone.rotation.x = -Math.PI / 2;
    this.discardZone.position.set(DISCARD_POS.x, 0.012, DISCARD_POS.z);
    this.discardZone.userData.discardZone = true;
    s.add(this.discardZone);
    this.discardPad = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.discardPad.rotation.x = -Math.PI / 2;
    this.discardPad.position.set(DISCARD_POS.x, 0.016, DISCARD_POS.z);
    this.discardPad.visible = false;
    this.discardPad.raycast = () => {};
    s.add(this.discardPad);
    this._zeroBadgeGeo = new THREE.PlaneGeometry(0.42, 0.2);
    this._zeroBadgeMat = new THREE.MeshBasicMaterial({
      map: zeroBadgeTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / Math.max(h, 1);
    const portrait = aspect < 1;
    this._applyCamera(w, h, portrait);
    // 只有横竖屏切换才重排座位。手机地址栏收起只会改高度，重排会打断发牌动画。
    if (this._layoutMode !== (portrait ? 'p' : 'd')) {
      this._layoutMode = portrait ? 'p' : 'd';
      this._portrait = portrait;
      this._syncPiles();
      if (this.playerCount) {
        this._placeSeats();
        if (this.state) this.layout(this.state, { duration: 0.35 });
      }
    }
  }

  _applyCamera(w, h, portrait) {
    this._portrait = portrait;
    this.camera.aspect = w / Math.max(h, 1);
    if (!portrait) {
      this.camera.fov = 42;
      this.basePos = new THREE.Vector3(0, 10.2, 8.6);
      this.cameraTarget.set(0, 0, 0.7);
    } else {
      // 矮屏（地址栏或小手机）把注视点往自己这边挪一点，避免最前一排被底栏挡住。
      const short = Math.min(1, Math.max(0, (760 - h) / 220));
      this.camera.fov = PORTRAIT.fov;
      this.basePos = new THREE.Vector3(0, PORTRAIT.camY, PORTRAIT.camZ + short * 0.35);
      this.cameraTarget.set(0, 0, PORTRAIT.targetZ + short * 0.9);
    }
    this.camera.position.copy(this.basePos);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
  }

  _syncPiles() {
    if (this._portrait) {
      this._pile = { x: PORTRAIT.pileX, z: PORTRAIT.pileZ, scale: PORTRAIT.pileScale };
    } else {
      this._pile = { x: 0.62, z: 0, scale: 1 };
    }
    const { x, z, scale } = this._pile;
    if (this.discardZone) {
      this.discardZone.position.set(x, 0.012, z);
      this.discardZone.scale.setScalar(scale);
    }
    if (this.discardPad) {
      this.discardPad.position.set(x, 0.016, z);
      this.discardPad.scale.setScalar(scale);
    }
  }

  // ---------- 座位 ----------
  setupSeats(n) {
    this.playerCount = n;
    this._portrait = (this.container.clientWidth || window.innerWidth) < (this.container.clientHeight || window.innerHeight);
    this._layoutMode = this._portrait ? 'p' : 'd';
    this._syncPiles();
    this._placeSeats();
  }

  _seat(ang, r, scale, tilt = 0, rowSpread = 1) {
    const pos = new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    return { ang, pos, yaw: Math.PI / 2 - ang, scale, tilt, rowSpread };
  }

  _placeSeats() {
    const n = this.playerCount;
    if (!n) return;
    if (!this._portrait) {
      this.seats = [];
      for (let i = 0; i < n; i++) {
        let ang = Math.PI / 2 + (i * Math.PI * 2) / n;
        if (n === 2 && i === 1) ang = -Math.PI / 2;
        if (n === 3) ang = [Math.PI / 2, Math.PI * (7 / 6), Math.PI * (11 / 6)][i];
        if (n === 4) ang = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][i];
        this.seats.push(this._seat(ang, SEAT_R, 1, 0, 1));
      }
      return;
    }
    const P = PORTRAIT;
    const human = this._seat(Math.PI / 2, P.humanR, P.humanScale, P.humanTilt, P.rowSpread);
    if (n === 2) this.seats = [human, this._seat(-Math.PI / 2, P.farR, P.farScale)];
    else if (n === 3) this.seats = [
      human,
      this._seat(Math.PI * (1 + P.sideAng), P.sideR, P.sideScale),
      this._seat(-Math.PI * P.sideAng, P.sideR, P.sideScale),
    ];
    else if (n === 4) this.seats = [
      human,
      this._seat(Math.PI * (1 + P.sideAng4), P.sideR4, P.sideScale4),
      this._seat(-Math.PI / 2, P.farR4, P.farScale4),
      this._seat(-Math.PI * P.sideAng4, P.sideR4, P.sideScale4),
    ];
    else {
      this.seats = [];
      for (let i = 0; i < n; i++) {
        const ang = Math.PI / 2 + (i * Math.PI * 2) / n;
        const mine = i === 0;
        this.seats.push(this._seat(ang, mine ? P.humanR : P.sideR, mine ? P.humanScale : P.sideScale, mine ? P.humanTilt : 0, mine ? P.rowSpread : 1));
      }
    }
  }

  slotPose(p, slot) {
    const seat = this.seats[p];
    const s = seat.scale ?? 1;
    const spread = seat.rowSpread ?? 1;
    const c = slot % 3, r = Math.floor(slot / 3);
    const lx = (c - 1) * (CW + GAP) * s;
    const lz = (r - 0.5) * (CH + GAP) * s * spread;
    const cs = Math.cos(seat.yaw), sn = Math.sin(seat.yaw);
    const tilt = seat.tilt || 0;
    // 绕牌中心立起后，近端会扎进桌面，把整张牌抬到近端刚好贴着桌面。
    const lift = Math.max(0, Math.sin(tilt) * CH * s * 0.5);
    return {
      x: seat.pos.x + lx * cs + lz * sn,
      y: 0.02 + lift,
      z: seat.pos.z - lx * sn + lz * cs,
      yaw: seat.yaw,
      tilt,
      scale: s,
    };
  }

  _projectPx(v) {
    const p = v.clone().project(this.camera);
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
  }

  seatScreenPos(p) {
    const seat = this.seats[p];
    if (!seat) return null;
    const radial = seat.pos.clone();
    if (radial.lengthSq() < 1e-4) radial.set(0, 0, -1);
    const extra = this._portrait ? 1.05 : 2.05;
    const out = radial.normalize().multiplyScalar(seat.pos.length() + extra);
    out.y = this._portrait ? 0.45 : 0.2;
    return this._projectPx(out);
  }

  // 竖屏把名字牌放在该座位牌阵的上沿，避免压住牌。
  seatAnchor(p) {
    const seat = this.seats[p];
    if (!seat) return null;
    const pts = [];
    const holder = new THREE.Object3D();
    holder.rotation.order = 'YXZ';
    for (let slot = 0; slot < 6; slot++) {
      const pose = this.slotPose(p, slot);
      holder.position.set(pose.x, pose.y, pose.z);
      holder.rotation.set(pose.tilt || 0, pose.yaw, 0);
      holder.scale.setScalar(pose.scale || 1);
      holder.updateMatrixWorld(true);
      for (const [lx, lz] of [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]]) {
        pts.push(this._projectPx(holder.localToWorld(new THREE.Vector3(lx, 0, lz))));
      }
    }
    const top = Math.min(...pts.map((q) => q.y));
    const band = pts.filter((q) => q.y < top + 18);
    const x = band.reduce((s, q) => s + q.x, 0) / band.length;
    return { x, y: top };
  }

  // ---------- 牌 ----------
  clearCards() {
    for (const c of this.cards.values()) {
      this.scene.remove(c.group);
      c.front.material.dispose(); c.back.material.dispose();
    }
    this.cards.clear();
    this.paired.clear();
  }

  _makeCard(card, rules) {
    const mk = (map) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.55, metalness: 0, emissive: new THREE.Color('#000000') });
    const front = new THREE.Mesh(this.geo, mk(faceTexture(card, rules)));
    front.rotation.x = -Math.PI / 2; front.position.y = 0.004;
    // 牌背画布上旗尖朝上。扣着的牌（flip = π）如果不再转一圈，旗尖会朝座位外，
    // 自己面前的牌背在画面上就是倒的。绕牌背法线转 180° 后，每个座位的牌背都指向桌心，
    // 和明牌的「上方」是同一条边；牌堆（yaw = 0）因此也是正的。牌面网格不动，翻开后仍然可读。
    const back = new THREE.Mesh(this.geo, mk(backTexture()));
    back.rotation.x = Math.PI / 2;
    back.rotation.z = Math.PI;
    back.position.y = -0.004;
    for (const m of [front, back]) { m.castShadow = true; m.receiveShadow = true; m.userData.cardId = card.id; }
    // 盖住牌面底部的原始分。只有同列抵消时才显示，避免把已经记 0 的牌再加进总分。
    const zeroBadge = new THREE.Mesh(this._zeroBadgeGeo, this._zeroBadgeMat);
    zeroBadge.position.set(0, -0.47, 0.02);
    zeroBadge.visible = false;
    zeroBadge.raycast = () => {};
    front.add(zeroBadge);
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.add(front, back);
    this.scene.add(group);
    const entry = { group, front, back, card, tween: null, target: null, zeroBadge };
    this.cards.set(card.id, entry);
    return entry;
  }

  // 新的一局：创建所有牌，全部放在牌堆位置（随后 layout 会产生发牌动画）
  setupHole(state) {
    this.clearCards();
    this.state = state;
    const all = [...state.deck, ...state.discard];
    for (const pl of state.players) for (const g of pl.grid) all.push(g.card);
    all.forEach((card, i) => {
      const e = this._makeCard(card, state.rules);
      const pile = this._pile || { x: 0.62, z: 0, scale: 1 };
      e.group.position.set(-pile.x, DECK_POS.y + i * STACK_DY, pile.z);
      e.group.rotation.set(0, 0, Math.PI);
      e.group.scale.setScalar(pile.scale);
      e.target = { x: -pile.x, y: DECK_POS.y + i * STACK_DY, z: pile.z, yaw: 0, tilt: 0, flip: Math.PI, scale: pile.scale };
    });
  }

  _poses(state) {
    const poses = new Map();
    const pile = this._pile || { x: 0.62, z: 0, scale: 1 };
    state.deck.forEach((c, i) => poses.set(c.id, { x: -pile.x, y: DECK_POS.y + i * STACK_DY, z: pile.z, yaw: 0, tilt: 0, flip: Math.PI, order: i, scale: pile.scale }));
    state.discard.forEach((c, i) => {
      const j = ((c.id * 7919) % 100) / 100 - 0.5;
      poses.set(c.id, { x: pile.x + j * 0.06, y: DISCARD_POS.y + i * STACK_DY, z: pile.z + j * 0.04, yaw: j * 0.25, tilt: 0, flip: 0, order: i, scale: pile.scale });
    });
    state.players.forEach((pl, p) => pl.grid.forEach((g, slot) => {
      const ps = this.slotPose(p, slot);
      poses.set(g.card.id, { ...ps, flip: g.up ? 0 : Math.PI, order: 0 });
    }));
    if (state.held) {
      const p = state.current;
      if (p === 0) {
        poses.set(state.held.id, this._portrait
          ? { x: 0, y: 2.15, z: 1.05, yaw: 0, tilt: 0.75, flip: 0, scale: 1.28 }
          : { x: 0, y: 2.2, z: 2.1, yaw: 0, tilt: 0.6, flip: 0, scale: 1 });
      } else {
        const seat = this.seats[p];
        const v = seat.pos.clone().multiplyScalar(this._portrait ? 0.62 : 0.48);
        poses.set(state.held.id, { x: v.x, y: this._portrait ? 1.15 : 1.3, z: v.z, yaw: seat.yaw, tilt: this._portrait ? 0.42 : 0.35, flip: 0, scale: Math.max(seat.scale || 1, this._portrait ? 0.9 : 1) });
      }
    }
    return poses;
  }

  // 布局（带动画），返回动画完成的 Promise
  layout(state, { duration = 0.42, stagger = 0 } = {}) {
    this.state = state;
    const poses = this._poses(state);
    const promises = [];
    let k = 0;
    for (const [id, pose] of poses) {
      const e = this.cards.get(id);
      if (!e) continue;
      const t = e.target;
      const poseScale = pose.scale ?? 1;
      const same = t && Math.abs(t.x - pose.x) < 1e-4 && Math.abs(t.y - pose.y) < 1e-4 && Math.abs(t.z - pose.z) < 1e-4 && Math.abs(angDiff(t.yaw, pose.yaw)) < 1e-4 && t.flip === pose.flip && t.tilt === pose.tilt && Math.abs((t.scale ?? 1) - poseScale) < 1e-4;
      if (same) continue;
      const g = e.group;
      const from = { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y, tilt: g.rotation.x, flip: g.rotation.z, scale: g.scale.x };
      const dist = Math.hypot(pose.x - from.x, pose.z - from.z);
      const flipping = Math.abs(pose.flip - from.flip) > 0.01;
      const lift = Math.min(1.2, dist * 0.22) + (flipping ? 0.55 : 0);
      const delay = stagger ? (k++) * stagger : 0;
      const dur = duration + Math.min(0.25, dist * 0.03);
      e.target = pose;
      promises.push(new Promise((resolve) => {
        e.tween = { from, to: pose, t0: this.clock.elapsedTime + delay, dur, lift, resolve };
      }));
      g.renderOrder = pose.order || 0;
    }
    this.syncPairing(state);
    return Promise.all(promises);
  }

  _tick() {
    const now = this.clock.getElapsedTime();
    for (const e of this.cards.values()) {
      const tw = e.tween;
      if (!tw) continue;
      let t = (now - tw.t0) / tw.dur;
      if (t < 0) continue;
      if (t >= 1) t = 1;
      const k = easeInOut(t);
      const g = e.group, f = tw.from, to = tw.to;
      g.position.set(f.x + (to.x - f.x) * k, f.y + (to.y - f.y) * k + Math.sin(Math.PI * k) * tw.lift, f.z + (to.z - f.z) * k);
      g.rotation.y = f.yaw + angDiff(f.yaw, to.yaw) * k;
      g.rotation.x = f.tilt + (to.tilt - f.tilt) * k;
      g.rotation.z = f.flip + (to.flip - f.flip) * k;
      g.scale.setScalar(f.scale + ((to.scale ?? 1) - f.scale) * k);
      if (t >= 1) { e.tween = null; tw.resolve(); }
    }
    // 高亮脉冲
    const pulse = 0.25 + 0.2 * Math.sin(now * 5);
    const st = this.state;
    for (const e of this.cards.values()) {
      let on = 0, color = '#ffd166';
      if (st) {
        const id = e.card.id;
        if (this.highlight.deck && st.deck.length && st.deck[st.deck.length - 1].id === id) on = 1;
        if (this.highlight.discard && st.discard.length && st.discard[st.discard.length - 1].id === id) on = 1;
        if (this.highlight.slots.size && st.players[0].grid.some((g, i) => g.card.id === id && this.highlight.slots.has(i))) on = 1;
      }
      if (this.paired.has(e.card.id)) { on = 1; color = '#52b788'; }
      const hov = this.hover === e.card.id && on && color !== '#52b788';
      const intensity = on ? (hov ? 0.7 : pulse) : 0;
      for (const m of [e.front.material, e.back.material]) {
        if (m.emissiveIntensity !== intensity || on) { m.emissive.set(on ? color : '#000000'); m.emissiveIntensity = intensity; }
      }
    }
    if (this.discardPad) {
      const emptyPick = !!(st && this.highlight.discard && st.discard.length === 0);
      this.discardPad.visible = emptyPick;
      if (emptyPick) this.discardPad.material.opacity = 0.55 + 0.3 * Math.sin(now * 5);
    }
    if (this.flagCloth) this.flagCloth.rotation.y = Math.sin(now * 1.7) * 0.25;
    // 镜头轻微呼吸 + 震动
    const cam = this.camera;
    cam.position.set(this.basePos.x + Math.sin(now * 0.25) * 0.15, this.basePos.y, this.basePos.z);
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - 0.02);
      cam.position.x += (Math.random() - 0.5) * this.cameraShake;
      cam.position.y += (Math.random() - 0.5) * this.cameraShake;
    }
    cam.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, cam);
    if (this.onFrame) this.onFrame();
  }

  setHighlight({ deck = false, discard = false, slots = [] } = {}) {
    this.highlight = { deck, discard, slots: new Set(slots) };
  }

  setPaired(ids) {
    this.paired = new Set(ids);
    this._applyPairBadges();
  }

  // 列高亮和「0分」徽章都从 scoreGrid 来，和明牌分、终局分是同一条规则。
  // 对局中只标出两张都已翻开的对子；终局全部翻开后再标，最后亮出的对子也会变成 0。
  syncPairing(state = this.state) {
    if (!state) { this.setPaired([]); return; }
    const onlyVisible = state.phase !== 'over';
    const ids = [];
    for (const pl of state.players) {
      const sc = scoreGrid(pl.grid, state.rules, onlyVisible);
      for (const col of sc.columns) {
        if (!col.paired) continue;
        for (const slot of col.slots) ids.push(pl.grid[slot].card.id);
      }
    }
    this.setPaired(ids);
  }

  _applyPairBadges() {
    for (const e of this.cards.values()) {
      if (e.zeroBadge) e.zeroBadge.visible = this.paired.has(e.card.id);
    }
  }
  shake(amount = 0.25) { this.cameraShake = amount; }

  // ---------- 输入 ----------
  _pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [];
    if (this.discardZone) meshes.push(this.discardZone);
    for (const e of this.cards.values()) meshes.push(e.front, e.back);
    const hits = this.raycaster.intersectObjects(meshes, false);
    const st = this.state;
    if (!st) return null;
    for (const h of hits) {
      if (h.object.userData.discardZone) return { kind: 'discard', id: st.discard[st.discard.length - 1]?.id ?? null };
      const id = h.object.userData.cardId;
      if (st.deck.some((c) => c.id === id)) return { kind: 'deck', id: st.deck[st.deck.length - 1]?.id };
      if (st.discard.length && st.discard[st.discard.length - 1].id === id) return { kind: 'discard', id };
      const slot = st.players[0].grid.findIndex((g) => g.card.id === id);
      if (slot >= 0) return { kind: 'slot', slot, id };
      if (st.held && st.held.id === id) return { kind: 'held', id };
    }
    return null;
  }

  _bindInput() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
      down = null;
      const hit = this._pickAt(e.clientX, e.clientY);
      if (hit && this.onPick) this.onPick(hit);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const hit = this._pickAt(e.clientX, e.clientY);
      this.hover = hit ? hit.id : null;
      const h = this.highlight;
      const clickable = hit && ((hit.kind === 'deck' && h.deck) || (hit.kind === 'discard' && h.discard) || (hit.kind === 'slot' && h.slots.has(hit.slot)));
      el.style.cursor = clickable ? 'pointer' : 'default';
    });
  }
}
