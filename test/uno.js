'use strict';

/**
 * UNO sunucu testi.
 * - 2 oyuncu, 108 kart, 7'şer el.
 * - Renk/sayı eşleşmesi, joker, +2, +4, pas/yön, kart çekme.
 * - Bot iki tarafı da oynatır; bir el bitince final ve yeniden oyun.
 *
 *   npm run uno
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const {
  createUnoDeck,
  isUnoPlayable,
} = require('../uno');

const PORT = 4008;
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
  client.wait = (predicate, label = 'state', timeout = 10000) =>
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
  const players = [ayse, ahmet];

  try {
    await Promise.all(players.map((p) => p.waitConnect()));

    console.log('\n1) UNO odası');
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'uno' });
    const lobby = await ayse.wait((s) => s.phase === 'lobby' && s.mode === 'uno');
    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    const start = await ahmet.wait((s) => s.phase === 'play' && s.uno);
    const hostStart = await ayse.wait((s) => s.phase === 'play' && s.uno);
    check(start.mode === 'uno', 'Oda UNO modunda');
    check(start.uno.myCount >= 7, 'Oyuncuya en az 7 kart dağıtıldı');
    check(start.uno.opponentCount >= 7, 'Rakibe en az 7 kart dağıtıldı');
    check(start.uno.top && start.uno.top.value !== 'wild4', 'Açılış kartı +4 değil');
    check(start.uno.deckCount > 70, 'Deste kaldı');
    check(start.uno.colorName.length > 0, 'Açılış rengi belli');
    const activeStart = [start, hostStart].find(
      (state) => state.uno.myTurn || state.uno.pendingColor
    );
    check(
      Boolean(activeStart) &&
        (activeStart.uno.playableIds.length >= 1 || activeStart.uno.pendingColor),
      'Sıradaki oyuncunun en az bir seçeneği var'
    );

    console.log('\n2) Bot eli');
    let finalState = null;
    let actions = 0;
    let idle = 0;
    while (actions < 600 && !finalState) {
      const finished = players.find(
        (p) => p.last && p.last.phase === 'final'
      );
      if (finished) {
        finalState = finished;
        break;
      }

      const colorChooser = players.find(
        (p) => p.last && p.last.phase === 'play' && p.last.uno && p.last.uno.colorChooser
      );
      if (colorChooser) {
        colorChooser.socket.emit('uno_color', { color: 'red' });
        await sleep(60);
        actions++;
        idle = 0;
        continue;
      }

      const current = players.find(
        (p) => p.last && p.last.phase === 'play' && p.last.uno && p.last.uno.myTurn
      );
      if (current) {
        if (current.last.uno.playableIds.length) {
          current.socket.emit('uno_play', {
            cardId: current.last.uno.playableIds[0],
          });
        } else {
          current.socket.emit('uno_draw');
        }
        await sleep(60);
        actions++;
        idle = 0;
        continue;
      }

      idle += 1;
      if (idle > 80) {
        check(false, 'Oyun ilerlemedi (sıra bulunamadı)', players.map((p) => p.last && p.last.phase));
        break;
      }
      await sleep(50);
    }

    finalState = players.find((p) => p.last && p.last.phase === 'final');
    check(actions < 600, 'Oyun makul hamlede bitti', actions);
    check(Boolean(finalState), 'Final fazına ulaşıldı');
    if (finalState) {
      check(Boolean(finalState.last.results.winner), 'Bir kazanan var');
      check(finalState.last.results.loserCards >= 0, 'Kalan kart sayısı var');
      check(finalState.last.results.winnerCards === 0, 'Kazananın eli boş');
      check(finalState.last.results.mode === 'uno', 'Final sonucu UNO');
    }

    console.log('\n3) Yeniden oyun');
    ayse.socket.emit('uno_restart');
    const restarted = await ayse.wait((s) => s.phase === 'play' && s.uno);
    check(restarted.uno.myCount >= 7, 'Yeniden kart dağıtıldı');
    check(restarted.uno.myCount + restarted.uno.opponentCount >= 14, 'İki oyuncuya el verildi');

    check(
      players.every((p) => p.errors.length === 0),
      'Sunucu hata mesajı göndermedi',
      players.map((p) => p.errors)
    );
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.message);
    if (serverLog) console.error(serverLog);
  } finally {
    players.forEach((p) => p.socket.close());
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm UNO testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
