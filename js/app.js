/* ヘアカルテ本体：ルーティング・描画・フォーム処理 */
(function () {
  'use strict';

  var main = document.getElementById('main');
  var fab = document.getElementById('fab');
  var toastEl = document.getElementById('toast');
  var lightbox = document.getElementById('lightbox');

  var state = {
    records: [],
    photos: [],          // 全写真のメタ + Blob
    sheets: [],          // 注文シート（お店や日付を持たない雛形）
    query: '',
    sort: 'date-desc'
  };

  /* カルテと注文シートで共通の「注文の内容」の項目 */
  var ORDER_FIELDS = [
    'styleName', 'lengthGenre', 'topLen', 'frontLen', 'sideMm', 'sideburnMm',
    'backMm', 'fadeHeight', 'thinning', 'perm', 'color', 'styling', 'orderNote'
  ];

  var pendingSheet = null;   // 「このシートでカルテを作る」で持ち越す内容

  var urls = [];         // 表示中の ObjectURL。画面を切り替えるたびに開放する
  var fabTarget = '#/new';
  var toastTimer = null;

  /* ---------------- ユーティリティ ---------------- */

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function objectURL(blob) {
    var url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  }

  function releaseURLs() {
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  function todayISO() {
    var d = new Date();
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function parseISO(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatDate(iso) {
    var d = parseISO(iso);
    if (!d) return '日付なし';
    var week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + week + ')';
  }

  function daysBetween(aISO, bISO) {
    var a = parseISO(aISO), b = parseISO(bISO);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  function daysSince(iso) { return daysBetween(iso, todayISO()); }

  /** 星の評価を SVG で組み立てる（環境によって絵文字化しないように文字は使わない） */
  function stars(n) {
    n = Number(n) || 0;
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<svg class="star-ico' + (i <= n ? ' is-on' : '') + '" aria-hidden="true">' +
        '<use href="#i-star"></use></svg>';
    }
    return '<span class="stars" role="img" aria-label="満足度 ' + n + ' / 5">' + out + '</span>';
  }

  function icon(name) {
    return '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  /** 覚えておくだけの小さな設定。使えない環境（プライベートモードなど）では黙って諦める */
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* 保存できなくても動作には影響しない */ }
    return value;
  }

  /* 写真の向き。よく使うものをボタンで選べるようにする */
  var PHOTO_CAPTIONS = ['正面', '斜め', '横', '後ろ', '全体'];

  function openCaptionPicker(photo, done) {
    Picker.open({
      key: 'photoCaption',
      title: '写真の向き',
      hint: 'どこから撮った写真か',
      presets: PHOTO_CAPTIONS,
      historyLabel: '向き',
      current: photo.caption || '',
      placeholder: '例）右サイド',
      suggest: PHOTO_CAPTIONS.concat(['トップ（つむじ）', '右サイド', '左サイド']),
      onPick: function (v) { photo.caption = v; done(); }
    });
  }

  function yen(n) {
    if (n == null || n === '') return '';
    return Number(n).toLocaleString('ja-JP') + '円';
  }

  /* ---------------- データ読み込み ---------------- */

  function reload() {
    return Promise.all([DB.allRecords(), DB.allPhotos(), DB.allSheets()]).then(function (res) {
      state.records = res[0];
      state.photos = res[1];
      state.sheets = res[2];
    });
  }

  function photosOf(recordId, kind) {
    return state.photos.filter(function (p) {
      return p.recordId === recordId && (!kind || p.kind === kind);
    }).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  }

  function coverPhoto(recordId) {
    return photosOf(recordId, 'self')[0] || photosOf(recordId, 'ref')[0] || null;
  }

  /* ---------------- 注文シート（そのまま美容師さんに見せる文章） ---------------- */

  function orderSheet(r) {
    var lines = [];
    var head = [];
    if (r.styleName) head.push(r.styleName);
    if (r.lengthGenre) head.push('（' + r.lengthGenre + '）');
    if (head.length) lines.push('【スタイル】' + head.join(''));

    var mm = [];
    if (r.sideMm) mm.push('サイド ' + r.sideMm);
    if (r.backMm) mm.push('バック ' + r.backMm);
    if (r.sideburnMm) mm.push('もみあげ ' + r.sideburnMm);
    if (r.fadeHeight) mm.push('刈り上げの高さ ' + r.fadeHeight);
    if (mm.length) lines.push('【刈り上げ】' + mm.join(' / '));

    var len = [];
    if (r.topLen) len.push('トップ ' + r.topLen);
    if (r.frontLen) len.push('前髪 ' + r.frontLen);
    if (len.length) lines.push('【長さ】' + len.join(' / '));

    var opt = [];
    if (r.thinning) opt.push('量感 ' + r.thinning);
    if (r.perm) opt.push('パーマ ' + r.perm);
    if (r.color) opt.push('カラー ' + r.color);
    if (opt.length) lines.push('【その他】' + opt.join(' / '));

    if (r.orderNote) lines.push('【伝えること】' + r.orderNote);
    if (r.next) lines.push('【次回はこうしたい】' + r.next);
    if (r.styling) lines.push('【ふだんのセット】' + r.styling);

    return lines.join('\n');
  }

  /* ---------------- ルーター ---------------- */

  function route() {
    closeLightbox();
    closeMapSheet();
    closeFindSheet();
    closeSheetPicker();
    if (window.HeadMap) HeadMap.close();
    releaseURLs();
    var hash = location.hash || '#/sheets';
    var parts = hash.replace(/^#\//, '').split('/');
    var view = parts[0] || 'list';
    var id = parts[1] || null;

    var group = {
      detail: 'list', new: 'list', edit: 'list',
      sheet: 'sheets', 'sheet-new': 'sheets', 'sheet-edit': 'sheets'
    }[view] || view;

    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === group);
    });

    // 追加ボタンは「カルテ」と「注文シート」でだけ出す
    fabTarget = group === 'list' ? '#/new' : '#/sheet-new';
    fab.hidden = !(group === 'list' || group === 'sheets') ||
      view === 'new' || view === 'edit' || view === 'sheet-new' || view === 'sheet-edit';
    fab.title = group === 'list' ? '新しいカルテを追加' : '新しい注文シートを追加';

    // 美容室で使う画面（伝える・見せる）ではヘッダーやタブを隠して、内容だけにする
    var presenting = view === 'show' || view === 'say';
    document.body.classList.toggle('is-showing', presenting);
    keepAwake(presenting);
    window.scrollTo(0, 0);

    if (view === 'detail' && id) return renderDetail(id);
    if (view === 'new') return renderForm(null, id);
    if (view === 'edit' && id) return renderForm(id, null);
    if (view === 'sheets') return renderSheets();
    if (view === 'sheet' && id) return renderSheetDetail(id);
    if (view === 'sheet-new') return renderSheetForm(null);
    if (view === 'sheet-edit' && id) return renderSheetForm(id);
    if (view === 'show' && id) return renderShow(id);
    if (view === 'say' && id) return renderSay(id);
    if (view === 'list') return renderList();
    if (view === 'stats') return renderStats();
    if (view === 'settings') return renderSettings();
    return renderSheets();
  }

  function mount(tplId) {
    var tpl = document.getElementById(tplId);
    main.innerHTML = '';
    main.appendChild(tpl.content.cloneNode(true));

    // 「髪型の注文」「写真」はカルテと注文シートで同じものを使う
    main.querySelectorAll('[data-slot]').forEach(function (slot) {
      var t = document.getElementById('tpl-' + slot.dataset.slot);
      if (t) slot.replaceWith(t.content.cloneNode(true));
    });
    return main;
  }

  function go(hash) { location.hash = hash; }

  /* ---------------- 一覧 ---------------- */

  function renderList() {
    mount('tpl-list');

    var q = document.getElementById('q');
    var sortSel = document.getElementById('sort');
    q.value = state.query;
    sortSel.value = state.sort;
    q.addEventListener('input', function () { state.query = q.value; drawCards(); });
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; drawCards(); });

    main.querySelector('[data-action="new"]').addEventListener('click', function () { go('#/new'); });

    drawSummary();
    drawCards();
  }

  function drawSummary() {
    var box = document.getElementById('summary');
    if (!box) return;
    if (!state.records.length) { box.hidden = true; return; }

    var latest = state.records[0];
    var since = daysSince(latest.date);
    var avg = averageInterval();
    var nextText = '—';
    if (avg && latest.date) {
      var d = parseISO(latest.date);
      d.setDate(d.getDate() + Math.round(avg));
      var left = Math.round((d - parseISO(todayISO())) / 86400000);
      nextText = (d.getMonth() + 1) + '/' + d.getDate() +
        (left >= 0 ? '（あと' + left + '日）' : '（' + Math.abs(left) + '日超過）');
    }

    // 日付と場所は同じ行にまとめる。空の項目は出さない。
    var where = [latest.salon, latest.stylist].filter(Boolean).join(' / ');
    var line = [formatDate(latest.date), where].filter(Boolean).join('　・　');

    box.hidden = false;
    box.innerHTML =
      '<div class="summary__main">' +
        '<span class="summary__num">' + (since == null ? '—' : since) + '</span>' +
        '<span class="summary__unit">日前にカット</span>' +
      '</div>' +
      '<p class="summary__date">' + esc(line) + '</p>' +
      '<dl class="summary__sub">' +
        '<div><dt>カット回数</dt><dd>' + state.records.length + '回</dd></div>' +
        '<div><dt>平均周期</dt><dd>' + (avg ? Math.round(avg) + '日' : '—') + '</dd></div>' +
        '<div><dt>次の目安</dt><dd>' + esc(nextText) + '</dd></div>' +
      '</dl>';
  }

  function averageInterval() {
    var dated = state.records.filter(function (r) { return r.date; })
      .map(function (r) { return r.date; }).sort();
    if (dated.length < 2) return null;
    var total = 0, n = 0;
    for (var i = 1; i < dated.length; i++) {
      var d = daysBetween(dated[i - 1], dated[i]);
      if (d != null && d > 0) { total += d; n++; }
    }
    return n ? total / n : null;
  }

  function filteredRecords() {
    var q = state.query.trim().toLowerCase();
    var rows = state.records.slice();
    if (q) {
      rows = rows.filter(function (r) {
        return [r.styleName, r.salon, r.area, r.stylist, r.orderNote, r.good, r.bad, r.next,
          r.perm, r.color, r.lengthGenre]
          .filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
      });
    }
    if (state.sort === 'date-asc') {
      rows.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    } else if (state.sort === 'rating-desc') {
      rows.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0) || (b.date || '').localeCompare(a.date || ''); });
    }
    return rows;
  }

  function drawCards() {
    var wrap = document.getElementById('cards');
    var empty = document.getElementById('empty');
    if (!wrap) return;

    var rows = filteredRecords();
    empty.hidden = state.records.length !== 0;
    if (state.records.length && !rows.length) {
      wrap.innerHTML = '<p class="nohit">「' + esc(state.query) + '」に一致するカルテはありません。</p>';
      return;
    }

    wrap.innerHTML = '';
    rows.forEach(function (r) {
      var cover = coverPhoto(r.id);
      var card = document.createElement('a');
      card.className = 'card';
      card.href = '#/detail/' + r.id;

      var thumbHTML = cover
        ? '<img class="card__img" src="' + objectURL(cover.thumb || cover.full) + '" alt="">'
        : '<div class="card__img card__img--none">' + icon('photo') + '</div>';

      var chips = [];
      if (r.sideMm) chips.push('サイド ' + r.sideMm);
      if (r.backMm) chips.push('バック ' + r.backMm);
      if (r.topLen) chips.push('トップ ' + r.topLen);
      if (r.color) chips.push('カラー');
      if (r.perm) chips.push('パーマ');

      card.innerHTML =
        thumbHTML +
        '<div class="card__body">' +
          '<p class="card__date">' + esc(formatDate(r.date)) + '</p>' +
          '<h3 class="card__style">' + esc(r.styleName || '（スタイル名なし）') + '</h3>' +
          '<p class="card__salon">' + esc([r.salon, r.stylist].filter(Boolean).join(' / ') || '店名の記録なし') + '</p>' +
          '<div class="chips">' + chips.slice(0, 4).map(function (c) {
            return '<span class="chip">' + esc(c) + '</span>';
          }).join('') + '</div>' +
          '<p class="card__stars">' + stars(r.rating) + '</p>' +
        '</div>';
      wrap.appendChild(card);
    });
  }

  /* ---------------- 詳細 ---------------- */

  function renderDetail(id) {
    var r = state.records.filter(function (x) { return x.id === id; })[0];
    if (!r) { go('#/list'); return; }

    mount('tpl-detail');
    var root = main;

    root.querySelector('[data-f="styleName"]').textContent = r.styleName || '（スタイル名なし）';
    root.querySelector('[data-f="rating"]').innerHTML = stars(r.rating);

    var since = daysSince(r.date);
    var meta = [formatDate(r.date)];
    if (since != null) meta.push(since + '日前');
    if (r.salon) meta.push(r.salon + (r.area ? '（' + r.area + '）' : ''));
    if (r.stylist) meta.push('担当：' + r.stylist);
    if (r.price) meta.push(yen(r.price));
    root.querySelector('[data-f="meta"]').textContent = meta.join(' ・ ');

    var mapBox = root.querySelector('[data-f="maplink"]');
    var mapHref = Maps.linkFor(r);
    if (mapHref) {
      mapBox.hidden = false;
      mapBox.innerHTML = '<a class="btn btn--small" target="_blank" rel="noopener noreferrer" href="' +
        esc(mapHref) + '">' + icon('pin') +
        (r.mapUrl ? 'Googleマップで開く' : 'Googleマップで検索') + '</a>';
    }

    var sheet = orderSheet(r);

    HeadMap.render(root.querySelector('#detail-headmap'), r, { editable: false });

    // 図に出ない項目だけを一覧で補う
    var specs = [
      ['長さ感', r.lengthGenre],
      ['量感調整', r.thinning],
      ['パーマ', r.perm],
      ['カラー', r.color],
      ['スタイリング', r.styling]
    ].filter(function (row) { return row[1]; });

    root.querySelector('[data-f="specs"]').innerHTML = specs.map(function (row) {
      return '<div class="speclist__row"><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
    }).join('');

    var noteBox = root.querySelector('[data-f="orderNote"]');
    if (r.orderNote) {
      noteBox.hidden = false;
      noteBox.innerHTML = '<h4 class="notebox__title">伝えたこと・注文メモ</h4><p>' +
        esc(r.orderNote).replace(/\n/g, '<br>') + '</p>';
    }

    drawThumbs(root.querySelector('[data-f="photos-ref"]'), photosOf(r.id, 'ref'), '参考モデルの写真はありません');
    drawThumbs(root.querySelector('[data-f="photos-self"]'), photosOf(r.id, 'self'), '自分の写真はありません');

    var review = [
      ['よかった点', r.good],
      ['いまいちだった点', r.bad],
      ['次回はこうする', r.next]
    ].filter(function (row) { return row[1]; });
    root.querySelector('[data-f="review"]').innerHTML = review.length
      ? review.map(function (row) {
          return '<div class="review__row"><h4>' + esc(row[0]) + '</h4><p>' +
            esc(row[1]).replace(/\n/g, '<br>') + '</p></div>';
        }).join('')
      : '<p class="muted">自己評価のメモはまだありません。</p>';

    root.querySelector('[data-action="back"]').addEventListener('click', function () { go('#/list'); });
    root.querySelector('[data-action="edit"]').addEventListener('click', function () { go('#/edit/' + r.id); });
    root.querySelector('[data-action="duplicate"]').addEventListener('click', function () { go('#/new/' + r.id); });

    root.querySelector('[data-action="copy-order"]').addEventListener('click', function () {
      copyText(sheet || '（注文の記録がありません）');
    });

    root.querySelector('[data-action="show"]').addEventListener('click', function () {
      go('#/show/' + r.id);
    });

    root.querySelector('[data-action="say"]').addEventListener('click', function () {
      go('#/say/' + r.id);
    });

    root.querySelector('[data-action="delete"]').addEventListener('click', function () {
      if (!confirm('このカルテと写真を削除します。よろしいですか？')) return;
      DB.deleteRecord(r.id).then(reload).then(function () {
        toast('カルテを削除しました');
        go('#/list');
      });
    });
  }

  function drawThumbs(container, photos, emptyText) {
    if (!photos.length) {
      container.innerHTML = '<p class="muted">' + esc(emptyText) + '</p>';
      return;
    }
    container.innerHTML = '';
    photos.forEach(function (p) {
      var fig = document.createElement('figure');
      fig.className = 'photo';
      fig.innerHTML =
        '<button type="button" class="thumb">' +
          '<img src="' + objectURL(p.thumb || p.full) + '" alt="' + esc(p.caption || '') + '">' +
        '</button>' +
        '<figcaption class="photo__cap">' + esc(p.caption || '') + '</figcaption>';
      if (!p.caption) fig.querySelector('.photo__cap').hidden = true;
      if (p.source) fig.appendChild(sourceLink(p.source));
      fig.querySelector('.thumb').addEventListener('click', function () { openLightbox(p); });
      container.appendChild(fig);
    });
  }

  function copyText(text) {
    var ok = function () { toast('注文シートをコピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text, ok); });
    } else {
      fallbackCopy(text, ok);
    }
  }

  function fallbackCopy(text, ok) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ok(); }
    catch (e) { toast('コピーできませんでした'); }
    document.body.removeChild(ta);
  }

  function openLightbox(photo) {
    var img = lightbox.querySelector('.lightbox__img');
    img.src = objectURL(photo.full || photo.thumb);
    var cap = lightbox.querySelector('.lightbox__cap');
    cap.innerHTML = esc(photo.caption || '');
    if (photo.source) {
      cap.appendChild(document.createTextNode(' '));
      cap.appendChild(sourceLink(photo.source));
    }
    cap.hidden = !(photo.caption || photo.source);
    lightbox.hidden = false;
  }

  function closeLightbox() {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    lightbox.querySelector('.lightbox__img').removeAttribute('src');
    lightbox.querySelector('.lightbox__cap').textContent = '';
  }

  lightbox.addEventListener('click', function (e) {
    // 元ページのリンクを押したときは閉じない
    if (e.target.closest('.photo__src')) return;
    closeLightbox();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });

  /* ---------------- 入力フォーム ---------------- */

  function renderForm(editId, copyFromId) {
    mount('tpl-form');
    var form = document.getElementById('form');
    var base = editId
      ? state.records.filter(function (x) { return x.id === editId; })[0]
      : (copyFromId ? state.records.filter(function (x) { return x.id === copyFromId; })[0] : null);

    if (editId && !base) { go('#/list'); return; }

    document.getElementById('form-title').textContent = editId ? 'カルテを編集' : '新しいカルテ';
    fillDatalists();

    // 写真は共通の処理にまかせる（参考モデルの写真は「この内容で新規」で引き継ぐ）
    var photoBox = setupPhotos(form, editId, copyFromId);

    if (base) {
      Object.keys(base).forEach(function (k) {
        var el = form.elements[k];
        if (el && el.type !== 'file') el.value = base[k] == null ? '' : base[k];
      });
      if (!editId) {
        // 「この内容で新規」は日付と評価だけリセットする
        form.elements.date.value = todayISO();
        form.elements.rating.value = 0;
        ['good', 'bad', 'next'].forEach(function (k) { form.elements[k].value = ''; });
      }
    } else {
      form.elements.date.value = todayISO();
    }

    setupStars(form, Number(form.elements.rating.value) || 0);
    setupHeadMap(form);
    setupStyleSelect(form);
    setupMapLink(form);

    form.querySelector('[data-action="paste-sheet"]')
      .addEventListener('click', function () { openSheetPicker(form, photoBox); });

    // 「このシートでカルテを作る」から来たとき
    if (!editId && pendingSheet) {
      var n = applySheetToForm(form, pendingSheet, photoBox);
      toast('「' + (pendingSheet.name || '注文シート') + '」の内容を入れました' +
        (n ? '（写真' + n + '枚も）' : ''));
      pendingSheet = null;
    }
    form.querySelector('[data-action="cancel"]').addEventListener('click', function () {
      history.length > 1 ? history.back() : go('#/list');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.elements.date.value) {
        toast('カットした日を入力してください');
        form.elements.date.focus();
        return;
      }

      var id = editId || uid();
      var record = {
        id: id,
        date: form.elements.date.value,
        salon: form.elements.salon.value.trim(),
        area: form.elements.area.value.trim(),
        mapUrl: form.elements.mapUrl.value.trim(),
        lat: form.elements.lat.value ? Number(form.elements.lat.value) : null,
        lng: form.elements.lng.value ? Number(form.elements.lng.value) : null,
        stylist: form.elements.stylist.value.trim(),
        price: form.elements.price.value ? Number(form.elements.price.value) : null,
        styleName: form.elements.styleName.value.trim(),
        lengthGenre: form.elements.lengthGenre.value,
        sideMm: form.elements.sideMm.value.trim(),
        backMm: form.elements.backMm.value.trim(),
        sideburnMm: form.elements.sideburnMm.value.trim(),
        topLen: form.elements.topLen.value.trim(),
        frontLen: form.elements.frontLen.value.trim(),
        fadeHeight: form.elements.fadeHeight.value.trim(),
        thinning: form.elements.thinning.value,
        perm: form.elements.perm.value.trim(),
        color: form.elements.color.value.trim(),
        styling: form.elements.styling.value.trim(),
        orderNote: form.elements.orderNote.value.trim(),
        rating: Number(form.elements.rating.value) || 0,
        good: form.elements.good.value.trim(),
        bad: form.elements.bad.value.trim(),
        next: form.elements.next.value.trim(),
        createdAt: base && editId ? base.createdAt : Date.now(),
        updatedAt: Date.now()
      };

      DB.putRecord(record)
        .then(function () { return DB.deletePhotos(photoBox.removed()); })
        .then(function () { return DB.putPhotos(photoBox.photosFor(id)); })
        .then(reload)
        .then(function () {
          toast(editId ? 'カルテを更新しました' : 'カルテを保存しました');
          go('#/detail/' + id);
        })
        .catch(function (err) {
          console.error(err);
          toast('保存できませんでした：' + (err && err.name === 'QuotaExceededError' ? '端末の空き容量が足りません' : 'エラーが発生しました'));
        });
    });
  }

  /**
   * 写真の追加・削除・キャプション・顔隠しをまとめて扱う。
   * カルテと注文シートで同じものを使うので、持ち主の種類は問わない。
   * ownerId: 編集中なら既存の写真を読み込む
   * seedRefFrom: 「この内容で新規」のとき、参考モデルの写真だけ引き継ぐ元のID
   */
  function setupPhotos(form, ownerId, seedRefFrom) {
    var draft = ownerId ? photosOf(ownerId).slice() : [];
    var removed = [];
    var refSource = '';   // 「モデルを探す」で控えた、見つけたページのURL

    if (!ownerId && seedRefFrom) {
      draft = photosOf(seedRefFrom, 'ref').map(copyPhoto);
    }

    ['ref', 'self'].forEach(draw);

    /** ファイル（選択・貼り付け・ドロップ）をまとめて取り込む */
    function addFiles(kind, files, source) {
      files = Array.prototype.slice.call(files || []).filter(function (f) {
        return f && (f.type || '').indexOf('image/') === 0;
      });
      if (!files.length) return Promise.resolve(0);

      toast('画像を処理しています…');
      // 並列で処理するので、順番は選んだときの添字で固定する
      var base = Date.now();
      return Promise.all(files.map(function (f, i) {
        return Photos.process(f).then(function (out) {
          return {
            id: uid(),
            recordId: ownerId || null,
            kind: kind,
            full: out.full,
            thumb: out.thumb,
            width: out.width,
            height: out.height,
            caption: '',
            source: source || '',
            createdAt: base + i
          };
        });
      })).then(function (added) {
        draft = draft.concat(added);
        draw(kind);
        toast(added.length + '枚追加しました');
        return added.length;
      }).catch(function (err) {
        console.error(err);
        toast('画像を読み込めませんでした');
        return 0;
      });
    }

    form.querySelectorAll('[data-upload]').forEach(function (input) {
      // 自分で用意した写真なので、探したページのリンクは付けない
      input.addEventListener('change', function () {
        addFiles(input.dataset.upload, input.files, '');
        input.value = '';
      });
    });

    // 画像をドラッグ&ドロップでも入れられるようにする（パソコン向け）
    ['ref', 'self'].forEach(function (kind) {
      var zone = form.querySelector('[data-slot-photos="' + kind + '"]');
      if (!zone) return;
      ['dragenter', 'dragover'].forEach(function (t) {
        zone.addEventListener(t, function (e) {
          e.preventDefault();
          zone.classList.add('is-over');
        });
      });
      ['dragleave', 'drop'].forEach(function (t) {
        zone.addEventListener(t, function () { zone.classList.remove('is-over'); });
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        addFiles(kind, (e.dataTransfer || {}).files, '');
      });
    });

    form.querySelectorAll('[data-action="paste-photo"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.dataset.kind;
        pasteImages().then(function (files) {
          if (!files.length) {
            toast('クリップボードに画像がありません');
            return;
          }
          addFiles(kind, files, kind === 'ref' ? refSource : '');
        }, function () {
          toast('貼り付けできませんでした。Ctrl+V（スマホは長押しで貼り付け）もお試しください');
        });
      });
    });

    // ページのどこで Ctrl+V しても参考モデルに入るようにしておく
    var onPaste = function (e) {
      if (!document.body.contains(form)) { document.removeEventListener('paste', onPaste); return; }
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      var items = ((e.clipboardData || {}).files) || [];
      if (!items.length) return;
      e.preventDefault();
      addFiles('ref', items, refSource);
    };
    document.addEventListener('paste', onPaste);

    var findBtn = form.querySelector('[data-action="find-model"]');
    if (findBtn) {
      findBtn.addEventListener('click', function () {
        openFindSheet({
          record: {
            styleName: form.elements.styleName ? form.elements.styleName.value : '',
            lengthGenre: form.elements.lengthGenre ? form.elements.lengthGenre.value : ''
          },
          source: refSource,
          onSource: function (url) { refSource = url; },
          onFiles: function (files) { addFiles('ref', files, refSource); }
        });
      });
    }

    function draw(kind) {
      var slot = form.querySelector('[data-slot-photos="' + kind + '"]');
      if (!slot) return;
      var list = draft.filter(function (p) { return p.kind === kind; });
      if (!list.length) {
        slot.innerHTML = '<p class="muted">写真なし</p>';
        return;
      }
      slot.innerHTML = '';
      list.forEach(function (p) {
        var fig = document.createElement('figure');
        fig.className = 'photo';

        var item = document.createElement('div');
        item.className = 'thumb thumb--editable';
        item.innerHTML = '<img src="' + objectURL(p.thumb || p.full) + '" alt="">' +
          '<button type="button" class="thumb__del" title="削除">×</button>' +
          '<button type="button" class="thumb__mask">' + icon('mask') + '顔を隠す</button>';

        var capBtn = document.createElement('button');
        capBtn.type = 'button';
        capBtn.className = 'photo__capbtn' + (p.caption ? ' is-set' : '');
        capBtn.textContent = p.caption || '向きを選ぶ';
        capBtn.addEventListener('click', function () {
          openCaptionPicker(p, function () { draw(kind); });
        });

        item.querySelector('.thumb__del').addEventListener('click', function () {
          draft = draft.filter(function (x) { return x.id !== p.id; });
          removed.push(p.id);
          draw(kind);
        });

        item.querySelector('.thumb__mask').addEventListener('click', function () {
          MaskEditor.open(p, function (out) {
            p.full = out.full;
            p.thumb = out.thumb;
            p.width = out.width;
            p.height = out.height;
            p.masked = true;
            draw(kind);
            toast('顔を隠しました（保存すると確定します）');
          }).catch(function (err) {
            console.error(err);
            toast('画像を開けませんでした');
          });
        });

        fig.appendChild(item);
        fig.appendChild(capBtn);
        if (p.source) fig.appendChild(sourceLink(p.source));
        slot.appendChild(fig);
      });
    }

    return {
      /** 保存用に、持ち主のIDを入れた配列を返す */
      photosFor: function (id) {
        return draft.map(function (p) {
          return {
            id: p.id, recordId: id, kind: p.kind, full: p.full, thumb: p.thumb,
            width: p.width, height: p.height, masked: !!p.masked,
            caption: p.caption || '', source: p.source || '', createdAt: p.createdAt
          };
        });
      },
      removed: function () { return removed; },
      /** 注文シートを貼り付けたときに、参考モデルの写真を足す */
      addRefFrom: function (srcId) {
        var add = photosOf(srcId, 'ref').map(copyPhoto);
        if (!add.length) return 0;
        draft = draft.concat(add);
        draw('ref');
        return add.length;
      }
    };
  }

  /** 写真を別の持ち主にコピーする（中身は同じ Blob を共有してよい） */
  function copyPhoto(p) {
    return {
      id: uid(), recordId: null, kind: p.kind, full: p.full, thumb: p.thumb,
      width: p.width, height: p.height, masked: !!p.masked,
      caption: p.caption || '', source: p.source || '', createdAt: Date.now()
    };
  }

  /** 「元ページ」へのリンク。参考にした写真の出どころを開けるようにする */
  function sourceLink(url) {
    var a = document.createElement('a');
    a.className = 'photo__src';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = icon('open') + '<span>' + esc(Models.hostOf(url) || '元ページ') + '</span>';
    return a;
  }

  /**
   * クリップボードの画像を取り出す。
   * 対応していないブラウザや、許可が下りないときは reject する（Ctrl+V での貼り付けは別で拾う）。
   */
  function pasteImages() {
    if (!navigator.clipboard || !navigator.clipboard.read) return Promise.reject(new Error('no clipboard'));
    return navigator.clipboard.read().then(function (items) {
      var jobs = [];
      items.forEach(function (item, n) {
        item.types.filter(function (t) { return t.indexOf('image/') === 0; }).slice(0, 1)
          .forEach(function (type) {
            jobs.push(item.getType(type).then(function (blob) {
              return new File([blob], 'pasted-' + (n + 1) + '.' + type.split('/')[1], { type: type });
            }));
          });
      });
      return Promise.all(jobs);
    });
  }

  /** お店とGoogleマップの紐付け */
  function setupMapLink(form) {
    var salon = form.elements.salon;
    var urlEl = form.elements.mapUrl;
    var latEl = form.elements.lat;
    var lngEl = form.elements.lng;
    var linked = form.querySelector('[data-f="maplinked"]');
    var label = form.querySelector('[data-f="maplabel"]');

    function paint() {
      var has = !!urlEl.value;
      linked.hidden = !has;
      if (has) {
        label.textContent = (latEl.value && lngEl.value)
          ? 'マップと紐付け済み（場所も記録）'
          : 'マップと紐付け済み';
      }
    }

    form.querySelector('[data-action="map-search"]').addEventListener('click', function () {
      window.open(Maps.searchLink(salon.value + ' ' + form.elements.area.value), '_blank', 'noopener');
    });

    form.querySelector('[data-action="map-paste"]').addEventListener('click', function () {
      openMapSheet(function (info) {
        urlEl.value = info.url || '';
        latEl.value = info.lat == null ? '' : info.lat;
        lngEl.value = info.lng == null ? '' : info.lng;
        // 店名が空のときだけ、読み取った名前で埋める
        if (info.name && !salon.value.trim()) salon.value = info.name;
        paint();
        toast('マップの情報を取り込みました');
      });
    });

    form.querySelector('[data-action="map-clear"]').addEventListener('click', function () {
      urlEl.value = '';
      latEl.value = '';
      lngEl.value = '';
      paint();
    });

    // 過去に紐付けたお店を選んだら、その情報を引き継ぐ
    salon.addEventListener('change', function () {
      if (urlEl.value) return;
      var name = salon.value.trim();
      if (!name) return;
      var past = state.records.filter(function (r) {
        return r.salon === name && (r.mapUrl || r.lat != null);
      })[0];
      if (!past) return;
      urlEl.value = past.mapUrl || '';
      latEl.value = past.lat == null ? '' : past.lat;
      lngEl.value = past.lng == null ? '' : past.lng;
      paint();
      if (urlEl.value) toast('前回のマップ情報を引き継ぎました');
    });

    paint();
  }

  /* マップのリンクを貼り付けるシート */
  var mapSheet = null;
  var mapDone = null;
  var mapInfo = null;

  /* ---------------- 参考モデルを探す ---------------- */

  var findSheet = null;
  var findOpts = null;

  function openFindSheet(opts) {
    findOpts = opts;

    if (!findSheet) {
      findSheet = document.getElementById('findsheet');

      findSheet.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'close') { closeFindSheet(); return; }
        if (act && act.dataset.act === 'paste') {
          pasteImages().then(function (files) {
            if (!files.length) { toast('クリップボードに画像がありません'); return; }
            var cb = findOpts && findOpts.onFiles;
            closeFindSheet();
            if (cb) cb(files);
          }, function () {
            toast('貼り付けできませんでした。画像を長押しして「画像をコピー」してからお試しください');
          });
          return;
        }

        var seg = e.target.closest('.gender');
        if (seg) {
          store('hk-model-gender', seg.dataset.g);
          paintFind(true);
        }
      });

      findSheet.querySelector('[data-f="q"]').addEventListener('input', function () { drawSites(); });
      findSheet.querySelector('[data-f="src"]').addEventListener('input', function () {
        var url = Models.pickUrl(this.value);
        if (findOpts && findOpts.onSource) findOpts.onSource(url);
        var note = findSheet.querySelector('[data-f="srcnote"]');
        note.hidden = !this.value.trim();
        note.textContent = url
          ? 'このあと追加する写真に「' + Models.hostOf(url) + '」へのリンクを付けます'
          : 'URLが見つかりません。ページのアドレスを貼り付けてください';
      });
    }

    var src = findSheet.querySelector('[data-f="src"]');
    src.value = opts.source || '';
    // すでにリンクを控えているときは、それが付くことを見えるようにしておく
    src.dispatchEvent(new Event('input'));
    findSheet.querySelector('[data-f="srcnote"]').hidden = !opts.source;
    paintFind(false);
    findSheet.hidden = false;
  }

  /** @param {boolean} regen キーワードを作り直すか（性別を変えたときだけ） */
  function paintFind(regen) {
    var gender = store('hk-model-gender') || 'none';
    findSheet.querySelectorAll('.gender').forEach(function (s) {
      s.classList.toggle('is-on', s.dataset.g === gender);
    });
    var q = findSheet.querySelector('[data-f="q"]');
    if (regen || !q.value.trim()) q.value = Models.query(findOpts.record, gender);
    drawSites();
  }

  function drawSites() {
    var q = findSheet.querySelector('[data-f="q"]').value.trim();
    findSheet.querySelector('[data-f="sites"]').innerHTML = Models.SITES.map(function (s) {
      return '<a class="siteitem" target="_blank" rel="noopener noreferrer" href="' +
        esc(s.link(q)) + '">' +
        '<span class="siteitem__body">' +
          '<span class="siteitem__name">' + esc(s.name) + '</span>' +
          '<span class="siteitem__note">' + esc(s.note) + '</span>' +
        '</span>' + icon('open') + '</a>';
    }).join('');
  }

  function closeFindSheet() {
    if (findSheet) findSheet.hidden = true;
    findOpts = null;
  }

  function openMapSheet(done) {
    if (!mapSheet) {
      mapSheet = document.getElementById('mapsheet');
      mapSheet.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'close') closeMapSheet();
        if (act.dataset.act === 'apply') {
          if (!mapInfo) { toast('リンクを貼り付けてください'); return; }
          var cb = mapDone;
          var info = mapInfo;
          closeMapSheet();
          if (cb) cb(info);
        }
      });
      mapSheet.querySelector('[data-f="paste"]').addEventListener('input', function () {
        mapInfo = Maps.parseShare(this.value);
        drawMapResult();
      });
    }

    mapDone = done;
    mapInfo = null;
    mapSheet.querySelector('[data-f="paste"]').value = '';
    drawMapResult();
    mapSheet.hidden = false;
  }

  function drawMapResult() {
    var box = mapSheet.querySelector('[data-f="result"]');
    if (!mapInfo || (!mapInfo.name && !mapInfo.url)) {
      box.hidden = true;
      return;
    }
    var rows = [];
    if (mapInfo.name) rows.push(['お店', mapInfo.name]);
    if (mapInfo.lat != null) rows.push(['場所', mapInfo.lat.toFixed(5) + ', ' + mapInfo.lng.toFixed(5)]);
    if (mapInfo.url) rows.push(['リンク', mapInfo.url.length > 42 ? mapInfo.url.slice(0, 42) + '…' : mapInfo.url]);
    box.hidden = false;
    box.innerHTML = '<p class="mapresult__title">読み取った内容</p>' + rows.map(function (r) {
      return '<div class="mapresult__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') +
      (mapInfo.name ? '' : '<p class="mapresult__note">店名は読み取れませんでした。リンクだけ記録します。</p>');
  }

  function closeMapSheet() {
    if (mapSheet) mapSheet.hidden = true;
    mapDone = null;
    mapInfo = null;
  }

  /** ヘアスタイルは選択式。一覧に無いものは「その他」で自由に入力できる */
  function setupStyleSelect(form) {
    var sel = form.elements.styleSelect;
    var text = form.elements.styleName;
    if (!sel || !text) return;

    // 過去に使ったスタイルを候補の先頭に足す
    var used = {};
    state.records.forEach(function (r) { if (r.styleName) used[r.styleName] = true; });
    var og = form.querySelector('#og-used');
    var names = Object.keys(used);
    og.innerHTML = names.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
    og.hidden = names.length === 0;

    function hasOption(v) {
      return Array.prototype.some.call(sel.options, function (o) {
        return o.value === v && o.value !== '__other';
      });
    }

    function showOther(show) {
      text.hidden = !show;
      if (show) text.focus();
    }

    // 保存されている値から選択状態を復元する
    var value = text.value.trim();
    if (!value) {
      sel.value = '';
      showOther(false);
    } else if (hasOption(value)) {
      sel.value = value;
      showOther(false);
    } else {
      sel.value = '__other';
      showOther(true);
    }

    sel.addEventListener('change', function () {
      if (sel.value === '__other') {
        showOther(true);
        text.value = '';
      } else {
        showOther(false);
        text.value = sel.value;
      }
    });
  }

  /** 部位図と hidden input を同期させる */
  function setupHeadMap(form) {
    var box = form.querySelector('#form-headmap');
    if (!box) return;

    var values = {};
    HeadMap.order.forEach(function (k) {
      values[k] = form.elements[k] ? form.elements[k].value : '';
    });

    HeadMap.render(box, values, {
      editable: true,
      onChange: function (key, value) {
        if (form.elements[key]) form.elements[key].value = value;
      }
    });
  }

  function setupStars(form, initial) {
    var box = document.getElementById('stars-input');
    var label = document.getElementById('stars-label');
    var labels = ['未評価', 'いまいち', 'すこし不満', 'ふつう', '満足', '大満足'];

    function paint(v) {
      box.querySelectorAll('.star').forEach(function (s) {
        s.classList.toggle('is-on', Number(s.dataset.v) <= v);
      });
      label.textContent = labels[v] || '未評価';
    }

    box.querySelectorAll('.star').forEach(function (s) {
      s.addEventListener('click', function () {
        var v = Number(s.dataset.v);
        // 同じ星をもう一度押したら未評価に戻す
        if (Number(form.elements.rating.value) === v) v = 0;
        form.elements.rating.value = v;
        paint(v);
      });
    });
    paint(initial);
  }

  function fillDatalists() {
    var map = { 'dl-salon': 'salon', 'dl-area': 'area', 'dl-stylist': 'stylist' };
    Object.keys(map).forEach(function (listId) {
      var el = document.getElementById(listId);
      if (!el) return;
      var seen = {};
      state.records.forEach(function (r) {
        var v = r[map[listId]];
        if (v && !seen[v]) { seen[v] = true; }
      });
      el.innerHTML = Object.keys(seen).map(function (v) {
        return '<option value="' + esc(v) + '"></option>';
      }).join('');
    });

    var styleList = document.getElementById('dl-style');
    if (styleList) {
      var seen = {};
      state.records.forEach(function (r) { if (r.styleName) seen[r.styleName] = true; });
      Object.keys(seen).forEach(function (v) {
        styleList.insertAdjacentHTML('afterbegin', '<option value="' + esc(v) + '"></option>');
      });
    }
  }

  /* ---------------- 美容師さんに見せる画面 ---------------- */

  var wakeLock = null;

  /** 見せている間は画面が消えないようにする（対応していない端末では何もしない） */
  function keepAwake(on) {
    if (!navigator.wakeLock) return;
    if (on) {
      if (wakeLock) return;
      navigator.wakeLock.request('screen').then(function (w) {
        wakeLock = w;
        w.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* 取れなくても表示には影響しない */ });
    } else if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  /** 注文シートでもカルテでも見せられるように、両方から探す */
  function findOrder(id) {
    return state.sheets.filter(function (x) { return x.id === id; })[0] ||
      state.records.filter(function (x) { return x.id === id; })[0] || null;
  }

  /** 「伝える」と「見せる」を行き来する上部バー。閉じると元の画面に戻る */
  function setupShowBar(root, id, current) {
    root.querySelectorAll('.switch__btn').forEach(function (b) {
      var to = b.dataset.go;
      b.classList.toggle('is-on', to === current);
      b.href = '#/' + to + '/' + id;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (to === current) return;
        location.replace('#/' + to + '/' + id);   // 行き来しても履歴を汚さない
      });
    });

    root.querySelector('[data-action="close-show"]').addEventListener('click', function () {
      var o = findOrder(id);
      if (!o) { go('#/sheets'); return; }
      go((o.name != null ? '#/sheet/' : '#/detail/') + id);
    });
  }

  /**
   * 自分の口で伝えるための文章。1行＝1つのお願いにして、上から読めば注文になる。
   * 言い回しは「〜でお願いします」に揃えて、どんな値でも自然につながるようにする。
   */
  function sayLines(o) {
    var lines = [];
    var style = [o.styleName, o.lengthGenre ? '（' + o.lengthGenre + '）' : ''].join('');
    if (style) lines.push({ label: 'スタイル', text: style + ' にしたいです。' });

    [
      ['サイド', o.sideMm],
      ['もみあげ', o.sideburnMm],
      ['バック', o.backMm],
      ['刈り上げの高さ', o.fadeHeight],
      ['トップ', o.topLen],
      ['前髪', o.frontLen],
      ['量感', o.thinning],
      ['パーマ', o.perm],
      ['カラー', o.color]
    ].forEach(function (r) {
      // 「耳の上まで」のように助詞で終わる値は「まで でお願い」にならないようにする
      var tail = /(まで|で)$/.test(r[1]) ? ' お願いします。' : ' でお願いします。';
      if (r[1]) lines.push({ label: r[0], text: r[0] + 'は ' + r[1] + tail });
    });

    if (o.styling) lines.push({ label: 'ふだんのセット', text: 'ふだんは ' + o.styling + ' でセットしています。' });
    if (o.orderNote) lines.push({ label: '伝えたいこと', text: o.orderNote, note: true });
    return lines;
  }

  function renderSay(id) {
    var o = findOrder(id);
    if (!o) { go('#/sheets'); return; }

    mount('tpl-say');
    var root = main;

    root.querySelector('[data-f="title"]').textContent = o.name || o.styleName || '髪型の注文';
    root.querySelector('[data-f="sub"]').textContent =
      [o.name ? o.styleName : '', o.lengthGenre].filter(Boolean).join('　・　');

    var lines = sayLines(o);
    var list = root.querySelector('[data-f="lines"]');
    var progress = root.querySelector('[data-f="progress"]');

    if (!lines.length) {
      list.innerHTML = '<li class="muted">伝える内容がまだありません。編集して指定を入れてください。</li>';
      progress.textContent = '';
    } else {
      list.innerHTML = lines.map(function (l) {
        return '<li class="sayitem' + (l.note ? ' sayitem--note' : '') + '">' +
          '<span class="sayitem__check">' + icon('check') + '</span>' +
          '<span class="sayitem__body">' +
            '<span class="sayitem__label">' + esc(l.label) + '</span>' +
            '<span class="sayitem__text">' + esc(l.text).replace(/\n/g, '<br>') + '</span>' +
          '</span></li>';
      }).join('');

      var count = function () {
        var done = list.querySelectorAll('.sayitem.is-done').length;
        progress.textContent = done + ' / ' + lines.length + ' 伝えました';
      };
      list.addEventListener('click', function (e) {
        var item = e.target.closest('.sayitem');
        if (!item) return;
        item.classList.toggle('is-done');
        count();
      });
      root.querySelector('[data-action="reset-say"]').addEventListener('click', function () {
        list.querySelectorAll('.sayitem').forEach(function (i) { i.classList.remove('is-done'); });
        count();
      });
      count();
    }

    var refs = photosOf(o.id, 'ref');
    if (refs.length) {
      root.querySelector('[data-f="photos"]').hidden = false;
      drawThumbs(root.querySelector('[data-f="photolist"]'), refs, '');
    }

    root.querySelector('[data-action="copy-order"]').addEventListener('click', function () {
      copyText(lines.map(function (l) { return l.text; }).join('\n') || '（内容がありません）');
    });

    setupShowBar(root, id, 'say');
  }

  function renderShow(id) {
    var o = findOrder(id);
    if (!o) { go('#/sheets'); return; }

    mount('tpl-show');
    var root = main;

    root.querySelector('[data-f="title"]').textContent =
      o.name || o.styleName || '髪型の注文';
    root.querySelector('[data-f="sub"]').textContent =
      [o.name ? o.styleName : '', o.lengthGenre].filter(Boolean).join('　・　');

    HeadMap.render(root.querySelector('#show-headmap'), o, { editable: false });

    // 美容師さんが順に読める並びにする
    var rows = [
      ['サイド', o.sideMm],
      ['もみあげ', o.sideburnMm],
      ['バック', o.backMm],
      ['刈り上げの高さ', o.fadeHeight],
      ['トップ', o.topLen],
      ['前髪', o.frontLen],
      ['量感', o.thinning],
      ['パーマ', o.perm],
      ['カラー', o.color]
    ].filter(function (r) { return r[1]; });

    root.querySelector('[data-f="specs"]').innerHTML = rows.length
      ? rows.map(function (r) {
          return '<div class="showlist__row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
        }).join('')
      : '<p class="muted">指定はまだありません。</p>';

    if (o.orderNote) {
      root.querySelector('[data-f="note"]').hidden = false;
      root.querySelector('[data-f="notetext"]').innerHTML = esc(o.orderNote).replace(/\n/g, '<br>');
    }

    var refs = photosOf(o.id, 'ref');
    if (refs.length) {
      root.querySelector('[data-f="photos"]').hidden = false;
      drawThumbs(root.querySelector('[data-f="photolist"]'), refs, '');
    }

    setupShowBar(root, id, 'show');
  }

  /* ---------------- 注文シート ---------------- */

  function renderSheets() {
    mount('tpl-sheets');

    var wrap = document.getElementById('sheet-cards');
    var empty = document.getElementById('sheet-empty');
    empty.hidden = state.sheets.length !== 0;
    empty.querySelector('[data-action="new-sheet"]')
      .addEventListener('click', function () { go('#/sheet-new'); });

    wrap.innerHTML = '';
    state.sheets.forEach(function (sh) {
      var chips = HeadMap.summary(sh).slice(0, 4).map(function (z) {
        return '<span class="chip">' + esc(z.label + ' ' + z.value) + '</span>';
      }).join('');

      var cover = coverPhoto(sh.id);
      var card = document.createElement('a');
      card.className = 'card card--sheet';
      card.href = '#/sheet/' + sh.id;
      card.innerHTML =
        (cover ? '<img class="card__img" src="' + objectURL(cover.thumb || cover.full) + '" alt="">' : '') +
        '<div class="card__body">' +
          '<h3 class="card__style">' + esc(sh.name || '（名前なし）') + '</h3>' +
          '<p class="card__salon">' + esc(sh.styleName || 'スタイル未設定') + '</p>' +
          '<div class="chips">' + chips + '</div>' +
        '</div>' +
        '<span class="card__go">' + icon('back') + '</span>';
      wrap.appendChild(card);
    });
  }

  function renderSheetDetail(id) {
    var sh = state.sheets.filter(function (x) { return x.id === id; })[0];
    if (!sh) { go('#/sheets'); return; }

    mount('tpl-sheet-detail');
    var root = main;

    root.querySelector('[data-f="name"]').textContent = sh.name || '（名前なし）';
    root.querySelector('[data-f="meta"]').textContent =
      [sh.styleName, sh.lengthGenre].filter(Boolean).join(' ・ ') || 'スタイル未設定';

    HeadMap.render(root.querySelector('#sheet-headmap'), sh, { editable: false });

    var specs = [
      ['長さ感', sh.lengthGenre],
      ['量感調整', sh.thinning],
      ['パーマ', sh.perm],
      ['カラー', sh.color],
      ['スタイリング', sh.styling]
    ].filter(function (row) { return row[1]; });
    root.querySelector('[data-f="specs"]').innerHTML = specs.map(function (row) {
      return '<div class="speclist__row"><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
    }).join('');

    var noteBox = root.querySelector('[data-f="orderNote"]');
    if (sh.orderNote) {
      noteBox.hidden = false;
      noteBox.innerHTML = '<h4 class="notebox__title">伝えたいこと</h4><p>' +
        esc(sh.orderNote).replace(/\n/g, '<br>') + '</p>';
    }

    drawThumbs(root.querySelector('[data-f="photos-ref"]'), photosOf(sh.id, 'ref'), '参考モデルの写真はありません');
    drawThumbs(root.querySelector('[data-f="photos-self"]'), photosOf(sh.id, 'self'), '自分の写真はありません');

    var text = orderSheet(sh);

    root.querySelector('[data-action="back"]').addEventListener('click', function () { go('#/sheets'); });
    root.querySelector('[data-action="edit-sheet"]').addEventListener('click', function () { go('#/sheet-edit/' + sh.id); });
    root.querySelector('[data-action="copy-order"]').addEventListener('click', function () {
      copyText(text || '（内容がありません）');
    });

    root.querySelector('[data-action="show"]').addEventListener('click', function () {
      go('#/show/' + sh.id);
    });

    root.querySelector('[data-action="say"]').addEventListener('click', function () {
      go('#/say/' + sh.id);
    });

    root.querySelector('[data-action="use-sheet"]').addEventListener('click', function () {
      pendingSheet = sh;
      go('#/new');
    });

    root.querySelector('[data-action="delete-sheet"]').addEventListener('click', function () {
      if (!confirm('この注文シートを削除します。写真も一緒に消えます。よろしいですか？')) return;
      DB.deleteSheet(sh.id).then(reload).then(function () {
        toast('注文シートを削除しました');
        go('#/sheets');
      });
    });
  }

  function renderSheetForm(editId) {
    mount('tpl-sheet-form');
    var form = document.getElementById('sheet-form');
    var base = editId ? state.sheets.filter(function (x) { return x.id === editId; })[0] : null;
    if (editId && !base) { go('#/sheets'); return; }

    document.getElementById('sheet-form-title').textContent = editId ? '注文シートを編集' : '新しい注文シート';
    fillDatalists();

    if (base) {
      form.elements.name.value = base.name || '';
      ORDER_FIELDS.forEach(function (k) {
        if (form.elements[k]) form.elements[k].value = base[k] == null ? '' : base[k];
      });
    }

    setupHeadMap(form);
    setupStyleSelect(form);
    var photoBox = setupPhotos(form, editId, null);

    form.querySelector('[data-action="cancel"]').addEventListener('click', function () {
      history.length > 1 ? history.back() : go('#/sheets');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      if (!name) {
        toast('シートの名前を入力してください');
        form.elements.name.focus();
        return;
      }

      var id = editId || uid();
      var sheet = { id: id, name: name };
      ORDER_FIELDS.forEach(function (k) {
        sheet[k] = form.elements[k] ? form.elements[k].value.trim() : '';
      });
      sheet.createdAt = base ? base.createdAt : Date.now();
      sheet.updatedAt = Date.now();

      DB.putSheet(sheet)
        .then(function () { return DB.deletePhotos(photoBox.removed()); })
        .then(function () { return DB.putPhotos(photoBox.photosFor(id)); })
        .then(reload).then(function () {
        toast(editId ? '注文シートを更新しました' : '注文シートを保存しました');
        go('#/sheet/' + id);
      }).catch(function (err) {
        console.error(err);
        toast('保存できませんでした');
      });
    });
  }

  /* 注文シートをカルテのフォームに写す */
  function applySheetToForm(form, sh, photoBox) {
    ORDER_FIELDS.forEach(function (k) {
      if (form.elements[k]) form.elements[k].value = sh[k] == null ? '' : sh[k];
    });
    setupHeadMap(form);
    setupStyleSelect(form);
    // 折りたたみの中に値が入ったときは開いておく
    form.querySelectorAll('details').forEach(function (d) {
      var filled = Array.prototype.some.call(d.querySelectorAll('input, textarea, select'), function (el) {
        return el.value && el.value.trim();
      });
      if (filled) d.open = true;
    });

    // 参考モデルの写真も一緒に持ってくる（自分の写真はこれから撮るので写さない）
    return photoBox ? photoBox.addRefFrom(sh.id) : 0;
  }

  function openSheetPicker(form, photoBox) {
    if (!state.sheets.length) {
      toast('注文シートがまだありません');
      return;
    }
    var box = document.getElementById('picksheet');
    var list = box.querySelector('[data-f="list"]');
    list.innerHTML = '';

    state.sheets.forEach(function (sh) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pickitem';
      b.innerHTML =
        '<span class="pickitem__name">' + esc(sh.name || '（名前なし）') + '</span>' +
        '<span class="pickitem__sub">' + esc(sh.styleName || 'スタイル未設定') + '</span>';
      b.addEventListener('click', function () {
        box.hidden = true;
        var n = applySheetToForm(form, sh, photoBox);
        toast('「' + (sh.name || '注文シート') + '」を貼り付けました' + (n ? '（写真' + n + '枚も）' : ''));
      });
      list.appendChild(b);
    });

    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-act="close"]')) box.hidden = true;
      });
    }
    box.hidden = false;
  }

  function closeSheetPicker() {
    var box = document.getElementById('picksheet');
    if (box) box.hidden = true;
  }

  /* ---------------- 記録（統計） ---------------- */

  function renderStats() {
    mount('tpl-stats');
    var rows = state.records;
    var grid = document.getElementById('statgrid');

    if (!rows.length) {
      main.querySelector('.view').innerHTML =
        '<h2 class="view__title">記録のふりかえり</h2>' +
        '<p class="muted">カルテを登録すると、カットの間隔や満足度の傾向がここに表示されます。</p>';
      return;
    }

    var rated = rows.filter(function (r) { return r.rating; });
    var avgRating = rated.length
      ? (rated.reduce(function (s, r) { return s + r.rating; }, 0) / rated.length) : null;
    var priced = rows.filter(function (r) { return r.price; });
    var totalPrice = priced.reduce(function (s, r) { return s + r.price; }, 0);
    var avg = averageInterval();
    var since = daysSince(rows[0].date);

    var cells = [
      ['カット回数', rows.length + '回'],
      ['前回から', since == null ? '—' : since + '日'],
      ['平均周期', avg ? Math.round(avg) + '日' : '—'],
      ['平均満足度', avgRating ? avgRating.toFixed(1) : '—'],
      ['合計金額', priced.length ? yen(totalPrice) : '—'],
      ['平均単価', priced.length ? yen(Math.round(totalPrice / priced.length)) : '—']
    ];
    grid.innerHTML = cells.map(function (c) {
      return '<div class="stat"><dt>' + esc(c[0]) + '</dt><dd>' + esc(c[1]) + '</dd></div>';
    }).join('');

    drawIntervalChart();
    drawRanking('rank-salon', salonRanking());
    drawRanking('rank-style', styleRanking());
  }

  function drawIntervalChart() {
    var box = document.getElementById('chart-interval');
    var dated = state.records.filter(function (r) { return r.date; })
      .slice().sort(function (a, b) { return a.date.localeCompare(b.date); });

    if (dated.length < 2) {
      box.innerHTML = '<p class="muted">2回以上カットを記録すると、間隔のグラフが出ます。</p>';
      return;
    }

    var items = [];
    for (var i = 1; i < dated.length; i++) {
      var d = daysBetween(dated[i - 1].date, dated[i].date);
      if (d != null) items.push({ label: dated[i].date.slice(5).replace('-', '/'), value: d });
    }
    items = items.slice(-12);
    var max = Math.max.apply(null, items.map(function (x) { return x.value; })) || 1;

    box.innerHTML = items.map(function (x) {
      var h = Math.max(4, Math.round((x.value / max) * 100));
      return '<div class="bar">' +
        '<span class="bar__value">' + x.value + '</span>' +
        '<span class="bar__fill" style="height:' + h + '%"></span>' +
        '<span class="bar__label">' + esc(x.label) + '</span>' +
      '</div>';
    }).join('');
  }

  function salonRanking() {
    var map = {};
    state.records.forEach(function (r) {
      var key = r.salon || '（店名なし）';
      if (!map[key]) map[key] = { name: key, count: 0, sum: 0, rated: 0 };
      map[key].count++;
      if (r.rating) { map[key].sum += r.rating; map[key].rated++; }
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 6)
      .map(function (x) {
        return {
          name: x.name,
          value: x.count + '回',
          rating: x.rated ? Math.round(x.sum / x.rated) : 0
        };
      });
  }

  function styleRanking() {
    var map = {};
    state.records.filter(function (r) { return r.styleName && r.rating; }).forEach(function (r) {
      if (!map[r.styleName]) map[r.styleName] = { name: r.styleName, sum: 0, count: 0 };
      map[r.styleName].sum += r.rating;
      map[r.styleName].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return (b.sum / b.count) - (a.sum / a.count) || b.count - a.count; })
      .slice(0, 6)
      .map(function (x) {
        return { name: x.name, value: x.count + '回', rating: Math.round(x.sum / x.count) };
      });
  }

  function drawRanking(elId, items) {
    var box = document.getElementById(elId);
    if (!items.length) { box.innerHTML = '<p class="muted">データがまだありません。</p>'; return; }
    box.innerHTML = items.map(function (x) {
      return '<div class="ranking__row">' +
        '<span class="ranking__name">' + esc(x.name) + '</span>' +
        '<span class="ranking__stars">' + (x.rating ? stars(x.rating) : '') + '</span>' +
        '<span class="ranking__value">' + esc(x.value) + '</span>' +
      '</div>';
    }).join('');
  }

  /* ---------------- 設定 ---------------- */

  function renderSettings() {
    mount('tpl-settings');

    var themeSel = document.getElementById('theme-select');
    themeSel.value = localStorage.getItem('hk-theme') || 'auto';
    themeSel.addEventListener('change', function () {
      localStorage.setItem('hk-theme', themeSel.value);
      applyTheme();
    });

    main.querySelector('[data-action="export"]').addEventListener('click', exportData);
    main.querySelector('[data-action="import"]').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) importData(file);
    });

    main.querySelector('[data-action="wipe"]').addEventListener('click', function () {
      if (!confirm('すべてのカルテ・注文シート・写真を削除します。元に戻せません。よろしいですか？')) return;
      if (!confirm('本当に削除しますか？')) return;
      DB.clearAll().then(reload).then(function () {
        toast('すべてのデータを削除しました');
        go('#/list');
      });
    });

    var info = document.getElementById('storage-info');
    var photoBytes = state.photos.reduce(function (s, p) {
      return s + (p.full ? p.full.size : 0) + (p.thumb ? p.thumb.size : 0);
    }, 0);
    var lines = [
      ['カルテ', state.records.length + '件'],
      ['注文シート', state.sheets.length + '件'],
      ['写真', state.photos.length + '枚'],
      ['写真の容量', (photoBytes / 1048576).toFixed(1) + ' MB']
    ];
    info.innerHTML = lines.map(function (l) {
      return '<div class="speclist__row"><dt>' + esc(l[0]) + '</dt><dd>' + esc(l[1]) + '</dd></div>';
    }).join('');

    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        if (!est || !est.quota) return;
        info.insertAdjacentHTML('beforeend',
          '<div class="speclist__row"><dt>端末の空き目安</dt><dd>' +
          ((est.quota - (est.usage || 0)) / 1048576).toFixed(0) + ' MB</dd></div>');
      });
    }
  }

  function exportData() {
    toast('書き出しています…');
    Promise.all(state.photos.map(function (p) {
      return Promise.all([
        p.full ? Photos.blobToDataURL(p.full) : null,
        p.thumb ? Photos.blobToDataURL(p.thumb) : null
      ]).then(function (d) {
        return {
          id: p.id, recordId: p.recordId, kind: p.kind,
          width: p.width, height: p.height, masked: !!p.masked,
          caption: p.caption || '', createdAt: p.createdAt,
          full: d[0], thumb: d[1]
        };
      });
    })).then(function (photos) {
      var payload = {
        app: 'hair_karte',
        version: 2,
        exportedAt: new Date().toISOString(),
        records: state.records,
        sheets: state.sheets,
        photos: photos
      };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'hair-karte-' + todayISO() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('エクスポートしました');
    }).catch(function (err) {
      console.error(err);
      toast('エクスポートに失敗しました');
    });
  }

  function importData(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var data;
      try { data = JSON.parse(fr.result); }
      catch (e) { toast('ファイルを読み込めませんでした'); return; }

      if (!data || data.app !== 'hair_karte' || !Array.isArray(data.records)) {
        toast('ヘアカルテのバックアップファイルではないようです');
        return;
      }
      var sheetCount = Array.isArray(data.sheets) ? data.sheets.length : 0;
      var msg = 'カルテ ' + data.records.length + '件' +
        (sheetCount ? '・注文シート ' + sheetCount + '件' : '') +
        'を読み込みます。同じIDのものは上書きされます。よろしいですか？';
      if (!confirm(msg)) return;

      var photos = (data.photos || []).map(function (p) {
        return {
          id: p.id, recordId: p.recordId, kind: p.kind,
          width: p.width, height: p.height, masked: !!p.masked,
          caption: p.caption || '', createdAt: p.createdAt,
          full: p.full ? Photos.dataURLtoBlob(p.full) : null,
          thumb: p.thumb ? Photos.dataURLtoBlob(p.thumb) : null
        };
      });

      var sheets = Array.isArray(data.sheets) ? data.sheets : [];

      Promise.all(data.records.map(function (r) { return DB.putRecord(r); }))
        .then(function () { return Promise.all(sheets.map(function (sh) { return DB.putSheet(sh); })); })
        .then(function () { return DB.putPhotos(photos); })
        .then(reload)
        .then(function () {
          toast('インポートしました');
          go('#/list');
          route();
        })
        .catch(function (err) {
          console.error(err);
          toast('インポートに失敗しました');
        });
    };
    fr.readAsText(file);
  }

  /* ---------------- テーマ ---------------- */

  function applyTheme() {
    var t = localStorage.getItem('hk-theme') || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  /* ---------------- 起動 ---------------- */

  fab.addEventListener('click', function () { go(fabTarget); });
  window.addEventListener('hashchange', route);

  applyTheme();

  reload().then(route).catch(function (err) {
    console.error(err);
    main.innerHTML = '<p class="muted">データを読み込めませんでした。ブラウザのプライベートモードでは保存機能が使えないことがあります。</p>';
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 新しい Service Worker が主導権を取ったら読み直す。
    // 前のものが残っていると、更新しても古い画面が出続けるため。
    var hadController = !!navigator.serviceWorker.controller;
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || refreshing) return;   // 初回登録のときは読み直さない
      refreshing = true;
      location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* オフライン対応なしで動作 */ });
    });
  }
})();
