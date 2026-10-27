'use strict';

/**
 * Adam Asmaca (bağımsız mod) arayüz testi.
 * Sunucuyu sabit "Kebap" kelimesiyle başlatır; sırayla harf seçip
 * kelimeyi tamamlar, tur sonu ve finali doğrular.
 *
 *   npm run asmaca-ui
 */

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4181;
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
    env: { ...process.env, PORT: String(PORT), HANGMAN_WORD: 'Kebap' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(1400);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
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
    console.log('\nMod seçimi ve oda');
    await a.goto(BASE, { waitUntil: 'networkidle2' });
    await a.click('.home-mode[data-mode="hangman"]');
    await sleep(200);
    const picked = await a.evaluate(() => ({
      mode: app.homeMode,
      on: document.querySelector('.home-mode.on')?.dataset.mode,
    }));
    check(picked.mode === 'hangman' && picked.on === 'hangman', 'Adam Asmaca seçildi');
    await a.screenshot({ path: path.join(OUT, '22-asmaca-modu.png') });

    await a.type('#nameInput', 'Ayşe');
    await a.click('#createBtn');
    await a.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });
    const code = await a.evaluate(() => app.state.code);
    const lobbyMode = await a.evaluate(() => document.getElementById('lobbyMode')?.textContent);
    const lobbyFoot = await a.evaluate(() => document.getElementById('lobbyFoot')?.textContent);
    check(lobbyMode.includes('Adam Asmaca'), 'Lobide mod görünüyor', lobbyMode);
    check(lobbyFoot.includes('oyun otomatik'), 'Lobide "oyun otomatik başlıyor" yazıyor', lobbyFoot);

    await b.goto(BASE, { waitUntil: 'networkidle2' });
    await b.type('#nameInput', 'Ahmet');
    await b.type('#codeInput', code);
    await b.click('#joinBtn');

    await a.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.hangman",
      { timeout: 15000 }
    );
    await b.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.hangman",
      { timeout: 15000 }
    );
    await sleep(600);

    console.log('\nOyun doğrudan başladı');
    const state = await a.evaluate(() => ({
      phase: app.state.phase,
      setupShown: document.querySelector('.screen.active')?.id,
      title: document.getElementById('playTitle')?.textContent,
      counter: document.getElementById('playCounter')?.textContent,
      cells: document.querySelectorAll('.hm-cell').length,
      keys: document.querySelectorAll('.hm-key').length,
      lives: app.state.hangman.lives,
      hint: document.querySelector('#playBody .q-owner')?.textContent,
      myEnabledKeys: document.querySelectorAll('.hm-key:not([disabled])').length,
    }));
    check(state.phase === 'play', 'Soru hazırlığı atlandı');
    check(state.setupShown === 'screen-play', 'Doğrudan oyun ekranı açıldı', state.setupShown);
    check(state.title === 'Adam Asmaca', 'Başlık doğru');
    check(state.counter === 'Kelime 1', 'Kelime sayacı doğru', state.counter);
    check(state.cells === 5, '5 harf kutusu');
    check(state.keys === 32, '32 harfli klavye');
    check(state.lives === 6, '6 can');
    check(state.hint.includes('Yemek'), 'İpucu kategorisi gösteriliyor', state.hint);
    check(state.myEnabledKeys > 0, 'Sırası olan oyuncunun tuşları açık');

    const bKeys = await b.evaluate(() => ({
      enabled: document.querySelectorAll('.hm-key:not([disabled])').length,
      banner: document.querySelector('.turn-banner')?.textContent,
    }));
    check(bKeys.enabled === 0, 'Sırası olmayan oyuncunun tuşları kapalı');
    check(bKeys.banner.includes('Ayşe'), 'Sıranın Ayşe’de olduğu yazıyor', bKeys.banner);
    await a.screenshot({ path: path.join(OUT, '23-asmaca-tahta.png') });

    console.log('\nSırayla harf seçme');
    const moves = [
      [a, 'K'],
      [b, 'E'],
      [a, 'B'],
      [b, 'X'],
      [a, 'A'],
      [b, 'P'],
    ];
    for (const [page, letter] of moves) {
      await page.click(`.hm-key[data-letter="${letter}"]`);
      await sleep(400);
    }
    const afterWrong = await a.evaluate(() => ({
      lives: app.state.hangman.lives,
      wrong: app.state.hangman.wrong,
    }));
    check(afterWrong.lives === 5, 'Yanlış harfte 1 can gitti', afterWrong.lives);

    await a.waitForFunction("app.state.phase === 'roundEnd'", { timeout: 15000 });
    await sleep(400);
    const round = await a.evaluate(() => ({
      word: app.state.hangman.word,
      solved: app.state.hangman.solved,
      finisher: app.state.hangman.finisher,
      title: document.querySelector('.winner-card h2')?.textContent,
      scores: app.state.players.map((p) => [p.name, p.score]),
      button: document.querySelector('[data-action="nextRound"]')?.textContent,
    }));
    check(round.word === 'Kebap', 'Kelime sonuçta açıklandı', round.word);
    check(round.solved === true, 'Kelime tamamlandı');
    check(round.finisher === 1, 'Son harfi Ahmet buldu');
    check(round.title.includes('tamamlandı'), 'Tur sonu başlığı doğru', round.title);
    check(
      round.scores.find(([name]) => name === 'Ayşe')[1] === 15 &&
        round.scores.find(([name]) => name === 'Ahmet')[1] === 20,
      'Puanlar doğru (Ayşe 15, Ahmet 20)',
      JSON.stringify(round.scores)
    );
    check(Boolean(round.button), 'Sonraki kelime butonu var');
    await a.screenshot({ path: path.join(OUT, '24-asmaca-tur-sonu.png') });

    console.log('\nFinal');
    await a.click('[data-action="endGame"]');
    await a.waitForFunction("app.state.phase === 'final'", { timeout: 15000 });
    await sleep(500);
    const final = await a.evaluate(() => ({
      title: document.querySelector('#finalBody .winner-card h2')?.textContent,
      entries: document.querySelectorAll('#finalBody .result-item').length,
    }));
    check(final.title.includes('Ahmet'), 'Finalde kazanan Ahmet', final.title);
    check(final.entries >= 1, 'Kelime geçmişi finalde var');
    await a.screenshot({ path: path.join(OUT, '25-asmaca-final.png') });

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
  if (failures === 0) console.log('✅ Tüm adam asmaca arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
