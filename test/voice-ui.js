'use strict';

/**
 * Sesli sohbet arayüz + WebRTC testi (sahte mikrofon).
 * İki sayfa aynı odada mikrofonu açar; bağlantı kurulur, mute ve ayrılma denenir.
 *
 *   npm run ses-ui
 */

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, 'screens');

let failures = 0;
const check = (ok, label, extra) => {
  if (ok) console.log('  ✔', label);
  else {
    failures++;
    console.error('  ✘', label, extra === undefined ? '' : extra);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(1400);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--lang=tr-TR',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });

  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  await ctxA.overridePermissions(BASE, ['microphone']);
  await ctxB.overridePermissions(BASE, ['microphone']);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const page of [a, b]) {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  }

  try {
    console.log('\nOda');
    await a.goto(BASE, { waitUntil: 'networkidle2' });
    const fabHome = await a.evaluate(() => document.getElementById('voiceFab').hidden);
    check(fabHome === true, 'Ana sayfada mikrofon düğmesi gizli');

    await a.type('#nameInput', 'Ayşe');
    await a.click('#createBtn');
    await a.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });
    const code = await a.evaluate(() => app.state.code);

    await b.goto(BASE, { waitUntil: 'networkidle2' });
    await b.type('#nameInput', 'Ahmet');
    await b.type('#codeInput', code);
    await b.click('#joinBtn');
    await a.waitForFunction("app.state && app.state.phase === 'setup'", { timeout: 15000 });
    await sleep(500);
    await a.click('#introStart');
    await b.evaluate(() => document.getElementById('introStart')?.click());
    await sleep(300);

    console.log('\nMikrofonu açma');
    const fabInRoom = await a.evaluate(() => document.getElementById('voiceFab').hidden);
    check(fabInRoom === false, 'Odada mikrofon düğmesi görünüyor');

    await a.click('#voiceFab');
    await sleep(250);
    await a.click('#voiceJoinBtn');
    await a.waitForFunction("voice.active === true", { timeout: 8000 });
    const aVoice = await a.evaluate(() => ({
      active: voice.active,
      tracks: voice.localStream ? voice.localStream.getAudioTracks().length : 0,
      status: document.getElementById('voiceStatus')?.textContent,
    }));
    check(aVoice.active, 'Ayşe mikrofonu açtı');
    check(aVoice.tracks === 1, 'Yerel ses kanalı hazır');
    check(aVoice.status.includes('katılmasını'), 'Eşi beklediği yazıyor', aVoice.status);

    await b.click('#voiceFab');
    await sleep(200);
    await b.click('#voiceJoinBtn');
    await b.waitForFunction("voice.active === true", { timeout: 8000 });

    console.log('\nWebRTC bağlantısı');
    await Promise.all([
      a.waitForFunction(
        "voice.pc && voice.pc.connectionState === 'connected'",
        { timeout: 20000 }
      ),
      b.waitForFunction(
        "voice.pc && voice.pc.connectionState === 'connected'",
        { timeout: 20000 }
      ),
    ]);
    await sleep(600);
    const connected = await a.evaluate(() => ({
      state: voice.pc?.connectionState,
      remote: Boolean(voice.remoteStream),
      status: document.getElementById('voiceStatus')?.textContent,
      dot: document.getElementById('voiceFabDot')?.className,
    }));
    check(connected.state === 'connected', 'Sesli bağlantı kuruldu');
    check(connected.remote, 'Karşı tarafın sesi alınıyor');
    check(connected.status.includes('bağlı'), 'Durum “bağlı” yazıyor', connected.status);
    check(connected.dot.includes('connected'), 'Yeşil bağlantı noktası yandı');
    await a.screenshot({ path: path.join(OUT, '31-sesli-sohbet.png') });

    console.log('\nSessize alma');
    await a.click('#voiceMuteBtn');
    await sleep(300);
    const muted = await a.evaluate(() => ({
      muted: voice.muted,
      enabled: voice.localStream.getAudioTracks()[0].enabled,
      icon: document.getElementById('voiceFabIcon')?.textContent,
    }));
    check(muted.muted === true, 'Mikrofon sessize alındı');
    check(muted.enabled === false, 'Ses kanalı kapatıldı');
    check(muted.icon === '🔇', 'Sessiz simgesi göründü', muted.icon);

    await a.click('#voiceMuteBtn');
    await sleep(300);
    const unmuted = await a.evaluate(() => voice.muted);
    check(unmuted === false, 'Mikrofon tekrar açıldı');

    console.log('\nGörüşmeyi bitirme');
    await a.click('#voiceLeaveBtn');
    await sleep(600);
    const afterLeave = await a.evaluate(() => ({
      active: voice.active,
      stream: Boolean(voice.localStream),
      pc: Boolean(voice.pc),
    }));
    check(!afterLeave.active && !afterLeave.stream && !afterLeave.pc, 'Ayşe görüşmeyi kapattı');
    await b.waitForFunction(
      "app.state.players.find(p => p.name === 'Ayşe').voice === false",
      { timeout: 8000 }
    );
    const bAfter = await b.evaluate(() => ({
      pc: Boolean(voice.pc),
      status: document.getElementById('voiceStatus')?.textContent,
    }));
    check(!bAfter.pc, 'Ahmet’in bağlantısı kapandı');
    check(bAfter.status.includes('katılmasını'), 'Ahmet beklemeye geçti', bAfter.status);

    console.log('\nHatalar:', errors.length ? errors : 'yok');
    if (errors.length) failures++;
  } catch (error) {
    failures++;
    console.error('Test hatası:', error.message);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm sesli sohbet arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
