const { loadRoundsConfig } = require('./loaders/rounds');
const { loadRoundQuestions } = require('./loaders/questions');

const ROUND_TYPES_WITH_BUZZ = ['fixed', 'countdown'];

const playersByClientId = new Map();

let state = {
  phase: 'idle', // idle, round, question, blitz, bonus, ended
  roundsConfig: null,
  currentRoundIndex: -1,
  currentRound: null,
  roundData: null,
  currentQuestion: null,
  answerRevealed: false,
  answeredIds: new Set(),
  lastCorrectPlayerId: null,
  buzzedPlayerId: null,
  players: [],
  questionStartTime: null,
  questionTimer: null,
  blitzAnswers: {}, // playerId -> count
  blockedAtQuestionStart: [], // кто был заблокирован в начале вопроса (для снятия штрафа после пропуска)
  questionPausedAt: null, // когда поставлена пауза (buzz) — для заморозки счётчика и таймера
  auctionPlayTotalTime: null, // длительность проигрывания мелодии в аукционе (для прогресса)
  // бонусный раунд
  bonusActive: false,
  bonusStage: 0,
  bonusQuestions: null, // { stage1Questions, stage2Questions }
  bonusQuestionIndex: -1,
  bonusQuestion: null,
  bonusPlayerChoices: {}, // playerId -> 'play' | 'pass'
  bonusPlayerAnswers: {}, // playerId -> { options: [...], correct: boolean | null }
  bonusEliminated: new Set(), // выбывшие на этапе 2
  bonusQuestionPhase: null, // 'choices' | 'question' | 'reveal'
  bonusFinished: false,
  bonusAnswerTimeMs: {}, // playerId -> суммарное время ответа (мс)
  bonusQuestionStartTime: null, // время показа текущего вопроса дуэли
};

function encodePath(pathStr) {
  return pathStr.split('/').map((s) => encodeURIComponent(s)).join('/');
}

function getState() {
  const players = state.players
    .filter((p) => p.socketId != null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      blocked: p.blocked,
      role: p.role,
    }));
  const params = state.currentRound?.params || {};
  let questionTotalTime = null;
  if (state.currentQuestion) {
    if (state.currentRound?.type === 'countdown') {
      questionTotalTime = params.totalTime || 30;
    } else if (state.currentRound?.type === 'auction') {
      questionTotalTime = state.auctionPlayTotalTime || null;
    } else {
      questionTotalTime = params.timePerQuestion || 30;
    }
  }
  return {
    phase: state.phase,
    currentRoundIndex: state.currentRoundIndex,
    currentRound: state.currentRound,
    buzzedPlayerId: state.buzzedPlayerId,
    roundData: state.roundData
      ? {
          categories: state.roundData.categories,
          questionsMap: state.roundData.questionsMap,
          blitz: state.roundData.blitz,
        }
      : null,
    currentQuestion: state.currentQuestion,
    answerRevealed: state.answerRevealed,
    answeredIds: Array.from(state.answeredIds),
    lastCorrectPlayerId: state.lastCorrectPlayerId,
    players,
    blitzAnswers: state.blitzAnswers,
    questionStartTime: state.currentQuestion ? state.questionStartTime : null,
    questionTotalTime: state.currentQuestion ? questionTotalTime : null,
    questionPausedAt: state.questionPausedAt,
    countdownRemaining: state.currentRound?.type === 'countdown' ? state.countdownRemaining : null,
    countdownTotal: state.currentRound?.type === 'countdown' ? (params.totalTime || 30) : null,
    questionAudioUrl:
      !state.answerRevealed &&
      state.currentQuestion?.basePath &&
      state.currentRound?.type !== 'auction'
        ? (() => {
            const qb = (state.currentQuestion.questionBlocks || []).find((b) => b.type === 'audio');
            return qb ? '/' + encodePath(state.currentQuestion.basePath) + '/' + encodeURIComponent(qb.file) : null;
          })()
        : null,
    answerAudioUrl:
      state.answerRevealed && state.currentQuestion?.basePath
        ? (() => {
            const ab = (state.currentQuestion.answerBlocks || []).find((b) => b.type === 'audio');
            return ab ? '/' + encodePath(state.currentQuestion.basePath) + '/' + encodeURIComponent(ab.file) : null;
          })()
        : null,
    bonus: state.bonusActive
      ? {
          active: state.bonusActive,
          stage: state.bonusStage,
          questionIndex: state.bonusQuestionIndex,
          question: state.bonusQuestion,
          questionPhase: state.bonusQuestionPhase,
          eliminatedPlayerIds: Array.from(state.bonusEliminated || []),
          playerChoices: state.bonusPlayerChoices || {},
          playerAnswers: state.bonusPlayerAnswers || {},
          finished: state.bonusFinished,
          timesMs: state.bonusAnswerTimeMs || {},
          // URL аудио вопроса дуэли (для воспроизведения при фазе 'question')
          audioUrl:
            state.bonusQuestionPhase === 'question' &&
            state.bonusQuestion?.basePath &&
            (state.bonusQuestion.questionBlocks || []).some((b) => b.type === 'audio')
              ? (() => {
                  const qb = (state.bonusQuestion.questionBlocks || []).find((b) => b.type === 'audio');
                  return qb ? '/' + encodePath(state.bonusQuestion.basePath) + '/' + encodeURIComponent(qb.file) : null;
                })()
              : null,
        }
      : {
          active: false,
          finished: state.bonusFinished,
          timesMs: state.bonusAnswerTimeMs || {},
        },
  };
}

function emitState(io) {
  io.emit('game:state', getState());
}

function getMinPoints() {
  if (!state.roundData?.questionsMap) return Infinity;
  const available = Object.values(state.roundData.questionsMap).filter((q) => !state.answeredIds.has(q.id));
  if (available.length === 0) return Infinity;
  return Math.min(...available.map((q) => q.points));
}

function getRandomQuestion() {
  const min = getMinPoints();
  if (min === Infinity) return null;
  const available = Object.values(state.roundData.questionsMap).filter(
    (q) => !state.answeredIds.has(q.id) && q.points === min
  );
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function blockPlayer(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (p) p.blocked = true;
}

function unblockAll() {
  state.players.forEach((p) => (p.blocked = false));
}

function addScore(playerId, points) {
  const p = state.players.find((x) => x.id === playerId);
  if (p) p.score += points;
}

function setScore(playerId, score) {
  const p = state.players.find((x) => x.id === playerId);
  if (p && typeof score === 'number') p.score = Math.max(0, score);
}

function selectQuestion(io, data) {
  const { questionId, categoryId, points, random } = data || {};
  let q = null;
  if (random) {
    q = getRandomQuestion();
  } else if (questionId && state.roundData?.questionsMap) {
    q = state.roundData.questionsMap[questionId];
  } else if (categoryId && points != null && state.roundData?.questionsMap) {
    q = Object.values(state.roundData.questionsMap).find(
      (x) => x.categoryId === categoryId && x.points === points && !state.answeredIds.has(x.id)
    );
  }
  if (q && !state.answeredIds.has(q.id)) {
    state.blockedAtQuestionStart = state.players.filter((p) => p.blocked).map((p) => p.id);
    state.questionPausedAt = null;
    state.auctionPlayTotalTime = null;
    state.currentQuestion = q;
    state.answerRevealed = false;
    state.answeredIds.add(q.id);
    // таймер и questionStartTime для обычных раундов теперь запускаются по кнопке ведущего «Слушаем»
    if (state.questionTimer) {
      clearInterval(state.questionTimer);
      state.questionTimer = null;
    }
    state.questionStartTime = state.currentRound?.type === 'auction' ? null : null;
    let audioUrl = null;
    if (state.currentRound?.type !== 'auction') {
      const firstAudio = (q.questionBlocks || []).find((b) => b.type === 'audio');
      audioUrl = firstAudio && q.basePath ? '/' + encodePath(q.basePath) + '/' + encodeURIComponent(firstAudio.file) : null;
    }
    io.emit('game:question-started', { question: q, roundType: state.currentRound?.type, audioUrl });
    emitState(io);
  }
}

function initGameHandlers(io) {
  io.on('connection', (socket) => {
    socket.emit('game:state', getState());

    socket.on('host:start-game', () => {
      state.phase = 'round';
      state.currentRoundIndex = 0;
      state.answeredIds.clear();
      state.lastCorrectPlayerId = null;
      state.players = state.players.filter((p) => p.socketId != null);
      playersByClientId.clear();
      state.players.forEach((p) => {
        if (p.clientId) playersByClientId.set(p.clientId, p);
        p.score = 0;
        p.blocked = false;
      });
      state.roundsConfig = loadRoundsConfig();
      if (!state.roundsConfig?.rounds?.length) {
        state.phase = 'idle';
        emitState(io);
        return;
      }
      startRound(io, 0);
    });

    socket.on('host:start-round', (roundIndex) => {
      if (typeof roundIndex === 'number') {
        state.currentRoundIndex = roundIndex;
        startRound(io, roundIndex);
      }
    });

    socket.on('host:play-audio', ({ url }) => {
      if (!url) return;
      io.emit('game:play-audio', { url });
      // запуск таймера для обычных раундов только при нажатии «Слушаем» на вопросе
      if (state.currentQuestion && !state.answerRevealed && state.currentRound?.type !== 'auction') {
        const q = state.currentQuestion;
        // URL аудио вопроса, как в selectQuestion/getState
        const firstAudio = (q.questionBlocks || []).find((b) => b.type === 'audio');
        const questionUrl =
          firstAudio && q.basePath ? '/' + encodePath(q.basePath) + '/' + encodeURIComponent(firstAudio.file) : null;
        if (questionUrl && questionUrl === url && !state.questionTimer) {
          const params = state.currentRound?.params || {};
          const totalTime = params.totalTime || params.timePerQuestion || 30;
          state.questionStartTime = Date.now();
          if (state.currentRound?.type === 'countdown') {
            let remaining = totalTime;
            state.countdownRemaining = remaining;
            state.questionTimer = setInterval(() => {
              remaining -= 1;
              state.countdownRemaining = remaining;
              io.emit('game:countdown', { remaining, total: totalTime });
              if (remaining <= 0 && state.questionTimer) {
                clearInterval(state.questionTimer);
                state.questionTimer = null;
                state.answerRevealed = true;
                emitState(io);
              }
            }, 1000);
          } else if (state.currentRound?.type === 'fixed') {
            state.questionTimer = setTimeout(() => {
              state.questionTimer = null;
              state.answerRevealed = true;
              emitState(io);
            }, (params.timePerQuestion || 30) * 1000);
          }
          // сразу отдать обновлённое состояние (questionStartTime), чтобы у игроков появилась кнопка «Ответить»
          emitState(io);
        }
      }
    });

    socket.on('host:select-question', (data) => {
      selectQuestion(io, data);
    });

    socket.on('player:select-question', (data) => {
      if (state.phase !== 'round' || state.currentQuestion || state.buzzedPlayerId) return;
      if (state.roundData?.blitz) return;
      const { clientId } = data || {};
      let player = state.players.find((p) => p.socketId === socket.id);
      if (!player && clientId) {
        player = playersByClientId.get(clientId) || state.players.find((p) => p.clientId === clientId);
        if (player) {
          player.socketId = socket.id;
        }
      }
      if (!player) return;
      const playerId = player.id;
      const canSelect = state.lastCorrectPlayerId != null && playerId === state.lastCorrectPlayerId;
      if (!canSelect) return;
      selectQuestion(io, data);
    });

    socket.on('host:set-answering', ({ playerId, duration }) => {
      if (state.currentRound?.type === 'auction' && state.currentQuestion && playerId) {
        state.buzzedPlayerId = playerId;
        const q = state.currentQuestion;
        const qb = (q.questionBlocks || []).find((b) => b.type === 'audio');
        let dur = typeof duration === 'number' ? duration : 0;
        if (!Number.isFinite(dur)) dur = 0;

        if (qb && q.basePath && dur > 0) {
          const url = '/' + encodePath(q.basePath) + '/' + encodeURIComponent(qb.file);
          dur = Math.min(Math.max(dur, 1), 120);
          state.questionStartTime = Date.now();
          state.questionPausedAt = null;
          state.auctionPlayTotalTime = dur;
          emitState(io);
          io.emit('game:play-auction-audio', { url, duration: dur });
        } else {
          // 0 секунд или нет аудио — не запускаем проигрывание
          state.questionStartTime = null;
          state.questionPausedAt = null;
          state.auctionPlayTotalTime = null;
          emitState(io);
        }
      }
      io.emit('game:answering', { playerId });
    });

    socket.on('host:correct', ({ playerId }) => {
      if (!state.currentQuestion) return;
      const params = state.currentRound?.params || {};
      let points = 0;
      if (state.currentRound?.type === 'countdown') {
        const total = params.totalTime || 30;
        const remaining =
          typeof state.countdownRemaining === 'number'
            ? Math.max(0, state.countdownRemaining)
            : Math.max(0, total - (Date.now() - state.questionStartTime) / 1000);
        const maxPoints = state.currentQuestion?.points || (params.pointsPerQuestion || 10);
        const baseMultiplier = params.multiplier || 1;
        const effectiveMultiplier = total > 0 ? (maxPoints * baseMultiplier) / total : baseMultiplier;
        points = Math.round(remaining * effectiveMultiplier);
      } else if (state.currentRound?.type === 'fixed') {
        points = state.currentQuestion?.points || (params.pointsPerQuestion || 10);
      } else if (state.currentRound?.type === 'auction') {
        // В аукционе используем номинал очков из вопроса (например, 1200),
        // чтобы совпадало с сеткой раунда.
        points = state.currentQuestion?.points || 10;
      }
      if (playerId) {
        addScore(playerId, points);
        state.lastCorrectPlayerId = playerId;
      }
      if (state.questionTimer) {
        if (state.currentRound?.type === 'countdown') clearInterval(state.questionTimer);
        else clearTimeout(state.questionTimer);
        state.questionTimer = null;
      }
      state.buzzedPlayerId = null;
      state.questionPausedAt = null;
      state.answerRevealed = true;
      io.emit('game:answer-result', { playerId: playerId || null, correct: true });
      emitState(io);
    });

    socket.on('host:wrong', () => {
      const wrongPlayerId = state.buzzedPlayerId || null;
      if (state.buzzedPlayerId) {
        blockPlayer(state.buzzedPlayerId);
        state.buzzedPlayerId = null;
      }
      if (state.currentRound?.type === 'auction') {
        io.emit('game:answer-result', { playerId: wrongPlayerId, correct: false });
        endQuestion(io, null);
      } else {
        const params = state.currentRound?.params || {};
        const totalTime = params.totalTime || params.timePerQuestion || 30;
        if (state.currentRound?.type === 'countdown' && state.currentQuestion && state.countdownRemaining != null) {
          let currentRemaining = state.countdownRemaining;
          state.questionPausedAt = null;
          state.questionTimer = setInterval(() => {
            currentRemaining -= 1;
            state.countdownRemaining = currentRemaining;
            if (currentRemaining <= 0 && state.questionTimer) {
              clearInterval(state.questionTimer);
              state.questionTimer = null;
              endQuestion(io, null);
              return;
            }
            io.emit('game:countdown', { remaining: currentRemaining, total: totalTime });
          }, 1000);
          io.emit('game:countdown', { remaining: currentRemaining, total: totalTime });
        } else if (state.currentRound?.type === 'fixed' && state.currentQuestion) {
          const pausedAt = state.questionPausedAt || Date.now();
          const elapsedBeforePause = (pausedAt - state.questionStartTime) / 1000;
          const remaining = Math.max(1, totalTime - elapsedBeforePause);
          state.questionStartTime = Date.now() - elapsedBeforePause * 1000;
          state.questionPausedAt = null;
          state.questionTimer = setTimeout(() => {
            state.questionTimer = null;
            state.answerRevealed = true;
            emitState(io);
          }, remaining * 1000);
        } else {
          state.questionPausedAt = null;
        }
        io.emit('game:resume-audio');
        io.emit('game:wrong-answer');
        io.emit('game:answer-result', { playerId: wrongPlayerId, correct: false });
        emitState(io);
      }
    });

    socket.on('host:blitz-winner', ({ playerId }) => {
      const params = state.currentRound?.params || {};
      const points = params.pointsForWinner || 50;
      if (playerId) addScore(playerId, points);
      state.phase = 'round';
      state.currentQuestion = null;
      state.blitzAnswers = {};
      io.emit('game:round-started', { round: state.currentRound, roundData: state.roundData });
      emitState(io);
    });

    socket.on('host:next-round', () => {
      const next = state.currentRoundIndex + 1;
      if (next < (state.roundsConfig?.rounds?.length || 0)) {
        state.currentRoundIndex = next;
        startRound(io, next);
      } else {
        state.phase = 'ended';
        io.emit('game:ended', { players: state.players });
        emitState(io);
      }
    });

    socket.on('host:close-question', () => {
      endQuestion(io, null);
    });

    socket.on('host:set-score', ({ playerId, score }) => {
      if (playerId && typeof score === 'number') {
        setScore(playerId, score);
        emitState(io);
      }
    });

    socket.on('host:restart-game', () => {
      state.phase = 'round';
      state.currentRoundIndex = 0;
      state.answeredIds.clear();
      state.lastCorrectPlayerId = null;
      state.answerRevealed = false;
      state.players = state.players.filter((p) => p.socketId != null);
      playersByClientId.clear();
      state.players.forEach((p) => {
        if (p.clientId) playersByClientId.set(p.clientId, p);
        p.score = 0;
        p.blocked = false;
      });
      state.roundsConfig = loadRoundsConfig();
      if (!state.roundsConfig?.rounds?.length) {
        state.phase = 'idle';
        emitState(io);
        return;
      }
      startRound(io, 0);
    });

    socket.on('host:end-game', () => {
      // Принудительное завершение игры ведущим — обнуляем и обычный раунд, и бонус, если он был активен
      state.phase = 'ended';
      state.currentRound = null;
      state.roundData = null;
      state.currentQuestion = null;
      state.answerRevealed = false;
      state.buzzedPlayerId = null;
      state.questionStartTime = null;
      state.questionPausedAt = null;
      if (state.questionTimer) {
        clearTimeout(state.questionTimer);
        state.questionTimer = null;
      }
      // Останавливаем бонусную игру, если она шла
      state.bonusActive = false;
      state.bonusQuestion = null;
      state.bonusQuestionPhase = null;
      state.bonusQuestions = null;
      state.bonusQuestionIndex = -1;
      // Не ставим bonusFinished = true здесь, чтобы отличать обычный конец игры от финала бонуса
      io.emit('game:ended', { players: state.players });
      emitState(io);
    });

    socket.on('host:start-bonus-game', () => {
      if (!state.roundsConfig) {
        state.roundsConfig = loadRoundsConfig();
      }
      const bonusConfig = state.roundsConfig?.bonusRound;
      if (!bonusConfig || !bonusConfig.folder || !bonusConfig.type) {
        return;
      }
      // сбрасываем очки, но сохраняем список игроков и привязку clientId
      state.players = state.players.filter((p) => p.socketId != null || p.clientId);
      state.players.forEach((p) => {
        p.score = 0;
        p.blocked = false;
      });
      playersByClientId.clear();
      state.players.forEach((p) => {
        if (p.clientId) playersByClientId.set(p.clientId, p);
      });

      const bonusData = loadRoundQuestions(bonusConfig.folder, bonusConfig.type);
      const bonusQuestions = bonusData?.bonus || { stage1Questions: [], stage2Questions: [] };

      state.phase = 'bonus';
      state.bonusActive = true;
      state.bonusFinished = false;
      state.bonusStage = 0;
      state.bonusQuestions = bonusQuestions;
      state.bonusQuestionIndex = -1;
      state.bonusQuestion = null;
      state.bonusPlayerChoices = {};
      state.bonusPlayerAnswers = {};
      state.bonusEliminated = new Set();
      state.bonusQuestionPhase = null;
      state.bonusAnswerTimeMs = {};
      state.bonusQuestionStartTime = null;
      state.currentRound = null;
      state.roundData = null;
      state.currentQuestion = null;
      state.answerRevealed = false;
      state.answeredIds.clear();
      state.buzzedPlayerId = null;
      state.questionStartTime = null;
      state.questionPausedAt = null;
      state.questionTimer = null;
      state.auctionPlayTotalTime = null;

      io.emit('game:bonus-started', { bonus: state.bonusQuestions });
      emitState(io);
    });

    socket.on('host:begin-bonus-questions', () => {
      if (!state.bonusActive || !state.bonusQuestions) return;
      if (state.bonusStage === 0) {
        state.bonusStage = 1;
        state.bonusQuestionIndex = 0;
      }
      startBonusQuestion(io);
    });

    socket.on('host:bonus-next-question', () => {
      if (!state.bonusActive || !state.bonusQuestions) return;
      io.emit('game:stop-audio');
      const alivePlayers = state.players.filter((p) => !state.bonusEliminated?.has(p.id));
      // Условие из правил: игра продолжается, пока не останется один игрок.
      // Но отсев идёт только на 2 этапе, поэтому преждевременно не заканчиваем игру в начале бонуса.
      if (state.bonusStage === 2 && alivePlayers.length <= 1) {
        finishBonusGame(io);
        return;
      }

      const currentStageQuestions =
        state.bonusStage === 1 ? state.bonusQuestions.stage1Questions || [] : state.bonusQuestions.stage2Questions || [];
      if (!currentStageQuestions.length) {
        finishBonusGame(io);
        return;
      }

      state.bonusQuestionIndex += 1;
      if (state.bonusQuestionIndex >= currentStageQuestions.length) {
        if (state.bonusStage === 1 && (state.bonusQuestions.stage2Questions || []).length > 0) {
          state.bonusStage = 2;
          state.bonusQuestionIndex = 0;
        } else {
          finishBonusGame(io);
          return;
        }
      }

      startBonusQuestion(io);
    });

    socket.on('player:bonus-choice', ({ choice }) => {
      if (!state.bonusActive || !state.bonusQuestion || state.bonusQuestionPhase !== 'choices') return;
      if (choice !== 'play' && choice !== 'pass') return;
      const player = state.players.find((p) => p.socketId === socket.id);
      if (!player) return;
      if (state.bonusEliminated?.has(player.id)) return;

      state.bonusPlayerChoices = state.bonusPlayerChoices || {};
      state.bonusPlayerChoices[player.id] = choice;

      const alivePlayers = state.players.filter(
        (p) => p.socketId != null && !state.bonusEliminated?.has(p.id)
      );
      const allChosen = alivePlayers.every((p) => state.bonusPlayerChoices[p.id] === 'play' || state.bonusPlayerChoices[p.id] === 'pass');
      if (allChosen) {
        const anyPlay = alivePlayers.some((p) => state.bonusPlayerChoices[p.id] === 'play');
        // Если все спасовали — вопрос пропускается целиком, сразу переходим к следующему
        if (!anyPlay) {
          const aliveAfterPass = state.players.filter((p) => !state.bonusEliminated?.has(p.id));
          if (state.bonusStage === 2 && aliveAfterPass.length <= 1) {
            finishBonusGame(io);
            return;
          }

          const currentStageQuestions =
            state.bonusStage === 1 ? state.bonusQuestions.stage1Questions || [] : state.bonusQuestions.stage2Questions || [];
          if (!currentStageQuestions.length) {
            finishBonusGame(io);
            return;
          }

          state.bonusQuestionIndex += 1;
          if (state.bonusQuestionIndex >= currentStageQuestions.length) {
            if (state.bonusStage === 1 && (state.bonusQuestions.stage2Questions || []).length > 0) {
              state.bonusStage = 2;
              state.bonusQuestionIndex = 0;
            } else {
              finishBonusGame(io);
              return;
            }
          }

          startBonusQuestion(io);
          return;
        }
        state.bonusQuestionStartTime = Date.now();
        state.bonusQuestionPhase = 'question';
        emitState(io);
        // при открытии вопроса можно сразу начать проигрывание аудио, если есть
        const q = state.bonusQuestion;
        const qb = (q.questionBlocks || []).find((b) => b.type === 'audio');
        if (qb && q.basePath) {
          const url = '/' + encodePath(q.basePath) + '/' + encodeURIComponent(qb.file);
          io.emit('game:play-audio', { url });
        }
      } else {
        emitState(io);
      }
    });

    socket.on('player:bonus-answer', ({ options }) => {
      if (!state.bonusActive || !state.bonusQuestion || state.bonusQuestionPhase !== 'question') return;
      const player = state.players.find((p) => p.socketId === socket.id);
      if (!player) return;
      if (state.bonusEliminated?.has(player.id)) return;
      if (state.bonusPlayerChoices?.[player.id] !== 'play') return;

      const selected = Array.isArray(options) ? options.slice() : [];
      state.bonusPlayerAnswers = state.bonusPlayerAnswers || {};
      const prev = state.bonusPlayerAnswers[player.id] || {};
      // засчитываем время ответа только при первом зафиксированном ответе на этот вопрос
      if (state.bonusQuestionStartTime != null && !Array.isArray(prev.options)) {
        const dt = Math.max(0, Date.now() - state.bonusQuestionStartTime);
        state.bonusAnswerTimeMs = state.bonusAnswerTimeMs || {};
        state.bonusAnswerTimeMs[player.id] = (state.bonusAnswerTimeMs[player.id] || 0) + dt;
      }
      state.bonusPlayerAnswers[player.id] = {
        ...prev,
        options: selected,
      };

      const playersWhoPlay = state.players.filter(
        (p) => p.socketId != null && !state.bonusEliminated?.has(p.id) && state.bonusPlayerChoices?.[p.id] === 'play'
      );
      const allAnswered =
        playersWhoPlay.length === 0 ||
        playersWhoPlay.every((p) => {
          const ans = state.bonusPlayerAnswers?.[p.id];
          return ans && Array.isArray(ans.options);
        });

      if (allAnswered) {
        finishBonusQuestion(io);
      } else {
        emitState(io);
      }
    });

    socket.on('player:request-state', () => {
      socket.emit('game:state', getState());
    });

    socket.on('player:register', ({ name, clientId }) => {
      const cid = clientId || `anon-${socket.id}`;
      let player = playersByClientId.get(cid);
      if (player) {
        player.socketId = socket.id;
        player.name = name || player.name;
      } else {
        player = {
          id: `p${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: name || 'Игрок',
          score: 0,
          blocked: false,
          role: 'player',
          socketId: socket.id,
          clientId: cid,
        };
        state.players.push(player);
        playersByClientId.set(cid, player);
      }
      socket.playerId = player.id;
      socket.emit('player:registered', { playerId: player.id });
      emitState(io);
    });

    socket.on('player:buzz', () => {
      if (state.phase !== 'question' && state.phase !== 'round') return;
      if (!ROUND_TYPES_WITH_BUZZ.includes(state.currentRound?.type)) return;
      const player = state.players.find((p) => p.socketId === socket.id);
      if (!player || player.blocked) return;
      if (state.buzzedPlayerId) return; // уже кто-то нажал
      state.buzzedPlayerId = player.id;
      state.phase = 'question';
      state.questionPausedAt = Date.now();
      if (state.questionTimer) {
        if (state.currentRound?.type === 'countdown') clearInterval(state.questionTimer);
        else clearTimeout(state.questionTimer);
        state.questionTimer = null;
      }
      io.emit('game:buzz', { playerId: player.id, playerName: player.name });
      emitState(io);
    });

    socket.on('disconnect', () => {
      const player = state.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.socketId = null;
      }
      emitState(io);
    });
  });
}

function startRound(io, index) {
  const rounds = state.roundsConfig?.rounds || [];
  const round = rounds[index];
  if (!round) {
    state.phase = 'ended';
    io.emit('game:ended', { players: state.players });
    emitState(io);
    return;
  }
  state.currentRound = round;
  state.roundData = loadRoundQuestions(round.folder, round.type);
  state.currentQuestion = null;
  state.answerRevealed = false;
  state.blockedAtQuestionStart = [];
  state.answeredIds.clear();
  state.lastCorrectPlayerId = null;
  unblockAll();
  state.buzzedPlayerId = null;
  state.questionStartTime = null;
  state.questionPausedAt = null;
  state.auctionPlayTotalTime = null;

  if (round.type === 'blitz' && state.roundData.blitz) {
    state.phase = 'blitz';
    state.blitzAnswers = {};
  } else {
    state.phase = 'round';
  }
  io.emit('game:round-started', { round, roundData: state.roundData });
  emitState(io);
}

function endQuestion(io, correctPlayerId) {
  const questionId = state.currentQuestion?.id ?? null;
  if (state.questionTimer) {
    if (state.currentRound?.type === 'countdown') clearInterval(state.questionTimer);
    else clearTimeout(state.questionTimer);
    state.questionTimer = null;
  }
  /* Игроки, бывшие заблокированными в начале этого вопроса, пропустили его — разблокируем */
  (state.blockedAtQuestionStart || []).forEach((id) => {
    const p = state.players.find((x) => x.id === id);
    if (p) p.blocked = false;
  });
  state.blockedAtQuestionStart = [];
  // Если в обычных раундах никто не угадал (correctPlayerId == null), снимаем блокировку со всех
  if (!correctPlayerId && state.currentRound?.type !== 'auction') {
    unblockAll();
  }
  state.questionPausedAt = null;
  state.phase = 'round';
  state.currentQuestion = null;
  state.answerRevealed = false;
  state.buzzedPlayerId = null;
  state.auctionPlayTotalTime = null;
  state.questionStartTime = null;
  io.emit('game:question-ended', { correctPlayerId, questionId });
  emitState(io);
}

function startBonusQuestion(io) {
  if (!state.bonusActive || !state.bonusQuestions) return;
  const currentStageQuestions =
    state.bonusStage === 1 ? state.bonusQuestions.stage1Questions || [] : state.bonusQuestions.stage2Questions || [];
  if (!currentStageQuestions.length) {
    finishBonusGame(io);
    return;
  }

  const idx = state.bonusQuestionIndex;
  if (idx < 0 || idx >= currentStageQuestions.length) return;

  const q = currentStageQuestions[idx];
  state.bonusQuestion = q;
  state.bonusQuestionPhase = 'choices';
  state.bonusPlayerChoices = {};
  state.bonusPlayerAnswers = {};
  state.bonusQuestionStartTime = null;

  io.emit('game:bonus-question-started', {
    stage: state.bonusStage,
    index: state.bonusQuestionIndex,
    question: q,
  });
  emitState(io);
}

function finishBonusQuestion(io) {
  const q = state.bonusQuestion;
  if (!q) {
    emitState(io);
    return;
  }

  const correctOptions = (q.options || []).filter((o) => o.correct).map((o) => o.id);
  const correctSet = new Set(correctOptions);
  const allowMultiple = !!q.allowMultiple;

  const alivePlayers = state.players.filter((p) => !state.bonusEliminated?.has(p.id));

  for (const p of alivePlayers) {
    const pid = p.id;
    const choice = state.bonusPlayerChoices?.[pid];
    if (choice !== 'play') continue;
    const ans = state.bonusPlayerAnswers?.[pid];
    const selected = Array.isArray(ans?.options) ? ans.options : [];
    let isCorrect = false;
    if (!allowMultiple) {
      isCorrect = selected.length === 1 && correctSet.has(selected[0]);
    } else {
      if (selected.length === correctSet.size) {
        isCorrect = selected.every((id) => correctSet.has(id));
      }
    }

    if (isCorrect) {
      addScore(pid, 1);
    } else {
      if (state.bonusStage === 1) {
        p.score = Math.max(0, p.score - 1);
      } else if (state.bonusStage === 2) {
        addScore(pid, -1);
        if (!state.bonusEliminated) state.bonusEliminated = new Set();
        state.bonusEliminated.add(pid);
      }
    }

    state.bonusPlayerAnswers = state.bonusPlayerAnswers || {};
    state.bonusPlayerAnswers[pid] = {
      ...(state.bonusPlayerAnswers[pid] || {}),
      options: selected,
      correct: isCorrect,
    };
  }

  state.bonusQuestionPhase = 'reveal';
  state.bonusQuestionStartTime = null;
  io.emit('game:stop-audio');
  io.emit('game:bonus-question-finished', {
    stage: state.bonusStage,
    index: state.bonusQuestionIndex,
    questionId: q.id,
  });
  emitState(io);
}

function finishBonusGame(io) {
  state.bonusActive = false;
  state.bonusFinished = true;
  state.phase = 'ended';
  state.bonusQuestion = null;
  state.bonusQuestionPhase = null;
  state.bonusQuestions = null;
  state.bonusQuestionIndex = -1;
  io.emit('game:stop-audio');
  io.emit('game:bonus-ended', { players: state.players });
  emitState(io);
}

module.exports = { initGameHandlers, getState };
