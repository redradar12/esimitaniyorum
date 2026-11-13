'use strict';

/* ==================================================================
   Seni Tanıyorum — istemci mantığı
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
    short: 'Soru-Cevap',
    desc: 'Klasik mod: cevabı yazarak tahmin et.',
  },
  hangman: {
    emoji: '🔤',
    label: 'Adam Asmaca',
    short: 'Adam Asmaca',
    desc: 'Sırayla birbirinize soru sorun; cevabı harf harf tahmin edin.',
  },
  truefalse: {
    emoji: '✅',
    label: 'Doğru mu Yanlış mı?',
    short: 'Doğru/Yanlış',
    desc: 'Sistem ifade sorar; ikiniz de doğru/yanlış diyin.',
  },
  team: {
    emoji: '🏆',
    label: 'Takımlar Kapışması',
    short: 'Takımlar',
    desc: '4-6 kişi: takım arkadaşları aynı cevabı vermeye çalışır.',
  },
  uno: {
    emoji: '🃏',
    label: 'UNO',
    short: 'UNO',
    desc: '2-4 kişi: klasik UNO; 500 puana ulaşan kazanır.',
  },
};

const MODE_HELP = {
  text: {
    emoji: '⌨️',
    title: 'Soru-Cevap',
    meta: '2 oyuncu · 10 soru / tur',
    intro: 'Birbirinizi ne kadar iyi tanıdığınızı yazılı cevaplarla test edin.',
    points: [
      'Her oyuncu kendisi hakkında 5 soru ve doğru cevabını yazar.',
      'Sırayla karşındakinin sorularına cevap verirsin.',
      'Tam isabet 10, cevabı kapsayan tahmin 8, kelime eşleşmesi 6 puan.',
      '10 soruluk turlar biter; yeni turda yeniden 5 soru hazırlanır.',
    ],
  },
  hangman: {
    emoji: '🔤',
    title: 'Adam Asmaca',
    meta: '2 oyuncu · 2 soru / tur · 6 can',
    intro: 'Sırayla birbirinize soru sorun, cevabı harf harf bulun.',
    points: [
      'Soran oyuncu kendisiyle ilgili bir soru ve 2-16 harflik cevap yazar.',
      'Tahmin eden oyuncu 6 canla harf seçer; yanlış harf bir can götürür.',
      'Doğru harf +5 puan, cevabı tamamen bitiren +10 puan kazanır.',
      'Bir turda bir sen, bir rakibin sorar; sonra roller değişir.',
    ],
  },
  truefalse: {
    emoji: '✅',
    title: 'Doğru mu Yanlış mı?',
    meta: '2 oyuncu · 10 ifade / tur · 15 saniye',
    intro: 'Sistemin sorduğu ifadelerin doğru mu yanlış mı olduğunu birlikte tahmin edin.',
    points: [
      'Her ifade için ikiniz de aynı anda Doğru veya Yanlış seçersiniz.',
      'Doğru cevap 10 puandır; ikiniz de doğruysa ilk cevaplayan +2 kazanır.',
      'Yanlış veya boş cevap 0 puandır; cevap süresi 15 saniyedir.',
      '10 ifade tamamlanınca tur sonuçları ve ardından yeni tur gelir.',
    ],
  },
  team: {
    emoji: '🏆',
    title: 'Takımlar Kapışması',
    meta: '2-3 takım · 4-6 oyuncu · 10 soru / tur',
    intro: 'Takım arkadaşlarınızla aynı cevabı vererek puan toplayın.',
    points: [
      'Her takım 2 oyuncudan oluşur; 2 veya 3 takım aynı odada yarışır.',
      'Sistem ortak bir soru sorar; takım arkadaşları ayrı ayrı cevap verir.',
      'İki arkadaşın cevabı aynıysa takım +10 puan kazanır.',
      'Oda sahibi, tüm takımlar hazır olduğunda oyunu başlatır.',
    ],
  },
  uno: {
    emoji: '🃏',
    title: 'UNO',
    meta: '2-4 oyuncu · 500 puanlık maç',
    intro: 'Klasik UNO kurallarıyla 500 puana ulaşan ilk oyuncu olun.',
    points: [
      'Her oyuncuya 7 kart dağıtılır; aynı renk, sayı veya sembol oynanır.',
      'Joker kartta renk seçilir; +2 ve +4 sıradaki oyuncuya kart çektirir.',
      'Eli bitiren, diğer oyuncuların elindeki kartların puanını alır.',
      'Sayılar sayı değeri, Pas/Yön/+2 20, Joker/+4 50 puandır.',
      '500 puana ilk ulaşan maçı kazanır; 2 oyuncuda Yön kartı pas gibi çalışır.',
    ],
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

let turnAudioCtx = null;

function unlockTurnAudio() {
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!turnAudioCtx) turnAudioCtx = new AudioCtor();
    if (turnAudioCtx.state === 'suspended') {
      turnAudioCtx.resume().catch(() => {});
    }
    return turnAudioCtx;
  } catch (_error) {
    return null;
  }
}

function playTurnCue() {
  const ctx = unlockTurnAudio();
  if (ctx && ctx.state !== 'suspended') {
    try {
      const now = ctx.currentTime;
      [880, 1318.5].forEach((frequency, index) => {
        const start = now + index * 0.11;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.1, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.24);
      });
    } catch (_error) {
      /* ses desteklenmiyorsa görsel bildirim yeterli */
    }
  }
  if (navigator.vibrate) {
    try {
      navigator.vibrate([70, 45, 70]);
    } catch (_error) {
      /* yoksay */
    }
  }
}

function unlockTurnAudioOnce() {
  unlockTurnAudio();
}

document.addEventListener('pointerdown', unlockTurnAudioOnce, {
  once: true,
  passive: true,
});
document.addEventListener('keydown', unlockTurnAudioOnce, { once: true });

/* ------------------------------------------------------------------ */
/*  Uygulama durumu                                                    */
/* ------------------------------------------------------------------ */

const app = {
  state: null,
  setup: null,
  setupKey: '',
  playKey: '',
  teamPlayKey: '',
  submitting: false,
  partnerTyping: false,
  skew: 0,
  lastGuessSentAt: 0,
  usedQuestions: new Set(),
  listCategory: 'karisik',
  prevState: null,
  transitionTimer: null,
  homeMode: 'text',
  teamCount: 2,
  unoPlayers: 2,
  unoMyTurn: false,
  baseUrl: location.origin,
  joinTeam: 0,
  inviteCode: '',
  inviteTeam: 0,
};

let currentScreen = 'home';

const voice = {
  active: false,
  muted: false,
  localStream: null,
  pc: null,
  remoteStream: null,
  pendingCandidates: [],
  audioBlocked: false,
};

function voiceSecure() {
  return (
    location.protocol === 'https:' ||
    ['localhost', '127.0.0.1'].includes(location.hostname)
  );
}

function voiceSupported() {
  return Boolean(navigator.mediaDevices && window.RTCPeerConnection);
}

function updateVoiceUi() {
  const s = app.state;
  const manyUno = Boolean(s && s.mode === 'uno' && s.players && s.players.length > 2);
  const inRoom = Boolean(s && s.code && s.mode !== 'team' && !manyUno);
  document.body.classList.toggle('in-room', inRoom);

  const fab = $('voiceFab');
  if (fab) {
    fab.hidden = !inRoom;
    fab.classList.toggle('on', voice.active && !voice.muted);
    fab.classList.toggle('muted', voice.active && voice.muted);
  }
  const icon = $('voiceFabIcon');
  if (icon) icon.textContent = voice.muted ? '🔇' : '🎙️';
  const dot = $('voiceFabDot');
  if (dot) {
    dot.className =
      'voice-dot' +
      (voice.pc && voice.pc.connectionState === 'connected' ? ' connected' : '');
  }

  const rival = s && s.players ? s.players.find((p) => !p.isMe) : null;
  const connected = Boolean(voice.pc && voice.pc.connectionState === 'connected');
  const status = $('voiceStatus');
  const joinBtn = $('voiceJoinBtn');
  const muteBtn = $('voiceMuteBtn');
  const leaveBtn = $('voiceLeaveBtn');
  const unlockBtn = $('voiceUnlockBtn');

  let text = 'Mikrofon kapalı. Sesli sohbet için başlat.';
  if (voice.active) {
    if (!rival) text = 'Rakibin odada değil.';
    else if (!rival.voice) text = 'Mikrofonun açık. Rakibinin katılmasını bekliyorsun.';
    else if (connected) text = 'Sesli sohbet bağlı. 🎙️';
    else text = 'Bağlanıyor…';
    if (voice.muted) text = 'Mikrofonun sessizde.';
  }
  if (voice.audioBlocked) text += ' Sesi duymak için “Sesi aç”a bas.';
  if (status) status.textContent = text;
  if (joinBtn) joinBtn.hidden = voice.active;
  if (muteBtn) {
    muteBtn.hidden = !voice.active;
    muteBtn.textContent = voice.muted ? 'Sesi aç' : 'Sessize al';
  }
  if (leaveBtn) leaveBtn.hidden = !voice.active;
  if (unlockBtn) unlockBtn.hidden = !voice.audioBlocked;
}

function ensureVoicePeer() {
  if (voice.pc) return voice.pc;
  if (!voice.localStream) return null;

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  voice.localStream.getTracks().forEach((track) => pc.addTrack(track, voice.localStream));

  pc.ontrack = (event) => {
    voice.remoteStream = event.streams[0] || null;
    const audio = $('voiceAudio');
    if (audio) {
      audio.srcObject = event.streams[0];
      audio
        .play()
        .then(() => {
          voice.audioBlocked = false;
          updateVoiceUi();
        })
        .catch(() => {
          voice.audioBlocked = true;
          updateVoiceUi();
        });
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('voice_signal', { candidate: event.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (voice.pc === pc && ['failed', 'closed'].includes(pc.connectionState)) {
      closeVoicePeer();
    } else {
      updateVoiceUi();
    }
  };

  voice.pc = pc;
  return pc;
}

async function flushVoiceCandidates() {
  if (!voice.pc || !voice.pc.remoteDescription) return;
  for (const candidate of voice.pendingCandidates.splice(0)) {
    try {
      await voice.pc.addIceCandidate(candidate);
    } catch (_error) {
      /* tek aday atlanabilir */
    }
  }
}

async function maybeStartOffer() {
  const s = app.state;
  if (!voice.active || !s || !s.players || s.me.index !== 0) return;
  const rival = s.players.find((p) => !p.isMe);
  if (!rival || !rival.voice) return;
  if (voice.pc) return;

  const pc = ensureVoicePeer();
  if (!pc) return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice_signal', { sdp: pc.localDescription });
  } catch (_error) {
    toast('Sesli sohbet başlatılamadı.');
  }
}

function closeVoicePeer() {
  if (voice.pc) {
    try {
      voice.pc.close();
    } catch (_error) {
      /* yoksay */
    }
    voice.pc = null;
  }
  voice.pendingCandidates = [];
  voice.remoteStream = null;
  voice.audioBlocked = false;
  const audio = $('voiceAudio');
  if (audio) {
    audio.pause();
    audio.srcObject = null;
  }
  updateVoiceUi();
}

async function startVoice() {
  if (voice.active) return;
  if (!voiceSupported()) {
    toast('Tarayıcı sesli sohbeti desteklemiyor.');
    return;
  }
  if (!voiceSecure()) {
    toast('Sesli sohbet için HTTPS gerekir. Yayındaki adresi kullan.');
    return;
  }

  try {
    voice.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (_error) {
    toast('Mikrofon izni verilmedi. Tarayıcıdan izin vermelisin.');
    return;
  }

  voice.active = true;
  voice.muted = false;
  socket.emit('voice_join');
  updateVoiceUi();
  maybeStartOffer();
}

function stopVoice() {
  if (!voice.active) {
    closeVoicePeer();
    return;
  }
  socket.emit('voice_leave');
  if (voice.localStream) {
    voice.localStream.getTracks().forEach((track) => track.stop());
    voice.localStream = null;
  }
  voice.active = false;
  voice.muted = false;
  closeVoicePeer();
  updateVoiceUi();
}

function toggleVoiceMute() {
  if (!voice.active || !voice.localStream) return;
  const track = voice.localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  voice.muted = !track.enabled;
  updateVoiceUi();
}

function unlockVoiceAudio() {
  const audio = $('voiceAudio');
  if (!audio) return;
  audio
    .play()
    .then(() => {
      voice.audioBlocked = false;
      updateVoiceUi();
    })
    .catch(() => {
      /* yoksay */
    });
}

function syncVoiceState(state) {
  if (!voice.active) {
    updateVoiceUi();
    return;
  }
  if (!state || !state.players || state.players.length < 2) {
    stopVoice();
    return;
  }
  const rival = state.players.find((p) => !p.isMe);
  if (!rival || !rival.voice) {
    closeVoicePeer();
    updateVoiceUi();
    return;
  }
  maybeStartOffer();
  updateVoiceUi();
}

function showScreen(name) {
  if (currentScreen === name) return;
  currentScreen = name;
  document.querySelectorAll('.screen').forEach((section) => {
    section.classList.toggle('active', section.id === 'screen-' + name);
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  document.dispatchEvent(new CustomEvent('screenchange', { detail: { name } }));
}

function goHome() {
  stopVoice();
  app.state = null;
  app.setup = null;
  app.setupKey = '';
  app.playKey = '';
  app.teamPlayKey = '';
  app.submitting = false;
  app.usedQuestions = new Set();
  app.prevState = null;
  app.unoMyTurn = false;
  clearTimeout(app.transitionTimer);
  $('transition').hidden = true;
  $('pausedOverlay').hidden = true;
  $('listModal').hidden = true;
  $('teamInviteModal').hidden = true;
  $('modeHelpModal').hidden = true;
  $('unoColorModal').hidden = true;
  $('voicePanel').hidden = true;
  showScreen('home');
  if (location.search) {
    history.replaceState(null, '', location.pathname);
  }
  updateVoiceUi();
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
  if (voice.active) stopVoice();
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
  syncVoiceState(state);
});

socket.on('toast', ({ text }) => {
  if (text) toast(text);
});

socket.on('partner_typing', ({ active }) => {
  app.partnerTyping = Boolean(active);
  updateTypingIndicator();
});

socket.on('voice_signal', async ({ sdp, candidate } = {}) => {
  if (!voice.active || !voice.localStream) return;
  try {
    if (sdp) {
      const pc = ensureVoicePeer();
      if (!pc) return;
      if (sdp.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushVoiceCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice_signal', { sdp: pc.localDescription });
      } else if (sdp.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await flushVoiceCandidates();
      }
    } else if (candidate) {
      if (!voice.pc || !voice.pc.remoteDescription) {
        voice.pendingCandidates.push(candidate);
      } else {
        await voice.pc.addIceCandidate(candidate);
      }
    }
  } catch (_error) {
    /* sinyal hatası görmezden gelinir */
  }
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
    if (s.mode === 'team') {
      showScreen('teamLobby');
      renderTeamLobby();
    } else {
      showScreen('lobby');
      renderLobby();
    }
  } else if (s.mode === 'team') {
    routeTeam(s);
  } else if (s.mode === 'hangman') {
    routeHangman(s);
  } else if (s.mode === 'truefalse') {
    routeQuiz(s);
  } else if (s.mode === 'uno') {
    routeUno(s);
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
    s.mode !== 'team' &&
    ['play', 'reveal', 'ask', 'guess'].includes(s.phase) &&
    rival &&
    !rival.connected;
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
  if (s.phase === 'reveal') {
    showScreen('play');
    renderHangmanReveal(s);
    return;
  }
  if (s.phase === 'ask') {
    showScreen('play');
    renderHangmanAsk(s);
    return;
  }
  showScreen('play');
  renderHangmanGuess(s);
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

function renderHangmanAsk(s) {
  const h = s.hangman;
  $('playTitle').textContent = 'Adam Asmaca';
  $('playCounter').textContent = `Soru ${h.number}/${h.total}`;

  if (!h.isMyAsk) {
    $('playBody').innerHTML = `
      ${scorebarHtml(s)}
      <div class="turn-banner wait">⏳ <b>Sıra ${esc(h.askerName)}'de.</b> Soru hazırlıyor.</div>
      <div class="card waiting-card">
        <span class="big">✍️</span>
        <h3>${esc(h.askerName)} soru hazırlıyor…</h3>
        <p>Soru gelince harf harf tahmin edeceksin.</p>
      </div>
    `;
    return;
  }

  const suggestions = suggestionsFor('karisik', 3, []);
  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="guide">
      <span class="g-emoji">✍️</span>
      <div>
        <b>Şimdi senin sıran: bir soru sor.</b>
        <p>Kendinle ilgili bir soru yaz ve doğru cevabını ekle. Rakibin harf harf tahmin edecek.</p>
      </div>
    </div>
    <div class="card">
      <label class="field-label" for="askQ">Sorun</label>
      <input id="askQ" type="text" maxlength="120" placeholder="Örn. En sevdiğim renk ne?" />

      <div class="suggest-head"><span>Öneriler</span></div>
      <div class="chip-list">
        ${suggestions
          .map(
            (q) =>
              `<button type="button" class="suggest-chip" data-action="askSuggest" data-q="${esc(q)}">${esc(q)}</button>`
          )
          .join('')}
      </div>

      <label class="field-label" for="askA">Doğru cevap</label>
      <input id="askA" type="text" maxlength="60" placeholder="Örn. Mavi" />
      <p class="hint">Cevap 2-16 harf olmalı. Rakibin 6 canla harf harf tahmin edecek.</p>
      <p class="hint error" id="askError" hidden></p>
      <button type="button" class="btn btn-primary btn-block" data-action="submitAsk" style="margin-top:12px">
        Soruyu gönder 💌
      </button>
    </div>
  `;

  const askQuestion = $('askQ');
  const askAnswer = $('askA');
  if (askQuestion && askAnswer) {
    askQuestion.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        askAnswer.focus();
      }
    });
    askAnswer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitHangmanAsk();
      }
    });
  }
}

function renderHangmanGuess(s) {
  const h = s.hangman;
  $('playTitle').textContent = 'Adam Asmaca';
  $('playCounter').textContent = `Soru ${h.number}/${h.total}`;

  const banner = h.isMyGuess
    ? `<div class="turn-banner go">🎯 <b>Sıra sende!</b> ${esc(genitive(h.askerName))} cevabını harf harf bul.</div>`
    : `<div class="turn-banner wait">⏳ <b>Sıra ${esc(h.guesserName)}'de.</b> Senin sorunu harf harf çözüyor.</div>`;

  const wrong = h.wrong.length
    ? `<div class="hm-wrong">Yanlış harfler: ${h.wrong.map((l) => esc(l)).join(' ')}</div>`
    : '';

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    ${banner}
    <div class="card question-card">
      <div class="q-owner">💬 ${esc(genitive(h.askerName))} sorusu</div>
      <h2 class="question-text">${esc(h.question)}</h2>
      ${hangmanMaskHtml(h.mask)}
      <div class="hm-lives">${hangmanHearts(h.lives)}<span>${h.lives} can</span></div>
      ${wrong}
    </div>
    ${
      h.isMyGuess
        ? `<div class="card guess-box">
             <div class="guess-label">Bir harf seç</div>
             ${hangmanKeyboardHtml(h, true)}
           </div>`
        : `<div class="card">
             <div class="owner-wait">
               <div class="avatar alt">${esc(initial(h.guesserName))}</div>
               <p>${esc(h.guesserName)} harf seçiyor…</p>
               <div class="typing">
                 <span class="b"></span><span class="b"></span><span class="b"></span>
               </div>
             </div>
           </div>`
    }
  `;
}

function renderHangmanReveal(s) {
  const h = s.hangman;
  $('playTitle').textContent = 'Adam Asmaca';
  $('playCounter').textContent = `Soru ${h.number}/${h.total}`;

  const solved = Boolean(h.solved);
  const title = h.isMyGuess
    ? solved
      ? 'Bildin!'
      : 'Bilemedin'
    : solved
      ? `${esc(h.guesserName)} bildi!`
      : `${esc(h.guesserName)} bilemedi`;
  const pointsText = h.points > 0 ? `+${h.points} puan` : '0 puan';

  const readyNote = s.readyNext
    ? `${esc(s.rivalName || 'Rakibin')} de basınca devam edilecek…`
    : `İkiniz de Devam’a basınca ${
        h.number >= 2 ? 'tur sonuçları gelecek' : `${h.number + 1}. soruya geçilecek`
      }.`;

  $('playBody').innerHTML = `
    ${scorebarHtml(s)}
    <div class="card question-card">
      <div class="verdict">
        <span class="verdict-emoji">${solved ? '🎯' : '🤔'}</span>
        <h2>${title}</h2>
        <span class="points ${h.points > 0 ? '' : 'zero'}">${pointsText}</span>
      </div>
      <p class="q-sub" style="margin-top:14px">${esc(h.question)}</p>
      ${hangmanMaskHtml(h.mask)}
      <div class="hm-lives">${hangmanHearts(h.lives)}<span>${h.lives} can</span></div>
      ${
        h.wrong.length
          ? `<div class="hm-wrong">Yanlış harfler: ${h.wrong.map((l) => esc(l)).join(' ')}</div>`
          : ''
      }
      <div class="compare" style="grid-template-columns:1fr">
        <div class="compare-item truth">
          <span>Doğru cevap</span>
          <p>${esc(h.answer)}</p>
        </div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" data-action="continueReveal" ${
      s.readyNext ? 'disabled' : ''
    }>${s.readyNext ? 'Rakibin bekleniyor…' : 'Devam →'}</button>
    <p class="ready-note">${readyNote}</p>
  `;
}

function renderHangmanRoundEnd(s) {
  const r = s.results;
  $('roundTitle').textContent = `Tur ${s.round} bitti`;

  const playersWithRound = r.players.map((p, i) => ({
    ...p,
    round: s.players[i] ? s.players[i].roundScore : 0,
  }));

  const readyBtn = s.readyNext
    ? `<button class="btn btn-primary" disabled>Rakibin bekleniyor…</button>`
    : `<button class="btn btn-primary" data-action="nextRound">Sonraki tur →</button>`;

  $('roundBody').innerHTML = `
    <div class="card" style="text-align:center;padding:20px">
      <div style="font-size:2.2rem">🎉</div>
      <h2 style="margin:0;font-size:1.3rem">Tur ${s.round} tamam!</h2>
      <p class="hint" style="margin-top:6px">Bir soru sen, bir soru rakibin. İşte sonuçlar.</p>
    </div>

    ${scoreCardsHtml({ players: playersWithRound }, true)}

    <div class="btn-row">
      ${readyBtn}
      <button class="btn btn-ghost" data-action="endGame">Bitir</button>
    </div>
    <p class="ready-note">${
      s.readyNext
        ? 'Sen hazırsın. Rakibin de basınca yeni tur gelecek.'
        : s.otherReadyNext
          ? 'Rakibin hazır! Sen de “Sonraki tur”a bas.'
          : 'Yeni tur için ikiniz de “Sonraki tur”a basın.'
    }</p>

    <div class="section-title">Bu turun soruları</div>
    ${hangmanEntriesHtml(r.roundEntries)}
  `;
}

function hangmanEntriesHtml(entries) {
  if (!entries.length) return '<p class="hint">Henüz soru yok.</p>';
  return `<div class="result-list">
    ${entries
      .map(
        (e) => `<div class="result-item">
          <div class="mark ${e.solved ? 'ok' : 'no'}">${e.solved ? '✅' : '✖'}</div>
          <div class="ri-body">
            <div class="ri-q"><span class="ri-no">${esc(e.index)}.</span> ${esc(e.question)}</div>
            <div class="ri-a">Tur ${esc(e.round)} · ${esc(e.askerName)} sordu · ${esc(
          e.guesserName
        )} +${e.points} puan · Doğru: <b>${esc(e.answer)}</b></div>
          </div>
        </div>`
      )
      .join('')}
  </div>`;
}

function submitHangmanAsk() {
  const s = app.state;
  if (!s || s.mode !== 'hangman' || s.phase !== 'ask' || !s.hangman || !s.hangman.isMyAsk) {
    return;
  }
  const question = ($('askQ') && $('askQ').value ? $('askQ').value : '').trim();
  const answer = ($('askA') && $('askA').value ? $('askA').value : '').trim();
  const errorBox = $('askError');

  const fail = (message) => {
    if (errorBox) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    } else {
      toast(message);
    }
  };

  if (question.length < 3) return fail('Önce sorunu yaz.');
  const letters = answer.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '').length;
  if (letters < 2 || letters > 16) {
    return fail('Cevap 2-16 harf arasında olmalı.');
  }

  socket.emit('hangman_ask', { text: question, answer });
  const button = document.querySelector('[data-action="submitAsk"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Gönderiliyor…';
  }
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
    ${timerHtml(s.guessSeconds)}
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
              q.otherAnswered ? 'Rakibin de cevapladı, sonuç geliyor…' : 'Rakibin bekleniyor…'
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
    ? `${esc(s.rivalName || 'Rakibin')} de basınca devam edilecek…`
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
        <span class="verdict-emoji">${myCorrect ? '🎯' : '🤔'}</span>
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
    }>${s.readyNext ? 'Rakibin bekleniyor…' : 'Devam →'}</button>
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
    ? `<button class="btn btn-primary" disabled>Rakibin bekleniyor…</button>`
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
        ? 'Sen hazırsın. Rakibin de basınca yeni ifadeler gelecek.'
        : s.otherReadyNext
          ? 'Rakibin hazır! Sen de “Sonraki 10 soru”ya bas.'
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

    <div class="section-title">${isQuiz ? 'Tüm ifadeler' : 'Sorular'}</div>
    ${isQuiz ? quizEntriesHtml(r.entries, s.players) : hangmanEntriesHtml(r.entries)}

    <div class="btn-row" style="margin-top:20px">
      <button class="btn btn-primary" data-action="playAgain" ${
        s.readyNext ? 'disabled' : ''
      }>${s.readyNext ? 'Rakibin bekleniyor…' : 'Yeniden oyna'}</button>
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

  const capacity = s.mode === 'uno' ? s.maxPlayers || 4 : 2;
  const waiting =
    s.players.length < capacity
      ? `<div class="player waiting">${
          s.mode === 'uno' ? 'Diğer oyuncular bekleniyor…' : 'Rakibin bekleniyor…'
        }</div>`
      : '';

  $('lobbyPlayers').innerHTML = players + waiting;

  const startBtn = $('lobbyStartBtn');
  if (startBtn) {
    startBtn.hidden = !(s.mode === 'uno' && s.isHost);
    startBtn.disabled = s.players.length < 2;
    startBtn.textContent = `Oyunu başlat (${s.players.length}/${capacity})`;
  }

  $('qrImg').src = `/qr.svg?oda=${encodeURIComponent(s.code)}`;
  $('shareBtn').textContent = navigator.share ? 'Paylaş' : 'WhatsApp';
  $('lobbyFoot').textContent =
    s.mode === 'uno'
      ? `${s.players.length}/${capacity} oyuncu hazır. ${
          s.isHost
            ? s.players.length >= 2
              ? 'Başlatabilirsin.'
              : 'En az 2 oyuncu gerekli.'
            : 'Oda sahibi başlatabilir.'
        }`
      : s.mode === 'text'
        ? 'İkiniz de hazır olduğunuzda sorular başlıyor.'
        : 'Rakibin katılınca oyun otomatik başlıyor.';
}

function openModeHelp(mode) {
  const info = MODE_HELP[mode] || MODE_HELP.text;
  $('modeHelpEmoji').textContent = info.emoji;
  $('modeHelpMeta').textContent = info.meta;
  $('modeHelpTitle').textContent = `${info.title} nasıl oynanır?`;
  $('modeHelpBody').innerHTML = `
    <p class="mode-help-intro">${esc(info.intro)}</p>
    <ul class="mode-help-points">
      ${info.points.map((point) => `<li>${esc(point)}</li>`).join('')}
    </ul>
  `;
  $('modeHelpModal').hidden = false;
}

/* ------------------------------------------------------------------ */
/*  Takımlar Kapışması                                                 */
/* ------------------------------------------------------------------ */

function routeTeam(s) {
  if (!s.teams) return;
  if (s.phase === 'teamPlay') {
    showScreen('play');
    renderTeamPlay(s);
    return;
  }
  if (s.phase === 'teamReveal') {
    showScreen('play');
    renderTeamReveal(s);
    return;
  }
  if (s.phase === 'teamRoundEnd') {
    showScreen('roundEnd');
    renderTeamRoundEnd(s);
    return;
  }
  if (s.phase === 'final') {
    showScreen('final');
    renderTeamFinal(s);
  }
}

function activeTeamIndexes(s) {
  if (s.teamIds && s.teamIds.length) return s.teamIds;
  return (s.teams || []).filter((t) => t.complete).map((t) => t.index);
}

function teamScoresHtml(s) {
  const ids = activeTeamIndexes(s);
  return `<div class="team-scorebar">${ids
    .map((id) => {
      const t = (s.teams || []).find((x) => x.index === id);
      if (!t) return '';
      return `<div class="team-score ${t.isMine ? 'mine' : ''}">
        <span class="ts-name">${esc(t.name)}</span>
        <b class="ts-score">${t.score}</b>
      </div>`;
    })
    .join('')}</div>`;
}

function renderTeamLobby() {
  const s = app.state;
  if (!s || s.mode !== 'team') return;
  app.teamPlayKey = '';

  $('teamCode').textContent = s.code;
  const isHost = Boolean(s.isHost);
  const completeCount = (s.teams || []).filter((t) => t.complete).length;

  $('teamList').innerHTML = (s.teams || [])
    .map((t) => {
      let membersHtml = '<span class="team-member off">Henüz kimse yok</span>';
      if (t.members && t.members.length) {
        membersHtml = t.members
          .map(
            (m) => `<span class="team-member ${m.connected ? '' : 'off'}">${esc(m.name)}${
              m.isMe ? ' <em>(sen)</em>' : ''
            }</span>`
          )
          .join('');
      }
      const waiting = t.complete
        ? ''
        : `<span class="team-member ghost">2. oyuncu bekleniyor…</span>`;
      const inviteBtn =
        isHost && !t.complete
          ? `<button type="button" class="btn btn-small team-invite-btn" data-action="teamInvite" data-team="${t.index}">Davet et</button>`
          : '';
      return `<div class="team-card ${t.isMine ? 'mine' : ''} ${t.complete ? 'complete' : ''}">
        <div class="team-card-head">
          <div class="team-card-title">
            <span class="team-badge">Takım ${t.index}</span>
            <b>${t.complete ? esc(t.name) : t.members.length ? `${esc(t.members[0].name)} + 1` : 'Boş takım'}</b>
          </div>
          <span class="team-state ${t.complete ? 'ok' : ''}">${t.complete ? 'Hazır' : 'Oyuncu bekliyor'}</span>
        </div>
        <div class="team-members">${membersHtml}${waiting}</div>
        ${inviteBtn}
      </div>`;
    })
    .join('');

  const startBtn = $('teamStartBtn');
  if (startBtn) {
    startBtn.hidden = !isHost;
    startBtn.disabled = !s.canStart;
    startBtn.textContent = s.canStart
      ? s.teamCount === 3 && completeCount === 2
        ? '2 takım ile başlat'
        : 'Oyunu başlat'
      : 'Oyuncular bekleniyor…';
  }

  $('teamStartHint').textContent = isHost
    ? s.canStart
      ? `${completeCount} takım hazır. Başlatabilirsin.`
      : 'En az 2 takım ve her takımda 2 oyuncu olmalı. Davetleri gönder.'
    : 'Oda sahibi başlatınca oyun başlar.';
}

function teamInviteLink(teamIndex) {
  const s = app.state;
  if (!s) return '';
  const base = (app.baseUrl || location.origin).replace(/\/$/, '');
  return `${base}/?oda=${encodeURIComponent(s.code)}&takim=${teamIndex}`;
}

function openTeamInvite(teamIndex) {
  const s = app.state;
  const index = Number(teamIndex) || 0;
  if (!s || s.mode !== 'team' || index < 1) return;
  app.inviteTeam = index;
  const team = (s.teams || []).find((t) => t.index === index);
  $('teamInviteTitle').textContent = team && team.members.length
    ? `${index}. takım daveti · ${team.members.map((m) => m.name).join(' & ')}`
    : `${index}. takım daveti`;
  $('teamInviteQr').src = `/qr.svg?oda=${encodeURIComponent(s.code)}&takim=${index}`;
  $('teamInviteLink').textContent = teamInviteLink(index);
  const note = $('teamInviteNote');
  if (note) {
    note.textContent =
      team && team.isMine
        ? 'Bu bağlantıyı takım arkadaşına gönder; ikinci oyuncu olarak senin takımına katılsın.'
        : 'İki takım arkadaşı da bu bağlantıyı kullanmalı. Biri ilk, diğeri ikinci oyuncu olarak aynı takıma katılır.';
  }
  $('teamInviteModal').hidden = false;
}

async function shareTeamInvite() {
  const link = teamInviteLink(app.inviteTeam);
  if (!link) return;
  const text = `Seni Tanıyorum — ${app.inviteTeam}. takım daveti ✨\nAynı bağlantıyla ikiniz de katılın:`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Takımlar Kapışması', text, url: link });
      return;
    } catch (_error) {
      /* kullanıcı iptal etti */
    }
  }
  window.open(
    `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
    '_blank',
    'noopener'
  );
}

async function copyTeamInvite() {
  const link = teamInviteLink(app.inviteTeam);
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    toast('Takım daveti kopyalandı ✨');
  } catch {
    const area = document.createElement('textarea');
    area.value = link;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('Takım daveti kopyalandı ✨');
  }
}

function renderTeamPlay(s) {
  const q = s.teamQuestion;
  if (!q) return;

  $('playTitle').textContent = 'Takımlar Kapışması';
  $('playCounter').textContent = `Soru ${q.number}/${q.total}`;

  const myTeam = (s.teams || []).find((t) => t.isMine);
  const partner = q.partnerName || 'Takım arkadaşın';
  const answered = q.myAnswer !== null && q.myAnswer !== undefined;
  const key = `team:${s.round}:${q.number}:${
    answered ? `a:${q.partnerAnswered}:${q.answeredCount}` : 'input'
  }`;
  if (app.teamPlayKey === key) return;
  app.teamPlayKey = key;

  $('playBody').innerHTML = `
    ${teamScoresHtml(s)}
    ${timerHtml(45)}
    <div class="card question-card">
      <div class="q-owner">${esc(q.category || 'Birlikte')}</div>
      <h2 class="question-text">${esc(q.text)}</h2>
      <p class="q-sub">${
        myTeam && myTeam.name ? esc(myTeam.name) : 'Takımın'
      } olarak ikiniz de aynı cevabı vermeye çalışın.</p>
    </div>
    <div class="card guess-box">
      ${
        answered
          ? `<div class="team-answered">
              <div class="answer-chip"><span>Senin cevabın</span><b>${esc(q.myAnswer)}</b></div>
              <p class="team-wait">${
                q.partnerAnswered
                  ? `Takım arkadaşın ${esc(partner)} de cevapladı.`
                  : `Takım arkadaşın ${esc(partner)} bekleniyor…`
              }</p>
              <p class="hint">${q.answeredCount}/${q.playerCount} oyuncu cevapladı. Tüm takımlar bitince sonuç açıklanacak.</p>
            </div>`
          : `<label class="field-label" for="teamAnswer">Cevabın</label>
             <input id="teamAnswer" type="text" class="input" maxlength="60" placeholder="Kısa bir cevap yaz…" autocomplete="off" />
             <button type="button" class="btn btn-primary btn-block" data-action="teamAnswer">Cevapla ✨</button>
             <p class="hint center">Takım arkadaşınla aynı cevabı vermelisin. Kısa yaz.</p>`
      }
    </div>
    ${s.isHost ? '<button type="button" class="link-btn team-end-link" data-action="teamEnd">Oyunu bitir</button>' : ''}
  `;

  const input = $('teamAnswer');
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendTeamAnswer();
      }
    });
    setTimeout(() => input.focus(), 50);
  }
  updateTimer();
  updateVoiceUi();
}

function renderTeamReveal(s) {
  const q = s.teamQuestion;
  if (!q) return;
  app.teamPlayKey = '';

  const myTeam = (s.teams || []).find((t) => t.isMine);
  const results = q.results || [];
  const myResult = myTeam ? results.find((r) => r.team === myTeam.index) : null;
  const matched = Boolean(myResult && myResult.matched);

  $('playTitle').textContent = 'Takımlar Kapışması';
  $('playCounter').textContent = `Soru ${q.number}/${q.total}`;

  $('playBody').innerHTML = `
    ${teamScoresHtml(s)}
    <div class="card question-card">
      <div class="verdict">
        <span class="verdict-emoji">${matched ? '🎯' : '🤔'}</span>
        <h2>${matched ? 'Aynı cevabı verdiniz!' : 'Bu kez olmadı'}</h2>
        <p class="q-sub">${esc(q.text)}</p>
      </div>
      <div class="team-results">
        ${results
          .map(
            (r) => `<div class="team-result ${r.matched ? 'ok' : 'no'} ${
              myTeam && r.team === myTeam.index ? 'mine' : ''
            }">
              <div class="tr-head">
                <b>${esc(r.name)}</b>
                <span class="tr-badge">${r.matched ? `Aynı cevap +${r.points}` : 'Farklı cevaplar'}</span>
              </div>
              <div class="tr-answers">
                ${[0, 1]
                  .map(
                    (i) => `<div class="tr-answer">
                      <span>${esc((r.names && r.names[i]) || '')}</span>
                      <p>${esc((r.answers && r.answers[i]) || '—')}</p>
                    </div>`
                  )
                  .join('')}
              </div>
            </div>`
          )
          .join('')}
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-block" data-action="teamContinue">Devam →</button>
    <p class="ready-note">İlk basan geçer; 12 saniye içinde otomatik geçilir.</p>
    ${s.isHost ? '<button type="button" class="link-btn team-end-link" data-action="teamEnd">Oyunu bitir</button>' : ''}
  `;
  updateVoiceUi();
}

function teamScoresGridHtml(teams, best) {
  return `<div class="team-score-grid">${(teams || [])
    .map(
      (t) => `<div class="team-score-card ${t.score === best ? 'win' : ''}">
        <span class="tsc-name">${esc(t.name)}</span>
        <b class="tsc-score">${t.score}</b>
        <span class="tsc-sub">puan</span>
      </div>`
    )
    .join('')}</div>`;
}

function teamEntryListHtml(entries) {
  if (!entries || !entries.length) return '<p class="hint">Henüz soru yok.</p>';
  return entries
    .map(
      (e) => `<div class="result-item team-entry">
        <div class="mark">${e.index}</div>
        <div class="ri-body">
          <div class="ri-q">${esc(e.question)}</div>
          <div class="team-entry-row">${(e.results || [])
            .map(
              (r) =>
                `<span class="entry-team ${r.matched ? 'ok' : 'no'}">${esc(r.name)}: ${
                  r.matched ? `✓ +${r.points}` : '✗'
                }</span>`
            )
            .join('')}</div>
        </div>
      </div>`
    )
    .join('');
}

function renderTeamRoundEnd(s) {
  const r = s.results;
  if (!r) return;
  app.teamPlayKey = '';
  const teams = r.teams || [];
  const best = Math.max(0, ...teams.map((t) => t.score));

  $('roundTitle').textContent = `${s.round}. tur bitti`;
  $('roundBody').innerHTML = `
    <div class="card round-summary">
      <span class="rs-emoji">✨</span>
      <h2>10 soru tamamlandı</h2>
      <p class="muted">${teams.map((t) => `${esc(t.name)}: ${t.score}`).join(' · ')}</p>
    </div>
    ${teamScoresGridHtml(teams, best)}
    ${
      s.isHost
        ? `<div class="btn-row">
            <button type="button" class="btn btn-primary" data-action="teamNextRound">Sonraki 10 soru</button>
            <button type="button" class="btn btn-ghost" data-action="teamEnd">Bitir</button>
          </div>`
        : '<p class="ready-note">Oda sahibi devam edince yeni tur başlar.</p>'
    }
    <div class="section-title">Bu turun soruları</div>
    ${teamEntryListHtml(r.roundEntries)}
  `;
  updateVoiceUi();
}

function renderTeamFinal(s) {
  const r = s.results;
  if (!r) return;
  app.teamPlayKey = '';
  const teams = r.teams || [];
  const best = Math.max(0, ...teams.map((t) => t.score));
  const winner = r.winners && r.winners.length === 1 ? r.winners[0] : null;

  $('finalBody').innerHTML = `
    <div class="card winner-card">
      <span class="trophy">${winner ? '🏆' : '🤝'}</span>
      <h2>${winner ? `${esc(winner)} kazandı!` : 'Berabere!'}</h2>
      <p class="winner-sub">${
        winner ? 'En çok aynı cevabı veren takım.' : 'Takımlar aynı puanda bitirdi.'
      }</p>
    </div>
    ${teamScoresGridHtml(teams, best)}
    <div class="section-title">Tüm sorular</div>
    ${teamEntryListHtml(r.entries)}
    <div class="btn-row">
      ${
        s.isHost
          ? '<button type="button" class="btn btn-primary" data-action="teamPlayAgain">Yeniden oyna</button>'
          : ''
      }
      <button type="button" class="btn btn-ghost" data-action="leave">Ana sayfa</button>
    </div>
    ${!s.isHost ? '<p class="ready-note">Yeniden oynamak için oda sahibini bekle.</p>' : ''}
  `;
  updateVoiceUi();
}

function sendTeamAnswer() {
  const s = app.state;
  if (!s || s.mode !== 'team' || s.phase !== 'teamPlay' || !s.teamQuestion) return;
  if (s.teamQuestion.myAnswer !== null && s.teamQuestion.myAnswer !== undefined) return;
  const input = $('teamAnswer');
  if (!input) return;
  const value = input.value.trim();
  if (!value) {
    input.focus();
    return;
  }
  socket.emit('team_answer', { answer: value });
  input.disabled = true;
  const btn = document.querySelector('[data-action="teamAnswer"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Gönderiliyor…';
  }
}

/* ------------------------------------------------------------------ */
/*  UNO                                                               */
/* ------------------------------------------------------------------ */

const UNO_COLOR_LABELS = {
  red: 'Kırmızı',
  yellow: 'Sarı',
  green: 'Yeşil',
  blue: 'Mavi',
};

function routeUno(s) {
  if (s.phase !== 'play') app.unoMyTurn = false;
  if (s.phase === 'final') {
    showScreen('final');
    renderUnoFinal(s);
    return;
  }
  if (s.phase === 'unoRoundEnd') {
    showScreen('roundEnd');
    renderUnoRoundEnd(s);
    return;
  }
  showScreen('play');
  renderUno(s);
}

function unoValueFace(card) {
  if (!card) return '';
  if (card.value === 'wild') return '★';
  if (card.value === 'wild4') return '+4';
  if (card.value === 'draw2') return '+2';
  if (card.value === 'skip') return '⊘';
  if (card.value === 'reverse') return '⟲';
  return card.value;
}

function unoCardText(card) {
  if (!card) return '';
  if (card.color === 'wild') {
    return card.value === 'wild4' ? '+4 Joker' : 'Joker';
  }
  const value =
    card.value === 'draw2'
      ? '+2'
      : card.value === 'skip'
        ? 'Pas'
        : card.value === 'reverse'
          ? 'Yön'
          : card.value;
  return `${UNO_COLOR_LABELS[card.color] || ''} ${value}`;
}

function unoCardHtml(card, options = {}) {
  const face = unoValueFace(card);
  const colorClass = card.color === 'wild' ? 'uno-wild' : `uno-${card.color}`;
  const classes = ['uno-card', colorClass];
  if (options.playable) classes.push('playable');
  if (options.className) classes.push(options.className);
  const content = `
    <span class="uno-corner">${face}</span>
    <span class="uno-face">${face}</span>
    <span class="uno-corner bottom">${face}</span>
  `;
  if (options.interactive === false) {
    return `<div class="${classes.join(' ')}" aria-label="${esc(unoCardText(card))}">${content}</div>`;
  }
  return `<button type="button" class="${classes.join(' ')}"
    data-action="unoPlay" data-card="${esc(card.id)}"
    ${options.disabled ? 'disabled' : ''}
    aria-label="${esc(unoCardText(card))}">${content}</button>`;
}

function unoMiniBacks(count) {
  const total = Math.min(4, Math.max(0, count));
  let html = '';
  for (let i = 0; i < total; i += 1) {
    html += '<span class="uno-back"></span>';
  }
  return html;
}

function renderUno(s) {
  const u = s.uno;
  if (!u) return;

  const becameMyTurn = Boolean(u.myTurn) && !app.unoMyTurn;
  app.unoMyTurn = Boolean(u.myTurn);
  if (becameMyTurn) playTurnCue();

  const myScore = u.players.find((player) => player.isMe)?.score || 0;
  $('playTitle').textContent = 'UNO';
  $('playCounter').textContent = `${u.myCount} kart · ${myScore} p`;

  const playable = new Set(u.playableIds || []);
  const status = u.pendingColor
    ? u.colorChooser
      ? 'Joker için renk seç'
      : `${u.currentPlayerName} renk seçiyor…`
    : `${u.currentPlayerName} oynuyor…`;

  const statusHtml = u.myTurn
    ? `<div class="uno-turn-alert ${becameMyTurn ? 'fresh' : ''}" role="status" aria-live="assertive">
        <b>SIRA SENDE!</b>
        <small>Kart seç veya desteden çek</small>
      </div>`
    : `<div class="uno-status">
        <span class="uno-turn-dot"></span>
        <span>${esc(status)}</span>
      </div>`;

  const hand = u.myHand
    .map((card) =>
      unoCardHtml(card, {
        interactive: true,
        playable: playable.has(card.id),
        disabled: !playable.has(card.id),
      })
    )
    .join('');

  const log = (u.log || [])
    .slice(-3)
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');

  const playerStrip = u.players
    .map(
      (player) => `<div class="uno-player-chip ${player.isMe ? 'me' : ''} ${
        player.current ? 'turn' : ''
      }">
        <span class="uno-chip-avatar">${esc(initial(player.name))}</span>
        <span class="uno-chip-name">${player.isMe ? 'Sen' : esc(player.name)}</span>
        <span class="uno-chip-stats"><b>${player.count}</b> kart · ${player.score} p</span>
        ${player.count === 1 ? '<span class="uno-badge">UNO!</span>' : ''}
      </div>`
    )
    .join('');

  $('playBody').innerHTML = `
    <div class="uno-board ${u.myTurn ? 'my-turn' : ''}">
      <div class="uno-players">${playerStrip}</div>

      <div class="uno-table">
        <button type="button" class="uno-draw" data-action="unoDraw" ${u.myTurn ? '' : 'disabled'}>
          <span class="uno-draw-stack"><i></i><i></i><i></i></span>
          <span class="uno-draw-label">Kart çek</span>
          <small>${u.deckCount} kart</small>
        </button>
        <div class="uno-discard-wrap">
          ${u.top ? unoCardHtml(u.top, { interactive: false, className: 'uno-discard' }) : ''}
          <span class="uno-color-pill ${u.currentColor || 'pending'}">
            ${u.colorName || 'Renk seç'}
          </span>
        </div>
        ${
          u.players.length > 2
            ? `<span class="uno-direction" title="Oyun yönü">${
                u.direction === 1 ? '↻' : '↺'
              }</span>`
            : ''
        }
      </div>

      ${statusHtml}

      ${log ? `<ul class="uno-log">${log}</ul>` : ''}

      <div class="uno-hand-head">
        <span>Elin · ${u.myCount} kart</span>
        <span class="uno-hand-hint">${
          u.myTurn ? 'Kart seç veya desteden çek' : 'Sıranı bekle'
        }</span>
      </div>

      <div class="uno-hand">${hand}</div>
    </div>
  `;

  const colorHand = $('unoColorHand');
  if (colorHand) {
    colorHand.innerHTML = u.myHand
      .map((card) =>
        unoCardHtml(card, {
          interactive: false,
          className: 'uno-color-card',
        })
      )
      .join('');
    const colorHandLabel = $('unoColorHandLabel');
    if (colorHandLabel) colorHandLabel.textContent = `Elin · ${u.myCount} kart`;
  }

  $('unoColorModal').hidden = !u.colorChooser;
  updateVoiceUi();
}

function unoScoreGridHtml(players) {
  return `<div class="uno-score-grid">${players
    .map(
      (player) => `<div class="uno-score-chip ${player.isMe ? 'me' : ''} ${
        player.score >= 500 ? 'win' : ''
      }">
        <span>${player.isMe ? 'Sen' : esc(player.name)}</span>
        <b>${player.score}</b>
        <small>puan</small>
      </div>`
    )
    .join('')}</div>`;
}

function renderUnoRoundEnd(s) {
  const u = s.uno;
  if (!u) return;
  const winner = u.players[u.handWinner] || null;
  const logs = (u.log || [])
    .slice(-4)
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');

  $('roundTitle').textContent = `${u.handNumber}. el bitti`;
  $('roundBody').innerHTML = `
    <div class="card round-summary">
      <span class="rs-emoji">🏁</span>
      <h2>${winner ? `${esc(winner.name)} eli bitirdi!` : 'El bitti'}</h2>
      <p class="muted">+${u.handPoints} puan · 500 puana ulaşan kazanır</p>
    </div>
    ${unoScoreGridHtml(u.players)}
    ${logs ? `<div class="card"><div class="section-title">Son hamleler</div><ul class="uno-log">${logs}</ul></div>` : ''}
    <div class="btn-row">
      <button type="button" class="btn btn-primary" data-action="unoNextHand">Sonraki el</button>
      <button type="button" class="btn btn-ghost" data-action="leave">Ana sayfa</button>
    </div>
    <p class="ready-note">Yeni el, eli kazanan oyuncudan başlar.</p>
  `;
  $('unoColorModal').hidden = true;
  updateVoiceUi();
}

function renderUnoFinal(s) {
  const r = s.results;
  if (!r) return;

  const logs = (r.log || [])
    .slice(-6)
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');

  $('finalBody').innerHTML = `
    <div class="card winner-card">
      <span class="trophy">🏆</span>
      <h2>${esc(r.winner)} kazandı!</h2>
      <p class="winner-sub">500 puana ulaşan oyuncu.</p>
    </div>

    ${unoScoreGridHtml(
      (r.scores || []).map((player) => ({
        name: player.name,
        score: player.score,
        isMe: player.id === s.me.id,
      }))
    )}

    ${logs ? `<div class="card"><div class="section-title">Son hamleler</div><ul class="uno-log">${logs}</ul></div>` : ''}

    <div class="btn-row">
      <button type="button" class="btn btn-primary" data-action="unoRestart">Yeniden oyna</button>
      <button type="button" class="btn btn-ghost" data-action="leave">Ana sayfa</button>
    </div>
    <p class="ready-note">Yeniden oynamak için bir oyuncunun başlatması yeterli.</p>
  `;
  $('unoColorModal').hidden = true;
  updateVoiceUi();
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
  $('introNames').textContent = `${s.me.name} ✨ ${rival ? rival.name : 'Rakibin'}`;
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
      ? 'Kendinle ilgili bir soru ve 2-16 harflik bir cevap yaz. Rakibin harf harf tahmin edecek.'
      : s.mode === 'truefalse'
        ? 'Kendinle ilgili bir soru ve doğru cevabını yaz. Oyun sırasında cevabın “doğru mu, yanlış mı?” diye sorulacak.'
        : 'Kendinle ilgili bir soru ve doğru cevabını yaz. Rakibin cevabı yazarak tahmin edecek.';
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
      <span class="big">✨</span>
      <h3>Soruların hazır! ✅</h3>
      <p>${
        rivalReady
          ? 'İkiniz de hazırsınız. Oyun birazdan başlıyor…'
          : `${esc(rival ? rival.name : 'Rakibin')} henüz yazıyor. O da gönderince oyun otomatik başlayacak.`
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

function timerHtml(seconds) {
  return `
    <div class="timer-wrap">
      <div class="timer-ring">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <linearGradient id="timerGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#34d399"></stop>
              <stop offset="0.55" stop-color="#22d3ee"></stop>
              <stop offset="1" stop-color="#8b5cf6"></stop>
            </linearGradient>
          </defs>
          <circle class="timer-ring-track" cx="24" cy="24" r="20"></circle>
          <circle class="timer-ring-fill" id="timerRing" cx="24" cy="24" r="20" pathLength="100"></circle>
        </svg>
        <span class="timer-text" id="timerText">${seconds} sn</span>
      </div>
      <div class="timer" hidden><div class="timer-fill" id="timerFill"></div></div>
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
  return Array.from({ length: total }, (_, i) => `<span class="${i < lives ? '' : 'off'}">●</span>`).join('');
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
    ? `<div class="q-owner">💬 Senin sorun</div>`
    : `<div class="q-owner">💬 ${esc(genitive(q.ownerName))} sorusu</div>`;

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
                 <button class="btn btn-primary btn-block" id="guessBtn">Cevapla ✨</button>
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
    ${timerHtml(s.guessSeconds)}
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
  if (!s) return;

  const teamPlay = s.mode === 'team' && s.phase === 'teamPlay' && s.teamQuestion;
  if (s.phase !== 'play' && !teamPlay) return;

  let deadline = 0;
  if (teamPlay) {
    deadline = s.teamQuestion.deadline;
  } else if (s.mode === 'text' && s.question) {
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
  const total = teamPlay ? 45 * 1000 : (s.guessSeconds || 45) * 1000;
  const left = Math.max(0, deadline - now);
  const ratio = Math.max(0, Math.min(1, left / total));
  fill.style.width = (ratio * 100).toFixed(1) + '%';
  fill.classList.toggle('low', ratio < 0.3);
  const ring = document.getElementById('timerRing');
  if (ring) {
    ring.style.strokeDashoffset = (100 - ratio * 100).toFixed(2);
    const ringWrap = ring.closest('.timer-ring');
    if (ringWrap) ringWrap.classList.toggle('is-low', left <= 10000);
  }
  text.textContent = Math.ceil(left / 1000) + ' sn';

  const paused = teamPlay
    ? false
    : (s.question && s.question.paused) || (s.quiz && s.quiz.paused) || false;

  if (left <= 0 && !paused) {
    const btn = $('guessBtn');
    if (btn && !btn.disabled) {
      btn.disabled = true;
      btn.textContent = 'Süre bitti ⏰';
    }
    const input = $('guessInput');
    if (input) input.disabled = true;
    const teamInput = $('teamAnswer');
    if (teamInput) teamInput.disabled = true;
    document.querySelectorAll('[data-action="teamAnswer"]').forEach((el) => {
      el.disabled = true;
      el.textContent = 'Süre bitti ⏰';
    });
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

  let emoji = '🤔';
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
    emoji = correct ? '🎯' : '🤔';
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
    emoji = '🤔';
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
    ? `${esc(s.rivalName || 'Rakibin')} de basınca devam edilecek…`
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
    }>${s.readyNext ? 'Rakibin bekleniyor…' : 'Devam →'}</button>
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
    ? `<button class="btn btn-primary" disabled>Rakibin bekleniyor…</button>`
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
        ? 'Sen hazırsın. Rakibin de basınca yeni soru ekranı açılacak.'
        : s.otherReadyNext
          ? 'Rakibin hazır! Sen de “Sonraki 5 soru”ya bas.'
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
      }>${s.readyNext ? 'Rakibin bekleniyor…' : 'Yeniden oyna'}</button>
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
    case 'voiceToggle':
      $('voicePanel').hidden = !$('voicePanel').hidden;
      updateVoiceUi();
      break;
    case 'voiceClose':
      $('voicePanel').hidden = true;
      break;
    case 'voiceJoin':
      startVoice();
      break;
    case 'voiceMute':
      toggleVoiceMute();
      break;
    case 'voiceLeave':
      stopVoice();
      break;
    case 'voiceUnlock':
      unlockVoiceAudio();
      break;
    case 'leave':
      leaveRoom(
        app.state &&
          ['setup', 'play', 'reveal', 'roundEnd'].includes(app.state.phase)
      );
      break;
    case 'help':
      $('helpModal').hidden = false;
      break;
    case 'modeHelp':
      openModeHelp(btn.dataset.mode);
      break;
    case 'closeModeHelp':
      $('modeHelpModal').hidden = true;
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
      app.homeMode = ['text', 'hangman', 'truefalse', 'team', 'uno'].includes(btn.dataset.mode)
        ? btn.dataset.mode
        : 'text';
      document
        .querySelectorAll('.home-mode')
        .forEach((card) => card.classList.toggle('on', card.dataset.mode === app.homeMode));
      $('modeDesc').textContent = modeOf(app.homeMode).desc;
      const selected = $('modeSelected');
      if (selected) selected.textContent = modeOf(app.homeMode).short;
      const teamRow = $('teamCountRow');
      if (teamRow) teamRow.hidden = app.homeMode !== 'team';
      const unoRow = $('unoCountRow');
      if (unoRow) unoRow.hidden = app.homeMode !== 'uno';
      const badge = $('createPlayersBadge');
      if (badge) {
        badge.textContent =
          app.homeMode === 'team'
            ? `${app.teamCount * 2} kişi`
            : app.homeMode === 'uno'
              ? `${app.unoPlayers} kişi`
              : '2 kişi';
      }
      break;
    case 'pickTeams':
      app.teamCount = Number(btn.dataset.teams) === 3 ? 3 : 2;
      document
        .querySelectorAll('#teamCountRow .team-count')
        .forEach((chip) =>
          chip.classList.toggle('on', Number(chip.dataset.teams) === app.teamCount)
        );
      {
        const badge = $('createPlayersBadge');
        if (badge) badge.textContent = `${app.teamCount * 2} kişi`;
      }
      break;
    case 'pickUnoPlayers':
      app.unoPlayers = Math.min(4, Math.max(2, Number(btn.dataset.players) || 2));
      document
        .querySelectorAll('#unoCountRow .team-count')
        .forEach((chip) =>
          chip.classList.toggle('on', Number(chip.dataset.players) === app.unoPlayers)
        );
      {
        const badge = $('createPlayersBadge');
        if (badge) badge.textContent = `${app.unoPlayers} kişi`;
      }
      break;
    case 'teamStart':
      socket.emit('team_start');
      break;
    case 'teamAnswer':
      sendTeamAnswer();
      break;
    case 'teamContinue':
      btn.disabled = true;
      btn.textContent = 'Geçiliyor…';
      socket.emit('team_continue');
      break;
    case 'teamNextRound':
      btn.disabled = true;
      btn.textContent = 'Bekleniyor…';
      socket.emit('team_next_round');
      break;
    case 'teamEnd':
      socket.emit('team_end');
      break;
    case 'teamPlayAgain':
      btn.disabled = true;
      btn.textContent = 'Bekleniyor…';
      socket.emit('team_play_again');
      break;
    case 'teamInvite':
      openTeamInvite(btn.dataset.team);
      break;
    case 'closeTeamInvite':
      $('teamInviteModal').hidden = true;
      break;
    case 'teamInviteShare':
      shareTeamInvite();
      break;
    case 'teamInviteCopy':
      copyTeamInvite();
      break;
    case 'unoPlay':
      if (!app.state || app.state.mode !== 'uno' || app.state.phase !== 'play') break;
      socket.emit('uno_play', { cardId: btn.dataset.card });
      btn.disabled = true;
      break;
    case 'unoStart':
      socket.emit('uno_start');
      break;
    case 'unoNextHand':
      btn.disabled = true;
      btn.textContent = 'Dağıtılıyor…';
      socket.emit('uno_next_hand');
      break;
    case 'unoDraw':
      socket.emit('uno_draw');
      break;
    case 'unoColor':
      socket.emit('uno_color', { color: btn.dataset.color });
      $('unoColorModal').hidden = true;
      break;
    case 'unoRestart':
      socket.emit('uno_restart');
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
        !app.state.hangman.isMyGuess
      ) {
        break;
      }
      const letter = btn.dataset.letter;
      if (!letter) break;
      btn.disabled = true;
      socket.emit('hangman_letter', { letter });
      break;
    }
    case 'askSuggest': {
      const input = $('askQ');
      if (input) {
        input.value = btn.dataset.q || '';
        input.focus();
      }
      break;
    }
    case 'submitAsk':
      submitHangmanAsk();
      break;
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
  socket.emit('create_room', {
    name,
    mode: app.homeMode,
    teams: app.teamCount,
    players: app.unoPlayers,
  });
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
  const team = app.joinTeam && code === app.inviteCode ? app.joinTeam : undefined;
  socket.emit('join_room', { name, code, team });
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
  const url = `${(app.baseUrl || location.origin).replace(/\/$/, '')}/?oda=${code}`;
  const text = `Seni Tanıyorum ✨ Oda kodum: ${code}\n${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Seni Tanıyorum', text, url });
      return;
    } catch {
      /* kullanıcı vazgeçti */
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
});

$('teamCopyBtn').addEventListener('click', async () => {
  const code = app.state ? app.state.code : '';
  try {
    await navigator.clipboard.writeText(code);
    toast('Oda kodu kopyalandı 💌');
  } catch {
    toast('Kod: ' + code);
  }
});

$('teamShareBtn').addEventListener('click', async () => {
  const s = app.state;
  if (!s) return;
  const url = `${(app.baseUrl || location.origin).replace(/\/$/, '')}/?oda=${s.code}`;
  const text = `Seni Tanıyorum ✨ Takımlar Kapışması odam: ${s.code}\n${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Takımlar Kapışması', text, url });
      return;
    } catch {
      /* kullanıcı vazgeçti */
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
});

$('teamInviteModal').addEventListener('click', (e) => {
  if (e.target === $('teamInviteModal')) $('teamInviteModal').hidden = true;
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
$('modeHelpModal').addEventListener('click', (e) => {
  if (e.target === $('modeHelpModal')) $('modeHelpModal').hidden = true;
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
  const team = Number(params.get('takim')) || 0;
  if (code) $('codeInput').value = code;
  if (team) {
    app.joinTeam = team;
    app.inviteCode = code;
    const note = $('joinTeamNote');
    if (note) {
      note.hidden = false;
      note.textContent = `${team}. takım davetiyle geliyorsun. İsmini yazıp katıl.`;
    }
  }

  const storedName = localStorage.getItem(NAME_KEY);
  if (storedName) $('nameInput').value = storedName;

  if (code && !storedName) {
    setTimeout(() => $('nameInput').focus(), 300);
  }

  const selected = $('modeSelected');
  if (selected) selected.textContent = modeOf(app.homeMode).short;
  const teamRow = $('teamCountRow');
  if (teamRow) teamRow.hidden = app.homeMode !== 'team';
  const unoRow = $('unoCountRow');
  if (unoRow) unoRow.hidden = app.homeMode !== 'uno';

  fetch('/bilgi')
    .then((response) => response.json())
    .then((info) => {
      if (info && typeof info.url === 'string' && info.url.startsWith('http')) {
        app.baseUrl = info.url;
      }
    })
    .catch(() => {
      /* yoksay */
    });

  updateVoiceUi();
})();
