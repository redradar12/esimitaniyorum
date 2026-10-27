'use strict';

/**
 * Doğru mu Yanlış mı? (bağımsız mod) sunucu testi.
 * - Soru hazırlığı yok; sistem 10 ifade sorar.
 * - İki oyuncu da cevaplar; doğru +10, ikisi de doğruysa hızlı olan +2.
 *
 *   npm run dogruyanlis
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { TRUE_FALSE } = require('../game-data');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
          reject(new Error(`Zaman aşımı: ${label} (faz: ${client.last && client.last.phase})`));
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

function truthOf(text) {
  const item = TRUE_FALSE.find((s) => s.text === text);
  return item ? item.answer : null;
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d.toString()));
  server.stderr.on('data', (d) => (serverLog += d.toString()));
  await sleep(1200);

  const ayse = makeClient('Ayşe');
  const ahmet = makeClient('Ahmet');

  try {
    await Promise.all([ayse.waitConnect(), ahmet.waitConnect()]);
    console.log('\n1) Oda doğrudan oyuna başlıyor');
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'truefalse' });
    const lobby = await ayse.wait((s) => s.phase === 'lobby');
    check(lobby.mode === 'truefalse', 'Oda modu doğru/yanlış');
    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    const start = await ahmet.wait((s) => s.phase === 'play' && s.quiz, 'ilk ifade');
    check(start.phase === 'play', 'Soru hazırlığı yok, oyun başladı');
    check(start.quiz.total === 10, '10 ifade');
    check(start.quiz.number === 1, 'İlk ifade');
    check(start.quiz.statement.length > 5, 'İfade gösteriliyor');
    check(start.guessSeconds === 15, '15 saniye');
    check(start.quiz.truth === undefined, 'Cevap oyun sırasında gizli');

    console.log('\n2) 10 ifade');
    const expected = { Ayşe: 0, Ahmet: 0 };
    const correctCount = { Ayşe: 0, Ahmet: 0 };

    for (let step = 0; step < 10; step++) {
      const state = await ahmet.wait(
        (s) => s.phase === 'play' && s.quiz && s.quiz.number === step + 1,
        `ifade ${step + 1}`
      );
      const truth = truthOf(state.quiz.statement);
      check(truth !== null, `${step + 1}. ifadenin doğrusu bankada bulundu`);
      check(state.quiz.truth === undefined, `${step + 1}. cevap sızdırılmıyor`);

      // 2. ifade: Ahmet yanlış, Ayşe doğru
      // 4. ifade: Ayşe yanlış, Ahmet doğru
      // Diğerleri: ikisi de doğru; sırayla ilk cevaplayan değişir
      let first = step % 2 === 0 ? ahmet : ayse;
      let second = first === ahmet ? ayse : ahmet;
      let firstValue = truth;
      let secondValue = truth;
      if (step === 1) {
        first = ahmet;
        second = ayse;
        firstValue = !truth;
        secondValue = truth;
      } else if (step === 3) {
        first = ayse;
        second = ahmet;
        firstValue = !truth;
        secondValue = truth;
      }

      first.socket.emit('quiz_answer', { value: firstValue });
      await sleep(120);
      second.socket.emit('quiz_answer', { value: secondValue });

      const reveal = await ahmet.wait(
        (s) => s.phase === 'reveal' && s.quiz && s.quiz.number === step + 1,
        `reveal ${step + 1}`
      );
      const result = reveal.quiz.result;
      check(reveal.quiz.truth === truth, `${step + 1}. doğru cevap açıklandı`);

      const firstIndex = reveal.players.findIndex((p) => p.name === first.name);
      const secondIndex = reveal.players.findIndex((p) => p.name === second.name);
      const bothCorrect = firstValue === truth && secondValue === truth;
      const expectedFirst = firstValue === truth ? 10 + (bothCorrect ? 2 : 0) : 0;
      const expectedSecond = secondValue === truth ? 10 : 0;

      check(
        result.points[firstIndex] === expectedFirst,
        `${step + 1}. ilk cevap ${expectedFirst} puan`,
        result.points
      );
      check(
        result.points[secondIndex] === expectedSecond,
        `${step + 1}. ikinci cevap ${expectedSecond} puan`,
        result.points
      );

      if (firstValue === truth) correctCount[first.name] += 1;
      if (secondValue === truth) correctCount[second.name] += 1;
      expected[first.name] += expectedFirst;
      expected[second.name] += expectedSecond;

      ayse.socket.emit('ready_next');
      ahmet.socket.emit('ready_next');
    }

    console.log('\n3) Tur sonu ve geçmiş');
    const roundEnd = await ayse.wait((s) => s.phase === 'roundEnd', 'tur sonu');
    const ayseScore = roundEnd.players.find((p) => p.name === 'Ayşe').score;
    const ahmetScore = roundEnd.players.find((p) => p.name === 'Ahmet').score;
    check(ayseScore === expected.Ayşe, `Ayşe ${expected.Ayşe} puan (${ayseScore})`);
    check(ahmetScore === expected.Ahmet, `Ahmet ${expected.Ahmet} puan (${ahmetScore})`);
    check(roundEnd.results.roundEntries.length === 10, '10 ifade geçmişte');
    check(
      roundEnd.results.roundEntries.every((e) => typeof e.truth === 'boolean'),
      'Geçmişte doğru/yanlış bilgisi var'
    );
    check(
      roundEnd.results.players.find((p) => p.name === 'Ayşe').correct === correctCount.Ayşe,
      'Ayşe doğru sayısı tutuyor'
    );

    console.log('\n4) Final');
    ayse.socket.emit('end_game');
    const final = await ahmet.wait((s) => s.phase === 'final', 'final');
    const winner = final.results.winners[0];
    const higher = expected.Ayşe >= expected.Ahmet ? 'Ayşe' : 'Ahmet';
    check(winner === higher, `Kazanan ${higher}`, winner);
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
    if (serverLog) console.error(serverLog);
  } finally {
    ayse.socket.close();
    ahmet.socket.close();
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm bağımsız doğru/yanlış testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
