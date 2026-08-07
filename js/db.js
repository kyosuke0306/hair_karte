/* IndexedDB ラッパー。カルテ(records)・注文シート(sheets)・スタイリング剤(products)と
   写真(photos)を別ストアで保持する。写真は recordId で持ち主とつながる。 */
(function (global) {
  'use strict';

  var DB_NAME = 'hair_karte';
  var DB_VERSION = 4;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('records')) {
          var records = db.createObjectStore('records', { keyPath: 'id' });
          records.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('photos')) {
          var photos = db.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('recordId', 'recordId');
        }
        // 注文シート（お店や日付を持たない、髪型の注文内容だけの雛形）
        if (!db.objectStoreNames.contains('sheets')) {
          db.createObjectStore('sheets', { keyPath: 'id' });
        }
        // スタイリング剤（いま使っているもの／使ってみたいもの）
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        // 髪質など、記録ごとではなく1つだけ持つもの
        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(stores, mode) {
    return open().then(function (db) { return db.transaction(stores, mode); });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function done(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error); };
      transaction.onabort = function () { reject(transaction.error); };
    });
  }

  var DB = {
    /** カルテを全件取得（日付の新しい順） */
    allRecords: function () {
      return tx(['records'], 'readonly').then(function (t) {
        return wrap(t.objectStore('records').getAll());
      }).then(function (rows) {
        return rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      });
    },

    getRecord: function (id) {
      return tx(['records'], 'readonly').then(function (t) {
        return wrap(t.objectStore('records').get(id));
      });
    },

    putRecord: function (record) {
      return tx(['records'], 'readwrite').then(function (t) {
        t.objectStore('records').put(record);
        return done(t);
      }).then(function () { return record; });
    },

    /** カルテと、それに紐づく写真をまとめて削除 */
    deleteRecord: function (id) {
      return tx(['records', 'photos'], 'readwrite').then(function (t) {
        t.objectStore('records').delete(id);
        var idx = t.objectStore('photos').index('recordId');
        var cur = idx.openCursor(IDBKeyRange.only(id));
        cur.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        return done(t);
      });
    },

    allPhotos: function () {
      return tx(['photos'], 'readonly').then(function (t) {
        return wrap(t.objectStore('photos').getAll());
      });
    },

    photosOf: function (recordId) {
      return tx(['photos'], 'readonly').then(function (t) {
        return wrap(t.objectStore('photos').index('recordId').getAll(IDBKeyRange.only(recordId)));
      }).then(function (rows) {
        return rows.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      });
    },

    putPhotos: function (photos) {
      if (!photos.length) return Promise.resolve();
      return tx(['photos'], 'readwrite').then(function (t) {
        var store = t.objectStore('photos');
        photos.forEach(function (p) { store.put(p); });
        return done(t);
      });
    },

    deletePhotos: function (ids) {
      if (!ids.length) return Promise.resolve();
      return tx(['photos'], 'readwrite').then(function (t) {
        var store = t.objectStore('photos');
        ids.forEach(function (id) { store.delete(id); });
        return done(t);
      });
    },

    /* ---- 注文シート ---- */

    allSheets: function () {
      return tx(['sheets'], 'readonly').then(function (t) {
        return wrap(t.objectStore('sheets').getAll());
      }).then(function (rows) {
        return rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
    },

    putSheet: function (sheet) {
      return tx(['sheets'], 'readwrite').then(function (t) {
        t.objectStore('sheets').put(sheet);
        return done(t);
      }).then(function () { return sheet; });
    },

    /** 注文シートと、それに紐づく写真をまとめて削除 */
    deleteSheet: function (id) {
      return tx(['sheets', 'photos'], 'readwrite').then(function (t) {
        t.objectStore('sheets').delete(id);
        var cur = t.objectStore('photos').index('recordId').openCursor(IDBKeyRange.only(id));
        cur.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        return done(t);
      });
    },

    /* ---- スタイリング剤 ---- */

    allProducts: function () {
      return tx(['products'], 'readonly').then(function (t) {
        return wrap(t.objectStore('products').getAll());
      }).then(function (rows) {
        return rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
    },

    putProduct: function (product) {
      return tx(['products'], 'readwrite').then(function (t) {
        t.objectStore('products').put(product);
        return done(t);
      }).then(function () { return product; });
    },

    /** スタイリング剤と、それに紐づく写真をまとめて削除 */
    deleteProduct: function (id) {
      return tx(['products', 'photos'], 'readwrite').then(function (t) {
        t.objectStore('products').delete(id);
        var cur = t.objectStore('photos').index('recordId').openCursor(IDBKeyRange.only(id));
        cur.onsuccess = function (e) {
          var cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        return done(t);
      });
    },

    /* ---- 髪質（1つだけ持つ） ---- */

    getProfile: function () {
      return tx(['profile'], 'readonly').then(function (t) {
        return wrap(t.objectStore('profile').get('me'));
      }).then(function (row) { return row || { id: 'me' }; });
    },

    putProfile: function (profile) {
      profile.id = 'me';
      return tx(['profile'], 'readwrite').then(function (t) {
        t.objectStore('profile').put(profile);
        return done(t);
      }).then(function () { return profile; });
    },

    clearAll: function () {
      return tx(['records', 'photos', 'sheets', 'products', 'profile'], 'readwrite').then(function (t) {
        t.objectStore('records').clear();
        t.objectStore('photos').clear();
        t.objectStore('sheets').clear();
        t.objectStore('products').clear();
        t.objectStore('profile').clear();
        return done(t);
      });
    }
  };

  global.DB = DB;
})(window);
