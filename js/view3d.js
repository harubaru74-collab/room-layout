// 部屋の中を歩いて見る(3D)。Three.js を使う
// 単位: 1 = 1m（データの cm を 100 で割って使う）
import * as THREE from 'three';
import { floorStyle, wallStyle } from './data.js';

const M = 0.01;

export function create3D(container, app) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.rotation.order = 'YXZ';
  const cam = { x: 1.55, z: 0.6, yaw: Math.PI, pitch: -0.05 };
  // 俯瞰(ふかん)モード用: 注目点のまわりを回るカメラ。theta=水平の角度、phi=真上からの傾き
  const orbit = { tx: 1.5, tz: 4, dist: 9, theta: 0.5, phi: 0.9 };
  let camMode = 'walk'; // 'walk' = 歩く / 'orbit' = 俯瞰

  let roomGroup = null, furnGroup = null, lightGroup = null;
  let wallGroups = {}, ceilMesh = null, sceneryGroup = null;
  let dirty = true, running = false, last = 0;
  const keys = {};
  const joy = { x: 0, y: 0 };

  // ---------- テクスチャ ----------
  function woodTexture(fl) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = fl.base; g.fillRect(0, 0, 512, 512);
    const plankW = 64;
    for (let i = 0; i < 8; i++) {
      const off = (i * 197) % 512;
      for (let k = 0; k < 2; k++) {
        const y = (off + k * 256) % 512;
        g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${0.03 + (i * 37 % 5) / 100})`;
        g.fillRect(i * plankW, 0, plankW, 512);
        g.strokeStyle = fl.line; g.globalAlpha = 0.6; g.lineWidth = 2;
        g.beginPath(); g.moveTo(i * plankW, y); g.lineTo(i * plankW + plankW, y); g.stroke();
        g.globalAlpha = 1;
      }
      g.strokeStyle = fl.line; g.globalAlpha = 0.7; g.lineWidth = 2;
      g.beginPath(); g.moveTo(i * plankW, 0); g.lineTo(i * plankW, 512); g.stroke();
      // 木目
      g.globalAlpha = 0.18; g.lineWidth = 1;
      for (let j = 0; j < 7; j++) {
        const x = i * plankW + 6 + j * 8 + Math.sin(i + j) * 3;
        g.beginPath(); g.moveTo(x, 0);
        for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y / 60 + j + i) * 2.5, y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  const mat = (color, opt = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opt });
  function box(w, h, d, material, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  }

  // ---------- 部屋 ----------
  function buildRoom() {
    const { room, view } = app.state;
    const W = room.w * M, D = room.d * M, H = room.h * M, T = 0.12;
    const g = new THREE.Group();
    const fl = floorStyle(view);
    const wallColor = wallStyle(view);

    const tex = woodTexture(fl);
    tex.repeat.set(W / 1.2, D / 1.2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xffffff, { map: tex, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, D / 2); floor.receiveShadow = true;
    g.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xfbfbf8, { roughness: 1, emissive: 0xffffff, emissiveIntensity: view.night ? (view.ceil ? 0.12 : 0.03) : 0.32 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(W / 2, H, D / 2);
    g.add(ceil);
    ceilMesh = ceil;

    const wallMat = mat(wallColor, { roughness: 0.95 });
    // 壁ごとにグループを分ける(俯瞰のとき、手前の壁だけ消して中が見えるように)
    wallGroups = {};
    for (const n of ['entrance', 'balcony', 'left', 'right']) { wallGroups[n] = new THREE.Group(); g.add(wallGroups[n]); }
    const wg = wallGroups;
    // 壁ごとに、窓・ドアの穴をあけて箱で組み立てる
    const walls = {
      entrance: { len: W, place: (a, b, y0, y1) => box(b - a, y1 - y0, T, wallMat, (a + b) / 2, (y0 + y1) / 2, -T / 2, wg.entrance) },
      balcony: { len: W, place: (a, b, y0, y1) => box(b - a, y1 - y0, T, wallMat, (a + b) / 2, (y0 + y1) / 2, D + T / 2, wg.balcony) },
      left: { len: D, place: (a, b, y0, y1) => box(T, y1 - y0, b - a, wallMat, -T / 2, (y0 + y1) / 2, (a + b) / 2, wg.left) },
      right: { len: D, place: (a, b, y0, y1) => box(T, y1 - y0, b - a, wallMat, W + T / 2, (y0 + y1) / 2, (a + b) / 2, wg.right) },
    };
    const frameMat = mat(0xd0d3d6, { metalness: 0.4, roughness: 0.4 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, depthWrite: false });
    for (const [name, wdef] of Object.entries(walls)) {
      const ops = room.openings.filter(o => o.wall === name)
        .map(o => ({ ...o, a: Math.max(0, o.start * M), b: Math.min(wdef.len, (o.start + o.width) * M), y0: o.sill * M, y1: Math.min(H, (o.sill + o.height) * M) }))
        .sort((p, q) => p.a - q.a);
      let cur = 0;
      for (const o of ops) {
        if (o.a > cur) wdef.place(cur, o.a, 0, H);
        if (o.y0 > 0) wdef.place(o.a, o.b, 0, o.y0);
        if (o.y1 < H) wdef.place(o.a, o.b, o.y1, H);
        cur = Math.max(cur, o.b);
        addOpening(wg[name], name, o, W, D, T, frameMat, glassMat);
      }
      if (cur < wdef.len) wdef.place(cur, wdef.len, 0, H);
    }
    // 幅木
    const skirt = mat(0xf2f0ec);
    box(W, 0.06, 0.01, skirt, W / 2, 0.03, 0.005, wg.entrance);
    box(W, 0.06, 0.01, skirt, W / 2, 0.03, D - 0.005, wg.balcony);
    box(0.01, 0.06, D, skirt, 0.005, 0.03, D / 2, wg.left);
    box(0.01, 0.06, D, skirt, W - 0.005, 0.03, D / 2, wg.right);

    for (const fx of room.fixtures) buildFixture(g, fx, H);

    // ベランダと外の景色
    const bal = room.balcony * M;
    box(W, 0.1, bal, mat(0xb9bcc0), W / 2, -0.15, D + T + bal / 2, g);
    const rail = mat(0x2f4f8f, { metalness: 0.5, roughness: 0.4 });
    box(W, 0.05, 0.05, rail, W / 2, 1.0, D + T + bal, g);
    for (let x = 0; x <= W; x += 0.5) box(0.03, 1.0, 0.03, rail, x, 0.5, D + T + bal, g);
    // 外の景色(俯瞰のときは邪魔になるので隠す)
    sceneryGroup = new THREE.Group(); g.add(sceneryGroup);
    const bmat = mat(0xd8d8d2);
    box(6, 7, 4, bmat, W / 2 - 2, 2, D + 6, sceneryGroup);
    box(5, 10, 4, mat(0xc9ccd0), W / 2 + 4.5, 3, D + 9, sceneryGroup);
    box(4, 5, 5, mat(0xe2dccf), -4, 1.5, D + 5, sceneryGroup);
    const tree = mat(0x5f8f4e, { roughness: 1 });
    const t1 = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), tree); t1.position.set(-1.6, 1.5, D * 0.7); sceneryGroup.add(t1);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat(0x9aa08f, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, -3, D / 2); g.add(ground);
    return g;
  }

  function addOpening(g, wall, o, W, D, T, frameMat, glassMat) {
    const len = o.b - o.a, hgt = o.y1 - o.y0, cy = (o.y0 + o.y1) / 2, ca = (o.a + o.b) / 2;
    const horiz = wall === 'entrance' || wall === 'balcony';
    const at = wall === 'entrance' ? -T / 2 : wall === 'balcony' ? D + T / 2 : wall === 'left' ? -T / 2 : W + T / 2;
    const put = (w, h, t, a, y, off = 0) => horiz ? box(w, h, t, frameMat, a, y, at + off, g) : box(t, h, w, frameMat, at + off, y, a, g);
    if (o.kind === 'door') {
      const door = mat(0xcfc6b8, { roughness: 0.6 });
      if (horiz) box(len, hgt, 0.04, door, ca, cy, at, g); else box(0.04, hgt, len, door, at, cy, ca, g);
      const knob = mat(0xaaaaaa, { metalness: 0.8, roughness: 0.3 });
      if (horiz) box(0.03, 0.03, 0.06, knob, o.b - 0.08, 1.0, at + (wall === 'entrance' ? 0.04 : -0.04), g);
      return;
    }
    // 枠
    put(len, 0.04, T + 0.02, ca, o.y0 + 0.02);
    put(len, 0.04, T + 0.02, ca, o.y1 - 0.02);
    put(0.04, hgt, T + 0.02, o.a + 0.02, cy);
    put(0.04, hgt, T + 0.02, o.b - 0.02, cy);
    put(0.03, hgt, 0.05, ca, cy); // 真ん中の桟(引き違い窓)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), glassMat);
    if (horiz) glass.position.set(ca, cy, at); else { glass.position.set(at, cy, ca); glass.rotation.y = Math.PI / 2; }
    g.add(glass);
    // カーテンレール
    const railM = mat(0xeeeeee);
    if (horiz) box(len + 0.3, 0.03, 0.05, railM, ca, o.y1 + 0.06, wall === 'balcony' ? D - 0.08 : 0.08, g);
    else box(0.05, 0.03, len + 0.3, railM, wall === 'left' ? 0.08 : W - 0.08, o.y1 + 0.06, ca, g);
  }

  function buildFixture(g, fx, H) {
    const x = fx.x * M, z = fx.y * M, w = fx.w * M, d = fx.d * M, h = Math.min(fx.h * M, H);
    const cx = x + w / 2, cz = z + d / 2;
    const white = mat(0xf4f2ee, { roughness: 0.8 });
    switch (fx.kind) {
      case 'entrance': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0x77736d, { roughness: 0.9 }));
        m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.003, cz); m.receiveShadow = true; g.add(m);
        break;
      }
      case 'kitchen': {
        box(w, h - 0.04, d, mat(0xf0ead0), cx, (h - 0.04) / 2, cz, g);
        box(w, 0.04, d, mat(0xc9ccd0, { metalness: 0.7, roughness: 0.3 }), cx, h - 0.02, cz, g);
        const sink = mat(0x8d9196, { metalness: 0.8, roughness: 0.25 });
        box(w * 0.6, 0.02, d * 0.35, sink, cx, h + 0.005, z + d * 0.4, g);
        const stove = mat(0x222222);
        box(w * 0.6, 0.02, d * 0.35, stove, cx, h + 0.005, z + d * 0.8, g);
        box(w * 0.6, 0.5, d, mat(0xf0ead0), x + w * 0.7, 1.9, cz, g); // 吊戸棚
        box(0.01, 0.6, d, mat(0xffffff), x + w - 0.005, h + 0.3, cz, g); // タイル壁
        break;
      }
      case 'closet': case 'storage': case 'washer': {
        const body = box(w, h, d, white, cx, h / 2, cz, g);
        body.material = mat(fx.kind === 'closet' ? 0xf3ead2 : 0xefe9de);
        // 扉の線(部屋側=+z または +x 側)
        const seam = mat(0x9a9488);
        const n = Math.max(1, Math.round(fx.w / 50));
        for (let i = 1; i < n; i++) box(0.006, h * 0.95, 0.006, seam, x + (w * i) / n, h / 2, z + d + 0.003, g);
        const knob = mat(0xc9a14a, { metalness: 0.7, roughness: 0.35 });
        box(0.015, 0.12, 0.02, knob, cx - 0.03, Math.min(h * 0.55, 1.0), z + d + 0.01, g);
        box(0.015, 0.12, 0.02, knob, cx + 0.03, Math.min(h * 0.55, 1.0), z + d + 0.01, g);
        break;
      }
      case 'ub': {
        const m = mat(0xf4f1ea);
        box(w, h, 0.06, m, cx, h / 2, z + d - 0.03, g); // 部屋側の壁
        box(0.06, h, d, m, x + w - 0.03, h / 2, cz, g);
        box(0.02, 1.9, Math.min(0.7, d - 0.1), mat(0xe8e2d6), x + w + 0.01, 0.95, cz, g); // 扉(廊下側)
        break;
      }
      default:
        box(w, h || 0.02, d, white, cx, (h || 0.02) / 2, cz, g);
    }
  }

  // ---------- 家具 ----------
  function buildFurniture(f) {
    const g = new THREE.Group();
    const w = f.w * M, d = f.d * M, h = Math.max(0.005, f.h * M);
    const col = new THREE.Color(f.color);
    const main = mat(col);
    const darker = mat(col.clone().multiplyScalar(0.75));
    const wood = mat(0x8a6a4a);
    const leg = (lw, lh, lx, lz) => box(lw, lh, lw, wood, lx, lh / 2, lz, g);
    const night = app.state.view.night;
    switch (f.type) {
      case 'sofa': case 'sofa1': {
        const seat = (f.seat || 41) * M;
        const arm = Math.min(0.15, w * 0.12), back = Math.min(0.22, d * 0.25);
        box(w, seat - 0.12, d, darker, 0, 0.06 + (seat - 0.12) / 2, 0, g);
        box(w - arm * 2, 0.12, d - back, main, 0, seat - 0.06, back / 2, g); // 座面
        box(w, h - 0.06, back, main, 0, 0.06 + (h - 0.06) / 2, -d / 2 + back / 2, g); // 背もたれ
        box(arm, seat + 0.15, d, main, -w / 2 + arm / 2, (seat + 0.15) / 2 + 0.03, 0, g);
        box(arm, seat + 0.15, d, main, w / 2 - arm / 2, (seat + 0.15) / 2 + 0.03, 0, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) leg(0.04, 0.06, sx * (w / 2 - 0.05), sz * (d / 2 - 0.05));
        break;
      }
      case 'bed': {
        const frameH = Math.max(0.1, h - 0.2);
        box(w, frameH, d, main, 0, frameH / 2, 0, g);
        box(w - 0.04, 0.2, d - 0.06, mat(0xfaf8f4), 0, frameH + 0.1, 0.02, g);
        box(w, 0.75, 0.05, main, 0, 0.375, -d / 2 + 0.025, g); // ヘッドボード(背中側)
        box(w * 0.6, 0.08, 0.35, mat(0xffffff), 0, frameH + 0.24, -d / 2 + 0.3, g); // まくら
        box(w - 0.02, 0.05, d * 0.55, mat(0xb9cbe0), 0, frameH + 0.225, d * 0.18, g); // 掛け布団
        break;
      }
      case 'tvstand': {
        box(w, h, d, main, 0, h / 2, 0, g);
        box(w * 0.95, 0.005, 0.005, darker, 0, h / 2, d / 2, g);
        const tvW = Math.min(w, 0.97), tvH = tvW * 0.58;
        box(tvW, tvH, 0.04, mat(0x111111, { roughness: 0.3 }), 0, h + 0.08 + tvH / 2, -0.02, g);
        box(0.25, 0.08, 0.15, mat(0x222222), 0, h + 0.04, -0.02, g);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(tvW * 0.96, tvH * 0.92), new THREE.MeshBasicMaterial({ color: 0x1c2733 }));
        screen.position.set(0, h + 0.08 + tvH / 2, 0.0025); g.add(screen);
        break;
      }
      case 'dresser': {
        const deskH = Math.min(h, 0.72);
        box(w, deskH, d, main, 0, deskH / 2, 0, g);
        box(w * 0.9, 0.005, 0.005, darker, 0, deskH - 0.12, d / 2, g);
        if (h > deskH + 0.1) {
          const mh = h - deskH - 0.04;
          box(w, mh, 0.04, main, 0, deskH + 0.02 + mh / 2, -d / 2 + 0.02, g);
          const mirror = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, mh * 0.85), mat(0xdfe8ef, { metalness: 0.9, roughness: 0.05 }));
          mirror.position.set(0, deskH + 0.02 + mh / 2, -d / 2 + 0.041); g.add(mirror);
        }
        break;
      }
      case 'fridge': {
        box(w, h, d, main, 0, h / 2, 0, g);
        box(w * 0.98, 0.006, 0.006, darker, 0, h * 0.62, d / 2, g);
        box(0.02, 0.25, 0.03, mat(0x999999), w / 2 - 0.05, h * 0.8, d / 2 + 0.015, g);
        box(0.02, 0.25, 0.03, mat(0x999999), w / 2 - 0.05, h * 0.45, d / 2 + 0.015, g);
        break;
      }
      case 'lowtable': case 'desk': {
        const top = 0.03;
        box(w, top, d, main, 0, h - top / 2, 0, g);
        const lw = 0.04;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(lw, h - top, lw, darker, sx * (w / 2 - lw), (h - top) / 2, sz * (d / 2 - lw), g);
        break;
      }
      case 'chair': {
        const sh = Math.min(0.45, h);
        box(w, 0.05, d, main, 0, sh, 0, g);
        box(w, h - sh, 0.04, main, 0, sh + (h - sh) / 2, -d / 2 + 0.02, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03, sh, 0.03, darker, sx * (w / 2 - 0.03), sh / 2, sz * (d / 2 - 0.03), g);
        break;
      }
      case 'bookshelf': {
        const th = 0.02;
        box(th, h, d, main, -w / 2 + th / 2, h / 2, 0, g);
        box(th, h, d, main, w / 2 - th / 2, h / 2, 0, g);
        box(w, h, th, darker, 0, h / 2, -d / 2 + th / 2, g);
        const n = Math.max(2, Math.round(h / 0.35));
        const bookCols = [0x8e5b5b, 0x5b6f8e, 0xd9b55b, 0x6f8e5b, 0xeeeeee];
        for (let i = 0; i <= n; i++) {
          const y = i * (h - th) / n + th / 2;
          box(w, th, d, main, 0, y, 0, g);
          if (i < n) for (let k = 0; k < 6; k++) {
            const bh = (h / n) * (0.55 + (k * 7 % 4) * 0.08);
            box((w - 0.06) / 8, bh, d * 0.7, mat(bookCols[(i + k) % 5]), -w / 2 + 0.06 + k * (w - 0.06) / 8, y + th / 2 + bh / 2, 0, g);
          }
        }
        break;
      }
      case 'futon': {
        box(w, h, d, main, 0, h / 2, 0, g);
        box(w * 0.55, 0.08, 0.3, mat(0xffffff), 0, h + 0.04, -d / 2 + 0.25, g);
        break;
      }
      case 'rug': {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), mat(col, { roughness: 1 }));
        m.position.y = 0.004; m.receiveShadow = true; g.add(m);
        break;
      }
      case 'washer': {
        box(w, h, d, main, 0, h / 2, 0, g);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, 0.01, 24), mat(0x9fb6c8, { roughness: 0.2 }));
        lid.position.set(0, h + 0.005, 0.03); g.add(lid);
        break;
      }
      case 'roundtable': {
        const r = w / 2, sz = d / w, top = 0.03;
        const t = cyl(r, top, main, 0, h - top / 2, 0, g); t.scale.z = sz;
        cyl(0.035, h - top, darker, 0, (h - top) / 2, 0, g);
        const base = cyl(Math.min(r * 0.55, 0.22), 0.02, darker, 0, 0.01, 0, g); base.scale.z = sz;
        break;
      }
      case 'stool': {
        const b = cyl(w / 2, h - 0.06, main, 0, (h - 0.06) / 2, 0, g); b.scale.z = d / w;
        const c = cyl(w / 2 * 0.95, 0.06, mat(col.clone().lerp(new THREE.Color(0xffffff), 0.25)), 0, h - 0.03, 0, g); c.scale.z = d / w;
        break;
      }
      case 'roundrug': {
        const m = cyl(w / 2, 0.008, mat(col, { roughness: 1 }), 0, 0.004, 0, g);
        m.scale.z = d / w; m.castShadow = false;
        break;
      }
      case 'plant': {
        const potH = Math.min(0.35, h * 0.3), potR = Math.min(w, d) * 0.3;
        cyl(potR, potH, mat(0xd9d2c5), 0, potH / 2, 0, g);
        const leaf = mat(col, { roughness: 0.9 });
        const n = 6;
        for (let i = 0; i < n; i++) {
          const a = i * 2.4, rr = Math.min(w, d) * 0.22;
          const y = potH + (h - potH) * (0.35 + 0.6 * (i / n));
          const s = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.28, 10, 8), leaf);
          s.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr); s.scale.y = 0.8; s.castShadow = true;
          g.add(s);
        }
        break;
      }
      case 'lamp': {
        const shadeH = Math.min(0.35, h * 0.25), r = Math.min(w, d) / 2;
        cyl(r * 0.7, 0.03, mat(0x3a3a3a, { metalness: 0.5 }), 0, 0.015, 0, g);
        cyl(0.012, h - shadeH, mat(0x3a3a3a, { metalness: 0.5 }), 0, (h - shadeH) / 2, 0, g);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, shadeH, 24, 1, true),
          new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, emissive: night ? 0xffb25e : 0x000000, emissiveIntensity: night ? 0.9 : 0, roughness: 0.9 }));
        shade.position.y = h - shadeH / 2; g.add(shade);
        break;
      }
      case 'mirror': {
        // 壁に立てかける姿見(背中側に少し倒す)
        const lean = new THREE.Group(); lean.rotation.x = -0.1; lean.position.z = d / 2 - 0.05; g.add(lean);
        box(w, h, 0.03, main, 0, h / 2, 0, lean);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.9), mat(0xe6eef4, { metalness: 0.95, roughness: 0.04 }));
        glass.position.set(0, h / 2, 0.016); lean.add(glass);
        break;
      }
      case 'rack': {
        for (const y of [0.02, h * 0.4, h * 0.7, h - 0.02]) box(w, 0.025, d, main, 0, y, 0, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.02, h, 0.02, mat(0x666666), sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), g);
        break;
      }
      default:
        box(w, h, d, main, 0, h / 2, 0, g);
    }
    g.position.set(f.x * M, 0, f.y * M);
    g.rotation.y = -f.rot * Math.PI / 180;
    g.userData.id = f.id;
    return g;
  }

  function cyl(r, h, material, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(h, 0.001), 28), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  }

  // ---------- 照明 ----------
  function buildLights() {
    const { room, view } = app.state;
    const W = room.w * M, D = room.d * M, H = room.h * M;
    const g = new THREE.Group();
    if (!view.night) {
      scene.background = new THREE.Color(0xbcd8f0);
      scene.fog = null;
      renderer.toneMappingExposure = 1.0;
      g.add(new THREE.HemisphereLight(0xffffff, 0xb59c7c, 1.4));
      const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
      sun.position.set(W / 2 - 2, 6, D + 5);
      sun.target.position.set(W / 2, 0, D / 2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 25;
      sun.shadow.bias = -0.0008;
      g.add(sun, sun.target);
      const ceilLight = new THREE.PointLight(0xffffff, 6, 8, 2);
      ceilLight.position.set(W / 2, H - 0.2, D * 0.6);
      g.add(ceilLight);
    } else {
      scene.background = new THREE.Color(0x0d1426);
      renderer.toneMappingExposure = 1.15;
      g.add(new THREE.AmbientLight(0xffd6a8, 0.18));
      g.add(new THREE.HemisphereLight(0x33405e, 0x2a1d10, 0.25));
      // 置いたフロアライトが光る(重くならないように6個まで)
      const lamps = app.furniture().filter(f => f.type === 'lamp').slice(0, 6);
      for (const f of lamps) {
        const l = new THREE.PointLight(0xffb76b, 4, 6, 1.4);
        l.position.set(f.x * M, Math.max(0.3, f.h * M - 0.15), f.y * M); g.add(l);
      }
      if (!lamps.length && !view.ceil) {
        // フロアライトがないときは、間接照明(電球色)を部屋の角と床付近に
        const spots = [[0.3, 0.35, D * 0.55], [W - 0.3, 0.35, D - 0.4], [0.3, H - 0.25, D - 0.5], [W / 2, 0.4, D * 0.3]];
        for (const [x, y, z] of spots) {
          const l = new THREE.PointLight(0xffa860, 2.4, 4.5, 1.6);
          l.position.set(x, y, z); g.add(l);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd2a0 }));
          bulb.position.set(x, y, z); g.add(bulb);
        }
      }
      if (view.ceil) {
        // 天井の照明をつけたとき
        g.add(new THREE.HemisphereLight(0xfff1dc, 0x6b5a48, 0.9));
        const l = new THREE.PointLight(0xfff0d8, 9, 9, 1.6);
        l.position.set(W / 2, H - 0.25, D * 0.6); g.add(l);
      }
    }
    // 天井照明の見た目
    const lit = !view.night || view.ceil;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lit ? 0xfff4e0 : 0x221a10, emissiveIntensity: lit ? (view.night ? 1.2 : 0.6) : 0.3 }));
    lamp.position.set(W / 2, H - 0.04, D * 0.6);
    g.add(lamp);
    return g;
  }

  function rebuild() {
    for (const grp of [roomGroup, furnGroup, lightGroup]) if (grp) { scene.remove(grp); dispose(grp); }
    roomGroup = buildRoom();
    furnGroup = new THREE.Group();
    for (const f of app.furniture()) furnGroup.add(buildFurniture(f));
    lightGroup = buildLights();
    scene.add(roomGroup, furnGroup, lightGroup);
    dirty = false;
  }

  function dispose(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
    });
  }

  // ---------- 操作 ----------
  // 歩くモード: 1本指ドラッグで見回す、2本指ピンチで前後に進む
  // 俯瞰モード: 1本指ドラッグで回転、2本指ピンチで拡大縮小・2本指ドラッグで移動(PCは右ドラッグ/Shift+ドラッグで移動、ホイールで拡大縮小)
  const dom = renderer.domElement;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pts = new Map();
  let gesture = null, tap = null;
  function newGesture(e) {
    const list = [...pts.values()];
    if (list.length >= 2) {
      const [a, b] = list;
      return { kind: 'two', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    }
    return { kind: e && (e.button === 2 || e.shiftKey) ? 'pan' : 'one' };
  }
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    dom.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    gesture = newGesture(e);
    tap = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  dom.addEventListener('pointermove', e => {
    const prev = pts.get(e.pointerId);
    if (!prev || !gesture) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
    if (gesture.kind === 'two') {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (camMode === 'orbit') {
        orbit.dist = clamp(orbit.dist * gesture.dist / Math.max(dist, 1), 1.5, 30);
        panBy(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
      } else {
        moveForward((dist - gesture.dist) * 0.012);
      }
      gesture.dist = dist; gesture.mid = mid;
      return;
    }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    if (camMode === 'orbit') {
      if (gesture.kind === 'pan') panBy(dx, dy);
      else { orbit.theta -= dx * 0.008; orbit.phi = clamp(orbit.phi - dy * 0.006, 0.02, 1.5); }
    } else {
      const sens = e.pointerType === 'mouse' ? 0.005 : 0.006;
      cam.yaw += dx * sens;
      cam.pitch = clamp(cam.pitch + dy * sens, -1.3, 1.3);
    }
  });
  const endPointer = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (tap && e.type === 'pointerup' && performance.now() - tap.t < 400) pick(e.clientX, e.clientY);
    tap = null;
    gesture = pts.size ? newGesture(null) : null;
  };
  dom.addEventListener('pointerup', endPointer);
  dom.addEventListener('pointercancel', endPointer);
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    const k = e.deltaY > 0 ? 1 : -1;
    if (camMode === 'orbit') orbit.dist = clamp(orbit.dist * (k > 0 ? 1.1 : 1 / 1.1), 1.5, 30);
    else moveForward(-k * 0.25);
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,select,textarea')) return;
    keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  function moveForward(m) {
    cam.x += -Math.sin(cam.yaw) * m;
    cam.z += -Math.cos(cam.yaw) * m;
  }
  function panBy(dx, dy) {
    const k = orbit.dist * 0.0016;
    const rx = Math.cos(orbit.theta), rz = -Math.sin(orbit.theta);   // 画面の右方向(床の上)
    const fx = -Math.sin(orbit.theta), fz = -Math.cos(orbit.theta);  // 画面の奥方向(床の上)
    const { room } = app.state;
    orbit.tx = clamp(orbit.tx - rx * dx * k + fx * dy * k, -1, room.w * M + 1);
    orbit.tz = clamp(orbit.tz - rz * dx * k + fz * dy * k, -1, room.d * M + 1);
  }

  // 3Dで家具をタップしたら、その家具を選ぶ
  const ray = new THREE.Raycaster();
  function pick(clientX, clientY) {
    if (!furnGroup) return;
    const r = dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObjects(furnGroup.children, true)[0];
    let o = hit && hit.object;
    while (o && !o.userData.id) o = o.parent;
    app.pick3d?.(o ? o.userData.id : null);
  }

  function setupJoystick(el) {
    const knob = el.querySelector('.knob');
    let id = null, cx = 0, cy = 0;
    const R = 45;
    el.addEventListener('pointerdown', e => {
      id = e.pointerId; el.setPointerCapture(id);
      const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e);
    });
    const move = e => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / R; joy.y = dy / R;
    };
    el.addEventListener('pointermove', move);
    const end = e => { if (e.pointerId !== id) return; id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function step(dt) {
    const { room } = app.state;
    if (camMode === 'orbit') {
      if (keys['arrowleft']) orbit.theta += 1.5 * dt;
      if (keys['arrowright']) orbit.theta -= 1.5 * dt;
      if (keys['arrowup']) orbit.phi = clamp(orbit.phi - 1.2 * dt, 0.02, 1.5);
      if (keys['arrowdown']) orbit.phi = clamp(orbit.phi + 1.2 * dt, 0.02, 1.5);
      const px = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0), py = (keys['s'] ? 1 : 0) - (keys['w'] ? 1 : 0);
      if (px || py) panBy(-px * 400 * dt, -py * 400 * dt);
      return;
    }
    let fw = 0, st = 0;
    if (keys['w'] || keys['arrowup']) fw += 1;
    if (keys['s'] || keys['arrowdown']) fw -= 1;
    if (keys['a']) st -= 1;
    if (keys['d']) st += 1;
    if (keys['arrowleft']) cam.yaw += 1.8 * dt;
    if (keys['arrowright']) cam.yaw -= 1.8 * dt;
    fw += -joy.y; st += joy.x;
    const speed = 1.3; // m/秒
    if (fw || st) {
      const sx = -Math.sin(cam.yaw), sz = -Math.cos(cam.yaw);
      const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
      cam.x += (sx * fw + rx * st) * speed * dt;
      cam.z += (sz * fw + rz * st) * speed * dt;
    }
    const m = 0.15;
    cam.x = clamp(cam.x, m, room.w * M - m);
    cam.z = clamp(cam.z, m, room.d * M - m);
  }

  function placeCamera() {
    const { room } = app.state;
    const W = room.w * M, D = room.d * M;
    const orb = camMode === 'orbit';
    if (orb) {
      const sp = Math.sin(orbit.phi), ty = 0.5;
      camera.position.set(orbit.tx + orbit.dist * sp * Math.sin(orbit.theta), ty + orbit.dist * Math.cos(orbit.phi), orbit.tz + orbit.dist * sp * Math.cos(orbit.theta));
      camera.up.set(0, 1, 0);
      camera.lookAt(orbit.tx, ty, orbit.tz);
    } else {
      camera.position.set(cam.x, (cam.eye ?? app.state.view.eye) * M, cam.z);
      camera.rotation.set(cam.pitch, cam.yaw, 0);
    }
    // 俯瞰のときは天井と、カメラ側の壁を消して中をのぞけるようにする(ドールハウスみたいに)
    const p = camera.position;
    if (ceilMesh) ceilMesh.visible = !orb;
    if (sceneryGroup) sceneryGroup.visible = !orb;
    if (wallGroups.entrance) {
      wallGroups.entrance.visible = !orb || p.z > 0;
      wallGroups.balcony.visible = !orb || p.z < D;
      wallGroups.left.visible = !orb || p.x > 0;
      wallGroups.right.visible = !orb || p.x < W;
    }
  }

  function loop(t) {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    if (dirty) rebuild();
    step(dt);
    placeCamera();
    renderer.render(scene, camera);
  }

  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    dom.style.width = '100%'; dom.style.height = '100%';
    camera.aspect = r.width / r.height;
    updateFov();
  }
  // 歩くときは広角(部屋が広く見える)、俯瞰のときは望遠ぎみ(ゆがみが少ない)
  function updateFov() {
    const narrow = camera.aspect < 0.8;
    camera.fov = camMode === 'orbit' ? (narrow ? 50 : 40) : (narrow ? 80 : 65);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function setCamMode(m) {
    camMode = m;
    container.classList.toggle('orbit', m === 'orbit');
    updateFov();
  }

  // 視点プリセット。dir は平面図上で見る方向(dx,dy)
  function lookFrom(xcm, ycm, dx, dy, eye = null, pitch = -0.08) {
    setCamMode('walk');
    cam.x = xcm * M; cam.z = ycm * M;
    cam.yaw = Math.atan2(-dx, -dy);
    cam.pitch = pitch;
    cam.eye = eye;
  }
  function frontDir(f) {
    const t = f.rot * Math.PI / 180;
    return [-Math.sin(t), Math.cos(t)];
  }
  function preset(name) {
    const { room } = app.state;
    const ent = room.fixtures.find(f => f.kind === 'entrance');
    const list = app.furniture();
    if (name === 'orbit' || name === 'top') {
      // 部屋全体が画面に収まる距離
      setCamMode('orbit');
      const W = room.w * M, D = room.d * M;
      const aspect = camera.aspect || 0.6;
      const vfov = (camera.fov || 70) * Math.PI / 180;
      const need = Math.max(D, W / Math.max(aspect, 0.3)) / 2 / Math.tan(vfov / 2);
      Object.assign(orbit, { tx: W / 2, tz: D / 2 + (name === 'top' ? 0 : 0.3), dist: clamp(need * (name === 'top' ? 1.1 : 1.05), 2, 30),
        theta: name === 'top' ? 0 : 0.35, phi: name === 'top' ? 0.02 : 0.62 });
      setCamMode('orbit');
    } else if (name === 'entrance') {
      const x = ent ? ent.x + ent.w / 2 : room.w / 2, y = ent ? ent.y + ent.d * 0.6 : 40;
      lookFrom(x, y, 0, 1);
    } else if (name === 'window') {
      lookFrom(room.w / 2, room.d - 30, 0, -1);
    } else if (name === 'bed' || name === 'sofa') {
      const f = list.find(i => name === 'sofa' ? (i.type === 'sofa' || i.type === 'sofa1') : i.type === 'bed');
      if (!f) return `${name === 'bed' ? 'ベッド' : 'ソファ'}がまだ置かれていないよ`;
      const [dx, dy] = frontDir(f);
      if (name === 'sofa') {
        const back = f.d * 0.1;
        lookFrom(f.x - dx * back, f.y - dy * back, dx, dy, (f.seat || 41) + 75, -0.12);
      } else {
        // ベッドの横(長辺)に腰かけて、部屋側を見る
        const t = f.rot * Math.PI / 180;
        const side = [Math.cos(t), Math.sin(t)]; // 家具のローカル+x方向
        const cx = room.w / 2, cy = room.d / 2;
        const sgn = ((cx - f.x) * side[0] + (cy - f.y) * side[1]) >= 0 ? 1 : -1;
        const off = f.w / 2 - 15;
        lookFrom(f.x + side[0] * off * sgn, f.y + side[1] * off * sgn, side[0] * sgn, side[1] * sgn, f.h + 75, -0.15);
      }
    }
    return null;
  }

  return {
    start() { if (running) return; running = true; resize(); last = performance.now(); requestAnimationFrame(loop); },
    stop() { running = false; for (const k in keys) keys[k] = false; },
    markDirty() { dirty = true; },
    resetEye() { cam.eye = null; },
    get camMode() { return camMode; },
    preset, setupJoystick, resize,
    snapshot() { if (dirty) rebuild(); placeCamera(); renderer.render(scene, camera); return dom.toDataURL('image/png'); },
  };
}
