'use strict';

/**
 * Doğru mu Yanlış mı? modu testi.
 * 10 ifadenin 9'unu doğru, 1'ini yanlış cevaplar; puanları ve geçmişi doğrular.
 *
 *   npm run dogruyanlis
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 4003;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (ok, label, extra) => {
  if (ok) console.log('  ✔', label);
  else {
    failures++;
    console.error('  ✘', label, extra === undefined ? '' : extra);
  }
};

const norm = (value) =>
  String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9çğıöşü ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function makeClient(name) {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const client = { name, socket, last: null, waiters: [] };
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
  client.wait = (predicate, label = 'state', timeout = 8000) =>
    new Promise((resolve, reject) => {
      if (client.last && predicate(client.last)) return resolve(client.last);
      const waiter = {
        predicate,
        resolve,
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
  return client;
}

const q = (text, answer) => ({ text, answer, category: 'genel' });

const A_ANSWERS = ['Mavi', 'Kebap', 'Futbol', 'Kedi', 'Deniz'];
const B_ANSWERS = ['Yeşil', 'Çay', 'Basketbol', 'Köpek', 'Dağ'];

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d.toString()));
  server.stderr.on('data', (d) => (serverLog += d.toString()));
  await new Promise((r) => setTimeout(r, 1200));

  const ayse = makeClient('Ayşe');
  const ahmet = makeClient('Ahmet');

  try {
    await Promise.all([ayse.waitConnect(), ahmet.waitConnect()]);
    console.log('\n1) Oda ve sorular');
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'truefalse' });
    const lobby = await ayse.wait((s) => s.phase === 'lobby');
    check(lobby.mode === 'truefalse', 'Oda modu doğru/yanlış');
    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    await Promise.all([
      ayse.wait((s) => s.phase === 'setup'),
      ahmet.wait((s) => s.phase === 'setup'),
    ]);
    check(ayse.last.mode === 'truefalse', 'Katılan oyuncu da modu görüyor');

    ayse.socket.emit('submit_questions', {
      questions: [
        q('En sevdiğim renk?', A_ANSWERS[0]),
        q('En sevdiğim yemek?', A_ANSWERS[1]),
        q('En sevdiğim spor?', A_ANSWERS[2]),
        q('Evcil hayvanım?', A_ANSWERS[3]),
        q('Tatilde deniz mi dağ mı?', A_ANSWERS[4]),
      ],
    });
    ahmet.socket.emit('submit_questions', {
      questions: [
        q('En sevdiğim renk?', B_ANSWERS[0]),
        q('En sevdiğim içecek?', B_ANSWERS[1]),
        q('Hangi takım?', B_ANSWERS[2]),
        q('Hangi hayvan?', B_ANSWERS[3]),
        q('Tatil yerim?', B_ANSWERS[4]),
      ],
    });

    console.log('\n2) 10 ifade');
    let expected = { Ayşe: 0, Ahmet: 0 };

    for (let step = 0; step < 10; step++) {
      const state = await ahmet.wait(
        (s) => s.phase === 'play' && s.question && s.question.number === step + 1,
        `ifade ${step + 1}`
      );
      const ownerA = step % 2 === 0;
      const qIndex = Math.floor(step / 2);
      const truth = (ownerA ? A_ANSWERS : B_ANSWERS)[qIndex];
      const shown = state.question.claim && state.question.claim.shown;
      check(Boolean(shown), `${step + 1}. ifade gösteriliyor`, shown);
      check(
        state.question.claim.isTrue === undefined,
        `${step + 1}. ifadede cevap sızdırılmıyor`
      );

      const isTrue = norm(shown) === norm(truth);
      const decideCorrect = step !== 2; // 3. ifadeyi bilerek yanlış cevapla
      const value = decideCorrect ? isTrue : !isTrue;
      const guesser = ownerA ? ahmet : ayse;
      guesser.socket.emit('truefalse_answer', { value });

      const reveal = await guesser.wait(
        (s) =>
          s.phase === 'reveal' &&
          s.question &&
          s.question.number === step + 1,
        `reveal ${step + 1}`
      );
      const expectedPoints = decideCorrect ? 10 : 0;
      check(
        reveal.question.points === expectedPoints,
        `${step + 1}. ifade ${decideCorrect ? 'doğru' : 'yanlış'} cevap → ${reveal.question.points} puan`,
        `beklenen ${expectedPoints}`
      );
      check(
        reveal.question.claim.isTrue === isTrue,
        `${step + 1}. ifadenin gerçeği doğru bildirildi`
      );
      check(
        reveal.question.guess === (value ? 'Doğru' : 'Yanlış'),
        `${step + 1}. karar kaydedildi`
      );
      expected[ownerA ? 'Ahmet' : 'Ayşe'] += expectedPoints;

      ayse.socket.emit('ready_next');
      ahmet.socket.emit('ready_next');
    }

    console.log('\n3) Tur sonu ve geçmiş');
    const roundEnd = await ayse.wait((s) => s.phase === 'roundEnd', 'tur sonu');
    const entries = roundEnd.results.roundEntries;
    check(entries.length === 10, 'Turda 10 ifade var');
    check(
      entries.every((e) => e.mode === 'truefalse'),
      'Tüm geçmiş kayıtları doğru/yanlış modunda'
    );
    check(
      entries.every((e) => typeof e.claimShown === 'string' && e.claimShown.length > 0),
      'Geçmişte ifadeler saklanıyor'
    );
    check(typeof entries[0].claimTrue === 'boolean', 'Geçmişte doğru/yanlış bilgisi var');

    const ayseScore = roundEnd.players.find((p) => p.name === 'Ayşe').score;
    const ahmetScore = roundEnd.players.find((p) => p.name === 'Ahmet').score;
    check(ayseScore === 50, `Ayşe 50 puan (${ayseScore})`);
    check(ahmetScore === 40, `Ahmet 40 puan (${ahmetScore})`);
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
  } finally {
    ayse.socket.close();
    ahmet.socket.close();
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm doğru/yanlış testleri geçti');
  else {
    console.log(`❌ ${failures} kontrol başarısız`);
    if (serverLog) console.log('\nSunucu çıktısı:\n' + serverLog);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
