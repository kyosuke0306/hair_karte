/**
 * 参考モデルの写真探し。
 *
 * 外部サイトの画像を直接取り込むことはできない（別ドメインの画像はブラウザの
 * 制限で読み出せない）ので、このモジュールがやるのは「検索先へのリンクを組み立てる」
 * ことだけ。写真そのものは、見つけた画像をコピーしてアプリに貼り付けてもらう。
 * APIキーは使わず、アプリから自動で外部に通信することもない。
 */
(function () {
  'use strict';

  var GENDER = { mens: 'メンズ', ladys: 'レディース', none: '' };

  /** 画像検索。site: を付ければ、そのサイトの写真だけに絞れる */
  function imageSearch(q, site) {
    return 'https://www.google.com/search?tbm=isch&q=' +
      encodeURIComponent(q + (site ? ' site:' + site : ''));
  }

  /**
   * 検索先。
   * ホットペッパービューティーとミニモは、サイト内検索のURLの形が変わることが
   * あるため、画像検索にサイト指定を付けて開く（リンク切れが起きない形）。
   */
  var SITES = [
    {
      id: 'hotpepper',
      name: 'ホットペッパービューティー',
      note: '国内最大のヘアカタログ。サロンの掲載写真から探せます',
      link: function (q) { return imageSearch(q, 'beauty.hotpepper.jp'); }
    },
    {
      id: 'minimo',
      name: 'minimo（ミニモ）',
      note: 'スタイリスト個人の作例が多いカタログ',
      link: function (q) { return imageSearch(q, 'minimodel.jp'); }
    },
    {
      id: 'instagram',
      name: 'Instagram',
      note: 'ハッシュタグで最新の作例を見られます',
      link: function (q) {
        var tag = q.replace(/[^0-9A-Za-z぀-ヿ一-鿿]/g, '');
        return tag
          ? 'https://www.instagram.com/explore/tags/' + encodeURIComponent(tag) + '/'
          : imageSearch(q, 'instagram.com');
      }
    },
    {
      id: 'pinterest',
      name: 'Pinterest',
      note: '海外の写真も含めて幅広く探せます',
      link: function (q) {
        return 'https://www.pinterest.jp/search/pins/?q=' + encodeURIComponent(q);
      }
    },
    {
      id: 'google',
      name: 'Google 画像検索',
      note: 'サイトを絞らずに探します',
      link: function (q) { return imageSearch(q, ''); }
    }
  ];

  /** カルテや注文シートの内容から、検索キーワードの初期値を作る */
  function query(rec, gender) {
    var parts = [GENDER[gender] || ''];
    var name = (rec && rec.styleName) || '';
    // 「ツーブロック × マッシュショート」の区切り記号は検索の邪魔になる
    parts.push(name.replace(/[×✕✖]/g, ' '));
    if (rec && rec.lengthGenre && name.indexOf(rec.lengthGenre) < 0) parts.push(rec.lengthGenre);
    parts.push('ヘアスタイル');
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /** 貼り付けた文字列から最初のURLを取り出す */
  function pickUrl(text) {
    var m = String(text || '').match(/https?:\/\/[^\s"'<>]+/);
    return m ? m[0] : '';
  }

  /** 表示用にドメインだけ取り出す */
  function hostOf(url) {
    var m = String(url || '').match(/^https?:\/\/([^/?#]+)/);
    return m ? m[1].replace(/^www\./, '') : '';
  }

  window.Models = {
    SITES: SITES,
    GENDER: GENDER,
    query: query,
    pickUrl: pickUrl,
    hostOf: hostOf
  };
})();
