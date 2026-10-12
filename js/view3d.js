// 部屋の中を歩いて見る(3D)。Three.js を使う
// 単位: 1 = 1m（データの cm を 100 で割って使う）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { floorStyle, wallStyle, autoFinish } from './data.js';
import { floorTexture, wallTexture, finishTexture, projectUV, photoTexture, abstractArt } from './textures.js';

const M = 0.01;

export function create3D(container, app) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const small = Math.min(screen.width, screen.height) < 600;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // まわりの景色の映り込み(つやのある床や家具が本物っぽく見える)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.rotation.order = 'YXZ';
  const cam = { x: 1.55, z: 0.6, yaw: Math.PI, pitch: -0.05 };
  // 俯瞰(ふかん)モード用: 注目点のまわりを回るカメラ。theta=水平の角度、phi=真上からの傾き
  const orbit = { tx: 1.5, tz: 4, dist: 9, theta: 0.5, phi: 0.9 };
  let camMode = 'walk'; // 'walk' = 歩く / 'orbit' = 俯瞰

  let roomGroup = null, furnGroup = null, lightGroup = null, selGroup = null;
  let wallGroups = {}, ceilMesh = null, sceneryGroup = null;
  let dirty = true, running = false, last = 0, selShown = null;
  const keys = {};
  const joy = { x: 0, y: 0 };

  // ---------- 形と素材の部品 ----------
  let envI = 0.55; // 映り込みの強さ(夜は弱く)
  const mat = (color, opt = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, envMapIntensity: envI, ...opt });
  function add(mesh, x, y, z, parent) {
    // 模様つきの素材は、実物の大きさに合わせて模様を貼る
    const rep = mesh.material && mesh.material.userData && mesh.material.userData.rep;
    if (rep) projectUV(mesh.geometry, rep);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  const pos = v => Math.max(v, 0.002);
  function box(w, h, d, material, x, y, z, parent) {
    return add(new THREE.Mesh(new THREE.BoxGeometry(pos(w), pos(h), pos(d)), material), x, y, z, parent);
  }
  // 角が丸い箱(クッションやマットレスに)
  function rbox(w, h, d, r, material, x, y, z, parent) {
    w = pos(w); h = pos(h); d = pos(d);
    const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    return add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), material), x, y, z, parent);
  }
  function cyl(r, h, material, x, y, z, parent, rTop = r, seg = 32) {
    return add(new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, pos(h), seg), material), x, y, z, parent);
  }

  // 家具の素材(木目・布・大理石など)。色は家具の色
  function finishMat(color, finish, extra = {}) {
    const tex = k => { const t = finishTexture(k); return { map: t.map, rep: t.size }; };
    let m;
    switch (finish) {
      case 'wood': { const t = tex('wood'); m = mat(color, { map: t.map, roughness: 0.55, ...extra }); m.userData.rep = t.rep; break; }
      case 'fabric': { const t = tex('fabric'); m = mat(color, { map: t.map, roughness: 0.95, ...extra }); m.userData.rep = t.rep; break; }
      case 'boucle': { const t = tex('boucle'); m = mat(color, { map: t.map, roughness: 1, ...extra }); m.userData.rep = t.rep; break; }
      case 'leather': { const t = tex('leather'); m = mat(color, { map: t.map, roughness: 0.42, ...extra }); m.userData.rep = t.rep; break; }
      case 'marble': { const t = tex('marble'); m = mat(color, { map: t.map, roughness: 0.18, ...extra }); m.userData.rep = t.rep; break; }
      case 'metal': m = mat(color, { metalness: 0.75, roughness: 0.32, ...extra }); break;
      default: m = mat(color, { roughness: 0.45, ...extra });
    }
    return m;
  }
  const fabricMat = (color, extra) => finishMat(color, 'fabric', extra);

  // ---------- 部屋 ----------
  function buildRoom() {
    const { room, view } = app.state;
    const W = room.w * M, D = room.d * M, H = room.h * M, T = 0.12;
    const g = new THREE.Group();
    const fl = floorStyle(view);
    const wallColor = wallStyle(view);

    // 床
    const ft = floorTexture(fl);
    const floorRough = { marble: 0.12, tile: 0.22, terrazzo: 0.3, stone: 0.7, mortar: 0.75, herring: 0.45, wood: 0.45 }[fl.kind] ?? 0.5;
    const floorMat = mat(0xffffff, { map: ft.map, roughness: floorRough, envMapIntensity: envI * (fl.kind === 'marble' || fl.kind === 'tile' ? 1.6 : 1) });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, D / 2); floor.receiveShadow = true;
    // 模様の大きさを実物に合わせる(床の左上から貼る)
    const uv = floor.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / ft.size, uv.getY(i) * D / ft.size);
    g.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(0xfbfbf8, { roughness: 1, emissive: 0xffffff, emissiveIntensity: view.night ? (view.ceil ? 0.12 : 0.03) : 0.25 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(W / 2, H, D / 2);
    g.add(ceil);
    ceilMesh = ceil;

    const wallMat = mat(wallColor, { map: wallTexture(view.wallFinish || 'plain'), roughness: view.wallFinish === 'panel' ? 0.6 : 0.95 });
    // 壁ごとにグループを分ける(俯瞰のとき、手前の壁だけ消して中が見えるように)
    wallGroups = {};
    for (const n of ['entrance', 'balcony', 'left', 'right']) { wallGroups[n] = new THREE.Group(); g.add(wallGroups[n]); }
    const wg = wallGroups;
    // 壁の模様は「部屋の中での位置」で貼るので、窓で区切っても模様がつながる
    const wallBox = (w, h, d, x, y, z, parent) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pos(w), pos(h), pos(d)), wallMat);
      projectUV(m.geometry, 1, [x, y, z]);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    // 壁ごとに、窓・ドアの穴をあけて箱で組み立てる
    const walls = {
      entrance: { len: W, place: (a, b, y0, y1) => wallBox(b - a, y1 - y0, T, (a + b) / 2, (y0 + y1) / 2, -T / 2, wg.entrance) },
      balcony: { len: W, place: (a, b, y0, y1) => wallBox(b - a, y1 - y0, T, (a + b) / 2, (y0 + y1) / 2, D + T / 2, wg.balcony) },
      left: { len: D, place: (a, b, y0, y1) => wallBox(T, y1 - y0, b - a, -T / 2, (y0 + y1) / 2, (a + b) / 2, wg.left) },
      right: { len: D, place: (a, b, y0, y1) => wallBox(T, y1 - y0, b - a, W + T / 2, (y0 + y1) / 2, (a + b) / 2, wg.right) },
    };
    const frameMat = mat(0xd0d3d6, { metalness: 0.5, roughness: 0.35 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdfefff, transparent: true, opacity: 0.16, roughness: 0.03, metalness: 0, depthWrite: false, envMapIntensity: envI });
    for (const [name, wdef] of Object.entries(walls)) {
      const ops = room.openings.filter(o => o.wall === name)
        .map(o => ({ ...o, a: Math.max(0, o.start * M), b: Math.min(wdef.len, (o.start + o.width) * M), y0: o.sill * M, y1: Math.min(H, (o.sill + o.height) * M) }))
        .filter(o => o.b > o.a)
        .sort((p, q) => p.a - q.a);
      let cur = 0;
      for (const o of ops) {
        if (o.a > cur) wdef.place(cur, o.a, 0, H);
        if (o.y0 > 0) wdef.place(o.a, o.b, 0, o.y0);
        if (o.y1 < H) wdef.place(o.a, o.b, o.y1, H);
        cur = Math.max(cur, o.b);
        addOpening(wg[name], name, o, W, D, T, H, frameMat, glassMat);
      }
      if (cur < wdef.len) wdef.place(cur, wdef.len, 0, H);
    }
    // 幅木(壁の下の細い板)と、天井のまわり縁
    const skirt = mat(0xf2f0ec, { roughness: 0.5 });
    box(W, 0.06, 0.012, skirt, W / 2, 0.03, 0.006, wg.entrance);
    box(W, 0.06, 0.012, skirt, W / 2, 0.03, D - 0.006, wg.balcony);
    box(0.012, 0.06, D, skirt, 0.006, 0.03, D / 2, wg.left);
    box(0.012, 0.06, D, skirt, W - 0.006, 0.03, D / 2, wg.right);

    for (const fx of room.fixtures) buildFixture(g, fx, H);

    // ベランダと外の景色
    const bal = room.balcony * M;
    box(W, 0.1, bal, mat(0xb9bcc0), W / 2, -0.15, D + T + bal / 2, g);
    const rail = mat(0x2f4f8f, { metalness: 0.5, roughness: 0.4 });
    box(W, 0.05, 0.05, rail, W / 2, 1.0, D + T + bal, g);
    for (let x = 0; x <= W; x += 0.5) box(0.03, 1.0, 0.03, rail, x, 0.5, D + T + bal, g);
    // 外の景色(俯瞰のときは邪魔になるので隠す)
    sceneryGroup = new THREE.Group(); g.add(sceneryGroup);
    box(6, 7, 4, mat(0xd8d8d2), W / 2 - 2, 2, D + 6, sceneryGroup);
    box(5, 10, 4, mat(0xc9ccd0), W / 2 + 4.5, 3, D + 9, sceneryGroup);
    box(4, 5, 5, mat(0xe2dccf), -4, 1.5, D + 5, sceneryGroup);
    const tree = mat(0x5f8f4e, { roughness: 1 });
    const t1 = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), tree); t1.position.set(-1.6, 1.5, D * 0.7); sceneryGroup.add(t1);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat(view.night ? 0x1c2119 : 0x9aa08f, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, -3, D / 2); g.add(ground);
    return g;
  }

  // ひだのあるカーテン1枚(幅 w、高さ h)。ローカルでは XY 平面、+z が部屋側
  function drape(w, h, color, sheer) {
    const folds = Math.max(2, Math.round(w / 0.11));
    const geo = new THREE.PlaneGeometry(pos(w), pos(h), folds * 6, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w + 0.5) * folds * Math.PI * 2) * (sheer ? 0.012 : 0.022));
    geo.computeVertexNormals();
    const m = sheer
      ? mat(0xffffff, { transparent: true, opacity: 0.42, roughness: 1, side: THREE.DoubleSide, depthWrite: false })
      : fabricMat(color, { side: THREE.DoubleSide });
    if (!sheer) projectUV(geo, finishTexture('fabric').size);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = !sheer; mesh.receiveShadow = true;
    return mesh;
  }

  function addOpening(g, wall, o, W, D, T, H, frameMat, glassMat) {
    const len = o.b - o.a, hgt = o.y1 - o.y0, cy = (o.y0 + o.y1) / 2, ca = (o.a + o.b) / 2;
    const horiz = wall === 'entrance' || wall === 'balcony';
    const at = wall === 'entrance' ? -T / 2 : wall === 'balcony' ? D + T / 2 : wall === 'left' ? -T / 2 : W + T / 2;
    const put = (w, h, t, a, y, off = 0) => horiz ? box(w, h, t, frameMat, a, y, at + off, g) : box(t, h, w, frameMat, at + off, y, a, g);
    if (o.kind === 'door') {
      const door = mat(0xcfc6b8, { roughness: 0.5 });
      if (horiz) box(len, hgt, 0.04, door, ca, cy, at, g); else box(0.04, hgt, len, door, at, cy, ca, g);
      const knob = mat(0xaaaaaa, { metalness: 0.9, roughness: 0.25 });
      const kz = wall === 'entrance' ? 0.04 : -0.04;
      if (horiz) box(0.12, 0.025, 0.05, knob, o.b - 0.12, 1.0, at + kz, g);
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
    // カーテンレールとカーテン(夜は閉める)
    const inward = wall === 'balcony' || wall === 'right' ? -1 : 1;     // 部屋の内側の向き
    const wallPos = wall === 'balcony' ? D : wall === 'right' ? W : 0;
    const railY = Math.min(H - 0.03, o.y1 + 0.1);
    const dist = 0.1;
    const railM = mat(0xeeeeee);
    if (horiz) box(len + 0.3, 0.03, 0.05, railM, ca, railY, wallPos + inward * dist, g);
    else box(0.05, 0.03, len + 0.3, railM, wallPos + inward * dist, railY, ca, g);
    const bottom = o.y0 < 0.3 ? 0.01 : Math.max(0.01, o.y0 - 0.15);
    const ch = railY - 0.02 - bottom, cyc = bottom + ch / 2;
    const night = app.state.view.night;
    const color = app.state.view.curtain || '#e9e1d3';
    const place = (mesh, along, off) => {
      if (horiz) { mesh.position.set(along, cyc, wallPos + inward * off); if (inward < 0) mesh.rotation.y = Math.PI; }
      else { mesh.position.set(wallPos + inward * off, cyc, along); mesh.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2; }
      g.add(mesh);
    };
    place(drape(len + 0.2, ch, color, true), ca, dist - 0.03);
    const pw = night ? len / 2 + 0.12 : Math.max(0.22, len * 0.2);
    place(drape(pw, ch, color, false), o.a - 0.1 + pw / 2, dist);
    place(drape(pw, ch, color, false), o.b + 0.1 - pw / 2, dist);
  }

  function buildFixture(g, fx, H) {
    const x = fx.x * M, z = fx.y * M, w = fx.w * M, d = fx.d * M, h = Math.min(fx.h * M, H);
    const cx = x + w / 2, cz = z + d / 2;
    switch (fx.kind) {
      case 'entrance': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), finishMat(0x8a857d, 'marble', { roughness: 0.6 }));
        projectUV(m.geometry, 0.8);
        m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.004, cz); m.receiveShadow = true; g.add(m);
        break;
      }
      case 'kitchen': {
        const body = mat(0xf0ead8, { roughness: 0.4 });
        box(w, h - 0.04, d, body, cx, (h - 0.04) / 2, cz, g);
        box(w, 0.04, d, mat(0xc9ccd0, { metalness: 0.8, roughness: 0.25 }), cx, h - 0.02, cz, g);
        // 扉の線(部屋側 = -x 側)
        const seam = mat(0x8f8a80);
        for (let i = 1; i < Math.round(fx.d / 45); i++) box(0.004, h - 0.12, 0.004, seam, x - 0.001, (h - 0.04) / 2, z + d * i / Math.round(fx.d / 45), g);
        const sink = mat(0x9da1a6, { metalness: 0.85, roughness: 0.2 });
        box(w * 0.6, 0.012, d * 0.35, sink, cx, h + 0.001, z + d * 0.35, g);
        cyl(0.012, 0.25, sink, x + w * 0.85, h + 0.12, z + d * 0.35, g);
        box(0.16, 0.012, 0.012, sink, x + w * 0.78, h + 0.24, z + d * 0.35, g);
        const stove = mat(0x1d1d1f, { roughness: 0.15 });
        box(w * 0.7, 0.012, d * 0.36, stove, cx, h + 0.001, z + d * 0.78, g);
        const ring = mat(0x555555, { metalness: 0.6, roughness: 0.4 });
        for (const k of [-1, 1]) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 24), ring);
          r.rotation.x = Math.PI / 2; r.position.set(cx, h + 0.012, z + d * 0.78 + k * d * 0.09); g.add(r);
        }
        box(w * 0.6, 0.5, d, mat(0xf0ead8, { roughness: 0.4 }), x + w * 0.7, 1.9, cz, g); // 吊戸棚
        box(0.01, 0.6, d, mat(0xffffff, { roughness: 0.2 }), x + w - 0.005, h + 0.3, cz, g); // タイル壁
        break;
      }
      case 'closet': case 'storage': case 'washer': {
        const body = finishMat(fx.kind === 'closet' ? 0xf3ead2 : 0xefe9de, 'wood', { roughness: 0.5 });
        box(w, h, d, body, cx, h / 2, cz, g);
        // 扉の線(部屋側=+z 側)
        const seam = mat(0x9a9488);
        const n = Math.max(1, Math.round(fx.w / 50));
        for (let i = 1; i < n; i++) box(0.005, h * 0.95, 0.005, seam, x + (w * i) / n, h / 2, z + d + 0.003, g);
        const knob = mat(0xc9a14a, { metalness: 0.8, roughness: 0.3 });
        box(0.015, 0.14, 0.02, knob, cx - 0.03, Math.min(h * 0.55, 1.0), z + d + 0.01, g);
        box(0.015, 0.14, 0.02, knob, cx + 0.03, Math.min(h * 0.55, 1.0), z + d + 0.01, g);
        break;
      }
      case 'ub': {
        const m = mat(0xf4f1ea);
        box(w, h, 0.06, m, cx, h / 2, z + d - 0.03, g); // 部屋側の壁
        box(0.06, h, d, m, x + w - 0.03, h / 2, cz, g);
        box(0.02, 1.9, Math.min(0.7, d - 0.1), mat(0xe8e2d6, { roughness: 0.4 }), x + w + 0.01, 0.95, cz, g); // 扉(廊下側)
        break;
      }
      default:
        box(w, h || 0.02, d, mat(0xf4f2ee, { roughness: 0.8 }), cx, (h || 0.02) / 2, cz, g);
    }
  }

  // ---------- 家具 ----------
  function buildFurniture(f) {
    const g = new THREE.Group();
    const w = f.w * M, d = f.d * M, h = Math.max(0.005, f.h * M);
    const col = new THREE.Color(f.color);
    const fin = f.finish && f.finish !== 'auto' ? f.finish : autoFinish(f.type);
    const fm = finishMat(col, fin);
    const darker = finishMat(col.clone().multiplyScalar(0.72), fin);
    const metalLeg = mat(0x2b2b2d, { metalness: 0.7, roughness: 0.35 });
    const woodLeg = finishMat(0x8a6a4a, 'wood');
    const leg = fin === 'marble' || fin === 'metal' || fin === 'plain' ? metalLeg : woodLeg;
    const night = app.state.view.night;
    const white = fabricMat(0xf7f5f0);
    switch (f.type) {
      case 'sofa': case 'sofa1': {
        const legH = 0.08;
        const seat = (f.seat || 41) * M;
        const arm = Math.min(0.17, w * 0.15), back = Math.min(0.24, d * 0.28);
        rbox(w, seat - 0.12 - legH, d, 0.03, fm, 0, legH + (seat - 0.12 - legH) / 2, 0, g);           // 土台
        rbox(w, h - legH, back * 0.5, 0.04, fm, 0, legH + (h - legH) / 2, -d / 2 + back * 0.25, g);    // 背もたれの枠
        const n = f.type === 'sofa1' ? 1 : Math.max(1, Math.round((w - arm * 2) / 0.62));
        const cw = (w - arm * 2) / n;
        for (let i = 0; i < n; i++) {
          const cx = -w / 2 + arm + cw * (i + 0.5);
          rbox(cw - 0.012, 0.15, d - back - 0.02, 0.06, fm, cx, seat - 0.075, back / 2 + 0.005, g);    // 座面クッション
          const bc = rbox(cw - 0.02, Math.max(0.1, (h - seat) * 0.92), 0.17, 0.07, fm, cx, seat + (h - seat) * 0.45, -d / 2 + back * 0.5 + 0.08, g);
          bc.rotation.x = -0.14;                                                                     // 背クッション
        }
        for (const s of [-1, 1]) rbox(arm, seat + 0.14 - legH, d, 0.06, fm, s * (w / 2 - arm / 2), legH + (seat + 0.14 - legH) / 2, 0, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.018, legH, leg, sx * (w / 2 - 0.07), legH / 2, sz * (d / 2 - 0.07), g, 0.022);
        if (n >= 2) {
          // 飾りクッション
          const p = rbox(0.4, 0.4, 0.13, 0.06, fabricMat(0xb9825c), -w / 2 + arm + 0.24, seat + 0.2, -d / 2 + back + 0.1, g);
          p.rotation.set(-0.3, 0.2, 0.12);
        }
        break;
      }
      case 'bed': {
        const legH = 0.06;
        const frameH = Math.max(0.14, h - 0.2);
        rbox(w, frameH - legH, d, 0.015, fm, 0, legH + (frameH - legH) / 2, 0, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, legH, 0.05, darker, sx * (w / 2 - 0.05), legH / 2, sz * (d / 2 - 0.05), g);
        rbox(w - 0.04, 0.2, d - 0.05, 0.05, white, 0, frameH + 0.1, 0.01, g);                                // マットレス
        rbox(w, Math.max(0.95, h + 0.4), 0.06, 0.02, fm, 0, Math.max(0.95, h + 0.4) / 2, -d / 2 + 0.03, g);  // ヘッドボード
        const duvet = fabricMat(0xebe6dd);
        const dl = d * 0.7, dz = d / 2 - dl / 2;
        rbox(w + 0.06, 0.07, dl, 0.035, duvet, 0, frameH + 0.23, dz, g);                                    // 掛け布団
        for (const s of [-1, 1]) rbox(0.03, 0.22, dl, 0.012, duvet, s * (w / 2 + 0.02), frameH + 0.12, dz, g); // 横にたれた部分
        rbox(w + 0.06, 0.06, 0.22, 0.03, duvet, 0, frameH + 0.27, d / 2 - dl + 0.08, g);                      // 折り返し
        rbox(w + 0.08, 0.03, 0.4, 0.015, fabricMat(0xb9a28c), 0, frameH + 0.28, d / 2 - 0.3, g);              // ベッドスロー
        const np = w > 1.15 ? 2 : 1, pw = (w - 0.12) / np;
        for (let i = 0; i < np; i++) {
          const p = rbox(pw - 0.04, 0.13, 0.38, 0.06, white, -w / 2 + 0.06 + pw * (i + 0.5), frameH + 0.27, -d / 2 + 0.3, g);
          p.rotation.x = -0.1;
        }
        break;
      }
      case 'tvstand': {
        const legH = fin === 'wood' ? 0.04 : 0.1;
        rbox(w, h - legH, d, 0.008, fm, 0, legH + (h - legH) / 2, 0, g);
        const groove = mat(0x222222, { roughness: 0.8 });
        const n = Math.max(2, Math.round(w / 0.6));
        for (let i = 1; i < n; i++) box(0.004, h - legH - 0.03, 0.004, groove, -w / 2 + w * i / n, legH + (h - legH) / 2, d / 2 + 0.001, g);
        box(w * 0.98, 0.004, 0.004, groove, 0, legH + (h - legH) * 0.62, d / 2 + 0.001, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03, legH, 0.03, metalLeg, sx * (w / 2 - 0.08), legH / 2, sz * (d / 2 - 0.06), g);
        const tvW = Math.min(w * 0.85, 1.25), tvH = tvW * 0.57;
        const black = mat(0x111113, { roughness: 0.3, metalness: 0.3 });
        box(0.32, 0.015, 0.2, black, 0, h + 0.0075, -0.02, g);
        box(0.06, 0.08, 0.03, black, 0, h + 0.05, -0.04, g);
        box(tvW, tvH, 0.03, black, 0, h + 0.08 + tvH / 2, -0.04, g);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(tvW * 0.97, tvH * 0.94), mat(0x0a0d12, { roughness: 0.12, metalness: 0.3, envMapIntensity: envI * 1.5 }));
        screen.position.set(0, h + 0.08 + tvH / 2, -0.024); g.add(screen);
        break;
      }
      case 'dresser': {
        const deskH = Math.min(h, 0.72);
        rbox(w, 0.03, d, 0.008, fm, 0, deskH - 0.015, 0, g);
        rbox(w, 0.14, d - 0.02, 0.006, fm, 0, deskH - 0.1, -0.01, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, deskH - 0.17, 0.035, darker, sx * (w / 2 - 0.03), (deskH - 0.17) / 2, sz * (d / 2 - 0.03), g);
        box(0.08, 0.012, 0.012, mat(0xc9a14a, { metalness: 0.8, roughness: 0.3 }), 0, deskH - 0.1, d / 2, g);
        if (h > deskH + 0.1) {
          const mh = h - deskH - 0.04;
          rbox(w, mh, 0.03, 0.01, fm, 0, deskH + 0.02 + mh / 2, -d / 2 + 0.02, g);
          const mirror = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, mh * 0.88), mat(0xe6eef4, { metalness: 1, roughness: 0.03, envMapIntensity: 1.2 }));
          mirror.position.set(0, deskH + 0.02 + mh / 2, -d / 2 + 0.036); g.add(mirror);
        }
        break;
      }
      case 'fridge': {
        const body = finishMat(col, fin === 'plain' ? 'plain' : fin, { roughness: 0.25 });
        rbox(w, h, d, 0.02, body, 0, h / 2, 0, g);
        box(w * 0.98, 0.005, 0.005, mat(0x777777), 0, h * 0.62, d / 2 + 0.001, g);
        const handle = mat(0xb0b0b0, { metalness: 0.9, roughness: 0.2 });
        box(0.02, 0.28, 0.03, handle, w / 2 - 0.06, h * 0.8, d / 2 + 0.015, g);
        box(0.02, 0.22, 0.03, handle, w / 2 - 0.06, h * 0.45, d / 2 + 0.015, g);
        break;
      }
      case 'lowtable': case 'desk': {
        const top = 0.03;
        rbox(w, top, d, 0.008, fm, 0, h - top / 2, 0, g);
        const lw = 0.04;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const l = box(lw, h - top, lw, leg === metalLeg ? metalLeg : darker, sx * (w / 2 - lw), (h - top) / 2, sz * (d / 2 - lw), g);
          if (f.type === 'lowtable') l.scale.set(0.8, 1, 0.8);
        }
        if (f.type === 'desk' && w > 0.8) rbox(0.4, 0.12, d - 0.06, 0.006, fm, w / 2 - 0.25, h - top - 0.06, 0, g); // 引き出し
        break;
      }
      case 'roundtable': {
        const r = w / 2, sz = d / Math.max(w, 0.01), top = 0.03;
        const t = cyl(r, top, fm, 0, h - top / 2, 0, g, r, 48); t.scale.z = sz;
        cyl(0.04, h - top, leg === metalLeg ? metalLeg : darker, 0, (h - top) / 2, 0, g, 0.035);
        const base = cyl(Math.min(r * 0.55, 0.22), 0.025, leg === metalLeg ? metalLeg : darker, 0, 0.0125, 0, g, Math.min(r * 0.5, 0.2)); base.scale.z = sz;
        break;
      }
      case 'stool': {
        const b = cyl(w / 2, h - 0.08, fm, 0, (h - 0.08) / 2, 0, g, w / 2 * 0.96, 40); b.scale.z = d / Math.max(w, 0.01);
        const c = rbox(w * 0.96, 0.1, d * 0.96, Math.min(w, d) * 0.45, fm, 0, h - 0.05, 0, g);
        c.scale.y = 1;
        break;
      }
      case 'chair': {
        const sh = Math.min(0.45, h);
        rbox(w, 0.05, d, 0.015, fm, 0, sh, 0, g);
        const back = rbox(w, Math.max(0.05, h - sh - 0.05), 0.03, 0.012, fm, 0, sh + (h - sh) / 2 + 0.02, -d / 2 + 0.02, g);
        back.rotation.x = -0.08;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.014, sh, darker, sx * (w / 2 - 0.04), sh / 2, sz * (d / 2 - 0.04), g, 0.016, 12);
        break;
      }
      case 'bookshelf': {
        const th = 0.018;
        box(th, h, d, fm, -w / 2 + th / 2, h / 2, 0, g);
        box(th, h, d, fm, w / 2 - th / 2, h / 2, 0, g);
        box(w, h, th, darker, 0, h / 2, -d / 2 + th / 2, g);
        const n = Math.max(2, Math.round(h / 0.35));
        const bookCols = [0x8e5b5b, 0x5b6f8e, 0xd9b55b, 0x6f8e5b, 0xeeeeee, 0xc9b6a0, 0x3d3a38];
        for (let i = 0; i <= n; i++) {
          const y = i * (h - th) / n + th / 2;
          box(w, th, d, fm, 0, y, 0, g);
          if (i < n) {
            let bx = -w / 2 + th + 0.01, k = 0;
            const end = w / 2 - th - 0.04 - (i % 2 ? w * 0.3 : 0);
            while (bx < end) {
              const bw = 0.02 + ((i * 7 + k * 13) % 5) * 0.006;
              const bh = (h / n) * (0.55 + ((i + k * 3) % 4) * 0.08);
              box(bw, bh, d * 0.7, mat(bookCols[(i * 3 + k) % bookCols.length], { roughness: 0.7 }), bx + bw / 2, y + th / 2 + bh / 2, 0.01, g);
              bx += bw + 0.003; k++;
            }
            if (i % 2) cyl(0.05, 0.12, mat(0xe8e2d6, { roughness: 0.3 }), w / 2 - th - 0.1, y + th / 2 + 0.06, 0, g, 0.04); // 花びん
          }
        }
        break;
      }
      case 'futon': {
        rbox(w, h, d, Math.min(h / 2.2, 0.05), fabricMat(col), 0, h / 2, 0, g);
        rbox(w * 0.55, 0.1, 0.32, 0.05, white, 0, h + 0.05, -d / 2 + 0.25, g);
        break;
      }
      case 'rug': case 'roundrug': {
        const m = f.photo ? mat(0xffffff, { map: photoTexture(f.photo), roughness: 1 }) : fabricMat(col, { roughness: 1 });
        let mesh;
        if (f.type === 'rug') mesh = rbox(w, 0.01, d, 0.004, m, 0, 0.005, 0, g);
        else { mesh = cyl(w / 2, 0.01, m, 0, 0.005, 0, g, w / 2, 64); mesh.scale.z = d / Math.max(w, 0.01); }
        if (f.photo) { // 写真は真上から1枚まるごと貼る
          const uv = mesh.geometry.attributes.uv, p = mesh.geometry.attributes.position;
          const sx = f.type === 'rug' ? w : w, sz = f.type === 'rug' ? d : w;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / sx + 0.5, -p.getZ(i) / sz + 0.5);
        }
        mesh.castShadow = false;
        break;
      }
      case 'plant': {
        const potH = Math.min(0.32, h * 0.28), potR = Math.min(w, d) * 0.3;
        cyl(potR * 0.8, potH, mat(0xe6dfd3, { roughness: 0.6 }), 0, potH / 2, 0, g, potR);
        cyl(potR * 0.92, 0.01, mat(0x4a3a2a, { roughness: 1 }), 0, potH - 0.01, 0, g);
        cyl(0.008, h * 0.6, mat(0x5d4a33, { roughness: 1 }), 0, potH + h * 0.25, 0, g, 0.005, 6);
        const leafCols = [col, col.clone().multiplyScalar(0.8), col.clone().lerp(new THREE.Color(0xb5d48f), 0.25)];
        const n = Math.max(14, Math.round(h * 22));
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996, t = i / n;
          const y = potH + (h - potH) * (0.25 + 0.72 * t);
          const r = Math.min(w, d) * (0.18 + 0.28 * Math.sin(t * Math.PI));
          const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
          const leafM = mat(leafCols[i % 3], { roughness: 0.7, side: THREE.DoubleSide });
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), leafM);
          const ls = Math.min(w, d) * (0.16 + (i % 4) * 0.03);
          leaf.scale.set(ls * 0.45, ls * 0.06, ls);
          leaf.position.set(lx, y, lz);
          leaf.rotation.set(-0.5 + (i % 5) * 0.12, -a + Math.PI / 2, 0.3);
          leaf.castShadow = true; g.add(leaf);
        }
        break;
      }
      case 'lamp': {
        const shadeH = Math.min(0.32, h * 0.22), r = Math.min(w, d) / 2;
        cyl(r * 0.7, 0.025, metalLeg, 0, 0.0125, 0, g, r * 0.65);
        cyl(0.011, h - shadeH, metalLeg, 0, (h - shadeH) / 2, 0, g);
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, shadeH, 40, 1, true),
          new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, emissive: night ? 0xffb25e : 0x000000, emissiveIntensity: night ? 1.0 : 0, roughness: 0.9, envMapIntensity: envI }));
        shade.position.y = h - shadeH / 2; g.add(shade);
        if (night) {
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe2b8 }));
          bulb.position.y = h - shadeH * 0.6; g.add(bulb);
        }
        break;
      }
      case 'mirror': {
        // 壁に立てかける姿見(背中側に少し倒す)
        const lean = new THREE.Group(); lean.rotation.x = -0.1; lean.position.z = d / 2 - 0.05; g.add(lean);
        rbox(w, h, 0.03, 0.012, fm, 0, h / 2, 0, lean);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.84, h * 0.92), mat(0xe6eef4, { metalness: 1, roughness: 0.03, envMapIntensity: 1.2 }));
        glass.position.set(0, h / 2, 0.016); lean.add(glass);
        break;
      }
      case 'washer': {
        rbox(w, h, d, 0.03, mat(col, { roughness: 0.3 }), 0, h / 2, 0, g);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.32, 0.012, 40), mat(0x9fb6c8, { roughness: 0.1, transparent: true, opacity: 0.85 }));
        lid.position.set(0, h + 0.006, 0.04); g.add(lid);
        box(w * 0.8, 0.02, 0.1, mat(0x333333, { roughness: 0.3 }), 0, h + 0.01, -d / 2 + 0.08, g);
        break;
      }
      case 'rack': {
        for (const y of [0.02, h * 0.4, h * 0.7, h - 0.02]) box(w, 0.025, d, fm, 0, y, 0, g);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(0.012, h, metalLeg, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), g);
        break;
      }
      case 'art': {
        // 壁掛けのアート。elev = 床から下の辺までの高さ
        const y0 = (f.elev || 110) * M;
        const frame = finishMat(col, fin === 'fabric' ? 'wood' : fin);
        rbox(w, h, Math.max(0.02, d), 0.004, frame, 0, y0 + h / 2, 0, g);
        const matte = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), mat(0xfbf9f5, { roughness: 0.9 }));
        matte.position.set(0, y0 + h / 2, Math.max(0.02, d) / 2 + 0.001); g.add(matte);
        const pic = new THREE.Mesh(new THREE.PlaneGeometry((w - 0.04) * 0.78, (h - 0.04) * 0.82),
          mat(0xffffff, { map: f.photo ? photoTexture(f.photo) : abstractArt(hashStr(f.id)), roughness: 0.8 }));
        pic.position.set(0, y0 + h / 2, Math.max(0.02, d) / 2 + 0.002); g.add(pic);
        break;
      }
      case 'curtain': {
        const c = drape(w, h - 0.02, f.color, false);
        c.position.set(0, h / 2, 0); g.add(c);
        box(w + 0.1, 0.03, 0.05, mat(0xeeeeee), 0, h, 0, g);
        break;
      }
      default:
        rbox(w, h, d, Math.min(0.01, h / 3), fm, 0, h / 2, 0, g);
    }
    g.position.set(f.x * M, 0, f.y * M);
    g.rotation.y = -f.rot * Math.PI / 180;
    g.userData.id = f.id;
    return g;
  }
  function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

  // 選んでいる家具の足元にピンクの枠
  function buildSelection() {
    const g = new THREE.Group();
    const f = app.selected();
    selShown = f ? JSON.stringify([f.id, f.x, f.y, f.w, f.d, f.rot]) : null;
    if (!f) return g;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => new THREE.Vector3(a * (f.w * M / 2 + 0.02), 0.012, b * (f.d * M / 2 + 0.02)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe05297 }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(f.w * M + 0.04, f.d * M + 0.04), new THREE.MeshBasicMaterial({ color: 0xe05297, transparent: true, opacity: 0.18, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.011;
    g.add(line, fill);
    g.position.set(f.x * M, 0, f.y * M);
    g.rotation.y = -f.rot * Math.PI / 180;
    return g;
  }
  function updateSelection() {
    const f = app.selected();
    const key = f ? JSON.stringify([f.id, f.x, f.y, f.w, f.d, f.rot]) : null;
    if (key === selShown && selGroup) return;
    if (selGroup) { scene.remove(selGroup); dispose(selGroup); }
    selGroup = buildSelection(); scene.add(selGroup);
  }

  // ---------- 照明 ----------
  function buildLights() {
    const { room, view } = app.state;
    const W = room.w * M, D = room.d * M, H = room.h * M;
    const g = new THREE.Group();
    if (!view.night) {
      scene.background = new THREE.Color(0xbcd8f0);
      renderer.toneMappingExposure = 0.92;
      g.add(new THREE.HemisphereLight(0xffffff, 0xb59c7c, 0.55));
      const sun = new THREE.DirectionalLight(0xfff1d8, 2.3);
      sun.position.set(W / 2 - 2, 6, D + 5);
      sun.target.position.set(W / 2, 0, D / 2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
      const sc = sun.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 25;
      sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
      g.add(sun, sun.target);
      const ceilLight = new THREE.PointLight(0xffffff, 2.5, 8, 2);
      ceilLight.position.set(W / 2, H - 0.2, D * 0.6);
      g.add(ceilLight);
    } else {
      scene.background = new THREE.Color(0x0d1426);
      renderer.toneMappingExposure = 1.1;
      g.add(new THREE.AmbientLight(0xffd6a8, 0.12));
      g.add(new THREE.HemisphereLight(0x33405e, 0x2a1d10, 0.2));
      // 置いたフロアライトが光る(重くならないように6個まで)
      const lamps = app.furniture().filter(f => f.type === 'lamp').slice(0, 6);
      for (const f of lamps) {
        const l = new THREE.PointLight(0xffb76b, 4.5, 6, 1.4);
        l.position.set(f.x * M, Math.max(0.3, f.h * M - 0.15), f.y * M); g.add(l);
      }
      if (!lamps.length && !view.ceil) {
        // フロアライトがないときは、間接照明(電球色)を部屋の角と床付近に
        const spots = [[0.3, 0.35, D * 0.55], [W - 0.3, 0.35, D - 0.4], [0.3, H - 0.25, D - 0.5], [W / 2, 0.4, D * 0.3]];
        for (const [x, y, z] of spots) {
          const l = new THREE.PointLight(0xffa860, 2.4, 4.5, 1.6);
          l.position.set(x, y, z); g.add(l);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd2a0 }));
          bulb.position.set(x, y, z); g.add(bulb);
        }
      }
      if (view.ceil) {
        // 天井の照明をつけたとき
        g.add(new THREE.HemisphereLight(0xfff1dc, 0x6b5a48, 0.35));
        const l = new THREE.PointLight(0xfff0d8, 7, 9, 1.6);
        l.position.set(W / 2, H - 0.25, D * 0.6); l.castShadow = !small;
        l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002;
        g.add(l);
      }
    }
    // 天井照明の見た目
    const lit = !view.night || view.ceil;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.07, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lit ? 0xfff4e0 : 0x221a10, emissiveIntensity: lit ? (view.night ? 1.3 : 0.6) : 0.3 }));
    lamp.position.set(W / 2, H - 0.035, D * 0.6);
    g.add(lamp);
    return g;
  }

  function rebuild() {
    envI = app.state.view.night ? (app.state.view.ceil ? 0.15 : 0.06) : 0.4;
    for (const grp of [roomGroup, furnGroup, lightGroup]) if (grp) { scene.remove(grp); dispose(grp); }
    roomGroup = buildRoom();
    furnGroup = new THREE.Group();
    for (const f of app.furniture()) furnGroup.add(buildFurniture(f));
    lightGroup = buildLights();
    scene.add(roomGroup, furnGroup, lightGroup);
    selShown = undefined;
    dirty = false;
  }

  // 形と素材の片付け(模様の画像は使い回すので消さない)
  function dispose(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
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
    updateSelection();
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
    snapshot() { if (dirty) rebuild(); updateSelection(); placeCamera(); renderer.render(scene, camera); return dom.toDataURL('image/png'); },
  };
}
