'use strict';

/**
 * Uçtan uca oyun akışı testi.
 * Sunucuyu 3999 portunda ayağa kaldırır, iki sahte oyuncu ile oyunu oynar.
 *
 *   npm test
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3999;
const URL = `http://localhost:${PORT}`;

let failures = 0;
function check(condition, label, extra) {
  if (condition) {
    console.log('  ✔', label);
  } else {
    failures++;
    console.error('  ✘', label, extra === undefined ? '' : extra);
  }
}

function makeClient(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const client = {
    name,
    socket,
    last: null,
    errors: [],
    waiters: [],
  };

  socket.on('state', (state) => {
    client.last = state;
    for (const waiter of [...client.waiters]) {
      if (waiter.predicate(state)) {
        client.waiters.splice(client.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(state);
      }
    }
  });

  socket.on('error_msg', (err) => {
    client.errors.push(err);
    for (const waiter of [...client.waiters]) {
      if (waiter.predicate === null) {
        client.waiters.splice(client.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.reject(new Error(err.message));
      }
    }
  });

  client.wait = (predicate, label = 'state', timeout = 8000) =>
    new Promise((resolve, reject) => {
      if (client.last && predicate(client.last)) return resolve(client.last);
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          client.waiters.splice(client.waiters.indexOf(waiter), 1);
          reject(
            new Error(
              `Zaman aşımı: ${label} (son faz: ${client.last && client.last.phase})`
            )
          );
        }, timeout),
      };
      client.waiters.push(waiter);
    });

  client.waitConnect = () =>
    new Promise((resolve, reject) => {
      if (socket.connected) return resolve();
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

  client.close = () => socket.close();
  return client;
}

const A_ANSWERS = ['kebap', 'mavi', 'futbol', 'kedi', 'deniz'];
const B_ANSWERS = ['pizza', 'yesil', 'basketbol', 'kopek', 'dag'];

function questionsFor(prefix, answers) {
  return answers.map((answer, i) => ({
    text: `${prefix} ${i + 1}. soru: favorim ne?`,
    answer,
    category: 'yemek',
  }));
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d.toString()));
  server.stderr.on('data', (d) => (serverLog += d.toString()));

  await new Promise((r) => setTimeout(r, 1200));

  try {
    const health = await fetch(`${URL}/saglik`).then((r) => r.json());
    check(health.ok === true, 'Sunucu ayakta (/saglik)');

    const info = await fetch(`${URL}/bilgi`).then((r) => r.json());
    check(typeof info.url === 'string' && info.url.startsWith('http'), 'LAN adresi üretiliyor');

    const qr = await fetch(`${URL}/qr.svg?oda=ABC12`);
    const qrBody = await qr.text();
    check(
      qr.ok && qr.headers.get('content-type').includes('svg') && qrBody.includes('<svg'),
      'QR kod SVG olarak üretiliyor'
    );
  } catch (error) {
    failures++;
    console.error('Sunucu kontrolü başarısız:', error.message);
  }

  const ayse = makeClient('Ayşe');
  const ahmet = makeClient('Ahmet');

  try {
    await Promise.all([ayse.waitConnect(), ahmet.waitConnect()]);
    console.log('\n1) Oda kurma ve katılma');

    ayse.socket.emit('create_room', { name: 'Ayşe' });
    const lobby = await ayse.wait((s) => s.phase === 'lobby', 'lobi');
    check(lobby.code.length === 5, 'Oda kodu 5 karakter');
    check(lobby.players.length === 1, 'Odada tek oyuncu var');

    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    await Promise.all([
      ayse.wait((s) => s.phase === 'setup' && s.players.length === 2, 'A setup'),
      ahmet.wait((s) => s.phase === 'setup' && s.players.length === 2, 'B setup'),
    ]);
    check(true, 'İki oyuncu setup fazına geçti');

    console.log('\n2) Soruları hazırlama');
    ayse.socket.emit('submit_questions', { questions: questionsFor('Ayşe', A_ANSWERS) });
    await ayse.wait((s) => s.me.ready === true, 'A hazır');
    check(
      Array.isArray(ayse.last.myQuestions) && ayse.last.myQuestions.length === 5,
      'Gönderilen sorular geri dönüyor'
    );

    ahmet.socket.emit('submit_questions', { questions: questionsFor('Ahmet', B_ANSWERS) });
    await Promise.all([
      ayse.wait((s) => s.phase === 'play', 'oyun başladı A'),
      ahmet.wait((s) => s.phase === 'play', 'oyun başladı B'),
    ]);

    console.log('\n3) 10 soruluk tur');
    const players = { Ayşe: ayse, Ahmet: ahmet };
    const answers = { Ayşe: A_ANSWERS, Ahmet: B_ANSWERS };

    // Beklenen puanlar
    let expected = { Ayşe: 0, Ahmet: 0 };

    for (let step = 0; step < 10; step++) {
      const state = await ahmet.wait(
        (s) => s.phase === 'play' && s.question && s.question.number === step + 1,
        `soru ${step + 1}`
      );
      const question = state.question;
      const owner = question.ownerName;
      const guesser = owner === 'Ayşe' ? 'Ahmet' : 'Ayşe';
      const truth = answers[owner][Math.floor(step / 2)];

      let guess;
      let expectedPoints;
      if (step < 6) {
        guess = truth; // tam isabet
        expectedPoints = 10;
      } else if (step === 6) {
        guess = `cok ${truth} gibi`; // kapsama
        expectedPoints = 8;
      } else if (step === 7) {
        guess = truth.slice(0, Math.max(3, truth.length - 1)); // yakın yazım
        expectedPoints = 8;
      } else {
        guess = 'alakasiz bir sey';
        expectedPoints = 0;
      }

      const guesserClient = players[guesser];
      guesserClient.socket.emit('guess', { answer: guess });

      const reveal = await guesserClient.wait(
        (s) => s.phase === 'reveal' && s.question.number === step + 1,
        `reveal ${step + 1}`
      );
      check(
        reveal.question.points === expectedPoints,
        `Soru ${step + 1}: ${guesser} tahmini "${guess}" → ${reveal.question.points} puan (beklenen ${expectedPoints})`
      );

      expected[guesser] += expectedPoints;

      ayse.socket.emit('ready_next');
      ahmet.socket.emit('ready_next');
    }

    console.log('\n4) Tur sonu');
    const roundEnd = await ayse.wait((s) => s.phase === 'roundEnd', 'tur sonu');
    const aTotal = roundEnd.players.find((p) => p.name === 'Ayşe').score;
    const bTotal = roundEnd.players.find((p) => p.name === 'Ahmet').score;
    check(aTotal === expected.Ayşe, `Ayşe puanı ${aTotal} (beklenen ${expected.Ayşe})`);
    check(bTotal === expected.Ahmet, `Ahmet puanı ${bTotal} (beklenen ${expected.Ahmet})`);
    check(roundEnd.results.roundEntries.length === 10, 'Turda 10 soru kayıtlı');

    console.log('\n5) Sonraki tur');
    ayse.socket.emit('next_round');
    ahmet.socket.emit('next_round');
    const round2 = await ayse.wait((s) => s.phase === 'setup' && s.round === 2, '2. tur setup');
    check(round2.players.every((p) => p.ready === false), 'Yeni turda hazır bayrakları sıfır');

    ayse.socket.emit('submit_questions', { questions: questionsFor('Ayşe2', A_ANSWERS) });
    ahmet.socket.emit('submit_questions', { questions: questionsFor('Ahmet2', B_ANSWERS) });
    await ayse.wait((s) => s.phase === 'play' && s.round === 2, '2. tur başladı');

    for (let step = 0; step < 10; step++) {
      const state = await ahmet.wait(
        (s) => s.phase === 'play' && s.round === 2 && s.question && s.question.number === step + 1,
        `2. tur soru ${step + 1}`
      );
      const guesser = state.question.isMine ? ayse : ahmet;
      guesser.socket.emit('guess', { answer: 'bilmiyorum' });
      await guesser.wait((s) => s.phase === 'reveal', 'reveal 2');
      ayse.socket.emit('ready_next');
      ahmet.socket.emit('ready_next');
    }

    const roundEnd2 = await ayse.wait((s) => s.phase === 'roundEnd' && s.round === 2, '2. tur sonu');
    check(roundEnd2.results.roundEntries.length === 10, '2. turda da 10 soru');

    console.log('\n6) Oyunu bitirme');
    ayse.socket.emit('end_game');
    const final = await ahmet.wait((s) => s.phase === 'final', 'final');
    check(final.results.players.length === 2, 'Finalde iki oyuncu');
    check(
      final.results.entries.length === 20,
      `Tüm geçmiş kayıtlı (${final.results.entries.length}/20)`
    );
    check(typeof final.results.players[0].percent === 'number', 'Uyum yüzdesi hesaplandı');

    console.log('\n7) Yeniden oynama');
    ayse.socket.emit('play_again');
    ahmet.socket.emit('play_again');
    const again = await ayse.wait((s) => s.phase === 'setup' && s.round === 1, 'yeniden oyna');
    check(again.players.every((p) => p.score === 0), 'Puanlar sıfırlandı');

    console.log('\n8) Odadan ayrılma');
    ahmet.socket.emit('leave_room');
    const back = await ayse.wait((s) => s.phase === 'lobby', 'lobiye dönüş');
    check(back.players.length === 1, 'Tek oyuncu kaldı');
    check(back.code === lobby.code, 'Oda kodu korunuyor');
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
  } finally {
    ayse.close();
    ahmet.close();
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) {
    console.log('✅ Tüm testler geçti');
  } else {
    console.log(`❌ ${failures} test başarısız`);
    if (serverLog) console.log('\nSunucu çıktısı:\n' + serverLog);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
