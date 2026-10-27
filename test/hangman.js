'use strict';

/**
 * Adam asmaca akışı testi.
 * Bir turda iki adam asmaca sorusu oynar:
 *  - 1. soru doğru çözülür (2 yanlış → 8 puan)
 *  - 2. soru 6 yanlışla kaybedilir (0 puan)
 * Sonra tur sonunda geçmiş kayıtları kontrol eder.
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
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'hangman' });
    const lobby = await ayse.wait((s) => s.phase === 'lobby');
    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    await Promise.all([
      ayse.wait((s) => s.phase === 'setup'),
      ahmet.wait((s) => s.phase === 'setup'),
    ]);

    ayse.socket.emit('submit_questions', {
      questions: [
        q('En sevdiğim renk?', 'Mavi'),
        q('En sevdiğim yemek?', 'Kebap'),
        q('En sevdiğim spor?', 'Futbol'),
        q('Evcil hayvanım?', 'Kedi'),
        q('Tatilde deniz mi dağ mı?', 'Deniz'),
      ],
    });
    ahmet.socket.emit('submit_questions', {
      questions: [
        q('En sevdiğim hayvan?', 'Kedi'),
        q('En sevdiğim içecek?', 'Çay'),
        q('En sevdiğim renk?', 'Yeşil'),
        q('Hangi takım?', 'Basketbol'),
        q('Tatil yerim?', 'Dağ'),
      ],
    });

    const play1 = await ahmet.wait(
      (s) => s.phase === 'play' && s.question && s.question.number === 1,
      'ilk soru'
    );
    check(play1.question.mode === 'hangman', '1. soru adam asmaca modunda');
    check(play1.question.hangman.mask.join('') === '', 'Harfler başlangıçta kapalı');
    check(play1.question.hangman.lives === 6, '6 canla başlıyor');
    check(play1.guessSeconds === 60, 'Adam asmaca süresi 60 saniye');

    console.log('\n2) İki yanlış harf');
    ahmet.socket.emit('hangman_letter', { letter: 'K' });
    const afterK = await ahmet.wait(
      (s) => s.phase === 'play' && s.question.hangman.wrong.includes('K'),
      'K harfi'
    );
    check(afterK.question.hangman.lives === 5, 'K yanlış: 5 can kaldı');
    check(
      afterK.question.hangman.mask.every((ch) => ch === '' || ch === ' '),
      'Yanlış harf maskeyi açmıyor'
    );

    ahmet.socket.emit('hangman_letter', { letter: 'L' });
    const afterL = await ahmet.wait(
      (s) => s.phase === 'play' && s.question.hangman.wrong.includes('L'),
      'L harfi'
    );
    check(afterL.question.hangman.lives === 4, 'L yanlış: 4 can kaldı');
    check(afterL.question.hangman.wrong.join('') === 'KL', 'Yanlış harfler birikiyor');

    console.log('\n3) Doğru harflerle çözme');
    ahmet.socket.emit('hangman_letter', { letter: 'M' });
    const afterM = await ahmet.wait(
      (s) => s.phase === 'play' && s.question.hangman.mask.includes('M'),
      'M harfi'
    );
    check(afterM.question.hangman.mask[0] === 'M', 'M harfi açıldı');

    ahmet.socket.emit('hangman_letter', { letter: 'A' });
    ahmet.socket.emit('hangman_letter', { letter: 'V' });
    await ahmet.wait(
      (s) => s.phase === 'play' && s.question.hangman.mask.includes('V'),
      'V harfi'
    );
    ahmet.socket.emit('hangman_letter', { letter: 'İ' });

    const reveal1 = await ahmet.wait((s) => s.phase === 'reveal', '1. reveal');
    check(reveal1.question.hangman.solved === true, 'Kelime çözüldü');
    check(reveal1.question.match === 'exact', 'Tam isabet olarak işaretlendi');
    check(reveal1.question.points === 8, '2 yanlış → 8 puan', reveal1.question.points);
    check(reveal1.question.answer === 'Mavi', 'Doğru cevap gösteriliyor');

    console.log('\n4) İkinci adam asmaca: 6 yanlış');
    ayse.socket.emit('ready_next');
    ahmet.socket.emit('ready_next');
    await ahmet.wait(
      (s) => s.phase === 'play' && s.question.number === 2,
      '2. soru'
    );
    check(ahmet.last.question.mode === 'hangman', '2. soru da adam asmaca');
    check(ahmet.last.guessSeconds === 60, '2. sorunun süresi 60 saniye');

    for (const letter of ['Z', 'X', 'Q', 'W', 'J', 'F']) {
      ayse.socket.emit('hangman_letter', { letter });
    }
    const reveal2 = await ayse.wait((s) => s.phase === 'reveal', '2. reveal');
    check(reveal2.question.hangman.solved === false, '6 yanlışta kelime çözülemedi');
    check(reveal2.question.hangman.lives === 0, 'Can kalmadı');
    check(reveal2.question.points === 0, 'Kaybedince 0 puan');
    check(reveal2.question.answer === 'Kedi', 'Doğru cevap yine gösteriliyor');

    console.log('\n5) Turu tamamlama ve geçmiş');
    ayse.socket.emit('ready_next');
    ahmet.socket.emit('ready_next');

    const A_ANSWERS = ['Mavi', 'Kebap', 'Futbol', 'Kedi', 'Deniz'];
    const B_ANSWERS = ['Kedi', 'Çay', 'Yeşil', 'Basketbol', 'Dağ'];

    for (let step = 2; step < 10; step++) {
      await ahmet.wait(
        (s) => s.phase === 'play' && s.question && s.question.number === step + 1,
        `soru ${step + 1}`
      );
      const ownerA = step % 2 === 0;
      const answer = (ownerA ? A_ANSWERS : B_ANSWERS)[Math.floor(step / 2)];
      const guesser = ownerA ? ahmet : ayse;
      const letters = [...new Set(answer.toLocaleUpperCase('tr-TR').split(''))].filter((ch) =>
        /[A-ZÇĞİÖŞÜ]/.test(ch)
      );
      for (const letter of letters) {
        guesser.socket.emit('hangman_letter', { letter });
      }
      await ahmet.wait((s) => s.phase === 'reveal', `reveal ${step + 1}`, 10000);
      ayse.socket.emit('ready_next');
      ahmet.socket.emit('ready_next');
    }

    const roundEnd = await ayse.wait((s) => s.phase === 'roundEnd', 'tur sonu');
    const entries = roundEnd.results.roundEntries;
    check(entries.length === 10, 'Turda 10 soru var');
    check(entries[0].mode === 'hangman' && entries[0].wrongCount === 2, 'Geçmişte 1. soru adam asmaca / 2 yanlış');
    check(entries[0].points === 8, 'Geçmişte 1. soru 8 puan');
    check(entries[1].mode === 'hangman' && entries[1].wrongCount === 6, 'Geçmişte 2. soru adam asmaca / 6 yanlış');
    check(entries[1].points === 0, 'Geçmişte 2. soru 0 puan');
    check(roundEnd.players.find((p) => p.name === 'Ahmet').score === 48, 'Ahmet 48 puan');
    check(roundEnd.players.find((p) => p.name === 'Ayşe').score === 40, 'Ayşe 40 puan');
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
  } finally {
    ayse.socket.close();
    ahmet.socket.close();
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm adam asmaca testleri geçti');
  else {
    console.log(`❌ ${failures} kontrol başarısız`);
    if (serverLog) console.log('\nSunucu çıktısı:\n' + serverLog);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
