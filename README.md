# 💞 Eşimi Tanıyorum

Sevgilinle / eşinle **iki ayrı telefondan**, aynı anda oynanan bir "beni ne kadar tanıyorsun?" oyunu.

Her oyuncu kendisi hakkında **5 soru ve cevabını** yazar. Sırayla eşinin sorularına cevap verirsin, puanlar hesaplanır, tur biter ve **yeni 5 soruya** geçilir. Soru bulamazsan **10 kategorideki 200+ hazır sorudan** otomatik seçilir.

Üç ayrı oyun modu var: **⌨️ Soru-Cevap**, **🔤 Adam Asmaca**, **✅ Doğru mu Yanlış mı?** Modu oda kurarken seçersin; eşin kodu/QR ile katılınca aynı modda oynarsınız.

Arayüz Türkçe, mobil öncelikli ve koyu romantik temalı. Kurulum gerektirmeyen vanilla JavaScript + Node.js/Socket.IO ile yazıldı.

---

## Hızlı başlangıç (Windows)

1. Bilgisayarda [Node.js](https://nodejs.org) kurulu olsun (18+).
2. **`baslat.bat`** dosyasına çift tıkla.
   İlk açılışta paketleri kurar, sunucuyu başlatır ve tarayıcıyı açar.
3. Terminalde yazan **"Telefonlarda"** adresini telefonlarda aç (ör. `http://192.168.1.24:4173`).

Elle başlatmak istersen:

```bash
npm install
npm start
```

Varsayılan adres: **http://localhost:4173**

> Port 4173 doluysa: `set PORT=5000 && npm start` (PowerShell: `$env:PORT=5000; npm start`)

---

## İki telefonla oynama

1. Bilgisayar ve **iki telefon aynı Wi-Fi ağında** olmalı.
2. **1. telefon:** uygulamayı aç → takma adını yaz → **Yeni oda kur**.
3. **2. telefon:** en kolay yol, lobideki **QR kodu** telefon kamerasıyla okutmak. Oda otomatik açılır.
   Alternatif: aynı adresi açıp oda kodunu elle gir.
4. İkiniz de kendi 5 sorunuzu ve cevabınızı yazın → oyun başlar.

### Bağlantı olmuyorsa
- Telefonun ve bilgisayarın gerçekten aynı Wi-Fi'de olduğundan emin ol (misafir ağı olmasın).
- Windows **Güvenlik Duvarı** Node.js'e özel ağ izni isterse **İzin ver**.
- Adresi `localhost` yerine terminalde yazan `192.168.x.x` biçimindeki adresle aç.
- Farklı ağlardan (ör. ev + iş) oynamak için projeyi bir sunucuya yükleyebilirsin (aşağıya bak).

---

## Oyun modları

| Mod | Nasıl oynanır |
| --- | --- |
| ⌨️ **Soru-Cevap** | Eşinin cevabını yazarak tahmin edersin. Her soru için 45 saniye. |
| 🔤 **Adam Asmaca** | Cevaplar 2–16 harf olmalı. Harf seçerek bulursun: 6 can, 60 saniye. 0 yanlış **10**, 1–2 yanlış **8**, 3+ yanlış **6** puan; 6 yanlışta **0**. |
| ✅ **Doğru mu Yanlış mı?** | Ekranda bir iddia çıkar: “Ayşe’nin cevabı: Mavi”. Doğru/Yanlış dersin. 30 saniye; doğru **10**, yanlış **0** puan. Yanlış iddialar eşinin cevaplarından üretilir. |

---

## Oyun akışı

| Aşama | Ne oluyor |
| --- | --- |
| **Lobi** | Ana sayfada mod seçilir; oda kodu + QR kod oluşur, eşin katılır. |
| **Soru hazırlığı** | Herkes kendisi hakkında 5 soru ve cevabını yazar. **Karışık** kategori (tüm banka) veya 10 kategoriden biri seçilir. “Tümünü gör” ile 203 soru aranıp seçilebilir; öneriler tekrar etmez. |
| **Tahmin** | Sorular sırayla gelir: A1, B1, A2, B2… Moda göre cevap yazılır, harf seçilir veya doğru/yanlış kararı verilir. |
| **Sonuç** | Tahmin/karar ile gerçek cevap yan yana gösterilir, puan eklenir. |
| **Tur sonu** | 10 soru biter, tur skoru ve tüm cevaplar listelenir. İki taraf da "Sonraki 5 soru" derse yeni tur başlar. |
| **Final** | "Bitir" ile toplam puanlar, kazanan ve uyum yüzdesi gösterilir. "Yeniden oyna" ile sıfırdan başlanır. |

### Puanlama

**Soru-Cevap:**

| Durum | Puan |
| --- | --- |
| Tam isabet (aynı cevap) | **10** |
| Cevabı kapsayan tahmin ("adana kebap" ↔ "kebap") | **8** |
| Kelime eşleşmesi / küçük yazım farkı | **6** |
| Bilemedi veya süre doldu | **0** |

**Adam Asmaca:** 0 yanlış **10**, 1–2 yanlış **8**, 3+ yanlış **6**; 6 yanlış veya süre doldu **0**.
**Doğru/Yanlış:** doğru karar **10**, yanlış karar veya süre doldu **0**.

Türkçe karakterler ve büyük/küçük harf farkı önemsenmez (`İ`/`i`, `Ş`/`ş` gibi).

---

## Proje yapısı

```
esimitanıyorum/
├─ server.js              # Express + Socket.IO oyun sunucusu (oda, tur, puanlama)
├─ public/
│  ├─ index.html          # Ekranlar ve modal
│  ├─ styles.css          # Mobil öncelikli tema
│  ├─ app.js              # İstemci mantığı ve ekran çizimi
│  ├─ questions.js        # 10 kategori, 203 hazır soru
│  ├─ manifest.webmanifest
│  └─ icon.svg
├─ test/
│  ├─ flow.js             # Uçtan uca sunucu testi (iki sahte oyuncu)
│  └─ visual.js           # Chrome ile mobil ekran görüntüsü testi
├─ baslat.bat             # Windows tek tık başlatıcı
└─ package.json
```

### Teknik notlar
- Sunucu otoriterdir: sorular, cevaplar ve puanlar sunucuda tutulur; istemciye oyun sırasında doğru cevap **gönderilmez**.
- Bağlantı koparsa oyun duraklar; oyuncu geri döndüğünde süre yenilenir ve kaldığı yerden devam eder.
- Oda kodu 5 karakterdir (karışabilecek harfler kullanılmaz).
- Oturum `sessionStorage`'da tutulur; sayfa yenilenince oyuna geri dönülür.

---

## Testler

```bash
npm test             # Oda kurma, 10 soru, puanlama, yeni tur, final, yeniden oynama
npm run gorsel       # Chrome'u 390x844 mobil görünümde açar, test/screens'e ekran görüntüleri kaydeder
npm run sorular      # Karışık kategori, tüm sorular listesi, arama, tekrarsız öneriler
npm run asmaca       # Adam Asmaca sunucu akışı (canlar, puan, geçmiş)
npm run asmaca-ui    # Adam Asmaca arayüzü (mod seçimi, klavye, tahta)
npm run dogruyanlis  # Doğru/Yanlış sunucu akışı (iddia, puan, geçmiş)
npm run dogruyanlis-ui # Doğru/Yanlış arayüzü (iddia kartı, butonlar, sonuç)
```

`npm run gorsel` için Chrome gerekir. Farklı bir konumdaysa:

```bash
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

---

## İnternete taşıma (online oynama)

Telefonlar aynı Wi-Fi'de olmak zorunda kalmasın istersen uygulamayı internete taşıyabilirsin. **Render** ile ücretsiz ve kalıcı bir link 5–10 dakikada hazır olur; Vercel bu oyun için uygun değildir (nedenleriyle birlikte).

➡️ Adım adım rehber: **[DEPLOY.md](DEPLOY.md)**

- Hazır dosyalar: `render.yaml` (Blueprint), `Dockerfile`, `/saglik` sağlık kontrolü.
- `PORT` ortam değişkeni otomatik kullanılır.
- Hızlı deneme için: `cloudflared tunnel --url http://localhost:4173`

---

## Not

Bu bir eğlence uygulamasıdır; cevaplar sunucu belleğinde tutulur ve sunucu kapanınca silinir. Kalıcı bir veritabanı yok.
