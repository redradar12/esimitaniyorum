'use strict';

/**
 * Hazır soru paneli testi: Karışık kategori, "Tümünü gör" listesi,
 * arama, soru seçme, tekrar etmeyen öneriler ve otomatik doldurma.
 *
 *   npm run sorular
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
    console.log('\nOda kuruluyor');
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
    await sleep(400);

    console.log('\nİlk giriş tanıtımı');
    const intro = await a.evaluate(() => ({
      open: !document.getElementById('introModal').hidden,
      names: document.getElementById('introNames').textContent,
      hasStart: !!document.getElementById('introStart'),
    }));
    check(intro.open, 'Tanıtım otomatik açıldı');
    check(intro.names.includes('Ayşe') && intro.names.includes('Ahmet'), 'Tanıtımda iki isim var', intro.names);
    check(intro.hasStart, 'Başla butonu var');
    await a.screenshot({ path: path.join(OUT, '19-tanitim.png') });
    await a.click('#introStart');
    await sleep(300);
    const introClosed = await a.evaluate(() => ({
      hidden: document.getElementById('introModal').hidden,
      flag: localStorage.getItem('esimi.guide.v1'),
    }));
    check(introClosed.hidden, 'Başla ile tanıtım kapandı');
    check(introClosed.flag === '1', 'Tanıtım bir daha gösterilmeyecek şekilde işaretlendi');

    console.log('\nVarsayılan görünüm');
    const initial = await a.evaluate(() => ({
      chipCount: document.querySelectorAll('.cat-chip').length,
      chips: [...document.querySelectorAll('.cat-chip')].map((c) => c.textContent.trim()),
      active: document.querySelector('.cat-chip.on')?.textContent.trim(),
      defaultCategory: app.setup.items[0].category,
      browseLabel: document.querySelector('[data-action="browse"]')?.textContent.trim(),
      suggestions: [...document.querySelectorAll('.suggest-chip')].map((c) => c.dataset.q),
    }));
    check(initial.chipCount === 11, `Kategori çipi 11 tane (${initial.chipCount})`);
    check(initial.active === '🎲 Karışık', 'Varsayılan kategori Karışık', initial.active);
    check(initial.defaultCategory === 'karisik', 'Yeni sorular Karışık kategorisinde');
    check(/203/.test(initial.browseLabel), 'Tümünü gör 203 soruyu gösteriyor', initial.browseLabel);
    check(initial.suggestions.length === 3, '3 öneri gösteriliyor');
    await a.screenshot({ path: path.join(OUT, '18-soru-onerileri.png') });

    console.log('\nSoru kaydetme geçişi');
    await a.type('#qText', 'Test sorusu 1');
    await a.type('#qAnswer', 'Test cevabı');
    await a.click('[data-action="nextStep"]');
    await sleep(300);
    const saveTrans = await a.evaluate(() => ({
      open: !document.getElementById('transition').hidden,
      title: document.getElementById('transTitle').textContent,
      stepLabel: document.querySelector('.setup-step')?.textContent,
      saved: document.querySelector('.saved-note')?.textContent,
      btn: document.querySelector('[data-action="nextStep"]')?.textContent.trim(),
    }));
    check(saveTrans.open, 'Soru kaydedilince geçiş kartı açıldı');
    check(saveTrans.title.includes('1. soru kaydedildi'), 'Geçişte "1. soru kaydedildi" yazıyor', saveTrans.title);
    check(saveTrans.stepLabel.includes('2 / 5'), 'Üstte "Soru 2 / 5" yazıyor', saveTrans.stepLabel);
    check(saveTrans.saved.includes('Test sorusu 1'), 'Kaydedilen soru özeti görünüyor', saveTrans.saved);
    check(saveTrans.btn.includes('3. soruya geç'), 'Buton "3. soruya geç" diyor', saveTrans.btn);
    await a.screenshot({ path: path.join(OUT, '20-soru-kaydedildi.png') });
    await sleep(1100);
    const transClosed = await a.evaluate(() => document.getElementById('transition').hidden);
    check(transClosed, 'Geçiş kartı kendiliğinden kapandı');
    await a.screenshot({ path: path.join(OUT, '21-soru-2.png') });

    console.log('\nTüm sorular listesi');
    await a.click('[data-action="browse"]');
    await sleep(350);
    const list = await a.evaluate(() => ({
      title: document.getElementById('listTitle').textContent,
      count: document.querySelectorAll('#listBody .q-item').length,
      first: document.querySelector('#listBody .q-item')?.dataset.q,
      open: !document.getElementById('listModal').hidden,
      searchVisible: !!document.getElementById('listSearch'),
    }));
    check(list.open, 'Liste açıldı');
    check(list.count === 203, `Listede 203 soru var (${list.count})`);
    check(list.title.includes('203'), 'Başlıkta soru sayısı yazıyor', list.title);
    check(list.searchVisible, 'Arama kutusu var');
    await a.screenshot({ path: path.join(OUT, '16-tum-sorular.png') });

    console.log('\nArama ve seçme');
    await a.type('#listSearch', 'kahve');
    await sleep(350);
    const search = await a.evaluate(() => {
      const items = [...document.querySelectorAll('#listBody .q-item')];
      return { count: items.length, texts: items.map((i) => i.dataset.q) };
    });
    check(search.count > 0, `"kahve" için sonuç bulundu (${search.count})`);
    check(
      search.texts.every((t) => t.toLocaleLowerCase('tr-TR').includes('kahve')),
      'Tüm sonuçlar aramayla uyumlu'
    );

    await a.click('#listBody .q-item');
    await sleep(350);
    const picked = await a.evaluate(() => ({
      value: document.getElementById('qText').value,
      closed: document.getElementById('listModal').hidden,
      used: app.usedQuestions.has(document.getElementById('qText').value),
    }));
    check(picked.value.toLowerCase().includes('kahve'), 'Seçilen soru forma yazıldı', picked.value);
    check(picked.closed, 'Liste kapandı');
    check(picked.used, 'Seçilen soru "kullanıldı" olarak işaretlendi');

    console.log('\nTekrar etmeyen öneriler');
    const seen = new Set([picked.value]);
    for (let i = 0; i < 4; i++) {
      await a.click('[data-action="shuffle"]');
      await sleep(250);
      const value = await a.evaluate(() => document.getElementById('qText').value);
      check(!seen.has(value), `${i + 1}. öneri yeni bir soru`, value);
      seen.add(value);
    }

    console.log('\nOtomatik doldurma');
    await a.click('[data-action="autofill"]');
    await sleep(400);
    const auto = await a.evaluate(() => ({
      texts: app.setup.items.map((i) => i.text),
      answers: app.setup.items.map((i) => i.answer),
      step: app.setup.step,
      suggestions: [...document.querySelectorAll('.suggest-chip')].map((c) => c.dataset.q),
    }));
    check(auto.texts.every((t) => t && t.length > 3), '5 soru dolduruldu');
    check(new Set(auto.texts).size === 5, '5 soru birbirinden farklı');
    check(
      auto.answers[0] === 'Test cevabı' && auto.answers.slice(1).every((x) => x === ''),
      'Var olan cevap korunuyor, yeni soruların cevabı boş'
    );
    check(auto.step === 0, 'İlk soruya dönüldü');
    check(
      auto.suggestions.every((q) => !auto.texts.includes(q)),
      'Öneriler seçilen 5 soruyla çakışmıyor'
    );

    console.log('\nKategori filtresi');
    await a.click('.cat-chip[data-id="yemek"]');
    await sleep(300);
    const cat = await a.evaluate(() => ({
      active: document.querySelector('.cat-chip.on')?.textContent.trim(),
      browseLabel: document.querySelector('[data-action="browse"]')?.textContent.trim(),
      category: app.setup.items[0].category,
    }));
    check(cat.active === '🍽️ Yemek', 'Yemek kategorisi seçildi', cat.active);
    check(/24/.test(cat.browseLabel), 'Yemek kategorisinde 24 soru görünüyor', cat.browseLabel);

    await a.click('[data-action="browse"]');
    await sleep(300);
    const catList = await a.evaluate(() => ({
      title: document.getElementById('listTitle').textContent,
      count: document.querySelectorAll('#listBody .q-item').length,
    }));
    check(catList.count === 24, `Yemek listesinde 24 soru (${catList.count})`, catList.title);
    await a.screenshot({ path: path.join(OUT, '17-kategori-sorulari.png') });

    console.log('\nHatalar:', errors.length ? errors : 'yok');
    if (errors.length) failures++;
  } catch (error) {
    failures++;
    console.error('Test hatası:', error.message);
  } finally {
    await browser.close();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm soru paneli testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
