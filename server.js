'use strict';

/**
 * Eşimi Tanıyorum — oyun sunucusu
 * İki telefon aynı Wi-Fi'deyken bu sunucu üzerinden gerçek zamanlı oynar.
 */

const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { TRUE_FALSE, TEAM_QUESTIONS } = require('./game-data');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || undefined;

const QUESTIONS_PER_PLAYER = 5;
const GUESS_SECONDS = 45;
const HANGMAN_SECONDS = 60;
const HANGMAN_LIVES = 6;
const HANGMAN_LETTER_POINTS = 5;
const HANGMAN_FINISH_BONUS = 10;
const QUIZ_SECONDS = 15;
const QUIZ_QUESTIONS = 10;
const QUIZ_CORRECT = 10;
const QUIZ_SPEED_BONUS = 2;
const TEAM_SECONDS = 45;
const TEAM_REVEAL_MS = 12000;
const TEAM_QUESTIONS_PER_ROUND = 10;
const TEAM_MATCH_POINTS = 10;
const REVEAL_MS = 25000;
const ROOM_TTL = 1000 * 60 * 60 * 6; // 6 saat

/* ------------------------------------------------------------------ */
/*  Sunucu                                                             */
/* ------------------------------------------------------------------ */

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/saglik', (_req, res) => {
  res.json({ ok: true, oda: rooms.size, zaman: Date.now() });
});

app.get('/bilgi', (req, res) => {
  res.json({ port: PORT, url: baseUrlFor(req), adresler: lanAddresses() });
});

app.get('/qr.svg', async (req, res) => {
  const roomCode = String(req.query.oda || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const base = baseUrlFor(req);
  const team = Number(req.query.takim) || 0;
  const target = roomCode
    ? `${base}/?oda=${roomCode}${team >= 1 && team <= 9 ? `&takim=${team}` : ''}`
    : base;
  try {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark: '#170a26', light: '#ffffff' },
    });
    res
      .type('image/svg+xml')
      .set('Cache-Control', 'public, max-age=300')
      .send(svg);
  } catch (_error) {
    res.status(500).type('text/plain').send('QR kod oluşturulamadı');
  }
});

function baseUrlFor(req) {
  const host = String(req.headers.host || '');
  const hostname = host.split(':')[0];
  const isLocal =
    !hostname ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';
  if (!isLocal) return `${req.protocol}://${host}`;
  const ip = lanAddresses()[0];
  return `http://${ip || 'localhost'}:${PORT}`;
}

const rooms = new Map();

/* ------------------------------------------------------------------ */
/*  Yardımcılar                                                        */
/* ------------------------------------------------------------------ */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () =>
      CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(raw) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (name.length < 2) return null;
  return name.slice(0, 16);
}

function cleanText(raw, max) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Türkçe karakterleri sadeleştirip karşılaştırma için normalize eder. */
function norm(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Cevap puanlaması: 10 tam isabet, 8 kapsama, 6 yakın, 0 ıska. */
function evaluate(truth, guess) {
  const t = norm(truth);
  const g = norm(guess);
  if (!t || !g) return { points: 0, match: 'wrong' };
  if (t === g) return { points: 10, match: 'exact' };

  const shorter = t.length <= g.length ? t : g;
  const longer = t.length <= g.length ? g : t;
  if (shorter.length >= 3 && longer.includes(shorter)) {
    return { points: 8, match: 'close' };
  }

  const wordsT = t.split(' ').filter((w) => w.length >= 3);
  const wordsG = g.split(' ').filter((w) => w.length >= 3);
  if (wordsT.some((w) => wordsG.includes(w))) {
    return { points: 6, match: 'close' };
  }

  const distance = levenshtein(t, g);
  if (distance / Math.max(t.length, g.length) <= 0.3) {
    return { points: 6, match: 'close' };
  }
  return { points: 0, match: 'wrong' };
}

/* ---------------- Adam asmaca yardımcıları ---------------- */

const LETTER_RE = /[A-ZÇĞİÖŞÜ]/;

function questionSeconds(mode) {
  if (mode === 'hangman') return HANGMAN_SECONDS;
  if (mode === 'truefalse') return TRUEFALSE_SECONDS;
  return GUESS_SECONDS;
}

function answerLetters(answer) {
  return Array.from(String(answer || '').toLocaleUpperCase('tr-TR')).filter((ch) =>
    LETTER_RE.test(ch)
  );
}

/** Cevabı maskeye çevirir: açılmamış harf '', boşluk ' ', diğerleri olduğu gibi. */
function buildHangmanMask(answer, revealed) {
  const open = revealed instanceof Set ? revealed : new Set(revealed || []);
  return Array.from(String(answer || '').toLocaleUpperCase('tr-TR')).map((ch) => {
    if (ch === ' ') return ' ';
    if (LETTER_RE.test(ch)) return open.has(ch) ? ch : '';
    return ch;
  });
}

function hangmanSolved(answer, revealed) {
  const letters = answerLetters(answer);
  return letters.length > 0 && letters.every((ch) => revealed.has(ch));
}

function hangmanGuessText(answer, revealed) {
  return buildHangmanMask(answer, revealed)
    .map((ch) => (ch === '' ? '_' : ch === ' ' ? '/' : ch))
    .join(' ');
}

/** Doğru/Yanlış modu için iddia üretir. Yarısı doğru, yarısı yanlış cevaplı. */
function buildClaim(room, ownerIndex, question) {
  const owner = room.players[ownerIndex];
  const rival = room.players[1 - ownerIndex];
  const truth = String(question.answer);
  const truthKey = norm(truth);
  const questionKey = norm(question.text);

  if (Math.random() < 0.5) {
    return { shown: truth, isTrue: true };
  }

  const candidates = [];
  const add = (answer, weight) => {
    const value = String(answer || '').trim();
    if (value && norm(value) !== truthKey) candidates.push({ value, weight });
  };

  for (const q of rival.questions) {
    add(q.answer, norm(q.text) === questionKey ? 0 : 1);
  }
  for (const q of owner.questions) {
    if (q !== question) add(q.answer, 2);
  }
  for (const fallback of [
    'Mavi',
    'Kebap',
    'Futbol',
    'Kedi',
    'Deniz',
    'Pizza',
    'Yeşil',
    'Köpek',
    'Çay',
    'Dağ',
    'Sinema',
    'Yaz',
  ]) {
    add(fallback, 3);
  }

  if (!candidates.length) return { shown: 'Bilmiyorum', isTrue: false };
  const bestWeight = Math.min(...candidates.map((c) => c.weight));
  const pool = candidates.filter((c) => c.weight === bestWeight);
  return {
    shown: pool[Math.floor(Math.random() * pool.length)].value,
    isTrue: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Oda / oyuncu                                                       */
/* ------------------------------------------------------------------ */

function createRoom(mode, options) {
  const teamCount =
    mode === 'team' ? (options && Number(options.teams) === 3 ? 3 : 2) : 0;
  return {
    code: makeCode(),
    mode: ['text', 'hangman', 'truefalse', 'team'].includes(mode) ? mode : 'text',
    teamCount,
    hostId: null,
    teamScores: {},
    teamGame: null,
    teamTimer: null,
    teamRevealTimer: null,
    createdAt: Date.now(),
    phase: 'lobby',
    round: 1,
    players: [],
    roundQuestions: [],
    game: { step: 0, deadline: 0, current: null },
    history: [],
    hangman: null,
    quiz: null,
    quizTimer: null,
    quizRevealTimer: null,
    guessTimer: null,
    revealTimer: null,
  };
}

function makePlayer(name, index) {
  return {
    id: crypto.randomUUID(),
    name,
    index,
    socketId: null,
    connected: false,
    voice: false,
    team: null,
    seat: null,
    questions: [],
    ready: false,
    readyNext: false,
    totalScore: 0,
    roundScore: 0,
    totalCorrect: 0,
  };
}

function other(room, index) {
  return room.players[1 - index] || null;
}

function clearTimers(room) {
  if (room.guessTimer) clearTimeout(room.guessTimer);
  if (room.revealTimer) clearTimeout(room.revealTimer);
  if (room.hangman && room.hangman.endTimer) clearTimeout(room.hangman.endTimer);
  if (room.quizTimer) clearTimeout(room.quizTimer);
  if (room.quizRevealTimer) clearTimeout(room.quizRevealTimer);
  if (room.teamTimer) clearTimeout(room.teamTimer);
  if (room.teamRevealTimer) clearTimeout(room.teamRevealTimer);
  room.guessTimer = null;
  room.revealTimer = null;
  room.quizTimer = null;
  room.quizRevealTimer = null;
  room.teamTimer = null;
  room.teamRevealTimer = null;
  if (room.hangman) room.hangman.endTimer = null;
}

function playerPayload(p) {
  return {
    id: p.id,
    name: p.name,
    connected: p.connected,
    voice: Boolean(p.voice),
    team: p.team,
    seat: p.seat,
    ready: p.ready,
    readyNext: p.readyNext,
    score: p.totalScore,
    roundScore: p.roundScore,
    correct: p.totalCorrect,
    questionCount: p.questions.length,
  };
}

function buildResults(room) {
  const entries = room.history;
  const players = room.players.map((p, i) => {
    const mine = entries.filter((e) => e.guesser === i);
    const correct = mine.filter((e) => e.points >= 6).length;
    return {
      name: p.name,
      score: p.totalScore,
      correct,
      total: mine.length,
      percent: mine.length ? Math.round((correct / mine.length) * 100) : 0,
    };
  });
  const best = Math.max(0, ...players.map((p) => p.score));
  const winners = players.filter((p) => p.score === best && p.score > 0).map((p) => p.name);
  return {
    players,
    entries,
    roundEntries: entries.filter((e) => e.round === room.round),
    winners,
    tie: winners.length !== 1,
  };
}

function buildStandaloneResults(room) {
  const entries = room.history;
  const total = entries.length;
  const players = room.players.map((p) => ({
    name: p.name,
    score: p.totalScore,
    correct: p.totalCorrect,
    total,
    percent: total ? Math.round((p.totalCorrect / total) * 100) : 0,
  }));
  const best = Math.max(0, ...players.map((p) => p.score));
  const winners = players.filter((p) => p.score === best && p.score > 0).map((p) => p.name);
  return {
    players,
    entries,
    roundEntries: entries.filter((e) => e.round === room.round),
    winners,
    tie: winners.length !== 1,
    mode: room.mode,
  };
}

function buildTeamResults(room) {
  const teams = [];
  for (let t = 1; t <= room.teamCount; t++) {
    const members = room.players.filter((p) => p.team === t);
    if (!members.length) continue;
    teams.push({
      index: t,
      name: members.map((m) => m.name).join(' & '),
      members: members.map((m) => m.name),
      score: room.teamScores && room.teamScores[t] ? room.teamScores[t] : 0,
    });
  }
  const best = Math.max(0, ...teams.map((t) => t.score));
  const winners = teams.filter((t) => t.score === best && t.score > 0).map((t) => t.name);
  return {
    teams,
    entries: room.history,
    roundEntries: room.history.filter((e) => e.round === room.round),
    winners,
    tie: winners.length !== 1,
    mode: 'team',
  };
}

function teamStateFor(room, index, state, me) {
  const teams = [];
  for (let t = 1; t <= room.teamCount; t++) {
    const members = room.players
      .filter((p) => p.team === t)
      .sort((a, b) => (a.seat || 0) - (b.seat || 0));
    teams.push({
      index: t,
      name: members.length ? members.map((m) => m.name).join(' & ') : `Çift ${t}`,
      shortName: `Çift ${t}`,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        connected: m.connected,
        isMe: m.id === me.id,
      })),
      complete: members.length === 2,
      score: room.teamScores && room.teamScores[t] ? room.teamScores[t] : 0,
      isMine: members.some((m) => m.id === me.id),
    });
  }

  state.teams = teams;
  state.teamCount = room.teamCount;
  state.isHost = room.hostId === me.id;
  state.me.team = me.team;
  state.me.seat = me.seat;
  state.teamIds = room.teamGame ? room.teamGame.teamIds : [];

  const occupied = teams.filter((t) => t.members.length > 0);
  const completeTeams = teams.filter((t) => t.complete);
  state.canStart =
    room.phase === 'lobby' &&
    state.isHost &&
    completeTeams.length >= 2 &&
    occupied.every((t) => t.complete);

  const g = room.teamGame;
  if (g && (room.phase === 'teamPlay' || room.phase === 'teamReveal')) {
    const question = g.questions[g.step];
    const partner = room.players.find((p) => p.team === me.team && p.id !== me.id);
    const answers = g.answers || {};
    const activePlayers = room.players.filter((p) => g.teamIds.includes(p.team));
    state.teamQuestion = {
      number: g.step + 1,
      total: g.questions.length,
      text: question.text,
      category: question.category,
      deadline: g.deadline,
      myAnswer: answers[me.id] != null ? answers[me.id] : null,
      partnerName: partner ? partner.name : '',
      partnerAnswered: partner ? answers[partner.id] != null : false,
      answeredCount: activePlayers.filter((p) => answers[p.id] != null).length,
      playerCount: activePlayers.length,
      revealed: Boolean(g.revealed),
      results: g.revealed ? g.results : undefined,
      paused: !me.connected || activePlayers.some((p) => !p.connected),
    };
  }

  if (room.phase === 'teamRoundEnd' || room.phase === 'final') {
    state.results = buildTeamResults(room);
  }

  return state;
}

function stateFor(room, index) {
  const me = room.players[index];
  if (!me) return null;
  const rival = other(room, index);

  const state = {
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    round: room.round,
    serverTime: Date.now(),
    guessSeconds:
      room.mode === 'truefalse'
        ? QUIZ_SECONDS
        : room.game.current && room.game.current.seconds
          ? room.game.current.seconds
          : GUESS_SECONDS,
    me: {
      id: me.id,
      index,
      name: me.name,
      ready: me.ready,
      readyNext: me.readyNext,
    },
    players: room.players.map((p) => ({ ...playerPayload(p), isMe: p.index === index })),
    rivalName: rival ? rival.name : '',
  };

  if (room.mode === 'team') {
    return teamStateFor(room, index, state, me);
  }

  if (room.mode === 'text' && (room.phase === 'play' || room.phase === 'reveal')) {
    const entry = room.game.current;
    if (entry) {
      state.question = {
        text: entry.question.text,
        category: entry.question.category,
        mode: 'text',
        owner: entry.owner,
        ownerName: room.players[entry.owner].name,
        guesserName: room.players[1 - entry.owner].name,
        isMine: entry.owner === index,
        number: room.game.step + 1,
        total: room.roundQuestions.length,
        deadline: room.game.deadline,
        paused: !me.connected || !(rival && rival.connected),
      };
      if (room.phase === 'reveal') {
        state.question.answer = entry.question.answer;
        state.question.guess = entry.guess;
        state.question.points = entry.points;
        state.question.match = entry.match;
        state.question.timedOut = entry.timedOut;
        state.readyNext = me.readyNext;
        state.otherReadyNext = rival ? rival.readyNext : false;
      }
    }
  }

  if (room.mode === 'hangman' && room.hangman) {
    const h = room.hangman;
    const asker = h.asker;
    const guesser = asker != null ? 1 - asker : null;
    const base = {
      round: room.round,
      step: h.step || 0,
      number: (h.step || 0) + 1,
      total: 2,
      asker,
      askerName:
        asker != null && room.players[asker] ? room.players[asker].name : '',
      guesser,
      guesserName:
        guesser != null && room.players[guesser] ? room.players[guesser].name : '',
      isMyAsk: asker === index,
      isMyGuess: guesser === index,
      roundScores: room.players.map((p) => p.roundScore),
      paused: !me.connected || !(rival && rival.connected),
    };

    if (room.phase === 'ask') {
      state.hangman = { ...base, phase: 'ask' };
    } else if (room.phase === 'guess' && h.question) {
      state.hangman = {
        ...base,
        phase: 'guess',
        question: h.question.text,
        mask: buildHangmanMask(h.question.answer, h.revealed),
        wrong: h.wrong.slice(),
        lives: HANGMAN_LIVES - h.wrong.length,
        length: answerLetters(h.question.answer).length,
      };
    } else if (room.phase === 'reveal' && h.question) {
      state.hangman = {
        ...base,
        phase: 'reveal',
        question: h.question.text,
        answer: h.question.answer,
        mask: buildHangmanMask(h.question.answer, h.revealed),
        wrong: h.wrong.slice(),
        lives: HANGMAN_LIVES - h.wrong.length,
        points: h.points,
        solved: Boolean(h.solved),
        failed: Boolean(h.failed),
        readyNext: me.readyNext,
        otherReadyNext: rival ? rival.readyNext : false,
      };
    } else {
      state.hangman = { ...base, phase: room.phase };
    }
  }

  if (room.mode === 'truefalse' && room.quiz && room.quiz.statements.length) {
    const qz = room.quiz;
    const statement = qz.statements[qz.step] || qz.statements[qz.statements.length - 1];
    const myAnswer = qz.answers ? qz.answers[index] : null;
    const rivalAnswer = qz.answers ? qz.answers[1 - index] : null;
    state.quiz = {
      round: room.round,
      number: Math.min(qz.step + 1, qz.statements.length),
      total: qz.statements.length,
      statement: statement ? statement.text : '',
      category: statement ? statement.category : '',
      deadline: qz.deadline,
      myAnswer,
      otherAnswered: rivalAnswer !== null,
      revealed: Boolean(qz.revealed),
      truth: qz.revealed && statement ? statement.answer : undefined,
      result: qz.revealed && qz.lastResult ? qz.lastResult : undefined,
      paused: !me.connected || !(rival && rival.connected),
    };
  }

  if (room.phase === 'setup' && me.ready) {
    state.myQuestions = me.questions.map((q) => ({
      text: q.text,
      answer: q.answer,
    }));
  }

  if (room.phase === 'roundEnd' || room.phase === 'final') {
    state.results =
      room.mode === 'text' ? buildResults(room) : buildStandaloneResults(room);
    state.readyNext = me.readyNext;
    state.otherReadyNext = rival ? rival.readyNext : false;
  }

  return state;
}

function broadcast(room) {
  room.players.forEach((p, i) => {
    if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, i));
  });
}

function sendError(socket, code, message) {
  socket.emit('error_msg', { code, message });
}

/* ------------------------------------------------------------------ */
/*  Oyun akışı                                                         */
/* ------------------------------------------------------------------ */

function startRound(room) {
  clearTimers(room);
  room.phase = 'play';
  room.game = { step: 0, deadline: 0, current: null };
  room.players.forEach((p) => {
    p.roundScore = 0;
    p.readyNext = false;
  });

  // Sorular sırayla karışır: A1, B1, A2, B2 ...
  const list = [];
  for (let i = 0; i < QUESTIONS_PER_PLAYER; i++) {
    for (let owner = 0; owner < 2; owner++) {
      const q = room.players[owner].questions[i];
      if (q) list.push({ owner, qIndex: i });
    }
  }
  room.roundQuestions = list;
  startStep(room);
}

function startStep(room) {
  const item = room.roundQuestions[room.game.step];
  if (!item) return endRound(room);

  room.phase = 'play';
  room.players.forEach((p) => (p.readyNext = false));
  const question = room.players[item.owner].questions[item.qIndex];
  const seconds = questionSeconds(room.mode);
  const claim =
    room.mode === 'truefalse' ? buildClaim(room, item.owner, question) : null;
  room.game.current = {
    owner: item.owner,
    guesser: 1 - item.owner,
    question,
    claim,
    guess: '',
    points: 0,
    match: null,
    timedOut: false,
    seconds,
    revealed: new Set(),
    wrongLetters: [],
    solved: false,
  };
  room.game.deadline = Date.now() + seconds * 1000;

  clearTimers(room);
  room.guessTimer = setTimeout(() => handleTimeout(room), seconds * 1000 + 400);
  broadcast(room);
}

function finalizeGuess(room, guessText, timedOut, override) {
  const current = room.game.current;
  if (!current) return;
  const guess = cleanText(guessText, 60);
  const result = override || evaluate(current.question.answer, guess);

  current.guess = guess;
  current.points = result.points;
  current.match = result.match;
  current.timedOut = Boolean(timedOut) && !guess;

  const guesser = room.players[current.guesser];
  const owner = room.players[current.owner];
  guesser.roundScore += result.points;
  guesser.totalScore += result.points;
  if (result.points >= 6) guesser.totalCorrect += 1;

  room.history.push({
    round: room.round,
    index: room.game.step + 1,
    owner: current.owner,
    guesser: current.guesser,
    ownerName: owner.name,
    guesserName: guesser.name,
    question: current.question.text,
    category: current.question.category,
    mode: room.mode,
    wrongCount: (current.wrongLetters || []).length,
    claimShown: current.claim ? current.claim.shown : '',
    claimTrue: current.claim ? current.claim.isTrue : null,
    answer: current.question.answer,
    guess: current.guess,
    points: result.points,
    match: result.match,
    timedOut: current.timedOut,
  });

  room.phase = 'reveal';
  room.players.forEach((p) => (p.readyNext = false));
  clearTimers(room);
  room.revealTimer = setTimeout(() => advance(room), REVEAL_MS);
  broadcast(room);
}

function handleTimeout(room) {
  if (room.phase !== 'play' || !room.game.current) return;
  room.guessTimer = null;
  finalizeGuess(room, '', true);
}

function advance(room) {
  if (room.phase !== 'reveal') return;
  clearTimers(room);
  room.game.step += 1;
  if (room.game.step >= room.roundQuestions.length) {
    endRound(room);
  } else {
    startStep(room);
  }
}

function endRound(room) {
  clearTimers(room);
  room.phase = 'roundEnd';
  room.players.forEach((p) => (p.readyNext = false));
  broadcast(room);
}

function resetToSetup(room) {
  clearTimers(room);
  room.phase = 'setup';
  room.game = { step: 0, deadline: 0, current: null };
  room.roundQuestions = [];
  room.players.forEach((p) => {
    p.questions = [];
    p.ready = false;
    p.readyNext = false;
  });
  broadcast(room);
}

function finishGame(room) {
  clearTimers(room);
  room.phase = 'final';
  room.players.forEach((p) => (p.readyNext = false));
  broadcast(room);
}

/* ------------------------------------------------------------------ */
/*  Bağımsız modlar: Adam Asmaca & Doğru/Yanlış                        */
/* ------------------------------------------------------------------ */

function resetPlayersForGame(room) {
  room.players.forEach((p) => {
    p.totalScore = 0;
    p.roundScore = 0;
    p.totalCorrect = 0;
    p.readyNext = false;
  });
}

function startHangmanGame(room) {
  clearTimers(room);
  room.round = 1;
  room.history = [];
  resetPlayersForGame(room);
  room.hangman = { step: 0 };
  startHangmanAsk(room);
}

function startHangmanAsk(room) {
  clearTimers(room);
  room.phase = 'ask';
  const h = room.hangman;
  h.step = Math.min(h.step || 0, 1);
  h.asker = (room.round - 1 + h.step) % 2;
  h.question = null;
  h.answer = null;
  h.revealed = new Set();
  h.wrong = [];
  h.solved = false;
  h.failed = false;
  h.finisher = null;
  h.points = 0;
  if (h.step === 0) {
    room.players.forEach((p) => {
      p.roundScore = 0;
    });
  }
  room.players.forEach((p) => (p.readyNext = false));
  broadcast(room);
}

function finishHangmanQuestion(room) {
  const h = room.hangman;
  const guesser = 1 - h.asker;
  room.history.push({
    round: room.round,
    step: h.step,
    index: h.step + 1,
    asker: h.asker,
    guesser,
    askerName: room.players[h.asker].name,
    guesserName: room.players[guesser].name,
    question: h.question.text,
    answer: h.question.answer,
    points: h.points,
    solved: Boolean(h.solved),
    failed: Boolean(h.failed),
    wrongCount: h.wrong.length,
    finisher: h.finisher,
  });
  room.phase = 'reveal';
  room.players.forEach((p) => (p.readyNext = false));
  clearTimers(room);
  room.revealTimer = setTimeout(() => advanceHangmanStep(room), 30000);
  broadcast(room);
}

function advanceHangmanStep(room) {
  if (room.mode !== 'hangman' || room.phase !== 'reveal') return;
  clearTimers(room);
  const h = room.hangman;
  h.step += 1;
  if (h.step >= 2) {
    room.phase = 'roundEnd';
    room.players.forEach((p) => (p.readyNext = false));
    broadcast(room);
  } else {
    startHangmanAsk(room);
  }
}

function pickQuizStatements(room, count) {
  if (!room.quiz) room.quiz = { used: new Set() };
  let pool = TRUE_FALSE.filter((s) => !room.quiz.used.has(s.text));
  if (pool.length < count) {
    room.quiz.used.clear();
    pool = TRUE_FALSE.slice();
  }
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosen = shuffled.slice(0, count);
  chosen.forEach((s) => room.quiz.used.add(s.text));
  return chosen;
}

function startQuizGame(room) {
  clearTimers(room);
  room.round = 1;
  room.history = [];
  resetPlayersForGame(room);
  room.quiz = { used: new Set(), lastResult: null };
  startQuizRound(room);
}

function startQuizRound(room) {
  clearTimers(room);
  room.phase = 'play';
  room.players.forEach((p) => {
    p.roundScore = 0;
    p.readyNext = false;
  });
  room.quiz.statements = pickQuizStatements(room, QUIZ_QUESTIONS);
  room.quiz.step = 0;
  room.quiz.lastResult = null;
  startQuizStatement(room);
}

function startQuizStatement(room) {
  clearTimers(room);
  room.phase = 'play';
  const q = room.quiz;
  q.answers = [null, null];
  q.answeredAt = [null, null];
  q.revealed = false;
  q.deadline = Date.now() + QUIZ_SECONDS * 1000;
  room.players.forEach((p) => (p.readyNext = false));
  room.quizTimer = setTimeout(() => revealQuizStatement(room), QUIZ_SECONDS * 1000 + 300);
  broadcast(room);
}

function revealQuizStatement(room) {
  if (room.mode !== 'truefalse' || room.phase !== 'play' || !room.quiz || room.quiz.revealed) {
    return;
  }
  const q = room.quiz;
  const statement = q.statements[q.step];
  if (!statement) return;

  q.revealed = true;
  clearTimers(room);

  const points = [0, 0];
  let firstCorrect = null;
  for (let i = 0; i < 2; i++) {
    if (q.answers[i] === statement.answer) {
      points[i] = QUIZ_CORRECT;
      const at = q.answeredAt[i] || Infinity;
      const best = firstCorrect === null ? Infinity : q.answeredAt[firstCorrect] || Infinity;
      if (firstCorrect === null || at < best) firstCorrect = i;
    }
  }
  if (firstCorrect !== null) {
    const otherIndex = 1 - firstCorrect;
    if (q.answers[otherIndex] === statement.answer) {
      points[firstCorrect] += QUIZ_SPEED_BONUS;
    }
  }

  room.players.forEach((p, i) => {
    p.roundScore += points[i];
    p.totalScore += points[i];
    if (q.answers[i] === statement.answer) p.totalCorrect += 1;
  });

  q.lastResult = {
    truth: statement.answer,
    answers: q.answers.slice(),
    points: points.slice(),
    firstCorrect,
  };
  room.history.push({
    round: room.round,
    index: q.step + 1,
    statement: statement.text,
    category: statement.category,
    truth: statement.answer,
    answers: q.answers.slice(),
    points: points.slice(),
  });

  room.phase = 'reveal';
  room.players.forEach((p) => (p.readyNext = false));
  room.quizRevealTimer = setTimeout(() => nextQuizStatement(room), 20000);
  broadcast(room);
}

function nextQuizStatement(room) {
  if (room.mode !== 'truefalse' || room.phase !== 'reveal' || !room.quiz) return;
  clearTimers(room);
  room.quiz.step += 1;
  if (room.quiz.step >= room.quiz.statements.length) {
    room.phase = 'roundEnd';
    room.players.forEach((p) => (p.readyNext = false));
    broadcast(room);
  } else {
    startQuizStatement(room);
  }
}

/* ------------------------------------------------------------------ */
/*  Takım modu: Çiftler Kapışması                                      */
/* ------------------------------------------------------------------ */

function pickTeamQuestions(room, count) {
  const used = room.teamGame.used;
  let pool = TEAM_QUESTIONS.filter((q) => !used.has(q.text));
  if (pool.length < count) {
    used.clear();
    pool = TEAM_QUESTIONS.slice();
  }
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const chosen = shuffled.slice(0, count);
  chosen.forEach((q) => used.add(q.text));
  return chosen;
}

function startTeamGame(room) {
  clearTimers(room);
  const teams = [...new Set(room.players.map((p) => p.team))]
    .filter((t) => room.players.filter((p) => p.team === t).length === 2)
    .sort((a, b) => a - b);
  if (teams.length < 2) return false;

  room.phase = 'teamPlay';
  room.round = 1;
  room.history = [];
  room.teamScores = {};
  room.players.forEach((p) => {
    p.totalScore = 0;
    p.roundScore = 0;
    p.readyNext = false;
  });
  room.teamGame = {
    teamIds: teams,
    used: new Set(),
    step: 0,
    questions: [],
    answers: {},
    revealed: false,
    results: null,
    deadline: 0,
  };
  room.teamGame.questions = pickTeamQuestions(room, TEAM_QUESTIONS_PER_ROUND);
  startTeamQuestion(room);
  return true;
}

function startTeamQuestion(room) {
  clearTimers(room);
  const g = room.teamGame;
  const question = g.questions[g.step];
  if (!question) {
    room.phase = 'teamRoundEnd';
    broadcast(room);
    return;
  }
  g.answers = {};
  g.revealed = false;
  g.results = null;
  g.deadline = Date.now() + TEAM_SECONDS * 1000;
  room.phase = 'teamPlay';
  room.players.forEach((p) => (p.readyNext = false));
  room.teamTimer = setTimeout(
    () => revealTeamQuestion(room),
    TEAM_SECONDS * 1000 + 300
  );
  broadcast(room);
}

function revealTeamQuestion(room) {
  if (room.mode !== 'team' || room.phase !== 'teamPlay' || !room.teamGame) return;
  const g = room.teamGame;
  if (g.revealed) return;
  const question = g.questions[g.step];
  if (!question) return;

  g.revealed = true;
  clearTimers(room);

  g.results = g.teamIds.map((teamId) => {
    const members = room.players
      .filter((p) => p.team === teamId)
      .sort((a, b) => (a.seat || 0) - (b.seat || 0));
    const firstId = members[0] ? members[0].id : null;
    const secondId = members[1] ? members[1].id : null;
    const answerA = (firstId && g.answers[firstId]) || '';
    const answerB = (secondId && g.answers[secondId]) || '';
    const matched = Boolean(answerA && answerB && evaluate(answerA, answerB).points >= 6);
    const points = matched ? TEAM_MATCH_POINTS : 0;
    room.teamScores[teamId] = (room.teamScores[teamId] || 0) + points;
    return {
      team: teamId,
      name: members.map((m) => m.name).join(' & '),
      names: members.map((m) => m.name),
      answers: [answerA, answerB],
      matched,
      points,
    };
  });

  room.history.push({
    round: room.round,
    index: g.step + 1,
    question: question.text,
    category: question.category,
    results: g.results,
  });

  room.phase = 'teamReveal';
  room.teamRevealTimer = setTimeout(() => nextTeamQuestion(room), TEAM_REVEAL_MS);
  broadcast(room);
}

function nextTeamQuestion(room) {
  if (room.mode !== 'team' || room.phase !== 'teamReveal' || !room.teamGame) return;
  clearTimers(room);
  const g = room.teamGame;
  g.step += 1;
  if (g.step >= g.questions.length) {
    room.phase = 'teamRoundEnd';
    broadcast(room);
  } else {
    startTeamQuestion(room);
  }
}

/* ------------------------------------------------------------------ */
/*  Socket olayları                                                    */
/* ------------------------------------------------------------------ */

function roomOf(socket) {
  return rooms.get(socket.data.code) || null;
}

function meOf(room, socket) {
  if (!room) return null;
  return room.players.find((p) => p.id === socket.data.playerId) || null;
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name, mode, teams } = {}) => {
    const clean = cleanName(name);
    if (!clean) return sendError(socket, 'bad_name', 'En az 2 karakterlik bir takma ad yaz.');
    if (!socket.connected) return;

    const room = createRoom(mode, { teams });
    const player = makePlayer(clean, 0);
    if (room.mode === 'team') {
      player.team = 1;
      player.seat = 0;
      room.hostId = player.id;
    }
    player.socketId = socket.id;
    player.connected = true;
    room.players.push(player);
    rooms.set(room.code, room);

    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);

    socket.emit('joined', { code: room.code, playerId: player.id, index: 0 });
    broadcast(room);
  });

  socket.on('join_room', ({ name, code, team } = {}) => {
    const clean = cleanName(name);
    if (!clean) return sendError(socket, 'bad_name', 'En az 2 karakterlik bir takma ad yaz.');
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return sendError(socket, 'bad_room', 'Oda bulunamadı. Kodu kontrol et.');
    if (room.phase !== 'lobby') {
      return sendError(socket, 'bad_room', 'Bu odada oyun başlamış. Yeni bir oda kur.');
    }

    if (room.mode === 'team') {
      const requested = Number(team) || 0;
      let target = 0;
      if (requested >= 1 && requested <= room.teamCount) target = requested;
      else {
        for (let t = 1; t <= room.teamCount; t++) {
          if (room.players.filter((p) => p.team === t).length < 2) {
            target = t;
            break;
          }
        }
      }
      if (!target) {
        return sendError(socket, 'room_full', 'Bu oda dolu. Yeni bir oda kur.');
      }
      const members = room.players.filter((p) => p.team === target);
      if (members.length >= 2) {
        return sendError(socket, 'team_full', 'Bu çift dolu. Başka bir davet bağlantısı kullan.');
      }

      const player = makePlayer(clean, room.players.length);
      player.team = target;
      player.seat = members.length;
      player.socketId = socket.id;
      player.connected = true;
      room.players.push(player);

      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);

      socket.emit('joined', {
        code: room.code,
        playerId: player.id,
        index: player.index,
      });
      broadcast(room);
      socket.to(room.code).emit('toast', {
        text: `${clean} ${target}. çifte katıldı 💞`,
      });
      return;
    }

    if (room.players.length >= 2) {
      return sendError(socket, 'room_full', 'Bu oda dolu. Yeni bir oda kur.');
    }

    const player = makePlayer(clean, 1);
    player.socketId = socket.id;
    player.connected = true;
    room.players.push(player);

    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);

    if (room.mode === 'text') resetToSetup(room);
    else if (room.mode === 'hangman') startHangmanGame(room);
    else startQuizGame(room);

    socket.emit('joined', { code: room.code, playerId: player.id, index: 1 });
    io.to(room.code).emit('toast', {
      text: `${clean} odaya katıldı 💞`,
    });
  });

  socket.on('reconnect_room', ({ code, playerId } = {}) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return sendError(socket, 'bad_session', 'Oda kapanmış. Yeni bir oyun kur.');
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return sendError(socket, 'bad_session', 'Bu odada yerin bulunamadı.');

    if (player.socketId && player.socketId !== socket.id) {
      io.to(player.socketId).emit('session_replaced');
    }

    player.socketId = socket.id;
    player.connected = true;
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);

    // Oyun sırasında kopmuşsa süreleri tazele
    if (room.mode === 'text' && room.phase === 'play' && room.game.current) {
      const seconds = questionSeconds(room.mode);
      room.game.deadline = Date.now() + seconds * 1000;
      if (room.guessTimer) clearTimeout(room.guessTimer);
      room.guessTimer = setTimeout(() => handleTimeout(room), seconds * 1000 + 400);
    }
    if (room.mode === 'text' && room.phase === 'reveal') {
      if (room.revealTimer) clearTimeout(room.revealTimer);
      room.revealTimer = setTimeout(() => advance(room), REVEAL_MS);
    }
    if (room.mode === 'truefalse' && room.phase === 'play' && room.quiz && !room.quiz.revealed) {
      room.quiz.deadline = Date.now() + QUIZ_SECONDS * 1000;
      if (room.quizTimer) clearTimeout(room.quizTimer);
      room.quizTimer = setTimeout(() => revealQuizStatement(room), QUIZ_SECONDS * 1000 + 300);
    }
    if (room.mode === 'truefalse' && room.phase === 'reveal') {
      if (room.quizRevealTimer) clearTimeout(room.quizRevealTimer);
      room.quizRevealTimer = setTimeout(() => nextQuizStatement(room), 20000);
    }
    if (room.mode === 'team' && room.phase === 'teamPlay' && room.teamGame) {
      room.teamGame.deadline = Date.now() + TEAM_SECONDS * 1000;
      if (room.teamTimer) clearTimeout(room.teamTimer);
      room.teamTimer = setTimeout(
        () => revealTeamQuestion(room),
        TEAM_SECONDS * 1000 + 300
      );
    }
    if (room.mode === 'team' && room.phase === 'teamReveal') {
      if (room.teamRevealTimer) clearTimeout(room.teamRevealTimer);
      room.teamRevealTimer = setTimeout(() => nextTeamQuestion(room), TEAM_REVEAL_MS);
    }

    socket.emit('joined', { code: room.code, playerId: player.id, index: player.index });
    broadcast(room);
    socket.to(room.code).emit('toast', { text: `${player.name} geri döndü ✨` });
  });

  socket.on('submit_questions', ({ questions } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return sendError(socket, 'no_room', 'Önce bir odaya gir.');
    if (room.phase !== 'setup') return;
    if (room.mode !== 'text') return;
    if (me.ready) return;

    if (!Array.isArray(questions) || questions.length !== QUESTIONS_PER_PLAYER) {
      return sendError(socket, 'bad_questions', `Tam ${QUESTIONS_PER_PLAYER} soru gerekiyor.`);
    }

    const prepared = [];
    for (const item of questions) {
      const text = cleanText(item && item.text, 120);
      const answer = cleanText(item && item.answer, 60);
      const category = cleanText(item && item.category, 24) || 'genel';
      if (text.length < 3) return sendError(socket, 'bad_questions', 'Sorulardan biri çok kısa.');
      if (answer.length < 1) return sendError(socket, 'bad_questions', 'Her sorunun bir cevabı olmalı.');
      prepared.push({ text, answer, category, id: crypto.randomUUID() });
    }

    me.questions = prepared;
    me.ready = true;
    socket.to(room.code).emit('toast', { text: `${me.name} sorularını hazırladı ✅` });
    broadcast(room);

    if (room.players.length === 2 && room.players.every((p) => p.ready && p.questions.length === QUESTIONS_PER_PLAYER)) {
      setTimeout(() => {
        if (room.phase === 'setup' && rooms.get(room.code) === room) startRound(room);
      }, 900);
    }
  });

  socket.on('guess', ({ answer } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.phase !== 'play' || !room.game.current) return;
    if (room.game.current.guesser !== me.index) return;
    if (room.mode !== 'text') return;
    finalizeGuess(room, answer, false);
  });

  socket.on('hangman_ask', ({ text, answer } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'hangman' || room.phase !== 'ask') return;
    const h = room.hangman;
    if (!h || h.asker !== me.index) return;

    const question = cleanText(text, 120);
    const truth = cleanText(answer, 60);
    if (question.length < 3) {
      return sendError(socket, 'bad_question', 'Önce sorunu yaz.');
    }
    const letterCount = truth.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length;
    if (letterCount < 2 || letterCount > 16) {
      return sendError(socket, 'bad_answer', 'Cevap 2-16 harf arasında olmalı.');
    }

    h.question = { text: question, answer: truth, asker: me.index };
    h.answer = truth;
    h.revealed = new Set();
    h.wrong = [];
    h.solved = false;
    h.failed = false;
    h.finisher = null;
    h.points = 0;
    room.phase = 'guess';
    room.players.forEach((p) => (p.readyNext = false));
    broadcast(room);
  });

  socket.on('hangman_letter', ({ letter } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'hangman' || room.phase !== 'guess') return;
    const h = room.hangman;
    if (!h || !h.question || h.solved || h.failed) return;
    if (me.index !== 1 - h.asker) return;

    const clean = String(letter || '')
      .trim()
      .toLocaleUpperCase('tr-TR');
    if (!/^[A-ZÇĞİÖŞÜ]$/.test(clean)) return;
    if (h.revealed.has(clean) || h.wrong.includes(clean)) return;

    const answer = String(h.question.answer).toLocaleUpperCase('tr-TR');
    if (answer.includes(clean)) {
      h.revealed.add(clean);
      me.roundScore += HANGMAN_LETTER_POINTS;
      me.totalScore += HANGMAN_LETTER_POINTS;
      h.points += HANGMAN_LETTER_POINTS;
      if (hangmanSolved(h.question.answer, h.revealed)) {
        h.solved = true;
        h.finisher = me.index;
        me.roundScore += HANGMAN_FINISH_BONUS;
        me.totalScore += HANGMAN_FINISH_BONUS;
        h.points += HANGMAN_FINISH_BONUS;
        me.totalCorrect += 1;
        finishHangmanQuestion(room);
        return;
      }
    } else {
      h.wrong.push(clean);
      if (h.wrong.length >= HANGMAN_LIVES) {
        h.failed = true;
        finishHangmanQuestion(room);
        return;
      }
    }

    broadcast(room);
  });

  socket.on('quiz_answer', ({ value } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'truefalse' || room.phase !== 'play') return;
    const q = room.quiz;
    if (!q || q.revealed) return;
    if (q.answers[me.index] !== null) return;

    q.answers[me.index] = value === true || value === 'true';
    q.answeredAt[me.index] = Date.now();
    if (q.answers.every((a) => a !== null)) {
      revealQuizStatement(room);
    } else {
      broadcast(room);
    }
  });

  socket.on('typing', ({ active } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    const rival = other(room, me.index);
    if (rival && rival.socketId) {
      io.to(rival.socketId).emit('partner_typing', { active: Boolean(active) });
    }
  });

  socket.on('voice_join', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    me.voice = true;
    broadcast(room);
    socket.to(room.code).emit('toast', { text: `${me.name} sesli sohbete katıldı 🎙️` });
  });

  socket.on('voice_leave', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    me.voice = false;
    broadcast(room);
    socket.to(room.code).emit('toast', { text: `${me.name} sesli sohbetten ayrıldı` });
  });

  socket.on('voice_signal', ({ sdp, candidate } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    const rival = other(room, me.index);
    if (!rival || !rival.socketId) return;
    io.to(rival.socketId).emit('voice_signal', {
      sdp: sdp || null,
      candidate: candidate || null,
      from: me.index,
    });
  });

  socket.on('team_start', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'team' || room.phase !== 'lobby') return;
    if (room.hostId !== me.id) {
      return sendError(socket, 'not_host', 'Oyunu sadece oda sahibi başlatabilir.');
    }
    const occupiedTeams = [...new Set(room.players.map((p) => p.team))];
    const complete = occupiedTeams.filter(
      (t) => room.players.filter((p) => p.team === t).length === 2
    );
    const incomplete = occupiedTeams.some(
      (t) => room.players.filter((p) => p.team === t).length !== 2
    );
    if (incomplete) {
      return sendError(socket, 'teams_incomplete', 'Her çiftin iki oyuncusu olmalı.');
    }
    if (complete.length < 2) {
      return sendError(socket, 'teams_missing', 'En az 2 çift gerekli.');
    }
    startTeamGame(room);
  });

  socket.on('team_answer', ({ answer } = {}) => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'team' || room.phase !== 'teamPlay') return;
    const g = room.teamGame;
    if (!g || !g.teamIds.includes(me.team)) return;
    if (g.answers[me.id] != null) return;

    const value = cleanText(answer, 60);
    if (value.length < 1) {
      return sendError(socket, 'bad_answer', 'Cevabını yaz.');
    }
    g.answers[me.id] = value;

    const activePlayers = room.players.filter((p) => g.teamIds.includes(p.team));
    if (activePlayers.every((p) => g.answers[p.id] != null)) {
      revealTeamQuestion(room);
    } else {
      broadcast(room);
    }
  });

  socket.on('team_continue', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'team' || room.phase !== 'teamReveal') return;
    const g = room.teamGame;
    if (!g || !g.teamIds.includes(me.team)) return;
    nextTeamQuestion(room);
  });

  socket.on('team_next_round', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'team' || room.phase !== 'teamRoundEnd') return;
    if (room.hostId !== me.id) {
      return sendError(socket, 'not_host', 'Yeni turu sadece oda sahibi başlatabilir.');
    }
    const g = room.teamGame;
    if (!g) return;
    room.round += 1;
    g.step = 0;
    g.questions = pickTeamQuestions(room, TEAM_QUESTIONS_PER_ROUND);
    startTeamQuestion(room);
  });

  socket.on('team_end', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'team') return;
    if (room.hostId !== me.id) {
      return sendError(socket, 'not_host', 'Oyunu sadece oda sahibi bitirebilir.');
    }
    if (!['teamPlay', 'teamReveal', 'teamRoundEnd'].includes(room.phase)) return;
    finishGame(room);
  });

  socket.on('team_play_again', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.mode !== 'team' || room.phase !== 'final') return;
    if (room.hostId !== me.id) {
      return sendError(socket, 'not_host', 'Yeniden oyunu sadece oda sahibi başlatabilir.');
    }
    startTeamGame(room);
  });

  socket.on('ready_next', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.phase !== 'reveal') return;
    me.readyNext = true;
    const rival = other(room, me.index);

    if (room.mode === 'hangman') {
      if (room.phase !== 'reveal') return;
      me.readyNext = true;
      if (rival && rival.readyNext) {
        advanceHangmanStep(room);
      } else {
        broadcast(room);
      }
      return;
    }
    if (room.mode === 'truefalse') {
      if (rival && rival.readyNext) {
        nextQuizStatement(room);
      } else {
        broadcast(room);
      }
      return;
    }

    if (rival && rival.readyNext) {
      broadcast(room);
      advance(room);
    } else {
      broadcast(room);
    }
  });

  socket.on('next_round', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.phase !== 'roundEnd') return;
    me.readyNext = true;
    const rival = other(room, me.index);
    if (rival && rival.readyNext) {
      room.round += 1;
      if (room.mode === 'text') resetToSetup(room);
      else if (room.mode === 'hangman') {
        room.hangman.step = 0;
        startHangmanAsk(room);
      } else startQuizRound(room);
    } else {
      broadcast(room);
    }
  });

  socket.on('end_game', () => {
    const room = roomOf(socket);
    if (!room) return;
    if (
      room.phase !== 'roundEnd' &&
      room.phase !== 'play' &&
      room.phase !== 'reveal' &&
      room.phase !== 'ask' &&
      room.phase !== 'guess'
    ) {
      return;
    }
    finishGame(room);
  });

  socket.on('play_again', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (room.phase !== 'final') return;
    me.readyNext = true;
    const rival = other(room, me.index);
    if (rival && rival.readyNext) {
      room.round = 1;
      room.history = [];
      if (room.mode === 'text') {
        room.players.forEach((p) => {
          p.totalScore = 0;
          p.roundScore = 0;
          p.totalCorrect = 0;
          p.readyNext = false;
        });
        resetToSetup(room);
      } else if (room.mode === 'hangman') {
        startHangmanGame(room);
      } else {
        startQuizGame(room);
      }
    } else {
      broadcast(room);
    }
  });

  socket.on('leave_room', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) {
      socket.data.code = null;
      socket.data.playerId = null;
      return;
    }
    socket.to(room.code).emit('toast', { text: `${me.name} odadan ayrıldı` });
    socket.leave(room.code);
    socket.data.code = null;
    socket.data.playerId = null;

    if (room.mode === 'team') {
      room.players = room.players.filter((p) => p.id !== me.id);
      clearTimers(room);
      room.teamGame = null;
      room.teamScores = {};
      room.history = [];
      room.round = 1;
      if (!room.players.length) {
        rooms.delete(room.code);
        return;
      }
      if (room.hostId === me.id) room.hostId = room.players[0].id;
      room.players.forEach((p, i) => (p.index = i));
      room.phase = 'lobby';
      broadcast(room);
      return;
    }

    room.players = room.players.filter((p) => p.id !== me.id);
    room.players.forEach((p, i) => (p.index = i));
    clearTimers(room);
    room.hangman = null;
    room.quiz = null;
    room.quizTimer = null;
    room.quizRevealTimer = null;
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    room.phase = 'lobby';
    room.round = 1;
    room.history = [];
    room.game = { step: 0, deadline: 0, current: null };
    room.roundQuestions = [];
    room.players.forEach((p) => {
      p.questions = [];
      p.ready = false;
      p.readyNext = false;
      p.totalScore = 0;
      p.roundScore = 0;
      p.totalCorrect = 0;
      p.voice = false;
    });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    const me = meOf(room, socket);
    if (!room || !me) return;
    if (me.socketId !== socket.id) return;

    me.connected = false;
    me.socketId = null;
    me.voice = false;

    if (room.phase === 'play' && room.guessTimer) {
      clearTimeout(room.guessTimer);
      room.guessTimer = null;
    }
    if (room.phase === 'reveal' && room.revealTimer) {
      clearTimeout(room.revealTimer);
      room.revealTimer = null;
    }
    if (room.mode === 'truefalse' && room.phase === 'play' && room.quizTimer) {
      clearTimeout(room.quizTimer);
      room.quizTimer = null;
    }
    if (room.mode === 'truefalse' && room.phase === 'reveal' && room.quizRevealTimer) {
      clearTimeout(room.quizRevealTimer);
      room.quizRevealTimer = null;
    }
    broadcast(room);
    socket.to(room.code).emit('toast', { text: `${me.name} bağlantısı koptu` });
  });
});

/* ------------------------------------------------------------------ */
/*  Temizlik                                                           */
/* ------------------------------------------------------------------ */

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty = room.players.every((p) => !p.connected);
    if (now - room.createdAt > ROOM_TTL || (empty && now - room.createdAt > 1000 * 60 * 60)) {
      clearTimers(room);
      rooms.delete(code);
    }
  }
}, 1000 * 60 * 10).unref();

/* ------------------------------------------------------------------ */
/*  Başlat                                                             */
/* ------------------------------------------------------------------ */

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  const score = (ip) => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };
  return out.sort((a, b) => score(a) - score(b));
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  Port ${PORT} zaten kullaniliyor.`);
    console.error(`  Uygulama zaten acik olabilir: http://localhost:${PORT}`);
    console.error(`  Baska bir port icin:  set PORT=5000 && npm start`);
    console.error('');
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  const addresses = lanAddresses();
  console.log('');
  console.log('  Esimi Taniyorum calisiyor');
  console.log('  -----------------------------------------');
  console.log(`  Bu bilgisayarda : http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`  Telefonlarda    : http://${address}:${PORT}`);
  }
  console.log('  -----------------------------------------');
  console.log('  Telefonlar ayni Wi-Fi aginda olmali.');
  console.log('  Baglanti sorunu olursa Windows guvenlik');
  console.log('  duvarinda Node.js icin ozel ag iznini acin.');
  console.log('');
});
