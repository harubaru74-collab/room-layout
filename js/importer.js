// 商品ページのURLから、名前・サイズ・写真・色を読み取る
// ブラウザだけでは他のお店のページを直接読めない(セキュリティのしくみ)ので、
// 公開されている無料の読み取りサービスを通して読む
//   ページの文字: r.jina.ai   写真: wsrv.nl(画像を小さくして色を調べられる形にしてくれる)
import { parseSize, guessType } from './data.js';

const READER = 'https://r.jina.ai/';
const IMG_PROXY = 'https://wsrv.nl/?url=';

export async function readProduct(url) {
  if (!/^https?:\/\//.test(url)) throw new Error('URLは https:// から始まる形で入れてね');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let j;
  try {
    const res = await fetch(READER + url, { headers: { Accept: 'application/json', 'X-Retain-Images': 'none' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status === 429 ? '読み取りサービスが混んでいるみたい。少し待ってからもう一度試してね' : 'ページを読み取れなかったよ');
    j = await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('時間がかかりすぎたので止めたよ。もう一度試してね');
    throw e.message && !/fetch/i.test(e.message) ? e : new Error('ページを読み取れなかったよ(通信を確認してね)');
  } finally { clearTimeout(timer); }
  const d = (j && j.data) || {};
  if (/見つかりません|ページがありません|Not Found|404/i.test(String(d.title || '')) || (d.httpStatus && d.httpStatus >= 400)) {
    throw new Error('商品ページが見つからなかったよ。URLをもう一度確かめてね');
  }
  const meta = d.metadata || {};
  const title = String(meta['og:title'] || d.title || '');
  const desc = String(meta['og:description'] || d.description || '');
  const content = String(d.content || '');
  const size = parseSize(content) || parseSize(title) || parseSize(desc);
  let g = guessType(title);
  if (g.type === 'box') g = { ...guessType(title + ' ' + desc), finish: g.finish !== 'auto' ? g.finish : guessType(title + ' ' + desc).finish };
  const image = meta['og:image'] || meta['twitter:image'] || '';
  let look = null;
  if (image) {
    try { look = await analyzeImage(IMG_PROXY + encodeURIComponent(image) + '&w=480&h=480&fit=inside&output=jpg', true); } catch (e) { /* 写真がなくても続ける */ }
  }
  return { name: cleanName(title), size, type: g.type, finish: g.finish, image, color: look && look.color, photo: look && look.photo };
}

// お店の名前や【】の宣伝文句を取って、短い名前に
function cleanName(t) {
  let n = t.split(/[|｜]/)[0];
  n = n.replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '').replace(/送料無料|ポイント\d+倍|楽天市場|Amazon\.co\.jp[:：]?/g, '').trim();
  n = n.replace(/\s*\/\s*/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  return n.length > 26 ? n.slice(0, 26) + '…' : n;
}

// 写真から「家具の色」と「小さな写真」を作る
// 背景(写真の四隅の色に近いところ)は除いて、いちばん多い色を選ぶ
export function analyzeImage(src, cross) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cross) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const at = (x, y) => { const i = (y * N + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const bgs = [at(1, 1), at(N - 2, 1), at(1, N - 2), at(N - 2, N - 2)];
        const near = (p, q, t) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < t;
        const buckets = new Map();
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const p = at(x, y);
          if (bgs.some(b => near(p, b, 40))) continue;
          // 写真の真ん中ほど重く数える
          const wgt = 1.5 - Math.hypot(x - N / 2, y - N / 2) / N;
          const k = (p[0] >> 5) << 6 | (p[1] >> 5) << 3 | (p[2] >> 5);
          const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
          b.n += wgt; b.r += p[0] * wgt; b.g += p[1] * wgt; b.b += p[2] * wgt;
          buckets.set(k, b);
        }
        let best = null;
        for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
        const hex = v => Math.round(v).toString(16).padStart(2, '0');
        const color = best ? '#' + hex(best.r / best.n) + hex(best.g / best.n) + hex(best.b / best.n) : null;
        // 保存用の小さな写真(最大 320px、JPEG)
        const S = 320, sc = Math.min(1, S / Math.max(img.naturalWidth, img.naturalHeight));
        const t = document.createElement('canvas');
        t.width = Math.max(1, Math.round(img.naturalWidth * sc)); t.height = Math.max(1, Math.round(img.naturalHeight * sc));
        t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
        resolve({ color, photo: t.toDataURL('image/jpeg', 0.8) });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('写真を読み込めなかったよ'));
    img.src = src;
  });
}

// スマホで選んだ画像ファイルを、ちょうどいい大きさのデータにする(間取り図など)
export function fileToDataUrl(file, maxSide = 1800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve({ dataUrl: c.toDataURL('image/jpeg', quality), w: c.width, h: c.height });
      };
      img.onerror = () => reject(new Error('画像を読み込めなかったよ'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('ファイルを読み込めなかったよ'));
    fr.readAsDataURL(file);
  });
}
