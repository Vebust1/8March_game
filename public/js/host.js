(function () {
  const view = document.getElementById('host-view');
  view.classList.add('active');

  let config = { rounds: [] };
  let state = null;
  let countdownRemaining = null;
  let countdownTotal = null;
  let progressInterval = null;

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

  function getAnswerContentHtml(q, showLabel = true) {
    const blocks = q?.answerBlocks || [];
    const contentHtml = renderBlocksHtml(blocks, q?.basePath);
    if (!contentHtml) return '';
    const label = showLabel ? '<span class="modal-answer-label">Правильный ответ:</span> ' : '';
    return `<div class="modal-answer-block">${label}<span class="modal-answer-content">${contentHtml}</span></div>`;
  }

  /** Только текстовые блоки из ответа — для ведущего заранее (без раскрытия). */
  function getHostAnswerTextOnlyHtml(q) {
    const blocks = (q?.answerBlocks || []).filter((b) => b.type === 'text' && b.content);
    if (!blocks.length) return '';
    const contentHtml = blocks
      .map((b) => `<div class="block-item"><span class="block-text">${escapeHtml(b.content)}</span></div>`)
      .join('');
    return `<div class="modal-answer-block modal-host-answer-preview"><span class="modal-answer-label">Ответ (для ведущего):</span> <span class="modal-answer-content">${contentHtml}</span></div>`;
  }

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
    const fill = document.getElementById('host-progress-fill');
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

  function renderHostQuestionModal() {
    let modal = document.getElementById('host-question-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'host-question-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    const q = state?.currentQuestion;
    if (!q) return;
    const isCountdown = state?.currentRound?.type === 'countdown';
    const cdText = isCountdown && countdownRemaining != null ? `Осталось: ${countdownRemaining} сек` : '';
    const progress = getQuestionProgress();
    const questionContentHtml = getQuestionContentHtml(q);

    const answerRevealed = !!state?.answerRevealed;
    const answerBlockHtml = answerRevealed ? getAnswerContentHtml(q) : '';
    const hostAnswerTextHtml = answerRevealed ? '' : getHostAnswerTextOnlyHtml(q);
    let hostButtonsHtml = '';
    let auctionSelectHint = '';
    let auctionDurationHtml = '';

    const roundParams = state?.currentRound?.params || {};
    const baseTotal = countdownTotal ?? state?.questionTotalTime ?? roundParams.totalTime ?? 30;
    const maxPoints = q.points || roundParams.pointsPerQuestion || 10;
    const baseMultiplier = roundParams.multiplier || 1;
    const effectiveMultiplier = baseTotal > 0 ? (maxPoints * baseMultiplier) / baseTotal : baseMultiplier;
    const countdownPoints =
      isCountdown && countdownRemaining != null ? Math.max(0, Math.round(countdownRemaining * effectiveMultiplier)) : q.points;

    if (answerRevealed) {
      hostButtonsHtml = '<button class="btn-next-question modal-host-btn">Следующий вопрос</button>';
    } else if (state?.buzzedPlayerId) {
      const p = state.players.find((x) => x.id === state.buzzedPlayerId);
      hostButtonsHtml = `<button class="btn-correct modal-host-btn" data-player="${p?.id || ''}">Правильно</button><button class="btn-wrong modal-host-btn">Неправильно</button>`;
    } else if (state?.currentRound?.type === 'auction') {
      auctionSelectHint = '<div class="modal-auction-hint">Выберите, кто будет отвечать</div>';
      hostButtonsHtml = (state.players || []).map((p) => `<button class="btn-auction-select modal-host-btn" data-player="${p.id}">${escapeHtml(p.name)}</button>`).join('');
      auctionDurationHtml = `
        <div class="modal-auction-controls">
          <label class="modal-auction-duration-label">
            Время проигрыша (сек):
            <input type="number" id="auction-duration-input" class="modal-auction-duration-input" min="1" max="120" value="15">
          </label>
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="modal-question">
        <div class="modal-question-content">
          ${questionContentHtml}
          <div class="modal-question-points" id="host-countdown-points">${countdownPoints} очков</div>
          <div class="modal-progress-wrap">
            <div class="modal-progress-bar">
              <div class="modal-progress-fill" id="host-progress-fill" style="width: ${Math.round(progress * 100)}%"></div>
            </div>
          </div>
          <div class="modal-countdown" id="host-countdown-display">${cdText}</div>
          ${hostAnswerTextHtml}
          ${answerBlockHtml}
          ${auctionSelectHint}
          ${auctionDurationHtml}
          <div class="modal-host-buttons">${hostButtonsHtml}</div>
        </div>
      </div>
    `;
    modal.classList.add('visible');
    bindModalEvents(modal);
    startProgressInterval();
  }

  function hideHostQuestionModal() {
    stopProgressInterval();
    const modal = document.getElementById('host-question-modal');
    if (modal) modal.classList.remove('visible');
  }

  function renderHostBonusModal() {
    const bonus = state?.bonus;
    if (!bonus || !bonus.active || state?.phase !== 'bonus' || !bonus.question) {
      hideHostBonusModal();
      return;
    }

    let modal = document.getElementById('host-bonus-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'host-bonus-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const q = bonus.question;
    const phase = bonus.questionPhase;

    let contentHtml = '';

    if (phase === 'choices') {
      const hintBlocks = q.hintBlocks || q.questionBlocks || [];
      const hintHtml = renderBlocksHtml(hintBlocks.filter((b) => b.type === 'text' || b.type === 'image'), q.basePath);
      const playersStatus = (state.players || [])
        .map((p) => {
          const ch = bonus.playerChoices?.[p.id];
          let status = 'ожидает';
          if (ch === 'play') status = 'играет';
          else if (ch === 'pass') status = 'пасует';
          return `<li><span class="bonus-player-name">${escapeHtml(p.name)}</span> — <span class="bonus-player-status">${status}</span></li>`;
        })
        .join('');
      contentHtml = `
        <div class="bonus-question-block">
          <div class="bonus-stage-label">Этап ${bonus.stage || 1}</div>
          <div class="bonus-hint">${hintHtml || 'Подсказка к вопросу.'}</div>
          <div class="bonus-host-players">
            <div class="bonus-host-players-title">Выбор игроков:</div>
            <ul class="bonus-host-players-list">${playersStatus}</ul>
          </div>
        </div>
      `;
    } else if (phase === 'question') {
      const questionContentHtml = getQuestionContentHtml(q);
      const options = q.options || [];
      let optionsHtml = '';
      if (options.length) {
        optionsHtml =
          '<div class="bonus-options">' +
          options
            .map(
              (opt) => `
            <div class="bonus-option">
              <span class="bonus-option-text">${escapeHtml(opt.text || '')}</span>
            </div>`
            )
            .join('') +
          '</div>';
      }
      contentHtml = `
        <div class="bonus-question-block">
          <div class="bonus-stage-label">Этап ${bonus.stage || 1}</div>
          ${questionContentHtml}
          ${optionsHtml}
        </div>
      `;
    } else if (phase === 'reveal') {
      const questionContentHtml = getQuestionContentHtml(q);
      const options = q.options || [];
      let optionsHtml = '';
      if (options.length) {
        optionsHtml =
          '<div class="bonus-options bonus-options-reveal">' +
          options
            .map((opt) => {
              const isCorrect = !!opt.correct;
              return `
            <div class="bonus-option ${isCorrect ? 'correct' : ''}">
              <span class="bonus-option-text">${escapeHtml(opt.text || '')}</span>
              ${isCorrect ? '<span class="bonus-option-mark">✓</span>' : ''}
            </div>`;
            })
            .join('') +
          '</div>';
      }
      const playersStatus = (state.players || [])
        .map((p) => {
          const ans = bonus.playerAnswers?.[p.id];
          const ch = bonus.playerChoices?.[p.id];
          let status = 'не участвовал';
          if (ch === 'pass') status = 'пасовал';
          else if (ch === 'play') {
            if (ans && ans.correct === true) status = 'ответил верно (+1)';
            else if (ans && ans.correct === false) {
              if (bonus.stage === 1) status = 'ответил неверно (−1, но не ниже 0)';
              else status = 'ответил неверно (−1 и выбыл)';
            } else {
              status = 'не дал ответ';
            }
          }
          return `<li><span class="bonus-player-name">${escapeHtml(p.name)}</span> — <span class="bonus-player-status">${status}</span> (<span class="bonus-player-score">${p.score}</span>)</li>`;
        })
        .join('');
      contentHtml = `
        <div class="bonus-question-block">
          <div class="bonus-stage-label">Этап ${bonus.stage || 1}</div>
          ${questionContentHtml}
          ${optionsHtml}
          <div class="bonus-host-players">
            <div class="bonus-host-players-title">Результаты игроков:</div>
            <ul class="bonus-host-players-list">${playersStatus}</ul>
          </div>
        </div>
      `;
    } else {
      contentHtml = '<div class="bonus-status-text">Ожидаем действия игроков…</div>';
    }

    const showNext = phase === 'reveal';

    modal.innerHTML = `
      <div class="modal-question">
        <div class="modal-question-content">
          ${contentHtml}
          <div class="modal-host-buttons">
            ${showNext ? '<button class="btn-bonus-next modal-host-btn">Следующий вопрос</button>' : ''}
          </div>
        </div>
      </div>
    `;

    const btnNext = modal.querySelector('.btn-bonus-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        socket.emit('host:bonus-next-question');
      });
    }

    modal.classList.add('visible');
  }

  function hideHostBonusModal() {
    const modal = document.getElementById('host-bonus-modal');
    if (modal) modal.classList.remove('visible');
  }

  function bindModalEvents(modal) {
    if (!modal) return;
    modal.querySelectorAll('.btn-auction-select').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        const input = modal.querySelector('#auction-duration-input');
        const raw = (input?.value ?? '').trim();
        let duration = parseInt(raw, 10);
        if (!Number.isFinite(duration)) {
          duration = 15;
        } else if (duration < 0) {
          duration = 0;
        } else if (duration > 120) {
          duration = 120;
        }
        socket.emit('host:set-answering', { playerId: btn.dataset.player, duration });
      });
    });
    modal.querySelectorAll('.btn-correct, .btn-blitz-winner').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        const pid = btn.dataset.player;
        if (modal.querySelector('.btn-blitz-winner')) {
          socket.emit('host:blitz-winner', { playerId: pid });
        } else {
          socket.emit('host:correct', { playerId: pid });
        }
      });
    });
    const btnWrong = modal.querySelector('.btn-wrong');
    if (btnWrong) btnWrong.addEventListener('click', () => {
      if (window.unlockAudio) window.unlockAudio();
      socket.emit('host:wrong');
    });
    const btnNextQuestion = modal.querySelector('.btn-next-question');
    if (btnNextQuestion) btnNextQuestion.addEventListener('click', () => {
      if (window.unlockAudio) window.unlockAudio();
      socket.emit('host:close-question');
    });
  }

  function renderBonusSetup() {
    const playersHtml = (state?.players || []).length
      ? (state?.players || [])
          .map(
            (p) =>
              `<div class="player-card"><div class="player-score-wrap"><span class="player-score">${p.score}</span></div><div class="player-name">${escapeHtml(
                p.name
              )}</div></div>`
          )
          .join('')
      : '<div class="players-panel-empty">Игроки появятся здесь</div>';

    const playerUrl = (config?.playerBaseUrl || window.location.origin) + '/player';

    const qrHtml = `
      <div class="bonus-qr-wrap">
        <div class="bonus-qr-title">Бонусная дуэль</div>
        <div class="bonus-qr-subtitle">Попросите игроков отсканировать QR-код и открыть страницу игрока.</div>
        <div id="host-bonus-qr" class="bonus-qr-box"></div>
        <div class="bonus-qr-link">${escapeHtml(playerUrl)}</div>
      </div>
    `;

    const html = `
      <div class="game-logo">
        <img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img">
      </div>
      <div class="host-game-block">
        <div class="game-layout bonus-layout">
          <div class="game-board bonus-board">
            <div class="game-board-inner">
              ${qrHtml}
            </div>
          </div>
        </div>
        <div class="host-bottom-panel">
          <div class="host-controls">
            <button class="btn-bonus-begin">Начать бонусную игру</button>
          </div>
        </div>
        <div class="players-panel players-panel-bottom">
          ${playersHtml}
        </div>
      </div>
    `;

    view.innerHTML = html;

    const qrContainer = view.querySelector('#host-bonus-qr');
    if (qrContainer && window.SimpleQRCode) {
      window.SimpleQRCode(qrContainer, playerUrl);
    }

    const btnBegin = view.querySelector('.btn-bonus-begin');
    if (btnBegin) {
      btnBegin.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        socket.emit('host:begin-bonus-questions');
      });
    }
  }

  function handleScoreInputChange(inputEl) {
    const playerId = inputEl?.dataset?.player;
    if (!playerId) return;
    const p = state?.players?.find((x) => x.id === playerId);
    if (!p) return;

    const raw = (inputEl.value || '').trim();
    let next = parseInt(raw, 10);

    if (!Number.isFinite(next)) {
      next = p.score;
    }

    if (next < 0) next = 0;

    if (next !== p.score) {
      socket.emit('host:set-score', { playerId, score: next });
    } else {
      inputEl.value = String(next);
    }
  }

  function render() {
    if (state?.phase !== 'ended' && window.stopCelebrationAnimation) window.stopCelebrationAnimation();
    const isBlitz = state?.roundData?.blitz;

    // Экран бонусной подготовки (после host:start-bonus-game, до начала вопросов)
    if (state?.phase === 'bonus' && state?.bonus?.active && !state?.bonus?.question && !state?.bonus?.questionPhase) {
      renderBonusSetup();
      return;
    }

    const playersHtml = (state?.players || []).length
      ? (state?.players || [])
          .map((p) => {
            const blocked = p.blocked ? ' blocked' : '';
            const buzzed = state?.buzzedPlayerId === p.id ? ' buzzed' : '';
            const playing = state?.lastCorrectPlayerId === p.id ? ' playing' : '';
            return `<div class="player-card${blocked}${buzzed}${playing}"><div class="player-score-wrap"><input type="number" class="player-score-input" data-player="${p.id}" value="${p.score}" min="0"><div class="player-score-edit"><button class="score-btn score-minus" data-player="${p.id}" title="-5">−</button><button class="score-btn score-plus" data-player="${p.id}" title="+5">+</button></div></div><div class="player-name">${escapeHtml(p.name)}${playing ? ' — выбирает' : ''}</div></div>`;
          })
          .join('')
      : '<div class="players-panel-empty">Игроки появятся здесь</div>';
    let html = `
      <div class="game-logo">
        <img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img">
      </div>
      <div class="host-game-block">
      <div class="game-layout">
        <div class="game-board ${isBlitz ? 'blitz-view' : ''}">
          <div class="game-board-inner">
    `;

    if (!isBlitz && state?.roundData?.categories?.length) {
      html += '<div class="categories-column">';
      for (const cat of state.roundData.categories) {
        html += `<div class="category-btn" data-cat-id="${cat.id}">${escapeHtml(cat.title)}</div>`;
      }
      html += '</div>';
      html += '<div class="questions-grid">';
      const pointsSet = new Set();
      const qList = Object.values(state.roundData.questionsMap || {});
      for (const q of qList) pointsSet.add(q.points);
      const points = [...pointsSet].sort((a, b) => a - b);
      const bulbHtml = Array.from({ length: 16 }, (_, i) => `<span class="bulb" style="--i:${i}"></span>`).join('');
      for (const cat of state.roundData.categories) {
        html += '<div class="category-row">';
        for (const pt of points) {
          const q = qList.find((x) => x.categoryId === cat.id && x.points === pt);
          const played = state.answeredIds?.includes(q?.id);
          const pts = q ? q.points : '-';
          html += `<div class="question-cell oval-note ${played ? 'played' : ''}" data-q-id="${q?.id || ''}" data-cat="${cat.id}" data-points="${pt}"><div class="note-bulbs">${bulbHtml}</div><div class="note-body oval"><span class="points">${pts}</span></div></div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    } else if (isBlitz) {
      html += '<div class="blitz-info">Блиц — ведущий выбирает победителя</div>';
    } else {
      html += '<div class="blitz-info">Нет категорий. Запустите игру.</div>';
    }

    html += `
          </div>
        </div>
      </div>
      <div class="host-bottom-panel">
        ${!isBlitz ? '<div class="random-btn-wrap"><button class="random-btn" title="Случайный вопрос с мин. очками">Выбери за меня</button></div>' : ''}
        <div class="host-controls">`;
    if (state?.phase === 'idle') {
      html += '<button class="btn-start">Начать игру</button>';
    } else if (state?.phase === 'blitz') {
      for (const p of state.players || []) {
        html += `<button class="btn-correct btn-blitz-winner" data-player="${p.id}">${escapeHtml(p.name)} — победитель</button>`;
      }
      html += '<button class="btn-next">След. раунд (без победителя)</button>';
    } else {
      if (state?.phase === 'round' && !state?.currentQuestion && !state?.buzzedPlayerId) {
        html += '<button class="btn-next">След. раунд</button>';
      }
    }
    if (state?.phase !== 'idle' && state?.phase !== 'ended') {
      html += '<button class="btn-restart">Перезапуск</button><button class="btn-end-game">Конец игры</button>';
    } else if (state?.phase === 'ended') {
      html += '<button class="btn-restart">Перезапуск</button>';
    }
    html += `</div>
      </div>
      <div class="players-panel players-panel-bottom">
        ${playersHtml}
      </div>
      </div>`;

    if (state?.phase === 'ended') {
      // При завершении игры жёстко убираем все модальные окна вопросов и бонуса
      const qModal = document.getElementById('host-question-modal');
      if (qModal && qModal.parentNode) qModal.parentNode.removeChild(qModal);
      const bModal = document.getElementById('host-bonus-modal');
      if (bModal && bModal.parentNode) bModal.parentNode.removeChild(bModal);

      const sorted = (state.players || []).sort((a, b) => b.score - a.score);
      const maxScore = sorted[0]?.score ?? 0;
      const winners = sorted.filter((p) => p.score === maxScore && maxScore > 0);
      const winnerNames = winners.length ? winners.map((p) => escapeHtml(p.name)).join(', ') : 'Нет победителя';
      const winnerLabel = winners.length > 1 ? 'Победители' : 'Победитель';
      const isBonusFinale = state?.bonus?.finished;
      view.innerHTML = `
        <div class="finale-celebration" id="finale-celebration"></div>
        <div class="game-logo"><img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img"></div>
        <div class="finale-winners-block">
          <h2 class="finale-winners-title">${isBonusFinale ? 'Бонусная дуэль — ' + winnerLabel : winnerLabel}</h2>
          <p class="finale-winners-names">${winnerNames}</p>
        </div>
        <div class="players-panel players-panel-bottom" style="margin-bottom: 1rem;">
          ${(state.players || []).map((p) => `<div class="player-card"><div class="player-score">${p.score}</div><div class="player-name">${escapeHtml(p.name)}</div></div>`).join('')}
        </div>
        <div class="finale-view">
          <h2>${isBonusFinale ? 'Итоги бонусной игры' : 'Итоги'}</h2>
          <ul class="finale-list">
            ${sorted
              .map(
                (p, i) =>
                  `<li class="${winners.some((w) => w.id === p.id) ? 'finale-winner' : ''}"><span>${escapeHtml(p.name)}</span><span>${p.score}</span></li>`
              )
              .join('')}
          </ul>
          <div class="host-controls" style="margin-top: 1.5rem;">
            <button class="btn-restart">Перезапуск</button>
            ${!isBonusFinale ? '<button class="btn-start-bonus">Бонусная игра</button>' : ''}
          </div>
        </div>
      `;
      view.querySelector('.btn-restart')?.addEventListener('click', () => socket.emit('host:restart-game'));
      const btnBonus = view.querySelector('.btn-start-bonus');
      if (btnBonus) {
        btnBonus.addEventListener('click', () => {
          if (window.unlockAudio) window.unlockAudio();
          socket.emit('host:start-bonus-game');
        });
      }
      if (window.startCelebrationAnimation) window.startCelebrationAnimation();
      return;
    }

    view.innerHTML = html;
    bindEvents();

    if (state?.currentQuestion) {
      renderHostQuestionModal();
    } else {
      hideHostQuestionModal();
    }

    if (state?.phase === 'bonus' && state?.bonus?.active && state?.bonus?.question) {
      renderHostBonusModal();
    } else {
      hideHostBonusModal();
    }
  }

  function bindEvents() {
    const rnd = view.querySelector('.random-btn');
    if (rnd) {
      rnd.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        if (window.playSfx) window.playSfx('select');
        socket.emit('host:select-question', { random: true });
      });
      rnd.disabled = state?.phase !== 'round' || !!state?.currentQuestion;
    }

    view.querySelectorAll('.question-cell:not(.played)').forEach((el) => {
      const qid = el.dataset.qId;
      if (!qid) return;
      el.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        if (window.playSfx) window.playSfx('select');
        socket.emit('host:select-question', { questionId: qid });
      });
    });

    const btnStart = view.querySelector('.btn-start');
    if (btnStart) btnStart.addEventListener('click', () => {
      if (window.unlockAudio) window.unlockAudio();
      socket.emit('host:start-game');
    });

    view.querySelectorAll('.btn-correct, .btn-blitz-winner').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        const pid = btn.dataset.player;
        if (view.querySelector('.btn-blitz-winner')) {
          socket.emit('host:blitz-winner', { playerId: pid });
        } else {
          socket.emit('host:correct', { playerId: pid });
        }
      });
    });

    const btnWrong = view.querySelector('.btn-wrong');
    if (btnWrong) btnWrong.addEventListener('click', () => {
      if (window.unlockAudio) window.unlockAudio();
      socket.emit('host:wrong');
    });

    const btnNext = view.querySelector('.btn-next');
    if (btnNext) btnNext.addEventListener('click', () => {
      if (window.unlockAudio) window.unlockAudio();
      socket.emit('host:next-round');
    });

    const btnRestart = view.querySelector('.btn-restart');
    if (btnRestart) btnRestart.addEventListener('click', () => socket.emit('host:restart-game'));

    const btnEndGame = view.querySelector('.btn-end-game');
    if (btnEndGame) btnEndGame.addEventListener('click', () => socket.emit('host:end-game'));

    view.querySelectorAll('.score-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.player;
        const p = state?.players?.find((x) => x.id === playerId);
        if (!p) return;
        const delta = btn.classList.contains('score-plus') ? 5 : -5;
        socket.emit('host:set-score', { playerId, score: Math.max(0, p.score + delta) });
      });
    });

    view.querySelectorAll('.player-score-input').forEach((input) => {
      input.addEventListener('change', () => {
        handleScoreInputChange(input);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleScoreInputChange(input);
          input.blur();
        }
      });
    });
  }

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
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
    const el = document.getElementById('host-countdown-display');
    if (el) el.textContent = remaining !== undefined ? `Осталось: ${remaining} сек` : '';
    updateProgressBar();
  });

  fetch('/api/config')
    .then((r) => r.json())
    .then((c) => {
      config = c;
      state = state || { phase: 'idle', players: [], roundData: null, currentRound: null, answeredIds: [] };
      render();
    })
    .catch(() => {
      state = { phase: 'idle', players: [], roundData: null, currentRound: null, answeredIds: [] };
      render();
    });
})();
