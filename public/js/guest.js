(function () {
  const view = document.getElementById('guest-view');
  view.classList.add('active');

  let state = null;
  let countdownRemaining = null;
  let countdownTotal = null;
  let progressInterval = null;

  function getQuestionProgress() {
    if (!state?.currentQuestion) return 0;
    const total = state?.questionTotalTime ?? 30;
    if (state?.currentRound?.type === 'countdown' && countdownRemaining != null && countdownTotal != null) {
      return Math.min(1, 1 - countdownRemaining / countdownTotal);
    }
    const start = state?.questionStartTime;
    if (start) {
      const endTime = state?.questionPausedAt || Date.now();
      const elapsed = (endTime - start) / 1000;
      return Math.min(1, elapsed / total);
    }
    return 0;
  }

  function updateProgressBar() {
    const fill = document.getElementById('guest-progress-fill');
    if (fill) {
      const p = getQuestionProgress();
      fill.style.width = `${Math.round(p * 100)}%`;
    }
  }

  function startProgressInterval() {
    if (progressInterval) return;
    progressInterval = setInterval(() => {
      if (!state?.currentQuestion) {
        clearInterval(progressInterval);
        progressInterval = null;
        return;
      }
      updateProgressBar();
    }, 200);
  }

  function stopProgressInterval() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getQuestionText(q) {
    const blocks = q?.questionBlocks || [];
    const textBlock = blocks.find((b) => b.type === 'text');
    return textBlock?.content || 'Вопрос';
  }

  function renderBlocksHtml(blocks, basePath) {
    if (!blocks?.length || !basePath) return '';
    return blocks
      .map((b) => {
        if (b.type === 'text' && b.content) return `<div class="block-item"><span class="block-text">${escapeHtml(b.content)}</span></div>`;
        if (b.type === 'image' && b.file) return `<div class="block-item"><img class="block-image" src="/${basePath}/${b.file}" alt=""></div>`;
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  function getQuestionContentHtml(q) {
    const blocks = q?.questionBlocks || [];
    const text = getQuestionText(q);
    const imagesHtml = renderBlocksHtml(blocks.filter((b) => b.type === 'image'), q?.basePath);
    let html = text ? `<div class="modal-question-text">${escapeHtml(text)}</div>` : '';
    if (imagesHtml) html += `<div class="modal-blocks-media">${imagesHtml}</div>`;
    return html || '<div class="modal-question-text">Вопрос</div>';
  }

  function getAnswerContentHtml(q) {
    const blocks = q?.answerBlocks || [];
    const contentHtml = renderBlocksHtml(blocks, q?.basePath);
    if (!contentHtml) return '';
    return `<div class="modal-answer-block"><span class="modal-answer-label">Правильный ответ:</span> <span class="modal-answer-content">${contentHtml}</span></div>`;
  }

  function render() {
    if (state?.phase !== 'ended' && window.stopCelebrationAnimation) window.stopCelebrationAnimation();
    const isBlitz = state?.roundData?.blitz;
    const bonus = state?.bonus;

    const playersHtml = (state?.players || []).length
      ? (state?.players || []).map((p) => {
          const blocked = p.blocked ? ' blocked' : '';
          const buzzed = state?.buzzedPlayerId === p.id ? ' buzzed' : '';
          const playing = state?.lastCorrectPlayerId === p.id ? ' playing' : '';
          return `<div class="player-card${blocked}${buzzed}${playing}"><div class="player-score">${p.score}</div><div class="player-name">${escapeHtml(p.name)}${playing ? ' — выбирает' : ''}</div></div>`;
        }).join('')
      : '<div class="players-panel-empty">Игроки появятся здесь</div>';
    let html = `
      <div class="game-logo">
        <img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img">
      </div>
      <div class="game-layout">
        <div class="game-board ${isBlitz ? 'blitz-view' : ''}">
          <div class="game-board-inner">
    `;

    if (bonus?.active && state?.phase === 'bonus') {
      const playerUrl = window.location.origin + '/player';
      html += `
        <div class="bonus-guest-wrap">
          <div class="bonus-qr-wrap">
            <div class="bonus-qr-title">Бонусная дуэль</div>
            <div class="bonus-qr-subtitle">Сканируйте QR-код, чтобы присоединиться к игре как игрок.</div>
            <div id="guest-bonus-qr" class="bonus-qr-box"></div>
            <div class="bonus-qr-link">${escapeHtml(playerUrl)}</div>
          </div>
        </div>
      `;
    } else if (!isBlitz && state?.roundData?.categories?.length) {
      html += '<div class="categories-column">';
      for (const cat of state.roundData.categories) {
        html += `<div class="category-btn" style="cursor: default;">${escapeHtml(cat.title)}</div>`;
      }
      html += '</div>';
      html += '<div class="questions-grid">';
      const qList = Object.values(state.roundData.questionsMap || {});
      const pointsSet = new Set(qList.map((q) => q.points));
      const points = [...pointsSet].sort((a, b) => a - b);
      const bulbHtml = Array.from({ length: 16 }, (_, i) => `<span class="bulb" style="--i:${i}"></span>`).join('');
      for (const cat of state.roundData.categories) {
        html += '<div class="category-row">';
        for (const pt of points) {
          const q = qList.find((x) => x.categoryId === cat.id && x.points === pt);
          const played = state.answeredIds?.includes(q?.id);
          const pts = q ? q.points : '-';
          html += `<div class="question-cell oval-note ${played ? 'played' : ''}" style="cursor: default;"><div class="note-bulbs">${bulbHtml}</div><div class="note-body oval"><span class="points">${pts}</span></div></div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    } else if (isBlitz) {
      html += '<div class="blitz-info">Блиц</div>';
    }

    html += `</div></div></div>
      <div class="players-panel players-panel-bottom">
        ${playersHtml}
      </div>`;

    if (state?.currentQuestion && !bonus?.active) {
      const q = state.currentQuestion;
      const isCountdown = state.currentRound?.type === 'countdown';
      const cdText = isCountdown && countdownRemaining != null ? `Осталось: ${countdownRemaining} сек` : '';
      const progress = getQuestionProgress();
      const answerRevealed = !!state?.answerRevealed;
      const questionContentHtml = getQuestionContentHtml(q);
      const answerBlockHtml = answerRevealed ? getAnswerContentHtml(q) : '';
      const roundParams = state?.currentRound?.params || {};
      const baseTotal = countdownTotal ?? state?.questionTotalTime ?? roundParams.totalTime ?? 30;
      const maxPoints = q.points || roundParams.pointsPerQuestion || 10;
      const baseMultiplier = roundParams.multiplier || 1;
      const effectiveMultiplier = baseTotal > 0 ? (maxPoints * baseMultiplier) / baseTotal : baseMultiplier;
      const countdownPoints =
        isCountdown && countdownRemaining != null ? Math.max(0, Math.round(countdownRemaining * effectiveMultiplier)) : q.points;
      html += `<div class="question-display">
        ${questionContentHtml}
        <div class="modal-question-points" id="guest-countdown-points">${countdownPoints} очков</div>
        <div class="modal-progress-wrap">
          <div class="modal-progress-bar">
            <div class="modal-progress-fill" id="guest-progress-fill" style="width: ${Math.round(progress * 100)}%"></div>
          </div>
        </div>
        <div id="guest-countdown-display">${cdText}</div>
        ${answerBlockHtml}
      </div>`;
      startProgressInterval();
    } else {
      stopProgressInterval();
    }

    if (state?.phase === 'ended') {
      const bonus = state?.bonus;
      const bonusTimes = bonus?.timesMs || {};
      const getTimeMs = (p) => bonusTimes[p.id] || 0;
      const sorted = (state.players || []).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return getTimeMs(a) - getTimeMs(b);
      });
      const maxScore = sorted[0]?.score ?? 0;
      const winners = sorted.filter((p) => p.score === maxScore && maxScore > 0);
      const winnerNames = winners.length ? winners.map((p) => escapeHtml(p.name)).join(', ') : 'Нет победителя';
      const winnerLabel = winners.length > 1 ? 'Победители' : 'Победитель';
      const placeClass = (i) => (i === 0 ? 'finale-place-1' : i === 1 ? 'finale-place-2' : i === 2 ? 'finale-place-3' : '');
      const placeLabel = (i) => (i === 0 ? '1 место' : i === 1 ? '2 место' : i === 2 ? '3 место' : `${i + 1} место`);
      view.innerHTML = `
        <div class="finale-celebration" id="finale-celebration"></div>
        <div class="game-logo"><img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img"></div>
        <div class="finale-winners-block">
          <h2 class="finale-winners-title">${winnerLabel}</h2>
          <p class="finale-winners-names">${winnerNames}</p>
        </div>
        <div class="finale-view">
          <h2>${bonus?.finished ? 'Итоги бонусной игры' : 'Итоговая таблица'}</h2>
          <table class="finale-results-table">
            <thead><tr><th>Место</th><th>Имя</th><th>Очки</th>${bonus?.finished ? '<th>Время, с</th>' : ''}</tr></thead>
            <tbody>
              ${sorted
                .map(
                  (p, i) =>
                    `<tr class="${placeClass(i)}"><td>${placeLabel(i)}</td><td>${escapeHtml(p.name)}</td><td>${p.score}</td>${
                      bonus?.finished ? `<td>${(getTimeMs(p) / 1000).toFixed(2)}</td>` : ''
                    }</tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
      if (window.startCelebrationAnimation) window.startCelebrationAnimation();
      return;
    }

    view.innerHTML = html;

    if (bonus?.active && state?.phase === 'bonus') {
      const playerBaseUrl = window.location.origin;
      const qrContainer = document.getElementById('guest-bonus-qr');
      if (qrContainer && window.SimpleQRCode) {
        window.SimpleQRCode(qrContainer, playerBaseUrl + '/player');
      }
    }
  }

  window.onSocket('game:state', (s) => {
    state = s;
    if (!s?.currentQuestion) {
      countdownRemaining = null;
      countdownTotal = null;
      stopProgressInterval();
    } else if (s?.countdownRemaining != null && s?.countdownTotal != null) {
      countdownRemaining = s.countdownRemaining;
      countdownTotal = s.countdownTotal;
    }
    render();
  });

  window.onSocket('game:countdown', ({ remaining, total }) => {
    countdownRemaining = remaining;
    countdownTotal = total;
    const el = document.getElementById('guest-countdown-display');
    if (el) el.textContent = remaining !== undefined ? `Осталось: ${remaining} сек` : '';
    const pointsEl = document.getElementById('guest-countdown-points');
    if (pointsEl && state?.currentQuestion && state?.currentRound?.type === 'countdown' && countdownRemaining != null) {
      const q = state.currentQuestion;
      const roundParams = state?.currentRound?.params || {};
      const baseTotal = countdownTotal ?? state?.questionTotalTime ?? roundParams.totalTime ?? 30;
      const maxPoints = q.points || roundParams.pointsPerQuestion || 10;
      const baseMultiplier = roundParams.multiplier || 1;
      const effectiveMultiplier = baseTotal > 0 ? (maxPoints * baseMultiplier) / baseTotal : baseMultiplier;
      const points = Math.max(0, Math.round(countdownRemaining * effectiveMultiplier));
      pointsEl.textContent = `${points} очков`;
    }
    updateProgressBar();
  });
})();
