const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3002;

// Статика
app.use(express.static(path.join(__dirname, '../public')));

// Маршрутизация страниц
app.get('/', (req, res) => {
  res.redirect('/host');
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/guest', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API для загрузки конфигурации и вопросов
const { loadRoundsConfig } = require('./loaders/rounds');
const { loadRoundQuestions } = require('./loaders/questions');

app.get('/api/config', (req, res) => {
  const config = loadRoundsConfig();
  const playerBaseUrl = process.env.PLAYER_BASE_URL || `http://192.168.5.166:${PORT}`;
  res.json({ ...config, playerBaseUrl });
});

app.get('/api/round/:roundId', (req, res) => {
  const { loadRoundsConfig } = require('./loaders/rounds');
  const config = loadRoundsConfig();
  const round = config.rounds?.find((r) => r.id === req.params.roundId);
  if (!round) return res.status(404).json({ error: 'Раунд не найден' });
  const data = loadRoundQuestions(round.folder, round.type);
  res.json({ ...round, ...data });
});

// API для статических файлов вопросов (аудио, видео)
app.use('/questions', express.static(path.join(__dirname, '../questions')));
app.use('/questions-blitz', express.static(path.join(__dirname, '../questions-blitz')));

// Socket.io
const io = new Server(server);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Подключение игровой логики (будет добавлено в game-state.js)
const { initGameHandlers } = require('./game-state');
initGameHandlers(io);

server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
