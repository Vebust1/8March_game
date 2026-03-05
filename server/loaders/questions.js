const fs = require('fs');
const path = require('path');

const QUESTIONS_PATH = path.join(__dirname, '../../questions');
const BLITZ_PATH = path.join(__dirname, '../../questions-blitz');

function loadCategory(roundPath, categoryId) {
  const categoryPath = path.join(roundPath, categoryId);
  if (!fs.existsSync(categoryPath) || !fs.statSync(categoryPath).isDirectory()) {
    return null;
  }
  const metaPath = path.join(categoryPath, 'meta.json');
  let meta = { id: categoryId, title: categoryId, order: 0 };
  if (fs.existsSync(metaPath)) {
    try {
      meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
    } catch (e) {
      console.warn('Ошибка чтения meta категории:', metaPath, e.message);
    }
  }
  const items = fs.readdirSync(categoryPath).filter((n) => {
    const full = path.join(categoryPath, n);
    return fs.statSync(full).isDirectory() && n.startsWith('q-');
  });
  const questions = items
    .map((qId) => loadQuestion(categoryPath, qId, meta.id))
    .filter(Boolean)
    .sort((a, b) => a.points - b.points);
  return { ...meta, questions };
}

function loadQuestion(categoryPath, qId, categoryId) {
  const qPath = path.join(categoryPath, qId);
  const metaPath = path.join(qPath, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const id = meta.id || `${categoryId}-${qId}`;
    return { ...meta, id, categoryId, folder: qId };
  } catch (e) {
    console.warn('Ошибка чтения вопроса:', metaPath, e.message);
    return null;
  }
}

function loadRoundQuestions(roundFolder, roundType) {
  const roundPath = path.join(QUESTIONS_PATH, roundFolder);
  if (!fs.existsSync(roundPath)) {
    return { categories: [], questionsMap: {} };
  }

  if (roundType === 'blitz') {
    return loadBlitzRound(roundFolder);
  }

  if (roundType === 'bonus-duel') {
    return loadBonusDuelRound(roundFolder);
  }

  const dirs = fs.readdirSync(roundPath).filter((n) => {
    const full = path.join(roundPath, n);
    return fs.statSync(full).isDirectory() && n !== 'meta.json';
  });

  const categories = [];
  const questionsMap = {};

  for (const catId of dirs) {
    if (catId === 'meta.json') continue;
    const cat = loadCategory(roundPath, catId);
    if (cat && cat.questions.length > 0) {
      categories.push({ id: cat.id, title: cat.title, order: cat.order });
      for (const q of cat.questions) {
        questionsMap[q.id] = { ...q, categoryId: cat.id, basePath: `questions/${roundFolder}/${cat.id}/${q.folder}` };
      }
    }
  }

  categories.sort((a, b) => (a.order || 0) - (b.order || 0));
  return { categories, questionsMap };
}

function loadBonusDuelRound(roundFolder) {
  const roundPath = path.join(QUESTIONS_PATH, roundFolder);
  if (!fs.existsSync(roundPath)) {
    return { bonus: { stage1Questions: [], stage2Questions: [] } };
  }

  const dirs = fs
    .readdirSync(roundPath)
    .filter((n) => {
      const full = path.join(roundPath, n);
      return fs.statSync(full).isDirectory() && n.startsWith('q-');
    })
    .sort();

  const questions = [];

  for (const qId of dirs) {
    const qPath = path.join(roundPath, qId);
    const metaPath = path.join(qPath, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const id = meta.id || `bonus-${qId}`;
      questions.push({
        ...meta,
        id,
        folder: qId,
        basePath: `questions/${roundFolder}/${qId}`,
      });
    } catch (e) {
      console.warn('Ошибка чтения бонус-вопроса:', metaPath, e.message);
    }
  }

  // сортировка по order, затем по id
  questions.sort((a, b) => {
    const ao = a.order || 0;
    const bo = b.order || 0;
    if (ao !== bo) return ao - bo;
    return String(a.id).localeCompare(String(b.id), 'ru');
  });

  const total = questions.length;
  const half = Math.ceil(total / 2);
  const stage1Questions = questions.slice(0, half);
  const stage2Questions = questions.slice(half);

  return {
    bonus: {
      stage1Questions,
      stage2Questions,
    },
  };
}

function loadBlitzRound(blitzFolder) {
  const blitzRoundPath = path.join(BLITZ_PATH, blitzFolder);
  const metaPath = path.join(blitzRoundPath, 'meta.json');
  if (!fs.existsSync(metaPath)) return { categories: [], questionsMap: {}, blitz: null };

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const tracks = (meta.tracks || []).map((t, i) => ({
      ...t,
      id: `blitz-${i}`,
      index: i,
      basePath: `questions-blitz/${blitzFolder}/tracks`,
    }));
    return {
      categories: [],
      questionsMap: {},
      blitz: { id: meta.id, tracks, pointsForWinner: meta.pointsForWinner || 50 },
    };
  } catch (e) {
    console.warn('Ошибка чтения блица:', metaPath, e.message);
    return { categories: [], questionsMap: {}, blitz: null };
  }
}

function getQuestionUrl(basePath, file) {
  if (!file) return null;
  return `/${basePath}/${file}`;
}

module.exports = {
  loadRoundQuestions,
  loadRoundsConfig: require('./rounds').loadRoundsConfig,
  getQuestionUrl,
};
