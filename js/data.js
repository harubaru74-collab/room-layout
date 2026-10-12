// 部屋・家具の初期データとカタログ（単位はすべて cm）
// 座標: x = 部屋の幅方向(0〜幅)、y = 玄関側0 〜 ベランダ側(奥行)
// 家具の x,y は「家具の中心」の位置。rot は時計回りの角度(度)。
// 家具の「正面」は rot=0 のときベランダ側(+y)を向く。

export const STORAGE_KEY = 'roomLayout.v1';

// 写真からの推測で置いた間取り。画面の「部屋の設定」から全部変更できる
export function defaultRoom() {
  return {
    w: 310, d: 800, h: 240,
    fixtures: [
      { id: 'fx1', kind: 'ub', name: 'お風呂(UB)', x: 0, y: 0, w: 105, d: 110, h: 240 },
      { id: 'fx2', kind: 'entrance', name: '玄関', x: 105, y: 0, w: 105, d: 90, h: 0 },
      { id: 'fx3', kind: 'storage', name: '下駄箱', x: 210, y: 0, w: 100, d: 45, h: 120 },
      { id: 'fx4', kind: 'washer', name: '洗濯機置き場', x: 210, y: 45, w: 100, d: 70, h: 200 },
      { id: 'fx5', kind: 'closet', name: 'クローゼット', x: 0, y: 110, w: 100, d: 60, h: 240 },
      { id: 'fx6', kind: 'kitchen', name: 'キッチン(2口)', x: 255, y: 120, w: 55, d: 150, h: 85 },
    ],
    // wall: entrance(y=0) / balcony(y=奥行) / left(x=0) / right(x=幅)
    // start: 壁の端(x=0 または y=0 側)から開口の端までの距離
    openings: [
      { id: 'op1', kind: 'window', name: '腰高窓1', wall: 'left', start: 440, width: 110, sill: 90, height: 110 },
      { id: 'op2', kind: 'window', name: '腰高窓2', wall: 'left', start: 590, width: 150, sill: 90, height: 110 },
      { id: 'op3', kind: 'window', name: '掃き出し窓(ベランダ)', wall: 'balcony', start: 110, width: 170, sill: 0, height: 200 },
      { id: 'op4', kind: 'door', name: '玄関ドア', wall: 'entrance', start: 115, width: 85, sill: 0, height: 200 },
    ],
    balcony: 100,
  };
}

export const CATALOG = [
  { type: 'sofa', name: 'ソファ(2人掛け)', w: 122, d: 96, h: 82, seat: 41, color: '#8d9095' },
  { type: 'tvstand', name: 'テレビ台(テレビ付き)', w: 120, d: 40, h: 40, color: '#6e5440' },
  { type: 'bed', name: 'シングルベッド', w: 97, d: 195, h: 45, color: '#cdb89b' },
  { type: 'dresser', name: 'ドレッサー', w: 50, d: 40, h: 140, color: '#f1ece3' },
  { type: 'fridge', name: '冷蔵庫', w: 55, d: 60, h: 150, color: '#e9eaeb' },
  { type: 'lowtable', name: 'ローテーブル', w: 80, d: 50, h: 40, color: '#b38d5f' },
  { type: 'bookshelf', name: '本棚', w: 80, d: 30, h: 180, color: '#c8a77d' },
  { type: 'desk', name: 'デスク', w: 100, d: 60, h: 72, color: '#c8a77d' },
  { type: 'chair', name: 'イス', w: 45, d: 50, h: 80, color: '#5a5d63' },
  { type: 'futon', name: '来客ふとん', w: 100, d: 210, h: 12, color: '#f4efe4' },
  { type: 'rug', name: 'ラグ', w: 140, d: 200, h: 1, color: '#d9c4a6' },
  { type: 'rack', name: 'レンジ台', w: 60, d: 45, h: 120, color: '#ffffff' },
  { type: 'washer', name: '洗濯機', w: 60, d: 60, h: 100, color: '#f6f6f6' },
  { type: 'box', name: 'その他(箱)', w: 60, d: 40, h: 60, color: '#a7c4bc' },
  { type: 'sofa1', name: '1人掛けソファ', w: 80, d: 85, h: 75, seat: 40, color: '#efe8dc' },
  { type: 'roundtable', name: '丸テーブル', w: 70, d: 70, h: 40, color: '#e8e2d6' },
  { type: 'stool', name: 'スツール', w: 40, d: 40, h: 42, color: '#8a3b2e' },
  { type: 'roundrug', name: '丸ラグ', w: 140, d: 140, h: 1, color: '#e6d9c3' },
  { type: 'plant', name: '観葉植物', w: 40, d: 40, h: 120, color: '#5f8f4e' },
  { type: 'lamp', name: 'フロアライト', w: 35, d: 35, h: 150, color: '#f3ead6' },
  { type: 'mirror', name: '姿見(スタンドミラー)', w: 45, d: 30, h: 160, color: '#c8a77d' },
  { type: 'bed', name: 'セミダブルベッド', w: 120, d: 195, h: 45, color: '#cdb89b' },
];

// 丸い形の家具(2Dでは楕円で描く。当たり判定は外側の四角で近似)
export const ROUND_TYPES = ['roundtable', 'stool', 'roundrug', 'plant', 'lamp'];
// 床に敷くだけのもの(当たり判定・通路チェックから外す)
export const FLAT_TYPES = ['rug', 'roundrug'];

export const COLOR_CHIPS = ['#8d9095', '#4a4d52', '#f1ece3', '#ffffff', '#cdb89b', '#b38d5f', '#6e5440',
  '#d9c4a6', '#f2c4ce', '#e8a0b4', '#a7c4bc', '#8fb3d9', '#c9b6e4', '#e9d27a'];

export const WALL_COLORS = [
  { name: 'ホワイト', color: '#f6f4ef' },
  { name: 'アイボリー', color: '#f3ead6' },
  { name: 'ライトグレー', color: '#dcdcdc' },
  { name: 'くすみピンク', color: '#ecd9d6' },
  { name: 'くすみブルー', color: '#d5dfe6' },
];

export const FLOORS = [
  { name: 'オーク', base: '#b88a5a', line: '#8f6538' },
  { name: 'ナチュラル', base: '#d4b48a', line: '#ad8b5e' },
  { name: 'ウォルナット', base: '#6f4c33', line: '#4d3221' },
  { name: 'ホワイトアッシュ', base: '#e2d6c4', line: '#c2b39c' },
  { name: 'グレー', base: '#a9a49d', line: '#8a857e' },
];

// 床の色(自由入力)から木目の線の色を作る
export function floorStyle(view) {
  if (view.floor >= 0 && FLOORS[view.floor]) return FLOORS[view.floor];
  const n = parseInt((view.floorColor || '#b88a5a').slice(1), 16);
  const dk = v => Math.round(v * 0.72).toString(16).padStart(2, '0');
  return { name: '自由', base: view.floorColor, line: '#' + dk(n >> 16 & 255) + dk(n >> 8 & 255) + dk(n & 255) };
}
export function wallStyle(view) {
  if (view.wall >= 0 && WALL_COLORS[view.wall]) return WALL_COLORS[view.wall].color;
  return view.wallColor || '#f6f4ef';
}

// 保存データの形をそろえる(古いデータ・読み込んだファイル用)。おかしいときは null
export function normalizeState(s) {
  if (!s || typeof s !== 'object' || !s.room || !s.plans || typeof s.plans !== 'object') return null;
  const base = defaultState();
  const room = { ...defaultRoom(), ...s.room };
  if (!Array.isArray(room.fixtures)) room.fixtures = [];
  if (!Array.isArray(room.openings)) room.openings = [];
  const plans = {};
  for (const [k, p] of Object.entries(s.plans)) {
    if (!p || !Array.isArray(p.furniture)) continue;
    plans[k] = {
      name: String(p.name || k),
      furniture: p.furniture.filter(f => f && typeof f === 'object').map(f => ({
        id: f.id || 'f' + Math.random().toString(36).slice(2, 9),
        type: f.type || 'box', name: String(f.name ?? '家具'),
        w: +f.w || 60, d: +f.d || 40, h: +f.h || 0, seat: +f.seat || 0,
        color: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#a7c4bc',
        x: +f.x || 0, y: +f.y || 0, rot: ((+f.rot || 0) % 360 + 360) % 360, url: String(f.url || ''),
      })),
    };
  }
  if (!Object.keys(plans).length) return null;
  return {
    ...base, ...s, room, plans,
    current: plans[s.current] ? s.current : Object.keys(plans)[0],
    view: { ...base.view, ...(s.view || {}) },
  };
}

export function makeFurniture(tpl, x, y, rot = 0) {
  return {
    id: 'f' + Math.random().toString(36).slice(2, 9),
    type: tpl.type, name: tpl.name,
    w: tpl.w, d: tpl.d, h: tpl.h, seat: tpl.seat || 0,
    color: tpl.color, x, y, rot, url: '',
  };
}

function tpl(type) { return CATALOG.find(c => c.type === type); }

export function defaultFurniture() {
  return [
    makeFurniture(tpl('sofa'), 48, 400, 270),
    makeFurniture(tpl('tvstand'), 290, 400, 90),
    makeFurniture(tpl('bed'), 261, 640, 0),
    makeFurniture(tpl('dresser'), 290, 485, 90),
  ];
}

export function defaultState() {
  const furn = defaultFurniture();
  return {
    version: 1,
    room: defaultRoom(),
    plans: {
      A: { name: '案A', furniture: furn },
      B: { name: '案B', furniture: JSON.parse(JSON.stringify(furn)) },
      C: { name: '案C', furniture: JSON.parse(JSON.stringify(furn)) },
    },
    current: 'A',
    view: { eye: 150, night: false, ceil: false, wall: 0, floor: 0, wallColor: '#f6f4ef', floorColor: '#b88a5a' },
  };
}
