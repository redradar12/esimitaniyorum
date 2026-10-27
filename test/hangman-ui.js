'use strict';

/**
 * Adam asmaca arayüz testi: mod seçimi, harf tahtası, canlar,
 * Türkçe klavye ve sonuç ekranı.
 *
 *   npm run asmaca-ui
 */

const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
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

async function fillStep(page, qtext, answer) {
  await page.evaluate(
    ({ qtext, answer }) => {
      const t = document.getElementById('qText');
      const a = document.getElementById('qAnswer');
      t.value = qtext;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      a.value = answer;
      a.dispatchEvent(new Event('input', { bubbles: true }));
      document
        .querySelector('[data-action="nextStep"], [data-action="submitQuestions"]')
        .click();
    },
    { qtext, answer }
  );
  await sleep(220);
}

(async () => {
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
    console.log('\nOda');
    await a.goto(BASE, { waitUntil: 'networkidle2' });
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

    console.log('\nMod seçimi');
    await a.type('#qText', 'En sevdiğim renk ne?');
    await a.type('#qAnswer', 'Mavi');
    await a.click('.mode-chip[data-mode="hangman"]');
    await sleep(300);
    const mode = await a.evaluate(() => ({
      mode: app.setup.items[0].mode,
      on: document.querySelector('.mode-chip.on')?.textContent.trim(),
    }));
    check(mode.mode === 'hangman', 'Harf harf modu seçildi', mode.on);
    await a.screenshot({ path: path.join(OUT, '22-asmaca-modu.png') });

    await a.click('[data-action="nextStep"]');
    await sleep(1300);

    const rest = [
      ['En sevdiğim yemek?', 'Kebap'],
      ['En sevdiğim spor?', 'Futbol'],
      ['Evcil hayvanım?', 'Kedi'],
      ['Tatilde deniz mi dağ mı?', 'Deniz'],
    ];
    for (const [qt, ans] of rest) await fillStep(a, qt, ans);
    await sleep(500);

    for (const [qt, ans] of [
      ['En sevdiğim hayvan?', 'Köpek'],
      ['En sevdiğim içecek?', 'Çay'],
      ['En sevdiğim renk?', 'Yeşil'],
      ['Hangi takımı tutuyorum?', 'Basketbol'],
      ['Tatil yerim?', 'Dağ'],
    ]) {
      await fillStep(b, qt, ans);
    }

    await b.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.question && app.state.question.number === 1",
      { timeout: 15000 }
    );
    await sleep(1800);

    console.log('\nHarf tahtası');
    const board = await b.evaluate(() => ({
      cells: document.querySelectorAll('.hm-board .hm-cell').length,
      keys: document.querySelectorAll('.hm-key').length,
      hearts: document.querySelectorAll('.hm-lives span.off').length,
      lives: document.querySelector('.hm-lives span:last-child')?.textContent,
      counter: document.getElementById('playCounter')?.textContent,
      sub: document.querySelector('#playBody .q-sub')?.textContent,
    }));
    check(board.cells === 4, `"Mavi" için 4 harf kutusu (${board.cells})`);
    check(board.keys === 32, `Türkçe klavye 32 harf (${board.keys})`);
    check(board.hearts === 0, 'Başlangıçta hiç can kaybı yok');
    check(board.lives === '6 can', '6 can yazıyor', board.lives);
    check(board.counter === 'Soru 1/10', 'Sayaç Soru 1/10', board.counter);
    check(board.sub.includes('Harf seçerek'), 'Yönlendirme metni var', board.sub);
    await b.screenshot({ path: path.join(OUT, '23-asmaca-tahta.png') });

    const ownerView = await a.evaluate(() => ({
      cells: document.querySelectorAll('.hm-board .hm-cell').length,
      keys: document.querySelectorAll('.hm-key').length,
      note: document.querySelector('#typingLine')?.textContent,
    }));
    check(ownerView.cells === 4, 'Sorunun sahibi de tahtayı görüyor');
    check(ownerView.keys === 0, 'Sahipte klavye yok');
    check(ownerView.note.includes('harf seçiyor'), 'Sahibe "harf seçiyor" bilgisi veriliyor', ownerView.note);

    console.log('\nYanlış harfler');
    await b.click('.hm-key[data-letter="K"]');
    await sleep(350);
    await b.click('.hm-key[data-letter="L"]');
    await sleep(500);
    const afterWrong = await b.evaluate(() => ({
      off: document.querySelectorAll('.hm-lives span.off').length,
      lives: document.querySelector('.hm-lives span:last-child')?.textContent,
      wrong: document.querySelector('.hm-wrong')?.textContent,
      disabled: document.querySelectorAll('.hm-key[disabled]').length,
    }));
    check(afterWrong.off === 2, '2 can gitti');
    check(afterWrong.lives === '4 can', '4 can kaldı', afterWrong.lives);
    check(afterWrong.wrong.includes('K') && afterWrong.wrong.includes('L'), 'Yanlış harfler listelendi', afterWrong.wrong);
    check(afterWrong.disabled === 2, 'Kullanılan harfler pasifleşti');
    await b.screenshot({ path: path.join(OUT, '24-asmaca-yanlis.png') });

    console.log('\nDoğru harfler');
    for (const letter of ['M', 'A', 'V', 'İ']) {
      await b.click(`.hm-key[data-letter="${letter}"]`);
      await sleep(400);
    }
    await b.waitForFunction("app.state && app.state.phase === 'reveal'", { timeout: 15000 });
    await sleep(400);
    const reveal = await b.evaluate(() => ({
      points: app.state.question.points,
      solved: app.state.question.hangman.solved,
      title: document.querySelector('.verdict h2')?.textContent,
      label: document.querySelector('.compare-item.guess span')?.textContent,
      guess: document.querySelector('.compare-item.guess p')?.textContent,
      answer: document.querySelector('.compare-item.truth p')?.textContent,
      note: document.querySelector('.card .hint.center')?.textContent,
    }));
    check(reveal.solved === true, 'Kelime çözüldü');
    check(reveal.points === 8, `2 yanlış → 8 puan (${reveal.points})`);
    check(reveal.title.includes('Harf harf bildin'), 'Sonuç başlığı doğru', reveal.title);
    check(reveal.label === 'Senin tahtan', 'Tahmin tahtası etiketi', reveal.label);
    check(reveal.guess.replace(/\s/g, '') === 'MAVİ', 'Tahta tamamlanmış', reveal.guess);
    check(reveal.answer === 'Mavi', 'Doğru cevap gösteriliyor', reveal.answer);
    check(reveal.note.includes('4 can'), 'Kalan can bilgisi var', reveal.note);
    await b.screenshot({ path: path.join(OUT, '25-asmaca-sonuc.png') });

    console.log('\nHatalar:', errors.length ? errors : 'yok');
    if (errors.length) failures++;
  } catch (error) {
    failures++;
    console.error('Test hatası:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm adam asmaca arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
