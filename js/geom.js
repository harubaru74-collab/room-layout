// 当たり判定・距離計算などの図形まわりの計算
import { FLAT_TYPES } from './data.js';

// 家具の4つの角(時計回り)。f は {x,y,w,d,rot}
export function corners(f) {
  const t = f.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const hw = f.w / 2, hd = f.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) =>
    [f.x + lx * c - ly * s, f.y + lx * s + ly * c]);
}

// 作り付け(左上基準)を同じ形式の多角形に
export function rectPoly(r) {
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x, r.y + r.d]];
}

// 画面の点が家具の中にあるか
export function pointInFurniture(f, px, py) {
  const t = -f.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = px - f.x, dy = py - f.y;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.d / 2;
}

// 2つの凸多角形が重なっているか(分離軸定理)。少しだけ接している程度は重なりとみなさない
export function overlaps(a, b, eps = 0.5) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1], ny = p[0] - q[0];
      const len = Math.hypot(nx, ny) || 1;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) { const d = (v[0] * nx + v[1] * ny) / len; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
      for (const v of b) { const d = (v[0] * nx + v[1] * ny) / len; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (aMax - eps <= bMin || bMax - eps <= aMin) return false;
    }
  }
  return true;
}

function closestOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * dx, ay + t * dy];
}

// 2つの多角形のいちばん近い2点と距離
export function polyGap(a, b) {
  let best = { dist: Infinity, p: null, q: null };
  const test = (P, Q, swap) => {
    for (const v of P) {
      for (let i = 0; i < Q.length; i++) {
        const s = Q[i], e = Q[(i + 1) % Q.length];
        const c = closestOnSeg(v[0], v[1], s[0], s[1], e[0], e[1]);
        const d = Math.hypot(v[0] - c[0], v[1] - c[1]);
        if (d < best.dist) best = swap ? { dist: d, p: c, q: v } : { dist: d, p: v, q: c };
      }
    }
  };
  test(a, b, false); test(b, a, true);
  return best;
}

export function bbox(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// 床に敷くだけのもの(ラグ)は当たり判定や通路チェックから外す
export const isFlat = f => FLAT_TYPES.includes(f.type);

// 赤く表示する家具の id 一覧と、狭い通路の一覧を計算
export function analyze(room, furniture) {
  const bad = new Set();
  const narrow = [];
  const items = furniture.filter(f => !isFlat(f)).map(f => ({ f, poly: corners(f) }));
  const fixtures = room.fixtures.map(r => ({ r, poly: rectPoly(r) }));
  for (const it of items) {
    const b = bbox(it.poly);
    if (b.minX < -0.5 || b.minY < -0.5 || b.maxX > room.w + 0.5 || b.maxY > room.d + 0.5) bad.add(it.f.id);
    for (const fx of fixtures) if (overlaps(it.poly, fx.poly)) bad.add(it.f.id);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (overlaps(A.poly, B.poly)) { bad.add(A.f.id); bad.add(B.f.id); continue; }
      const g = polyGap(A.poly, B.poly);
      if (g.dist >= 5 && g.dist < 60) narrow.push(g);
    }
    // 作り付け(キッチン・クローゼットなど)との通路もチェック
    for (const fx of fixtures) {
      if (fx.r.kind === 'entrance') continue;
      const g = polyGap(items[i].poly, fx.poly);
      if (g.dist >= 5 && g.dist < 60) narrow.push(g);
    }
  }
  return { bad, narrow };
}
