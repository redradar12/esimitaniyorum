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
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/*  Soru bankası                                                       */
/* ------------------------------------------------------------------ */

const BANK = window.SORU_BANKASI;

const ALL_QUESTIONS = BANK.flatMap((c) => c.questions.map((q) => ({ q, category: c.id })));

const catById = (id) => BANK.find((c) => c.id === id) || BANK[0];

/* ------------------------------------------------------------------ */
/*  Yardımcılar                                                        */
/* ------------------------------------------------------------------ */

const randomInt = (n) => Math.floor(Math.random() * n);

function pick(arr) {
  return arr[randomInt(arr.length)];
}

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
  $('pausedOverlay').hidden = true;
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

  if (s.phase === 'lobby') {
    showScreen('lobby');
    renderLobby();
  } else if (s.phase === 'setup') {
    showScreen('setup');
    renderSetup();
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
/*  Lobi                                                               */
/* ------------------------------------------------------------------ */

function renderLobby() {
  const s = app.state;
  $('roomCode').textContent = s.code;

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
}

/* ------------------------------------------------------------------ */
/*  Soru hazırlığı                                                     */
/* ------------------------------------------------------------------ */

function newSetup(round) {
  return {
    round,
    step: 0,
    items: Array.from({ length: 5 }, (_, i) => ({
      category: BANK[i % BANK.length].id,
      text: '',
      answer: '',
    })),
  };
}

function ensureSetup(s) {
  if (!app.setup || app.setup.round !== s.round) {
    app.setup = newSetup(s.round);
    app.setupKey = '';
  }
}

function suggestionsFor(categoryId, count) {
  const cat = catById(categoryId);
  return shuffle(cat.questions).slice(0, count);
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
  if (app.setupKey === key) return;
  app.setupKey = key;

  const item = app.setup.items[app.setup.step];
  const suggestions = suggestionsFor(item.category, 3);
  const isLast = app.setup.step === 4;

  $('setupBody').innerHTML = `
    <div class="setup-progress">
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
      <span class="setup-count">${app.setup.step + 1}/5</span>
    </div>

    <div class="card">
      <div class="q-label"><span>Kendinle ilgili</span><b>${app.setup.step + 1}</b></div>

      <div class="cat-row">
        ${BANK.map(
          (c) =>
            `<button type="button" class="cat-chip ${
              c.id === item.category ? 'on' : ''
            }" data-action="category" data-id="${c.id}">${c.emoji} ${esc(c.label)}</button>`
        ).join('')}
      </div>

      <label class="field-label" for="qText">Senin sorun</label>
      <input id="qText" type="text" maxlength="120" placeholder="Örn. En sevdiğim renk ne?"
             value="${esc(item.text)}" enterkeyhint="next" />

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

      <label class="field-label" for="qAnswer">Senin cevabın</label>
      <input id="qAnswer" type="text" maxlength="60" placeholder="Örn. Mavi"
             value="${esc(item.answer)}" enterkeyhint="${isLast ? 'done' : 'next'}" />
      <p class="hint">Eşin bu cevabı tahmin edecek. Kısa ve net cevaplar eşleşmeyi kolaylaştırır.</p>
      <p class="hint error" id="setupError" hidden></p>

      <div class="btn-row">
        <button type="button" class="btn" data-action="prevStep" ${app.setup.step === 0 ? 'disabled' : ''}>Geri</button>
        <button type="button" class="btn primary" data-action="${isLast ? 'submitQuestions' : 'nextStep'}">
          ${isLast ? 'Soruları gönder 💌' : 'İleri →'}
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
      <h3>Soruların hazır!</h3>
      <p>${
        rivalReady
          ? 'Eşin de hazır. Oyun birazdan başlıyor…'
          : 'Eşin de sorularını hazırlayınca oyun başlıyor.'
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
  app.setup.step = Math.min(4, app.setup.step + 1);
  app.setupKey = '';
  renderSetup();
}

function prevStep() {
  app.setup.step = Math.max(0, app.setup.step - 1);
  app.setupKey = '';
  renderSetup();
}

function shuffleCurrent() {
  const item = currentSetupItem();
  const options = suggestionsFor(item.category, 6).filter((q) => q !== item.text);
  const q = options[0] || pick(ALL_QUESTIONS).q;
  item.text = q;
  item.answer = item.answer; // koru
  app.setupKey = '';
  renderSetup();
  const answer = $('qAnswer');
  if (answer) answer.focus();
}

function autofill() {
  const chosen = shuffle(ALL_QUESTIONS).slice(0, 5);
  app.setup.items = app.setup.items.map((item, i) => ({
    ...item,
    category: chosen[i].category,
    text: chosen[i].q,
  }));
  app.setup.step = 0;
  app.setupKey = '';
  renderSetup();
  toast('5 soru hazırladım — şimdi cevaplarını yaz 💫');
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

function renderPlay() {
  const s = app.state;
  const q = s.question;
  if (!q) return;

  $('playTitle').textContent = `Tur ${s.round}`;
  $('playCounter').textContent = `${q.number}/${q.total}`;

  const key = `${s.round}:${q.number}:play`;
  if (app.playKey === key) {
    // sadece skorları güncelle (input kaybolmasın)
    const bar = document.querySelector('#playBody .scorebar');
    if (bar) bar.outerHTML = scorebarHtml(s);
    updateTypingIndicator();
    return;
  }
  app.playKey = key;
  app.partnerTyping = false;

  const ownerLine = q.isMine
    ? `<div class="q-owner">💗 Senin sorun</div>`
    : `<div class="q-owner">💗 ${esc(genitive(q.ownerName))} sorusu</div>`;

  const body = q.isMine
    ? `
      <div class="card question-card">
        ${ownerLine}
        <h2 class="question-text">${esc(q.text)}</h2>
        <p class="q-sub">${esc(q.guesserName)} cevabını tahmin ediyor.</p>
      </div>
      <div class="card">
        <div class="owner-wait">
          <div class="avatar alt">${esc(initial(q.guesserName))}</div>
          <p id="typingLine">${esc(q.guesserName)} düşünüyor…</p>
          <div class="typing" id="typingDots">
            <span class="b"></span><span class="b"></span><span class="b"></span>
          </div>
        </div>
      </div>
    `
    : `
      <div class="card question-card">
        ${ownerLine}
        <h2 class="question-text">${esc(q.text)}</h2>
        <p class="q-sub">Sence ${esc(q.ownerName)} ne cevap verir?</p>
      </div>
      <div class="card guess-box">
        <input id="guessInput" class="guess-input" type="text" maxlength="60"
               placeholder="Cevabını yaz…" autocomplete="off" enterkeyhint="send" />
        <button class="btn btn-primary btn-block" id="guessBtn">Cevapla 💘</button>
        <p class="hint center" style="margin:0">Tahminin ne kadar yakınsa puan o kadar yüksek.</p>
      </div>
    `;

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="timer-wrap">
      <div class="timer"><div class="timer-fill" id="timerFill"></div></div>
      <span class="timer-text" id="timerText">${s.guessSeconds}</span>
    </div>
    ${body}
  `;

  if (!q.isMine) {
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
    setTimeout(() => input.focus({ preventScroll: true }), 120);
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
  if (!s || s.phase !== 'play' || !s.question) return;
  const fill = $('timerFill');
  const text = $('timerText');
  if (!fill || !text) return;

  const now = Date.now() + app.skew;
  const total = (s.guessSeconds || 45) * 1000;
  const left = Math.max(0, s.question.deadline - now);
  const ratio = Math.max(0, Math.min(1, left / total));
  fill.style.width = (ratio * 100).toFixed(1) + '%';
  fill.classList.toggle('low', ratio < 0.3);
  text.textContent = Math.ceil(left / 1000);

  if (left <= 0 && !s.question.paused) {
    const btn = $('guessBtn');
    if (btn && !btn.disabled) {
      btn.disabled = true;
      btn.textContent = 'Süre bitti ⏰';
    }
    const input = $('guessInput');
    if (input) input.disabled = true;
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
  $('playCounter').textContent = `${q.number}/${q.total}`;

  let emoji = '💔';
  let title = '';
  if (q.timedOut) {
    emoji = '⏰';
    title = 'Süre doldu!';
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

  const guessLabel = q.isMine ? `${esc(genitive(q.guesserName))} tahmini` : 'Senin tahminin';
  const truthLabel = q.isMine ? 'Senin cevabın' : `${esc(genitive(q.ownerName))} cevabı`;

  const readyNote = s.readyNext
    ? `${esc(s.rivalName || 'Eşin')} de devam edince geçilecek…`
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
        <div class="compare-item guess ${q.points > 0 ? '' : 'bad'}">
          <span>${guessLabel}</span>
          <p>${q.guess ? esc(q.guess) : '—'}</p>
        </div>
        <div class="compare-item truth">
          <span>${truthLabel}</span>
          <p>${esc(q.answer)}</p>
        </div>
      </div>
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
        return `<div class="result-item">
          <div class="mark ${ok ? 'ok' : 'no'}">${ok ? (e.points >= 10 ? '🎯' : '✨') : '✖'}</div>
          <div class="ri-body">
            <div class="ri-q">${esc(e.question)}</div>
            <div class="ri-a">${esc(e.guesserName)}: <b>${e.guess ? esc(e.guess) : '—'}</b> · Doğru: <b>${esc(e.answer)}</b></div>
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
      <p class="hint" style="margin-top:6px">Şimdi yeni 5’er soru hazırlayın.</p>
    </div>

    ${scoreCardsHtml({ players: playersWithRound }, true)}

    <div class="btn-row">
      ${readyBtn}
      <button class="btn btn-ghost" data-action="endGame">Bitir</button>
    </div>
    ${
      s.otherReadyNext
        ? '<p class="ready-note">Eşin sonraki tura geçmeye hazır.</p>'
        : ''
    }

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
    case 'category':
      if (!app.setup) break;
      currentSetupItem().category = btn.dataset.id;
      app.setupKey = '';
      renderSetup();
      break;
    case 'suggest': {
      if (!app.setup) break;
      const item = currentSetupItem();
      item.text = btn.dataset.q || '';
      const input = $('qText');
      if (input) input.value = item.text;
      document
        .querySelectorAll('.suggest-chip')
        .forEach((chip) => chip.classList.toggle('on', chip.dataset.q === item.text));
      const answer = $('qAnswer');
      if (answer) answer.focus();
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
  socket.emit('create_room', { name });
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
