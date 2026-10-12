// アプリ全体のまとめ役: データの保存、画面の切り替え、設定パネル
import {
  STORAGE_KEY, STORE_KEY, CATALOG, COLOR_CHIPS, WALL_COLORS, FLOORS, WALL_FINISHES, FINISHES,
  defaultState, defaultRoom, blankRoom, defaultStore, normalizeStore, makeFurniture, newId, parseSize,
} from './data.js';
import { create2D, drawThumb } from './plan2d.js';
import { analyze, isFlat, isWallHung, bbox, corners } from './geom.js';
import { readProduct, analyzeImage, fileToDataUrl } from './importer.js';
import { putImage, getImage, delImage } from './imagestore.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- 保存 ----------
// store = { current: 部屋のid, rooms: [{ id, name, state }] }。app.state は「今の部屋」の state
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (raw) { const s = normalizeStore(JSON.parse(raw)); if (s) return s; }
  } catch (e) { /* 保存データが読めないときは初期状態で始める */ }
  return defaultStore();
}
const store = loadStore();
const curRoom = () => store.rooms.find(r => r.id === store.current) || store.rooms[0];

let saveTimer = null, cloudTimer = null, warnedFull = false;
function save({ record = true } = {}) {
  if (record) recordHistory();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.savedAt = Date.now();
    curRoom().state = app.state;
    const json = JSON.stringify(store);
    try { localStorage.setItem(STORE_KEY, json); }
    catch (e) { if (!warnedFull) { warnedFull = true; toast('保存できる容量がいっぱいかも…家具の写真を減らすか、バックアップを書き出してね'); } }
    if (cloud.doc) {
      clearTimeout(cloudTimer);
      cloudTimer = setTimeout(() => {
        cloud.doc.set({ json, savedAt: store.savedAt }).catch(() => { /* 次の保存でまた試す */ });
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
    if (d && typeof d.json === 'string' && (d.savedAt || 0) > (store.savedAt || 0)) {
      const st = normalizeStore(JSON.parse(d.json));
      if (st) { Object.assign(store, st); app.state = curRoom().state; switchRoom(store.current, { quiet: true }); toast('保存してあったレイアウトを読み込んだよ'); }
    } else if (!d) {
      save();
    }
  } catch (e) { /* 使えないときはブラウザ保存だけで続ける */ }
}

const app = {
  state: curRoom().state,
  selId: null,
  mode: '2d',
  tab: null,
  plan2d: null,
  view3d: null,
  underlayImg: null,
  furniture() { return app.state.plans[app.state.current].furniture; },
  selected() { return app.furniture().find(f => f.id === app.selId) || null; },
  // 作り付け・窓ドアも、図をタップして選べる
  selFx: null, selOp: null,
  selectedFx() { return app.state.room.fixtures.find(f => f.id === app.selFx) || null; },
  selectedOp() { return app.state.room.openings.find(o => o.id === app.selOp) || null; },
  select(id) { setSel(id, null, null); },
  selectFx(id) { setSel(null, id, null); },
  selectOp(id) { setSel(null, null, id); },
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
  curRoom().state = st;
  if (!app.selected()) app.selId = null;
  if (!app.selectedFx()) app.selFx = null;
  if (!app.selectedOp()) app.selOp = null;
  refreshQuick();
  renderPlanSeg(); renderRoomBar(); updateNightBtn(); loadUnderlay(); app.changed();
  if (fit) app.plan2d.fit();
}

// ---------- 元に戻す / やり直す ----------
// 変更のたびに状態をまるごと文字にして積んでおく(最大80回分)。部屋を切り替えたらリセット
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
function resetHistory() { clearTimeout(hist.timer); hist.timer = null; hist.stack = []; hist.idx = -1; pushHistory(); }
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
  if (mode === '3d' && app.plan2d.tool) endTool();
  app.mode = mode;
  // 家具の操作ボタンは、表示中の画面(2D/3D)に出す
  $(mode === '3d' ? '#view3d' : '#view2d').appendChild($('#quickTools'));
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#view2d').classList.toggle('on', mode === '2d');
  $('#view3d').classList.toggle('on', mode === '3d');
  if (mode === '3d') {
    if (!app.view3d) {
      try {
        $('#loading3d').hidden = false;
        const { create3D } = await import('./view3d.js');
        app.view3d = create3D($('#view3d'), app);
        app.view3d.setupJoystick($('#joystick'));
        setPreset('orbit');
      } catch (e) {
        toast('3Dの読み込みに失敗したよ。ネット接続を確認してね');
        console.error(e);
        return;
      } finally { $('#loading3d').hidden = true; }
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
    .map(([k, p]) => `<button data-plan="${k}" class="${k === app.state.current ? 'on' : ''}">${esc(p.name)}</button>`).join('')
    + '<button data-compare="1" class="cmp" title="案を並べて比べる" aria-label="案を並べて比べる">⇔</button>';
}
$('#planSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.compare) { openCompare(); return; }
  switchPlan(b.dataset.plan);
});
function switchPlan(k) {
  if (k === app.state.current || !app.state.plans[k]) return;
  app.state.current = k;
  setSel(null, null, null, { quiet: true });
  renderPlanSeg();
  app.changed();
  toast(`${app.state.plans[app.state.current].name}に切り替えたよ`);
}

// ---------- いくつもの部屋 ----------
function renderRoomBar() { $('#roomName').textContent = curRoom().name; }
$('#roomBtn').addEventListener('click', () => openTab(app.tab === 'room' ? null : 'room'));
function switchRoom(id, { quiet = false } = {}) {
  if (!store.rooms.some(r => r.id === id)) return;
  if (store.current !== id) curRoom().state = app.state;
  store.current = id;
  if (app.plan2d.tool) { app.plan2d.setTool(null); $('#toolbar').hidden = true; }
  app.state = curRoom().state;
  setSel(null, null, null, { quiet: true });
  renderPlanSeg(); renderRoomBar(); updateNightBtn(); loadUnderlay();
  app.changed();
  resetHistory();
  app.plan2d.fit();
  if (app.view3d) setPreset('orbit');
  if (!quiet) toast(`「${curRoom().name}」に切り替えたよ`);
}
function addRoom(copyLayout) {
  const cur = curRoom();
  let st;
  if (copyLayout) st = clone(app.state);
  else {
    // 新しい部屋: 間取りはシンプルに、家具は今の案から持っていく
    st = defaultState();
    st.room = blankRoom(300, 600);
    st.view = clone(app.state.view);
    st.plans = clone(app.state.plans);
    st.current = app.state.current;
    st.underlay = null;
    // 部屋の大きさに合わせて位置を縮めて、はみ出さないように寄せる
    const kx = st.room.w / app.state.room.w, ky = st.room.d / app.state.room.d;
    for (const p of Object.values(st.plans)) for (const f of p.furniture) {
      f.x *= kx; f.y *= ky;
      const b = bbox(corners(f));
      if (b.minX < 0) f.x -= b.minX; else if (b.maxX > st.room.w) f.x -= b.maxX - st.room.w;
      if (b.minY < 0) f.y -= b.minY; else if (b.maxY > st.room.d) f.y -= b.maxY - st.room.d;
      f.x = Math.round(f.x); f.y = Math.round(f.y);
    }
  }
  const id = newId('r');
  const name = copyLayout ? cur.name + 'のコピー' : `新しい部屋${store.rooms.length + 1}`;
  store.rooms.push({ id, name, state: st });
  switchRoom(id, { quiet: true });
  toast(copyLayout ? 'お部屋をコピーしたよ' : '新しい部屋を作ったよ。間取り図をなぞるか、数字で広さや窓を直してね', 4000);
}
function deleteRoom(id) {
  if (store.rooms.length <= 1) { toast('部屋が1つだけのときは消せないよ'); return; }
  const r = store.rooms.find(x => x.id === id);
  ask(`「${r.name}」を削除する？(元に戻せないよ)`, () => {
    store.rooms = store.rooms.filter(x => x.id !== id);
    const uid = r.state.underlay && r.state.underlay.id;
    if (uid && !store.rooms.some(x => x.state.underlay && x.state.underlay.id === uid)) delImage(uid);
    if (store.current === id) { store.current = store.rooms[0].id; app.state = curRoom().state; switchRoom(store.current, { quiet: true }); }
    save(); renderSheet(); toast('削除したよ');
  });
}

// 確認ダイアログ(ブラウザ標準の confirm が使えない環境でも動くように自前で用意)
// input を渡すと数字などを入れてもらえる
function ask(msg, onYes, input = null) {
  const box = $('#ask');
  $('#askMsg').textContent = msg;
  const inp = $('#askInput');
  inp.hidden = !input;
  if (input) { inp.type = input.type || 'text'; inp.value = input.value ?? ''; inp.placeholder = input.placeholder || ''; setTimeout(() => inp.focus(), 50); }
  box.hidden = false;
  $('#askYes').onclick = () => { box.hidden = true; onYes(input ? inp.value : undefined); };
  $('#askNo').onclick = () => { box.hidden = true; };
}

let toastTimer;
function toast(msg, ms = 2800) {
  // 2D表示中でも見えるように、表示中のビューに出す
  const el = $('#toast');
  const host = app.mode === '3d' ? $('#view3d') : $('#view2d');
  if (el.parentElement !== host) host.appendChild(el);
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- 家具の操作 ----------
function rotate90(f) { f.rot = (Math.round(f.rot / 90) * 90 + 90) % 360; app.changed(); }
function duplicate(f) {
  const c = { ...clone(f), id: 'f' + Math.random().toString(36).slice(2, 9), x: f.x + 20, y: f.y + 20 };
  app.furniture().push(c); setSel(c.id, null, null, { quiet: true }); app.changed(); toast('複製したよ');
}
function remove(f) {
  ask(`「${f.name}」を削除する？`, () => {
    const list = app.furniture();
    list.splice(list.indexOf(f), 1);
    app.select(null); app.changed();
  });
}
function addFurniture(tplObj, { quiet = false } = {}) {
  const { room } = app.state;
  const f = makeFurniture(tplObj, Math.round(room.w / 2 / 5) * 5, Math.round(room.d * 0.55 / 5) * 5);
  app.furniture().push(f);
  setSel(f.id, null, null, { quiet: true });
  if (app.mode !== '2d') setMode('2d');
  app.changed();
  openTab('item');
  if (!quiet) toast(`「${f.name}」を部屋の真ん中に置いたよ。ドラッグで動かしてね`);
  return f;
}
// 選ぶものを切り替える(家具 / 作り付け / 窓・ドア のどれか1つ)
function setSel(fid, fxid, opid, { quiet = false } = {}) {
  if (app.selId === fid && app.selFx === fxid && app.selOp === opid) return;
  app.selId = fid; app.selFx = fxid; app.selOp = opid;
  refreshQuick();
  if (quiet) return;
  app.plan2d.render();
  app.view3d?.markSel?.();
  if (app.tab === 'item') renderSheet();
}
// 図の下に出る小さな操作ボタン(選んだものに合わせて中身を変える)
function refreshQuick() {
  const q = $('#quickTools');
  const f = app.selected(), fx = app.selectedFx(), op = app.selectedOp();
  q.hidden = !(f || fx || op);
  if (f) q.innerHTML = '<button data-act="rot90" title="90度回転 (R)">⟳ 90°</button><button data-act="dup">複製</button><button data-act="edit">✎ 詳しく</button><button data-act="del" class="danger">削除</button>';
  else if (fx) q.innerHTML = `<select data-act="fxKind" aria-label="種類">${KINDS.map(([v, n]) => `<option value="${v}" ${v === fx.kind ? 'selected' : ''}>${n}</option>`).join('')}</select>`
    + '<button data-act="rot90" title="90度回転 (R)">⟳ 90°</button><button data-act="dup">複製</button><button data-act="edit">✎</button><button data-act="del" class="danger">削除</button>';
  else if (op) q.innerHTML = `<button data-act="opKind">${op.kind === 'door' ? '🚪 ドア → 窓にする' : '🪟 窓 → ドアにする'}</button><button data-act="edit">✎ 詳しく</button><button data-act="del" class="danger">削除</button>`;
  else q.innerHTML = '';
}
$('#quickTools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const f = app.selected(), fx = app.selectedFx(), op = app.selectedOp();
  const act = b.dataset.act;
  if (act === 'edit') { openTab('item'); return; }
  if (f) {
    if (act === 'rot90') rotate90(f);
    if (act === 'dup') duplicate(f);
    if (act === 'del') remove(f);
  } else if (fx) {
    if (act === 'rot90') rotateFx(fx);
    if (act === 'dup') duplicateFx(fx);
    if (act === 'del') removeFx(fx);
  } else if (op) {
    if (act === 'opKind') { toggleOpKind(op); }
    if (act === 'del') removeOp(op);
  }
});
$('#quickTools').addEventListener('change', e => {
  const fx = app.selectedFx();
  if (fx && e.target.dataset.act === 'fxKind') setFxKind(fx, e.target.value);
});

// ---------- 作り付け・窓ドアの操作 ----------
function setFxKind(fx, kind) {
  const names = KINDS.map(k => k[1]).concat(Object.values(FX_KIND_DEFAULT).map(v => v[0]), ['収納', 'クローゼット']);
  const [name, hgt] = FX_KIND_DEFAULT[kind];
  // 名前を自分で変えていなければ、種類に合わせた名前・高さにする
  if (names.includes(fx.name) || /^収納|^作り付け/.test(fx.name)) fx.name = name;
  if (kind === 'entrance' || kind === 'washer') fx.h = hgt; else if (!fx.h || fx.kind === 'entrance' || fx.kind === 'washer') fx.h = hgt;
  fx.kind = kind;
  app.changed(); refreshQuick();
  toast(`「${KINDS.find(k => k[0] === kind)[1]}」にしたよ`, 1500);
}
function rotateFx(fx) {
  // 真ん中を中心に90度回す(幅と奥行が入れかわる)
  const cx = fx.x + fx.w / 2, cy = fx.y + fx.d / 2;
  [fx.w, fx.d] = [fx.d, fx.w];
  fx.x = Math.round(cx - fx.w / 2); fx.y = Math.round(cy - fx.d / 2);
  app.changed();
}
function duplicateFx(fx) {
  const c = { ...clone(fx), id: newId('fx'), x: fx.x + 20, y: fx.y + 20 };
  app.state.room.fixtures.push(c); setSel(null, c.id, null, { quiet: true }); app.changed(); toast('複製したよ');
}
function removeFx(fx) {
  const list = app.state.room.fixtures;
  list.splice(list.indexOf(fx), 1);
  setSel(null, null, null, { quiet: true }); app.changed(); toast(`「${fx.name}」を削除したよ(↶で戻せるよ)`);
}
function toggleOpKind(op) {
  const door = op.kind !== 'door';
  op.kind = door ? 'door' : 'window';
  if (/^(窓|ドア)$/.test(op.name)) op.name = door ? 'ドア' : '窓';
  if (door) { op.sill = 0; op.height = 200; } else if (op.wall !== 'balcony') { op.sill = 90; op.height = 110; }
  app.changed(); refreshQuick();
}
function removeOp(op) {
  const list = app.state.room.openings;
  list.splice(list.indexOf(op), 1);
  setSel(null, null, null, { quiet: true }); app.changed(); toast(`「${op.name}」を削除したよ(↶で戻せるよ)`);
}
$('#fitBtn').addEventListener('click', () => app.plan2d.fit());
document.querySelectorAll('[data-shot]').forEach(b => b.addEventListener('click', () => savePng(true)));

// ---------- 商品URLから読み取る ----------
let reading = false;
async function readUrlInto(url, f) {
  if (reading) return;
  reading = true;
  toast('商品ページを読み取り中…(10〜30秒くらいかかるよ)', 60000);
  renderSheet();
  try {
    const p = await readProduct(url.trim());
    const target = f || addFurniture({ type: p.type, name: p.name || '新しい家具', w: 60, d: 40, h: 60, color: p.color || '#a7c4bc', finish: p.finish, url }, { quiet: true });
    const got = [];
    if (p.name) { target.name = p.name; got.push('名前'); }
    if (p.size) {
      target.w = p.size.w; target.d = p.size.d; if (p.size.h) target.h = p.size.h;
      got.push(`サイズ(${p.size.w}×${p.size.d}${p.size.h ? '×' + p.size.h : ''}cm)`);
    }
    if (p.type && p.type !== 'box' && (!f || f.type === 'box')) target.type = p.type;
    if (p.finish && p.finish !== 'auto') { target.finish = p.finish; got.push('素材'); }
    if (p.color) { target.color = p.color; got.push('色'); }
    if (p.photo) target.photo = p.photo;
    target.url = url.trim();
    if (target.type === 'sofa' || target.type === 'sofa1') target.seat = target.seat || 40;
    setSel(target.id, null, null, { quiet: true });
    app.changed();
    if (p.size) toast(got.length ? `読み取れたよ✨ ${got.join('・')}。違うところは手で直してね` : '読み取れる情報が見つからなかったよ', 5000);
    else toast('サイズが見つからなかったよ。商品ページのサイズ表記をコピーして「サイズ表記から読み取る」に貼ってみてね', 6000);
  } catch (e) {
    toast(e.message || '読み取れなかったよ', 5000);
  } finally {
    reading = false;
    renderSheet();
  }
}

// ---------- 3D の視点ボタン・照明 ----------
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !app.view3d) return;
  if (b.dataset.p === 'light') { cycleLight(); return; }
  setPreset(b.dataset.p);
});
$('#lightFab').addEventListener('click', cycleLight);
$('#zoomIn').addEventListener('click', () => app.view3d?.zoom(1));
$('#zoomOut').addEventListener('click', () => app.view3d?.zoom(-1));
app.toast3d = msg => toast(msg, 1500);
// 照明をワンタップで切り替え: 昼 → 夜(間接照明) → 夜(天井の照明ON) → 昼…
function cycleLight() {
  const v = app.state.view;
  if (!v.night) { v.night = true; v.ceil = false; }
  else if (!v.ceil) v.ceil = true;
  else { v.night = false; v.ceil = false; }
  updateNightBtn(); app.changed({ keepPanel: app.tab !== 'more' });
  toast(!v.night ? '☀ 昼' : v.ceil ? '💡 夜・天井の照明ON' : '🌙 夜・間接照明', 1500);
}
const HINTS = {
  orbit: 'ドラッグで回す・左下のスティックで視点を移動・＋－で拡大<br>床をダブルタップでそこを中心に・家具はタップで選んでドラッグで動かせるよ<br><span class="pc">PC: WASDで移動・Q/Eで拡大縮小・右ドラッグでも移動・ホイールで拡大</span>',
  walk: '左下のスティックで歩く・画面をドラッグで見回す・床をダブルタップでそこへ移動<br>家具はタップで選んでドラッグで動かせるよ<br><span class="pc">PC: WASD / 矢印キー + マウスドラッグ</span>',
};
let hintTimer;
function setPreset(p) {
  const err = app.view3d.preset(p);
  if (err) { toast(err); return; }
  document.querySelectorAll('#presets button[data-cam]').forEach(b => b.classList.toggle('cur', b.dataset.p === p));
  const h = $('#hint3d');
  h.innerHTML = HINTS[app.view3d.camMode];
  h.classList.remove('fade');
  clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.add('fade'), 9000);
}
function updateNightBtn() {
  const v = app.state.view;
  const label = !v.night ? '☀ 昼' : v.ceil ? '💡 夜・照明ON' : '🌙 夜・間接照明';
  const b = $('#lightBtn');
  b.textContent = label;
  b.classList.toggle('on', v.night);
  const f = $('#lightFab');
  f.textContent = !v.night ? '☀' : v.ceil ? '💡' : '🌙';
  f.classList.toggle('on', v.night);
  f.title = label + '(タップで切り替え)';
}
app.pick3d = id => {
  if (!id) { if (app.selId) app.select(null); return; }
  app.select(id);
  const f = app.selected();
  if (f && app.tab !== 'item') toast(`「${f.name}」を選んだよ。そのままドラッグで動かせるよ`);
};

// ---------- キーボード(PC) ----------
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  if (!$('#ask').hidden) return;
  if (!$('#compare').hidden) { if (e.key === 'Escape') closeCompare(); return; }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); undoRedo(e.shiftKey ? 1 : -1); return; }
  if (mod && k === 'y') { e.preventDefault(); undoRedo(1); return; }
  if (k === 'p' && !mod) { savePng(true); return; }
  if (k === 'l' && !mod) { cycleLight(); return; }
  if (app.mode !== '2d') return;
  const f = app.selected(), fx = app.selectedFx(), op = app.selectedOp();
  if (k === 'escape') { if (app.plan2d.tool) endTool(); else app.select(null); return; }
  if (!(f || fx || op) || mod) return;
  const stepCm = e.shiftKey ? 1 : 5;
  const mv = { arrowleft: [-stepCm, 0], arrowright: [stepCm, 0], arrowup: [0, -stepCm], arrowdown: [0, stepCm] }[k];
  if (mv) {
    e.preventDefault();
    if (op) op.start += (op.wall === 'left' || op.wall === 'right') ? mv[1] : mv[0];
    else { const t = f || fx; t.x += mv[0]; t.y += mv[1]; }
    app.changed(); return;
  }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (f) remove(f); else if (fx) removeFx(fx); else removeOp(op); return; }
  if (k === 'r') { if (f) rotate90(f); else if (fx) rotateFx(fx); }
});

// パネルの開け閉めで表示エリアの大きさが変わったとき
function relayout() {
  app.plan2d.resize();
  app.plan2d.fit();
  app.view3d?.resize();
}

// ---------- 下のパネル ----------
const TAB_TITLES = { item: '選んだもの', add: '家具を追加', room: 'お部屋・間取り', more: '見た目・保存' };
function openTab(tab) {
  app.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const wasOpen = !$('#sheet').hidden;
  $('#sheet').hidden = !tab;
  document.body.classList.toggle('sheet-open', !!tab);
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
  const top = body.scrollTop;
  body.innerHTML = { item: itemPanel, add: addPanel, room: roomPanel, more: morePanel }[app.tab]();
  body.scrollTop = top;
  bindPanel(body);
}

const SHAPES = [['box', '箱(棚・収納など)'], ['lowtable', 'テーブル(脚つき)'], ['roundtable', '丸テーブル'], ['desk', 'デスク'], ['bookshelf', '本棚'],
  ['sofa', 'ソファ'], ['sofa1', '1人掛けソファ'], ['bed', 'ベッド'], ['futon', 'ふとん・マット'], ['rug', 'ラグ(四角)'], ['roundrug', 'ラグ(丸)'],
  ['chair', 'イス'], ['stool', 'スツール(丸)'], ['fridge', '冷蔵庫・家電'], ['washer', '洗濯機'], ['rack', 'ラック'], ['tvstand', 'テレビ台'],
  ['dresser', 'ドレッサー'], ['mirror', '姿見・ミラー'], ['plant', '観葉植物'], ['lamp', 'フロアライト(夜に光る)'], ['art', 'アート・ポスター(壁掛け)'], ['curtain', 'カーテン']];
const PHOTO_TYPES = ['rug', 'roundrug', 'art'];

function itemPanel() {
  const fx = app.selectedFx(), op = app.selectedOp();
  if (fx) return fxCard(fx, app.state.room.fixtures.indexOf(fx), true);
  if (op) return opCard(op, app.state.room.openings.indexOf(op), true);
  const f = app.selected();
  if (!f) {
    const list = app.furniture();
    return `<p class="muted">上から見た図で家具・作り付け・窓をタップすると、ここで細かく変えられるよ。図の上でも、ドラッグで動かす・角の□で大きさを変える・ピンクの⟳で回転ができるよ。</p>
      <div class="row">${list.map(i => `<button class="opt" data-select="${i.id}">${esc(i.name)}</button>`).join('') || '<span class="muted">まだ家具がないよ。「＋家具を追加」から置いてね</span>'}</div>`;
  }
  return `
    <div class="urlbox">
      <div class="field one">${txt('🔗 商品URL', 'url', f.url, 'https://... (ニトリ・LOWYA・楽天など)')}</div>
      <div class="row"><button class="btn primary" data-act="readUrl" ${reading ? 'disabled' : ''}>${reading ? '読み取り中…' : '🔍 URLから名前・サイズ・色を読み取る'}</button>
        ${f.url && /^https?:\/\//.test(f.url) ? `<a class="btn" href="${esc(f.url)}" target="_blank" rel="noopener">商品ページ ↗</a>` : ''}</div>
      <details><summary class="muted">うまく読み取れないときは(サイズ表記を貼り付け)</summary>
        <label class="in">商品ページの「サイズ」の文字をコピーして貼り付けてね<textarea data-k="sizeText" rows="2" placeholder="例: 幅180×奥行41.8×高さ36.4cm"></textarea></label>
        <div class="row"><button class="btn" data-act="parseSize">サイズ表記から読み取る</button></div>
      </details>
    </div>
    ${f.photo ? `<div class="photo-row"><img src="${f.photo}" alt=""><div class="muted">商品の写真から色を拾ったよ。${PHOTO_TYPES.includes(f.type) ? '3Dではこの写真の柄がそのまま貼られるよ。' : ''}<br><button class="link" data-act="clearPhoto">写真を外す</button></div></div>` : ''}
    <div class="field one">${txt('名前', 'name', f.name)}</div>
    <div class="field">${num('幅 cm', 'w', f.w, { min: 1 })}${num('奥行 cm', 'd', f.d, { min: 1 })}${num('高さ cm', 'h', f.h, { min: 0 })}</div>
    <div class="field two"><label class="in">3Dでの形<select data-k="type">${SHAPES.map(([v, n]) => `<option value="${v}" ${v === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="in">素材(質感)<select data-k="finish">${FINISHES.map(o => `<option value="${o.id}" ${o.id === (f.finish || 'auto') ? 'selected' : ''}>${o.name}</option>`).join('')}</select></label></div>
    ${f.type === 'sofa' || f.type === 'sofa1' ? `<div class="field two">${num('座面の高さ cm', 'seat', f.seat || 41, { min: 10 })}</div>` : ''}
    ${f.type === 'art' ? `<div class="field two">${num('床から下の辺まで cm', 'elev', f.elev || 110, { min: 0, step: 5 })}</div>` : ''}
    <label class="in">向き(回転) <b id="rotVal">${f.rot}°</b><input type="range" min="0" max="359" step="1" data-k="rot" value="${f.rot}"></label>
    <div class="row"><button class="btn" data-act="rot90">⟳ 90°回転</button><button class="btn" data-act="dup">複製</button><button class="btn danger" data-act="del">削除</button></div>
    <div class="field two">${num('位置 横(x) cm', 'x', f.x, { step: 5 })}${num('位置 縦(y) cm', 'y', f.y, { step: 5 })}</div>
    <h4>色</h4>
    <div class="chips">${COLOR_CHIPS.map(c => `<button class="chip ${c === f.color ? 'on' : ''}" style="background:${c}" data-color="${c}" aria-label="${c}"></button>`).join('')}
      <label class="in" style="width:60px">自由に<input type="color" data-k="color" value="${f.color}" style="padding:0;height:30px"></label></div>
    <div class="row"><label class="btn">📷 写真から色を拾う<input type="file" accept="image/*" data-act="photoFile" hidden></label></div>
    <p class="muted">💡 太い線のある辺が家具の「正面」だよ。ピンクの⟳をドラッグすると自由に回転できるよ。</p>`;
}

let customDraft = { name: '', w: 60, d: 40, h: 60, color: '#a7c4bc', type: 'box', url: '' };
let addUrl = '';
function addPanel() {
  return `
    <div class="urlbox">
      <div class="field one"><label class="in">🔗 商品URLから追加(名前・サイズ・色を自動で読み取るよ)<input type="url" data-k="addUrl" value="${esc(addUrl)}" placeholder="https://www.nitori-net.jp/... など"></label></div>
      <div class="row"><button class="btn primary" data-act="addFromUrl" ${reading ? 'disabled' : ''}>${reading ? '読み取り中…' : '🔍 読み取って追加'}</button></div>
      <p class="muted">※ 読み取りには外部の無料サービス(r.jina.ai / wsrv.nl)を使うよ。送るのは商品ページのURLだけ。お店によっては読めないこともあるよ。</p>
    </div>
    <h4>カタログから選ぶ</h4>
    <div class="catalog">${CATALOG.map((c, i) => `<button data-add="${i}"><span>${esc(c.name)}</span><small>${c.w}×${c.d}×${c.h}</small></button>`).join('')}</div>
    <h4>自由に入力して追加</h4>
    <div class="field one">${txt('名前', 'c-name', customDraft.name, '例: 観葉植物、ゲーミングチェア')}</div>
    <div class="field">${num('幅 cm', 'c-w', customDraft.w, { min: 1 })}${num('奥行 cm', 'c-d', customDraft.d, { min: 1 })}${num('高さ cm', 'c-h', customDraft.h, { min: 0 })}</div>
    <div class="field two">
      <label class="in">3Dでの形<select data-k="c-type">${SHAPES.map(([v, n]) => `<option value="${v}" ${v === customDraft.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="in">色<input type="color" data-k="c-color" value="${customDraft.color}" style="padding:0;height:38px"></label>
    </div>
    <div class="row"><button class="btn primary" data-act="addCustom">この家具を追加する</button></div>`;
}

const KINDS = [['closet', '収納・クローゼット'], ['kitchen', 'キッチン'], ['ub', 'お風呂・トイレ'], ['washer', '洗濯機置き場'], ['storage', '下駄箱・棚'], ['entrance', '玄関(土間)'], ['wall', '柱・壁の出っぱり']];
const WALLS = [['entrance', '玄関側の壁'], ['balcony', 'ベランダ側の壁'], ['left', '左の壁(x=0)'], ['right', '右の壁']];
// 作り付け・窓ドアの編集カード(「部屋の設定」と「選んだもの」の両方で使う)
function fxCard(fx, i, single = false) {
  return `
      <div class="card ${fx.id === app.selFx ? 'sel' : ''}" data-fx="${i}">
        <div class="card-title"><span>${esc(fx.name)}</span>${single ? '' : `<button data-act="pickFx" data-i="${i}">図で選ぶ</button>`}<button data-act="delFx" data-i="${i}">削除</button></div>
        <div class="field two">${txt('名前', 'fx-name', fx.name)}<label class="in">種類<select data-k="fx-kind">${KINDS.map(([v, n]) => `<option value="${v}" ${v === fx.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="field">${num('x', 'fx-x', fx.x, { step: 5 })}${num('y', 'fx-y', fx.y, { step: 5 })}${num('高さ', 'fx-h', fx.h, { min: 0 })}</div>
        <div class="field two">${num('幅', 'fx-w', fx.w, { min: 1 })}${num('奥行', 'fx-d', fx.d, { min: 1 })}</div>
        ${single ? '<div class="row"><button class="btn" data-act="rotFx">⟳ 90°回転</button><button class="btn" data-act="dupFx">複製</button></div><p class="muted">💡 図の上でドラッグすると動かせて、角の□で大きさを変えられるよ。</p>' : ''}
      </div>`;
}
function opCard(o, i, single = false) {
  return `
      <div class="card ${o.id === app.selOp ? 'sel' : ''}" data-op="${i}">
        <div class="card-title"><span>${esc(o.name)}</span>${single ? '' : `<button data-act="pickOp" data-i="${i}">図で選ぶ</button>`}<button data-act="delOp" data-i="${i}">削除</button></div>
        <div class="field two">${txt('名前', 'op-name', o.name)}<label class="in">種類<select data-k="op-kind"><option value="window" ${o.kind === 'window' ? 'selected' : ''}>窓</option><option value="door" ${o.kind === 'door' ? 'selected' : ''}>ドア</option></select></label></div>
        <div class="field two"><label class="in">どの壁<select data-k="op-wall">${WALLS.map(([v, n]) => `<option value="${v}" ${v === o.wall ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${num('端からの距離', 'op-start', o.start, { step: 5 })}</div>
        <div class="field">${num('幅', 'op-width', o.width, { min: 10 })}${num('床からの高さ', 'op-sill', o.sill, { min: 0 })}${num('窓の高さ', 'op-height', o.height, { min: 10 })}</div>
        ${single ? '<p class="muted">💡 図の上でドラッグすると壁に沿って動かせて(ほかの壁にも移せるよ)、両はしの□で幅を変えられるよ。</p>' : ''}
      </div>`;
}
function roomPanel() {
  const r = app.state.room;
  const u = app.state.underlay;
  return `
    <h4>🏠 お部屋の候補(${store.rooms.length}件)</h4>
    <div class="rooms">${store.rooms.map(x => `
      <div class="room-item ${x.id === store.current ? 'on' : ''}">
        <button class="room-pick" data-room="${x.id}"><b>${esc(x.name)}</b><small>${x.state.room.w}×${x.state.room.d}cm・家具${x.state.plans[x.state.current].furniture.length}点</small></button>
        ${store.rooms.length > 1 ? `<button class="link danger" data-delroom="${x.id}">削除</button>` : ''}
      </div>`).join('')}</div>
    <div class="field one">${txt('今の部屋の名前', 'roomName', curRoom().name, '例: 大井町 3階 6.7万')}</div>
    <div class="row"><button class="btn" data-act="newRoom">＋新しい部屋(家具は持っていく)</button><button class="btn" data-act="copyRoom">この部屋をコピー</button></div>

    <h4>📐 間取り図をなぞって作る</h4>
    ${!u ? `<p class="muted">SUUMOなどの間取り図のスクショを下に敷いて、上からなぞって作れるよ。</p>
      <div class="row"><label class="btn primary">🖼 間取り図の画像を選ぶ<input type="file" accept="image/*" data-act="underlayFile" hidden></label></div>` : `
      <div class="steps">
        <div class="step"><b>①</b> 縮尺を合わせる
          <div class="row"><button class="btn" data-act="calibArea">洋室をなぞって帖数を入れる</button><button class="btn" data-act="calib">2点をタップして長さを入れる</button></div></div>
        <div class="step"><b>②</b> 位置を合わせる <div class="row"><button class="btn" data-act="moveImg">✋ 画像をドラッグで動かす</button></div></div>
        <div class="step"><b>③</b> 部屋の外枠をなぞる <div class="row"><button class="btn" data-act="roomRect">⬚ 外枠をなぞる</button></div></div>
        <div class="step"><b>④</b> 作り付け・窓をなぞる <div class="row"><button class="btn" data-act="fxRect">▦ 作り付けをなぞる</button><button class="btn" data-act="opRect">🪟 窓・ドアをなぞる</button></div></div>
      </div>
      <label class="in">画像の濃さ <input type="range" min="0.1" max="1" step="0.05" data-k="u-opacity" value="${u.opacity ?? 0.6}"></label>
      <div class="row"><button class="opt ${u.show !== false ? 'on' : ''}" data-act="toggleUnderlay">${u.show !== false ? '👁 表示中' : '🙈 かくし中'}</button>
        <label class="btn">画像を変える<input type="file" accept="image/*" data-act="underlayFile" hidden></label>
        <button class="btn danger" data-act="removeUnderlay">画像を外す</button></div>
      <p class="muted">ちなみに… 1帖(畳1枚)は約1.62㎡。間取り図に寸法がないときは「洋室12帖」みたいな帖数で縮尺を合わせるのがかんたんだよ。</p>`}

    <h4>部屋の大きさ</h4>
    <div class="field">${num('部屋の幅 cm', 'r-w', r.w, { min: 100 })}${num('奥行 cm', 'r-d', r.d, { min: 100 })}${num('天井高 cm', 'r-h', r.h, { min: 180 })}</div>
    <div class="field two">${num('ベランダの奥行 cm', 'r-balcony', r.balcony, { min: 0 })}</div>
    <h4>作り付け(動かせないもの) — x,y は左上の角</h4>
    <p class="muted">💡 上の図で直接タップしても選べるよ。</p>
    ${r.fixtures.map((fx, i) => fxCard(fx, i)).join('')}
    <div class="row"><button class="btn" data-act="addFx">＋作り付けを追加</button></div>
    <h4>窓・ドア — 位置は壁の端(左 or 玄関側)からの距離</h4>
    ${r.openings.map((o, i) => opCard(o, i)).join('')}
    <div class="row"><button class="btn" data-act="addOp">＋窓を追加</button></div>
    <h4>まとめて変える</h4>
    <p class="muted">図面と左右が逆になっていたら、反転すると作り付け・窓・家具がまとめて入れ替わるよ。</p>
    <div class="row"><button class="btn" data-act="flipRoom">⇆ 間取りを左右反転</button><button class="btn danger" data-act="resetRoom">間取りを最初の状態に戻す</button></div>`;
}

const swatch = f => `<span class="dot sq" style="background:${f.kind === 'marble' || f.kind === 'stone' || f.kind === 'terrazzo'
  ? `radial-gradient(circle at 30% 30%, ${f.base} 40%, ${f.line} 100%)` : f.kind === 'herring' ? `repeating-linear-gradient(45deg, ${f.base} 0 3px, ${f.line} 3px 4px)`
    : f.kind === 'tile' || f.kind === 'mortar' ? f.base : `repeating-linear-gradient(90deg, ${f.base} 0 3px, ${f.line} 3px 4px)`}"></span>`;
function morePanel() {
  const v = app.state.view;
  const otherPlans = Object.entries(app.state.plans).filter(([k]) => k !== app.state.current);
  return `
    <h4>照明・時間帯</h4>
    <div class="row"><button class="opt ${!v.night ? 'on' : ''}" data-light="day">☀ 昼</button><button class="opt ${v.night && !v.ceil ? 'on' : ''}" data-light="night">🌙 夜・間接照明</button><button class="opt ${v.night && v.ceil ? 'on' : ''}" data-light="ceil">💡 夜・照明ON</button></div>
    <p class="muted">3D画面右下の ☀/🌙/💡 ボタンでもワンタップで切り替えられるよ(PCは L キー)。「フロアライト」を置くと、夜はその場所が光るよ。</p>
    <h4>床の素材</h4>
    <div class="row">${FLOORS.map((f, i) => `<button class="opt ${i === v.floor ? 'on' : ''}" data-floor="${i}">${swatch(f)} ${f.name}</button>`).join('')}
      <label class="opt pick ${v.floor < 0 ? 'on' : ''}"><span class="dot sq" style="background:${v.floorColor}"></span> 好きな色の木目<input type="color" data-k="floorColor" value="${v.floorColor}"></label></div>
    <h4>壁の仕上げ</h4>
    <div class="row">${WALL_FINISHES.map(w => `<button class="opt ${w.id === (v.wallFinish || 'plain') ? 'on' : ''}" data-wallfin="${w.id}">${w.name}</button>`).join('')}</div>
    <h4>壁の色</h4>
    <div class="row">${WALL_COLORS.map((w, i) => `<button class="opt ${i === v.wall ? 'on' : ''}" data-wall="${i}"><span class="dot" style="background:${w.color}"></span> ${w.name}</button>`).join('')}
      <label class="opt pick ${v.wall < 0 ? 'on' : ''}"><span class="dot" style="background:${v.wallColor}"></span> 好きな色<input type="color" data-k="wallColor" value="${v.wallColor}"></label></div>
    <h4>窓のカーテン</h4>
    <div class="row"><label class="opt pick on"><span class="dot" style="background:${v.curtain}"></span> カーテンの色<input type="color" data-k="curtain" value="${v.curtain}"></label></div>
    <p class="muted">夜にするとカーテンが閉まるよ。</p>
    <h4>目線の高さ <b id="eyeVal">${v.eye}cm</b></h4>
    <input type="range" min="80" max="190" step="5" data-k="eye" value="${v.eye}">
    <h4>レイアウト案</h4>
    <div class="field two">${txt('今の案の名前', 'planName', app.state.plans[app.state.current].name)}</div>
    <div class="row">${otherPlans.map(([k, p]) => `<button class="btn" data-copyto="${k}">今の案を「${esc(p.name)}」にコピー</button>`).join('')}</div>
    <div class="row"><button class="btn" data-act="compare">⇔ 案を並べて比べる</button></div>
    <h4>画像で保存</h4>
    <div class="row"><button class="btn primary" data-act="png">📷 今の画面をPNGで保存</button></div>
    <p class="muted">画面右下の📷ボタンでも、すぐに撮れるよ(PCは P キー)。</p>
    <h4>データ</h4>
    <p class="muted">データはこの端末に自動保存されるよ。機種変更や別の端末で使うときは、バックアップ(全部の部屋・間取り図入り)を書き出して読み込んでね。</p>
    <div class="row"><button class="btn" data-act="export">バックアップを書き出す</button><label class="btn">読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
    <div class="row"><button class="btn danger" data-act="resetAll">この部屋をリセット</button></div>`;
}

function bindPanel(body) {
  body.oninput = e => {
    const k = e.target.dataset.k; if (!k) return;
    const raw = e.target.value;
    const n = parseFloat(raw);
    const f = app.selected();
    const r = app.state.room;
    // 作り付け・窓ドアのカード(どのタブにあっても同じ)
    if (k.startsWith('fx-') || k.startsWith('op-')) {
      const isFx = k.startsWith('fx-');
      const card = e.target.closest(isFx ? '[data-fx]' : '[data-op]');
      const obj = isFx ? r.fixtures[+card.dataset.fx] : r.openings[+card.dataset.op];
      const key = k.slice(3);
      if (['name', 'kind', 'wall'].includes(key)) obj[key] = raw; else { if (isNaN(n)) return; obj[key] = n; }
      if (key === 'name') card.querySelector('.card-title span').textContent = raw;
      app.changed({ keepPanel: true });
      if (key === 'kind') refreshQuick();
      return;
    }
    if (app.tab === 'item' && f) {
      if (k === 'sizeText') return;
      if (['w', 'd', 'h', 'x', 'y', 'seat', 'rot', 'elev'].includes(k)) { if (isNaN(n)) return; f[k] = k === 'w' || k === 'd' ? Math.max(1, n) : n; }
      else if (k === 'type' || k === 'finish') { f[k] = raw; app.changed(); return; }
      else f[k] = raw;
      if (k === 'rot') $('#rotVal').textContent = `${f.rot}°`;
      if (k === 'color') body.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.color === raw));
      app.changed({ keepPanel: true });
    } else if (app.tab === 'add') {
      if (k === 'addUrl') { addUrl = raw; return; }
      const key = k.slice(2);
      customDraft[key] = ['w', 'd', 'h'].includes(key) ? (isNaN(n) ? customDraft[key] : n) : raw;
    } else if (app.tab === 'room') {
      if (k === 'roomName') { curRoom().name = raw || '部屋'; renderRoomBar(); save({ record: false }); return; }
      if (k === 'u-opacity') { app.state.underlay.opacity = n; app.changed({ keepPanel: true }); return; }
      if (k.startsWith('r-')) { if (isNaN(n)) return; r[k.slice(2)] = n; }
      app.changed({ keepPanel: true });
    } else if (app.tab === 'more') {
      const v = app.state.view;
      if (k === 'eye') { v.eye = n; $('#eyeVal').textContent = `${n}cm`; app.view3d?.resetEye(); save(); }
      if (k === 'planName') { app.state.plans[app.state.current].name = raw || '案'; renderPlanSeg(); save(); }
      if (k === 'wallColor') { v.wall = -1; v.wallColor = raw; app.changed({ keepPanel: true }); markPick(e.target); }
      if (k === 'floorColor') { v.floor = -1; v.floorColor = raw; app.changed({ keepPanel: true }); markPick(e.target); }
      if (k === 'curtain') { v.curtain = raw; app.changed({ keepPanel: true }); markPick(e.target); }
    }
  };
  body.onchange = async e => {
    const act = e.target.dataset.act;
    if (act === 'import') importFile(e.target.files[0]);
    if (act === 'photoFile' && e.target.files[0]) {
      const f = app.selected(); if (!f) return;
      try {
        const { dataUrl } = await fileToDataUrl(e.target.files[0], 900, 0.85);
        const look = await analyzeImage(dataUrl, false);
        if (look.color) f.color = look.color;
        f.photo = look.photo;
        app.changed(); toast('写真から色を拾ったよ🎨');
      } catch (err) { toast(err.message || '写真を読み込めなかったよ'); }
    }
    if (act === 'underlayFile' && e.target.files[0]) setUnderlayFile(e.target.files[0]);
    // 名前の確定は一覧の表示に反映
    if (app.tab === 'item' && e.target.dataset.k === 'name') renderSheet();
    if (app.tab === 'room' && e.target.dataset.k === 'roomName') renderSheet();
  };
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const f = app.selected();
    const r = app.state.room;
    const v = app.state.view;
    if (b.dataset.select) { app.select(b.dataset.select); return; }
    if (b.dataset.room) { switchRoom(b.dataset.room); return; }
    if (b.dataset.delroom) { deleteRoom(b.dataset.delroom); return; }
    if (b.dataset.color && f) { f.color = b.dataset.color; app.changed(); return; }
    if (b.dataset.add != null) { addFurniture(CATALOG[+b.dataset.add]); return; }
    if (b.dataset.light) { v.night = b.dataset.light !== 'day'; v.ceil = b.dataset.light === 'ceil'; updateNightBtn(); app.changed(); return; }
    if (b.dataset.wall != null) { v.wall = +b.dataset.wall; app.changed(); return; }
    if (b.dataset.wallfin) { v.wallFinish = b.dataset.wallfin; app.changed(); return; }
    if (b.dataset.floor != null) { v.floor = +b.dataset.floor; app.changed(); return; }
    if (b.dataset.copyto) {
      const to = app.state.plans[b.dataset.copyto];
      ask(`「${to.name}」を今の案で上書きする？`, () => {
        to.furniture = clone(app.furniture());
        save(); toast(`「${to.name}」にコピーしたよ`);
      });
      return;
    }
    switch (b.dataset.act) {
      case 'rot90': rotate90(f); break;
      case 'dup': duplicate(f); break;
      case 'del': remove(f); break;
      case 'readUrl': {
        const url = (body.querySelector('[data-k="url"]').value || '').trim();
        if (!/^https?:\/\//.test(url)) { toast('https:// から始まる商品ページのURLを貼り付けてね'); return; }
        f.url = url; readUrlInto(url, f); break;
      }
      case 'parseSize': {
        const s = parseSize(body.querySelector('[data-k="sizeText"]').value);
        if (!s) { toast('サイズが見つからなかったよ。「幅120×奥行40×高さ45cm」みたいな部分を貼ってね'); return; }
        f.w = s.w; f.d = s.d; if (s.h) f.h = s.h;
        app.changed(); toast(`サイズを ${s.w}×${s.d}${s.h ? '×' + s.h : ''}cm にしたよ`); break;
      }
      case 'clearPhoto': f.photo = ''; app.changed(); break;
      case 'addFromUrl': {
        if (!/^https?:\/\//.test(addUrl.trim())) { toast('https:// から始まる商品ページのURLを貼り付けてね'); return; }
        const u = addUrl; addUrl = ''; readUrlInto(u, null); break;
      }
      case 'addCustom': {
        if (!customDraft.name.trim()) { toast('名前を入れてね'); return; }
        addFurniture({ ...customDraft, name: customDraft.name.trim() });
        customDraft = { name: '', w: 60, d: 40, h: 60, color: '#a7c4bc', type: 'box', url: '' };
        break;
      }
      case 'newRoom': addRoom(false); break;
      case 'copyRoom': addRoom(true); break;
      case 'calib': case 'calibArea': case 'moveImg': case 'roomRect': case 'fxRect': case 'opRect': startTool(b.dataset.act); break;
      case 'toggleUnderlay': app.state.underlay.show = app.state.underlay.show === false; app.changed(); break;
      case 'removeUnderlay': ask('間取り図の画像を外す？(なぞって作った間取りはそのまま残るよ)', () => { app.state.underlay = null; app.underlayImg = null; app.changed(); }); break;
      case 'addFx': r.fixtures.push({ id: newId('fx'), kind: 'closet', name: '収納', x: 0, y: 200, w: 60, d: 45, h: 180 }); app.changed(); break;
      case 'delFx': removeFx(r.fixtures[+b.dataset.i]); break;
      case 'pickFx': setSel(null, r.fixtures[+b.dataset.i].id, null); toast('図の上でピンクになってるよ'); break;
      case 'rotFx': rotateFx(app.selectedFx()); break;
      case 'dupFx': duplicateFx(app.selectedFx()); break;
      case 'addOp': r.openings.push({ id: newId('op'), kind: 'window', name: '窓', wall: 'right', start: 300, width: 90, sill: 90, height: 100 }); app.changed(); break;
      case 'delOp': removeOp(r.openings[+b.dataset.i]); break;
      case 'pickOp': setSel(null, null, r.openings[+b.dataset.i].id); toast('図の上でピンクになってるよ'); break;
      case 'resetRoom': ask('間取りを最初の状態に戻す？(家具はそのまま)', () => { app.state.room = defaultRoom(); app.changed(); app.plan2d.fit(); }); break;
      case 'flipRoom': flipRoom(); app.changed(); toast('左右を反転したよ。戻すときはもう一度押してね'); break;
      case 'resetAll': ask('この部屋の家具・間取り・案A〜Cをリセットする？(↶で元に戻せるよ)', () => { replaceState(defaultState()); }); break;
      case 'png': savePng(); break;
      case 'compare': openCompare(); break;
      case 'export': exportJson(); break;
    }
  };
}

// ---------- 間取り図を下に敷いて、なぞる ----------
function loadUnderlay() {
  const u = app.state.underlay;
  if (!u) { app.underlayImg = null; return; }
  if (app.underlayImg && app.underlayImg.dataset.id === u.id) return;
  app.underlayImg = null;
  getImage(u.id).then(data => {
    if (!data || !app.state.underlay || app.state.underlay.id !== u.id) return;
    const img = new Image();
    img.dataset.id = u.id;
    img.onload = () => { if (app.state.underlay && app.state.underlay.id === u.id) { app.underlayImg = img; app.plan2d.render(); } };
    img.src = data;
  });
}
async function setUnderlayFile(file) {
  try {
    const { dataUrl, w } = await fileToDataUrl(file);
    const id = newId('img');
    await putImage(id, dataUrl);
    const r = app.state.room;
    // はじめは、画像の横幅 = 部屋の横幅 になるように置く
    app.state.underlay = { id, x: 0, y: 0, scale: r.w / w, opacity: 0.6, show: true };
    app.underlayImg = null;
    loadUnderlay();
    app.changed();
    toast('間取り図を敷いたよ！①から順番にやってみてね', 4000);
  } catch (e) { toast(e.message || '画像を読み込めなかったよ'); }
}
const TOOL_HELP = {
  calib: '縮尺合わせ: 長さがわかっている2点(例: 部屋の端と端)を順にタップしてね',
  calibArea: '縮尺合わせ: 帖数がわかっている部屋(例: 洋室)の四角を、指でななめになぞってね',
  moveImg: '画像を指でドラッグして、部屋の枠に合わせてね',
  roomRect: '間取り図の部屋の外枠(玄関側〜ベランダ側の壁まで)を、ななめになぞってね',
  fxRect: '作り付け(収納・キッチンなど)を1つずつなぞってね。続けて何個でもOK',
  opRect: '窓やドアを、壁に沿って細長くなぞってね。近い壁に自動でつくよ',
};
const FX_KIND_DEFAULT = { closet: ['収納', 240], kitchen: ['キッチン', 85], ub: ['お風呂', 240], washer: ['洗濯機置き場', 0], storage: ['下駄箱', 120], entrance: ['玄関', 0], wall: ['柱', 240] };
let fxKind = 'closet', opKind = 'window';
function startTool(kind) {
  const t = kind === 'calib' ? { kind, pts: [] } : { kind };
  if (app.mode !== '2d') setMode('2d');
  openTab(null);
  app.plan2d.setTool(t);
  const bar = $('#toolbar');
  bar.hidden = false;
  let extra = '';
  if (kind === 'fxRect') extra = `<select id="toolKind">${KINDS.map(([v, n]) => `<option value="${v}" ${v === fxKind ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  if (kind === 'opRect') extra = `<select id="toolKind"><option value="window" ${opKind === 'window' ? 'selected' : ''}>窓</option><option value="door" ${opKind === 'door' ? 'selected' : ''}>ドア</option></select>`;
  bar.innerHTML = `<p>${TOOL_HELP[kind]}</p><div class="row">${extra}<button class="btn primary" id="toolDone">できた</button></div>`;
  $('#toolDone').onclick = endTool;
  const sel = $('#toolKind');
  if (sel) sel.onchange = () => { if (kind === 'fxRect') fxKind = sel.value; else opKind = sel.value; };
}
function endTool() {
  app.plan2d.setTool(null);
  $('#toolbar').hidden = true;
  app.changed();
}
app.onToolDone = t => {
  const st = app.state, u = st.underlay, r = st.room;
  if (t.kind === 'calib') {
    const [a, b] = t.pts;
    const cur = Math.hypot(b[0] - a[0], b[1] - a[1]);
    ask(`AとBの間は実際に何cm？(今は約${Math.round(cur)}cm)`, val => {
      const real = parseFloat(val);
      if (!(real > 0) || !(cur > 0)) { app.plan2d.setTool({ kind: 'calib', pts: [] }); return; }
      scaleUnderlay(real / cur, a);
      endTool();
      toast('縮尺を合わせたよ！次は②で位置を合わせてね', 3500);
    }, { type: 'number', value: '', placeholder: '例: 310' });
  } else if (t.kind === 'calibArea') {
    const area = t.rect.w * t.rect.h / 10000; // ㎡
    ask(`なぞった部屋は何帖？(今は約${(area / 1.62).toFixed(1)}帖)`, val => {
      const jo = parseFloat(val);
      if (!(jo > 0)) return;
      scaleUnderlay(Math.sqrt(jo * 1.62 / area), [t.rect.x, t.rect.y]);
      endTool();
      toast(`${jo}帖に合わせたよ！次は②③で位置と外枠を合わせてね`, 4000);
    }, { type: 'number', value: '', placeholder: '例: 12' });
  } else if (t.kind === 'roomRect') {
    const { x, y, w, h } = t.rect;
    const ww = Math.round(w / 5) * 5, hh = Math.round(h / 5) * 5;
    ask(`部屋の大きさを ${ww}×${hh}cm にする？`, () => {
      // なぞった四角の左上が、部屋の左上(0,0)になるように全部ずらす
      if (u) { u.x -= x; u.y -= y; }
      for (const fx of r.fixtures) { fx.x -= x; fx.y -= y; }
      for (const o of r.openings) o.start -= (o.wall === 'left' || o.wall === 'right') ? y : x;
      for (const p of Object.values(st.plans)) for (const f of p.furniture) { f.x -= x; f.y -= y; }
      r.w = ww; r.d = hh;
      endTool(); app.plan2d.fit();
      toast('部屋の外枠を合わせたよ！次は④で作り付けや窓をなぞってね', 4000);
    });
  } else if (t.kind === 'fxRect') {
    const [name, hgt] = FX_KIND_DEFAULT[fxKind];
    const { x, y, w, h } = t.rect;
    r.fixtures.push({ id: newId('fx'), kind: fxKind, name, x, y, w, d: h, h: hgt });
    app.changed();
    toast(`「${name}」を追加したよ。続けてなぞれるよ`);
  } else if (t.kind === 'opRect') {
    const { x, y, w, h } = t.rect;
    const cx = x + w / 2, cy = y + h / 2;
    const dists = [['entrance', Math.abs(cy)], ['balcony', Math.abs(r.d - cy)], ['left', Math.abs(cx)], ['right', Math.abs(r.w - cx)]];
    dists.sort((p, q) => p[1] - q[1]);
    const wall = dists[0][0];
    const horiz = wall === 'entrance' || wall === 'balcony';
    const start = Math.round((horiz ? x : y) / 5) * 5, width = Math.round((horiz ? w : h) / 5) * 5;
    const door = opKind === 'door';
    r.openings.push({ id: newId('op'), kind: opKind, name: door ? 'ドア' : '窓', wall, start, width, sill: door ? 0 : (wall === 'balcony' ? 0 : 90), height: door ? 200 : (wall === 'balcony' ? 200 : 110) });
    app.changed();
    toast(`${WALLS.find(w2 => w2[0] === wall)[1]}に${door ? 'ドア' : '窓'}をつけたよ。高さは「お部屋・間取り」で直せるよ`, 3500);
  }
};
// 画像の拡大率を変える(点 p を動かさずに)
function scaleUnderlay(k, p) {
  const u = app.state.underlay; if (!u) return;
  u.x = p[0] + (u.x - p[0]) * k;
  u.y = p[1] + (u.y - p[1]) * k;
  u.scale *= k;
  app.changed();
}

// ---------- 案を並べて比べる ----------
function planStats(room, furniture) {
  const { bad, narrow } = analyze(room, furniture);
  const solid = furniture.filter(f => !isFlat(f) && !isWallHung(f));
  const fixArea = room.fixtures.filter(f => f.kind !== 'entrance').reduce((s, f) => s + f.w * f.d, 0);
  const furnArea = solid.reduce((s, f) => s + f.w * f.d, 0);
  const free = Math.max(0, room.w * room.d - fixArea - furnArea) / 10000;
  const minGap = narrow.length ? Math.min(...narrow.map(g => g.dist)) : null;
  return { count: furniture.length, bad: bad.size, narrow: narrow.length, minGap, free };
}
function openCompare() {
  const box = $('#compare');
  const plans = Object.entries(app.state.plans);
  const stats = plans.map(([, p]) => planStats(app.state.room, p.furniture));
  const bestFree = Math.max(...stats.map(s => s.free));
  box.querySelector('.cmp-title').textContent = `「${curRoom().name}」の案を比べる`;
  box.querySelector('.cmp-grid').innerHTML = plans.map(([k, p], i) => {
    const s = stats[i];
    return `<div class="cmp-card ${k === app.state.current ? 'on' : ''}">
      <div class="cmp-head"><b>${esc(p.name)}</b>${k === app.state.current ? '<span class="tag">表示中</span>' : ''}</div>
      <canvas data-plan="${k}"></canvas>
      <ul>
        <li>家具 <b>${s.count}</b>点</li>
        <li class="${s.bad ? 'bad' : 'ok'}">${s.bad ? `● ぶつかり ${s.bad}` : '✓ ぶつかりなし'}</li>
        <li class="${s.narrow ? 'warn' : 'ok'}">${s.narrow ? `⚠ 狭い通路 ${s.narrow}か所<br>(最小${Math.round(s.minGap)}cm)` : '✓ 通路ゆったり'}</li>
        <li>床の空き <b>${s.free.toFixed(1)}</b>㎡${s.free === bestFree && plans.length > 1 ? '<br><span class="tag good">いちばん広い</span>' : ''}</li>
      </ul>
      <button class="btn ${k === app.state.current ? '' : 'primary'}" data-use="${k}">${k === app.state.current ? '表示中' : 'この案にする'}</button>
    </div>`;
  }).join('');
  box.hidden = false;
  requestAnimationFrame(() => box.querySelectorAll('canvas[data-plan]').forEach(c =>
    drawThumb(c, app.state.room, app.state.plans[c.dataset.plan].furniture, app.state.view)));
}
function closeCompare() { $('#compare').hidden = true; }
$('#compare').addEventListener('click', e => {
  if (e.target.id === 'compare' || e.target.closest('[data-close]')) { closeCompare(); return; }
  const b = e.target.closest('[data-use]'); if (!b) return;
  switchPlan(b.dataset.use); closeCompare();
});

// ---------- 保存・書き出し ----------
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
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function savePng(flash = false) {
  if (flash) { const f = $('#flash'); f.hidden = false; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); setTimeout(() => { f.hidden = true; }, 450); }
  const dataUrl = app.mode === '3d' && app.view3d ? app.view3d.snapshot() : $('#canvas2d').toDataURL('image/png');
  fetch(dataUrl).then(r => r.blob()).then(blob =>
    downloadBlob(blob, `room-layout_room${store.rooms.indexOf(curRoom()) + 1}_${app.state.current}_${app.mode === '3d' ? '3D' : '2D'}_${stamp()}.png`, '画像を保存したよ📷'));
}
async function exportJson() {
  curRoom().state = app.state;
  // 間取り図の画像も一緒に入れる
  const images = {};
  for (const r of store.rooms) if (r.state.underlay) { const d = await getImage(r.state.underlay.id); if (d) images[r.state.underlay.id] = d; }
  const blob = new Blob([JSON.stringify({ ...store, images })], { type: 'application/json' });
  downloadBlob(blob, `room-layout-backup_${stamp()}.json`, 'バックアップを保存したよ');
}
function importFile(file) {
  if (!file) return;
  file.text().then(t => {
    const raw = JSON.parse(t);
    const s = normalizeStore(raw);
    if (!s) throw new Error('形式が違う');
    const images = raw.images && typeof raw.images === 'object' ? raw.images : {};
    const all = Array.isArray(raw.rooms);
    ask(all ? `今の部屋を全部、このバックアップ(${s.rooms.length}部屋)で置きかえる？` : 'このバックアップを新しい部屋として追加する？', async () => {
      for (const [id, d] of Object.entries(images)) if (typeof d === 'string' && d.startsWith('data:image/')) await putImage(id, d);
      curRoom().state = app.state;
      if (all) store.rooms = s.rooms; else store.rooms.push(...s.rooms);
      store.current = all ? s.current : s.rooms[0].id;
      app.state = curRoom().state;
      switchRoom(store.current, { quiet: true });
      toast('読み込んだよ');
    });
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
renderRoomBar();
updateNightBtn();
loadUnderlay();
pushHistory();
requestAnimationFrame(() => app.plan2d.resize());
initCloud();

// オフラインでも開けるように(GitHub Pages などで公開したとき)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.claude) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 使えなくても普通に動く */ });
}
