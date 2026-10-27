'use strict';

/**
 * Adam Asmaca (bağımsız mod) sunucu testi.
 * Akış: bir oyuncu soru + cevap yazar, diğeri harf harf tahmin eder;
 * sonra roller değişir. Tur sonu ve final kontrol edilir.
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
    ayse.wait((s) => s.phase === 'ask' && s.hangman),
    ahmet.wait((s) => s.phase === 'ask' && s.hangman),
  ]);
  return lobby;
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

  const ayse = makeClient('Ayşe');
  const ahmet = makeClient('Ahmet');

  try {
    await Promise.all([ayse.waitConnect(), ahmet.waitConnect()]);
    console.log('\n1) Oda doğrudan soru sorma ekranıyla başlıyor');
    const lobby = await makeRoom(ayse, ahmet);
    check(lobby.mode === 'hangman', 'Oda modu adam asmaca');
    check(ayse.last.phase === 'ask', 'İlk faz soru sorma');
    check(ayse.last.hangman.askerName === 'Ayşe', 'İlk soruyu Ayşe soruyor');
    check(ayse.last.hangman.isMyAsk === true, 'Ayşe’de soru formu var');
    check(ahmet.last.hangman.isMyAsk === false, 'Ahmet soruyu bekliyor');
    check(ayse.last.hangman.number === 1, '1. soru');

    console.log('\n2) Ayşe soruyor, Ahmet harf seçiyor');
    ayse.socket.emit('hangman_ask', {
      text: 'En sevdiğim renk ne?',
      answer: 'Mavi',
    });
    const guess = await ahmet.wait((s) => s.phase === 'guess' && s.hangman, 'tahmin fazı');
    check(guess.hangman.question === 'En sevdiğim renk ne?', 'Soru Ahmet’e gösteriliyor');
    check(guess.hangman.answer === undefined, 'Cevap tahmin sırasında gizli');
    check(guess.hangman.mask.join('') === '', 'Harfler kapalı');
    check(guess.hangman.lives === 6, '6 can');
    check(guess.hangman.isMyGuess === true, 'Ahmet tahmin ediyor');
    check(guess.players.find((p) => p.name === 'Ayşe').score === 0, 'Soran henüz puan almıyor');

    for (const letter of ['K']) {
      ahmet.socket.emit('hangman_letter', { letter });
    }
    const afterWrong = await ahmet.wait(
      (s) => s.phase === 'guess' && s.hangman.wrong.includes('K'),
      'yanlış harf'
    );
    check(afterWrong.hangman.lives === 5, 'Yanlış harfte can azaldı');
    check(afterWrong.hangman.mask.every((ch) => ch === '' || ch === ' '), 'Yanlış harf açmadı');

    for (const letter of ['M', 'A', 'V', 'İ']) {
      ahmet.socket.emit('hangman_letter', { letter });
    }
    const reveal1 = await ahmet.wait((s) => s.phase === 'reveal', '1. sonuç');
    check(reveal1.hangman.solved === true, 'Kelime çözüldü');
    check(reveal1.hangman.answer === 'Mavi', 'Doğru cevap gösteriliyor');
    check(reveal1.hangman.points === 30, '4 harf + bitirme = 30 puan', reveal1.hangman.points);
    check(
      reveal1.players.find((p) => p.name === 'Ahmet').score === 30,
      'Ahmet 30 puan aldı'
    );

    console.log('\n3) Roller değişiyor');
    ayse.socket.emit('ready_next');
    ahmet.socket.emit('ready_next');
    const ask2 = await ayse.wait(
      (s) => s.phase === 'ask' && s.hangman.number === 2,
      '2. soru sorma'
    );
    check(ask2.hangman.askerName === 'Ahmet', '2. soruyu Ahmet soruyor');
    check(ask2.hangman.isMyAsk === false, 'Ayşe bu kez tahmin edecek');
    const ask2b = await ahmet.wait(
      (s) => s.phase === 'ask' && s.hangman.isMyAsk,
      'Ahmet soru formu'
    );
    check(ask2b.hangman.isMyAsk === true, 'Ahmet’te soru formu var');

    ahmet.socket.emit('hangman_ask', {
      text: 'En sevdiğim hayvan?',
      answer: 'Kedi',
    });
    await ayse.wait((s) => s.phase === 'guess' && s.hangman.isMyGuess, 'Ayşe tahmin');
    for (const letter of ['K', 'E', 'D', 'İ']) {
      ayse.socket.emit('hangman_letter', { letter });
    }
    const reveal2 = await ayse.wait((s) => s.phase === 'reveal', '2. sonuç');
    check(reveal2.hangman.solved === true, '2. kelime çözüldü');
    check(reveal2.hangman.points === 30, '2. soru da 30 puan');
    check(
      reveal2.players.find((p) => p.name === 'Ayşe').score === 30,
      'Ayşe 30 puan aldı'
    );

    console.log('\n4) Tur sonu ve geçmiş');
    ayse.socket.emit('ready_next');
    ahmet.socket.emit('ready_next');
    const roundEnd = await ayse.wait((s) => s.phase === 'roundEnd', 'tur sonu');
    check(roundEnd.results.roundEntries.length === 2, 'Turda 2 soru var');
    check(
      roundEnd.results.roundEntries[0].askerName === 'Ayşe' &&
        roundEnd.results.roundEntries[0].guesserName === 'Ahmet',
      '1. soruyu Ayşe sordu, Ahmet bildi'
    );
    check(
      roundEnd.results.roundEntries[1].askerName === 'Ahmet' &&
        roundEnd.results.roundEntries[1].guesserName === 'Ayşe',
      '2. soruyu Ahmet sordu, Ayşe bildi'
    );
    check(roundEnd.results.players.every((p) => p.score === 30), 'Skorlar 30 - 30');

    console.log('\n5) Sonraki tur ve final');
    ayse.socket.emit('next_round');
    ahmet.socket.emit('next_round');
    const round2 = await ayse.wait(
      (s) => s.phase === 'ask' && s.round === 2,
      '2. tur'
    );
    check(round2.hangman.askerName === 'Ahmet', '2. turda ilk soruyu Ahmet soruyor');

    ayse.socket.emit('end_game');
    const final = await ahmet.wait((s) => s.phase === 'final', 'final');
    check(final.results.tie === true, 'Final berabere');
    check(final.results.entries.length === 2, 'Finalde 2 soru geçmişi var');

    console.log('\n6) 6 yanlışla kaybetme');
    const c = makeClient('Deniz');
    const d = makeClient('Mert');
    await Promise.all([c.waitConnect(), d.waitConnect()]);
    await makeRoom(c, d);
    c.socket.emit('hangman_ask', { text: 'En sevdiğim yemek?', answer: 'Kebap' });
    await d.wait((s) => s.phase === 'guess', 'kayıp denemesi');
    for (const letter of ['Z', 'X', 'Q', 'W', 'J', 'F']) {
      d.socket.emit('hangman_letter', { letter });
    }
    const failReveal = await d.wait((s) => s.phase === 'reveal', '6 yanlış sonucu');
    check(failReveal.hangman.failed === true, '6 yanlışla kaybedildi');
    check(failReveal.hangman.points === 0, 'Kaybedince 0 puan');
    check(failReveal.hangman.answer === 'Kebap', 'Doğru cevap yine gösterildi');

    c.socket.close();
    d.socket.close();
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
  if (failures === 0) console.log('✅ Tüm bağımsız adam asmaca testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
