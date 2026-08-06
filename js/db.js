/* IndexedDB ラッパー。カルテ本体(records)と写真(photos)を別ストアで保持する。 */
(function (global) {
  'use strict';

  var DB_NAME = 'hair_karte';
  var DB_VERSION = 1;
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

    clearAll: function () {
      return tx(['records', 'photos'], 'readwrite').then(function (t) {
        t.objectStore('records').clear();
        t.objectStore('photos').clear();
        return done(t);
      });
    }
  };

  global.DB = DB;
})(window);
