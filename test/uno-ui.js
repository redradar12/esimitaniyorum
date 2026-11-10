'use strict';

/**
 * UNO arayüz testi (3 oyuncu).
 * - Ana sayfada 5. mod ve 2/3/4 oyuncu seçimi.
 * - 3 oyunculu lobi, oda sahibi başlatma düğmesi ve masa.
 * - Oyuncu şeridi, puanlar, kart oynama/çekme ve renk seçimi.
 * - El sonu ve 500 puanlık final görünümü.
 *
 *   npm run uno-ui
 */

const fs = require('fs');
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
  if (ok) console.log('  OK ', label);
  else {
    failures++;
    console.error('  FAIL', label, extra === undefined ? '' : extra);
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
  fs.mkdirSync(OUT, { recursive: true });
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
      countHidden: document.getElementById('unoCountRow').hidden,
      counts: [...document.querySelectorAll('#unoCountRow .team-count')].map((el) =>
        el.textContent.trim()
      ),
    }));
    check(picked.mode === 'uno', 'UNO modu seçildi');
    check(picked.selected === 'UNO', 'Seçili mod etiketi UNO');
    check(picked.desc.includes('UNO'), 'UNO açıklaması görünüyor', picked.desc);
    check(picked.desc.includes('500'), '500 puan hedefi açıklamada', picked.desc);
    check(picked.countHidden === false, 'Oyuncu sayısı seçici görünüyor');
    check(picked.counts.length === 3, '2/3/4 oyuncu seçenekleri var', picked.counts);

    await host.click('#unoCountRow [data-players="3"]');
    await sleep(150);
    const selectedCount = await host.evaluate(() => ({
      players: app.unoPlayers,
      badge: document.getElementById('createPlayersBadge').textContent.trim(),
      on: document.querySelector('#unoCountRow .team-count.on')?.dataset.players,
    }));
    check(selectedCount.players === 3, '3 oyuncu seçildi', selectedCount);
    check(selectedCount.badge === '3 kişi', 'Oluşturma rozeti 3 kişi', selectedCount.badge);
    check(selectedCount.on === '3', 'Seçili oyuncu sayısı işaretlendi');
    await host.screenshot({ path: path.join(OUT, '41-uno-ana-sayfa.png') });

    await host.click('#createBtn');
    await host.waitForFunction("app.state && app.state.phase === 'lobby'", {
      timeout: 15000,
    });
    const code = await host.evaluate(() => app.state.code);
    const lobby = await host.evaluate(() => ({
      label: document.getElementById('lobbyMode').textContent,
      foot: document.getElementById('lobbyFoot').textContent,
      startHidden: document.getElementById('lobbyStartBtn').hidden,
      startText: document.getElementById('lobbyStartBtn').textContent.trim(),
      maxPlayers: app.state.maxPlayers,
    }));
    check(lobby.label.includes('UNO'), 'Lobide UNO etiketi var', lobby.label);
    check(lobby.maxPlayers === 3, 'Lobi kapasitesi 3', lobby.maxPlayers);
    check(lobby.foot.includes('1/3'), 'Lobide 1/3 oyuncu bilgisi var', lobby.foot);
    check(lobby.startHidden === false, 'Oda sahibi başlat düğmesini görüyor');
    check(lobby.startText.includes('1/3'), 'Başlat düğmesi oyuncu sayısını gösteriyor', lobby.startText);

    console.log('\n2) Üç oyuncu ve masa');
    const guest = await newPage('Ahmet');
    await guest.goto(`${BASE}/?oda=${code}`, { waitUntil: 'networkidle2' });
    await guest.type('#nameInput', 'Ahmet');
    await guest.click('#joinBtn');
    await host.waitForFunction(
      "app.state && app.state.phase === 'lobby' && app.state.players.length === 2",
      { timeout: 15000 }
    );
    const hostTwo = await host.evaluate(() => app.state);
    const twoLobby = await host.evaluate(() => ({
      foot: document.getElementById('lobbyFoot').textContent,
      startText: document.getElementById('lobbyStartBtn').textContent.trim(),
      startHidden: document.getElementById('lobbyStartBtn').hidden,
    }));
    check(hostTwo.players.length === 2, 'İkinci oyuncu lobide');
    check(twoLobby.startHidden === false, 'Başlat düğmesi hâlâ görünür');
    check(twoLobby.startText.includes('2/3'), 'Başlat düğmesi 2/3 gösteriyor', twoLobby.startText);

    const third = await newPage('Zeynep');
    await third.goto(`${BASE}/?oda=${code}`, { waitUntil: 'networkidle2' });
    await third.type('#nameInput', 'Zeynep');
    await third.click('#joinBtn');
    await Promise.all(
      [host, guest, third].map((page) =>
        page.waitForFunction(
          "app.state && app.state.phase === 'play' && app.state.uno",
          { timeout: 15000 }
        )
      )
    );
    await sleep(450);

    const table = await host.evaluate(() => {
      const hand = document.querySelector('.uno-hand');
      const cards = [...document.querySelectorAll('.uno-hand .uno-card')];
      const last = cards.length ? cards[cards.length - 1].getBoundingClientRect() : null;
      return {
        screen: document.querySelector('.screen.active')?.id,
        title: document.getElementById('playTitle').textContent,
        counter: document.getElementById('playCounter').textContent,
        cards: cards.length,
        chips: [...document.querySelectorAll('.uno-player-chip')].map((el) => ({
          name: el.querySelector('.uno-chip-name')?.textContent.trim(),
          stats: el.querySelector('.uno-chip-stats')?.textContent.trim(),
          turn: el.classList.contains('turn'),
        })),
        draw: Boolean(document.querySelector('[data-action="unoDraw"]')),
        discard: Boolean(document.querySelector('.uno-discard')),
        color: document.querySelector('.uno-color-pill')?.textContent.trim(),
        handHead: document.querySelector('.uno-hand-head')?.textContent.trim(),
        lastRight: last ? last.right : 0,
        handWidth: hand?.clientWidth || 0,
        handScroll: hand?.scrollWidth || 0,
      };
    });
    check(table.screen === 'screen-play', 'UNO masası açıldı');
    check(table.title === 'UNO', 'Başlık UNO');
    check(table.cards >= 7, 'Oyuncunun eli dağıtıldı', table.cards);
    check(table.chips.length === 3, '3 oyunculu şerit görünüyor', table.chips);
    check(
      table.chips.some((chip) => chip.name === 'Sen'),
      'Kendi oyuncu çipi işaretli',
      table.chips
    );
    check(
      table.chips.some((chip) => chip.stats.includes('kart')),
      'Kart sayıları çiplerde görünüyor',
      table.chips
    );
    check(
      table.chips.some((chip) => chip.stats.includes('p')),
      'Puanlar çiplerde görünüyor',
      table.chips
    );
    check(table.chips.filter((chip) => chip.turn).length === 1, 'Tek sıra göstergesi var');
    check(table.counter.includes('p'), 'Üst sayaçta puan var', table.counter);
    check(table.draw && table.discard, 'Deste ve açık kart görünüyor');
    check(Boolean(table.color), 'Açık renk gösteriliyor', table.color);
    check(Boolean(table.handHead), 'El başlığı var', table.handHead);
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
      const candidates = [host, guest, third];
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
      phase: app.state.phase,
    }));
    check(
      after.log > before.log || after.top !== before.top || after.cards !== before.cards,
      'Hamle duruma yansıdı',
      { before, after }
    );

    await host.screenshot({ path: path.join(OUT, '43-uno-hamle.png') });

    console.log('\n5) El sonu ekranı');
    await host.evaluate(() => {
      const uno = app.state.uno;
      const players = uno.players.map((player, index) => ({
        ...player,
        score: index === uno.players.findIndex((p) => p.isMe) ? (player.score || 0) + 35 : player.score,
      }));
      app.state.phase = 'unoRoundEnd';
      app.state.uno = {
        ...uno,
        handNumber: (uno.handNumber || 1) + 1,
        handWinner: players.findIndex((p) => p.isMe),
        handPoints: 35,
        players,
        log: ['Test: el tamamlandı.', 'Test: 35 puan eklendi.'],
      };
      showScreen('roundEnd');
      renderUnoRoundEnd(app.state);
    });
    await sleep(350);
    const roundEnd = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      title: document.getElementById('roundTitle')?.textContent,
      scores: [...document.querySelectorAll('#roundBody .uno-score-chip')].map((el) =>
        el.textContent.trim()
      ),
      next: Boolean(document.querySelector('[data-action="unoNextHand"]')),
      note: document.querySelector('.ready-note')?.textContent || '',
    }));
    check(roundEnd.screen === 'screen-roundEnd', 'El sonu ekranı açıldı', roundEnd.screen);
    check(roundEnd.scores.length === 3, 'El sonu 3 puan kartı var', roundEnd.scores);
    check(roundEnd.next === true, 'Sonraki el düğmesi var');
    check(roundEnd.note.includes('kazanan'), 'Sonraki el açıklaması var', roundEnd.note);
    await host.screenshot({ path: path.join(OUT, '44-uno-el-sonu.png') });

    console.log('\n6) Final görünümü');
    await host.evaluate(() => {
      app.state.results = {
        mode: 'uno',
        winner: 'Ayşe',
        winnerIndex: 0,
        scores: [
          { name: 'Ayşe', score: 520 },
          { name: 'Ahmet', score: 180 },
          { name: 'Zeynep', score: 95 },
        ],
        handNumber: 9,
        handPoints: 40,
        log: [
          'Ayşe Kırmızı 7 oynadı.',
          'Ahmet 2 kart çekti.',
          'Ayşe eli bitirdi (+40 puan).',
        ],
      };
      showScreen('final');
      renderUnoFinal(app.state);
    });
    await sleep(450);
    const final = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      winner: document.querySelector('.winner-card h2')?.textContent,
      restart: Boolean(document.querySelector('[data-action="unoRestart"]')),
      scores: [...document.querySelectorAll('#finalBody .uno-score-chip')].map((el) =>
        el.textContent.trim()
      ),
    }));
    check(final.screen === 'screen-final', 'UNO final ekranı açıldı');
    check(final.winner === 'Ayşe kazandı!', 'UNO kazananı gösteriliyor', final.winner);
    check(final.restart === true, 'UNO yeniden oyna butonu var');
    check(final.scores.length === 3, 'Finalde 3 oyuncu puanı var', final.scores);
    check(
      final.scores.some((text) => text.includes('520')),
      '500 üzeri kazanan puanı gösteriliyor',
      final.scores
    );
    await host.screenshot({ path: path.join(OUT, '45-uno-final.png') });

    console.log('\n7) Konsol hataları');
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

  console.log('\n----------------------------------------');
  if (failures === 0) console.log('Tüm UNO arayüz testleri geçti');
  else console.log(`${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
