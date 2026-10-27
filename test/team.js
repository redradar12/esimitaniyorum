'use strict';

/**
 * Çiftler Kapışması (takım modu) sunucu testi.
 * - 2 çift / 4 oyuncu; her çift 2 kişi.
 * - Sistem ortak geçmiş sorusu sorar; iki eş aynı cevabı verirse çift +10 alır.
 * - 10 soru, tur sonu, final.
 *
 *   npm run ciftler
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 4007;
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
  const client = { name, socket, last: null, waiters: [], errors: [] };
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
  socket.on('error_msg', (payload) => client.errors.push(payload));
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
              `Zaman aşımı: ${label} (faz: ${client.last && client.last.phase}, kod: ${
                client.last && client.last.code
              })`
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
  const zeynep = makeClient('Zeynep');
  const mert = makeClient('Mert');
  const players = [ayse, ahmet, zeynep, mert];

  try {
    await Promise.all(players.map((p) => p.waitConnect()));

    console.log('\n1) 4 kişilik çiftler odası');
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'team', teams: 2 });
    const created = await ayse.wait((s) => s.phase === 'lobby' && s.mode === 'team');
    check(created.teamCount === 2, '2 çift seçildi');
    check(created.teams.length === 2, '2 takım var');
    check(created.me.team === 1 && created.me.seat === 0, 'Kurucu 1. çiftte');
    check(created.isHost === true, 'Kurucu oda sahibi');
    check(created.canStart === false, 'Tek başına başlatılamaz');

    ahmet.socket.emit('join_room', { name: 'Ahmet', code: created.code, team: 1 });
    await ahmet.wait((s) => s.phase === 'lobby' && s.me.team === 1);
    zeynep.socket.emit('join_room', { name: 'Zeynep', code: created.code, team: 2 });
    await zeynep.wait((s) => s.phase === 'lobby' && s.me.team === 2);

    const half = await ayse.wait(
      (s) => s.teams && s.teams[0].members.length === 2 && s.teams[1].members.length === 1
    );
    check(half.teams[0].complete === true, '1. çift tamam');
    check(half.teams[1].complete === false, '2. çift yarım');
    check(half.canStart === false, 'Yarım çiftle başlatılamaz');

    mert.socket.emit('join_room', { name: 'Mert', code: created.code, team: 2 });
    const full = await mert.wait(
      (s) => s.teams && s.teams.every((t) => t.complete) && s.phase === 'lobby'
    );
    const hostView = await ayse.wait(
      (s) => s.teams && s.teams.every((t) => t.complete) && s.phase === 'lobby'
    );
    check(hostView.canStart === true, '2 çift hazır olunca başlatılabilir');
    check(
      full.teams[0].name === 'Ayşe & Ahmet' && full.teams[1].name === 'Zeynep & Mert',
      'Çift isimleri doğru'
    );
    check(
      full.teams[0].isMine === false || full.teams[0].isMine === true,
      'Takım sahipliği hesaplanıyor'
    );

    console.log('\n2) Sadece ev sahibi başlatabilir');
    zeynep.socket.emit('team_start');
    await sleep(250);
    check(
      zeynep.errors.some((e) => e.code === 'not_host'),
      'Konuk başlatamıyor'
    );
    check(zeynep.last.phase === 'lobby', 'Oyun başlamadı');

    ayse.socket.emit('team_start');
    const first = await ayse.wait((s) => s.phase === 'teamPlay' && s.teamQuestion);
    check(first.teamQuestion.number === 1, 'İlk soru');
    check(first.teamQuestion.total === 10, '10 soru');
    check(first.teamQuestion.text.length > 5, 'Soru metni var');
    check(first.teamQuestion.deadline > Date.now(), 'Cevap süresi var');
    check(first.teamQuestion.myAnswer === null, 'Cevap henüz yok');
    check(
      first.teamQuestion.results === undefined,
      'Sonuçlar cevap öncesi gizli'
    );

    console.log('\n3) Eşleşen ve eşleşmeyen cevaplar');
    const scores = { 1: 0, 2: 0 };
    for (let step = 1; step <= 10; step++) {
      const q = await ayse.wait(
        (s) => s.phase === 'teamPlay' && s.teamQuestion && s.teamQuestion.number === step,
        `soru ${step}`
      );
      check(q.teamQuestion.number === step, `${step}. soru herkese geldi`);

      // 1. çift her soruda eşleşir, 2. çift tek sayılarda eşleşmez.
      const team1a = step === 3 ? 'okul' : 'okulda';
      const team1b = 'okulda';
      const team2a = 'park';
      const team2b = step % 2 === 0 ? 'parkta' : 'deniz';

      ayse.socket.emit('team_answer', { answer: team1a });
      await sleep(70);
      ahmet.socket.emit('team_answer', { answer: team1b });
      await sleep(70);
      zeynep.socket.emit('team_answer', { answer: team2a });
      await sleep(70);
      mert.socket.emit('team_answer', { answer: team2b });

      const reveal = await mert.wait(
        (s) => s.phase === 'teamReveal' && s.teamQuestion && s.teamQuestion.number === step,
        `açıklama ${step}`
      );
      const results = reveal.teamQuestion.results;
      const r1 = results.find((r) => r.team === 1);
      const r2 = results.find((r) => r.team === 2);
      check(r1.matched === true, `${step}. soru 1. çift eşleşti`);
      check(r1.points === 10, `${step}. soru 1. çift +10`);
      check(
        r2.matched === (step % 2 === 0),
        `${step}. soru 2. çift doğru eşleşme durumu`
      );
      if (step % 2 === 0) {
        check(r2.points === 10, `${step}. soru 2. çift +10`);
      } else {
        check(r2.points === 0, `${step}. soru 2. çift 0`);
      }
      check(
        r1.answers[0] === team1a && r1.answers[1] === team1b,
        `${step}. soru cevapları açıklandı`
      );
      scores[1] += 10;
      scores[2] += step % 2 === 0 ? 10 : 0;

      const team1 = reveal.teams.find((t) => t.index === 1);
      const team2 = reveal.teams.find((t) => t.index === 2);
      check(team1.score === scores[1], `${step}. soruda 1. çift puanı ${scores[1]}`);
      check(team2.score === scores[2], `${step}. soruda 2. çift puanı ${scores[2]}`);

      mert.socket.emit('team_continue');
      await sleep(120);
    }

    console.log('\n4) Tur sonu');
    const roundEnd = await ayse.wait((s) => s.phase === 'teamRoundEnd');
    check(roundEnd.results.teams.find((t) => t.index === 1).score === 100, '1. çift 100 puan');
    check(roundEnd.results.teams.find((t) => t.index === 2).score === 50, '2. çift 50 puan');
    check(roundEnd.results.roundEntries.length === 10, '10 soru geçmişte');
    check(
      roundEnd.results.roundEntries.every(
        (e) => Array.isArray(e.results) && e.results.length === 2
      ),
      'Her soruda iki çift sonucu var'
    );

    console.log('\n5) Final');
    ayse.socket.emit('team_end');
    const final = await mert.wait((s) => s.phase === 'final');
    check(final.results.winners.length === 1, 'Tek kazanan var');
    check(final.results.winners[0] === 'Ayşe & Ahmet', 'Kazanan 1. çift');
    check(final.results.tie === false, 'Beraberlik yok');

    console.log('\n6) 3 çift / 6 kişi');
    const alt = ['Can', 'Ece', 'Deniz', 'Efe', 'Fatma', 'Gökhan'].map(makeClient);
    await Promise.all(alt.map((p) => p.waitConnect()));
    const [can, ece, deniz, efe, fatma, gokhan] = alt;

    can.socket.emit('create_room', { name: 'Can', mode: 'team', teams: 3 });
    const created3 = await can.wait(
      (s) => s.phase === 'lobby' && s.mode === 'team' && s.teamCount === 3
    );
    check(created3.teams.length === 3, '3 takım kartı var');

    ece.socket.emit('join_room', { name: 'Ece', code: created3.code, team: 1 });
    deniz.socket.emit('join_room', { name: 'Deniz', code: created3.code, team: 2 });
    efe.socket.emit('join_room', { name: 'Efe', code: created3.code, team: 2 });
    await sleep(300);
    const twoComplete = await can.wait(
      (s) => s.teams[0].complete && s.teams[1].complete && s.teams[2].members.length === 0
    );
    check(twoComplete.canStart === true, '3. çift boşken 2 çift ile başlatılabilir');

    fatma.socket.emit('join_room', { name: 'Fatma', code: created3.code, team: 3 });
    await sleep(300);
    const halfThird = await can.wait((s) => s.teams[2].members.length === 1);
    check(halfThird.canStart === false, 'Yarım 3. çift başlatmayı engeller');

    gokhan.socket.emit('join_room', { name: 'Gökhan', code: created3.code, team: 3 });
    await can.wait((s) => s.teams.every((t) => t.complete) && s.canStart);
    check(can.last.canStart === true, '3 çift hazır');
    check(
      can.last.teams.map((t) => t.name).join('|') === 'Can & Ece|Deniz & Efe|Fatma & Gökhan',
      '3 çiftin isimleri doğru'
    );

    can.socket.emit('team_start');
    const six = await can.wait((s) => s.phase === 'teamPlay' && s.teamQuestion);
    check(six.teamIds.length === 3, '3 takım oyunda');
    check(six.teamQuestion.playerCount === 6, '6 oyuncu cevap verecek');

    for (const p of alt) {
      p.socket.emit('team_answer', { answer: 'okul' });
      await sleep(60);
    }
    const reveal6 = await can.wait((s) => s.phase === 'teamReveal');
    check(reveal6.teamQuestion.results.length === 3, '3 çift sonucu var');
    check(
      reveal6.teamQuestion.results.every((r) => r.matched && r.points === 10),
      '3 çift de eşleşti'
    );
    check(
      reveal6.teams.filter((t) => t.score === 10).length === 3,
      '3 çiftin de puanı 10'
    );

    can.socket.emit('team_end');
    const final6 = await can.wait((s) => s.phase === 'final');
    check(final6.results.teams.length === 3, 'Finalde 3 çift var');
    check(final6.results.tie === true, '3 çift berabere');
    alt.forEach((p) => p.socket.close());

    console.log('\n7) Davet bağlantısı ve dolu çift');
    const fifth = makeClient('Fazla');
    await fifth.waitConnect();
    fifth.socket.emit('join_room', { name: 'Fazla', code: created.code, team: 1 });
    await sleep(300);
    check(
      fifth.errors.some((e) => e.code === 'team_full' || e.code === 'bad_room'),
      'Dolu çifte 3. oyuncu giremiyor'
    );
    fifth.socket.close();
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
    players.forEach((p) =>
      console.error(
        'DEBUG',
        p.name,
        JSON.stringify(
          p.last && { phase: p.last.phase, code: p.last.code, mode: p.last.mode, me: p.last.me }
        ),
        p.errors
      )
    );
    if (serverLog) console.error(serverLog);
  } finally {
    players.forEach((p) => p.socket.close());
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm çiftler kapışması testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
