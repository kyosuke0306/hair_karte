/* 顔隠しエディタ：自動検出 + 手描きのマスクを写真に焼き込む。
   マスクの座標はすべて 0〜1 の正規化値で持つので、プレビューと実解像度で同じ描画関数を使える。 */
(function (global) {
  'use strict';

  var el = {};
  var ctx = null;
  var st = {
    photo: null,
    source: null,      // 元画像（ImageBitmap か HTMLImageElement）
    masks: [],
    style: 'mosaic',   // mosaic | blur | fill
    shape: 'ellipse',  // ellipse | rect
    drag: null,
    view: { w: 0, h: 0 },
    onApply: null,
    busy: false
  };

  var TAP_THRESHOLD = 0.02;   // これ以下の移動はタップ扱い
  var TAP_SIZE = 0.22;        // タップで置くマスクの直径（短辺比）

  var filterOK = null;

  function supportsFilter() {
    if (filterOK === null) {
      var c = document.createElement('canvas').getContext('2d');
      c.filter = 'blur(2px)';
      filterOK = (c.filter === 'blur(2px)');
    }
    return filterOK;
  }

  /* ---------------- 描画 ---------------- */

  function maskRect(m, w, h) {
    return {
      x: Math.max(0, m.x * w),
      y: Math.max(0, m.y * h),
      w: Math.min(w, m.w * w),
      h: Math.min(h, m.h * h)
    };
  }

  function clipShape(target, m, r) {
    target.beginPath();
    if (m.shape === 'rect') {
      target.rect(r.x, r.y, r.w, r.h);
    } else {
      target.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    }
    target.clip();
  }

  function paintMask(target, sourceCanvas, m, w, h) {
    var r = maskRect(m, w, h);
    if (r.w < 2 || r.h < 2) return;

    target.save();
    clipShape(target, m, r);

    if (m.style === 'fill') {
      target.fillStyle = '#241c17';
      target.fillRect(r.x, r.y, r.w, r.h);
    } else if (m.style === 'blur' && supportsFilter()) {
      target.filter = 'blur(' + Math.max(6, Math.min(r.w, r.h) / 5) + 'px)';
      // ぼかしが縁で薄くならないよう、少し広めの範囲を描き直す
      var pad = Math.max(r.w, r.h) * 0.4;
      target.drawImage(sourceCanvas,
        r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2,
        r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
      target.filter = 'none';
    } else {
      mosaic(target, sourceCanvas, r);
    }

    target.restore();
  }

  function mosaic(target, sourceCanvas, r) {
    var block = Math.max(3, Math.round(Math.min(r.w, r.h) / 7));
    var cw = Math.max(1, Math.round(r.w / block));
    var ch = Math.max(1, Math.round(r.h / block));
    var small = document.createElement('canvas');
    small.width = cw;
    small.height = ch;
    var sctx = small.getContext('2d');
    sctx.drawImage(sourceCanvas, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
    target.imageSmoothingEnabled = false;
    target.drawImage(small, 0, 0, cw, ch, r.x, r.y, r.w, r.h);
    target.imageSmoothingEnabled = true;
  }

  function drawPreview() {
    var w = st.view.w, h = st.view.h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(st.source, 0, 0, w, h);
    st.masks.forEach(function (m) { paintMask(ctx, ctx.canvas, m, w, h); });

    // 隠した範囲が分かるように枠線を出す（保存する画像には入らない）
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    st.masks.forEach(function (m) {
      var r = maskRect(m, w, h);
      ctx.beginPath();
      if (m.shape === 'rect') ctx.rect(r.x, r.y, r.w, r.h);
      else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    });

    if (st.drag) {
      var d = normalizeDrag(st.drag);
      var dr = maskRect(d, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      if (st.shape === 'rect') ctx.rect(dr.x, dr.y, dr.w, dr.h);
      else ctx.ellipse(dr.x + dr.w / 2, dr.y + dr.h / 2, dr.w / 2, dr.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    el.count.textContent = st.masks.length ? st.masks.length + 'か所を隠しています' : 'まだ隠していません';
  }

  /* ---------------- 顔の自動検出 ---------------- */

  function detect() {
    var canvas = document.createElement('canvas');
    canvas.width = st.source.width;
    canvas.height = st.source.height;
    canvas.getContext('2d').drawImage(st.source, 0, 0);

    var native = nativeDetect(canvas);
    return native.then(function (boxes) {
      if (boxes && boxes.length) return { boxes: boxes, native: true };
      return { boxes: skinDetect(canvas), native: false };
    });
  }

  /** ブラウザ内蔵の顔検出（対応端末のみ） */
  function nativeDetect(canvas) {
    if (!global.FaceDetector) return Promise.resolve(null);
    try {
      var fd = new global.FaceDetector({ fastMode: false, maxDetectedFaces: 8 });
      return fd.detect(canvas).then(function (faces) {
        return faces.map(function (f) {
          var b = f.boundingBox;
          return normBox(b.x, b.y, b.width, b.height, canvas.width, canvas.height);
        });
      }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /**
   * 内蔵検出が無い端末向けの簡易検出。
   * 肌色っぽい画素のかたまりを探し、顔らしい大きさ・縦横比のものを返す。
   * 誤検出もあるので、結果はそのまま焼き込まず必ずユーザーが確認する。
   */
  function skinDetect(canvas) {
    var W = 128;
    var scale = W / canvas.width;
    var H = Math.max(1, Math.round(canvas.height * scale));
    var small = document.createElement('canvas');
    small.width = W;
    small.height = H;
    small.getContext('2d').drawImage(canvas, 0, 0, W, H);
    var data = small.getContext('2d').getImageData(0, 0, W, H).data;

    var skin = new Uint8Array(W * H);
    for (var i = 0, p = 0; i < skin.length; i++, p += 4) {
      if (isSkin(data[p], data[p + 1], data[p + 2])) skin[i] = 1;
    }
    skin = close3x3(skin, W, H);

    // 連結成分をラベリング
    var seen = new Uint8Array(W * H);
    var boxes = [];
    var stack = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var idx = y * W + x;
        if (!skin[idx] || seen[idx]) continue;
        stack.length = 0;
        stack.push(idx);
        seen[idx] = 1;
        var minX = x, maxX = x, minY = y, maxY = y, area = 0;
        while (stack.length) {
          var cur = stack.pop();
          var cx = cur % W, cy = (cur - cx) / W;
          area++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              var n = ny * W + nx;
              if (skin[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
            }
          }
        }

        var bw = maxX - minX + 1, bh = maxY - minY + 1;
        var ratio = bh / bw;
        var fill = area / (bw * bh);
        if (area < W * H * 0.006) continue;      // 小さすぎる
        if (bw > W * 0.92 && bh > H * 0.92) continue; // 画面全体＝背景
        if (ratio < 0.7 || ratio > 2.4) continue;     // 顔らしい縦横比から外れる
        if (fill < 0.45) continue;                    // すかすかな塊は顔ではない
        boxes.push({ x: minX, y: minY, w: bw, h: bh, area: area });
      }
    }

    return boxes.sort(function (a, b) { return b.area - a.area; })
      .slice(0, 5)
      .map(function (b) {
        // 髪や輪郭も入るよう少し広げる
        var ex = b.w * 0.22, ey = b.h * 0.24;
        return normBox(b.x - ex, b.y - ey, b.w + ex * 2, b.h + ey * 2, W, H);
      });
  }

  function isSkin(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var rgbRule = r > 95 && g > 40 && b > 20 && (max - min) > 15 &&
      Math.abs(r - g) > 15 && r > g && r > b;
    var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    var yccRule = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
    return rgbRule && yccRule;
  }

  /** 穴を埋めてノイズを落とす（膨張→収縮） */
  function close3x3(src, w, h) {
    var a = morph(src, w, h, true);
    return morph(a, w, h, false);
  }

  function morph(src, w, h, dilate) {
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var hit = dilate ? 0 : 1;
        for (var dy = -1; dy <= 1 && (dilate ? !hit : hit); dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = Math.min(w - 1, Math.max(0, x + dx));
            var ny = Math.min(h - 1, Math.max(0, y + dy));
            var v = src[ny * w + nx];
            if (dilate && v) { hit = 1; break; }
            if (!dilate && !v) { hit = 0; break; }
          }
        }
        out[y * w + x] = hit;
      }
    }
    return out;
  }

  function normBox(x, y, w, h, cw, ch) {
    var nx = Math.max(0, x / cw);
    var ny = Math.max(0, y / ch);
    return {
      x: nx,
      y: ny,
      w: Math.min(1 - nx, w / cw),
      h: Math.min(1 - ny, h / ch)
    };
  }

  /* ---------------- 操作 ---------------- */

  function normalizeDrag(d) {
    return {
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      w: Math.abs(d.x1 - d.x0),
      h: Math.abs(d.y1 - d.y0),
      shape: st.shape,
      style: st.style
    };
  }

  function pointOf(e) {
    var rect = el.canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    };
  }

  function hitMask(pt) {
    for (var i = st.masks.length - 1; i >= 0; i--) {
      var m = st.masks[i];
      var cx = m.x + m.w / 2, cy = m.y + m.h / 2;
      if (m.shape === 'rect') {
        if (pt.x >= m.x && pt.x <= m.x + m.w && pt.y >= m.y && pt.y <= m.y + m.h) return i;
      } else {
        var dx = (pt.x - cx) / (m.w / 2 || 1);
        var dy = (pt.y - cy) / (m.h / 2 || 1);
        if (dx * dx + dy * dy <= 1) return i;
      }
    }
    return -1;
  }

  function onDown(e) {
    if (st.busy) return;
    el.canvas.setPointerCapture(e.pointerId);
    var pt = pointOf(e);
    st.drag = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    drawPreview();
  }

  function onMove(e) {
    if (!st.drag) return;
    var pt = pointOf(e);
    st.drag.x1 = pt.x;
    st.drag.y1 = pt.y;
    drawPreview();
  }

  function onUp() {
    if (!st.drag) return;
    var d = st.drag;
    st.drag = null;
    var moved = Math.max(Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));

    if (moved < TAP_THRESHOLD) {
      // タップ：既存のマスクの上なら消す、そうでなければ定型サイズで置く
      var hit = hitMask({ x: d.x0, y: d.y0 });
      if (hit >= 0) {
        st.masks.splice(hit, 1);
      } else {
        var ratio = st.view.w / st.view.h;
        var hw = TAP_SIZE / 2, hh = (TAP_SIZE * ratio) / 2;
        st.masks.push({
          x: Math.max(0, d.x0 - hw), y: Math.max(0, d.y0 - hh),
          w: hw * 2, h: hh * 2, shape: st.shape, style: st.style
        });
      }
    } else {
      st.masks.push(normalizeDrag(d));
    }
    drawPreview();
  }

  /* ---------------- 保存 ---------------- */

  function apply() {
    if (st.busy) return;
    if (!st.masks.length) {
      close();
      return;
    }
    st.busy = true;
    el.apply.disabled = true;
    el.apply.textContent = '処理中…';

    var w = st.source.width, h = st.source.height;
    var out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    var octx = out.getContext('2d');
    octx.drawImage(st.source, 0, 0, w, h);
    st.masks.forEach(function (m) { paintMask(octx, out, m, w, h); });

    toBlob(out, 0.85).then(function (full) {
      var tw = Math.max(1, Math.round(w * Math.min(1, 480 / Math.max(w, h))));
      var th = Math.max(1, Math.round(h * Math.min(1, 480 / Math.max(w, h))));
      var tc = document.createElement('canvas');
      tc.width = tw;
      tc.height = th;
      tc.getContext('2d').drawImage(out, 0, 0, tw, th);
      return toBlob(tc, 0.75).then(function (thumb) {
        return { full: full, thumb: thumb, width: w, height: h };
      });
    }).then(function (result) {
      var cb = st.onApply;
      close();
      if (cb) cb(result);
    }).catch(function (err) {
      console.error(err);
      st.busy = false;
      el.apply.disabled = false;
      el.apply.textContent = '適用';
      alert('画像を保存できませんでした。');
    });
  }

  function toBlob(canvas, q) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/jpeg', q);
    });
  }

  /* ---------------- 開閉 ---------------- */

  function cacheEls() {
    if (el.root) return;
    el.root = document.getElementById('editor');
    el.canvas = document.getElementById('editor-canvas');
    el.stage = el.root.querySelector('.editor__stage');
    el.count = el.root.querySelector('[data-f="count"]');
    el.apply = el.root.querySelector('[data-act="apply"]');
    el.hint = el.root.querySelector('[data-f="hint"]');
    ctx = el.canvas.getContext('2d');

    el.root.querySelector('[data-act="cancel"]').addEventListener('click', close);
    el.apply.addEventListener('click', apply);
    el.root.querySelector('[data-act="auto"]').addEventListener('click', autoDetect);
    el.root.querySelector('[data-act="undo"]').addEventListener('click', function () {
      st.masks.pop();
      drawPreview();
    });
    el.root.querySelector('[data-act="clear"]').addEventListener('click', function () {
      st.masks = [];
      drawPreview();
    });

    el.root.querySelectorAll('[data-style]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.style = b.dataset.style;
        el.root.querySelectorAll('[data-style]').forEach(function (x) {
          x.classList.toggle('is-on', x === b);
        });
        // すでに置いたマスクにも即反映する
        st.masks.forEach(function (m) { m.style = st.style; });
        drawPreview();
      });
    });

    el.root.querySelectorAll('[data-shape]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.shape = b.dataset.shape;
        el.root.querySelectorAll('[data-shape]').forEach(function (x) {
          x.classList.toggle('is-on', x === b);
        });
      });
    });

    el.canvas.addEventListener('pointerdown', onDown);
    el.canvas.addEventListener('pointermove', onMove);
    el.canvas.addEventListener('pointerup', onUp);
    el.canvas.addEventListener('pointercancel', onUp);
  }

  function autoDetect() {
    if (st.busy) return;
    var btn = el.root.querySelector('[data-act="auto"]');
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '検出中…';

    detect().then(function (res) {
      var added = 0;
      res.boxes.forEach(function (b) {
        if (b.w < 0.02 || b.h < 0.02) return;
        st.masks.push({ x: b.x, y: b.y, w: b.w, h: b.h, shape: st.shape, style: st.style });
        added++;
      });
      drawPreview();
      el.hint.textContent = added
        ? added + 'か所を検出しました。ずれていたらタップで消して、指でなぞり直してください。'
        : '顔を自動で見つけられませんでした。隠したい場所を指でなぞってください。';
    }).catch(function (err) {
      console.error(err);
      el.hint.textContent = '自動検出に失敗しました。指でなぞって隠してください。';
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  }

  function layout() {
    var box = el.stage.getBoundingClientRect();
    var maxW = box.width, maxH = box.height;
    var scale = Math.min(maxW / st.source.width, maxH / st.source.height);
    var w = Math.max(1, Math.round(st.source.width * scale));
    var h = Math.max(1, Math.round(st.source.height * scale));
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    el.canvas.style.width = w + 'px';
    el.canvas.style.height = h + 'px';
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    st.view = { w: el.canvas.width, h: el.canvas.height };
    drawPreview();
  }

  /** photo: {full: Blob} / onApply: 新しい {full, thumb, width, height} を受け取る */
  function open(photo, onApply) {
    cacheEls();
    st.photo = photo;
    st.masks = [];
    st.drag = null;
    st.busy = false;
    st.onApply = onApply;
    el.apply.disabled = false;
    el.apply.textContent = '適用';
    el.hint.textContent = '隠したい場所を指でなぞってください。タップでも置けます（置いた場所をタップすると消えます）。';

    return loadSource(photo.full || photo.thumb).then(function (src) {
      st.source = src;
      el.root.hidden = false;
      layout();
      global.addEventListener('resize', layout);
    });
  }

  function loadSource(blob) {
    if (global.createImageBitmap) {
      return createImageBitmap(blob).catch(function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }

  function viaImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('load failed')); };
      img.src = url;
    });
  }

  function close() {
    if (!el.root) return;
    el.root.hidden = true;
    global.removeEventListener('resize', layout);
    if (st.source && st.source.close) st.source.close();
    st.source = null;
    st.masks = [];
    st.onApply = null;
    st.busy = false;
  }

  global.MaskEditor = { open: open, close: close };
})(window);
