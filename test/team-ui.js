'use strict';

/**
 * Çiftler Kapışması arayüz testi (4 oyuncu / 2 çift).
 * - Ev sahibi 2 çiftlik oda kurar, çift davetlerini paylaşır.
 * - Her çift kendi iki telefonundan aynı soruya cevap verir.
 * - Eşleşen cevaplar +10; 10 soru sonunda tur sonu ve final.
 *
 *   npm run ciftler-ui
 */

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4184;
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

async function newPage(browser, name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] pageerror:`, String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[${name}] console:`, m.text());
  });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.type('#nameInput', name);
  return page;
}

async function answer(page, value) {
  await page.waitForSelector('#teamAnswer', { timeout: 12000 });
  await page.click('#teamAnswer');
  await page.type('#teamAnswer', value);
  await page.keyboard.press('Enter');
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
  const teamClients = [];
  const errors = [];

  try {
    console.log('\n1) Ana sayfa ve takım modu');
    const host = await newPage(browser, 'Ayşe');
    pages.push(host);
    host.on('pageerror', (e) => errors.push(String(e)));
    host.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await host.click('.home-mode[data-mode="team"]');
    await sleep(200);
    const picked = await host.evaluate(() => ({
      mode: app.homeMode,
      teamCount: app.teamCount,
      rowHidden: document.getElementById('teamCountRow').hidden,
      desc: document.getElementById('modeDesc').textContent,
    }));
    check(picked.mode === 'team', 'Çiftler modu seçildi');
    check(picked.teamCount === 2, 'Varsayılan 2 çift');
    check(picked.rowHidden === false, 'Çift sayısı seçimi görünür');
    check(picked.desc.includes('4-6'), 'Mod açıklaması güncellendi', picked.desc);

    await host.click('[data-action="pickTeams"][data-teams="3"]');
    await sleep(150);
    const three = await host.evaluate(() => ({
      count: app.teamCount,
      badge: document.getElementById('createPlayersBadge').textContent,
      on: document.querySelector('.team-count.on')?.dataset.teams,
    }));
    check(three.count === 3 && three.on === '3', '3 çift seçilebiliyor', three);
    check(three.badge === '6 kişi', 'Rozet 6 kişiye güncellendi', three.badge);
    await host.click('[data-action="pickTeams"][data-teams="2"]');
    await sleep(150);
    await host.screenshot({ path: path.join(OUT, '30-ana-sayfa-ciftler.png') });

    await host.click('#createBtn');
    await host.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });
    const code = await host.evaluate(() => app.state.code);
    const lobby = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      teamCode: document.getElementById('teamCode').textContent,
      cards: document.querySelectorAll('.team-card').length,
      inviteButtons: document.querySelectorAll('[data-action="teamInvite"]').length,
      startDisabled: document.getElementById('teamStartBtn').disabled,
      hint: document.getElementById('teamStartHint').textContent,
    }));
    check(lobby.screen === 'screen-teamLobby', 'Çiftler lobisi açıldı', lobby.screen);
    check(lobby.teamCode === code, 'Oda kodu görünüyor');
    check(lobby.cards === 2, '2 çift kartı var');
    check(lobby.inviteButtons === 2, 'Eksik çiftler için davet butonu var');
    check(lobby.startDisabled === true, 'Tek başına başlatma kapalı');
    await sleep(400);
    await host.screenshot({ path: path.join(OUT, '31-ciftler-lobisi-bos.png') });

    console.log('\n2) Çift daveti');
    await host.click('[data-action="teamInvite"][data-team="1"]');
    await sleep(450);
    const invite = await host.evaluate(() => ({
      hidden: document.getElementById('teamInviteModal').hidden,
      title: document.getElementById('teamInviteTitle').textContent,
      qr: document.getElementById('teamInviteQr').src,
      link: document.getElementById('teamInviteLink').textContent,
    }));
    check(invite.hidden === false, 'Davet penceresi açıldı');
    check(invite.qr.includes(`oda=${code}`) && invite.qr.includes('takim=1'), 'QR çift linki içeriyor');
    check(invite.link.includes(`oda=${code}`) && invite.link.includes('takim=1'), 'Davet linki doğru');
    await host.screenshot({ path: path.join(OUT, '32-cift-daveti.png') });
    await host.click('[data-action="closeTeamInvite"]');
    await sleep(150);

    console.log('\n3) 4 oyuncu katılıyor');
    const partner = await newPage(browser, 'Ahmet');
    pages.push(partner);
    await partner.goto(`${BASE}/?oda=${code}&takim=1`, { waitUntil: 'networkidle2' });
    await partner.type('#nameInput', 'Ahmet');
    await partner.click('#joinBtn');
    await partner.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });
    const partnerView = await partner.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      team: app.state.me.team,
      seat: app.state.me.seat,
      note: document.getElementById('joinTeamNote').hidden,
    }));
    check(partnerView.screen === 'screen-teamLobby', 'Eş çiftler lobisinde');
    check(partnerView.team === 1 && partnerView.seat === 1, 'Eş 1. çiftin 2. koltuğunda');

    const rivalA = await newPage(browser, 'Zeynep');
    pages.push(rivalA);
    await rivalA.goto(`${BASE}/?oda=${code}&takim=2`, { waitUntil: 'networkidle2' });
    await rivalA.type('#nameInput', 'Zeynep');
    await rivalA.click('#joinBtn');
    await rivalA.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });

    const rivalB = await newPage(browser, 'Mert');
    pages.push(rivalB);
    await rivalB.goto(`${BASE}/?oda=${code}&takim=2`, { waitUntil: 'networkidle2' });
    await rivalB.type('#nameInput', 'Mert');
    await rivalB.click('#joinBtn');
    await rivalB.waitForFunction("app.state && app.state.phase === 'lobby'", { timeout: 15000 });

    await host.waitForFunction(
      "app.state.canStart === true && app.state.teams.every(t => t.complete)",
      { timeout: 15000 }
    );
    const fullLobby = await host.evaluate(() => ({
      names: app.state.teams.map((t) => t.name),
      startDisabled: document.getElementById('teamStartBtn').disabled,
      startText: document.getElementById('teamStartBtn').textContent,
      inviteButtons: document.querySelectorAll('[data-action="teamInvite"]').length,
    }));
    check(
      fullLobby.names[0] === 'Ayşe & Ahmet' && fullLobby.names[1] === 'Zeynep & Mert',
      'Çiftler doğru eşleşti',
      fullLobby.names
    );
    check(fullLobby.startDisabled === false, 'Oyun başlatılabilir');
    check(fullLobby.startText.includes('başlat'), 'Başlat butonu hazır');
    check(fullLobby.inviteButtons === 0, 'Tamamlanan çiftlerde davet butonu yok');
    await host.screenshot({ path: path.join(OUT, '33-ciftler-lobisi-dolu.png') });

    console.log('\n4) Oyun başlıyor');
    await host.click('#teamStartBtn');
    for (const page of pages) {
      await page.waitForFunction(
        "app.state.phase === 'teamPlay' && app.state.teamQuestion",
        { timeout: 15000 }
      );
    }
    await sleep(500);
    const play = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      title: document.getElementById('playTitle').textContent,
      counter: document.getElementById('playCounter').textContent,
      question: document.querySelector('#playBody .question-text')?.textContent,
      scores: [...document.querySelectorAll('.team-score .ts-name')].map((e) => e.textContent),
      input: Boolean(document.getElementById('teamAnswer')),
    }));
    check(play.screen === 'screen-play', 'Oyun ekranı açıldı');
    check(play.title === 'Çiftler Kapışması', 'Başlık doğru');
    check(play.counter === 'Soru 1/10', 'Sayaç 1/10', play.counter);
    check(Boolean(play.question), 'Soru görünüyor');
    check(play.scores.length === 2, '2 çift skoru görünüyor');
    check(play.input === true, 'Cevap girişi var');
    await host.screenshot({ path: path.join(OUT, '34-ciftler-soru.png') });

    console.log('\n5) Cevaplar ve açıklama');
    await rivalB.waitForSelector('#teamAnswer', { timeout: 12000 });
    await rivalB.click('#teamAnswer');
    await rivalB.type('#teamAnswer', 'den');
    await answer(host, 'okulda');
    await host.waitForFunction(
      "app.state.teamQuestion && app.state.teamQuestion.myAnswer !== null",
      { timeout: 12000 }
    );
    await host.waitForFunction("!document.getElementById('teamAnswer')", {
      timeout: 12000,
    });
    await partner.waitForFunction(
      "app.state.teamQuestion && app.state.teamQuestion.partnerAnswered === true",
      { timeout: 12000 }
    );
    const partnerView2 = await partner.evaluate(() => ({
      myAnswer: app.state.teamQuestion.myAnswer,
      partnerAnswered: app.state.teamQuestion.partnerAnswered,
      input: Boolean(document.getElementById('teamAnswer')),
    }));
    const hostAnswered = await host.evaluate(() => ({
      input: Boolean(document.getElementById('teamAnswer')),
      answer: app.state.teamQuestion.myAnswer,
    }));
    check(partnerView2.partnerAnswered === true, 'Eş cevabı geldi bilgisi');
    check(hostAnswered.input === false, 'Cevap veren oyuncuda giriş kapanıyor');
    check(partnerView2.input === true, 'Eş hâlâ cevap verebiliyor');
    await partner.screenshot({ path: path.join(OUT, '35-ciftler-es-bekliyor.png') });

    await answer(partner, 'okul');
    await answer(rivalA, 'park');
    await sleep(300);
    const draft = await rivalB.evaluate(() => {
      const input = document.getElementById('teamAnswer');
      return input ? input.value : null;
    });
    check(draft === 'den', 'Diğer cevaplar gelirken yazılan cevap korunuyor', draft);
    await rivalB.type('#teamAnswer', 'iz');
    await rivalB.keyboard.press('Enter');

    await host.waitForFunction("app.state.phase === 'teamReveal'", { timeout: 15000 });
    await sleep(400);
    const reveal = await host.evaluate(() => ({
      verdict: document.querySelector('.verdict h2')?.textContent,
      results: [...document.querySelectorAll('.team-result')].map((el) => ({
        name: el.querySelector('.tr-head b')?.textContent,
        badge: el.querySelector('.tr-badge')?.textContent,
        answers: [...el.querySelectorAll('.tr-answer p')].map((p) => p.textContent),
      })),
      continueBtn: Boolean(document.querySelector('[data-action="teamContinue"]')),
    }));
    check(reveal.verdict === 'Eşleştiniz!', '1. çift eşleşti', reveal.verdict);
    check(reveal.results.length === 2, 'İki çift sonucu var');
    check(reveal.results[0].badge.includes('+10'), '1. çift +10 aldı', reveal.results[0]);
    check(reveal.results[1].badge.includes('Eşleşmedi'), '2. çift eşleşmedi', reveal.results[1]);
    check(reveal.continueBtn === true, 'Devam butonu var');
    await host.screenshot({ path: path.join(OUT, '36-ciftler-sonuc.png') });

    console.log('\n6) 10 soru');
    let score1 = 10;
    let score2 = 0;
    for (let step = 2; step <= 10; step++) {
      const continueBtn = await host.$('[data-action="teamContinue"]');
      if (continueBtn) await continueBtn.click();
      await host.waitForFunction(
        `app.state.phase === 'teamPlay' && app.state.teamQuestion.number === ${step}`,
        { timeout: 15000 }
      );
      await answer(host, 'okulda');
      await answer(partner, 'okulda');
      await answer(rivalA, 'park');
      await answer(rivalB, step % 2 === 0 ? 'parkta' : 'deniz');
      await host.waitForFunction(
        `app.state.phase === 'teamReveal' && app.state.teamQuestion.number === ${step}`,
        { timeout: 15000 }
      );
      score1 += 10;
      score2 += step % 2 === 0 ? 10 : 0;
      const scoresNow = await host.evaluate(() =>
        app.state.teams.filter((t) => t.index === 1 || t.index === 2).map((t) => t.score)
      );
      check(scoresNow[0] === score1 && scoresNow[1] === score2, `${step}. soru puanları`);
    }

    const lastContinue = await host.$('[data-action="teamContinue"]');
    if (lastContinue) await lastContinue.click();
    await host.waitForFunction("app.state.phase === 'teamRoundEnd'", { timeout: 15000 });
    await sleep(400);
    const roundEnd = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      title: document.getElementById('roundTitle').textContent,
      scores: [...document.querySelectorAll('.tsc-score')].map((e) => Number(e.textContent)),
      nextBtn: Boolean(document.querySelector('[data-action="teamNextRound"]')),
      endBtn: Boolean(document.querySelector('[data-action="teamEnd"]')),
      entries: document.querySelectorAll('.team-entry').length,
    }));
    check(roundEnd.screen === 'screen-roundEnd', 'Tur sonu ekranı');
    check(roundEnd.scores[0] === 100 && roundEnd.scores[1] === 50, 'Skorlar 100 - 50', roundEnd.scores);
    check(roundEnd.nextBtn && roundEnd.endBtn, 'Ev sahibi tur kontrolleri var');
    check(roundEnd.entries === 10, '10 soru geçmişi listelendi');
    await host.screenshot({ path: path.join(OUT, '37-ciftler-tur-sonu.png') });

    console.log('\n7) Final');
    await host.click('#roundBody [data-action="teamEnd"]');
    await host.waitForFunction("app.state.phase === 'final'", { timeout: 15000 });
    await sleep(400);
    const final = await host.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      winner: document.querySelector('.winner-card h2')?.textContent,
      scores: [...document.querySelectorAll('.tsc-score')].map((e) => Number(e.textContent)),
      playAgain: Boolean(document.querySelector('[data-action="teamPlayAgain"]')),
      entries: document.querySelectorAll('#finalBody .team-entry').length,
    }));
    check(final.screen === 'screen-final', 'Final ekranı');
    check(final.winner === 'Ayşe & Ahmet kazandı!', 'Kazanan çift doğru', final.winner);
    check(final.scores[0] === 100 && final.scores[1] === 50, 'Final skorları doğru');
    check(final.playAgain === true, 'Yeniden oyna butonu var');
    check(final.entries === 10, 'Finalde tüm sorular var');
    await host.screenshot({ path: path.join(OUT, '38-ciftler-final.png') });

    console.log('\n8) 3 çift / 6 kişi');
    const host3 = await newPage(browser, 'Can');
    pages.push(host3);
    await host3.click('.home-mode[data-mode="team"]');
    await host3.click('[data-action="pickTeams"][data-teams="3"]');
    await host3.click('#createBtn');
    await host3.waitForFunction(
      "app.state && app.state.phase === 'lobby' && app.state.teamCount === 3",
      { timeout: 15000 }
    );
    const code3 = await host3.evaluate(() => app.state.code);
    const join3 = (name, team) => {
      const socket = io(BASE, { transports: ['websocket'], forceNew: true });
      socket.on('connect', () => socket.emit('join_room', { name, code: code3, team }));
      teamClients.push(socket);
    };
    join3('Ece', 1);
    await sleep(250);
    join3('Deniz', 2);
    join3('Efe', 2);
    await sleep(250);
    join3('Fatma', 3);
    join3('Gökhan', 3);
    await host3.waitForFunction(
      "app.state.canStart === true && app.state.teams.every(t => t.complete)",
      { timeout: 15000 }
    );
    const lobby3 = await host3.evaluate(() => ({
      cards: document.querySelectorAll('.team-card').length,
      names: app.state.teams.map((t) => t.name),
      startText: document.getElementById('teamStartBtn').textContent,
    }));
    check(lobby3.cards === 3, '3 çift kartı görünüyor');
    check(
      lobby3.names.join('|') === 'Can & Ece|Deniz & Efe|Fatma & Gökhan',
      '3 çiftin isimleri doğru'
    );
    check(lobby3.startText === 'Oyunu başlat', '3 çift hazır başlat butonu');
    await sleep(350);
    await host3.screenshot({ path: path.join(OUT, '39-ciftler-3-cift-lobi.png') });

    await host3.click('#teamStartBtn');
    await host3.waitForFunction("app.state.phase === 'teamPlay'", { timeout: 15000 });
    await sleep(500);
    const play3 = await host3.evaluate(() => ({
      scoreNames: document.querySelectorAll('.team-score').length,
      teamIds: app.state.teamIds.length,
      playerCount: app.state.teamQuestion.playerCount,
    }));
    check(play3.scoreNames === 3 && play3.teamIds === 3, '3 çift skorbarı görünüyor');
    check(play3.playerCount === 6, '6 oyuncu cevap verecek');
    await host3.screenshot({ path: path.join(OUT, '40-ciftler-3-cift-oyun.png') });

    console.log('\n9) Konsol hataları');
    check(errors.length === 0, 'Sayfa hatası yok', errors.slice(0, 3));
  } catch (error) {
    failures++;
    console.error('\nHATA:', error.stack || error.message);
  } finally {
    for (const socket of teamClients) {
      try {
        socket.close();
      } catch (_error) {
        /* yoksay */
      }
    }
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
  if (failures === 0) console.log('✅ Tüm çiftler kapışması arayüz testleri geçti');
  else console.log(`❌ ${failures} kontrol başarısız`);
  process.exit(failures === 0 ? 0 : 1);
})();
