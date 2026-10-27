'use strict';

/**
 * Sesli sohbet sinyal testi.
 * - Oyuncuların mikrofon durumu state'e yansıyor mu?
 * - SDP / ICE sinyalleri sadece karşı tarafa gidiyor mu?
 * - Sohbetten ayrılma / odadan çıkma durumu sıfırlıyor mu?
 *
 *   npm run ses
 */

const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 4004;
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
  const client = { name, socket, last: null, waiters: [], signals: [] };
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
  socket.on('voice_signal', (payload) => client.signals.push(payload));
  client.wait = (predicate, label = 'state', timeout = 8000) =>
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
  client.waitSignal = (label = 'sinyal', timeout = 5000) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (client.signals.length) {
          clearInterval(timer);
          resolve(client.signals[0]);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error(`Zaman aşımı: ${label}`));
        }
      }, 50);
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

  try {
    await Promise.all([ayse.waitConnect(), ahmet.waitConnect()]);
    ayse.socket.emit('create_room', { name: 'Ayşe', mode: 'text' });
    const lobby = await ayse.wait((s) => s.phase === 'lobby');
    ahmet.socket.emit('join_room', { name: 'Ahmet', code: lobby.code });
    await ayse.wait((s) => s.phase === 'setup');

    console.log('\n1) Mikrofon durumu');
    ayse.socket.emit('voice_join');
    const afterA = await ahmet.wait(
      (s) => s.players.find((p) => p.name === 'Ayşe').voice === true,
      'Ayşe sesli'
    );
    check(
      afterA.players.find((p) => p.name === 'Ayşe').voice === true,
      'Ayşe sesli sohbette görünüyor'
    );
    check(
      afterA.players.find((p) => p.name === 'Ahmet').voice === false,
      'Ahmet henüz sesli değil'
    );

    ahmet.socket.emit('voice_join');
    const both = await ayse.wait(
      (s) => s.players.every((p) => p.voice === true),
      'ikisi de sesli'
    );
    check(both.players.every((p) => p.voice), 'İki oyuncu da sesli');

    console.log('\n2) Sinyal rölesi');
    ayse.socket.emit('voice_signal', {
      sdp: { type: 'offer', sdp: 'test-teklif' },
    });
    const offer = await ahmet.waitSignal('teklif');
    check(offer.sdp.sdp === 'test-teklif', 'Teklif karşı tarafa ulaştı');
    check(offer.from === 0, 'Gönderen bilgisi doğru');
    check(ayse.signals.length === 0, 'Teklif gönderene geri dönmedi');

    ahmet.socket.emit('voice_signal', {
      candidate: { candidate: 'test-aday', sdpMid: '0', sdpMLineIndex: 0 },
    });
    const candidate = await ayse.waitSignal('aday');
    check(candidate.candidate.candidate === 'test-aday', 'ICE adayı karşı tarafa ulaştı');

    console.log('\n3) Ayrılma ve oda sıfırlama');
    ayse.socket.emit('voice_leave');
    const left = await ahmet.wait(
      (s) => s.players.find((p) => p.name === 'Ayşe').voice === false,
      'Ayşe ayrıldı'
    );
    check(
      left.players.find((p) => p.name === 'Ayşe').voice === false,
      'Mikrofon durumu kapandı'
    );

    ayse.socket.emit('voice_join');
    await ahmet.wait(
      (s) => s.players.find((p) => p.name === 'Ayşe').voice === true,
      'tekrar katıldı'
    );
    ahmet.socket.emit('leave_room');
    const back = await ayse.wait((s) => s.phase === 'lobby', 'lobiye dönüş');
    check(back.players.length === 1, 'Oda tek oyuncuya düştü');
    check(back.players[0].voice === false, 'Kalan oyuncunun sesi kapatıldı');
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
  if (failures === 0) console.log('✅ Tüm ses sinyal testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
