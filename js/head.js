/* 髪型の部位図。正面と横向きのアバターに、部位ごとの指定（ミリ数など）を吹き出しで表示する。
   図はすべて SVG 1枚で完結させ、文字も SVG 内に置くことで引き出し線と位置がずれないようにしている。 */
(function (global) {
  'use strict';

  /* 部位の定義。key は既存のレコードの項目名と一致させる。 */
  var ZONES = {
    topLen: {
      label: 'トップ',
      unit: 'cm', min: 0, max: 15, step: 0.5, zeroLabel: '',
      suggest: ['短めに', '3cm', '5cm', '7cm', '指2本分', '長めに残す'],
      hint: '頭頂部の長さ'
    },
    frontLen: {
      label: '前髪',
      suggest: ['眉上', '眉が半分隠れる', '眉が隠れる', '目にかかる', '流せる長さ', '長め'],
      hint: 'どこまでの長さにするか'
    },
    sideMm: {
      label: 'サイド',
      unit: 'mm', min: 0, max: 20, step: 0.5, zeroLabel: '刈り上げなし',
      suggest: ['刈り上げなし', '3mm', '6mm', '9mm', '12mm'],
      hint: 'バリカンのミリ数'
    },
    sideburnMm: {
      label: 'もみあげ',
      unit: 'mm', min: 0, max: 20, step: 0.5, zeroLabel: '刈り上げなし',
      suggest: ['刈り上げなし', '自然に残す', '3mm', '6mm', '9mm'],
      hint: 'バリカンのミリ数・形'
    },
    backMm: {
      label: 'バック',
      unit: 'mm', min: 0, max: 20, step: 0.5, zeroLabel: '刈り上げなし',
      suggest: ['刈り上げなし', '3mm', '6mm', '9mm', '3mm→9mmグラデ'],
      hint: '襟足までのミリ数'
    },
    fadeHeight: {
      label: '刈り上げの高さ',
      suggest: ['耳の高さまで', '耳の上まで', 'こめかみまで', 'ハチ下まで', '後頭部の丸みまで'],
      hint: 'どこまで刈り上げるか'
    }
  };

  var ORDER = ['topLen', 'frontLen', 'sideMm', 'sideburnMm', 'backMm', 'fadeHeight'];

  /* ---------------- SVG 部品 ---------------- */

  function bands(zone, paths, kind) {
    var cls = 'hmz__band' + (kind === 'line' ? ' hmz__band--line' : '');
    return paths.map(function (d) {
      return '<path class="hmz__hit" d="' + d + '"/><path class="' + cls + '" d="' + d + '"/>';
    }).join('');
  }

  /** 引き出し線 + ラベル + 値。anchor は 'start'（右側）か 'end'（左側）。 */
  function callout(zone, lead, tx, ty, anchor, value) {
    var v = value || '未設定';
    var w = 96;
    var rx = anchor === 'end' ? tx - w : tx;
    return '<path class="hmz__lead" d="' + lead + '"/>' +
      // 文字まわりもタップできるようにする（見た目には出ない）
      '<rect class="hmz__texthit" x="' + rx + '" y="' + (ty - 19) + '" width="' + w + '" height="36" rx="8"/>' +
      '<text class="hmz__label" x="' + tx + '" y="' + (ty - 5) + '" text-anchor="' + anchor + '">' +
        esc(ZONES[zone].label) + '</text>' +
      '<text class="hmz__value" x="' + tx + '" y="' + (ty + 12) + '" text-anchor="' + anchor + '">' +
        esc(clip(v)) + '</text>';
  }

  /** 図の余白（全角7.5文字分）に収まるように切り詰める */
  function clip(s) {
    s = String(s);
    var budget = 6.2, used = 0, out = '';
    for (var i = 0; i < s.length; i++) {
      var w = /[\x20-\x7E\uFF61-\uFF9F]/.test(s[i]) ? 0.55 : 1;
      if (used + w > budget) return out + '…';
      used += w;
      out += s[i];
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function group(zone, inner, value) {
    return '<g class="hmz' + (value ? ' is-set' : '') + '" data-zone="' + zone + '" tabindex="0" ' +
      'role="button" aria-label="' + esc(ZONES[zone].label + ' ' + (value || '未設定')) + '">' +
      '<title>' + esc(ZONES[zone].label + '：' + (value || '未設定')) + '</title>' +
      inner + '</g>';
  }

  /* ---------------- 正面 ---------------- */

  function frontSVG(v) {
    return '<svg class="hm__svg" viewBox="0 0 360 244" role="img" aria-label="正面から見た髪型の指定">' +
      '<g class="hm__body">' +
        '<path class="hm-cloth" d="M116 244 C122 208 150 196 180 196 C210 196 238 208 244 244 Z"/>' +
        '<rect class="hm-skin" x="168" y="150" width="24" height="38" rx="11"/>' +
        '<ellipse class="hm-skin" cx="134" cy="116" rx="8" ry="12"/>' +
        '<ellipse class="hm-skin" cx="226" cy="116" rx="8" ry="12"/>' +
        '<ellipse class="hm-skin" cx="180" cy="112" rx="46" ry="54"/>' +
        '<circle class="hm-mark" cx="166" cy="114" r="3"/>' +
        '<circle class="hm-mark" cx="194" cy="114" r="3"/>' +
        '<path class="hm-line" d="M172 134 C176 138 184 138 188 134"/>' +
      '</g>' +

      // 髪のベース。ゾーンはこの上に重ねるので、ひと続きの髪型に見える
      '<g class="hm__hair">' +
        '<path class="hm-hairbase" d="M136 148 C129 60 152 42 180 42 C208 42 231 60 224 148"/>' +
        '<path class="hm-hairbase" d="M152 88 C164 104 196 104 208 88"/>' +
      '</g>' +

      group('topLen',
        bands('topLen', ['M145 62 C152 44 208 44 215 62']) +
        callout('topLen', 'M206 50 L244 40 L258 40', 262, 40, 'start', v.topLen),
        v.topLen) +

      group('frontLen',
        bands('frontLen', ['M152 88 C164 104 196 104 208 88']) +
        callout('frontLen', 'M158 98 L112 84 L98 84', 94, 84, 'end', v.frontLen),
        v.frontLen) +

      group('sideMm',
        bands('sideMm', ['M137 104 C134 122 135 136 140 150', 'M223 104 C226 122 225 136 220 150']) +
        callout('sideMm', 'M136 126 L112 130 L98 130', 94, 130, 'end', v.sideMm),
        v.sideMm) +

      group('sideburnMm',
        bands('sideburnMm', ['M146 146 L152 164', 'M214 146 L208 164']) +
        callout('sideburnMm', 'M212 156 L246 174 L258 174', 262, 174, 'start', v.sideburnMm),
        v.sideburnMm) +
    '</svg>';
  }

  /* ---------------- 横向き（左を向いた状態） ---------------- */

  function sideSVG(v) {
    return '<svg class="hm__svg" viewBox="0 0 360 244" role="img" aria-label="横から見た髪型の指定">' +
      '<g class="hm__body">' +
        '<path class="hm-cloth" d="M116 244 C122 208 150 196 180 196 C210 196 238 208 244 244 Z"/>' +
        '<rect class="hm-skin" x="164" y="144" width="32" height="46" rx="10"/>' +
        '<ellipse class="hm-skin" cx="180" cy="108" rx="50" ry="54"/>' +
        '<path class="hm-skin" d="M132 100 C124 108 121 116 126 121 C129 124 134 124 138 122"/>' +
        '<ellipse class="hm-mark" cx="194" cy="116" rx="7" ry="10"/>' +
      '</g>' +

      '<g class="hm__hair">' +
        '<path class="hm-hairbase" d="M140 128 C134 62 158 42 184 42 C214 42 232 68 228 110 C226 132 222 148 216 158"/>' +
      '</g>' +

      group('backMm',
        bands('backMm', ['M227 104 C225 130 221 146 215 156']) +
        callout('backMm', 'M226 124 L248 100 L258 100', 262, 100, 'start', v.backMm),
        v.backMm) +

      group('fadeHeight',
        bands('fadeHeight', ['M152 132 L216 132'], 'line') +
        callout('fadeHeight', 'M154 132 L112 156 L98 156', 94, 156, 'end', v.fadeHeight),
        v.fadeHeight) +
    '</svg>';
  }

  /* ---------------- 組み立て ---------------- */

  /**
   * container に部位図を描く。
   * values: レコード（sideMm などを持つオブジェクト）
   * opts.editable: true なら部位をタップして値を選べる
   * opts.onChange(key, value): 値が変わったときに呼ばれる
   */
  function render(container, values, opts) {
    opts = opts || {};
    var v = values || {};

    container.className = 'headmap' + (opts.editable ? ' headmap--edit' : '');
    container.innerHTML =
      '<div class="hm"><div class="hm__caption">正面</div>' + frontSVG(v) + '</div>' +
      '<div class="hm"><div class="hm__caption">横・後ろ</div>' + sideSVG(v) + '</div>';

    if (!opts.editable) return;

    container.querySelectorAll('.hmz').forEach(function (g) {
      var key = g.dataset.zone;
      g.addEventListener('click', function () { openPicker(key, v[key], commit); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker(key, v[key], commit);
        }
      });

      function commit(next) {
        v[key] = next;
        render(container, v, opts);
        if (opts.onChange) opts.onChange(key, next);
      }
    });
  }

  /* ---------------- よく使う値の履歴 ---------------- */

  var HIST_MAX = 5;

  function histKey(key) { return 'hk-hist-' + key; }

  function history(key) {
    try {
      var raw = localStorage.getItem(histKey(key));
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.slice(0, HIST_MAX) : [];
    } catch (e) {
      return [];
    }
  }

  function remember(key, value) {
    if (!key || !value) return;
    try {
      var list = history(key).filter(function (v) { return v !== value; });
      list.unshift(value);
      localStorage.setItem(histKey(key), JSON.stringify(list.slice(0, HIST_MAX)));
    } catch (e) { /* 保存できなくても動作には影響しない */ }
  }

  /* ---------------- 値の選択シート（部位図・写真のキャプションで共用） ---------------- */

  var sheet = null;
  var pending = null;
  var current = null;   // 開いている設定

  function buildSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.hidden = true;
    sheet.innerHTML =
      '<div class="sheet__scrim" data-act="close"></div>' +
      '<div class="sheet__panel" role="dialog" aria-modal="true">' +
        '<div class="sheet__head">' +
          '<div><h3 class="sheet__title" data-f="title"></h3>' +
          '<p class="sheet__hint" data-f="hint"></p></div>' +
          '<button class="btn btn--ghost" type="button" data-act="close">閉じる</button>' +
        '</div>' +

        '<div class="sheet__block" data-f="histblock" hidden>' +
          '<span class="field__label" data-f="histlabel">よく使う値</span>' +
          '<div class="sheet__presets" data-f="presets"></div>' +
        '</div>' +

        '<div class="numpick" data-f="numpick" hidden>' +
          '<div class="numpick__read">' +
            '<b data-f="numval">0</b><span class="numpick__unit" data-f="numunit"></span>' +
          '</div>' +
          '<div class="numpick__row">' +
            '<button class="numpick__step" type="button" data-act="minus" aria-label="減らす">−</button>' +
            '<input class="numpick__range" type="range" data-f="range" aria-label="長さ">' +
            '<button class="numpick__step" type="button" data-act="plus" aria-label="増やす">＋</button>' +
          '</div>' +
          '<div class="numpick__scale"><span data-f="scalemin"></span><span data-f="scalemax"></span></div>' +
        '</div>' +

        '<label class="field">' +
          '<span class="field__label">自由に入力</span>' +
          '<input class="input" type="text" data-f="free" list="sheet-suggest">' +
          '<datalist id="sheet-suggest"></datalist>' +
        '</label>' +

        '<div class="sheet__foot">' +
          '<button class="btn" type="button" data-act="clear">クリア</button>' +
          '<button class="btn btn--primary" type="button" data-act="ok">決定</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);

    sheet.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.dataset.act;
      if (a === 'close') close();
      if (a === 'clear') finish('');
      if (a === 'ok') finish(sheet.querySelector('[data-f="free"]').value.trim());
      if (a === 'minus') nudge(-1);
      if (a === 'plus') nudge(1);
    });

    sheet.querySelector('[data-f="range"]').addEventListener('input', function () {
      applyNumber(Number(this.value));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) close();
    });

    return sheet;
  }

  function nudge(dir) {
    if (!current || !current.unit) return;
    var range = sheet.querySelector('[data-f="range"]');
    var next = Number(range.value) + dir * Number(current.step || 1);
    next = Math.min(Number(current.max), Math.max(Number(current.min), next));
    range.value = next;
    applyNumber(next);
  }

  /** スライダーの値を表示と自由入力欄に反映する */
  function applyNumber(n) {
    if (!current || !current.unit) return;
    var zero = current.zeroLabel;
    var text = (n === 0 && zero) ? zero : (trimNum(n) + current.unit);
    sheet.querySelector('[data-f="numval"]').textContent = (n === 0 && zero) ? zero : trimNum(n);
    sheet.querySelector('[data-f="numunit"]').textContent = (n === 0 && zero) ? '' : current.unit;
    sheet.querySelector('[data-f="free"]').value = text;
  }

  function trimNum(n) {
    return String(Math.round(n * 10) / 10);
  }

  /** 「6mm」「3cm」などから数値を取り出す。取れなければ null。 */
  function parseNumber(value, unit, zeroLabel) {
    if (!value) return null;
    if (zeroLabel && value === zeroLabel) return 0;
    var m = new RegExp('^\\s*([0-9]+(?:\\.[0-9]+)?)\\s*' + unit + '\\s*$').exec(value);
    return m ? Number(m[1]) : null;
  }

  /**
   * opts: { key, title, hint, suggest, current, placeholder, unit, min, max, step,
   *         zeroLabel, historyLabel, onPick }
   * ボタンとして出すのは履歴だけ（最大5件）。候補は自由入力欄のサジェストに回す。
   */
  function openSheet(opts) {
    buildSheet();
    pending = opts.onPick;
    current = opts;

    sheet.querySelector('[data-f="title"]').textContent = opts.title || '';
    sheet.querySelector('[data-f="hint"]').textContent = opts.hint || '';

    var free = sheet.querySelector('[data-f="free"]');
    free.value = opts.current || '';
    free.placeholder = opts.placeholder || '';

    // 入力候補（ボタンではなくサジェストとして出す）
    var dl = sheet.querySelector('#sheet-suggest');
    dl.innerHTML = (opts.suggest || []).map(function (v) {
      return '<option value="' + esc(v) + '"></option>';
    }).join('');

    // ボタンは履歴のみ。最大5件。
    var hist = opts.key ? history(opts.key) : (opts.presets || []).slice(0, HIST_MAX);
    var block = sheet.querySelector('[data-f="histblock"]');
    var box = sheet.querySelector('[data-f="presets"]');
    sheet.querySelector('[data-f="histlabel"]').textContent = opts.historyLabel || 'よく使う値';
    box.innerHTML = '';
    hist.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset' + (p === opts.current ? ' is-on' : '');
      b.textContent = p;
      b.addEventListener('click', function () { finish(p); });
      box.appendChild(b);
    });
    block.hidden = hist.length === 0;

    // 数値で選べる部位はスライダーを出す
    var num = sheet.querySelector('[data-f="numpick"]');
    if (opts.unit) {
      var range = sheet.querySelector('[data-f="range"]');
      range.min = opts.min;
      range.max = opts.max;
      range.step = opts.step;
      var parsed = parseNumber(opts.current, opts.unit, opts.zeroLabel);
      range.value = parsed == null ? Math.min(Number(opts.max), 6) : parsed;
      sheet.querySelector('[data-f="scalemin"]').textContent = opts.zeroLabel || (opts.min + opts.unit);
      sheet.querySelector('[data-f="scalemax"]').textContent = opts.max + opts.unit;
      // 既存の値を勝手に書き換えないよう、表示だけ更新する
      var n = Number(range.value);
      sheet.querySelector('[data-f="numval"]').textContent =
        (n === 0 && opts.zeroLabel) ? opts.zeroLabel : trimNum(n);
      sheet.querySelector('[data-f="numunit"]').textContent =
        (n === 0 && opts.zeroLabel) ? '' : opts.unit;
      num.hidden = false;
    } else {
      num.hidden = true;
    }

    sheet.hidden = false;
  }

  function finish(value) {
    var cb = pending;
    var key = current && current.key;
    close();
    if (value) remember(key, value);
    if (cb) cb(value);
  }

  function close() {
    if (sheet) sheet.hidden = true;
    pending = null;
    current = null;
  }

  function openPicker(key, value, cb) {
    var z = ZONES[key];
    if (!z) return;
    openSheet({
      key: key,
      title: z.label,
      hint: z.hint,
      suggest: z.suggest,
      current: value,
      placeholder: z.suggest && z.suggest.length ? '例）' + z.suggest[1 % z.suggest.length] : '',
      unit: z.unit,
      min: z.min,
      max: z.max,
      step: z.step,
      zeroLabel: z.zeroLabel,
      onPick: cb
    });
  }

  /** 記録済みの部位を「ラベル: 値」の配列で返す（一覧のチップなどに使う） */
  function summary(values) {
    var out = [];
    ORDER.forEach(function (k) {
      if (values && values[k]) out.push({ key: k, label: ZONES[k].label, value: values[k] });
    });
    return out;
  }

  global.HeadMap = {
    render: render,
    summary: summary,
    zones: ZONES,
    order: ORDER,
    close: close
  };

  /* 汎用の選択シート。写真のキャプションなど部位図以外からも使う。 */
  global.Picker = { open: openSheet, close: close };
})(window);
