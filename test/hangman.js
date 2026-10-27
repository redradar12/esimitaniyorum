'use strict';

/**
 * Adam Asmaca (bağımsız mod) sunucu testi.
 * - Oda kurulunca soru hazırlığı yok, oyun doğrudan başlar.
 * - Sırayla harf seçilir, puanlar işlenir.
 * - Kelime tamamlanınca tur biter; sonraki kelime başlar.
 * - Ayrı bir odada 6 yanlışla kaybetme denenir.
 *
 *   npm run asmaca
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 4002;
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

async function makeRoom(ayse, ahmet) {
  ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'hangman' });
  const lobby = await ayse.wait((s) => s.phase === 'lobby');
  ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
  await Promise.all([
    ayse.wait((s) => s.phase === 'play' && s.hangman),
    ahmet.wait((s) => s.phase === 'play' && s.hangman),
  ]);
  return lobby;
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), HANGMAN_WORD: 'Kebap' },
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
    const lobby = await makeRoom(ayse, ahmet);
    check(lobby.mode === 'hangman', 'Oda modu adam asmaca');
    const start = ahmet.last;
    check(start.phase === 'play', 'Soru hazırlığı yok, oyun başladı');
    check(start.hangman.turn === 0, 'İlk sıra ev sahibinde (Ayşe)');
    check(start.hangman.turnName === 'Ayşe', 'Sıra ismi doğru');
    check(start.hangman.isMyTurn === false, 'Ahmet sırasının olmadığını görüyor');
    check(start.hangman.lives === 6, '6 can');
    check(start.hangman.mask.join('') === '', 'Kelimede hiç harf açık değil');
    check(start.hangman.length === 5, 'Kelime 5 harf');
    check(start.hangman.hint === 'Yemek', 'İpucu kategori');
    check(start.hangman.word === undefined, 'Kelime oyun sırasında gizli');

    console.log('\n2) Sıra kontrolü ve puanlar');
    ahmet.socket.emit('hangman_letter', { letter: 'K' });
    await sleep(300);
    check(ahmet.last.hangman.turn === 0, 'Sırası olmayan oyuncu harf seçemiyor');

    ayse.socket.emit('hangman_letter', { letter: 'K' });
    const afterK = await ahmet.wait(
      (s) => s.phase === 'play' && s.hangman.mask.includes('K'),
      'K harfi'
    );
    check(afterK.hangman.turn === 1, 'Doğru harften sonra sıra Ahmet’e geçti');
    const kScore = afterK.players.find((p) => p.name === 'Ayşe').score;
    check(kScore === 5, `Doğru harf +5 puan (${kScore})`);

    ahmet.socket.emit('hangman_letter', { letter: 'E' });
    await sleep(400);
    check(ahmet.last.players.find((p) => p.name === 'Ahmet').score === 5, 'Ahmet de +5 aldı');

    ayse.socket.emit('hangman_letter', { letter: 'L' });
    const afterL = await ahmet.wait(
      (s) => s.phase === 'play' && s.hangman.wrong.includes('L'),
      'L harfi'
    );
    check(afterL.hangman.lives === 5, 'Yanlış harfte can azaldı');
    check(afterL.hangman.turn === 1, 'Yanlış harften sonra sıra değişti');

    console.log('\n3) Kelimeyi tamamlama');
    const moves = [
      ['Ahmet', 'B'],
      ['Ayşe', 'A'],
      ['Ahmet', 'P'],
    ];
    for (const [who, letter] of moves) {
      (who === 'Ayşe' ? ayse : ahmet).socket.emit('hangman_letter', { letter });
      await sleep(350);
    }
    const solvedState = await ahmet.wait(
      (s) => s.phase === 'play' && s.hangman.solved,
      'çözüldü',
      8000
    );
    check(solvedState.hangman.mask.join('') === 'KEBAP', 'Kelime KEBAP olarak açıldı');
    check(solvedState.hangman.lives === 5, 'Tek yanlış sonrası 5 can kaldı');

    const roundEnd = await ahmet.wait((s) => s.phase === 'roundEnd', 'kelime sonu');
    check(roundEnd.hangman.word === 'Kebap', 'Kelime sonuçta gösteriliyor');
    check(roundEnd.hangman.solved === true, 'Kelime çözüldü');
    check(roundEnd.hangman.finisher === 1, 'Son harfi Ahmet buldu');
    const aScore = roundEnd.players.find((p) => p.name === 'Ayşe').score;
    const bScore = roundEnd.players.find((p) => p.name === 'Ahmet').score;
    check(aScore === 10, `Ayşe 10 puan (${aScore})`);
    check(bScore === 25, `Ahmet 25 puan (${bScore})`);
    check(roundEnd.results.entries.length === 1, 'Kelime geçmişe eklendi');

    console.log('\n4) Sonraki kelime');
    ayse.socket.emit('next_round');
    ahmet.socket.emit('next_round');
    const next = await ayse.wait((s) => s.phase === 'play' && s.round === 2, '2. kelime');
    check(next.hangman.turn === 1, 'Yeni kelimede ilk sıra Ahmet’te');
    check(next.hangman.lives === 6, 'Canlar sıfırlandı');
    check(next.hangman.mask.join('') === '', 'Yeni kelime kapalı');

    console.log('\n5) 6 yanlışla kaybetme');
    const c = makeClient('Deniz');
    const d = makeClient('Mert');
    await Promise.all([c.waitConnect(), d.waitConnect()]);
    await makeRoom(c, d);
    const wrongs = ['Z', 'X', 'Q', 'W', 'J', 'F'];
    for (let i = 0; i < wrongs.length; i++) {
      const client = i % 2 === 0 ? c : d;
      client.socket.emit('hangman_letter', { letter: wrongs[i] });
      await sleep(250);
    }
    const failed = await c.wait((s) => s.phase === 'play' && s.hangman.failed, '6 yanlış');
    check(failed.hangman.lives === 0, 'Can kalmadı');
    const failEnd = await c.wait((s) => s.phase === 'roundEnd', 'kayıp sonu');
    check(failEnd.hangman.solved === false, 'Kelime çözülemedi');
    check(failEnd.players.every((p) => p.score === 0), 'Yanlışlarda puan yok');

    c.socket.close();
    d.socket.close();
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
    if (serverLog) console.error(serverLog);
    ayse.socket.close();
    ahmet.socket.close();
  } finally {
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm bağımsız adam asmaca testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
