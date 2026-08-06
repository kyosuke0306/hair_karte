/* Googleマップとの連携。
   APIキーを使わずに済ませるため、
   ・開くときは Google の公式 URL スキームにお店の名前や座標を渡す
   ・入力は「共有 → リンクをコピー」で得た文字列を解析して取り込む
   という方針にしている。アプリから自動で通信することはない。 */
(function (global) {
  'use strict';

  /** 文字列から最初の URL を取り出す */
  function findUrl(text) {
    var m = /https?:\/\/[^\s<>"']+/.exec(String(text || ''));
    return m ? m[0] : '';
  }

  /** /maps/place/<店名>/ の部分から店名を取り出す */
  function nameFromUrl(url) {
    var m = /\/maps\/place\/([^/@?]+)/.exec(url || '');
    if (!m) return '';
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    } catch (e) {
      return m[1].replace(/\+/g, ' ').trim();
    }
  }

  /** URL から緯度経度を取り出す。表記ゆれがあるので順に試す。 */
  function coordsFromUrl(url) {
    url = String(url || '');
    var pats = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,   // place の詳細部分
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,       // 地図の中心
      /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = pats[i].exec(url);
      if (m) {
        var lat = Number(m[1]), lng = Number(m[2]);
        if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat: lat, lng: lng };
        }
      }
    }
    return null;
  }

  /**
   * 共有された文字列を解析する。
   * スマホの共有は「店名 https://maps.app.goo.gl/xxxx」の形が多いので、
   * URL の前にある文字列も店名の候補として拾う。
   */
  function parseShare(text) {
    text = String(text || '').trim();
    if (!text) return null;

    var url = findUrl(text);
    if (!url && !/^https?:/.test(text)) {
      // URL が無いときは、店名だけ書かれたものとして扱う
      return { name: text.split('\n')[0].trim(), url: '', lat: null, lng: null };
    }

    var name = nameFromUrl(url);
    if (!name) {
      // URL の手前に書かれている行を店名とみなす
      var before = text.slice(0, text.indexOf(url)).trim();
      name = before.split('\n').filter(function (l) { return l.trim(); }).pop() || '';
      name = name.replace(/[「」"']/g, '').trim();
    }

    var c = coordsFromUrl(url);
    return {
      name: name,
      url: url,
      lat: c ? c.lat : null,
      lng: c ? c.lng : null
    };
  }

  /**
   * 地図で開くための URL を組み立てる。
   * 取り込んだ URL があればそれを優先し、無ければ名前や座標で検索する。
   */
  function linkFor(record) {
    if (!record) return '';
    if (record.mapUrl) return record.mapUrl;

    if (record.lat != null && record.lng != null) {
      return 'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent(record.lat + ',' + record.lng);
    }

    var q = [record.salon, record.area].filter(Boolean).join(' ');
    if (!q) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  /** お店を探すための検索 URL（名前が無ければ「美容室」で探す） */
  function searchLink(query) {
    var q = String(query || '').trim() || '美容室';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  global.Maps = {
    parseShare: parseShare,
    linkFor: linkFor,
    searchLink: searchLink,
    coordsFromUrl: coordsFromUrl,
    nameFromUrl: nameFromUrl
  };
})(window);
