'use strict';

/**
 * Görsel kontrol: oyunu 390x844 mobil görünümde iki Chrome sekmesinde oynar
 * ve ekran görüntülerini test/screens klasörüne kaydeder.
 *
 *   node test/visual.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const OUT = path.join(__dirname, 'screens');

fs.mkdirSync(OUT, { recursive: true });

const A_QUESTIONS = [
  ['En sevdiğim yemek ne?', 'Kebap'],
  ['Bana en çok yakışan renk?', 'Mavi'],
  ['Hangi sporu severim?', 'Futbol'],
  ['Evcil hayvanım ne olmalı?', 'Kedi'],
  ['Tatilde deniz mi dağ mı?', 'Deniz'],
];

const B_QUESTIONS = [
  ['En sevdiğim yemek?', 'Pizza'],
  ['En sevdiğim renk?', 'Yeşil'],
  ['Hangi takımı tutuyorum?', 'Basketbol'],
  ['Hangi hayvanı severim?', 'Köpek'],
  ['Tatilde nereye gitmek isterim?', 'Dağ'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name, fullPage = true) {
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage });
  console.log('  📸', name);
}

async function fillSetup(page, pairs) {
  await page.evaluate(async (pairs) => {
    for (const [q, a] of pairs) {
      const t = document.getElementById('qText');
      const ans = document.getElementById('qAnswer');
      if (!t || !ans) throw new Error('Soru formu bulunamadı: ' + document.querySelector('.screen.active')?.id);
      t.value = q;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      ans.value = a;
      ans.dispatchEvent(new Event('input', { bubbles: true }));
      document
        .querySelector('[data-action="nextStep"], [data-action="submitQuestions"]')
        .click();
      await new Promise((r) => setTimeout(r, 180));
    }
  }, pairs);
}

async function waitState(page, check, label) {
  await page.waitForFunction(check, { timeout: 15000, polling: 100 });
  if (label) console.log('  →', label);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=tr-TR'],
    defaultViewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
  });

  const contextA = await browser.createBrowserContext();
  const contextB = await browser.createBrowserContext();
  const ayse = await contextA.newPage();
  const ahmet = await contextB.newPage();
  const errors = [];
  for (const page of [ayse, ahmet]) {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  }

  try {
    console.log('\nAna sayfa');
    await ayse.goto(BASE, { waitUntil: 'networkidle2' });
    await shot(ayse, '01-ana-sayfa');

    await ayse.click('#howBtn');
    await shot(ayse, '02-nasil-oynanir', false);
    await ayse.click('#helpOk');

    console.log('\nOda kurma');
    await ayse.type('#nameInput', 'Ayşe');
    await ayse.click('#createBtn');
    await waitState(
      ayse,
      "app.state && app.state.phase === 'lobby' && app.state.code.length === 5",
      'oda kuruldu'
    );
    const code = await ayse.evaluate(() => app.state.code);
    await shot(ayse, '03-lobi');

    console.log('\nKatılma');
    await ahmet.goto(BASE, { waitUntil: 'networkidle2' });
    await ahmet.type('#nameInput', 'Ahmet');
    await ahmet.type('#codeInput', code);
    await ahmet.click('#joinBtn');
    await waitState(
      ahmet,
      "app.state && app.state.phase === 'setup'",
      'Ahmet katıldı'
    );
    await waitState(ayse, "app.state && app.state.phase === 'setup'", 'Ayşe setup');

    const intro = await ayse.evaluate(() => ({
      open: !document.getElementById('introModal').hidden,
      names: document.getElementById('introNames').textContent,
    }));
    console.log(`  tanıtım: ${intro.open ? 'açık' : 'kapalı'} — ${intro.names}`);
    await shot(ayse, '04a-tanitim', false);
    await ayse.click('#introStart');
    await ahmet.evaluate(() => document.getElementById('introStart')?.click());
    await sleep(250);

    await shot(ayse, '04-soru-hazirligi');

    console.log('\nSorular');
    await fillSetup(ayse, A_QUESTIONS);
    await waitState(ayse, "app.state && app.state.me.ready === true", 'Ayşe hazır');
    await shot(ayse, '05-sorular-hazir');

    await fillSetup(ahmet, B_QUESTIONS);
    await waitState(ahmet, "app.state && app.state.phase === 'play'", 'oyun başladı');
    await waitState(ayse, "app.state && app.state.phase === 'play'", 'oyun A');

    await shot(ayse, '06a-soru-gecisi', false);
    await sleep(1600);

    await shot(ayse, '06-oyun-soru-sahibi');
    await shot(ahmet, '07-oyun-tahmin');

    console.log('\nİlk cevap');
    await ahmet.type('#guessInput', 'Kebap');
    await ahmet.click('#guessBtn');
    await waitState(ahmet, "app.state.phase === 'reveal'", 'reveal A');
    await waitState(ayse, "app.state.phase === 'reveal'", 'reveal B');
    await shot(ahmet, '08-dogru-cevap');
    await shot(ayse, '09-es-dogru-bildi');

    await ahmet.click('[data-action="continueReveal"]');
    await ayse.click('[data-action="continueReveal"]');
    await waitState(ahmet, "app.state.phase === 'play' && app.state.question.number === 2", 'soru 2');
    await sleep(1700);

    console.log('\nYanlış cevap');
    await ayse.type('#guessInput', 'bilmiyorum');
    await ayse.click('#guessBtn');
    await waitState(ayse, "app.state.phase === 'reveal'", 'reveal 2');
    await shot(ayse, '10-yanlis-cevap');

    console.log('\nTuru tamamlama');
    await ayse.click('[data-action="continueReveal"]');
    await ahmet.click('[data-action="continueReveal"]');

    // Kalan soruları hızlıca oyna
    const auto = async (page) => {
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 200; i++) {
          const s = app.state;
          if (!s) {
            await sleep(120);
            continue;
          }
          if (s.phase === 'play' && s.question && !s.question.isMine) {
            const input = document.getElementById('guessInput');
            if (input) {
              input.value = 'bilmiyorum';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              document.getElementById('guessBtn').click();
              await sleep(320);
            }
          } else if (s.phase === 'reveal') {
            const btn = document.querySelector('[data-action="continueReveal"]');
            if (btn && !btn.disabled) {
              btn.click();
              await sleep(220);
            }
          } else if (s.phase === 'roundEnd' || s.phase === 'final') {
            return;
          }
          await sleep(100);
        }
      });
    };
    await Promise.all([auto(ayse), auto(ahmet)]);
    await waitState(ahmet, "app.state.phase === 'roundEnd'", 'tur bitti');
    await shot(ayse, '11-tur-sonu');

    console.log('\nFinal');
    await ayse.click('[data-action="endGame"]');
    await waitState(ahmet, "app.state.phase === 'final'", 'final');
    await shot(ayse, '12-final');
    await shot(ahmet, '13-final-alt', true);

    // Dar ekran kontrolü
    console.log('\nDar ekran (320px)');
    const narrowContext = await browser.createBrowserContext();
    const narrow = await narrowContext.newPage();
    await narrow.setViewport({ width: 320, height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await narrow.goto(BASE + '/?oda=TEST1', { waitUntil: 'networkidle2' });
    await shot(narrow, '14-dar-ekran-ana');

    // Bağlantı kopması
    console.log('\nBağlantı kopması');
    const ctxC = await browser.createBrowserContext();
    const ctxD = await browser.createBrowserContext();
    const deniz = await ctxC.newPage();
    const mert = await ctxD.newPage();
    await deniz.goto(BASE, { waitUntil: 'networkidle2' });
    await deniz.type('#nameInput', 'Deniz');
    await deniz.click('#createBtn');
    await waitState(deniz, "app.state && app.state.phase === 'lobby'", 'oda 2 kuruldu');
    const code2 = await deniz.evaluate(() => app.state.code);

    await mert.goto(BASE, { waitUntil: 'networkidle2' });
    await mert.type('#nameInput', 'Mert');
    await mert.type('#codeInput', code2);
    await mert.click('#joinBtn');
    await waitState(deniz, "app.state && app.state.phase === 'setup'", 'Mert katıldı');

    await fillSetup(deniz, A_QUESTIONS);
    await fillSetup(mert, B_QUESTIONS);
    await waitState(deniz, "app.state && app.state.phase === 'play'", 'oyun başladı (2)');

    await mert.close();
    await sleep(900);
    const overlay = await deniz.evaluate(() => ({
      hidden: document.getElementById('pausedOverlay').hidden,
      text: document.getElementById('pausedText').textContent,
    }));
    console.log('  overlay:', JSON.stringify(overlay));
    await shot(deniz, '15-baglanti-koptu', false);

    console.log('\nHatalar:', errors.length ? errors : 'yok');
  } catch (error) {
    console.error('Görsel test hatası:', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
