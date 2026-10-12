// 部屋・家具の初期データとカタログ（単位はすべて cm）
// 座標: x = 部屋の幅方向(0〜幅)、y = 玄関側0 〜 ベランダ側(奥行)
// 家具の x,y は「家具の中心」の位置。rot は時計回りの角度(度)。
// 家具の「正面」は rot=0 のときベランダ側(+y)を向く。

export const STORAGE_KEY = 'roomLayout.v1';      // 部屋が1つだけだったころの保存場所(読み込みだけ)
export const STORE_KEY = 'roomLayout.v2';        // いくつもの部屋をまとめて保存する場所

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
  { type: 'art', name: 'アートフレーム(壁掛け)', w: 50, d: 3, h: 70, elev: 110, color: '#c8a77d' },
  { type: 'curtain', name: 'カーテン(追加用)', w: 100, d: 10, h: 200, color: '#e9e1d3' },
];

// 丸い形の家具(2Dでは楕円で描く。当たり判定は外側の四角で近似)
export const ROUND_TYPES = ['roundtable', 'stool', 'roundrug', 'plant', 'lamp'];
// 床に敷くだけのもの(当たり判定・通路チェックから外す)
export const FLAT_TYPES = ['rug', 'roundrug'];
// 壁に掛けるもの(床の通路チェックから外す)
export const WALL_TYPES = ['art'];

export const COLOR_CHIPS = ['#8d9095', '#4a4d52', '#f1ece3', '#ffffff', '#cdb89b', '#b38d5f', '#6e5440',
  '#d9c4a6', '#f2c4ce', '#e8a0b4', '#a7c4bc', '#8fb3d9', '#c9b6e4', '#e9d27a'];

export const WALL_COLORS = [
  { name: 'ホワイト', color: '#f6f4ef' },
  { name: 'アイボリー', color: '#f3ead6' },
  { name: 'ライトグレー', color: '#dcdcdc' },
  { name: 'くすみピンク', color: '#ecd9d6' },
  { name: 'くすみブルー', color: '#d5dfe6' },
];

// kind: wood=フローリング / herring=ヘリンボーン / marble=大理石 / stone=石 / terrazzo=テラゾー / tile=タイル / mortar=モルタル
// tile: 目地(タイルのすき間)の間隔 cm
export const FLOORS = [
  { name: 'オーク', kind: 'wood', base: '#b88a5a', line: '#8f6538' },
  { name: 'ナチュラル', kind: 'wood', base: '#d4b48a', line: '#ad8b5e' },
  { name: 'ウォルナット', kind: 'wood', base: '#6f4c33', line: '#4d3221' },
  { name: 'ホワイトアッシュ', kind: 'wood', base: '#e2d6c4', line: '#c2b39c' },
  { name: 'グレー木目', kind: 'wood', base: '#a9a49d', line: '#8a857e' },
  { name: 'ヘリンボーン', kind: 'herring', base: '#c49a6c', line: '#8f6538' },
  { name: '大理石ホワイト', kind: 'marble', base: '#efede9', line: '#a9a7a3', tile: 60 },
  { name: '大理石ベージュ', kind: 'marble', base: '#e6d8c3', line: '#b08f68', tile: 60 },
  { name: '大理石ブラック', kind: 'marble', base: '#2b2b2d', line: '#c9c4bb', tile: 60 },
  { name: 'ストーングレー', kind: 'stone', base: '#9d9d99', line: '#6f6f6b', tile: 60 },
  { name: 'ストーンベージュ', kind: 'stone', base: '#cfc2ad', line: '#9b8c74', tile: 60 },
  { name: 'テラゾー', kind: 'terrazzo', base: '#ebe6de', line: '#b5aa9a', tile: 60 },
  { name: 'タイルホワイト', kind: 'tile', base: '#f2f1ee', line: '#c9c7c2', tile: 30 },
  { name: 'モルタル', kind: 'mortar', base: '#b4b1ab', line: '#8e8b85' },
];

// 壁の仕上げ
export const WALL_FINISHES = [
  { id: 'plain', name: '無地クロス' },
  { id: 'plaster', name: '塗り壁' },
  { id: 'brick', name: 'レンガ調' },
  { id: 'panel', name: '木目パネル' },
  { id: 'stone', name: 'ストーン調' },
];

// 家具の素材(3Dでの質感)
export const FINISHES = [
  { id: 'auto', name: 'おまかせ' },
  { id: 'wood', name: '木目' },
  { id: 'fabric', name: 'ファブリック(布)' },
  { id: 'boucle', name: 'ブークレ(もこもこ)' },
  { id: 'leather', name: 'レザー' },
  { id: 'marble', name: '大理石・ストーン' },
  { id: 'metal', name: 'スチール・金属' },
  { id: 'plain', name: 'つるつる(無地)' },
];
// 素材がおまかせのときの決め方
export function autoFinish(type) {
  if (['sofa', 'sofa1', 'bed', 'futon', 'rug', 'roundrug', 'stool'].includes(type)) return 'fabric';
  if (['tvstand', 'bookshelf', 'desk', 'lowtable', 'roundtable', 'dresser', 'mirror', 'chair'].includes(type)) return 'wood';
  return 'plain';
}

// 床の色(自由入力)から木目の線の色を作る
export function floorStyle(view) {
  if (view.floor >= 0 && FLOORS[view.floor]) return FLOORS[view.floor];
  const n = parseInt((view.floorColor || '#b88a5a').slice(1), 16);
  const dk = v => Math.round(v * 0.72).toString(16).padStart(2, '0');
  return { name: '自由', kind: 'wood', base: view.floorColor, line: '#' + dk(n >> 16 & 255) + dk(n >> 8 & 255) + dk(n & 255) };
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
  // 古いデータで id がないものに id をつける(図でタップして選ぶのに使う)
  for (const o of [...room.fixtures, ...room.openings]) if (!o.id) o.id = newId(o.wall ? 'op' : 'fx');
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
        finish: f.finish || 'auto', elev: +f.elev || 0, photo: typeof f.photo === 'string' && f.photo.startsWith('data:image/') ? f.photo : '',
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
    color: tpl.color, x, y, rot, url: tpl.url || '', finish: tpl.finish || 'auto', elev: tpl.elev || 0, photo: tpl.photo || '',
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
    view: { eye: 150, night: false, ceil: false, wall: 0, floor: 0, wallColor: '#f6f4ef', floorColor: '#b88a5a', wallFinish: 'plain', curtain: '#e9e1d3' },
    underlay: null,
  };
}

// ---------- いくつもの部屋 ----------
export const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 作り付けがほとんどない、シンプルな部屋
export function blankRoom(w = 300, d = 600) {
  return {
    w, d, h: 240, balcony: 100,
    fixtures: [{ id: newId('fx'), kind: 'entrance', name: '玄関', x: Math.max(0, w / 2 - 50), y: 0, w: 100, d: 90, h: 0 }],
    openings: [
      { id: newId('op'), kind: 'door', name: '玄関ドア', wall: 'entrance', start: Math.max(0, w / 2 - 40), width: 80, sill: 0, height: 200 },
      { id: newId('op'), kind: 'window', name: '掃き出し窓', wall: 'balcony', start: Math.max(0, w / 2 - 85), width: 170, sill: 0, height: 200 },
    ],
  };
}

export function defaultStore() {
  const id = newId('r');
  return { version: 2, current: id, rooms: [{ id, name: '大井町 ワンルーム', state: defaultState() }] };
}

// 保存データ(古い形の1部屋だけのデータも)を、今の形にそろえる。おかしいときは null
export function normalizeStore(s) {
  if (!s || typeof s !== 'object') return null;
  if (Array.isArray(s.rooms)) {
    const rooms = s.rooms.map(r => r && { id: r.id || newId('r'), name: String(r.name || '部屋'), state: normalizeState(r.state) })
      .filter(r => r && r.state);
    if (!rooms.length) return null;
    return { version: 2, savedAt: s.savedAt || 0, current: rooms.some(r => r.id === s.current) ? s.current : rooms[0].id, rooms };
  }
  const st = normalizeState(s);
  if (!st) return null;
  const id = newId('r');
  return { version: 2, savedAt: s.savedAt || 0, current: id, rooms: [{ id, name: '大井町 ワンルーム', state: st }] };
}

// ---------- 商品ページの文字からサイズを読み取る ----------
// 例: 「幅180×奥行41.8×高さ36.4cm」「W1200×D400×H450mm」「サイズ:約120×40×45cm」
export function parseSize(text) {
  if (!text) return null;
  const t = String(text).replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[ｘＸ✕＊]/g, '×').replace(/[ \t\u3000]+/g, ' ');
  // 値段の入った行(おすすめ商品の一覧など)と、梱包サイズの行は使わない
  const lines = t.split(/\n/).filter(l => !/[¥￥]|円|梱包|段ボール|パッケージ|外箱|荷姿/.test(l));
  const num = '(\\d+(?:\\.\\d+)?)';
  const unitOf = s => /mm|ミリ/.test(s) ? 0.1 : /\d\s*m(?![m²])|メートル/.test(s) && !/cm|センチ/.test(s) ? 100 : 1;
  const fix = (w, d, h, line) => {
    const u = unitOf(line), r = v => v == null ? null : Math.round(v * u * 10) / 10;
    const res = { w: r(w), d: r(d), h: r(h) };
    return res.w > 0 && res.d > 0 && res.w < 1000 && res.d < 1000 ? res : null;
  };
  // 「幅〇 奥行〇 高さ〇」と書いてある形
  const labeled = line => {
    const pick = re => { const m = line.match(re); return m ? parseFloat(m[1]) : null; };
    const w = pick(new RegExp('(?:幅|横幅|W)\\s*[:：]?\\s*約?\\s*' + num));
    const d = pick(new RegExp('(?:奥行き?|奥|D)\\s*[:：]?\\s*約?\\s*' + num));
    const h = pick(new RegExp('(?:高さ|H)\\s*[:：]?\\s*約?\\s*' + num));
    return w != null && d != null ? fix(w, d, h, line) : null;
  };
  // 「120×40×45cm」の形(幅×奥行×高さ の順とみなす)
  const plain = line => {
    const m3 = line.match(new RegExp(num + '\\s*(?:cm|mm)?\\s*×\\s*' + num + '\\s*(?:cm|mm)?\\s*×\\s*' + num + '\\s*(cm|mm|m)'));
    if (m3) return fix(+m3[1], +m3[2], +m3[3], line);
    const m2 = line.match(new RegExp(num + '\\s*(?:cm|mm)?\\s*×\\s*' + num + '\\s*(cm|mm)'));
    return m2 ? fix(+m2[1], +m2[2], null, line) : null;
  };
  const sizeLines = lines.filter(l => /サイズ|寸法|外寸|外形/.test(l));
  for (const [list, fn] of [[sizeLines, labeled], [lines, labeled], [sizeLines, plain], [lines, plain]]) {
    for (const l of list) { const r = fn(l); if (r) return r; }
  }
  return null;
}

// 商品名から家具の種類と素材をだいたい当てる
export function guessType(name) {
  const n = String(name || '');
  const rules = [
    [/1人掛け|一人掛け|パーソナルチェア|ラウンジチェア/, 'sofa1'], [/ソファ|カウチ/, 'sofa'],
    [/テレビ台|テレビボード|ローボード|TVボード/i, 'tvstand'], [/ベッド|すのこ/, 'bed'], [/マットレス|布団|ふとん/, 'futon'],
    [/丸型ラグ|円形ラグ|ラウンドラグ/, 'roundrug'], [/ラグ|カーペット|マット/, 'rug'], [/ドレッサー/, 'dresser'],
    [/冷蔵庫/, 'fridge'], [/洗濯機/, 'washer'], [/本棚|シェルフ|ラック|棚/, 'bookshelf'], [/デスク|机/, 'desk'],
    [/丸テーブル|ラウンドテーブル|円形テーブル|サイドテーブル/, 'roundtable'], [/テーブル/, 'lowtable'],
    [/スツール|オットマン/, 'stool'], [/チェア|椅子|イス/, 'chair'], [/フロアライト|フロアランプ|スタンドライト|照明/, 'lamp'],
    [/ミラー|鏡/, 'mirror'], [/観葉植物|フェイクグリーン|植物/, 'plant'], [/アート|ポスター|フレーム|絵/, 'art'], [/カーテン/, 'curtain'],
  ];
  const type = (rules.find(([re]) => re.test(n)) || [, 'box'])[1];
  const finish = /大理石|ストーン|モルタル|マーブル|石目/.test(n) ? 'marble' : /ブークレ|ボア|シープ/.test(n) ? 'boucle'
    : /レザー|革/.test(n) ? 'leather' : /スチール|アイアン|金属|メタル/.test(n) && !/木/.test(n) ? 'metal'
      : /木目|木製|天然木|オーク|ウォルナット|パイン/.test(n) ? 'wood' : /ファブリック|布|コーデュロイ|リネン/.test(n) ? 'fabric' : 'auto';
  return { type, finish };
}
