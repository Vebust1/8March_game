/* Модуль анимации фейерверка и конфетти для экрана победителя */
(function () {
  const COLORS = ['#6b2d5c', '#ffd700', '#0066cc', '#e63946', '#ec4899', '#3b82f6'];
  let celebrationInterval = null;

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function fireConfettiBurst(x, y) {
    if (typeof confetti !== 'function') return;
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { x, y },
      colors: COLORS,
    });
  }

  function fireFireworkBurst(x, y) {
    if (typeof confetti !== 'function') return;
    const count = 50;
    const defaults = { origin: { x, y }, colors: COLORS };
    confetti({
      ...defaults,
      particleCount: count,
      spread: 100,
      startVelocity: 35,
      scalar: 1.2,
    });
    confetti({
      ...defaults,
      particleCount: count,
      spread: 100,
      startVelocity: 45,
      scalar: 0.9,
    });
    confetti({
      ...defaults,
      particleCount: count * 0.25,
      spread: 120,
      startVelocity: 55,
      scalar: 1.1,
      shapes: ['circle'],
    });
  }

  function randomBurst() {
    const x = randomBetween(0.1, 0.9);
    const y = randomBetween(0.2, 0.8);
    if (Math.random() > 0.5) {
      fireFireworkBurst(x, y);
    } else {
      fireConfettiBurst(x, y);
    }
  }

  window.startCelebrationAnimation = function () {
    if (celebrationInterval) return;
    randomBurst();
    celebrationInterval = setInterval(() => {
      randomBurst();
    }, randomBetween(2000, 4000));
  };

  window.stopCelebrationAnimation = function () {
    if (celebrationInterval) {
      clearInterval(celebrationInterval);
      celebrationInterval = null;
    }
  };
})();
