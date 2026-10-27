'use strict';

/* ==================================================================
   Eşimi Tanıyorum — istemci mantığı
   ================================================================== */

const socket = io({
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
});

const SESSION_KEY = 'esimi.session';
const NAME_KEY = 'esimi.name';
const GUIDE_KEY = 'esimi.guide.v1';
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/*  Soru bankası                                                       */
/* ------------------------------------------------------------------ */

const BANK = window.SORU_BANKASI;

const ALL_QUESTIONS = BANK.flatMap((c) => c.questions.map((q) => ({ q, category: c.id })));

const HANGMAN_ALPHABET = [
  'A', 'B', 'C', 'Ç', 'D', 'E', 'F', 'G', 'Ğ', 'H', 'I', 'İ', 'J', 'K', 'L', 'M',
  'N', 'O', 'Ö', 'P', 'Q', 'R', 'S', 'Ş', 'T', 'U', 'Ü', 'V', 'W', 'X', 'Y', 'Z',
];

const MODES = {
  text: {
    emoji: '⌨️',
    label: 'Soru-Cevap',
    desc: 'Klasik mod: cevabı yazarak tahmin et.',
  },
  hangman: {
    emoji: '🔤',
    label: 'Adam Asmaca',
    desc: 'Sistem kelime verir; sırayla harf seçin. 6 ortak can.',
  },
  truefalse: {
    emoji: '✅',
    label: 'Doğru mu Yanlış mı?',
    desc: 'Sistem ifade sorar; ikiniz de doğru/yanlış diyin.',
  },
};

const modeOf = (id) => MODES[id] || MODES.text;

/** "Karışık" sanal kategorisi: öneriler 203 sorunun tamamından gelir. */
const MIXED = { id: 'karisik', label: 'Karışık', emoji: '🎲', questions: [] };
const CATEGORIES = [MIXED, ...BANK];

const catById = (id) => CATEGORIES.find((c) => c.id === id) || BANK[0];

const questionPool = (categoryId) =>
  categoryId === 'karisik' ? ALL_QUESTIONS.map((x) => x.q) : catById(categoryId).questions;

const normText = (value) =>
  String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/â/g, 'a')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ */
/*  Yardımcılar                                                        */
/* ------------------------------------------------------------------ */

const randomInt = (n) => Math.floor(Math.random() * n);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initial(name) {
  return (name || '?').trim().charAt(0).toLocaleUpperCase('tr-TR');
}

/** Türkçe isim tamlaması: Ayşe'nin, Ahmet'in, Onur'un */
function genitive(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  const lower = clean.toLocaleLowerCase('tr-TR');
  const vowels = 'aeıioöuüâîû';
  let lastVowel = '';
  for (const ch of lower) {
    if (vowels.includes(ch)) lastVowel = ch;
  }
  const map = {
    a: 'ın',
    ı: 'ın',
    o: 'un',
    u: 'un',
    e: 'in',
    i: 'in',
    ö: 'ün',
    ü: 'ün',
    â: 'ın',
    î: 'in',
    û: 'un',
  };
  const base = map[lastVowel] || 'in';
  const endsWithVowel = vowels.includes(lower[lower.length - 1]);
  return `${clean}'${endsWithVowel ? 'n' + base : base}`;
}

/** Bulunma hâli: Ayşe'de, Ahmet'te, Onur'da */
function locative(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  const lower = clean.toLocaleLowerCase('tr-TR');
  const vowels = 'aeıioöuüâîû';
  let lastVowel = '';
  for (const ch of lower) {
    if (vowels.includes(ch)) lastVowel = ch;
  }
  const hard = 'pçtkfhsş'.includes(lower[lower.length - 1]);
  const wide = ['a', 'ı', 'o', 'u', 'â', 'û'].includes(lastVowel);
  return `${clean}'${hard ? 't' : 'd'}${wide ? 'a' : 'e'}`;
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveSession(code, id) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, id }));
  } catch {
    /* yoksay */
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* yoksay */
  }
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ */
/*  Uygulama durumu                                                    */
/* ------------------------------------------------------------------ */

const app = {
  state: null,
  setup: null,
  setupKey: '',
  playKey: '',
  submitting: false,
  partnerTyping: false,
  skew: 0,
  lastGuessSentAt: 0,
  usedQuestions: new Set(),
  listCategory: 'karisik',
  prevState: null,
  transitionTimer: null,
  homeMode: 'text',
};

let currentScreen = 'home';

function showScreen(name) {
  if (currentScreen === name) return;
  currentScreen = name;
  document.querySelectorAll('.screen').forEach((section) => {
    section.classList.toggle('active', section.id === 'screen-' + name);
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function goHome() {
  app.state = null;
  app.setup = null;
  app.setupKey = '';
  app.playKey = '';
  app.submitting = false;
  app.usedQuestions = new Set();
  app.prevState = null;
  clearTimeout(app.transitionTimer);
  $('transition').hidden = true;
  $('pausedOverlay').hidden = true;
  $('listModal').hidden = true;
  showScreen('home');
  if (location.search) {
    history.replaceState(null, '', location.pathname);
  }
}

/* ------------------------------------------------------------------ */
/*  Socket olayları                                                    */
/* ------------------------------------------------------------------ */

socket.on('connect', () => {
  $('netBanner').hidden = true;
  const session = readSession();
  if (session && session.code && session.id) {
    socket.emit('reconnect_room', { code: session.code, playerId: session.id });
  }
});

socket.on('disconnect', () => {
  $('netBanner').hidden = false;
});

socket.on('connect_error', () => {
  $('netBanner').hidden = false;
});

socket.on('joined', ({ code, playerId }) => {
  saveSession(code, playerId);
});

socket.on('state', (state) => {
  if (state && typeof state.serverTime === 'number') {
    app.skew = state.serverTime - Date.now();
  }
  app.prevState = app.state;
  app.state = state;
  saveSession(state.code, state.me.id);
  route();
});

socket.on('toast', ({ text }) => {
  if (text) toast(text);
});

socket.on('partner_typing', ({ active }) => {
  app.partnerTyping = Boolean(active);
  updateTypingIndicator();
});

socket.on('session_replaced', () => {
  clearSession();
  toast('Bu oda başka bir cihazda açıldı.');
  goHome();
});

socket.on('error_msg', ({ code, message }) => {
  toast(message || 'Bir şeyler ters gitti.');
  if (code === 'bad_session') {
    clearSession();
    goHome();
  }
});

/* ------------------------------------------------------------------ */
/*  Yönlendirme                                                        */
/* ------------------------------------------------------------------ */

function route() {
  const s = app.state;
  if (!s) return;

  if (s.mode !== 'text' || !['play', 'setup'].includes(s.phase)) {
    $('transition').hidden = true;
  }

  if (s.phase === 'lobby') {
    showScreen('lobby');
    renderLobby();
  } else if (s.mode === 'hangman') {
    routeHangman(s);
  } else if (s.mode === 'truefalse') {
    routeQuiz(s);
  } else if (s.phase === 'setup') {
    showScreen('setup');
    renderSetup();
    maybeShowIntro(s);
  } else if (s.phase === 'play') {
    showScreen('play');
    renderPlay();
  } else if (s.phase === 'reveal') {
    showScreen('play');
    renderReveal();
  } else if (s.phase === 'roundEnd') {
    showScreen('roundEnd');
    renderRoundEnd();
  } else if (s.phase === 'final') {
    showScreen('final');
    renderFinal();
  }

  const rival = (s.players || []).find((p) => !p.isMe);
  const paused =
    (s.phase === 'play' || s.phase === 'reveal') && rival && !rival.connected;
  $('pausedOverlay').hidden = !paused;
  if (paused) {
    $('pausedText').textContent = `${rival.name} bağlantısı bekleniyor…`;
  }
}

/* ------------------------------------------------------------------ */
/*  Bağımsız modlar: Adam Asmaca                                       */
/* ------------------------------------------------------------------ */

function routeHangman(s) {
  if (!s.hangman) return;
  if (s.phase === 'final') {
    showScreen('final');
    renderStandaloneFinal(s);
    return;
  }
  if (s.phase === 'roundEnd') {
    showScreen('roundEnd');
    renderHangmanRoundEnd(s);
    return;
  }
  showScreen('play');
  renderHangmanPlay(s);
}

function hangmanMaskHtml(mask) {
  return `<div class="hm-board">${mask
    .map((ch) => {
      if (ch === ' ') return '<span class="hm-gap"></span>';
      return `<span class="hm-cell ${ch ? 'open' : ''}">${ch ? esc(ch) : ''}</span>`;
    })
    .join('')}</div>`;
}

function hangmanKeyboardHtml(h, enabled) {
  const used = new Set([
    ...h.mask.filter((ch) => ch && ch !== ' '),
    ...h.wrong,
  ]);
  return `<div class="hm-keyboard">${HANGMAN_ALPHABET.map((letter) => {
    const isUsed = used.has(letter);
    return `<button type="button" class="hm-key ${isUsed ? 'used' : ''}"
      data-action="hangmanLetter" data-letter="${letter}"
      ${!enabled || isUsed ? 'disabled' : ''}>${letter}</button>`;
  }).join('')}</div>`;
}

function renderHangmanPlay(s) {
  const h = s.hangman;
  $('playTitle').textContent = 'Adam Asmaca';
  $('playCounter').textContent = `Kelime ${s.round}`;

  const banner = h.solved
    ? `<div class="turn-banner go">🎉 <b>Kelime tamamlandı!</b> Sonuçlar geliyor…</div>`
    : h.failed
      ? `<div class="turn-banner wait">💔 <b>6 yanlış!</b> Kelimeyi bilemediniz.</div>`
      : h.isMyTurn
        ? `<div class="turn-banner go">🎯 <b>Sıra sende!</b> Bir harf seç.</div>`
        : `<div class="turn-banner wait">⏳ <b>Sıra ${esc(h.turnName)}'de.</b> Harf seçmesini bekle.</div>`;

  const wrong = h.wrong.length
    ? `<div class="hm-wrong">Yanlış harfler: ${h.wrong.map((l) => esc(l)).join(' ')}</div>`
    : '';

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    ${banner}
    <div class="card question-card">
      <div class="q-owner">🔤 ${esc(h.hint)} · ${h.length} harf</div>
      ${hangmanMaskHtml(h.mask)}
      <div class="hm-lives">${hangmanHearts(h.lives)}<span>${h.lives} can</span></div>
      ${wrong}
    </div>
    <div class="card guess-box">
      <div class="guess-label">${
        h.isMyTurn && !h.solved && !h.failed ? 'Bir harf seç' : 'Klavye'
      }</div>
      ${hangmanKeyboardHtml(h, h.isMyTurn && !h.solved && !h.failed)}
    </div>
  `;
}

function renderHangmanRoundEnd(s) {
  const h = s.hangman;
  const r = s.results;
  $('roundTitle').textContent = `Kelime ${s.round}`;

  const playersWithRound = r.players.map((p, i) => ({
    ...p,
    round: s.players[i] ? s.players[i].roundScore : 0,
  }));
  const finisher =
    h.finisher != null && s.players[h.finisher] ? s.players[h.finisher].name : '';

  const readyBtn = s.readyNext
    ? `<button class="btn btn-primary" disabled>Eşin bekleniyor…</button>`
    : `<button class="btn btn-primary" data-action="nextRound">Sonraki kelime →</button>`;

  $('roundBody').innerHTML = `
    <div class="card winner-card">
      <span class="trophy">${h.solved ? '🎉' : '💔'}</span>
      <h2>${h.solved ? 'Kelime tamamlandı!' : 'Kelimeyi bilemediniz'}</h2>
      <p class="word-reveal">${esc(h.word || '')}</p>
      <p class="hint">${
        h.solved
          ? `${esc(finisher)} son harfi buldu.`
          : '6 yanlış hakkı doldu.'
      }</p>
    </div>

    ${scoreCardsHtml({ players: playersWithRound }, true)}

    <div class="btn-row">
      ${readyBtn}
      <button class="btn btn-ghost" data-action="endGame">Bitir</button>
    </div>
    <p class="ready-note">${
      s.readyNext
        ? 'Sen hazırsın. Eşin de basınca yeni kelime gelecek.'
        : s.otherReadyNext
          ? 'Eşin hazır! Sen de “Sonraki kelime”ye bas.'
          : 'Yeni kelime için ikiniz de “Sonraki kelime”ye basın.'
    }</p>

    <div class="section-title">Kelimeler</div>
    ${hangmanEntriesHtml(r.entries, s.players)}
  `;
}

function hangmanEntriesHtml(entries, players) {
  if (!entries.length) return '<p class="hint">Henüz kelime yok.</p>';
  return `<div class="result-list">
    ${entries
      .map((e) => {
        const awards = players
          .map((p, i) => `${p.isMe ? 'Sen' : esc(p.name)} +${(e.awards && e.awards[i]) || 0}`)
          .join(' · ');
        return `<div class="result-item">
          <div class="mark ${e.solved ? 'ok' : 'no'}">${e.solved ? '✅' : '✖'}</div>
          <div class="ri-body">
            <div class="ri-q"><span class="ri-no">${esc(e.round)}.</span> ${esc(e.word)}</div>
            <div class="ri-a">${e.solved ? 'Tamamlandı' : '6 yanlış'} · ${awards}</div>
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

/* ------------------------------------------------------------------ */
/*  Bağımsız modlar: Doğru mu Yanlış mı?                               */
/* ------------------------------------------------------------------ */

function routeQuiz(s) {
  if (!s.quiz) return;
  if (s.phase === 'final') {
    showScreen('final');
    renderStandaloneFinal(s);
    return;
  }
  if (s.phase === 'roundEnd') {
    showScreen('roundEnd');
    renderQuizRoundEnd(s);
    return;
  }
  if (s.phase === 'reveal') {
    showScreen('play');
    renderQuizReveal(s);
    return;
  }
  showScreen('play');
  renderQuizPlay(s);
}

function renderQuizPlay(s) {
  const q = s.quiz;
  const answered = q.myAnswer !== null;

  $('playTitle').textContent = 'Doğru mu Yanlış mı?';
  $('playCounter').textContent = `${q.number}/${q.total}`;

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="timer-wrap">
      <div class="timer"><div class="timer-fill" id="timerFill"></div></div>
      <span class="timer-text" id="timerText">${s.guessSeconds} sn</span>
    </div>
    <div class="card question-card quiz-card">
      <div class="q-owner">🧠 ${esc(q.category)}</div>
      <h2 class="question-text">${esc(q.statement)}</h2>
      <p class="q-sub">${
        answered ? 'Cevabın kaydedildi.' : 'Bu ifade doğru mu, yanlış mı?'
      }</p>
    </div>
    <div class="card guess-box">
      <div class="tf-row">
        <button type="button" class="tf-btn yes" data-action="quizAnswer" data-value="true" ${
          answered ? 'disabled' : ''
        }>✅ Doğru</button>
        <button type="button" class="tf-btn no" data-action="quizAnswer" data-value="false" ${
          answered ? 'disabled' : ''
        }>❌ Yanlış</button>
      </div>
      <p class="hint center" style="margin:0">${
        answered
          ? `“${q.myAnswer ? 'Doğru' : 'Yanlış'}” dedin. ${
              q.otherAnswered ? 'Eşin de cevapladı, sonuç geliyor…' : 'Eşin bekleniyor…'
            }`
          : 'İkiniz de cevaplayınca sonuç açıklanacak.'
      }</p>
    </div>
  `;
  updateTimer();
}

function renderQuizReveal(s) {
  const q = s.quiz;
  const res = q.result || { answers: [null, null], points: [0, 0], truth: q.truth };
  const me = s.me.index;
  const myCorrect = res.answers[me] === res.truth;
  const myPoints = res.points[me] || 0;

  $('playTitle').textContent = 'Doğru mu Yanlış mı?';
  $('playCounter').textContent = `${q.number}/${q.total}`;

  const readyNote = s.readyNext
    ? `${esc(s.rivalName || 'Eşin')} de basınca devam edilecek…`
    : `${q.number}. ifade tamam. İkiniz de Devam’a basınca ${
        q.number >= q.total ? 'tur sonuçları gelecek' : `${q.number + 1}. ifadeye geçilecek`
      }.`;

  const playerBoxes = s.players
    .map((p, i) => {
      const value = res.answers[i];
      const correct = value === res.truth;
      return `<div class="quiz-player ${correct ? 'ok' : 'no'}">
        <span>${p.isMe ? 'Sen' : esc(p.name)}</span>
        <b>${value === null ? '—' : value ? 'Doğru' : 'Yanlış'}</b>
        <em>${correct ? '+' + (res.points[i] || 0) : '0'} puan</em>
      </div>`;
    })
    .join('');

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="card question-card">
      <div class="verdict">
        <span class="verdict-emoji">${myCorrect ? '🎯' : '💔'}</span>
        <h2>${myCorrect ? 'Doğru bildin!' : 'Yanlış!'}</h2>
        <span class="points ${myPoints > 0 ? '' : 'zero'}">${
          myPoints > 0 ? `+${myPoints} puan` : '0 puan'
        }</span>
      </div>
      <p class="q-sub" style="margin-top:14px">${esc(q.statement)}</p>
      <div class="quiz-truth">${res.truth ? 'İfade DOĞRU ✅' : 'İfade YANLIŞ ❌'}</div>
      <div class="quiz-players">${playerBoxes}</div>
    </div>
    <button class="btn btn-primary btn-block" data-action="continueReveal" ${
      s.readyNext ? 'disabled' : ''
    }>${s.readyNext ? 'Eşin bekleniyor…' : 'Devam →'}</button>
    <p class="ready-note">${readyNote}</p>
  `;
}

function renderQuizRoundEnd(s) {
  const r = s.results;
  $('roundTitle').textContent = `${s.round}. tur bitti`;

  const playersWithRound = r.players.map((p, i) => ({
    ...p,
    round: s.players[i] ? s.players[i].roundScore : 0,
  }));
  const readyBtn = s.readyNext
    ? `<button class="btn btn-primary" disabled>Eşin bekleniyor…</button>`
    : `<button class="btn btn-primary" data-action="nextRound">Sonraki 10 soru →</button>`;

  $('roundBody').innerHTML = `
    <div class="card" style="text-align:center;padding:20px">
      <div style="font-size:2.2rem">🎉</div>
      <h2 style="margin:0;font-size:1.3rem">10 ifade tamam!</h2>
      <p class="hint" style="margin-top:6px">İşte turun sonuçları.</p>
    </div>

    ${scoreCardsHtml({ players: playersWithRound }, true)}

    <div class="btn-row">
      ${readyBtn}
      <button class="btn btn-ghost" data-action="endGame">Bitir</button>
    </div>
    <p class="ready-note">${
      s.readyNext
        ? 'Sen hazırsın. Eşin de basınca yeni ifadeler gelecek.'
        : s.otherReadyNext
          ? 'Eşin hazır! Sen de “Sonraki 10 soru”ya bas.'
          : 'Yeni ifadeler için ikiniz de “Sonraki 10 soru”ya basın.'
    }</p>

    <div class="section-title">Bu turun ifadeleri</div>
    ${quizEntriesHtml(r.roundEntries, s.players)}
  `;
}

function quizEntriesHtml(entries, players) {
  if (!entries.length) return '<p class="hint">Henüz ifade yok.</p>';
  return `<div class="result-list">
    ${entries
      .map((e) => {
        const parts = players
          .map((p, i) => {
            const value = e.answers[i];
            return `${p.isMe ? 'Sen' : esc(p.name)}: ${
              value === null ? '—' : value ? 'Doğru' : 'Yanlış'
            } (+${(e.points && e.points[i]) || 0})`;
          })
          .join(' · ');
        return `<div class="result-item">
          <div class="mark ${e.truth ? 'ok' : 'no'}">${e.truth ? '✅' : '❌'}</div>
          <div class="ri-body">
            <div class="ri-q"><span class="ri-no">${esc(e.index)}.</span> ${esc(e.statement)}</div>
            <div class="ri-a">Tur ${esc(e.round)} · ${parts}</div>
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderStandaloneFinal(s) {
  const r = s.results;
  const winner = r.tie || !r.winners.length ? null : r.winners[0];
  const isQuiz = s.mode === 'truefalse';
  const headline = winner ? `${winner} kazandı!` : 'Berabere!';
  const subline = winner ? 'Rövanş var mı?' : 'İkiniz de aynı puandasınız.';

  $('finalBody').innerHTML = `
    <div class="card winner-card">
      <span class="trophy">${winner ? '🏆' : '🤝'}</span>
      <h2>${esc(headline)}</h2>
      <p>${esc(subline)}</p>
      ${
        isQuiz
          ? `<div class="compat">${r.players
              .map(
                (p) => `<div class="compat-item">
                  <div class="pct">%${p.percent}</div>
                  <div class="lbl">${esc(p.name)} · ${p.correct}/${p.total} doğru</div>
                </div>`
              )
              .join('')}</div>`
          : ''
      }
    </div>

    ${scoreCardsHtml(r, false)}

    <div class="section-title">${isQuiz ? 'Tüm ifadeler' : 'Kelimeler'}</div>
    ${isQuiz ? quizEntriesHtml(r.entries, s.players) : hangmanEntriesHtml(r.entries, s.players)}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn btn-primary" data-action="playAgain" ${
        s.readyNext ? 'disabled' : ''
      }>${s.readyNext ? 'Eşin bekleniyor…' : 'Yeniden oyna'}</button>
      <button class="btn btn-ghost" data-action="leave">Ana sayfa</button>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Lobi                                                               */
/* ------------------------------------------------------------------ */

function renderLobby() {
  const s = app.state;
  $('roomCode').textContent = s.code;

  const mode = modeOf(s.mode);
  $('lobbyMode').textContent = `${mode.emoji} ${mode.label}`;

  const players = s.players
    .map(
      (p) => `
      <div class="player">
        <div class="avatar ${p.isMe ? '' : 'alt'}">${esc(initial(p.name))}</div>
        <div>
          <div class="player-name">${esc(p.name)}${p.isMe ? ' <span class="muted">(sen)</span>' : ''}</div>
          <div class="player-tag">
            <span class="${p.connected ? 'dot-online' : 'dot-offline'}"></span>
            ${p.connected ? 'Bağlı' : 'Bağlı değil'}
          </div>
        </div>
      </div>`
    )
    .join('');

  const waiting =
    s.players.length < 2
      ? `<div class="player waiting">Eşin bekleniyor…</div>`
      : '';

  $('lobbyPlayers').innerHTML = players + waiting;

  $('qrImg').src = `/qr.svg?oda=${encodeURIComponent(s.code)}`;
  $('shareBtn').textContent = navigator.share ? 'Paylaş' : 'WhatsApp';
  $('lobbyFoot').textContent =
    s.mode === 'text'
      ? 'İkiniz de hazır olduğunuzda sorular başlıyor.'
      : 'Eşin katılınca oyun otomatik başlıyor.';
}

/* ------------------------------------------------------------------ */
/*  Soru hazırlığı                                                     */
/* ------------------------------------------------------------------ */

function newSetup(round) {
  return {
    round,
    step: 0,
    items: Array.from({ length: 5 }, () => ({
      category: 'karisik',
      text: '',
      answer: '',
    })),
  };
}

function ensureSetup(s) {
  if (!app.setup || app.setup.round !== s.round) {
    if (s.round === 1) app.usedQuestions = new Set();
    app.setup = newSetup(s.round);
    app.setupKey = '';
  }
}

function maybeShowIntro(s) {
  if (!s.players || s.players.length < 2) return;
  let seen = false;
  try {
    seen = localStorage.getItem(GUIDE_KEY) === '1';
  } catch (_error) {
    seen = false;
  }
  if (seen) return;
  const rival = s.players.find((p) => !p.isMe);
  $('introNames').textContent = `${s.me.name} 💞 ${rival ? rival.name : 'Eşin'}`;
  $('introModal').hidden = false;
}

function closeIntro() {
  $('introModal').hidden = true;
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch (_error) {
    /* yoksay */
  }
}

function setupPlayersHtml(s) {
  return s.players
    .map((p) => {
      const label = p.isMe ? 'Sen' : p.name;
      const status = p.ready ? 'hazır' : p.isMe ? 'yazıyorsun…' : 'yazıyor…';
      return `<div class="mini-player ${p.ready ? 'ready' : ''}">
        <div class="avatar ${p.isMe ? '' : 'alt'}">${esc(initial(p.name))}</div>
        ${esc(label)} · ${status}
      </div>`;
    })
    .join('');
}

function suggestionsFor(categoryId, count, exclude = []) {
  const source = questionPool(categoryId);
  if (!source.length) return [];
  const skip = new Set(exclude.filter(Boolean));
  const fresh = source.filter((q) => !skip.has(q) && !app.usedQuestions.has(q));
  const rest = source.filter((q) => !skip.has(q));
  const pool = fresh.length >= count ? fresh : rest.length ? rest : source;
  return shuffle(pool).slice(0, count);
}

function renderSetup() {
  const s = app.state;
  ensureSetup(s);

  $('setupTitle').textContent = `Tur ${s.round} · Senin soruların`;

  if (s.me.ready) {
    app.setupKey = '';
    renderSetupWaiting(s);
    return;
  }

  const key = `${s.round}:${app.setup.step}`;
  if (app.setupKey === key) {
    const strip = $('setupPlayers');
    if (strip) strip.innerHTML = setupPlayersHtml(s);
    return;
  }
  app.setupKey = key;

  const item = app.setup.items[app.setup.step];
  const chosenElsewhere = app.setup.items
    .filter((_, index) => index !== app.setup.step)
    .map((it) => it.text)
    .filter(Boolean);
  const suggestions = suggestionsFor(item.category, 3, [...chosenElsewhere, item.text]);
  const sourceCount = questionPool(item.category).length;
  const isLast = app.setup.step === 4;
  const stepNo = app.setup.step + 1;
  const remaining = 5 - stepNo;
  const previousItem = app.setup.step > 0 ? app.setup.items[app.setup.step - 1] : null;
  const nextLabel = isLast
    ? 'Soruları gönder 💌'
    : `Kaydet ve ${stepNo + 1}. soruya geç →`;
  const mode = modeOf(s.mode);
  const guideText =
    s.mode === 'hangman'
      ? 'Kendinle ilgili bir soru ve 2-16 harflik bir cevap yaz. Eşin harf harf tahmin edecek.'
      : s.mode === 'truefalse'
        ? 'Kendinle ilgili bir soru ve doğru cevabını yaz. Oyun sırasında cevabın “doğru mu, yanlış mı?” diye sorulacak.'
        : 'Kendinle ilgili bir soru ve doğru cevabını yaz. Eşin cevabı yazarak tahmin edecek.';
  const answerHint =
    s.mode === 'hangman'
      ? 'Cevaplar 2-16 harf olmalı. Boşluk ve noktalama korunur.'
      : 'Senin cevabın bu. Kısa ve net yaz (ör. “Mavi”, “Kebap”).';

  $('setupBody').innerHTML = `
    <div class="players-strip" id="setupPlayers">${setupPlayersHtml(s)}</div>

    <div class="guide">
      <span class="g-emoji">${mode.emoji}</span>
      <div>
        <b>${esc(mode.label)} · Şimdi senin sıran.</b>
        <p>${esc(guideText)}</p>
      </div>
    </div>

    <div class="setup-progress">
      <div class="setup-progress-head">
        <span class="setup-step">Soru ${stepNo} / 5</span>
        <span class="setup-left">${remaining > 0 ? `${remaining} soru kaldı` : 'Son soru'}</span>
      </div>
      <div class="dots">
        ${app.setup.items
          .map(
            (it, i) =>
              `<div class="dot ${i < app.setup.step ? 'done' : ''} ${
                i === app.setup.step ? 'active' : ''
              }"></div>`
          )
          .join('')}
      </div>
    </div>

    ${
      previousItem
        ? `<div class="saved-note"><span>✅</span> <span class="sn-label">${stepNo - 1}. soru kaydedildi:</span> <b>“${esc(previousItem.text)}”</b></div>`
        : ''
    }

    <div class="card">
      <div class="q-label"><span>Kendinle ilgili</span><b>${stepNo}</b></div>

      <div class="cat-row">
        ${CATEGORIES.map(
          (c) =>
            `<button type="button" class="cat-chip ${
              c.id === item.category ? 'on' : ''
            }" data-action="category" data-id="${c.id}">${c.emoji} ${esc(c.label)}</button>`
        ).join('')}
      </div>

      <label class="field-label" for="qText">Senin sorun</label>
      <input id="qText" type="text" maxlength="120" placeholder="Örn. En sevdiğim renk ne?"
             value="${esc(item.text)}" enterkeyhint="next" />

      <div class="suggest-head">
        <span>Öneriler</span>
        <button type="button" class="link-small" data-action="browse">Tümünü gör · ${sourceCount}</button>
      </div>
      <div class="chip-list">
        ${suggestions
          .map(
            (q) => `<button type="button" class="suggest-chip ${
              q === item.text ? 'on' : ''
            }" data-action="suggest" data-q="${esc(q)}">${esc(q)}</button>`
          )
          .join('')}
      </div>
      <button type="button" class="shuffle-btn" data-action="shuffle">🎲 Bana soru öner</button>

      <label class="field-label" for="qAnswer">Doğru cevap</label>
      <input id="qAnswer" type="text" maxlength="60" placeholder="Örn. Mavi"
             value="${esc(item.answer)}" enterkeyhint="${isLast ? 'done' : 'next'}" />
      <p class="hint">${esc(answerHint)}</p>
      <p class="hint error" id="setupError" hidden></p>

      <div class="btn-row">
        <button type="button" class="btn" data-action="prevStep" ${app.setup.step === 0 ? 'disabled' : ''}>Geri</button>
        <button type="button" class="btn primary" data-action="${isLast ? 'submitQuestions' : 'nextStep'}">
          ${nextLabel}
        </button>
      </div>
    </div>

    <button type="button" class="btn btn-ghost btn-block" data-action="autofill">
      🤔 Soru bulamıyorum, sen seç
    </button>
    <p class="footnote center">5 sorunun hepsi senin hakkında olacak. Cevapları sadece sen bilirsin.</p>
  `;

  const qText = $('qText');
  const qAnswer = $('qAnswer');

  qText.addEventListener('input', () => {
    app.setup.items[app.setup.step].text = qText.value;
  });
  qText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      qAnswer.focus();
    }
  });
  qAnswer.addEventListener('input', () => {
    app.setup.items[app.setup.step].answer = qAnswer.value;
  });
  qAnswer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isLast) submitQuestions();
      else nextStep();
    }
  });
}

function renderSetupWaiting(s) {
  const mine = s.myQuestions || [];
  const list = mine.length
    ? `<div class="card">
         <div class="q-label"><span>Gönderdiğin sorular</span></div>
         <div class="result-list" style="margin-top:12px">
           ${mine
             .map(
               (q) => `<div class="result-item">
                 <div class="mark">•</div>
                 <div class="ri-body">
                   <div class="ri-q">${esc(q.text)}</div>
                   <div class="ri-a"><b>${esc(q.answer)}</b></div>
                 </div>
               </div>`
             )
             .join('')}
         </div>
       </div>`
    : '';

  const rival = s.players.find((p) => !p.isMe);
  const rivalReady = rival && rival.ready;

  $('setupBody').innerHTML = `
    <div class="card waiting-card">
      <span class="big">💞</span>
      <h3>Soruların hazır! ✅</h3>
      <p>${
        rivalReady
          ? 'İkiniz de hazırsınız. Oyun birazdan başlıyor…'
          : `${esc(rival ? rival.name : 'Eşin')} henüz yazıyor. O da gönderince oyun otomatik başlayacak.`
      }</p>
      <div class="mini-players">
        <div class="mini-player ready">
          <div class="avatar">${esc(initial(s.me.name))}</div>
          Sen · hazır
        </div>
        ${
          rival
            ? `<div class="mini-player ${rival.ready ? 'ready' : ''}">
                 <div class="avatar alt">${esc(initial(rival.name))}</div>
                 ${esc(rival.name)} · ${rival.ready ? 'hazır' : 'yazıyor…'}
               </div>`
            : ''
        }
      </div>
    </div>
    ${list}
  `;
}

function currentSetupItem() {
  return app.setup.items[app.setup.step];
}

function setSetupError(message) {
  const el = $('setupError');
  if (!el) {
    toast(message);
    return;
  }
  el.textContent = message;
  el.hidden = !message;
}

function validateItem(item) {
  if (!item) return 'Bir şeyler ters gitti, sayfayı yenile.';
  if (item.text.trim().length < 3) return 'Önce sorunu yaz.';
  if (!item.answer.trim()) return 'Sorunun cevabını da yazmalısın.';
  if (app.state && app.state.mode === 'hangman') {
    const letterCount = item.answer.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length;
    if (letterCount < 2 || letterCount > 16) {
      return 'Adam Asmaca için cevap 2-16 harf olmalı.';
    }
  }
  return '';
}

function nextStep() {
  const item = currentSetupItem();
  const error = validateItem(item);
  if (error) {
    setSetupError(error);
    return;
  }
  item.text = item.text.trim();
  item.answer = item.answer.trim();
  const savedNumber = app.setup.step + 1;
  app.setup.step = Math.min(4, app.setup.step + 1);
  app.setupKey = '';
  renderSetup();
  showSetupTransition(savedNumber);
}

function prevStep() {
  app.setup.step = Math.max(0, app.setup.step - 1);
  app.setupKey = '';
  renderSetup();
}

function shuffleCurrent() {
  const item = currentSetupItem();
  const texts = app.setup.items.map((it) => it.text).filter(Boolean);
  const options = suggestionsFor(item.category, 8, [...texts, item.text]);
  if (!options.length) {
    toast('Bu kategoride yeni soru kalmadı. Başka bir kategori dene.');
    return;
  }
  item.text = options[0];
  app.usedQuestions.add(item.text);
  app.setupKey = '';
  renderSetup();
  const answer = $('qAnswer');
  if (answer) answer.focus();
}

function autofill() {
  const fresh = ALL_QUESTIONS.filter((x) => !app.usedQuestions.has(x.q));
  const pool = shuffle(fresh.length >= 5 ? fresh : ALL_QUESTIONS);
  const chosen = pool.slice(0, 5);
  app.setup.items = app.setup.items.map((item, i) => ({
    ...item,
    category: chosen[i].category,
    text: chosen[i].q,
  }));
  chosen.forEach((x) => app.usedQuestions.add(x.q));
  app.setup.step = 0;
  app.setupKey = '';
  renderSetup();
  toast('5 soru hazırladım — şimdi cevaplarını yaz 💫');
}

/* ------------------------------------------------------------------ */
/*  Tüm sorular listesi                                                */
/* ------------------------------------------------------------------ */

function openQuestionList(categoryId) {
  app.listCategory = categoryId || 'karisik';
  $('listSearch').value = '';
  renderQuestionList();
  $('listModal').hidden = false;
}

function closeQuestionList() {
  $('listModal').hidden = true;
}

function renderQuestionList() {
  const id = app.listCategory;
  const source =
    id === 'karisik'
      ? ALL_QUESTIONS
      : catById(id).questions.map((q) => ({ q, category: id }));
  const term = normText($('listSearch').value);
  const filtered = term ? source.filter((x) => normText(x.q).includes(term)) : source;
  const label = id === 'karisik' ? 'Tüm sorular' : catById(id).label;

  $('listTitle').textContent = `${label} · ${source.length}`;
  $('listBody').innerHTML = filtered.length
    ? filtered
        .map(
          (x) => `<button type="button" class="q-item ${
            app.usedQuestions.has(x.q) ? 'used' : ''
          }" data-action="pickQuestion" data-q="${esc(x.q)}">${esc(x.q)}</button>`
        )
        .join('')
    : '<p class="q-empty">Aramana uygun soru yok.</p>';
}

function submitQuestions() {
  if (app.submitting) return;
  for (let i = 0; i < 5; i++) {
    const error = validateItem(app.setup.items[i]);
    if (error) {
      app.setup.step = i;
      app.setupKey = '';
      renderSetup();
      setSetupError(error);
      toast(`Soru ${i + 1}: ${error}`);
      return;
    }
  }

  app.submitting = true;
  app.setup.items.forEach((item) => app.usedQuestions.add(item.text.trim()));
  const questions = app.setup.items.map((item) => ({
    text: item.text.trim(),
    answer: item.answer.trim(),
    category: item.category,
  }));
  socket.emit('submit_questions', { questions });
  setTimeout(() => {
    app.submitting = false;
  }, 1500);
}

/* ------------------------------------------------------------------ */
/*  Oyun ekranı                                                        */
/* ------------------------------------------------------------------ */

function scorebarHtml(s) {
  return `
    <div class="scorebar">
      ${s.players
        .map(
          (p) => `
        <div class="score-side ${p.isMe ? 'me' : ''}">
          <div class="avatar ${p.isMe ? '' : 'alt'}">${esc(initial(p.name))}</div>
          <span class="score-name">${p.isMe ? 'Sen' : esc(p.name)}</span>
          <span class="score-value">${p.score}</span>
        </div>`
        )
        .join('')}
    </div>
  `;
}

function showQuestionTransition(isFirst, previousNumber, question) {
  const box = $('transition');
  $('transEmoji').textContent = isFirst ? '🎯' : '✅';
  $('transTitle').textContent = isFirst ? 'Oyun başlıyor!' : `${previousNumber}. soru tamam!`;
  $('transSub').textContent = isFirst
    ? `İlk soru — ${genitive(question.ownerName)} sorusu`
    : `Şimdi ${question.number}. soru — ${genitive(question.ownerName)} sorusu`;
  box.hidden = false;
  clearTimeout(app.transitionTimer);
  app.transitionTimer = setTimeout(() => {
    box.hidden = true;
  }, 1500);
}

function showSetupTransition(savedNumber) {
  const box = $('transition');
  $('transEmoji').textContent = '✅';
  $('transTitle').textContent = `${savedNumber}. soru kaydedildi!`;
  $('transSub').textContent = `Şimdi ${savedNumber + 1}. soru — kendinle ilgili yeni bir soru yaz`;
  box.hidden = false;
  clearTimeout(app.transitionTimer);
  app.transitionTimer = setTimeout(() => {
    box.hidden = true;
  }, 1200);
}

function hangmanHearts(lives) {
  const total = 6;
  return Array.from({ length: total }, (_, i) => `<span class="${i < lives ? '' : 'off'}">❤️</span>`).join('');
}

function hangmanBoardHtml(q, interactive) {
  const mask = q.hangman.mask
    .map((ch) => {
      if (ch === ' ') return '<span class="hm-gap"></span>';
      return `<span class="hm-cell ${ch ? 'open' : ''}">${ch ? esc(ch) : ''}</span>`;
    })
    .join('');
  const used = new Set([
    ...q.hangman.mask.filter((ch) => ch && ch !== ' '),
    ...q.hangman.wrong,
  ]);
  const wrong = q.hangman.wrong.length
    ? `<div class="hm-wrong">Yanlış harfler: ${q.hangman.wrong.map((l) => esc(l)).join(' ')}</div>`
    : '';
  const keyboard = interactive
    ? `<div class="hm-keyboard">${HANGMAN_ALPHABET.map(
        (letter) =>
          `<button type="button" class="hm-key ${used.has(letter) ? 'used' : ''}" data-action="hangmanLetter" data-letter="${letter}" ${
            used.has(letter) ? 'disabled' : ''
          }>${letter}</button>`
      ).join('')}</div>`
    : '';

  return `<div class="hm-board">${mask}</div>
    <div class="hm-lives">${hangmanHearts(q.hangman.lives)}<span>${q.hangman.lives} can</span></div>
    ${wrong}
    ${keyboard}`;
}

function renderPlay() {
  const s = app.state;
  const q = s.question;
  if (!q) return;

  const isHangman = q.mode === 'hangman' && Boolean(q.hangman);
  const hangKey = isHangman ? `:${q.hangman.mask.join('')}:${q.hangman.wrong.join('')}` : '';

  $('playTitle').textContent = `Tur ${s.round}`;
  $('playCounter').textContent = `Soru ${q.number}/${q.total}`;

  const key = `${s.round}:${q.number}:play${hangKey}`;
  if (app.playKey === key) {
    // sadece skorları güncelle (input kaybolmasın)
    const bar = document.querySelector('#playBody .scorebar');
    if (bar) bar.outerHTML = scorebarHtml(s);
    updateTypingIndicator();
    return;
  }
  app.playKey = key;
  app.partnerTyping = false;

  const previous = app.prevState;
  const previousNumber = previous && previous.question ? previous.question.number : 0;
  const firstQuestion = Boolean(previous && previous.phase === 'setup');
  const nextQuestion = Boolean(
    previous &&
      previous.phase === 'reveal' &&
      previousNumber > 0 &&
      q.number === previousNumber + 1
  );
  const showTransition = firstQuestion || nextQuestion;
  if (showTransition) {
    showQuestionTransition(firstQuestion, previousNumber, q);
  }

  const ownerLine = q.isMine
    ? `<div class="q-owner">💗 Senin sorun</div>`
    : `<div class="q-owner">💗 ${esc(genitive(q.ownerName))} sorusu</div>`;

  const isTrueFalse = q.mode === 'truefalse' && Boolean(q.claim);
  const claimHtml = isTrueFalse
    ? `<div class="card claim-card">
         <span class="claim-label">İDDİA</span>
         <p>${esc(genitive(q.ownerName))} cevabı: <b>“${esc(q.claim.shown)}”</b></p>
       </div>`
    : '';

  const ownerSub = isHangman
    ? `${esc(q.guesserName)} harf harf tahmin ediyor.`
    : isTrueFalse
      ? `${esc(q.guesserName)} ifadeyi değerlendiriyor.`
      : `${esc(q.guesserName)} cevabını tahmin ediyor.`;

  const guesserSub = isHangman
    ? 'Harf seçerek cevabı bul. 6 canın var.'
    : isTrueFalse
      ? 'İfade doğru mu, yanlış mı? Karar ver.'
      : `Sence ${esc(q.ownerName)} ne cevap verir?`;

  const body = q.isMine
    ? `
      <div class="card question-card">
        ${ownerLine}
        <h2 class="question-text">${esc(q.text)}</h2>
        <p class="q-sub">${ownerSub}</p>
      </div>
      ${claimHtml}
      <div class="card">
        ${isHangman ? hangmanBoardHtml(q, false) : ''}
        <div class="owner-wait">
          <div class="avatar alt">${esc(initial(q.guesserName))}</div>
          <p id="typingLine">${esc(q.guesserName)} ${
            isHangman ? 'harf seçiyor…' : isTrueFalse ? 'karar veriyor…' : 'düşünüyor…'
          }</p>
          ${
            !isHangman && !isTrueFalse
              ? `<div class="typing" id="typingDots">
                   <span class="b"></span><span class="b"></span><span class="b"></span>
                 </div>`
              : ''
          }
        </div>
      </div>
    `
    : `
      <div class="card question-card">
        ${ownerLine}
        <h2 class="question-text">${esc(q.text)}</h2>
        <p class="q-sub">${guesserSub}</p>
      </div>
      ${claimHtml}
      ${
        isHangman
          ? `<div class="card guess-box">${hangmanBoardHtml(q, true)}</div>`
          : isTrueFalse
            ? `<div class="card guess-box">
                 <div class="tf-row">
                   <button type="button" class="tf-btn yes" data-action="trueFalse" data-value="true">✅ Doğru</button>
                   <button type="button" class="tf-btn no" data-action="trueFalse" data-value="false">❌ Yanlış</button>
                 </div>
                 <p class="hint center" style="margin:0">“${esc(q.claim.shown)}” gerçekten ${esc(genitive(q.ownerName))} cevabı mı?</p>
               </div>`
            : `<div class="card guess-box">
                 <input id="guessInput" class="guess-input" type="text" maxlength="60"
                        placeholder="Tahminini yaz…" autocomplete="off" enterkeyhint="send" />
                 <button class="btn btn-primary btn-block" id="guessBtn">Cevapla 💘</button>
                 <p class="hint center" style="margin:0">Tahminin ne kadar yakınsa puan o kadar yüksek.</p>
               </div>`
      }
    `;

  const turnBanner = q.isMine
    ? `<div class="turn-banner wait">⏳ <b>Sıra ${esc(locative(q.guesserName))}.</b> ${
        isHangman
          ? 'Senin cevabını harf harf tahmin ediyor, bekle.'
          : isTrueFalse
            ? 'İfadeyi değerlendiriyor, bekle.'
            : 'Senin cevabını tahmin ediyor, bekle.'
      }</div>`
    : `<div class="turn-banner go">🎯 <b>Sıra sende!</b> ${
        isHangman
          ? `${esc(genitive(q.ownerName))} cevabını harf harf bul.`
          : isTrueFalse
            ? 'İfade doğru mu, yanlış mı?'
            : `${esc(genitive(q.ownerName))} cevabını tahmin et.`
      }</div>`;

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="timer-wrap">
      <div class="timer"><div class="timer-fill" id="timerFill"></div></div>
      <span class="timer-text" id="timerText">${s.guessSeconds} sn</span>
    </div>
    ${turnBanner}
    ${body}
  `;

  if (!q.isMine && !isHangman && !isTrueFalse) {
    const input = $('guessInput');
    const btn = $('guessBtn');
    const send = () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        input.animate(
          [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
          { duration: 180 }
        );
        return;
      }
      if (app.lastGuessSentAt && Date.now() - app.lastGuessSentAt < 800) return;
      app.lastGuessSentAt = Date.now();
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      socket.emit('typing', { active: false });
      socket.emit('guess', { answer: value });
    };
    btn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
    let typingTimer = null;
    input.addEventListener('input', () => {
      socket.emit('typing', { active: true });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => socket.emit('typing', { active: false }), 1400);
    });
    setTimeout(() => input.focus({ preventScroll: true }), showTransition ? 1600 : 120);
  }

  updateTimer();
  updateTypingIndicator();
}

function updateTypingIndicator() {
  const dots = $('typingDots');
  if (!dots) return;
  const line = $('typingLine');
  if (app.partnerTyping) {
    dots.style.opacity = '1';
    if (line && app.state && app.state.question) {
      line.textContent = `${app.state.question.guesserName} yazıyor…`;
    }
  } else {
    dots.style.opacity = '0.35';
  }
}

function updateTimer() {
  const s = app.state;
  if (!s || s.phase !== 'play') return;

  let deadline = 0;
  if (s.mode === 'text' && s.question) {
    deadline = s.question.deadline;
  } else if (s.mode === 'truefalse' && s.quiz) {
    deadline = s.quiz.deadline;
  } else {
    return;
  }

  const fill = $('timerFill');
  const text = $('timerText');
  if (!fill || !text) return;

  const now = Date.now() + app.skew;
  const total = (s.guessSeconds || 45) * 1000;
  const left = Math.max(0, deadline - now);
  const ratio = Math.max(0, Math.min(1, left / total));
  fill.style.width = (ratio * 100).toFixed(1) + '%';
  fill.classList.toggle('low', ratio < 0.3);
  text.textContent = Math.ceil(left / 1000) + ' sn';

  const paused =
    (s.question && s.question.paused) || (s.quiz && s.quiz.paused) || false;

  if (left <= 0 && !paused) {
    const btn = $('guessBtn');
    if (btn && !btn.disabled) {
      btn.disabled = true;
      btn.textContent = 'Süre bitti ⏰';
    }
    const input = $('guessInput');
    if (input) input.disabled = true;
    document.querySelectorAll('.hm-key').forEach((key) => {
      key.disabled = true;
    });
    document.querySelectorAll('.tf-btn').forEach((key) => {
      key.disabled = true;
    });
  }
}

setInterval(updateTimer, 250);

/* ------------------------------------------------------------------ */
/*  Cevap açıklama                                                     */
/* ------------------------------------------------------------------ */

function renderReveal() {
  const s = app.state;
  const q = s.question;
  if (!q) return;

  $('playTitle').textContent = `Tur ${s.round}`;
  $('playCounter').textContent = `Soru ${q.number}/${q.total}`;

  const isHangman = q.mode === 'hangman';
  const isTrueFalse = q.mode === 'truefalse' && Boolean(q.claim);

  let emoji = '💔';
  let title = '';
  if (q.timedOut) {
    emoji = '⏰';
    title = 'Süre doldu!';
  } else if (isHangman) {
    const solved = Boolean(q.hangman && q.hangman.solved);
    if (solved) {
      emoji = '🎯';
      title = q.isMine ? `${q.guesserName} harf harf bildi!` : 'Harf harf bildin!';
    } else {
      emoji = '🧩';
      title = q.isMine ? `${q.guesserName} bilemedi` : 'Bilemedin';
    }
  } else if (isTrueFalse) {
    const correct = q.points > 0;
    emoji = correct ? '🎯' : '💔';
    title = correct
      ? q.isMine
        ? `${q.guesserName} doğru bildi!`
        : 'Doğru bildin!'
      : q.isMine
        ? `${q.guesserName} yanıldı`
        : 'Yanlış karar!';
  } else if (q.match === 'exact') {
    emoji = '🎯';
    title = q.isMine ? `${q.guesserName} tam bildi!` : 'Tam isabet!';
  } else if (q.match === 'close') {
    emoji = '✨';
    title = q.isMine ? `${q.guesserName} yaklaştı` : 'Yaklaştın!';
  } else {
    emoji = '💔';
    title = q.isMine ? `${q.guesserName} bilemedi` : 'Bilemedin';
  }

  const pointsText = q.points > 0 ? `+${q.points} puan` : '0 puan';

  const guessLabel = isTrueFalse
    ? 'İfade'
    : isHangman
      ? q.isMine
        ? `${esc(genitive(q.guesserName))} tahtası`
        : 'Senin tahtan'
      : q.isMine
        ? `${esc(genitive(q.guesserName))} tahmini`
        : 'Senin tahminin';
  const guessValue = isTrueFalse ? q.claim.shown : q.guess;
  const truthLabel = isTrueFalse
    ? 'Gerçek cevap'
    : q.isMine
      ? 'Senin cevabın'
      : `${esc(genitive(q.ownerName))} cevabı`;

  const afterText =
    q.number >= q.total ? 'tur sonuçları gelecek' : `${q.number + 1}. soruya geçilecek`;
  const readyNote = s.readyNext
    ? `${esc(s.rivalName || 'Eşin')} de basınca devam edilecek…`
    : `${q.number}. soru tamamlandı. İkiniz de Devam’a basınca ${afterText}.`;

  const hangmanNote = isHangman
    ? `<p class="hint center" style="margin-top:12px">${q.hangman.lives} can kaldı · ${
        q.hangman.wrong.length
      } yanlış harf</p>`
    : '';
  const trueFalseNote = isTrueFalse
    ? `<p class="hint center" style="margin-top:12px">İfade ${
        q.claim.isTrue ? 'doğruydu ✅' : 'yanlıştı ❌'
      }${q.guess ? ` · Karar: ${esc(q.guess)}` : ''}</p>`
    : '';

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="card question-card">
      <div class="verdict">
        <span class="verdict-emoji">${emoji}</span>
        <h2>${esc(title)}</h2>
        <span class="points ${q.points > 0 ? '' : 'zero'}">${pointsText}</span>
      </div>
      <p class="q-sub" style="margin-top:14px">${esc(q.text)}</p>
      <div class="compare">
        <div class="compare-item guess ${q.points === 0 && !isTrueFalse ? 'bad' : ''}">
          <span>${guessLabel}</span>
          <p>${guessValue ? esc(guessValue) : '—'}</p>
        </div>
        <div class="compare-item truth">
          <span>${truthLabel}</span>
          <p>${esc(q.answer)}</p>
        </div>
      </div>
      ${hangmanNote}
      ${trueFalseNote}
    </div>
    <button class="btn btn-primary btn-block" data-action="continueReveal" ${
      s.readyNext ? 'disabled' : ''
    }>${s.readyNext ? 'Eşin bekleniyor…' : 'Devam →'}</button>
    <p class="ready-note">${readyNote}</p>
  `;
}

/* ------------------------------------------------------------------ */
/*  Tur sonu                                                           */
/* ------------------------------------------------------------------ */

function entriesHtml(entries) {
  if (!entries.length) return '<p class="hint">Bu turda soru yok.</p>';
  return `<div class="result-list">
    ${entries
      .map((e) => {
        const ok = e.points > 0;
        const no = e.index ? `<span class="ri-no">${esc(e.index)}.</span>` : '';
        const detail =
          e.mode === 'hangman'
            ? `Harf harf${e.wrongCount ? ` · ${e.wrongCount} yanlış` : ''}`
            : e.mode === 'truefalse'
              ? `İfade: <b>${esc(e.claimShown)}</b> (${e.claimTrue ? 'doğru' : 'yanlış'})`
              : `${esc(e.guesserName)}: <b>${e.guess ? esc(e.guess) : '—'}</b>`;
        return `<div class="result-item">
          <div class="mark ${ok ? 'ok' : 'no'}">${ok ? (e.points >= 10 ? '🎯' : '✨') : '✖'}</div>
          <div class="ri-body">
            <div class="ri-q">${no} ${esc(e.question)}</div>
            <div class="ri-a">${detail} · Doğru: <b>${esc(e.answer)}</b></div>
          </div>
          <div class="ri-pts ${ok ? '' : 'zero'}">+${e.points}</div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function scoreCardsHtml(results, useRound) {
  const valueOf = (p) => (useRound ? p.round : p.score);
  const best = Math.max(...results.players.map(valueOf));
  return `<div class="score-grid">
    ${results.players
      .map((p, i) => {
        const value = valueOf(p);
        return `<div class="score-card ${value === best && best > 0 ? 'win' : ''}">
          <div class="avatar ${i === 0 ? '' : 'alt'}">${esc(initial(p.name))}</div>
          <div class="sc-name">${esc(p.name)}</div>
          <div class="sc-value">${value}</div>
          <div class="sc-sub">${useRound ? 'bu tur · toplam ' + p.score : 'toplam puan'}</div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderRoundEnd() {
  const s = app.state;
  const r = s.results;

  $('roundTitle').textContent = `Tur ${s.round} bitti`;

  const playersWithRound = r.players.map((p, i) => ({
    ...p,
    round: s.players[i] ? s.players[i].roundScore : 0,
  }));

  const readyBtn = s.readyNext
    ? `<button class="btn btn-primary" disabled>Eşin bekleniyor…</button>`
    : `<button class="btn btn-primary" data-action="nextRound">Sonraki 5 soru →</button>`;

  $('roundBody').innerHTML = `
    <div class="card" style="text-align:center;padding:20px">
      <div style="font-size:2.2rem;margin-bottom:6px">🎉</div>
      <h2 style="margin:0;font-size:1.3rem">10 soru tamam!</h2>
      <p class="hint" style="margin-top:6px">İşte turun sonuçları.</p>
    </div>

    ${scoreCardsHtml({ players: playersWithRound }, true)}

    <div class="btn-row">
      ${readyBtn}
      <button class="btn btn-ghost" data-action="endGame">Bitir</button>
    </div>
    <p class="ready-note">${
      s.readyNext
        ? 'Sen hazırsın. Eşin de basınca yeni soru ekranı açılacak.'
        : s.otherReadyNext
          ? 'Eşin hazır! Sen de “Sonraki 5 soru”ya bas.'
          : 'Yeni 5 soru için ikiniz de “Sonraki 5 soru”ya basın.'
    }</p>

    <div class="section-title">Bu turun soruları</div>
    ${entriesHtml(r.roundEntries)}
  `;
}

/* ------------------------------------------------------------------ */
/*  Final                                                              */
/* ------------------------------------------------------------------ */

function renderFinal() {
  const s = app.state;
  const r = s.results;

  const winner = r.tie || r.winners.length === 0 ? null : r.winners[0];
  const headline = winner ? `${winner} kazandı! 🎉` : 'Berabere!';
  const subline = winner
    ? 'Birbirinizi iyi tanıyorsunuz. Bir tur daha?'
    : 'İkiniz de birbirini aynı derecede tanıyorsunuz.';

  const allByRound = {};
  for (const e of r.entries) {
    (allByRound[e.round] = allByRound[e.round] || []).push(e);
  }
  const rounds = Object.keys(allByRound)
    .map(Number)
    .sort((a, b) => a - b);
  const entriesBlock = rounds
    .map(
      (round) => `
      ${
        rounds.length > 1
          ? `<div class="section-title" style="margin-top:14px">Tur ${esc(round)}</div>`
          : ''
      }
      ${entriesHtml(allByRound[round])}
    `
    )
    .join('');

  $('finalBody').innerHTML = `
    <div class="card winner-card">
      <span class="trophy">${winner ? '🏆' : '🤝'}</span>
      <h2>${esc(headline)}</h2>
      <p>${esc(subline)}</p>
      <div class="compat">
        ${r.players
          .map(
            (p, i) => `<div class="compat-item">
              <div class="pct">%${p.percent}</div>
              <div class="lbl">${esc(p.name)} · ${p.correct}/${p.total} doğru</div>
            </div>`
          )
          .join('')}
      </div>
    </div>

    ${scoreCardsHtml(r, false)}

    <div class="section-title">${rounds.length > 1 ? 'Tüm sorular' : 'Sorular'}</div>
    ${entriesBlock}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn btn-primary" data-action="playAgain" ${
        s.readyNext ? 'disabled' : ''
      }>${s.readyNext ? 'Eşin bekleniyor…' : 'Yeniden oyna'}</button>
      <button class="btn btn-ghost" data-action="leave">Ana sayfa</button>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Tıklama yönetimi                                                   */
/* ------------------------------------------------------------------ */

function leaveRoom(ask) {
  if (ask && !window.confirm('Odadan ayrılmak istediğine emin misin?')) return;
  socket.emit('leave_room');
  clearSession();
  goHome();
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'leave':
      leaveRoom(
        app.state &&
          ['setup', 'play', 'reveal', 'roundEnd'].includes(app.state.phase)
      );
      break;
    case 'help':
      $('helpModal').hidden = false;
      break;
    case 'closeIntro':
      closeIntro();
      break;
    case 'openHelp':
      closeIntro();
      $('helpModal').hidden = false;
      break;
    case 'category':
      if (!app.setup) break;
      currentSetupItem().category = btn.dataset.id;
      app.setupKey = '';
      renderSetup();
      break;
    case 'pickMode':
      app.homeMode = ['text', 'hangman', 'truefalse'].includes(btn.dataset.mode)
        ? btn.dataset.mode
        : 'text';
      document
        .querySelectorAll('.home-mode')
        .forEach((card) => card.classList.toggle('on', card.dataset.mode === app.homeMode));
      $('modeDesc').textContent = modeOf(app.homeMode).desc;
      break;
    case 'suggest': {
      if (!app.setup) break;
      const item = currentSetupItem();
      item.text = btn.dataset.q || '';
      app.usedQuestions.add(item.text);
      const input = $('qText');
      if (input) input.value = item.text;
      document
        .querySelectorAll('.suggest-chip')
        .forEach((chip) => chip.classList.toggle('on', chip.dataset.q === item.text));
      const answer = $('qAnswer');
      if (answer) answer.focus();
      break;
    }
    case 'browse':
      if (!app.setup) break;
      openQuestionList(currentSetupItem().category);
      break;
    case 'closeList':
      closeQuestionList();
      break;
    case 'pickQuestion': {
      if (!app.setup) break;
      const item = currentSetupItem();
      item.text = btn.dataset.q || '';
      app.usedQuestions.add(item.text);
      closeQuestionList();
      app.setupKey = '';
      renderSetup();
      const answer = $('qAnswer');
      if (answer) answer.focus();
      break;
    }
    case 'hangmanLetter': {
      if (
        !app.state ||
        app.state.mode !== 'hangman' ||
        !app.state.hangman ||
        !app.state.hangman.isMyTurn
      ) {
        break;
      }
      const letter = btn.dataset.letter;
      if (!letter) break;
      btn.disabled = true;
      socket.emit('hangman_letter', { letter });
      break;
    }
    case 'quizAnswer': {
      if (!app.state || app.state.mode !== 'truefalse' || app.state.phase !== 'play') break;
      socket.emit('quiz_answer', { value: btn.dataset.value === 'true' });
      document.querySelectorAll('.tf-btn').forEach((b) => (b.disabled = true));
      break;
    }
    case 'shuffle':
      shuffleCurrent();
      break;
    case 'autofill':
      autofill();
      break;
    case 'nextStep':
      nextStep();
      break;
    case 'prevStep':
      prevStep();
      break;
    case 'submitQuestions':
      submitQuestions();
      break;
    case 'submitGuess': {
      const input = $('guessInput');
      if (input) {
        const value = input.value.trim();
        if (!value) {
          input.focus();
          return;
        }
        socket.emit('typing', { active: false });
        socket.emit('guess', { answer: value });
        btn.disabled = true;
        btn.textContent = 'Gönderiliyor…';
      }
      break;
    }
    case 'continueReveal':
      btn.disabled = true;
      btn.textContent = 'Bekleniyor…';
      socket.emit('ready_next');
      break;
    case 'nextRound':
      btn.disabled = true;
      btn.textContent = 'Bekleniyor…';
      socket.emit('next_round');
      break;
    case 'endGame':
      socket.emit('end_game');
      break;
    case 'playAgain':
      btn.disabled = true;
      btn.textContent = 'Bekleniyor…';
      socket.emit('play_again');
      break;
    default:
      break;
  }
});

/* ------------------------------------------------------------------ */
/*  Ana sayfa                                                          */
/* ------------------------------------------------------------------ */

function playerName() {
  return $('nameInput').value.trim();
}

function rememberName() {
  const name = playerName();
  if (name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* yoksay */
    }
  }
  return name;
}

$('createBtn').addEventListener('click', () => {
  const name = rememberName();
  if (name.length < 2) {
    toast('Önce takma adını yaz.');
    $('nameInput').focus();
    return;
  }
  if (!socket.connected) {
    toast('Sunucuya bağlanılamadı. İnternetini kontrol et.');
    return;
  }
  socket.emit('create_room', { name, mode: app.homeMode });
});

$('joinBtn').addEventListener('click', () => {
  const name = rememberName();
  const code = $('codeInput').value.trim().toUpperCase();
  if (name.length < 2) {
    toast('Önce takma adını yaz.');
    $('nameInput').focus();
    return;
  }
  if (code.length < 4) {
    toast('Oda kodunu gir.');
    $('codeInput').focus();
    return;
  }
  if (!socket.connected) {
    toast('Sunucuya bağlanılamadı. İnternetini kontrol et.');
    return;
  }
  socket.emit('join_room', { name, code });
});

$('codeInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if ($('codeInput').value.trim()) $('joinBtn').click();
    else $('createBtn').click();
  }
});

$('copyBtn').addEventListener('click', async () => {
  const code = app.state ? app.state.code : '';
  try {
    await navigator.clipboard.writeText(code);
    toast('Oda kodu kopyalandı 💌');
  } catch {
    const area = document.createElement('textarea');
    area.value = code;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      toast('Oda kodu kopyalandı 💌');
    } catch {
      toast('Kod: ' + code);
    }
    document.body.removeChild(area);
  }
});

$('shareBtn').addEventListener('click', async () => {
  const s = app.state;
  if (!s) return;
  const code = s.code;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const url = isLocal ? '' : `${location.origin}/?oda=${code}`;
  const text = url
    ? `Eşimi Tanıyorum 💞 Oda kodum: ${code}\n${url}`
    : `Eşimi Tanıyorum 💞 Oda kodum: ${code}\nAynı Wi-Fi'de uygulamayı açıp kodu gir.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Eşimi Tanıyorum', text, ...(url ? { url } : {}) });
      return;
    } catch {
      /* kullanıcı vazgeçti */
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
});

$('howBtn').addEventListener('click', () => {
  $('helpModal').hidden = false;
});
$('helpClose').addEventListener('click', () => {
  $('helpModal').hidden = true;
});
$('helpOk').addEventListener('click', () => {
  $('helpModal').hidden = true;
});
$('helpModal').addEventListener('click', (e) => {
  if (e.target === $('helpModal')) $('helpModal').hidden = true;
});

$('listSearch').addEventListener('input', renderQuestionList);
$('listModal').addEventListener('click', (e) => {
  if (e.target === $('listModal')) closeQuestionList();
});
$('introModal').addEventListener('click', (e) => {
  if (e.target === $('introModal')) closeIntro();
});

/* ------------------------------------------------------------------ */
/*  Açılış                                                             */
/* ------------------------------------------------------------------ */

(function init() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('oda') || '').toUpperCase();
  if (code) $('codeInput').value = code;

  const storedName = localStorage.getItem(NAME_KEY);
  if (storedName) $('nameInput').value = storedName;

  if (code && !storedName) {
    setTimeout(() => $('nameInput').focus(), 300);
  }
})();
