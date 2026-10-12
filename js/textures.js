// 床・壁・家具の模様(テクスチャ)を、画像ファイルを使わずにプログラムで描く
// 一度作った模様はとっておいて使い回す
import * as THREE from 'three';

const cache = new Map();

// 毎回同じ模様になるように、決まった順番で出てくる乱数
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
function hexRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
const rgba = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function canvas(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  return [c, c.getContext('2d')];
}
// 細かいザラザラ(1ピクセルずつ明るさを少し変える)
function grain(g, size, amount, r) {
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * amount;
    d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
}
// ふんわりしたムラ(大きなぼかしの丸をたくさん重ねる)
function clouds(g, size, col, n, alpha, r, rad = [0.08, 0.3]) {
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, rr = size * (rad[0] + r() * (rad[1] - rad[0]));
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rr);
      gr.addColorStop(0, rgba(col, alpha * r()));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(x + ox - rr, y + oy - rr, rr * 2, rr * 2);
    }
  }
}
// 大理石の筋
function veins(g, size, col, n, r, widthMax = 3) {
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = r() * size, y = r() * size;
    let ang = r() * Math.PI * 2;
    const steps = 40 + r() * 60, w = 0.4 + r() * widthMax;
    g.strokeStyle = rgba(col, 0.25 + r() * 0.5);
    g.filter = `blur(${(0.3 + r() * 1.2).toFixed(1)}px)`;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < steps; k++) {
      ang += (r() - 0.5) * 0.7;
      x += Math.cos(ang) * size * 0.015; y += Math.sin(ang) * size * 0.015;
      g.lineTo(x, y);
      if (r() < 0.04) { g.stroke(); g.lineWidth = Math.max(0.3, w * (0.3 + r())); g.beginPath(); g.moveTo(x, y); }
    }
    g.stroke();
  }
  g.restore();
}
function rrect(g, x, y, w, h, rad) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, rad); else g.rect(x, y, w, h);
}
function finish(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// 目地(タイルのすき間)
function grout(g, size, n, col, width) {
  g.fillStyle = rgba(col, 0.9);
  for (let i = 0; i <= n; i++) {
    const p = i * size / n;
    g.fillRect(p - width / 2, 0, width, size);
    g.fillRect(0, p - width / 2, size, width);
  }
}

// ---------- 床 ----------
// 戻り値: { map: 模様, size: 模様1枚が何m四方か }
export function floorTexture(fl) {
  const key = 'floor:' + fl.kind + fl.base + fl.line + (fl.tile || '');
  if (cache.has(key)) return cache.get(key);
  const S = 1024, [c, g] = canvas(S);
  const base = hexRgb(fl.base), line = hexRgb(fl.line);
  const r = rng(fl.base.length * 977 + parseInt(fl.base.slice(1), 16));
  let size = 1.2;
  g.fillStyle = rgba(base); g.fillRect(0, 0, S, S);

  if (fl.kind === 'wood' || fl.kind === 'herring') {
    // 板1枚を描く(木目・色ムラ・端の線)
    const plank = (x, y, w, h, vertical) => {
      const t = (r() - 0.5) * 0.22;
      g.fillStyle = rgba(mix(base, t > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(t)));
      g.fillRect(x, y, w, h);
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      const n = 10 + (r() * 10 | 0);
      for (let j = 0; j < n; j++) {
        g.strokeStyle = rgba(line, 0.08 + r() * 0.16); g.lineWidth = 0.6 + r() * 1.6;
        g.beginPath();
        const off = r(), ph = r() * 6;
        if (vertical) {
          const bx = x + off * w;
          g.moveTo(bx, y);
          for (let yy = 0; yy <= h; yy += 16) g.lineTo(bx + Math.sin(yy / (40 + off * 60) + ph) * (2 + off * 3), y + yy);
        } else {
          const by = y + off * h;
          g.moveTo(x, by);
          for (let xx = 0; xx <= w; xx += 16) g.lineTo(x + xx, by + Math.sin(xx / (40 + off * 60) + ph) * (2 + off * 3));
        }
        g.stroke();
      }
      // 節(ふし)をたまに
      if (r() < 0.25) {
        const kx = x + w * (0.2 + r() * 0.6), ky = y + h * (0.2 + r() * 0.6);
        g.fillStyle = rgba(line, 0.35); g.beginPath(); g.ellipse(kx, ky, vertical ? 4 : 9, vertical ? 9 : 4, 0, 0, Math.PI * 2); g.fill();
      }
      g.restore();
      g.strokeStyle = rgba(line, 0.75); g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    };
    if (fl.kind === 'wood') {
      // 幅15cmの板、長さはばらばら
      size = 1.2;
      const pw = S / 8;
      for (let i = 0; i < 8; i++) {
        let y = -r() * S * 0.6;
        while (y < S) {
          const len = S * (0.35 + r() * 0.5);
          plank(i * pw, y, pw, len, true);
          if (y < 0) plank(i * pw, y + S, pw, Math.min(len, -y), true);
          y += len;
        }
      }
    } else {
      // ヘリンボーン: 板の幅 w、長さ 4w。45度回すと横 4√2w・縦 √2w でくり返す
      const w = S / (4 * Math.SQRT2);
      size = 0.09 * 4 * Math.SQRT2;
      g.save(); g.rotate(Math.PI / 4);
      for (let k = -24; k <= 24; k++) for (let j = -6; j <= 6; j++) {
        const ox = (k + 4 * j) * w, oy = (k - 4 * j) * w;
        plank(ox, oy, 4 * w, w, false);
        plank(ox + 4 * w, oy - 3 * w, w, 4 * w, true);
      }
      g.restore();
    }
    grain(g, S, 10, r);
  } else if (fl.kind === 'marble' || fl.kind === 'stone' || fl.kind === 'terrazzo' || fl.kind === 'tile') {
    const tileCm = fl.tile || 60;
    const n = Math.max(1, Math.round(120 / tileCm));
    size = n * tileCm / 100;
    const ts = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.save(); g.beginPath(); g.rect(i * ts, j * ts, ts, ts); g.clip(); g.translate(i * ts, j * ts);
      const tone = (r() - 0.5) * 0.06;
      g.fillStyle = rgba(mix(base, tone > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(tone))); g.fillRect(0, 0, ts, ts);
      if (fl.kind === 'marble') {
        clouds(g, ts, line, 14, 0.18, r);
        veins(g, ts, line, 5 + (r() * 5 | 0), r, 3.5);
        veins(g, ts, mix(line, base, 0.4), 10, r, 1.2);
      } else if (fl.kind === 'stone') {
        clouds(g, ts, line, 26, 0.22, r, [0.04, 0.2]);
        clouds(g, ts, mix(base, [255, 255, 255], 0.3), 14, 0.2, r, [0.05, 0.18]);
      } else if (fl.kind === 'terrazzo') {
        const chips = [[176, 160, 140], [120, 112, 104], [214, 196, 170], [150, 110, 90], [235, 232, 226], [96, 96, 96]];
        for (let k = 0; k < 260; k++) {
          const x = r() * ts, y = r() * ts, rad = 2 + r() * (r() < 0.15 ? 14 : 6);
          g.fillStyle = rgba(chips[(r() * chips.length) | 0], 0.85);
          g.beginPath();
          const sides = 5 + (r() * 3 | 0);
          for (let s = 0; s < sides; s++) {
            const a = s / sides * Math.PI * 2, rr = rad * (0.6 + r() * 0.6);
            s ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          g.fill();
        }
      } else {
        clouds(g, ts, line, 4, 0.08, r);
      }
      g.restore();
    }
    grain(g, S, fl.kind === 'stone' ? 26 : 8, r);
    grout(g, S, n, mix(line, [255, 255, 255], 0.35), fl.kind === 'tile' ? 5 : 3);
  } else {
    // モルタル: 目地なしのムラ
    size = 2;
    clouds(g, S, line, 40, 0.18, r, [0.05, 0.25]);
    clouds(g, S, mix(base, [255, 255, 255], 0.5), 25, 0.15, r, [0.05, 0.2]);
    grain(g, S, 22, r);
  }
  const res = { map: finish(c), size };
  cache.set(key, res);
  return res;
}

// 2Dの図に使う、床の小さな見本(模様のパターン)
export function floorSwatch(fl) {
  const key = 'sw:' + fl.kind + fl.base + fl.line + (fl.tile || '');
  if (cache.has(key)) return cache.get(key);
  const { map, size } = floorTexture(fl);
  const res = { image: map.image, size };
  cache.set(key, res);
  return res;
}

// ---------- 壁 ----------
// 白っぽい模様を作って、壁の色を上から掛け合わせる。1枚 = 1m四方
export function wallTexture(kind) {
  const key = 'wall:' + kind;
  if (cache.has(key)) return cache.get(key);
  const S = 512, [c, g] = canvas(S), r = rng(kind.length * 131 + 7);
  const white = [255, 255, 255], shade = [200, 196, 190];
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  if (kind === 'plaster') {
    // こて跡のムラ
    for (let i = 0; i < 160; i++) {
      const x = r() * S, y = r() * S, w = 30 + r() * 90, h = 10 + r() * 30;
      g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 1.2);
      g.fillStyle = rgba(r() < 0.5 ? shade : white, 0.12 + r() * 0.12);
      g.beginPath(); g.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    grain(g, S, 14, r);
  } else if (kind === 'brick') {
    // 白く塗ったレンガ(21×6cm)
    const bw = S * 0.21 * 1.0, bh = S * 0.06, gap = 3;
    g.fillStyle = rgba([214, 210, 204]); g.fillRect(0, 0, S, S);
    for (let row = 0; row * bh < S + bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw + off; x < S + bw; x += bw) {
        const t = 0.9 + r() * 0.1;
        g.fillStyle = rgba(mix([255, 255, 255], [225, 220, 212], 1 - t + r() * 0.3));
        const rx = x + gap / 2, ry = row * bh + gap / 2;
        rrect(g, rx, ry, bw - gap, bh - gap, 2); g.fill();
      }
    }
    grain(g, S, 18, r);
    // 縦の継ぎ目がずれないように行の数を合わせる(512 / (0.06*512) ≈ 16.7 行 → 少しずれるが目立たない)
  } else if (kind === 'panel') {
    // 縦張りの木目パネル(幅10cm)
    const n = 10, pw = S / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = rgba(mix([236, 226, 210], [212, 196, 172], r())); g.fillRect(i * pw, 0, pw, S);
      for (let j = 0; j < 8; j++) {
        g.strokeStyle = rgba([150, 120, 90], 0.08 + r() * 0.12); g.lineWidth = 0.6 + r();
        const bx = i * pw + r() * pw, ph = r() * 6;
        g.beginPath(); g.moveTo(bx, 0);
        for (let y = 0; y <= S; y += 16) g.lineTo(bx + Math.sin(y / 50 + ph) * 2, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(90,70,50,.45)'; g.fillRect(i * pw, 0, 2, S);
    }
  } else if (kind === 'stone') {
    // ストーン調(石を積んだ感じ)
    g.fillStyle = rgba([190, 186, 180]); g.fillRect(0, 0, S, S);
    const rows = 6, rh = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r() * 80;
      while (x < S) {
        const w = 60 + r() * 110;
        const col = mix([248, 246, 242], [205, 200, 192], r());
        g.fillStyle = rgba(col);
        rrect(g, x + 2, row * rh + 2, w - 4, rh - 4, 6); g.fill();
        x += w;
      }
    }
    clouds(g, S, [150, 145, 138], 30, 0.12, r, [0.02, 0.08]);
    grain(g, S, 26, r);
  } else {
    // 無地のクロス(ごく細かい織り目)
    for (let y = 0; y < S; y += 3) { g.fillStyle = `rgba(0,0,0,${0.012 + r() * 0.012})`; g.fillRect(0, y, S, 1); }
    grain(g, S, 9, r);
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

// ---------- 家具の素材 ----------
// 白っぽい模様を作って、家具の色を掛け合わせる。戻り値の size = 1枚が何m四方か
export function finishTexture(kind) {
  const key = 'fin:' + kind;
  if (cache.has(key)) return cache.get(key);
  const S = 512, [c, g] = canvas(S), r = rng(kind.length * 53 + 11);
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  let size = 0.5;
  if (kind === 'wood') {
    size = 0.6;
    for (let j = 0; j < 70; j++) {
      g.strokeStyle = `rgba(90,60,30,${0.06 + r() * 0.14})`; g.lineWidth = 0.5 + r() * 2.2;
      const by = r() * S, ph = r() * 6, amp = 2 + r() * 5;
      g.beginPath(); g.moveTo(0, by);
      for (let x = 0; x <= S; x += 8) g.lineTo(x, by + Math.sin(x / (50 + r() * 4) + ph) * amp);
      g.stroke();
    }
    clouds(g, S, [120, 90, 60], 12, 0.08, r);
    grain(g, S, 10, r);
  } else if (kind === 'fabric') {
    size = 0.15;
    for (let y = 0; y < S; y += 4) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`; g.fillRect(0, y, S, 2); }
    for (let x = 0; x < S; x += 4) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`; g.fillRect(x, 0, 2, S); }
    grain(g, S, 22, r);
  } else if (kind === 'boucle') {
    size = 0.2;
    g.fillStyle = 'rgb(225,225,225)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, rad = 2 + r() * 4;
      g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 1; g.stroke();
    }
  } else if (kind === 'leather') {
    size = 0.3;
    clouds(g, S, [0, 0, 0], 40, 0.08, r, [0.02, 0.1]);
    grain(g, S, 18, r);
  } else if (kind === 'marble') {
    size = 0.8;
    clouds(g, S, [170, 168, 165], 12, 0.25, r);
    veins(g, S, [120, 118, 115], 6, r, 3);
    veins(g, S, [160, 158, 154], 12, r, 1.2);
  } else {
    grain(g, S, 4, r);
  }
  const res = { map: finish(c), size };
  cache.set(key, res);
  return res;
}

// 「テクスチャの大きさ」を実物の大きさに合わせるため、面の向きに合わせて UV(模様の貼り位置)を作り直す
// rep = 模様1枚が何m か。off = 位置のずれ(隣り合う壁で模様がつながるように)
export function projectUV(geo, rep, off = [0, 0, 0]) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  if (!pos || !nor || !uv) return geo;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + off[0], y = pos.getY(i) + off[1], z = pos.getZ(i) + off[2];
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x / rep, z / rep);
    else if (nx >= nz) uv.setXY(i, z / rep, y / rep);
    else uv.setXY(i, x / rep, y / rep);
  }
  uv.needsUpdate = true;
  return geo;
}

// 写真(データURL)をテクスチャに
const loader = new THREE.TextureLoader();
export function photoTexture(dataUrl) {
  const key = 'photo:' + dataUrl.length + dataUrl.slice(-40);
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(dataUrl);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// 写真がないアートフレーム用の、やわらかい抽象画
export function abstractArt(seed = 1) {
  const key = 'art:' + seed;
  if (cache.has(key)) return cache.get(key);
  const S = 256, [c, g] = canvas(S), r = rng(seed * 7919 + 3);
  g.fillStyle = '#f4efe7'; g.fillRect(0, 0, S, S);
  const cols = ['#d9a48f', '#c97b5e', '#e7cfb4', '#8a9a86', '#3d3a38', '#b9a28c'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = cols[(r() * cols.length) | 0];
    g.beginPath();
    if (r() < 0.5) g.arc(r() * S, r() * S, 30 + r() * 60, 0, Math.PI * (1 + r()));
    else g.ellipse(r() * S, r() * S, 20 + r() * 70, 20 + r() * 50, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3d3a38'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(r() * S, r() * S); g.bezierCurveTo(r() * S, r() * S, r() * S, r() * S, r() * S, r() * S); g.stroke();
  const t = finish(c, { repeat: false });
  cache.set(key, t);
  return t;
}
