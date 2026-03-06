(function () {
  const STORAGE_KEY_CLIENT_ID = 'ugadai_player_client_id';
  const STORAGE_KEY_PLAYER_NAME = 'ugadai_player_name';
  const STORAGE_KEY_PLAYER_ID = 'ugadai_player_id';

  function getClientId() {
    let id = localStorage.getItem(STORAGE_KEY_CLIENT_ID);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(STORAGE_KEY_CLIENT_ID, id);
    }
    return id;
  }

  const view = document.getElementById('player-view');
  view.classList.add('active');

  const ROUND_TYPES_WITH_BUZZ = ['fixed', 'countdown'];
  let state = null;
  let myPlayerId = localStorage.getItem(STORAGE_KEY_PLAYER_ID) || null;
  let registered = !!localStorage.getItem(STORAGE_KEY_PLAYER_NAME);
  let countdownRemaining = null;
  let countdownTotal = null;
  let progressInterval = null;

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function canBuzz() {
    if (!state) return false;
    if (!state.currentQuestion) return false;
    const roundType = state.currentRound?.type;
    if (!ROUND_TYPES_WITH_BUZZ.includes(roundType)) return false;
    // для вопросов с музыкой ждём, пока ведущий нажмёт «Слушаем» (начинается таймер)
    if (state.questionAudioUrl && !state.questionStartTime) return false;
    const me = state.players?.find((p) => p.id === myPlayerId);
    if (!me || me.blocked) return false;
    if (state.buzzedPlayerId) return false;
    return state.phase === 'round' || state.phase === 'question';
  }

  function canSelectQuestion() {
    if (
      !state ||
      state?.phase !== 'round' ||
      state?.currentQuestion ||
      state?.buzzedPlayerId ||
      !state?.roundData?.categories?.length ||
      state?.roundData?.blitz
    ) {
      return false;
    }
    // если вопросов больше нет — выбирать нечего
    const qList = Object.values(state.roundData.questionsMap || {});
    const answered = state.answeredIds || [];
    const hasAvailable = qList.some((q) => q && !answered.includes(q.id));
    if (!hasAvailable) return false;

    // выбирать может только игрок, у которого ход (последний правильно ответивший)
    const isMyTurn = state.lastCorrectPlayerId === myPlayerId;
    return isMyTurn;
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
    const fill = document.getElementById('player-progress-fill');
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

  function doBuzz() {
    if (!canBuzz()) return;
    if (window.unlockAudio) window.unlockAudio();
    if (window.audioPlayer) window.audioPlayer.pause();
    window.socket.emit('player:buzz');
  }

  function renderModal() {
    let modal = document.getElementById('player-question-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'player-question-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    const q = state?.currentQuestion;
    if (!q) return;
    const isCountdown = state?.currentRound?.type === 'countdown';
    const cdText = isCountdown && countdownRemaining != null ? `Осталось: ${countdownRemaining} сек` : '';
    const progress = getQuestionProgress();
    const questionContentHtml = getQuestionContentHtml(q);
    const showBuzz = canBuzz();
    const iAmAnswering = state?.buzzedPlayerId === myPlayerId;
    const answerRevealed = !!state?.answerRevealed;

    let buzzInModal = '';
    const answerBlockHtml = answerRevealed ? getAnswerContentHtml(q) : '';
    const roundParams = state?.currentRound?.params || {};
    const baseTotal = countdownTotal ?? state?.questionTotalTime ?? roundParams.totalTime ?? 30;
    const maxPoints = q.points || roundParams.pointsPerQuestion || 10;
    const baseMultiplier = roundParams.multiplier || 1;
    const effectiveMultiplier = baseTotal > 0 ? (maxPoints * baseMultiplier) / baseTotal : baseMultiplier;
    const countdownPoints =
      isCountdown && countdownRemaining != null ? Math.max(0, Math.round(countdownRemaining * effectiveMultiplier)) : q.points;
    if (answerRevealed) {
      buzzInModal = '<p class="modal-buzz-wait">Ожидайте следующего вопроса</p>';
    } else if (iAmAnswering) {
      buzzInModal = '<div class="modal-buzz-status you-answer">Вы отвечаете!</div>';
    } else if (showBuzz) {
      buzzInModal = '<button class="buzz-btn modal-buzz-btn" id="modal-buzz-btn">Ответить</button>';
    } else {
      buzzInModal = '<p class="modal-buzz-wait">Ожидайте своего хода</p>';
    }

    const catTitle =
      state?.roundData?.categories?.find((c) => c.id === q.categoryId)?.title || 'Категория';

    modal.innerHTML = `
      <div class="modal-question">
        <div class="modal-question-content">
          <div class="modal-question-category">${escapeHtml(catTitle)}</div>
          <div class="modal-question-points" id="player-countdown-points">${countdownPoints} очков</div>
          ${questionContentHtml}
          <div class="modal-progress-wrap">
            <div class="modal-progress-bar">
              <div class="modal-progress-fill" id="player-progress-fill" style="width: ${Math.round(progress * 100)}%"></div>
            </div>
          </div>
          <div class="modal-countdown" id="player-countdown">${cdText}</div>
          ${answerBlockHtml}
          <div class="modal-buzz-area">${buzzInModal}</div>
        </div>
      </div>
    `;
    modal.classList.add('visible');
    const modalBuzzBtn = modal.querySelector('#modal-buzz-btn');
    if (modalBuzzBtn) modalBuzzBtn.addEventListener('click', doBuzz);
    startProgressInterval();
  }

  function hideModal() {
    stopProgressInterval();
    const modal = document.getElementById('player-question-modal');
    if (modal) modal.classList.remove('visible');
  }

  function renderBonusModal() {
    const bonus = state?.bonus;
    if (!bonus || !bonus.active || state?.phase !== 'bonus') {
      hideBonusModal();
      return;
    }

    let modal = document.getElementById('player-bonus-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'player-bonus-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const eliminated = bonus.eliminatedPlayerIds?.includes?.(myPlayerId);
    const choice = bonus.playerChoices?.[myPlayerId];
    const myAnswer = bonus.playerAnswers?.[myPlayerId];
    const q = bonus.question;
    const phase = bonus.questionPhase;

    let contentHtml = '';

    if (!q) {
      contentHtml = '<div class="bonus-status-text">Ожидаем начала бонусной игры от ведущего…</div>';
    } else if (phase === 'choices') {
      const hintBlocks = q.hintBlocks || q.questionBlocks || [];
      const hintHtml = renderBlocksHtml(hintBlocks.filter((b) => b.type === 'text' || b.type === 'image'), q.basePath);
      let buttonsHtml = '';
      if (!eliminated && !choice) {
        buttonsHtml = `
          <div class="bonus-choice-buttons">
            <button class="btn-bonus-play">Играю</button>
            <button class="btn-bonus-pass">Пассую</button>
          </div>
        `;
      } else if (choice === 'play') {
        buttonsHtml = '<div class="bonus-choice-status bonus-choice-play">Вы играете в этом вопросе</div>';
      } else if (choice === 'pass') {
        buttonsHtml = '<div class="bonus-choice-status bonus-choice-pass">Вы пасуете в этом вопросе</div>';
      }
      contentHtml = `
        <div class="bonus-question-block">
          <div class="bonus-stage-label">Этап ${bonus.stage || 1}</div>
          <div class="bonus-hint">${hintHtml || 'Прочитайте подсказку и решите, будете ли играть.'}</div>
          ${buttonsHtml}
        </div>
      `;
    } else if (phase === 'question') {
      const canAnswer = !eliminated && choice === 'play';
      const alreadyAnswered = canAnswer && myAnswer && Array.isArray(myAnswer.options);
      // Сохраняем выбранные варианты из текущего DOM перед перерисовкой (чтобы не сбрасывать при обновлении от других игроков)
      let pendingSelectedIds = [];
      if (canAnswer && !alreadyAnswered && modal.querySelector('.bonus-options')) {
        const checked = modal.querySelectorAll('.bonus-options input[name="bonus-option"]:checked');
        pendingSelectedIds = Array.from(checked).map((el) => el.value);
      }
      const questionContentHtml = getQuestionContentHtml(q);
      const options = q.options || [];
      const allowMultiple = !!q.allowMultiple;
      let optionsHtml = '';
      if (options.length) {
        optionsHtml =
          '<div class="bonus-options">' +
          options
            .map(
              (opt) => {
                const optIdStr = String(opt.id);
                const isChecked = pendingSelectedIds.includes(optIdStr);
                return `
            <label class="bonus-option">
              <input type="${allowMultiple ? 'checkbox' : 'radio'}" name="bonus-option" value="${escapeHtml(
                optIdStr
              )}" ${!canAnswer || alreadyAnswered ? 'disabled' : ''}${isChecked ? ' checked' : ''}>
              <span class="bonus-option-text">${escapeHtml(opt.text || '')}</span>
            </label>`;
              }
            )
            .join('') +
          '</div>';
      }
      let footerHtml = '';
      if (!canAnswer) {
        if (eliminated) {
          footerHtml = '<div class="bonus-status-text">Вы выбыли из игры. Наблюдайте за результатами.</div>';
        } else if (choice === 'pass') {
          footerHtml = '<div class="bonus-status-text">Вы пасуете в этом вопросе.</div>';
        } else {
          footerHtml = '<div class="bonus-status-text">Ожидание вашего статуса…</div>';
        }
      } else if (alreadyAnswered) {
        footerHtml = '<div class="bonus-wait-others">Ждите других игроков…</div>';
      } else {
        footerHtml = `
          <div class="bonus-answer-footer">
            <button class="btn-bonus-submit">Ответить</button>
          </div>
        `;
      }
      contentHtml = `
        <div class="bonus-question-block">
          <div class="bonus-stage-label">Этап ${bonus.stage || 1}</div>
          ${questionContentHtml}
          ${optionsHtml}
          ${footerHtml}
        </div>
      `;
    } else if (phase === 'reveal') {
      const questionContentHtml = getQuestionContentHtml(q);
      const options = q.options || [];
      const myCorrect = myAnswer ? myAnswer.correct : null;
      const eliminatedNow = eliminated;
      let optionsHtml = '';
      if (options.length) {
        optionsHtml =
          '<div class="bonus-options bonus-options-reveal">' +
          options
            .map((opt) => {
              const isCorrect = !!opt.correct;
              const mySelected = Array.isArray(myAnswer?.options) && myAnswer.options.includes(opt.id);
              const cls = isCorrect ? 'correct' : mySelected ? 'selected' : '';
              return `
            <div class="bonus-option ${cls}">
              <span class="bonus-option-text">${escapeHtml(opt.text || '')}</span>
              ${isCorrect ? '<span class="bonus-option-mark">✓</span>' : ''}
            </div>`;
            })
            .join('') +
          '</div>';
      }
      let resultHtml = '';
      if (choice === 'play') {
        if (myCorrect === true) {
          resultHtml = '<div class="bonus-result bonus-result-correct">Правильно! +1 очко.</div>';
        } else if (myCorrect === false) {
          if (bonus.stage === 1) {
            resultHtml = '<div class="bonus-result bonus-result-wrong">Неправильно. −1 очко (но не ниже нуля).</div>';
          } else {
            resultHtml =
              '<div class="bonus-result bonus-result-wrong">Неправильно. −1 очко и выбывание из игры.</div>';
          }
        } else {
          resultHtml = '<div class="bonus-result">Результат по этому вопросу для вас не зафиксирован.</div>';
        }
      } else if (choice === 'pass') {
        resultHtml = '<div class="bonus-result">Вы пасовали в этом вопросе.</div>';
      } else if (eliminatedNow) {
        resultHtml = '<div class="bonus-result bonus-result-wrong">Вы выбыли из игры.</div>';
      }

      contentHtml = `
        <div class="bonus-question-block">
          <div class="bonus-stage-label">Этап ${bonus.stage || 1}</div>
          ${questionContentHtml}
          ${optionsHtml}
          ${resultHtml}
        </div>
      `;
    } else {
      contentHtml = '<div class="bonus-status-text">Ожидаем действия ведущего…</div>';
    }

    modal.innerHTML = `
      <div class="modal-question">
        <div class="modal-question-content">
          ${contentHtml}
        </div>
      </div>
    `;
    modal.classList.add('visible');

    const btnPlay = modal.querySelector('.btn-bonus-play');
    const btnPass = modal.querySelector('.btn-bonus-pass');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        window.socket.emit('player:bonus-choice', { choice: 'play' });
      });
    }
    if (btnPass) {
      btnPass.addEventListener('click', () => {
        window.socket.emit('player:bonus-choice', { choice: 'pass' });
      });
    }
    const btnSubmit = modal.querySelector('.btn-bonus-submit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => {
        const inputs = Array.from(modal.querySelectorAll('.bonus-options input[name="bonus-option"]:checked'));
        const ids = inputs.map((i) => i.value);
        if (!ids.length) return;
        window.socket.emit('player:bonus-answer', { options: ids });
      });
    }
  }

  function hideBonusModal() {
    const modal = document.getElementById('player-bonus-modal');
    if (modal) modal.classList.remove('visible');
  }

  function updateModalCountdown() {
    const el = document.getElementById('player-countdown');
    if (el && state?.currentQuestion && state?.currentRound?.type === 'countdown' && countdownRemaining != null) {
      el.textContent = `Осталось: ${countdownRemaining} сек`;
    }
    const pointsEl = document.getElementById('player-countdown-points');
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
  }

  function render() {
    if (state?.phase !== 'ended' && window.stopCelebrationAnimation) window.stopCelebrationAnimation();

    const bonus = state?.bonus;

    if (!registered) {
      view.innerHTML = `
        <div class="game-logo">
          <img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img">
        </div>
        <div class="player-register">
          <input type="text" id="player-name" placeholder="Ваше имя" maxlength="20" value="${escapeHtml(localStorage.getItem(STORAGE_KEY_PLAYER_NAME) || '')}" />
          <button id="register-btn">Войти в игру</button>
        </div>
      `;
      const input = view.querySelector('#player-name');
      const btn = view.querySelector('#register-btn');
      btn.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        const name = (input.value || 'Игрок').trim();
        localStorage.setItem(STORAGE_KEY_PLAYER_NAME, name);
        window.socket.emit('player:register', { name, clientId: getClientId() });
        registered = true;
        render();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btn.click();
      });
      return;
    }

    if (state?.phase === 'ended') {
      // На финальном экране жёстко убираем все модальные окна вопросов/бонуса
      const qModal = document.getElementById('player-question-modal');
      if (qModal && qModal.parentNode) qModal.parentNode.removeChild(qModal);
      const bModal = document.getElementById('player-bonus-modal');
      if (bModal && bModal.parentNode) bModal.parentNode.removeChild(bModal);

      const isBonusFinale = bonus?.finished;
      const bonusTimes = bonus?.timesMs || {};
      const getTimeMs = (p) => bonusTimes[p.id] || 0;
      const sorted = (state.players || []).sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return getTimeMs(b) - getTimeMs(a);
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
          <h2>${isBonusFinale ? 'Итоги бонусной игры' : 'Итоговая таблица'}</h2>
          <table class="finale-results-table">
            <thead><tr><th>Место</th><th>Имя</th><th>Очки</th>${isBonusFinale ? '<th>Время, с</th>' : ''}</tr></thead>
            <tbody>
              ${sorted
                .map(
                  (p, i) =>
                    `<tr class="${placeClass(i)}"><td>${placeLabel(i)}</td><td>${escapeHtml(p.name)}${p.id === myPlayerId ? ' (вы)' : ''}</td><td>${p.score}</td>${
                      isBonusFinale ? `<td>${(getTimeMs(p) / 1000).toFixed(2)}</td>` : ''
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

    // Бонусная игра отображается в отдельном модальном окне поверх основного интерфейса

    const showBoard = canSelectQuestion();
    const currentPlayerId = state?.lastCorrectPlayerId;
    let boardHtml = '';
    if (showBoard && state?.roundData?.categories?.length) {
      boardHtml = '<div class="game-layout"><div class="game-board"><div class="game-board-inner">';
      boardHtml += '<div class="categories-column">';
      for (const cat of state.roundData.categories) {
        boardHtml += `<div class="category-btn" data-cat-id="${escapeHtml(cat.id)}">${escapeHtml(cat.title)}</div>`;
      }
      boardHtml += '</div><div class="questions-grid">';
      const qList = Object.values(state.roundData.questionsMap || {});
      const pointsSet = new Set();
      for (const q of qList) pointsSet.add(q.points);
      const points = [...pointsSet].sort((a, b) => a - b);
      const bulbHtml = Array.from({ length: 16 }, (_, i) => `<span class="bulb" style="--i:${i}"></span>`).join('');
      for (const cat of state.roundData.categories) {
        boardHtml += '<div class="category-row">';
        for (const pt of points) {
          const q = qList.find((x) => x.categoryId === cat.id && x.points === pt);
          const played = state.answeredIds?.includes(q?.id);
          const pts = q ? q.points : '-';
          boardHtml += `<div class="question-cell oval-note ${played ? 'played' : ''}" data-q-id="${q?.id || ''}" data-cat="${escapeHtml(cat.id)}" data-points="${pt}"><div class="note-bulbs">${bulbHtml}</div><div class="note-body oval"><span class="points">${pts}</span></div></div>`;
        }
        boardHtml += '</div>';
      }
      boardHtml += '</div></div><div class="random-btn-wrap"><button class="random-btn" title="Случайный вопрос">Выбери за меня</button></div></div></div>';
    }

    view.innerHTML = `
      <div class="game-logo">
        <img src="/assets/logo.png" alt="Угадай мелодию" class="logo-img">
      </div>
      ${boardHtml}
      <div class="players-panel players-panel-bottom">
        ${(state?.players || [])
          .map(
            (p) =>
              `<div class="player-card ${p.blocked ? 'blocked' : ''} ${p.id === state.buzzedPlayerId ? 'buzzed' : ''} ${p.id === currentPlayerId ? 'playing' : ''}">
                <div class="player-score">${p.score}</div>
                <div class="player-name">${escapeHtml(p.name)}${p.id === myPlayerId ? ' (вы)' : ''}${p.id === currentPlayerId ? ' — выбирает' : ''}</div>
              </div>`
          )
          .join('')}
      </div>
    `;

    const clientId = getClientId();
    view.querySelectorAll('.question-cell:not(.played)').forEach((el) => {
      const qid = el.dataset.qId;
      if (!qid) return;
      el.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        if (window.playSfx) window.playSfx('select');
        window.socket.emit('player:select-question', { questionId: qid, clientId });
      });
    });

    const randomBtn = view.querySelector('.random-btn');
    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        if (window.unlockAudio) window.unlockAudio();
        if (window.playSfx) window.playSfx('select');
        window.socket.emit('player:select-question', { random: true, clientId });
      });
    }

    if (state?.currentQuestion) {
      renderModal();
    } else {
      hideModal();
    }

    if (bonus?.active && state?.phase === 'bonus') {
      renderBonusModal();
    } else {
      hideBonusModal();
    }

    document.addEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      doBuzz();
    }
  }

  window.onSocket('player:registered', ({ playerId }) => {
    myPlayerId = playerId;
    localStorage.setItem(STORAGE_KEY_PLAYER_ID, playerId);
    const name = state?.players?.find((p) => p.id === playerId)?.name;
    if (name) localStorage.setItem(STORAGE_KEY_PLAYER_NAME, name);
    if (registered) render();
  });

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
    updateModalCountdown();
  });

  function tryRestoreOrReconnect() {
    const storedName = localStorage.getItem(STORAGE_KEY_PLAYER_NAME);
    const clientId = getClientId();
    if (registered && myPlayerId) {
      window.socket.emit('player:register', {
        name: state?.players?.find((p) => p.id === myPlayerId)?.name || storedName || 'Игрок',
        clientId,
      });
      setTimeout(() => window.socket.emit('player:request-state'), 100);
      render();
    } else if (storedName) {
      registered = true;
      myPlayerId = localStorage.getItem(STORAGE_KEY_PLAYER_ID) || myPlayerId;
      window.socket.emit('player:register', { name: storedName, clientId });
      setTimeout(() => window.socket.emit('player:request-state'), 100);
      render();
    }
  }

  window.socket.on('connect', tryRestoreOrReconnect);
  if (window.socket.connected) {
    tryRestoreOrReconnect();
  }
})();
