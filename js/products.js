/**
 * スタイリング剤探し。
 *
 * 参考モデル探し（models.js）と同じ考え方で、外部サイトの画像を直接取り込むことは
 * できないため、このモジュールは「検索先へのリンクを組み立てる」だけを受け持つ。
 * 商品名や写真は、見つけたページからコピーして貼り付けてもらう。
 * APIキーは使わず、アプリから自動で外部に通信することもない。
 */
(function () {
  'use strict';

  /** よく使う種類。選ぶと検索キーワードにも入る */
  var TYPES = [
    'ワックス', 'バーム', 'クリーム', 'ジェル', 'グリース',
    'オイル', 'スプレー', 'ムース', 'パウダー', 'その他'
  ];

  function imageSearch(q, site) {
    return 'https://www.google.com/search?tbm=isch&q=' +
      encodeURIComponent(q + (site ? ' site:' + site : ''));
  }

  /**
   * 検索先。
   * サイト内検索のURLの形が変わりやすいところは、画像検索にサイト指定を付けて開く
   * （リンク切れが起きない形）。
   */
  var SITES = [
    {
      id: 'amazon',
      name: 'Amazon',
      note: '商品名・容量・価格を確かめやすい',
      link: function (q) { return 'https://www.amazon.co.jp/s?k=' + encodeURIComponent(q); }
    },
    {
      id: 'rakuten',
      name: '楽天市場',
      note: '取り扱いの多い通販サイト',
      link: function (q) {
        return 'https://search.rakuten.co.jp/search/mall/' + encodeURIComponent(q) + '/';
      }
    },
    {
      id: 'cosme',
      name: '@cosme',
      note: '使用感の口コミを読めます',
      link: function (q) { return imageSearch(q, 'cosme.net'); }
    },
    {
      id: 'image',
      name: 'Google 画像検索',
      note: 'パッケージの写真を探すとき',
      link: function (q) { return imageSearch(q, ''); }
    },
    {
      id: 'web',
      name: 'Google 検索',
      note: '名前がうろ覚えのときはこちら',
      link: function (q) { return 'https://www.google.com/search?q=' + encodeURIComponent(q); }
    }
  ];

  /** 入力済みの内容から検索キーワードの初期値を作る */
  function query(rec) {
    var parts = [];
    if (rec && rec.brand) parts.push(rec.brand);
    if (rec && rec.name) parts.push(rec.name);
    if (rec && rec.type && rec.type !== 'その他') parts.push(rec.type);
    if (!parts.length) parts.push('ヘアワックス');
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  window.Products = {
    TYPES: TYPES,
    SITES: SITES,
    query: query
  };
})();
