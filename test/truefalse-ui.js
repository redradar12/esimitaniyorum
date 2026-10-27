'use strict';

/**
 * Doğru mu Yanlış mı? (bağımsız mod) arayüz testi.
 * Sunucu sistem ifadelerini sorar; iki oyuncu da cevaplar.
 * 10 ifade oynanır, tur sonu ve final kontrol edilir.
 *
 *   npm run dogruyanlis-ui
 */

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { TRUE_FALSE } = require('../game-data');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4182;
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
const truthOf = (text) => {
  const item = TRUE_FALSE.find((s) => s.text === text);
  return item ? item.answer : null;
};

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
    await a.click('.home-mode[data-mode="truefalse"]');
    await sleep(200);
    const picked = await a.evaluate(() => ({
      mode: app.homeMode,
      desc: document.getElementById('modeDesc')?.textContent,
    }));
    check(picked.mode === 'truefalse', 'Doğru/Yanlış modu seçildi');
    check(picked.desc.includes('doğru/yanlış'), 'Mod açıklaması güncellendi', picked.desc);
    await a.screenshot({ path: path.join(OUT, '26-ana-sayfa-modlar.png') });

    await a.type('#nameInput', 'Ayşe');
    await a.click('#createBtn');
    await a.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });
    const code = await a.evaluate(() => app.state.code);
    const lobby = await a.evaluate(() => ({
      mode: app.state.mode,
      label: document.getElementById('lobbyMode')?.textContent,
      foot: document.getElementById('lobbyFoot')?.textContent,
    }));
    check(lobby.mode === 'truefalse', 'Oda doğru/yanlış modunda');
    check(lobby.label.includes('Doğru'), 'Lobide mod etiketi var', lobby.label);
    check(lobby.foot.includes('oyun otomatik'), 'Lobide otomatik başlama yazıyor');

    await b.goto(BASE, { waitUntil: 'networkidle2' });
    await b.type('#nameInput', 'Ahmet');
    await b.type('#codeInput', code);
    await b.click('#joinBtn');

    await a.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.quiz",
      { timeout: 15000 }
    );
    await b.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.quiz",
      { timeout: 15000 }
    );
    await sleep(600);

    console.log('\nOyun doğrudan başladı');
    const first = await a.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      title: document.getElementById('playTitle')?.textContent,
      counter: document.getElementById('playCounter')?.textContent,
      buttons: document.querySelectorAll('.tf-btn').length,
      statement: document.querySelector('#playBody .question-text')?.textContent,
      seconds: app.state.guessSeconds,
    }));
    check(first.screen === 'screen-play', 'Soru hazırlığı atlandı');
    check(first.title === 'Doğru mu Yanlış mı?', 'Başlık doğru');
    check(first.counter === '1/10', 'Sayaç 1/10', first.counter);
    check(first.buttons === 2, 'Doğru/Yanlış butonları var');
    check(Boolean(first.statement), 'Sistem ifadesi gösteriliyor');
    check(first.seconds === 15, '15 saniye');
    await a.screenshot({ path: path.join(OUT, '27-dogru-yanlis.png') });

    console.log('\n10 ifade');
    let ayseTotal = 0;
    let ahmetTotal = 0;

    for (let step = 0; step < 10; step++) {
      await a.waitForFunction(
        `app.state.phase === 'play' && app.state.quiz && app.state.quiz.number === ${step + 1}`,
        { timeout: 15000 }
      );
      const statement = await a.evaluate(() => app.state.quiz.statement);
      const truth = truthOf(statement);
      check(truth !== null, `${step + 1}. ifadenin doğrusu bulundu`);

      const selector = truth ? '.tf-btn.yes' : '.tf-btn.no';
      await a.click(selector);
      await sleep(120);
      await b.click(selector);

      await a.waitForFunction(
        `app.state.phase === 'reveal' && app.state.quiz.number === ${step + 1}`,
        { timeout: 15000 }
      );
      await sleep(200);
      const reveal = await a.evaluate(() => ({
        points: app.state.quiz.result.points,
        truth: app.state.quiz.truth,
        title: document.querySelector('#playBody .verdict h2')?.textContent,
        boxes: document.querySelectorAll('.quiz-player').length,
        badge: document.querySelector('.quiz-truth')?.textContent,
      }));
      check(reveal.truth === truth, `${step + 1}. doğru cevap gösterildi`);
      check(reveal.points[0] === 12, `${step + 1}. Ayşe ilk cevap 12 puan`, reveal.points);
      check(reveal.points[1] === 10, `${step + 1}. Ahmet 10 puan`, reveal.points);
      check(reveal.title.includes('Doğru'), `${step + 1}. doğru bildi`);
      check(reveal.boxes === 2, 'İki oyuncunun kararı gösterildi');
      check(reveal.badge.includes(truth ? 'DOĞRU' : 'YANLIŞ'), 'İfadenin gerçeği gösterildi');
      ayseTotal += 12;
      ahmetTotal += 10;

      if (step === 0) {
        await a.screenshot({ path: path.join(OUT, '28-dogru-yanlis-sonuc.png') });
      }

      await a.click('[data-action="continueReveal"]');
      await b.click('[data-action="continueReveal"]');
    }

    console.log('\nTur sonu');
    await a.waitForFunction("app.state.phase === 'roundEnd'", { timeout: 15000 });
    await sleep(400);
    const round = await a.evaluate(() => ({
      title: document.getElementById('roundTitle')?.textContent,
      scores: app.state.players.map((p) => [p.name, p.score]),
      entries: document.querySelectorAll('#roundBody .result-item').length,
      next: document.querySelector('[data-action="nextRound"]')?.textContent,
    }));
    check(round.title.includes('tur bitti'), 'Tur sonu başlığı doğru', round.title);
    check(
      round.scores.find(([name]) => name === 'Ayşe')[1] === ayseTotal &&
        round.scores.find(([name]) => name === 'Ahmet')[1] === ahmetTotal,
      `Puanlar doğru (${ayseTotal} - ${ahmetTotal})`,
      JSON.stringify(round.scores)
    );
    check(round.entries === 10, '10 ifade listelendi');
    check(round.next.includes('Sonraki 10'), 'Sonraki 10 soru butonu var');
    await a.screenshot({ path: path.join(OUT, '29-dogru-yanlis-tur-sonu.png') });

    console.log('\nFinal');
    await a.click('[data-action="endGame"]');
    await a.waitForFunction("app.state.phase === 'final'", { timeout: 15000 });
    await sleep(400);
    const final = await a.evaluate(() => ({
      title: document.querySelector('#finalBody .winner-card h2')?.textContent,
      entries: document.querySelectorAll('#finalBody .result-item').length,
      compat: document.querySelectorAll('#finalBody .compat-item').length,
    }));
    check(final.title.includes('Ayşe'), 'Finalde kazanan Ayşe', final.title);
    check(final.entries === 10, 'Tüm ifadeler finalde');
    check(final.compat === 2, 'Uyum yüzdeleri gösterildi');
    await a.screenshot({ path: path.join(OUT, '30-dogru-yanlis-final.png') });

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
  if (failures === 0) console.log('✅ Tüm doğru/yanlış arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
