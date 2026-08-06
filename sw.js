/* オフラインでも開けるようにアプリの外枠をキャッシュする。
   ただしキャッシュ優先だと、更新しても古い画面が出続けてしまう。
   そのためオンラインのときは常にネットワークを先に見て、取れなければキャッシュを返す。 */
var CACHE = 'hair-karte-v5';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/db.js',
  './js/photos.js',
  './js/mask.js',
  './js/head.js',
  './js/app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      // オフラインのときだけキャッシュを使う
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
