/* 画像の縮小・サムネイル生成と、Blob <-> dataURL の変換。 */
(function (global) {
  'use strict';

  var FULL_MAX = 1600;   // 表示用の長辺
  var THUMB_MAX = 480;   // 一覧・サムネイル用の長辺

  function loadImage(file) {
    if (global.createImageBitmap) {
      // EXIF の向きを反映させる（対応していない環境では素の bitmap になる）
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(file); })
        .catch(function () { return loadViaElement(file); });
    }
    return loadViaElement(file);
  }

  function loadViaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('画像を変換できませんでした'));
        }, 'image/jpeg', quality);
      } else {
        resolve(dataURLtoBlob(canvas.toDataURL('image/jpeg', quality)));
      }
    });
  }

  function resize(source, max, quality) {
    var w = source.width, h = source.height;
    var scale = Math.min(1, max / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return toBlob(canvas, quality);
  }

  function dataURLtoBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [null, 'image/jpeg'])[1];
    var bin = atob(parts[1]);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  /** File を保存用の {full, thumb, width, height} に変換する */
  function process(file) {
    return loadImage(file).then(function (source) {
      return Promise.all([
        resize(source, FULL_MAX, 0.85),
        resize(source, THUMB_MAX, 0.75)
      ]).then(function (blobs) {
        var w = source.width, h = source.height;
        if (source.close) source.close();
        return { full: blobs[0], thumb: blobs[1], width: w, height: h };
      });
    });
  }

  global.Photos = {
    process: process,
    blobToDataURL: blobToDataURL,
    dataURLtoBlob: dataURLtoBlob
  };
})(window);
