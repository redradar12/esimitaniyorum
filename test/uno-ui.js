'use strict';

/**
 * UNO arayüz testi (2 oyuncu).
 * - Ana sayfada 5. mod olarak görünür.
 * - 7-9 kart mobil ekrana sığar; kart oynama, çekme ve renk seçimi çalışır.
 *
 *   npm run uno-ui
 */

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4185;
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
      /* bekle */
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
    defaultViewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
  });
  const pages = [];
  const errors = [];

  try {
    const newPage = async (name) => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${name} PAGE ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${name} CONSOLE ${m.text()}`);
      });
      await page.goto(BASE, { waitUntil: 'networkidle2' });
      await page.type('#nameInput', name);
      pages.push(page);
      return page;
    };

    console.log('\n1) Ana sayfa ve UNO modu');
    const host = await newPage('Ayşe');
    const modeCount = await host.$$eval('.home-mode', (els) => els.length);
    check(modeCount === 5, 'Ana sayfada 5 oyun modu var', modeCount);
    await host.click('.home-mode[data-mode="uno"]');
    await sleep(250);
    const picked = await host.evaluate(() => ({
      mode: app.homeMode,
      desc: document.getElementById('modeDesc').textContent,
      selected: document.getElementById('modeSelected').textContent,
    }));
    check(picked.mode === 'uno', 'UNO modu seçildi');
    check(picked.selected === 'UNO', 'Seçili mod etiketi UNO');
    check(picked.desc.includes('UNO'), 'UNO açıklaması görünüyor', picked.desc);
    await host.screenshot({ path: path.join(OUT, '41-uno-ana-sayfa.png') });

    await host.click('#createBtn');
    await host.waitForFunction("app.state && app.state.phase === 'lobby'", {
      timeout: 15000,
    });
    const code = await host.evaluate(() => app.state.code);
    const lobby = await host.evaluate(() => ({
      label: document.getElementById('lobbyMode').textContent,
      foot: document.getElementById('lobbyFoot').textContent,
    }));
    check(lobby.label.includes('UNO'), 'Lobide UNO etiketi var', lobby.label);
    check(lobby.foot.includes('otomatik'), 'UNO otomatik başlıyor', lobby.foot);

    console.log('\n2) İkinci oyuncu ve dağıtım');
    const guest = await newPage('Ahmet');
    await guest.goto(`${BASE}/?oda=${code}`, { waitUntil: 'networkidle2' });
    await guest.type('#nameInput', 'Ahmet');
    await guest.click('#joinBtn');
    await host.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.uno",
      { timeout: 15000 }
    );
    await guest.waitForFunction(
      "app.state && app.state.phase === 'play' && app.state.uno",
      { timeout: 15000 }
    );
    await sleep(450);

    const table = await host.evaluate(() => {
      const hand = document.querySelector('.uno-hand');
      const cards = [...document.querySelectorAll('.uno-hand .uno-card')];
      const last = cards.length ? cards[cards.length - 1].getBoundingClientRect() : null;
      return {
        screen: document.querySelector('.screen.active')?.id,
        title: document.getElementById('playTitle').textContent,
        cards: cards.length,
        opponentCards: document.querySelectorAll('.uno-mini-hand .uno-back').length,
        draw: Boolean(document.querySelector('[data-action="unoDraw"]')),
        discard: Boolean(document.querySelector('.uno-discard')),
        color: document.querySelector('.uno-color-pill')?.textContent.trim(),
        lastRight: last ? last.right : 0,
        handWidth: hand?.clientWidth || 0,
        handScroll: hand?.scrollWidth || 0,
      };
    });
    check(table.screen === 'screen-play', 'UNO masası açıldı');
    check(table.title === 'UNO', 'Başlık UNO');
    check(table.cards >= 7, 'Oyuncunun eli dağıtıldı', table.cards);
    check(table.draw && table.discard, 'Deste ve açık kart görünüyor');
    check(Boolean(table.color), 'Açık renk gösteriliyor', table.color);
    if (table.cards <= 9) {
      check(
        table.lastRight <= 390 && table.handScroll <= table.handWidth + 2,
        'Kartlar mobil genişliğe sığıyor',
        table
      );
    }
    await host.screenshot({ path: path.join(OUT, '42-uno-masa.png') });

    console.log('\n3) Renk seçici');
    await host.evaluate(() => {
      app.state.uno.pendingColor = true;
      app.state.uno.colorChooser = true;
      renderUno(app.state);
    });
    await sleep(250);
    const colorModal = await host.evaluate(() => ({
      hidden: document.getElementById('unoColorModal').hidden,
      buttons: document.querySelectorAll('#unoColorModal [data-action="unoColor"]').length,
    }));
    check(colorModal.hidden === false, 'Joker renk seçici açılıyor');
    check(colorModal.buttons === 4, 'Dört renk seçeneği var', colorModal.buttons);
    await host.screenshot({ path: path.join(OUT, '43-uno-renk.png') });
    await host.evaluate(() => {
      app.state.uno.pendingColor = false;
      app.state.uno.colorChooser = false;
      renderUno(app.state);
    });

    console.log('\n4) Hamleler');
    const act = async () => {
      const candidates = [host, guest];
      let actor = null;
      for (const page of candidates) {
        const state = await page.evaluate(() => ({
          turn: Boolean(app.state?.uno?.myTurn),
          color: Boolean(app.state?.uno?.colorChooser),
        }));
        if (state.color || state.turn) {
          actor = page;
          break;
        }
      }
      if (!actor) return false;

      await actor.evaluate(() => {
        const color = document.querySelector(
          '[data-action="unoColor"][data-color="red"]'
        );
        if (color && !document.getElementById('unoColorModal').hidden) {
          color.click();
          return;
        }
        const card = document.querySelector('.uno-hand .uno-card.playable');
        if (card) {
          card.click();
          return;
        }
        document.querySelector('[data-action="unoDraw"]')?.click();
      });
      await sleep(650);
      return true;
    };

    const before = await host.evaluate(() => ({
      cards: app.state.uno.myCount,
      log: app.state.uno.log.length,
      top: app.state.uno.top?.id,
    }));

    let acted = false;
    for (let i = 0; i < 4 && !acted; i += 1) {
      acted = await act();
    }
    check(acted, 'Sıradaki oyuncu bir hamle yaptı');

    const after = await host.evaluate(() => ({
      cards: app.state.uno.myCount,
      log: app.state.uno.log.length,
      top: app.state.uno.top?.id,
      final: app.state.phase === 'final',
    }));
    check(
      after.log > before.log || after.top !== before.top || after.cards !== before.cards,
      'Hamle duruma yansıdı',
      { before, after }
    );

    await host.screenshot({ path: path.join(OUT, '43-uno-hamle.png') });

    console.log('\n5) Final görünümü');
    await host.evaluate(() => {
      app.state.results = {
        mode: 'uno',
        winner: 'Ayşe',
        loser: 'Ahmet',
        winnerCards: 0,
        loserCards: 5,
        log: ['Ayşe Kırmızı 7 oynadı.', 'Ahmet 2 kart çekti.', 'Ayşe elini bitirdi!'],
      };
      showScreen('final');
      renderUnoFinal(app.state);
    });
    await sleep(550);
    const final = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      winner: document.querySelector('.winner-card h2')?.textContent,
      restart: Boolean(document.querySelector('[data-action="unoRestart"]')),
      loserCards: [...document.querySelectorAll('.uno-final-player b')].map(
        (el) => el.textContent
      ),
    }));
    check(final.screen === 'screen-final', 'UNO final ekranı açıldı');
    check(final.winner === 'Ayşe kazandı!', 'UNO kazananı gösteriliyor', final.winner);
    check(final.restart === true, 'UNO yeniden oyna butonu var');
    check(final.loserCards.includes('5'), 'Kalan kart sayısı gösteriliyor');
    await host.screenshot({ path: path.join(OUT, '44-uno-final.png') });

    console.log('\n6) Konsol hataları');
    check(errors.length === 0, 'Sayfa hatası yok', errors.slice(0, 3));
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.stack || error.message);
  } finally {
    for (const page of pages) {
      try {
        await page.close();
      } catch (_error) {
        /* yoksay */
      }
    }
    await browser.close();
    server.kill();
  }

  console.log('\n───────────────────────────────');
  if (failures === 0) console.log('✅ Tüm UNO arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
