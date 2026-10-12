// アプリ全体のまとめ役: データの保存、画面の切り替え、設定パネル
import { STORAGE_KEY, CATALOG, COLOR_CHIPS, WALL_COLORS, FLOORS, defaultState, defaultRoom, makeFurniture, normalizeState } from './data.js';
import { create2D } from './plan2d.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = normalizeState(JSON.parse(raw));
      if (s) return s;
    }
  } catch (e) { /* 保存データが読めないときは初期状態で始める */ }
  return defaultState();
}

let saveTimer = null, cloudTimer = null;
function save({ record = true } = {}) {
  if (record) recordHistory();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    app.state.savedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state)); } catch (e) { /* 保存できない環境でも動かす */ }
    if (cloud.doc) {
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(() => {
        cloud.doc.set({ json: JSON.stringify(app.state), savedAt: app.state.savedAt }).catch(() => { /* 次の保存でまた試す */ });
      }, 1500);
    }
  }, 250);
}

// claude.ai のアーティファクトとして開いたとき用: アカウントに保存＆ファイル保存
// (GitHub Pages などで開いたときは何もしないで、ブラウザ保存だけで動く)
const cloud = { doc: null, downloads: null };
async function initCloud() {
  const c = window.claude;
  if (!c || !c.use) return;
  try {
    cloud.downloads = await c.use('downloads');
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    const id = db && user ? await user.id() : null;
    if (!id) return;
    const doc = db.collection('data/users/' + id).doc('layout');
    const snap = await doc.get();
    cloud.doc = doc;
    const d = snap.exists ? snap.data() : null;
    if (d && typeof d.json === 'string' && (d.savedAt || 0) > (app.state.savedAt || 0)) {
      const st = normalizeState(JSON.parse(d.json));
      if (st) {
        replaceState(st);
        toast('保存してあったレイアウトを読み込んだよ');
      }
    } else if (!d) {
      save(); // 初回: 今の状態をアカウント側にも保存
    }
  } catch (e) { /* 使えないときはブラウザ保存だけで続ける */ }
}

const app = {
  state: load(),
  selId: null,
  mode: '2d',
  tab: null,
  plan2d: null,
  view3d: null,
  furniture() { return app.state.plans[app.state.current].furniture; },
  selected() { return app.furniture().find(f => f.id === app.selId) || null; },
  select(id) {
    if (app.selId === id) return;
    app.selId = id;
    $('#quickTools').hidden = !id;
    app.plan2d.render();
    if (app.tab === 'item') renderSheet();
  },
  // light: ドラッグ中など。パネルは作り直さない
  changed({ light = false, keepPanel = false } = {}) {
    save({ record: !light });
    app.plan2d.render();
    app.view3d?.markDirty();
    if (!light && !keepPanel && app.tab) renderSheet();
  },
  reportStatus(bad, narrow) {
    const el = $('#status');
    const parts = [];
    if (bad) parts.push(`<span class="bad">● ぶつかっている家具: ${bad}</span>`);
    if (narrow) parts.push(`<span class="warn">⚠ 60cm未満の通路: ${narrow}か所</span>`);
    if (!bad && !narrow) parts.push('<span class="ok">✓ ぶつかり・狭い通路なし</span>');
    el.innerHTML = parts.join('');
  },
};
window.app = app; // 動作確認用

// 状態を丸ごと入れ替えたとき(読み込み・リセット・元に戻す)の画面の更新
function replaceState(st, { fit = true } = {}) {
  app.state = st;
  if (!app.selected()) { app.selId = null; $('#quickTools').hidden = true; }
  renderPlanSeg(); updateNightBtn(); app.changed();
  if (fit) app.plan2d.fit();
}

// ---------- 元に戻す / やり直す ----------
// 変更のたびに状態をまるごと文字にして積んでおく(最大80回分)
const hist = { stack: [], idx: -1, timer: null };
const snapshotState = () => { const { savedAt, ...rest } = app.state; return JSON.stringify(rest); };
function pushHistory() {
  clearTimeout(hist.timer); hist.timer = null;
  const s = snapshotState();
  if (hist.stack[hist.idx] === s) return;
  hist.stack = hist.stack.slice(0, hist.idx + 1);
  hist.stack.push(s);
  if (hist.stack.length > 80) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  updateUndoBtns();
}
function recordHistory() { clearTimeout(hist.timer); hist.timer = setTimeout(pushHistory, 350); }
function undoRedo(dir) {
  if (hist.timer) pushHistory();
  const ni = hist.idx + dir;
  if (ni < 0 || ni >= hist.stack.length) return;
  hist.idx = ni;
  replaceState({ ...JSON.parse(hist.stack[ni]), savedAt: app.state.savedAt }, { fit: false });
  updateUndoBtns();
  toast(dir < 0 ? '元に戻したよ' : 'やり直したよ');
}
function updateUndoBtns() {
  $('#undoBtn').disabled = hist.idx <= 0;
  $('#redoBtn').disabled = hist.idx >= hist.stack.length - 1;
}
$('#undoBtn').addEventListener('click', () => undoRedo(-1));
$('#redoBtn').addEventListener('click', () => undoRedo(1));

// ---------- 画面の切り替え ----------
app.plan2d = create2D($('#canvas2d'), app);

async function setMode(mode) {
  app.mode = mode;
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#view2d').classList.toggle('on', mode === '2d');
  $('#view3d').classList.toggle('on', mode === '3d');
  if (mode === '3d') {
    if (!app.view3d) {
      try {
        const { create3D } = await import('./view3d.js');
        app.view3d = create3D($('#view3d'), app);
        app.view3d.setupJoystick($('#joystick'));
        setPreset('orbit');
      } catch (e) {
        toast('3Dの読み込みに失敗したよ。ネット接続を確認してね');
        console.error(e);
        return;
      }
    }
    app.view3d.markDirty();
    app.view3d.start();
  } else {
    app.view3d?.stop();
    app.plan2d.resize();
    app.plan2d.fit();
  }
}
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

function renderPlanSeg() {
  $('#planSeg').innerHTML = Object.entries(app.state.plans)
    .map(([k, p]) => `<button data-plan="${k}" class="${k === app.state.current ? 'on' : ''}">${esc(p.name)}</button>`).join('');
}
$('#planSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.plan === app.state.current) return;
  app.state.current = b.dataset.plan;
  app.selId = null; $('#quickTools').hidden = true;
  renderPlanSeg();
  app.changed();
  toast(`${app.state.plans[app.state.current].name}に切り替えたよ`);
});

// 確認ダイアログ(ブラウザ標準の confirm が使えない環境でも動くように自前で用意)
function ask(msg, onYes) {
  const box = $('#ask');
  $('#askMsg').textContent = msg;
  box.hidden = false;
  $('#askYes').onclick = () => { box.hidden = true; onYes(); };
  $('#askNo').onclick = () => { box.hidden = true; };
}

let toastTimer;
function toast(msg) {
  // 2D表示中でも見えるように、表示中のビューに出す
  let el = $('#toast');
  const host = app.mode === '3d' ? $('#view3d') : $('#view2d');
  if (el.parentElement !== host) host.appendChild(el);
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- 家具の操作 ----------
function rotate90(f) { f.rot = (Math.round(f.rot / 90) * 90 + 90) % 360; app.changed(); }
function duplicate(f) {
  const c = { ...f, id: 'f' + Math.random().toString(36).slice(2, 9), x: f.x + 20, y: f.y + 20 };
  app.furniture().push(c); app.selId = c.id; app.changed(); toast('複製したよ');
}
function remove(f) {
  ask(`「${f.name}」を削除する？`, () => {
    const list = app.furniture();
    list.splice(list.indexOf(f), 1);
    app.select(null); app.changed();
  });
}
function addFurniture(tplObj) {
  const { room } = app.state;
  const f = makeFurniture(tplObj, Math.round(room.w / 2 / 5) * 5, Math.round(room.d * 0.55 / 5) * 5);
  if (tplObj.url) f.url = tplObj.url;
  app.furniture().push(f);
  app.selId = f.id; $('#quickTools').hidden = false;
  if (app.mode !== '2d') setMode('2d');
  app.changed();
  openTab('item');
  toast(`「${f.name}」を部屋の真ん中に置いたよ。ドラッグで動かしてね`);
}
$('#quickTools').addEventListener('click', e => {
  const b = e.target.closest('button'); const f = app.selected(); if (!b || !f) return;
  if (b.dataset.act === 'rot90') rotate90(f);
  if (b.dataset.act === 'dup') duplicate(f);
  if (b.dataset.act === 'del') remove(f);
});
$('#fitBtn').addEventListener('click', () => app.plan2d.fit());

// ---------- 3D の視点ボタン ----------
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !app.view3d) return;
  if (b.dataset.p === 'night') {
    app.state.view.night = !app.state.view.night;
    updateNightBtn(); app.changed({ keepPanel: true });
    toast(app.state.view.night ? '夜にしたよ。💡で天井の照明をつけたり消したりできるよ' : '昼にしたよ');
    return;
  }
  if (b.dataset.p === 'ceil') {
    app.state.view.ceil = !app.state.view.ceil;
    updateNightBtn(); app.changed({ keepPanel: true });
    return;
  }
  setPreset(b.dataset.p);
});
const HINTS = {
  orbit: '1本指で回す・2本指で拡大/移動・家具をタップで選択<br><span class="pc">PC: ドラッグで回転・右ドラッグで移動・ホイールで拡大</span>',
  walk: '左下のスティックで歩く・画面をドラッグで見回す<br><span class="pc">PC: WASD / 矢印キー + マウスドラッグ</span>',
};
function setPreset(p) {
  const err = app.view3d.preset(p);
  if (err) { toast(err); return; }
  document.querySelectorAll('#presets button[data-cam]').forEach(b => b.classList.toggle('cur', b.dataset.p === p));
  const h = $('#hint3d');
  h.innerHTML = HINTS[app.view3d.camMode];
  h.classList.remove('fade');
  clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.add('fade'), 7000);
}
let hintTimer;
function updateNightBtn() {
  const v = app.state.view;
  const b = $('#nightBtn');
  b.textContent = v.night ? '☀ 昼にする' : '🌙 夜にする';
  b.classList.toggle('on', v.night);
  const c = $('#ceilBtn');
  c.hidden = !v.night;
  c.textContent = v.ceil ? '💡 照明ON' : '💡 照明OFF';
  c.classList.toggle('on', v.ceil);
}
app.pick3d = id => {
  if (!id) return;
  app.select(id);
  const f = app.selected();
  if (f && app.tab !== 'item') toast(`「${f.name}」を選んだよ。「選んだ家具」で色やサイズを変えられるよ`);
};

// ---------- キーボード(PC) ----------
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  if (!$('#ask').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); undoRedo(e.shiftKey ? 1 : -1); return; }
  if (mod && k === 'y') { e.preventDefault(); undoRedo(1); return; }
  if (app.mode !== '2d') return;
  const f = app.selected();
  if (k === 'escape') { app.select(null); return; }
  if (!f || mod) return;
  const stepCm = e.shiftKey ? 1 : 5;
  const mv = { arrowleft: [-stepCm, 0], arrowright: [stepCm, 0], arrowup: [0, -stepCm], arrowdown: [0, stepCm] }[k];
  if (mv) { e.preventDefault(); f.x += mv[0]; f.y += mv[1]; app.changed(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); remove(f); return; }
  if (k === 'r') { rotate90(f); }
});

// パネルの開け閉めで表示エリアの大きさが変わったとき
function relayout() {
  app.plan2d.resize();
  app.plan2d.fit();
  app.view3d?.resize();
}

// ---------- 下のパネル ----------
const TAB_TITLES = { item: '選んだ家具', add: '家具を追加', room: '部屋の設定(作り付け・窓)', more: '見た目・保存' };
function openTab(tab) {
  app.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const wasOpen = !$('#sheet').hidden;
  $('#sheet').hidden = !tab;
  renderSheet();
  if (wasOpen !== !!tab) relayout();
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  openTab(app.tab === b.dataset.tab ? null : b.dataset.tab);
});
$('#sheetClose').addEventListener('click', () => openTab(null));

const num = (label, key, val, opt = {}) =>
  `<label class="in">${label}<input type="number" inputmode="decimal" data-k="${key}" value="${val}" step="${opt.step || 1}" ${opt.min != null ? `min="${opt.min}"` : ''}></label>`;
const txt = (label, key, val, ph = '') =>
  `<label class="in">${label}<input type="text" data-k="${key}" value="${esc(val)}" placeholder="${esc(ph)}"></label>`;

function renderSheet() {
  if (!app.tab) return;
  $('#sheetTitle').textContent = TAB_TITLES[app.tab];
  const body = $('#sheetBody');
  body.innerHTML = { item: itemPanel, add: addPanel, room: roomPanel, more: morePanel }[app.tab]();
  bindPanel(body);
}

function itemPanel() {
  const f = app.selected();
  if (!f) {
    const list = app.furniture();
    return `<p class="muted">上から見た図で家具をタップすると、ここでサイズや色を変えられるよ。</p>
      <div class="row">${list.map(i => `<button class="opt" data-select="${i.id}">${esc(i.name)}</button>`).join('') || '<span class="muted">まだ家具がないよ。「＋家具を追加」から置いてね</span>'}</div>`;
  }
  return `
    <div class="field one">${txt('名前', 'name', f.name)}</div>
    <div class="field">${num('幅 cm', 'w', f.w, { min: 1 })}${num('奥行 cm', 'd', f.d, { min: 1 })}${num('高さ cm', 'h', f.h, { min: 0 })}</div>
    <div class="field two"><label class="in">3Dでの形<select data-k="type">${SHAPES.map(([v, n]) => `<option value="${v}" ${v === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${f.type === 'sofa' || f.type === 'sofa1' ? num('座面の高さ cm', 'seat', f.seat || 41, { min: 10 }) : ''}</div>
    <label class="in">向き(回転) <b id="rotVal">${f.rot}°</b><input type="range" min="0" max="359" step="1" data-k="rot" value="${f.rot}"></label>
    <div class="row"><button class="btn" data-act="rot90">⟳ 90°回転</button><button class="btn" data-act="dup">複製</button><button class="btn danger" data-act="del">削除</button></div>
    <div class="field two">${num('位置 横(x) cm', 'x', f.x, { step: 5 })}${num('位置 縦(y) cm', 'y', f.y, { step: 5 })}</div>
    <h4>色</h4>
    <div class="chips">${COLOR_CHIPS.map(c => `<button class="chip ${c === f.color ? 'on' : ''}" style="background:${c}" data-color="${c}" aria-label="${c}"></button>`).join('')}
      <label class="in" style="width:60px">自由に<input type="color" data-k="color" value="${f.color}" style="padding:0;height:30px"></label></div>
    <div class="field one">${txt('商品URLメモ(任意)', 'url', f.url, 'https://...')}</div>
    ${f.url && /^https?:\/\//.test(f.url) ? `<p class="muted"><a href="${esc(f.url)}" target="_blank" rel="noopener">商品ページを開く ↗</a></p>` : ''}
    <p class="muted">💡 太い線のある辺が家具の「正面」だよ。ピンクの⟳をドラッグすると自由に回転できるよ。</p>`;
}

const SHAPES = [['box', '箱(棚・収納など)'], ['lowtable', 'テーブル(脚つき)'], ['roundtable', '丸テーブル'], ['desk', 'デスク'], ['bookshelf', '本棚'],
  ['sofa', 'ソファ'], ['sofa1', '1人掛けソファ'], ['bed', 'ベッド'], ['futon', 'ふとん・マット'], ['rug', 'ラグ(四角)'], ['roundrug', 'ラグ(丸)'],
  ['chair', 'イス'], ['stool', 'スツール(丸)'], ['fridge', '冷蔵庫・家電'], ['washer', '洗濯機'], ['rack', 'ラック'], ['tvstand', 'テレビ台'],
  ['dresser', 'ドレッサー'], ['mirror', '姿見・ミラー'], ['plant', '観葉植物'], ['lamp', 'フロアライト(夜に光る)']];
let customDraft = { name: '', w: 60, d: 40, h: 60, color: '#a7c4bc', type: 'box', url: '' };
function addPanel() {
  return `
    <div class="catalog">${CATALOG.map((c, i) => `<button data-add="${i}"><span>${esc(c.name)}</span><small>${c.w}×${c.d}×${c.h}</small></button>`).join('')}</div>
    <h4>自由に入力して追加</h4>
    <div class="field one">${txt('名前', 'c-name', customDraft.name, '例: 観葉植物、ゲーミングチェア')}</div>
    <div class="field">${num('幅 cm', 'c-w', customDraft.w, { min: 1 })}${num('奥行 cm', 'c-d', customDraft.d, { min: 1 })}${num('高さ cm', 'c-h', customDraft.h, { min: 0 })}</div>
    <div class="field two">
      <label class="in">3Dでの形<select data-k="c-type">${SHAPES.map(([v, n]) => `<option value="${v}" ${v === customDraft.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="in">色<input type="color" data-k="c-color" value="${customDraft.color}" style="padding:0;height:38px"></label>
    </div>
    <div class="field one">${txt('商品URLメモ(任意)', 'c-url', customDraft.url, 'https://...')}</div>
    <div class="row"><button class="btn primary" data-act="addCustom">この家具を追加する</button></div>`;
}

const KINDS = [['closet', '収納・クローゼット'], ['kitchen', 'キッチン'], ['ub', 'お風呂・トイレ'], ['washer', '洗濯機置き場'], ['storage', '下駄箱・棚'], ['entrance', '玄関(土間)'], ['wall', '柱・壁の出っぱり']];
const WALLS = [['entrance', '玄関側の壁'], ['balcony', 'ベランダ側の壁'], ['left', '左の壁(x=0)'], ['right', '右の壁']];
function roomPanel() {
  const r = app.state.room;
  return `
    <p class="muted">📐 写真から推測して置いた仮の間取りだよ。図面を見ながら数字を直してね(左上が玄関側、下がベランダ側)。</p>
    <div class="field">${num('部屋の幅 cm', 'r-w', r.w, { min: 100 })}${num('奥行 cm', 'r-d', r.d, { min: 100 })}${num('天井高 cm', 'r-h', r.h, { min: 180 })}</div>
    <div class="field two">${num('ベランダの奥行 cm', 'r-balcony', r.balcony, { min: 0 })}</div>
    <h4>作り付け(動かせないもの) — x,y は左上の角</h4>
    ${r.fixtures.map((fx, i) => `
      <div class="card" data-fx="${i}">
        <div class="card-title"><span>${esc(fx.name)}</span><button data-act="delFx" data-i="${i}">削除</button></div>
        <div class="field two">${txt('名前', 'fx-name', fx.name)}<label class="in">種類<select data-k="fx-kind">${KINDS.map(([v, n]) => `<option value="${v}" ${v === fx.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="field">${num('x', 'fx-x', fx.x, { step: 5 })}${num('y', 'fx-y', fx.y, { step: 5 })}${num('高さ', 'fx-h', fx.h, { min: 0 })}</div>
        <div class="field two">${num('幅', 'fx-w', fx.w, { min: 1 })}${num('奥行', 'fx-d', fx.d, { min: 1 })}</div>
      </div>`).join('')}
    <div class="row"><button class="btn" data-act="addFx">＋作り付けを追加</button></div>
    <h4>窓・ドア — 位置は壁の端(左 or 玄関側)からの距離</h4>
    ${r.openings.map((o, i) => `
      <div class="card" data-op="${i}">
        <div class="card-title"><span>${esc(o.name)}</span><button data-act="delOp" data-i="${i}">削除</button></div>
        <div class="field two">${txt('名前', 'op-name', o.name)}<label class="in">種類<select data-k="op-kind"><option value="window" ${o.kind === 'window' ? 'selected' : ''}>窓</option><option value="door" ${o.kind === 'door' ? 'selected' : ''}>ドア</option></select></label></div>
        <div class="field two"><label class="in">どの壁<select data-k="op-wall">${WALLS.map(([v, n]) => `<option value="${v}" ${v === o.wall ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${num('端からの距離', 'op-start', o.start, { step: 5 })}</div>
        <div class="field">${num('幅', 'op-width', o.width, { min: 10 })}${num('床からの高さ', 'op-sill', o.sill, { min: 0 })}${num('窓の高さ', 'op-height', o.height, { min: 10 })}</div>
      </div>`).join('')}
    <div class="row"><button class="btn" data-act="addOp">＋窓を追加</button></div>
    <h4>まとめて変える</h4>
    <p class="muted">図面と左右が逆になっていたら、反転すると作り付け・窓・家具がまとめて入れ替わるよ。</p>
    <div class="row"><button class="btn" data-act="flipRoom">⇆ 間取りを左右反転</button><button class="btn danger" data-act="resetRoom">間取りを最初の状態に戻す</button></div>`;
}

function morePanel() {
  const v = app.state.view;
  const otherPlans = Object.entries(app.state.plans).filter(([k]) => k !== app.state.current);
  return `
    <h4>目線の高さ <b id="eyeVal">${v.eye}cm</b></h4>
    <input type="range" min="80" max="190" step="5" data-k="eye" value="${v.eye}">
    <h4>時間帯</h4>
    <div class="row"><button class="opt ${!v.night ? 'on' : ''}" data-night="0">☀ 昼</button><button class="opt ${v.night ? 'on' : ''}" data-night="1">🌙 夜</button></div>
    <h4>壁の色</h4>
    <div class="row">${WALL_COLORS.map((w, i) => `<button class="opt ${i === v.wall ? 'on' : ''}" data-wall="${i}"><span class="dot" style="background:${w.color}"></span> ${w.name}</button>`).join('')}
      <label class="opt pick ${v.wall < 0 ? 'on' : ''}"><span class="dot" style="background:${v.wallColor}"></span> 好きな色<input type="color" data-k="wallColor" value="${v.wallColor}"></label></div>
    <h4>床の素材</h4>
    <div class="row">${FLOORS.map((f, i) => `<button class="opt ${i === v.floor ? 'on' : ''}" data-floor="${i}"><span class="dot sq" style="background:${f.base}"></span> ${f.name}</button>`).join('')}
      <label class="opt pick ${v.floor < 0 ? 'on' : ''}"><span class="dot sq" style="background:${v.floorColor}"></span> 好きな色<input type="color" data-k="floorColor" value="${v.floorColor}"></label></div>
    <h4>夜の照明</h4>
    <div class="row"><button class="opt ${!v.ceil ? 'on' : ''}" data-ceil="0">間接照明だけ</button><button class="opt ${v.ceil ? 'on' : ''}" data-ceil="1">💡 天井の照明もつける</button></div>
    <p class="muted">「フロアライト」を置くと、夜はその場所が光るよ。</p>
    <p class="muted">ラグの色は、ラグを選んで「選んだ家具」の色から変えられるよ。</p>
    <h4>レイアウト案</h4>
    <div class="field two">${txt('今の案の名前', 'planName', app.state.plans[app.state.current].name)}</div>
    <div class="row">${otherPlans.map(([k, p]) => `<button class="btn" data-copyto="${k}">今の案を「${esc(p.name)}」にコピー</button>`).join('')}</div>
    <h4>画像で保存</h4>
    <div class="row"><button class="btn primary" data-act="png">📷 今の画面をPNGで保存</button></div>
    <h4>データ</h4>
    <p class="muted">データは自動保存されるよ。claude.aiで開いているときはアカウントにも保存されるから、別の端末でも続きができるよ。</p>
    <div class="row"><button class="btn" data-act="export">バックアップを書き出す</button><label class="btn">読み込む<input type="file" accept="application/json" data-act="import" hidden></label></div>
    <div class="row"><button class="btn danger" data-act="resetAll">全部リセット</button></div>`;
}

function bindPanel(body) {
  body.oninput = e => {
    const k = e.target.dataset.k; if (!k) return;
    const raw = e.target.value;
    const n = parseFloat(raw);
    const f = app.selected();
    const r = app.state.room;
    if (app.tab === 'item' && f) {
      if (['w', 'd', 'h', 'x', 'y', 'seat', 'rot'].includes(k)) { if (isNaN(n)) return; f[k] = k === 'w' || k === 'd' ? Math.max(1, n) : n; }
      else if (k === 'type') { f.type = raw; app.changed(); return; }
      else f[k] = raw;
      if (k === 'rot') $('#rotVal').textContent = `${f.rot}°`;
      if (k === 'color') body.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.color === raw));
      app.changed({ keepPanel: true });
    } else if (app.tab === 'add') {
      const key = k.slice(2);
      customDraft[key] = ['w', 'd', 'h'].includes(key) ? (isNaN(n) ? customDraft[key] : n) : raw;
    } else if (app.tab === 'room') {
      if (k.startsWith('r-')) { if (isNaN(n)) return; r[k.slice(2)] = n; }
      else if (k.startsWith('fx-')) {
        const fx = r.fixtures[+e.target.closest('[data-fx]').dataset.fx];
        const key = k.slice(3);
        if (['name', 'kind'].includes(key)) fx[key] = raw; else { if (isNaN(n)) return; fx[key] = n; }
        if (key === 'name') e.target.closest('.card').querySelector('.card-title span').textContent = raw;
      } else if (k.startsWith('op-')) {
        const o = r.openings[+e.target.closest('[data-op]').dataset.op];
        const key = k.slice(3);
        if (['name', 'kind', 'wall'].includes(key)) o[key] = raw; else { if (isNaN(n)) return; o[key] = n; }
        if (key === 'name') e.target.closest('.card').querySelector('.card-title span').textContent = raw;
      }
      app.changed({ keepPanel: true });
    } else if (app.tab === 'more') {
      if (k === 'eye') { app.state.view.eye = n; $('#eyeVal').textContent = `${n}cm`; app.view3d?.resetEye(); save(); }
      if (k === 'planName') { app.state.plans[app.state.current].name = raw || '案'; renderPlanSeg(); save(); }
      if (k === 'wallColor') { app.state.view.wall = -1; app.state.view.wallColor = raw; app.changed({ keepPanel: true }); markPick(e.target); }
      if (k === 'floorColor') { app.state.view.floor = -1; app.state.view.floorColor = raw; app.changed({ keepPanel: true }); markPick(e.target); }
    }
  };
  body.onchange = e => {
    if (e.target.dataset.act === 'import') importFile(e.target.files[0]);
    // 種類の変更や名前の確定は一覧の表示に反映
    if (app.tab === 'item' && e.target.dataset.k === 'name') renderSheet();
  };
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const f = app.selected();
    const r = app.state.room;
    const v = app.state.view;
    if (b.dataset.select) { app.select(b.dataset.select); return; }
    if (b.dataset.color && f) { f.color = b.dataset.color; app.changed(); return; }
    if (b.dataset.add != null) { addFurniture(CATALOG[+b.dataset.add]); return; }
    if (b.dataset.night != null) { v.night = b.dataset.night === '1'; updateNightBtn(); app.changed(); return; }
    if (b.dataset.wall != null) { v.wall = +b.dataset.wall; app.changed(); return; }
    if (b.dataset.floor != null) { v.floor = +b.dataset.floor; app.changed(); return; }
    if (b.dataset.ceil != null) { v.ceil = b.dataset.ceil === '1'; updateNightBtn(); app.changed(); return; }
    if (b.dataset.copyto) {
      const to = app.state.plans[b.dataset.copyto];
      ask(`「${to.name}」を今の案で上書きする？`, () => {
        to.furniture = JSON.parse(JSON.stringify(app.furniture()));
        save(); toast(`「${to.name}」にコピーしたよ`);
      });
      return;
    }
    switch (b.dataset.act) {
      case 'rot90': rotate90(f); break;
      case 'dup': duplicate(f); break;
      case 'del': remove(f); break;
      case 'addCustom': {
        if (!customDraft.name.trim()) { toast('名前を入れてね'); return; }
        const t = { ...customDraft, name: customDraft.name.trim() };
        const added = { ...t };
        addFurniture(added);
        const nf = app.selected(); if (nf) { nf.url = t.url || ''; save(); }
        customDraft = { name: '', w: 60, d: 40, h: 60, color: '#a7c4bc', type: 'box', url: '' };
        break;
      }
      case 'addFx': r.fixtures.push({ id: 'fx' + Date.now(), kind: 'closet', name: '収納', x: 0, y: 200, w: 60, d: 45, h: 180 }); app.changed(); break;
      case 'delFx': ask('この作り付けを削除する？', () => { r.fixtures.splice(+b.dataset.i, 1); app.changed(); }); break;
      case 'addOp': r.openings.push({ id: 'op' + Date.now(), kind: 'window', name: '窓', wall: 'right', start: 300, width: 90, sill: 90, height: 100 }); app.changed(); break;
      case 'delOp': ask('この窓・ドアを削除する？', () => { r.openings.splice(+b.dataset.i, 1); app.changed(); }); break;
      case 'resetRoom': ask('間取りを最初の状態に戻す？(家具はそのまま)', () => { app.state.room = defaultRoom(); app.changed(); app.plan2d.fit(); }); break;
      case 'flipRoom': flipRoom(); app.changed(); toast('左右を反転したよ。戻すときはもう一度押してね'); break;
      case 'resetAll': ask('家具・間取り・案A〜Cを全部リセットする？(↶で元に戻せるよ)', () => { replaceState(defaultState()); }); break;
      case 'png': savePng(); break;
      case 'export': exportJson(); break;
    }
  };
}

async function downloadBlob(blob, name, okMsg) {
  if (cloud.downloads) {
    try { await cloud.downloads.save({ filename: name, data: blob }); toast(okMsg); }
    catch (e) { if (e && e.code !== 'declined') toast('保存できなかったよ…もう一度試してね'); }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(okMsg);
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
function savePng() {
  const dataUrl = app.mode === '3d' && app.view3d ? app.view3d.snapshot() : $('#canvas2d').toDataURL('image/png');
  fetch(dataUrl).then(r => r.blob()).then(blob =>
    downloadBlob(blob, `room-layout_${app.state.current}_${app.mode === '3d' ? '3D' : '2D'}_${stamp()}.png`, '画像を保存したよ📷'));
}
function exportJson() {
  const blob = new Blob([JSON.stringify(app.state, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `room-layout-backup_${stamp()}.json`, 'バックアップを保存したよ');
}
function importFile(file) {
  if (!file) return;
  file.text().then(t => {
    const s = normalizeState(JSON.parse(t));
    if (!s) throw new Error('形式が違う');
    ask('今のレイアウトを、このバックアップで置きかえる？', () => { replaceState(s); toast('読み込んだよ'); });
  }).catch(() => toast('読み込めなかったよ…このアプリで書き出したファイルか確認してね'));
}

// 色を自由に選んだとき、ボタンの見た目だけ更新(パネルを作り直すと色選びが閉じちゃうので)
function markPick(input) {
  const row = input.closest('.row');
  row.querySelectorAll('.opt').forEach(o => o.classList.remove('on'));
  const lab = input.closest('.pick');
  lab.classList.add('on');
  lab.querySelector('.dot').style.background = input.value;
}

// 間取りを左右反転(作り付け・窓・すべての案の家具)
function flipRoom() {
  const r = app.state.room;
  for (const fx of r.fixtures) fx.x = r.w - fx.x - fx.w;
  for (const o of r.openings) {
    if (o.wall === 'left') o.wall = 'right';
    else if (o.wall === 'right') o.wall = 'left';
    else o.start = r.w - o.start - o.width;
  }
  for (const p of Object.values(app.state.plans)) {
    for (const f of p.furniture) { f.x = r.w - f.x; f.rot = (360 - f.rot) % 360; }
  }
}

// ---------- 起動 ----------
renderPlanSeg();
updateNightBtn();
pushHistory();
requestAnimationFrame(() => app.plan2d.resize());
initCloud();

// オフラインでも開けるように(GitHub Pages などで公開したとき)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.claude) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 使えなくても普通に動く */ });
}
