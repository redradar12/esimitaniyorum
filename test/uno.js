'use strict';

/**
 * UNO sunucu testi.
 * - 2-4 oyuncu, 108 kart, 7'şer kart.
 * - Renk/sayı eşleşmesi, joker, +2, +4, pas/yön, kart çekme.
 * - 500 puanlık maç: el sonu puanları, sonraki el ve final.
 * - 3 oyuncu oda sahibi başlatması, 4 oyuncu otomatik başlangıç.
 *
 *   npm run uno
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { createUnoDeck, isUnoPlayable } = require('../uno');

const PORT = 4008;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (ok, label, extra) => {
  if (ok) console.log('  OK ', label);
  else {
    failures++;
    console.error('  FAIL', label, extra === undefined ? '' : extra);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name) {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const client = { name, socket, last: null, errors: [], waiters: [] };
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
  client.wait = (predicate, label = 'state', timeout = 15000) =>
    new Promise((resolve, reject) => {
      if (client.last && predicate(client.last)) return resolve(client.last);
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          client.waiters.splice(client.waiters.indexOf(waiter), 1);
          reject(new Error(`Zaman aşımı: ${label}`));
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

function findActive(players) {
  return players.find(
    (p) => p.last && p.last.phase === 'play' && p.last.uno && p.last.uno.myTurn
  );
}

async function playToFinal(players, maxActions = 2500) {
  let actions = 0;
  let roundEnds = 0;
  let firstRound = null;

  while (actions < maxActions) {
    const final = players.find((p) => p.last && p.last.phase === 'final');
    if (final) return { final, actions, roundEnds, firstRound };

    const roundEnd = players.find(
      (p) => p.last && p.last.phase === 'unoRoundEnd' && p.last.uno
    );
    if (roundEnd) {
      if (!firstRound) firstRound = roundEnd.last.uno;
      roundEnds += 1;
      players[0].socket.emit('uno_next_hand');
      await sleep(80);
      actions++;
      continue;
    }

    const colorChooser = players.find(
      (p) => p.last && p.last.phase === 'play' && p.last.uno && p.last.uno.colorChooser
    );
    if (colorChooser) {
      colorChooser.socket.emit('uno_color', { color: 'red' });
      await sleep(45);
      actions++;
      continue;
    }

    const current = findActive(players);
    if (current) {
      if (current.last.uno.playableIds.length) {
        current.socket.emit('uno_play', {
          cardId: current.last.uno.playableIds[0],
        });
      } else {
        current.socket.emit('uno_draw');
      }
      await sleep(45);
      actions++;
      continue;
    }

    await sleep(35);
  }

  const final = players.find((p) => p.last && p.last.phase === 'final');
  return { final, actions, roundEnds, firstRound };
}

async function main() {
  console.log('\n0) Kurallar');
  const deck = createUnoDeck();
  check(deck.length === 108, 'Deste 108 kart', deck.length);
  check(new Set(deck.map((c) => c.id)).size === 108, 'Kart kimlikleri benzersiz');
  const countByColor = deck.reduce((acc, card) => {
    acc[card.color] = (acc[card.color] || 0) + 1;
    return acc;
  }, {});
  check(
    countByColor.red === 25 &&
      countByColor.yellow === 25 &&
      countByColor.green === 25 &&
      countByColor.blue === 25 &&
      countByColor.wild === 8,
    'Renk dağılımı doğru',
    countByColor
  );

  const red5 = { id: 'r5', color: 'red', value: '5' };
  const red7 = { id: 'r7', color: 'red', value: '7' };
  const blue7 = { id: 'b7', color: 'blue', value: '7' };
  const wild = { id: 'w', color: 'wild', value: 'wild' };
  const wild4 = { id: 'w4', color: 'wild', value: 'wild4' };
  check(isUnoPlayable(red7, red5, 'red', [red7]), 'Renk eşleşmesi oynanabilir');
  check(isUnoPlayable(blue7, red5, 'red', [blue7]) === false, 'Farklı renk oynanamaz');
  check(isUnoPlayable(blue7, red7, 'red', [blue7]), 'Sayı eşleşmesi oynanabilir');
  check(isUnoPlayable(wild, red5, 'red', [wild]), 'Joker her zaman oynanabilir');
  check(
    isUnoPlayable(wild4, red5, 'red', [wild4, blue7]),
    '+4 uygun renk yokken oynanabilir'
  );
  check(
    isUnoPlayable(wild4, red5, 'red', [wild4, red7]) === false,
    '+4 uygun renk varken oynanamaz'
  );

  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d.toString()));
  server.stderr.on('data', (d) => (serverLog += d.toString()));
  await sleep(2500);

  const ayse = makeClient('Ayşe');
  const ahmet = makeClient('Ahmet');
  const two = [ayse, ahmet];

  try {
    await Promise.all(two.map((p) => p.waitConnect()));

    console.log('\n1) 2 oyunculu UNO odası');
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'uno', players: 2 });
    const lobby = await ayse.wait((s) => s.phase === 'lobby' && s.mode === 'uno');
    check(lobby.maxPlayers === 2, 'Oda kapasitesi 2', lobby.maxPlayers);
    check(lobby.isHost === true, 'Kurucu oda sahibi');
    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    const start = await ahmet.wait((s) => s.phase === 'play' && s.uno);
    const hostStart = await ayse.wait((s) => s.phase === 'play' && s.uno);
    check(start.mode === 'uno', 'Oda UNO modunda');
    check(start.uno.players.length === 2, 'İki oyuncu oyunda', start.uno.players.length);
    check(
      start.uno.players.every((p) => p.count >= 7),
      'Her oyuncuya en az 7 kart dağıtıldı',
      start.uno.players.map((p) => p.count)
    );
    check(start.uno.scores.length === 2, 'İki oyunculu puan tablosu');
    check(start.uno.scores.every((score) => score === 0), 'Puanlar 0 ile başlıyor');
    check(start.uno.handNumber === 1, 'İlk el başladı', start.uno.handNumber);
    check(start.uno.top && start.uno.top.value !== 'wild4', 'Açılış kartı +4 değil');
    check(start.uno.deckCount > 70, 'Deste kaldı', start.uno.deckCount);
    check(hostStart.isHost === true, 'Kurucu hâlâ oda sahibi');
    const activeStart = [start, hostStart].find(
      (state) => state.uno.myTurn || state.uno.pendingColor
    );
    check(
      Boolean(activeStart) &&
        (activeStart.uno.playableIds.length >= 1 || activeStart.uno.pendingColor),
      'Sıradaki oyuncunun en az bir seçeneği var'
    );

    console.log('\n2) 500 puana kadar bot maçı');
    const match = await playToFinal(two);
    check(match.actions < 2500, 'Oyun makul hamlede ilerledi', match.actions);
    check(match.roundEnds >= 1, 'En az bir el tamamlandı', match.roundEnds);
    check(Boolean(match.firstRound), 'El sonu durumu geldi');
    if (match.firstRound) {
      check(
        match.firstRound.handPoints > 0,
        'El sonunda puan hesaplandı',
        match.firstRound.handPoints
      );
      check(
        match.firstRound.scores.some((score) => score > 0),
        'Puan tablosu güncellendi',
        match.firstRound.scores
      );
    }

    const final = match.final;
    check(Boolean(final), 'Final fazına ulaşıldı');
    if (final) {
      const results = final.last.results;
      check(results.mode === 'uno', 'Final sonucu UNO');
      check(Boolean(results.winner), 'Bir kazanan var', results.winner);
      check(Array.isArray(results.scores) && results.scores.length === 2, 'Final puan tablosu');
      const winnerScore = results.scores.find((p) => p.name === results.winner)?.score ?? 0;
      check(winnerScore >= 500, 'Kazanan 500 puana ulaştı', winnerScore);
      check(
        results.scores.every((p) => p.score >= 0),
        'Tüm puanlar geçerli',
        results.scores
      );
      check(results.handNumber >= 1, 'Maç el sayısı kaydedildi', results.handNumber);
    }

    console.log('\n3) Yeniden maç');
    ayse.socket.emit('uno_restart');
    const restarted = await ayse.wait(
      (s) => s.phase === 'play' && s.uno && s.uno.handNumber === 1,
      15000
    );
    check(
      restarted.uno.players.every((p) => p.count >= 7),
      'Yeniden kart dağıtıldı',
      restarted.uno.players.map((p) => p.count)
    );
    check(
      restarted.uno.scores.every((score) => score === 0),
      'Yeniden maçta puanlar sıfırlandı',
      restarted.uno.scores
    );

    console.log('\n4) 3 oyuncu ve oda sahibi başlatması');
    const deniz = makeClient('Deniz');
    const mert = makeClient('Mert');
    const zeynep = makeClient('Zeynep');
    const three = [deniz, mert, zeynep];
    await Promise.all(three.map((p) => p.waitConnect()));

    deniz.socket.emit('create_room', { name: 'Deniz', mode: 'uno', players: 4 });
    const threeLobby = await deniz.wait((s) => s.phase === 'lobby' && s.mode === 'uno');
    check(threeLobby.maxPlayers === 4, '4 kişilik oda açıldı', threeLobby.maxPlayers);
    mert.socket.emit('join_room', { name: 'Mert', code: threeLobby.code });
    await mert.wait((s) => s.phase === 'lobby' && s.players.length === 2);
    zeynep.socket.emit('join_room', { name: 'Zeynep', code: threeLobby.code });
    await zeynep.wait((s) => s.phase === 'lobby' && s.players.length === 3);
    check((await deniz.wait((s) => s.players.length === 3)).phase === 'lobby', '3 oyuncu lobide');

    deniz.socket.emit('uno_start');
    const threeStart = await deniz.wait((s) => s.phase === 'play' && s.uno);
    await Promise.all(
      three.map((p) => p.wait((s) => s.phase === 'play' && s.uno))
    );
    check(threeStart.isHost === true, 'Oda sahibi başlattı');
    check(threeStart.uno.players.length === 3, '3 oyuncu masada');
    check(threeStart.uno.scores.length === 3, '3 kişilik puan tablosu');
    check(threeStart.uno.players.every((p) => p.count >= 7), '3 oyuncuya kart dağıtıldı');
    check(threeStart.uno.direction === 1 || threeStart.uno.direction === -1, 'Yön bilgisi var');
    check(threeStart.uno.handNumber === 1, '3 oyunculu maç ilk elde');

    console.log('\n5) 4 oyuncu otomatik başlangıç');
    const can = makeClient('Can');
    const ece = makeClient('Ece');
    const bora = makeClient('Bora');
    const su = makeClient('Su');
    const four = [can, ece, bora, su];
    await Promise.all(four.map((p) => p.waitConnect()));

    can.socket.emit('create_room', { name: 'Can', mode: 'uno', players: 4 });
    const fourLobby = await can.wait((s) => s.phase === 'lobby' && s.mode === 'uno');
    for (const [index, player] of [ece, bora, su].entries()) {
      player.socket.emit('join_room', { name: player.name, code: fourLobby.code });
      if (index < 2) {
        await player.wait((s) => s.phase === 'lobby');
      }
    }
    const fourStart = await can.wait((s) => s.phase === 'play' && s.uno);
    await Promise.all(four.map((p) => p.wait((s) => s.phase === 'play' && s.uno)));
    check(fourStart.uno.players.length === 4, '4 oyuncu masada');
    check(fourStart.uno.scores.length === 4, '4 kişilik puan tablosu');
    check(
      fourStart.uno.players.every((p) => p.count >= 7),
      '4 oyuncuya en az 7 kart dağıtıldı',
      fourStart.uno.players.map((p) => p.count)
    );
    check(
      fourStart.uno.players.filter((p) => p.isMe).length === 1,
      'Her istemcide tek "ben" var'
    );
    check(
      fourStart.players.length === 4,
      'Lobi oyuncuları 4 kişi',
      fourStart.players.length
    );

    check(
      [...two, ...three, ...four].every((p) => p.errors.length === 0),
      'Sunucu hata mesajı göndermedi',
      [...two, ...three, ...four].map((p) => p.errors)
    );

    [...three, ...four].forEach((p) => p.socket.close());
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
    if (serverLog) console.error(serverLog);
  } finally {
    two.forEach((p) => p.socket.close());
    server.kill();
  }

  console.log('\n----------------------------------------');
  if (failures === 0) console.log('Tüm UNO testleri geçti');
  else console.log(`${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
