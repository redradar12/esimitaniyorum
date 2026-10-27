'use strict';

/**
 * Doğru mu Yanlış mı? arayüz testi:
 * ana sayfada mod seçimi, iddia kartı, Doğru/Yanlış butonları ve sonuç.
 *
 *   npm run dogruyanlis-ui
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
    console.log('\nAna sayfa mod seçimi');
    await a.goto(BASE, { waitUntil: 'networkidle2' });
    const modes = await a.evaluate(() => document.querySelectorAll('.home-mode').length);
    check(modes === 3, `3 oyun modu kartı var (${modes})`);
    await a.click('.home-mode[data-mode="truefalse"]');
    await sleep(200);
    const picked = await a.evaluate(() => ({
      mode: app.homeMode,
      on: document.querySelector('.home-mode.on')?.dataset.mode,
      desc: document.getElementById('modeDesc')?.textContent,
    }));
    check(picked.mode === 'truefalse', 'Doğru/Yanlış modu seçildi');
    check(picked.on === 'truefalse', 'Seçili kart işaretlendi');
    check(picked.desc.includes('doğru mu yanlış mı'), 'Mod açıklaması güncellendi', picked.desc);
    await a.screenshot({ path: path.join(OUT, '26-ana-sayfa-modlar.png') });

    console.log('\nOda');
    await a.type('#nameInput', 'Ayşe');
    await a.click('#createBtn');
    await a.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });
    const code = await a.evaluate(() => app.state.code);
    const lobby = await a.evaluate(() => ({
      mode: app.state.mode,
      label: document.getElementById('lobbyMode')?.textContent,
    }));
    check(lobby.mode === 'truefalse', 'Oda doğru/yanlış modunda kuruldu');
    check(lobby.label.includes('Doğru'), 'Lobide mod etiketi var', lobby.label);

    await b.goto(BASE, { waitUntil: 'networkidle2' });
    await b.type('#nameInput', 'Ahmet');
    await b.type('#codeInput', code);
    await b.click('#joinBtn');
    await a.waitForFunction("app.state && app.state.phase === 'setup'", { timeout: 15000 });
    await sleep(500);
    await a.click('#introStart');
    await b.evaluate(() => document.getElementById('introStart')?.click());

    const guide = await a.evaluate(() => document.querySelector('.guide')?.textContent);
    check(guide.includes('Doğru mu Yanlış mı'), 'Hazırlık ekranı modu gösteriyor', guide);
    check(guide.includes('doğru mu, yanlış mı'), 'Hazırlıkta mod açıklaması var');

    for (const [qt, ans] of [
      ['En sevdiğim renk?', 'Mavi'],
      ['En sevdiğim yemek?', 'Kebap'],
      ['En sevdiğim spor?', 'Futbol'],
      ['Evcil hayvanım?', 'Kedi'],
      ['Tatilde deniz mi dağ mı?', 'Deniz'],
    ]) {
      await fillStep(a, qt, ans);
    }
    await sleep(400);
    for (const [qt, ans] of [
      ['En sevdiğim renk?', 'Yeşil'],
      ['En sevdiğim içecek?', 'Çay'],
      ['Hangi takım?', 'Basketbol'],
      ['Hangi hayvan?', 'Köpek'],
      ['Tatil yerim?', 'Dağ'],
    ]) {
      await fillStep(b, qt, ans);
    }

    await b.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.question && app.state.question.number === 1",
      { timeout: 15000 }
    );
    await sleep(1800);

    console.log('\nİfade ekranı');
    const claim = await b.evaluate(() => ({
      shown: document.querySelector('.claim-card b')?.textContent.replace(/[“”]/g, '').trim(),
      label: document.querySelector('.claim-label')?.textContent,
      buttons: document.querySelectorAll('.tf-btn').length,
      sub: document.querySelector('#playBody .q-sub')?.textContent,
      ownerButtons: 0,
    }));
    check(Boolean(claim.shown), 'İddia cevabı gösteriliyor', claim.shown);
    check(claim.label === 'İDDİA', 'İddia etiketi var');
    check(claim.buttons === 2, 'Doğru ve Yanlış butonları var');
    check(claim.sub.includes('doğru mu'), 'Yönlendirme metni var', claim.sub);
    await b.screenshot({ path: path.join(OUT, '27-dogru-yanlis.png') });

    const ownerButtons = await a.evaluate(() => document.querySelectorAll('.tf-btn').length);
    check(ownerButtons === 0, 'Soru sahibinde cevap butonları yok');

    console.log('\nKarar');
    const isTrue = claim.shown === 'Mavi';
    await b.click(isTrue ? '.tf-btn.yes' : '.tf-btn.no');
    await b.waitForFunction("app.state && app.state.phase === 'reveal'", { timeout: 15000 });
    await sleep(400);
    const reveal = await b.evaluate(() => ({
      points: app.state.question.points,
      title: document.querySelector('.verdict h2')?.textContent,
      claimTrue: app.state.question.claim.isTrue,
      note: document.querySelector('#playBody .hint.center')?.textContent,
      truth: document.querySelector('.compare-item.truth p')?.textContent,
    }));
    check(reveal.points === 10, `Doğru karar 10 puan (${reveal.points})`);
    check(reveal.claimTrue === isTrue, 'İfadenin gerçeği doğru gösterildi');
    check(reveal.title.includes('Doğru bildin'), 'Sonuç başlığı doğru', reveal.title);
    check(reveal.truth === 'Mavi', 'Gerçek cevap gösteriliyor', reveal.truth);
    check(reveal.note.includes(isTrue ? 'doğruydu' : 'yanlıştı'), 'İfade doğru/yanlış bilgisi var', reveal.note);
    await b.screenshot({ path: path.join(OUT, '28-dogru-yanlis-sonuc.png') });

    console.log('\nHatalar:', errors.length ? errors : 'yok');
    if (errors.length) failures++;
  } catch (error) {
    failures++;
    console.error('Test hatası:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm doğru/yanlış arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
