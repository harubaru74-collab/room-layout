// 上から見た図(2D)。canvas に描いて、指やマウスで家具を動かす
import { corners, pointInFurniture, analyze, bbox, rectPoly, isFlat, isWallHung } from './geom.js';
import { floorStyle, ROUND_TYPES } from './data.js';

const SNAP = 5;

export function create2D(canvas, app) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const view = { s: 1, ox: 0, oy: 0 }; // 画面px = cm * s + o
  const pointers = new Map();
  let drag = null;   // {mode:'move'|'rotate'|'pan'|'pinch'|'tool'|'img', ...}
  let fitted = false;
  // なぞり道具: null / {kind:'calib', pts:[]} / {kind:'roomRect'|'fxRect', a, b} / {kind:'moveImg'}
  let tool = null;

  const toCm = (sx, sy) => [(sx - view.ox) / view.s, (sy - view.oy) / view.s];

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!fitted) fit();
    render();
  }

  function fit() {
    const room = app.state.room;
    fitView(view, W, H, room, { pad: 46, top: 64, bottom: 64 });
    fitted = true;
    render();
  }

  function handlePos(f) {
    // 回転ハンドル: 家具の背中側(正面と反対)の少し外
    const t = f.rot * Math.PI / 180;
    const r = f.d / 2 + 26 / view.s;
    return [f.x + r * Math.sin(t), f.y - r * Math.cos(t)];
  }

  function hitFurniture(x, y) {
    const list = app.furniture();
    // 上に描かれたもの(後ろの要素)から。ラグは最後に判定して、上の家具を優先
    const solid = list.filter(f => !isFlat(f));
    for (let i = solid.length - 1; i >= 0; i--) if (pointInFurniture(solid[i], x, y)) return solid[i];
    const flat = list.filter(isFlat);
    for (let i = flat.length - 1; i >= 0; i--) if (pointInFurniture(flat[i], x, y)) return flat[i];
    return null;
  }

  function evtPos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  const snapCm = v => Math.round(v / SNAP) * SNAP;

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = evtPos(e);
    pointers.set(e.pointerId, [sx, sy]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (tool && tool.a) { tool.a = tool.b = null; } // 2本指になったらなぞりは取り消し
      drag = { mode: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: view.s, ox: view.ox, oy: view.oy };
      return;
    }
    const [x, y] = toCm(sx, sy);
    if (tool) {
      if (tool.kind === 'calib') {
        if (tool.pts.length >= 2) tool.pts = [];
        tool.pts.push([x, y]);
        render();
        if (tool.pts.length === 2) { const t = { ...tool, pts: [...tool.pts] }; setTimeout(() => app.onToolDone?.(t), 60); }
        drag = { mode: 'idle' };
      } else if (tool.kind === 'moveImg') {
        const u = app.state.underlay;
        drag = { mode: 'img', sx, sy, ux: u ? u.x : 0, uy: u ? u.y : 0 };
      } else {
        tool.a = [snapCm(x), snapCm(y)]; tool.b = null;
        drag = { mode: 'tool' };
      }
      return;
    }
    const near = (p, r = 22) => Math.hypot(p[0] - x, p[1] - y) * view.s < r;
    // 選んでいるものの「つまみ」(回転・大きさ)を先に調べる
    const sel = app.selected(), sfx = app.selectedFx(), sop = app.selectedOp();
    if (sel) {
      if (near(handlePos(sel))) { drag = { mode: 'rotate', f: sel }; return; }
      const cs = corners(sel);
      for (let i = 0; i < 4; i++) if (near(cs[i], 18)) { drag = { mode: 'resizeF', f: sel, anchor: cs[(i + 2) % 4] }; return; }
    }
    if (sfx) {
      const cs = fxCorners(sfx);
      for (let i = 0; i < 4; i++) if (near(cs[i], 18)) { drag = { mode: 'resizeFx', fx: sfx, anchor: cs[(i + 2) % 4] }; return; }
    }
    if (sop) {
      const [a, b] = opSeg(app.state.room, sop);
      if (near(a, 18)) { drag = { mode: 'resizeOp', o: sop, end: 0 }; return; }
      if (near(b, 18)) { drag = { mode: 'resizeOp', o: sop, end: 1 }; return; }
    }
    const f = hitFurniture(x, y);
    if (f) {
      app.select(f.id);
      drag = { mode: 'move', f, dx: x - f.x, dy: y - f.y, moved: false };
      return;
    }
    const o = hitOpening(x, y);
    if (o) { app.selectOp(o.id); drag = { mode: 'moveOp', o, sx, sy, moved: false }; return; }
    const fx = hitFixture(x, y);
    if (fx) { app.selectFx(fx.id); drag = { mode: 'moveFx', fx, dx: x - fx.x, dy: y - fx.y, sx, sy, moved: false }; return; }
    drag = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy, moved: false };
  });

  // 作り付け(左上の角と幅・奥行)の4つの角
  const fxCorners = fx => [[fx.x, fx.y], [fx.x + fx.w, fx.y], [fx.x + fx.w, fx.y + fx.d], [fx.x, fx.y + fx.d]];
  function hitFixture(x, y) {
    const list = app.state.room.fixtures;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.d) return f;
    }
    return null;
  }
  // 窓・ドアは壁の線の近く(指で押しやすいように少し広め)
  function hitOpening(x, y) {
    const room = app.state.room, tol = 16 / view.s;
    for (const o of room.openings) {
      const [[x1, y1], [x2, y2]] = opSeg(room, o);
      if (x >= Math.min(x1, x2) - tol && x <= Math.max(x1, x2) + tol && y >= Math.min(y1, y2) - tol && y <= Math.max(y1, y2) + tol) return o;
    }
    return null;
  }
  // 指の位置から、いちばん近い壁と、壁に沿った位置
  function nearestWall(x, y) {
    const room = app.state.room;
    const c = [['entrance', Math.abs(y), x, room.w], ['balcony', Math.abs(room.d - y), x, room.w], ['left', Math.abs(x), y, room.d], ['right', Math.abs(room.w - x), y, room.d]];
    c.sort((a, b) => a[1] - b[1]);
    return { wall: c[0][0], along: c[0][2], len: c[0][3] };
  }

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const [sx, sy] = evtPos(e);
    pointers.set(e.pointerId, [sx, sy]);
    if (!drag) return;
    if (drag.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const ns = Math.min(12, Math.max(0.1, drag.s * dist / drag.dist));
      // ピンチの中心を基準に拡大縮小＋移動
      const cx = (drag.mid[0] - drag.ox) / drag.s, cy = (drag.mid[1] - drag.oy) / drag.s;
      view.s = ns; view.ox = mid[0] - cx * ns; view.oy = mid[1] - cy * ns;
      render(); return;
    }
    const [x, y] = toCm(sx, sy);
    const room = app.state.room;
    if (drag.mode === 'resizeF') {
      // 反対側の角を動かさずに、指の位置まで大きさを変える(家具の向きに合わせて計算)
      const f = drag.f, t = f.rot * Math.PI / 180, c = Math.cos(t), s2 = Math.sin(t);
      const dx = x - drag.anchor[0], dy = y - drag.anchor[1];
      const lx = dx * c + dy * s2, ly = -dx * s2 + dy * c;
      f.w = Math.max(5, Math.round(Math.abs(lx) / SNAP) * SNAP);
      f.d = Math.max(f.type === 'art' || f.type === 'curtain' ? 1 : 5, Math.round(Math.abs(ly) / SNAP) * SNAP);
      const hx = Math.sign(lx || 1) * f.w / 2, hy = Math.sign(ly || 1) * f.d / 2;
      f.x = Math.round((drag.anchor[0] + hx * c - hy * s2) * 10) / 10;
      f.y = Math.round((drag.anchor[1] + hx * s2 + hy * c) * 10) / 10;
      app.changed({ light: true }); return;
    }
    if (drag.mode === 'resizeFx') {
      const fx = drag.fx, [ax, ay] = drag.anchor;
      let px = snapCm(x), py = snapCm(y);
      px = Math.max(0, Math.min(room.w, px)); py = Math.max(0, Math.min(room.d, py));
      fx.w = Math.max(5, Math.abs(px - ax)); fx.d = Math.max(5, Math.abs(py - ay));
      fx.x = px < ax ? ax - fx.w : ax; fx.y = py < ay ? ay - fx.d : ay;
      app.changed({ light: true }); return;
    }
    if (drag.mode === 'moveFx') {
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 6) return; // タップだけのときは動かさない
      drag.moved = true;
      const fx = drag.fx;
      fx.x = snapCm(x - drag.dx); fx.y = snapCm(y - drag.dy);
      // 壁の近くでは壁にぴったり
      if (Math.abs(fx.x) < 8) fx.x = 0; else if (Math.abs(room.w - fx.x - fx.w) < 8) fx.x = room.w - fx.w;
      if (Math.abs(fx.y) < 8) fx.y = 0; else if (Math.abs(room.d - fx.y - fx.d) < 8) fx.y = room.d - fx.d;
      app.changed({ light: true }); return;
    }
    if (drag.mode === 'moveOp') {
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 6) return;
      drag.moved = true;
      const o = drag.o, w = nearestWall(x, y);
      o.wall = w.wall;
      o.start = Math.max(0, Math.min(w.len - o.width, snapCm(w.along - o.width / 2)));
      app.changed({ light: true }); return;
    }
    if (drag.mode === 'resizeOp') {
      const o = drag.o, horiz = o.wall === 'entrance' || o.wall === 'balcony';
      const len = horiz ? room.w : room.d;
      const along = Math.max(0, Math.min(len, snapCm(horiz ? x : y)));
      const endPos = o.start + o.width;
      if (drag.end === 0) { const ns = Math.min(along, endPos - 10); o.width = endPos - ns; o.start = ns; }
      else o.width = Math.max(10, along - o.start);
      app.changed({ light: true }); return;
    }
    if (drag.mode === 'tool' && tool && tool.a) {
      tool.b = [snapCm(x), snapCm(y)];
      render();
    } else if (drag.mode === 'img') {
      const u = app.state.underlay;
      if (u) { u.x = drag.ux + (sx - drag.sx) / view.s; u.y = drag.uy + (sy - drag.sy) / view.s; render(); }
    } else if (drag.mode === 'move') {
      drag.f.x = Math.round((x - drag.dx) / SNAP) * SNAP;
      drag.f.y = Math.round((y - drag.dy) / SNAP) * SNAP;
      snapToWalls(drag.f);
      drag.moved = true;
      app.changed({ light: true });
    } else if (drag.mode === 'rotate') {
      let deg = Math.atan2(x - drag.f.x, -(y - drag.f.y)) * 180 / Math.PI;
      deg = (deg + 360) % 360;
      // 90度の倍数の近くでは吸い付く
      const near = Math.round(deg / 90) * 90;
      if (Math.abs(deg - near) < 4) deg = near % 360;
      drag.f.rot = Math.round(deg);
      app.changed({ light: true });
    } else if (drag.mode === 'pan') {
      view.ox = drag.ox + sx - drag.sx; view.oy = drag.oy + sy - drag.sy;
      if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 4) drag.moved = true;
      render();
    }
  });

  // 壁の近く(8cm以内)まで来たら、壁にぴったり寄せる
  function snapToWalls(f) {
    const { room } = app.state;
    const b = bbox(corners(f)), g = 8;
    if (Math.abs(b.minX) < g) f.x -= b.minX; else if (Math.abs(room.w - b.maxX) < g) f.x += room.w - b.maxX;
    if (Math.abs(b.minY) < g) f.y -= b.minY; else if (Math.abs(room.d - b.maxY) < g) f.y += room.d - b.maxY;
    f.x = Math.round(f.x * 10) / 10; f.y = Math.round(f.y * 10) / 10;
  }

  const end = e => {
    pointers.delete(e.pointerId);
    if (!drag) return;
    if (drag.mode === 'pan' && !drag.moved) app.select(null);
    if ((drag.mode === 'move' && drag.moved) || drag.mode === 'rotate') app.changed();
    if (['resizeF', 'resizeFx', 'resizeOp'].includes(drag.mode) || (['moveFx', 'moveOp'].includes(drag.mode) && drag.moved)) app.changed();
    if (drag.mode === 'img') app.changed();
    if (drag.mode === 'tool' && tool && tool.a && tool.b) {
      const [ax, ay] = tool.a, [bx, by] = tool.b;
      const rect = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
      if (rect.w >= 10 && rect.h >= 10) { const t = { kind: tool.kind, rect }; setTimeout(() => app.onToolDone?.(t), 30); }
      tool.a = tool.b = null;
      render();
    }
    drag = pointers.size ? { mode: 'idle' } : null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = evtPos(e);
    const [cx, cy] = toCm(sx, sy);
    view.s = Math.min(12, Math.max(0.1, view.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    view.ox = sx - cx * view.s; view.oy = sy - cy * view.s;
    render();
  }, { passive: false });

  function render() {
    if (!W) return;
    const res = paint(ctx, W, H, dpr, view, {
      room: app.state.room, furniture: app.furniture(), sel: app.selected(), selFx: app.selectedFx(), selOp: app.selectedOp(), vstate: app.state.view,
      underlay: app.state.underlay, underlayImg: app.underlayImg, tool, handlePos,
    });
    app.reportStatus(res.bad.size, res.narrow.length);
  }

  window.addEventListener('resize', resize);
  return {
    render, resize, fit, canvas, snapToWalls,
    setTool(t) { tool = t; render(); },
    _view: view, // 動作確認用
    get tool() { return tool; },
  };
}

// 窓・ドアの両はし(cm)
function opSeg(room, o) {
  return o.wall === 'entrance' ? [[o.start, 0], [o.start + o.width, 0]]
    : o.wall === 'balcony' ? [[o.start, room.d], [o.start + o.width, room.d]]
      : o.wall === 'left' ? [[0, o.start], [0, o.start + o.width]] : [[room.w, o.start], [room.w, o.start + o.width]];
}

// 部屋全体が収まるように拡大率と位置を決める
function fitView(view, W, H, room, { pad, top, bottom }) {
  const s = Math.min((W - pad * 2) / room.w, (H - top - bottom) / (room.d + room.balcony));
  view.s = Math.max(0.05, s);
  view.ox = (W - room.w * view.s) / 2;
  view.oy = top + (H - top - bottom - (room.d + room.balcony) * view.s) / 2;
}

// 比べる画面用の小さな図
export function drawThumb(canvas, room, furniture, vstate) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = r.width || canvas.width, H = r.height || canvas.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const view = { s: 1, ox: 0, oy: 0 };
  fitView(view, W, H, room, { pad: 14, top: 10, bottom: 4 });
  return paint(canvas.getContext('2d'), W, H, dpr, view, { room, furniture, sel: null, vstate, thumb: true });
}

// ---------- 描画(本体と比べる画面の両方で使う) ----------
function paint(ctx, W, H, dpr, view, data) {
  const { room, furniture, sel, vstate, thumb } = data;
  const s = view.s;
  const toPx = (x, y) => [x * s + view.ox, y * s + view.oy];
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const label = (text, x, y, { size = 11, color = '#333', bg = null, align = 'center', bold = false } = {}) => {
    ctx.font = `${bold ? '600 ' : ''}${size}px system-ui, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (bg) {
      const w = ctx.measureText(text).width + 6;
      const bx = align === 'center' ? x - w / 2 : align === 'left' ? x - 3 : x - w + 3;
      ctx.fillStyle = bg; ctx.fillRect(bx, y - size / 2 - 2, w, size + 4);
    }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  const poly = pts => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath();
  };
  // 寸法線(矢印つきの線＋数字)
  const dimLine = (x1, y1, x2, y2, text, color = '#2b6cb0') => {
    const [a, b] = toPx(x1, y1), [c, d] = toPx(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    line(a, b, c, d);
    const ang = Math.atan2(d - b, c - a);
    for (const [px, py, dir] of [[a, b, 1], [c, d, -1]]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + dir * 6 * Math.cos(ang - 0.4), py + dir * 6 * Math.sin(ang - 0.4));
      ctx.moveTo(px, py);
      ctx.lineTo(px + dir * 6 * Math.cos(ang + 0.4), py + dir * 6 * Math.sin(ang + 0.4));
      ctx.stroke();
    }
    label(text, (a + c) / 2, (b + d) / 2, { size: 11, color, bg: 'rgba(255,255,255,.9)' });
  };

  const { bad, narrow } = analyze(room, furniture);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f3f1ee'; ctx.fillRect(0, 0, W, H);

  // ベランダ
  const [bx, by] = toPx(0, room.d);
  ctx.fillStyle = '#e1e4e8'; ctx.fillRect(bx, by, room.w * s, room.balcony * s);
  if (!thumb) label('ベランダ(南)', bx + room.w * s / 2, by + room.balcony * s / 2, { size: 12, color: '#667' });

  // 床(素材ごとの模様)
  const fl = floorStyle(vstate);
  const [rx, ry] = toPx(0, 0);
  ctx.fillStyle = fl.base + '66'; ctx.fillRect(rx, ry, room.w * s, room.d * s);
  ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, room.w * s, room.d * s); ctx.clip();
  ctx.strokeStyle = fl.line + '38'; ctx.lineWidth = 1;
  if (fl.kind === 'herring') {
    for (let k = -room.d; k < room.w + room.d; k += 18) { const [a, b] = toPx(k, 0), [c, d] = toPx(k + room.d, room.d); line(a, b, c, d); }
  } else if (fl.tile) {
    for (let x = fl.tile; x < room.w; x += fl.tile) { const [px] = toPx(x, 0); line(px, ry, px, ry + room.d * s); }
    for (let y = fl.tile; y < room.d; y += fl.tile) { const [, py] = toPx(0, y); line(rx, py, rx + room.w * s, py); }
  } else if (fl.kind !== 'mortar') {
    for (let x = 15; x < room.w; x += 15) { const [px] = toPx(x, 0); line(px, ry, px, ry + room.d * s); }
  }
  ctx.restore();

  // 下に敷いた画像(間取り図・写真)
  const u = data.underlay, img = data.underlayImg;
  if (!thumb && u && u.show !== false && img && img.complete && img.naturalWidth) {
    const [ix, iy] = toPx(u.x, u.y);
    ctx.globalAlpha = u.opacity ?? 0.6;
    ctx.drawImage(img, ix, iy, img.naturalWidth * u.scale * s, img.naturalHeight * u.scale * s);
    ctx.globalAlpha = 1;
  }

  // 1mグリッド
  if (!thumb) {
    ctx.strokeStyle = 'rgba(60,90,140,.22)'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (let x = 100; x < room.w; x += 100) { const [px] = toPx(x, 0); line(px, ry, px, ry + room.d * s); }
    for (let y = 100; y < room.d; y += 100) { const [, py] = toPx(0, y); line(rx, py, rx + room.w * s, py); }
    ctx.setLineDash([]);
    for (let y = 100; y < room.d; y += 100) { const [, py] = toPx(0, y); label(`${y / 100}m`, rx - 6, py, { size: 9, color: '#89a', align: 'right' }); }
    for (let x = 100; x < room.w; x += 100) { const [px] = toPx(x, 0); label(`${x / 100}m`, px, ry - 8, { size: 9, color: '#89a' }); }
  }

  // 作り付け
  for (const fx of room.fixtures) {
    poly(rectPoly(fx));
    ctx.fillStyle = fx.kind === 'entrance' ? 'rgba(120,120,120,.28)' : 'rgba(150,155,165,.55)';
    ctx.fill();
    ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = 1; ctx.stroke();
    if (fx.kind !== 'entrance') { // 斜線
      ctx.save(); poly(rectPoly(fx)); ctx.clip();
      ctx.strokeStyle = 'rgba(80,85,95,.25)';
      const [x0, y0] = toPx(fx.x, fx.y);
      for (let k = -fx.d * s; k < fx.w * s; k += 8) line(x0 + k, y0 + fx.d * s, x0 + k + fx.d * s, y0);
      ctx.restore();
    }
    if (!thumb) {
      const [cx, cy] = toPx(fx.x + fx.w / 2, fx.y + fx.d / 2);
      label(fx.name, cx, cy, { size: 10, color: '#333', bg: 'rgba(255,255,255,.75)' });
    }
  }

  // 壁
  ctx.strokeStyle = '#333'; ctx.lineWidth = thumb ? 2.5 : 4;
  ctx.strokeRect(rx, ry, room.w * s, room.d * s);
  // 窓・ドア
  for (const o of room.openings) {
    const seg = opSeg(room, o);
    const [a, b] = toPx(...seg[0]), [c, d] = toPx(...seg[1]);
    ctx.lineWidth = thumb ? 4 : 6; ctx.strokeStyle = '#fff'; line(a, b, c, d);
    if (o.kind === 'window') {
      ctx.lineWidth = thumb ? 1.5 : 2; ctx.strokeStyle = '#3d8bd9';
      const k = thumb ? 2 : 3;
      const off = (o.wall === 'left' || o.wall === 'right') ? [k, 0] : [0, k];
      line(a - off[0], b - off[1], c - off[0], d - off[1]);
      line(a + off[0], b + off[1], c + off[0], d + off[1]);
    } else if (o.wall === 'entrance') {
      // ドアの開き(内開き想定の円弧)
      ctx.lineWidth = 1; ctx.strokeStyle = '#999';
      const r = o.width * s;
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a, b + r); ctx.arc(a, b, r, Math.PI / 2, 0, true); ctx.stroke();
    }
  }

  // 全体寸法
  if (!thumb) {
    dimLine(0, -26 / s, room.w, -26 / s, `${room.w}cm`, '#555');
    dimLine(room.w + 36 / s, 0, room.w + 36 / s, room.d, `${room.d}cm`, '#555');
  }

  // 家具(ラグを先に、壁掛けを最後に描く)
  const ordered = [...furniture.filter(isFlat), ...furniture.filter(f => !isFlat(f) && !isWallHung(f)), ...furniture.filter(isWallHung)];
  for (const f of ordered) {
    const pts = corners(f);
    const isBad = bad.has(f.id);
    const round = ROUND_TYPES.includes(f.type);
    const hung = isWallHung(f);
    const [cx, cy] = toPx(f.x, f.y);
    if (round) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, f.w / 2 * s, f.d / 2 * s, f.rot * Math.PI / 180, 0, Math.PI * 2);
    } else poly(pts);
    ctx.fillStyle = isBad ? 'rgba(229,62,62,.55)' : hexA(f.color, isFlat(f) ? 0.55 : hung ? 0.5 : 0.85);
    ctx.fill();
    ctx.lineWidth = f === sel ? 3 : thumb ? 1 : 1.5;
    ctx.strokeStyle = isBad ? '#c53030' : f === sel ? '#e05297' : '#444';
    if (isFlat(f) || hung) ctx.setLineDash([5, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    // 正面の印(太線)。丸いものは向きがないので描かない
    if (!round) {
      const [p2, p3] = [toPx(...pts[2]), toPx(...pts[3])];
      ctx.lineWidth = thumb ? 2 : 3; ctx.strokeStyle = isBad ? '#c53030' : 'rgba(0,0,0,.45)';
      line(p3[0], p3[1], p2[0], p2[1]);
    }
    if (thumb) continue;
    const dark = isDark(f.color) && !isBad;
    // 小さい家具は文字が家具からはみ出さないように小さく
    const small = Math.min(f.w, f.d) * s < 34;
    label(f.name, cx, cy - (small ? 0 : 6), { size: small ? 9 : 11, color: dark && !small ? '#fff' : '#222', bold: true, bg: small ? 'rgba(255,255,255,.7)' : null });
    if (!small) label(`${f.w}×${f.d}`, cx, cy + 8, { size: 9, color: dark ? '#eee' : '#444' });
  }

  // 狭い通路
  for (const g of narrow) {
    const [a, b] = toPx(...g.p), [c, d] = toPx(...g.q);
    ctx.strokeStyle = '#dd6b20'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    line(a, b, c, d); ctx.setLineDash([]);
    if (!thumb) label(`⚠${Math.round(g.dist)}cm`, (a + c) / 2, (b + d) / 2, { size: 11, color: '#fff', bg: '#dd6b20', bold: true });
  }

  // 選択中: 壁からの距離＋回転ハンドル
  if (sel && data.handlePos) {
    const b = bbox(corners(sel));
    const my = Math.max(0, Math.min(room.d, sel.y)), mx = Math.max(0, Math.min(room.w, sel.x));
    if (b.minX > 1) dimLine(0, my, b.minX, my, `${Math.round(b.minX)}`);
    if (room.w - b.maxX > 1) dimLine(b.maxX, my, room.w, my, `${Math.round(room.w - b.maxX)}`);
    if (b.minY > 1) dimLine(mx, 0, mx, b.minY, `${Math.round(b.minY)}`);
    if (room.d - b.maxY > 1) dimLine(mx, b.maxY, mx, room.d, `${Math.round(room.d - b.maxY)}`);
    const [hx, hy] = toPx(...data.handlePos(sel));
    const [cx, cy] = toPx(sel.x, sel.y);
    ctx.strokeStyle = '#e05297'; ctx.lineWidth = 1.5; line(cx, cy, hx, hy);
    ctx.fillStyle = '#e05297'; ctx.beginPath(); ctx.arc(hx, hy, 11, 0, Math.PI * 2); ctx.fill();
    label('⟳', hx, hy + 1, { size: 14, color: '#fff', bold: true });
    label(`${sel.rot}°`, hx + 16, hy, { size: 11, color: '#e05297', align: 'left', bold: true, bg: 'rgba(255,255,255,.85)' });
  }

  // 大きさを変える「つまみ」(白い四角)
  const grip = ([x, y]) => {
    const [px, py] = toPx(x, y);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e05297'; ctx.lineWidth = 2;
    ctx.fillRect(px - 7, py - 7, 14, 14); ctx.strokeRect(px - 7, py - 7, 14, 14);
  };
  if (sel && data.handlePos) corners(sel).forEach(grip);
  // 選んでいる作り付け
  const sfx = data.selFx;
  if (sfx) {
    const [x0, y0] = toPx(sfx.x, sfx.y);
    ctx.fillStyle = 'rgba(224,82,151,.15)'; ctx.fillRect(x0, y0, sfx.w * s, sfx.d * s);
    ctx.strokeStyle = '#e05297'; ctx.lineWidth = 3; ctx.strokeRect(x0, y0, sfx.w * s, sfx.d * s);
    label(`${sfx.w}×${sfx.d}cm`, x0 + sfx.w * s / 2, y0 + sfx.d * s / 2 + 14, { size: 11, color: '#fff', bg: '#e05297', bold: true });
    [[sfx.x, sfx.y], [sfx.x + sfx.w, sfx.y], [sfx.x + sfx.w, sfx.y + sfx.d], [sfx.x, sfx.y + sfx.d]].forEach(grip);
  }
  // 選んでいる窓・ドア
  const sop = data.selOp;
  if (sop) {
    const [p1, p2] = opSeg(room, sop);
    const [a, b] = toPx(...p1), [c, d] = toPx(...p2);
    ctx.strokeStyle = 'rgba(224,82,151,.85)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; line(a, b, c, d); ctx.lineCap = 'butt';
    label(`${sop.name} ${sop.width}cm`, (a + c) / 2, (b + d) / 2 + (sop.wall === 'balcony' ? -18 : 18), { size: 11, color: '#fff', bg: '#e05297', bold: true });
    grip(p1); grip(p2);
  }

  // なぞり道具の表示
  const tool = data.tool;
  if (tool) {
    ctx.strokeStyle = '#e05297'; ctx.lineWidth = 2;
    if (tool.kind === 'calib') {
      tool.pts.forEach(([x, y], i) => {
        const [px, py] = toPx(x, y);
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
        line(px - 12, py, px + 12, py); line(px, py - 12, px, py + 12);
        label(i ? 'B' : 'A', px + 14, py - 12, { size: 12, color: '#e05297', bold: true, bg: 'rgba(255,255,255,.9)' });
      });
      if (tool.pts.length === 2) { const [a, b] = toPx(...tool.pts[0]), [c, d] = toPx(...tool.pts[1]); ctx.setLineDash([6, 4]); line(a, b, c, d); ctx.setLineDash([]); }
    } else if (tool.a && tool.b) {
      const [a, b] = toPx(...tool.a), [c, d] = toPx(...tool.b);
      ctx.fillStyle = 'rgba(224,82,151,.15)';
      ctx.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
      ctx.setLineDash([6, 4]); ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); ctx.setLineDash([]);
      label(`${Math.abs(tool.b[0] - tool.a[0])} × ${Math.abs(tool.b[1] - tool.a[1])} cm`, (a + c) / 2, Math.min(b, d) - 12, { size: 12, color: '#fff', bg: '#e05297', bold: true });
    }
  }
  return { bad, narrow };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114) < 120;
}
