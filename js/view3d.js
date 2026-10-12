// 部屋の中を歩いて見る(3D)。Three.js を使う
// 単位: 1 = 1m（データの cm を 100 で割って使う）
import * as THREE from 'three';
import { FLOORS, WALL_COLORS } from './data.js';

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

  let roomGroup = null, furnGroup = null, lightGroup = null;
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
    const fl = FLOORS[view.floor] || FLOORS[0];
    const wallColor = (WALL_COLORS[view.wall] || WALL_COLORS[0]).color;

    const tex = woodTexture(fl);
    tex.repeat.set(W / 1.2, D / 1.2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xffffff, { map: tex, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, D / 2); floor.receiveShadow = true;
    g.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xfbfbf8, { roughness: 1, emissive: 0xffffff, emissiveIntensity: view.night ? 0.03 : 0.32 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(W / 2, H, D / 2);
    g.add(ceil);

    const wallMat = mat(wallColor, { roughness: 0.95 });
    // 壁ごとに、窓・ドアの穴をあけて箱で組み立てる
    const walls = {
      entrance: { len: W, place: (a, b, y0, y1) => box(b - a, y1 - y0, T, wallMat, (a + b) / 2, (y0 + y1) / 2, -T / 2, g) },
      balcony: { len: W, place: (a, b, y0, y1) => box(b - a, y1 - y0, T, wallMat, (a + b) / 2, (y0 + y1) / 2, D + T / 2, g) },
      left: { len: D, place: (a, b, y0, y1) => box(T, y1 - y0, b - a, wallMat, -T / 2, (y0 + y1) / 2, (a + b) / 2, g) },
      right: { len: D, place: (a, b, y0, y1) => box(T, y1 - y0, b - a, wallMat, W + T / 2, (y0 + y1) / 2, (a + b) / 2, g) },
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
        addOpening(g, name, o, W, D, T, frameMat, glassMat);
      }
      if (cur < wdef.len) wdef.place(cur, wdef.len, 0, H);
    }
    // 幅木
    const skirt = mat(0xf2f0ec);
    box(W, 0.06, 0.01, skirt, W / 2, 0.03, 0.005, g);
    box(W, 0.06, 0.01, skirt, W / 2, 0.03, D - 0.005, g);
    box(0.01, 0.06, D, skirt, 0.005, 0.03, D / 2, g);
    box(0.01, 0.06, D, skirt, W - 0.005, 0.03, D / 2, g);

    for (const fx of room.fixtures) buildFixture(g, fx, H);

    // ベランダと外の景色
    const bal = room.balcony * M;
    box(W, 0.1, bal, mat(0xb9bcc0), W / 2, -0.15, D + T + bal / 2, g);
    const rail = mat(0x2f4f8f, { metalness: 0.5, roughness: 0.4 });
    box(W, 0.05, 0.05, rail, W / 2, 1.0, D + T + bal, g);
    for (let x = 0; x <= W; x += 0.5) box(0.03, 1.0, 0.03, rail, x, 0.5, D + T + bal, g);
    const bmat = mat(0xd8d8d2);
    box(6, 7, 4, bmat, W / 2 - 2, 2, D + 6, g);
    box(5, 10, 4, mat(0xc9ccd0), W / 2 + 4.5, 3, D + 9, g);
    box(4, 5, 5, mat(0xe2dccf), -4, 1.5, D + 5, g);
    const tree = mat(0x5f8f4e, { roughness: 1 });
    const t1 = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), tree); t1.position.set(-1.6, 1.5, D * 0.7); g.add(t1);
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
    switch (f.type) {
      case 'sofa': {
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
    return g;
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
      // 間接照明(電球色)を部屋の角と床付近に
      const spots = [[0.3, 0.35, D * 0.55], [W - 0.3, 0.35, D - 0.4], [0.3, H - 0.25, D - 0.5], [W / 2, 0.4, D * 0.3]];
      for (const [x, y, z] of spots) {
        const l = new THREE.PointLight(0xffa860, 2.4, 4.5, 1.6);
        l.position.set(x, y, z); g.add(l);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd2a0 }));
        bulb.position.set(x, y, z); g.add(bulb);
      }
    }
    // 天井照明の見た目
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: view.night ? 0x221a10 : 0xffffff, emissiveIntensity: view.night ? 0.3 : 0.6 }));
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
  const dom = renderer.domElement;
  let look = null;
  dom.addEventListener('pointerdown', e => {
    dom.setPointerCapture(e.pointerId);
    look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  dom.addEventListener('pointermove', e => {
    if (!look || look.id !== e.pointerId) return;
    const sens = e.pointerType === 'mouse' ? 0.005 : 0.006;
    cam.yaw += (e.clientX - look.x) * sens;
    cam.pitch = Math.max(-1.3, Math.min(1.3, cam.pitch + (e.clientY - look.y) * sens));
    look.x = e.clientX; look.y = e.clientY;
  });
  const endLook = e => { if (look && look.id === e.pointerId) look = null; };
  dom.addEventListener('pointerup', endLook);
  dom.addEventListener('pointercancel', endLook);
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,select,textarea')) return;
    keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

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
    const { room } = app.state;
    const m = 0.15;
    cam.x = Math.max(m, Math.min(room.w * M - m, cam.x));
    cam.z = Math.max(m, Math.min(room.d * M - m, cam.z));
  }

  function loop(t) {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    if (dirty) rebuild();
    step(dt);
    camera.position.set(cam.x, (cam.eye ?? app.state.view.eye) * M, cam.z);
    camera.rotation.set(cam.pitch, cam.yaw, 0);
    renderer.render(scene, camera);
  }

  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    dom.style.width = '100%'; dom.style.height = '100%';
    camera.aspect = r.width / r.height;
    camera.fov = camera.aspect < 0.8 ? 80 : 65;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // 視点プリセット。dir は平面図上で見る方向(dx,dy)
  function lookFrom(xcm, ycm, dx, dy, eye = null, pitch = -0.08) {
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
    if (name === 'entrance') {
      const x = ent ? ent.x + ent.w / 2 : room.w / 2, y = ent ? ent.y + ent.d * 0.6 : 40;
      lookFrom(x, y, 0, 1);
    } else if (name === 'window') {
      lookFrom(room.w / 2, room.d - 30, 0, -1);
    } else if (name === 'bed' || name === 'sofa') {
      const f = list.find(i => i.type === name);
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
    stop() { running = false; },
    markDirty() { dirty = true; },
    resetEye() { cam.eye = null; },
    preset, setupJoystick, resize,
    snapshot() { if (dirty) rebuild(); renderer.render(scene, camera); return dom.toDataURL('image/png'); },
  };
}
