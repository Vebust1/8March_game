const fs = require('fs');
const path = require('path');

const QUESTIONS_PATH = path.join(__dirname, '../../questions');
const ROUNDS_CONFIG = path.join(QUESTIONS_PATH, 'rounds.config.json');

function loadRoundsConfig() {
  try {
    const data = fs.readFileSync(ROUNDS_CONFIG, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.warn('rounds.config.json не найден или некорректен:', e.message);
    return { rounds: [] };
  }
}

function getRoundConfig(roundId) {
  const config = loadRoundsConfig();
  return config.rounds.find((r) => r.id === roundId) || null;
}

module.exports = {
  loadRoundsConfig,
  getRoundConfig,
};
