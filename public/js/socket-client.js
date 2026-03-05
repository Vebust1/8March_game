(function () {
  window.socket = io();
  window.audioPlayer = document.createElement('audio');
  document.body.appendChild(window.audioPlayer);
  window.socketEvents = {};

  let audioUnlocked = false;
  let currentQuestionId = null;
  let auctionTimeoutId = null;
  let auctionAudioPlaying = false;
  let sfxContext = null;

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const overlay = document.getElementById('audio-unlock-overlay');
    if (overlay) overlay.classList.add('hidden');
    try {
      const silent = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      window.audioPlayer.src = silent;
      window.audioPlayer.volume = 1;
      window.audioPlayer.play().catch(() => {});
    } catch (e) {}
  }

  window.unlockAudio = unlockAudio;
  document.getElementById('audio-unlock-overlay')?.addEventListener('click', unlockAudio);
  document.getElementById('audio-unlock-overlay')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') unlockAudio();
  });
  document.addEventListener('click', unlockAudio, { once: true, capture: true });
  document.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  let answerAudioPlayedForQuestionId = null;
  let pausedByBuzz = false;
  let pauseEnforceInterval = null;
  let lastBonusAudioUrl = null; // чтобы не перезапускать мелодию при каждом state (ответ игрока)

  function startPauseEnforce() {
    if (pauseEnforceInterval) return;
    pauseEnforceInterval = setInterval(() => {
      if (pausedByBuzz && !auctionAudioPlaying) pauseAllMedia();
    }, 100);
  }

  function stopPauseEnforce() {
    if (pauseEnforceInterval) {
      clearInterval(pauseEnforceInterval);
      pauseEnforceInterval = null;
    }
  }

  function stopQuestionAudio(questionId) {
    if (questionId != null && currentQuestionId != null && currentQuestionId !== questionId) return;
    window.audioPlayer.pause();
    window.audioPlayer.src = '';
    document.querySelectorAll('audio, video').forEach((el) => el.pause());
    currentQuestionId = null;
    if (auctionTimeoutId) {
      clearTimeout(auctionTimeoutId);
      auctionTimeoutId = null;
    }
    auctionAudioPlaying = false;
  }

  function pauseAllMedia() {
    try {
      window.audioPlayer.pause();
      window.audioPlayer.volume = 0;
      window.audioPlayer.muted = true;
      document.querySelectorAll('audio, video').forEach((el) => {
        el.pause();
        el.muted = true;
      });
    } catch (e) {}
  }

  function ensureSfxContext() {
    if (sfxContext) return sfxContext;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sfxContext = new Ctx();
    if (sfxContext.state === 'suspended') {
      sfxContext.resume().catch(() => {});
    }
    return sfxContext;
  }

  function playSfx(type) {
    try {
      const ctx = ensureSfxContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      let freq = 880;
      let duration = 0.15;
      if (type === 'buzz') {
        freq = 880;
        duration = 0.2;
      } else if (type === 'correct') {
        freq = 1200;
        duration = 0.3;
      } else if (type === 'wrong') {
        freq = 300;
        duration = 0.35;
      } else if (type === 'select') {
        freq = 1000;
        duration = 0.12;
      }
      osc.frequency.setValueAtTime(freq, now);
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  window.playSfx = playSfx;


  window.socket.on('game:state', (state) => {
    // пауза по buzz только в основной игре, не в бонусном раунде
    const inBonus = state?.phase === 'bonus';
    if (!inBonus && (state?.buzzedPlayerId || state?.questionPausedAt)) {
      pausedByBuzz = true;
      startPauseEnforce();
      pauseAllMedia();
    } else {
      pausedByBuzz = false;
      stopPauseEnforce();
    }
    (window.socketEvents['game:state'] || []).forEach(fn => fn(state));
    if (!inBonus && (state?.buzzedPlayerId || state?.questionPausedAt)) {
      return;
    }
    // бонус: остановить аудио при смене вопроса, фазе reveal/choices или окончании бонуса
    if (state?.phase === 'ended' && state?.bonus?.finished) {
      lastBonusAudioUrl = null;
      window.audioPlayer.pause();
      window.audioPlayer.src = '';
    } else if (inBonus) {
      if (state?.bonus?.questionPhase !== 'question' || !state?.bonus?.audioUrl) {
        lastBonusAudioUrl = null;
        window.audioPlayer.pause();
        window.audioPlayer.src = '';
      } else if (state.bonus.audioUrl && state.bonus.audioUrl !== lastBonusAudioUrl && !pausedByBuzz) {
        lastBonusAudioUrl = state.bonus.audioUrl;
        window.audioPlayer.volume = 1;
        window.audioPlayer.muted = false;
        window.audioPlayer.src = state.bonus.audioUrl;
        window.audioPlayer.play().catch(() => {});
      }
    } else {
      lastBonusAudioUrl = null;
    }
    if (state?.answerRevealed) {
      if (state?.answerAudioUrl && answerAudioPlayedForQuestionId !== state.currentQuestion?.id) {
        pauseAllMedia();
        currentQuestionId = null;
        answerAudioPlayedForQuestionId = state.currentQuestion?.id;
        window.audioPlayer.volume = 1;
        window.audioPlayer.muted = false;
        window.audioPlayer.src = state.answerAudioUrl;
        window.audioPlayer.play().catch(() => {});
      } else if (!state?.answerAudioUrl) {
        window.audioPlayer.volume = 1;
        window.audioPlayer.muted = false;
        if (window.audioPlayer.src) {
          window.audioPlayer.play().catch(() => {});
        }
      }
    } else if (state?.questionAudioUrl && state?.currentQuestion && !pausedByBuzz) {
      if (currentQuestionId !== state.currentQuestion.id) {
        currentQuestionId = state.currentQuestion.id;
        answerAudioPlayedForQuestionId = null;
        window.audioPlayer.volume = 1;
        window.audioPlayer.muted = false;
        window.audioPlayer.src = state.questionAudioUrl;
        window.audioPlayer.play().catch(() => {});
      }
    } else if (!state?.currentQuestion) {
      currentQuestionId = null;
      answerAudioPlayedForQuestionId = null;
    }
  });

  window.socket.on('game:play-audio', (data) => {
    (window.socketEvents['game:play-audio'] || []).forEach(fn => fn(data));
    if (data.url && !pausedByBuzz) {
      window.audioPlayer.volume = 1;
      window.audioPlayer.muted = false;
      window.audioPlayer.src = data.url;
      window.audioPlayer.play().catch(() => {});
    }
  });

  window.socket.on('game:play-auction-audio', (data) => {
    (window.socketEvents['game:play-auction-audio'] || []).forEach(fn => fn(data));
    if (!data?.url) return;
    const duration = typeof data.duration === 'number' ? data.duration : 0;
    if (!(duration > 0)) return;
    if (auctionTimeoutId) {
      clearTimeout(auctionTimeoutId);
      auctionTimeoutId = null;
    }
    auctionAudioPlaying = true;
    window.audioPlayer.volume = 1;
    window.audioPlayer.muted = false;
    window.audioPlayer.src = data.url;
    window.audioPlayer.play().catch(() => {});
    auctionTimeoutId = setTimeout(() => {
      auctionTimeoutId = null;
      auctionAudioPlaying = false;
      try {
        window.audioPlayer.pause();
      } catch (e) {}
    }, duration * 1000);
  });

  window.socket.on('game:buzz', (data) => {
    pausedByBuzz = true;
    startPauseEnforce();
    if (!auctionAudioPlaying) pauseAllMedia();
    playSfx('buzz');
    (window.socketEvents['game:buzz'] || []).forEach(fn => fn(data));
  });

  window.socket.on('game:answering', (data) => {
    pausedByBuzz = true;
    startPauseEnforce();
    if (!auctionAudioPlaying) pauseAllMedia();
    (window.socketEvents['game:answering'] || []).forEach(fn => fn(data));
  });

  window.socket.on('game:question-started', (data) => {
    (window.socketEvents['game:question-started'] || []).forEach(fn => fn(data));
    if (data.audioUrl && data.question?.id) {
      currentQuestionId = data.question.id;
      window.audioPlayer.volume = 1;
      window.audioPlayer.muted = false;
      window.audioPlayer.src = data.audioUrl;
      window.audioPlayer.play().catch(() => {});
    }
  });

  window.socket.on('game:countdown', (data) => {
    (window.socketEvents['game:countdown'] || []).forEach(fn => fn(data));
  });

  window.socket.on('game:answer-result', (data) => {
    (window.socketEvents['game:answer-result'] || []).forEach(fn => fn(data));
    if (data && data.correct) playSfx('correct');
    else playSfx('wrong');
  });

  window.socket.on('game:question-ended', (data) => {
    pausedByBuzz = false;
    stopPauseEnforce();
    stopQuestionAudio(data.questionId);
    answerAudioPlayedForQuestionId = null;
    (window.socketEvents['game:question-ended'] || []).forEach(fn => fn(data));
  });

  window.socket.on('game:resume-audio', () => {
    pausedByBuzz = false;
    stopPauseEnforce();
    window.audioPlayer.volume = 1;
    window.audioPlayer.muted = false;
    if (currentQuestionId != null && window.audioPlayer.src) {
      window.audioPlayer.play().catch(() => {});
    }
  });

  window.socket.on('game:stop-audio', () => {
    lastBonusAudioUrl = null;
    window.audioPlayer.pause();
    window.audioPlayer.src = '';
  });

  window.socket.on('game:round-started', (data) => {
    (window.socketEvents['game:round-started'] || []).forEach(fn => fn(data));
  });

  window.socket.on('game:ended', (data) => {
    (window.socketEvents['game:ended'] || []).forEach(fn => fn(data));
    playFanfare();
  });

  function playFanfare() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playTone = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };
      playTone(523, 0, 0.2);
      playTone(659, 0.2, 0.2);
      playTone(784, 0.4, 0.3);
      playTone(1047, 0.7, 0.5);
    } catch (e) {}
  }

  window.socket.on('player:registered', (data) => {
    (window.socketEvents['player:registered'] || []).forEach(fn => fn(data));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pausedByBuzz) {
      pauseAllMedia();
    }
  });

  function stopAllAudio() {
    stopPauseEnforce();
    try {
      window.audioPlayer.pause();
      window.audioPlayer.removeAttribute('src');
      window.audioPlayer.load();
      document.querySelectorAll('audio, video').forEach((el) => {
        el.pause();
        try { el.load(); } catch (e) {}
      });
    } catch (e) {}
  }

  window.addEventListener('beforeunload', stopAllAudio);
  window.addEventListener('pagehide', stopAllAudio);
  window.stopAllAudio = stopAllAudio;

  window.onSocket = function (event, fn) {
    if (!window.socketEvents[event]) window.socketEvents[event] = [];
    window.socketEvents[event].push(fn);
    return () => {
      window.socketEvents[event] = window.socketEvents[event].filter(f => f !== fn);
    };
  };
})();
