'use strict';

/**
 * Adam Asmaca (soru sorarak) arayüz testi.
 * Bir oyuncu soru + cevap yazar, diğeri harf harf tahmin eder;
 * sonra roller değişir. Tur sonu ve final kontrol edilir.
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

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/saglik`);
      if (res.ok) return;
    } catch (_error) {
      /* sunucu henüz hazır değil */
    }
    await sleep(200);
  }
  throw new Error('Test sunucusu başlamadı');
}

(async () => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitServer();

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

    await b.goto(BASE, { waitUntil: 'networkidle2' });
    await b.type('#nameInput', 'Ahmet');
    await b.type('#codeInput', code);
    await b.click('#joinBtn');

    await a.waitForFunction("app.state && app.state.phase === 'ask'", { timeout: 15000 });
    await b.waitForFunction("app.state && app.state.phase === 'ask'", { timeout: 15000 });
    await sleep(400);

    console.log('\n1. soru: Ayşe soruyor');
    const askView = await a.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      title: document.getElementById('playTitle')?.textContent,
      counter: document.getElementById('playCounter')?.textContent,
      hasForm: Boolean(document.getElementById('askQ')) && Boolean(document.getElementById('askA')),
      asker: app.state.hangman.askerName,
      isMyAsk: app.state.hangman.isMyAsk,
    }));
    check(askView.screen === 'screen-play', 'Soru hazırlığı yok, oyun ekranı açıldı');
    check(askView.title === 'Adam Asmaca', 'Başlık doğru');
    check(askView.counter === 'Soru 1/2', 'Sayaç Soru 1/2', askView.counter);
    check(askView.hasForm, 'Soru + cevap formu var');
    check(askView.asker === 'Ayşe' && askView.isMyAsk, 'İlk soruyu Ayşe soruyor');

    const waitView = await b.evaluate(() => ({
      form: Boolean(document.getElementById('askQ')),
      text: document.querySelector('#playBody .waiting-card')?.textContent,
    }));
    check(!waitView.form, 'Ahmet’te form yok');
    check(waitView.text.includes('soru hazırlıyor'), 'Ahmet bekliyor', waitView.text);

    await a.type('#askQ', 'En sevdiğim renk ne?');
    await a.type('#askA', 'Mavi');
    await a.screenshot({ path: path.join(OUT, '23-asmaca-soru-sor.png') });
    await a.click('[data-action="submitAsk"]');

    await b.waitForFunction("app.state.phase === 'guess'", { timeout: 15000 });
    await a.waitForFunction("app.state.phase === 'guess'", { timeout: 15000 });
    await sleep(400);

    console.log('\nAhmet harf seçiyor');
    const guessView = await b.evaluate(() => ({
      question: document.querySelector('#playBody .question-text')?.textContent,
      cells: document.querySelectorAll('.hm-cell').length,
      keys: document.querySelectorAll('.hm-key').length,
      enabled: document.querySelectorAll('.hm-key:not([disabled])').length,
      lives: app.state.hangman.lives,
      isMyGuess: app.state.hangman.isMyGuess,
    }));
    check(guessView.question === 'En sevdiğim renk ne?', 'Soru Ahmet’e geldi');
    check(guessView.cells === 4, '4 harf kutusu');
    check(guessView.keys === 32, 'Klavye var');
    check(guessView.enabled === 32, 'Tüm harfler açık');
    check(guessView.lives === 6, '6 can');
    check(guessView.isMyGuess, 'Ahmet tahmin ediyor');

    const askerGuessView = await a.evaluate(() => ({
      keys: document.querySelectorAll('.hm-key').length,
      question: document.querySelector('#playBody .question-text')?.textContent,
    }));
    check(askerGuessView.keys === 0, 'Soran tarafta klavye yok');
    check(askerGuessView.question === 'En sevdiğim renk ne?', 'Soran da soruyu görüyor');
    await b.screenshot({ path: path.join(OUT, '24-asmaca-tahmin.png') });

    for (const letter of ['K', 'M', 'A', 'V', 'İ']) {
      await b.click(`.hm-key[data-letter="${letter}"]`);
      await sleep(300);
    }
    await b.waitForFunction("app.state.phase === 'reveal'", { timeout: 15000 });
    await sleep(300);
    const reveal = await b.evaluate(() => ({
      points: app.state.hangman.points,
      solved: app.state.hangman.solved,
      answer: document.querySelector('.compare-item.truth p')?.textContent,
      title: document.querySelector('.verdict h2')?.textContent,
      score: app.state.players.find((p) => p.isMe).score,
    }));
    check(reveal.solved === true, 'Kelime çözüldü');
    check(reveal.points === 30, '4 harf + bitirme = 30 puan', reveal.points);
    check(reveal.answer === 'Mavi', 'Doğru cevap gösterildi');
    check(reveal.title.includes('Bildin'), 'Sonuç başlığı doğru', reveal.title);
    check(reveal.score === 30, 'Ahmet 30 puan');
    await b.screenshot({ path: path.join(OUT, '25-asmaca-sonuc.png') });

    console.log('\n2. soru: roller değişti');
    await a.click('[data-action="continueReveal"]');
    await b.click('[data-action="continueReveal"]');
    await b.waitForFunction("app.state.phase === 'ask'", { timeout: 15000 });
    await sleep(400);
    const ask2 = await b.evaluate(() => ({
      isMyAsk: app.state.hangman.isMyAsk,
      asker: app.state.hangman.askerName,
      counter: document.getElementById('playCounter')?.textContent,
    }));
    check(ask2.isMyAsk && ask2.asker === 'Ahmet', 'Bu kez Ahmet soruyor');
    check(ask2.counter === 'Soru 2/2', 'Sayaç Soru 2/2', ask2.counter);

    await b.type('#askQ', 'En sevdiğim hayvan?');
    await b.type('#askA', 'Kedi');
    await b.click('[data-action="submitAsk"]');
    await a.waitForFunction("app.state.phase === 'guess' && app.state.hangman.isMyGuess", {
      timeout: 15000,
    });
    await sleep(300);
    for (const letter of ['K', 'E', 'D', 'İ']) {
      await a.click(`.hm-key[data-letter="${letter}"]`);
      await sleep(300);
    }
    await a.waitForFunction("app.state.phase === 'reveal'", { timeout: 15000 });
    await sleep(300);
    const reveal2 = await a.evaluate(() => ({
      points: app.state.hangman.points,
      score: app.state.players.find((p) => p.isMe).score,
    }));
    check(reveal2.points === 30, '2. soru da 30 puan', reveal2.points);
    check(reveal2.score === 30, 'Ayşe 30 puan');

    console.log('\nTur sonu');
    await a.click('[data-action="continueReveal"]');
    await b.click('[data-action="continueReveal"]');
    await a.waitForFunction("app.state.phase === 'roundEnd'", { timeout: 15000 });
    await sleep(400);
    const round = await a.evaluate(() => ({
      title: document.getElementById('roundTitle')?.textContent,
      scores: app.state.players.map((p) => [p.name, p.score]),
      entries: document.querySelectorAll('#roundBody .result-item').length,
      next: document.querySelector('[data-action="nextRound"]')?.textContent,
    }));
    check(round.title.includes('Tur 1'), 'Tur sonu başlığı doğru', round.title);
    check(
      round.scores.every(([, score]) => score === 30),
      'Skorlar 30 - 30',
      JSON.stringify(round.scores)
    );
    check(round.entries === 2, '2 soru listelendi');
    check(round.next.includes('Sonraki tur'), 'Sonraki tur butonu var');
    await a.screenshot({ path: path.join(OUT, '26-asmaca-tur-sonu.png') });

    console.log('\nFinal');
    await a.click('[data-action="endGame"]');
    await a.waitForFunction("app.state.phase === 'final'", { timeout: 15000 });
    await sleep(400);
    const final = await a.evaluate(() => ({
      title: document.querySelector('#finalBody .winner-card h2')?.textContent,
      entries: document.querySelectorAll('#finalBody .result-item').length,
    }));
    check(final.title.includes('Berabere'), 'Final berabere', final.title);
    check(final.entries === 2, 'Finalde 2 soru var');
    await a.screenshot({ path: path.join(OUT, '27-asmaca-final.png') });

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
