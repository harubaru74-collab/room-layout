// 大きな画像(間取り図など)の保存場所。localStorage は小さいので、ブラウザ内のデータベース(IndexedDB)に入れる
const DB = 'roomLayoutImages', STORE = 'images';
const mem = new Map(); // IndexedDB が使えないとき用(ページを閉じると消える)
let dbp = null;
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no idb')); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(e => { dbp = Promise.reject(e); throw e; });
  }
  return dbp;
}
function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  }));
}
export const putImage = (id, data) => { mem.set(id, data); return tx('readwrite', s => s.put(data, id)).catch(() => {}); };
export const getImage = id => mem.has(id) ? Promise.resolve(mem.get(id)) : tx('readonly', s => s.get(id)).catch(() => null);
export const delImage = id => { mem.delete(id); return tx('readwrite', s => s.delete(id)).catch(() => {}); };
export const listImageIds = () => tx('readonly', s => s.getAllKeys()).then(k => k || []).catch(() => []);
