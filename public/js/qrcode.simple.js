// Минималистичный генератор QR-кода на основе QRCode.js (урезанная обёртка).
// Оставляем только один глобальный экспорт window.SimpleQRCode(canvasOrElement, text).

(function () {
  function loadLib(callback) {
    if (window.QRCode) {
      callback();
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
    script.async = true;
    script.onload = callback;
    document.head.appendChild(script);
  }

  window.SimpleQRCode = function (el, text) {
    if (!el) return;
    loadLib(function () {
      while (el.firstChild) el.removeChild(el.firstChild);
      // QRCode.js умеет рисовать в DIV с canvas внутри
      // Используем высокий уровень коррекции, чтобы код читался с экрана.
      // eslint-disable-next-line no-new
      new QRCode(el, {
        text: String(text || ''),
        width: 260,
        height: 260,
        correctLevel: QRCode.CorrectLevel.H,
      });
    });
  };
})();

