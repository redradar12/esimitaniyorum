# ✨ Seni Tanıyorum

Arkadaşınla veya partnerinle **iki ayrı telefondan**, aynı anda oynanan bir "beni ne kadar iyi tanıyorsun?" oyunu.

Her oyuncu kendisi hakkında **5 soru ve cevabını** yazar. Sırayla karşındaki oyuncunun sorularına cevap verirsin, puanlar hesaplanır, tur biter ve **yeni 5 soruya** geçilir. Soru bulamazsan **10 kategorideki 200+ hazır sorudan** otomatik seçilir.

Dört oyun modu var: **⌨️ Soru-Cevap** (5 soru hazırlanır), **🔤 Adam Asmaca** (sırayla birbirinize soru sorarsınız, cevabı harf harf tahmin edersiniz), **✅ Doğru mu Yanlış mı?** (sistem ifade sorar, ikiniz de cevaplarsınız) ve **🏆 Takımlar Kapışması** (2-3 takım halinde yarışır). Adam Asmaca, Doğru/Yanlış ve Takımlar Kapışması’nda **hazır soru ekranı yoktur**; modu oda kurarken seçersin, oyuncular katılınca oyun doğrudan başlar.

**Takımlar Kapışması:** **2 takım (4 kişi)** veya **3 takım (6 kişi)** aynı odaya katılır. Her takım kendi iki telefonundan oynar; sistem ortak geçmiş soruları sorar, takım arkadaşları aynı cevabı verirse takım **+10 puan** kazanır. Takımlar birbirine karşı yarışır.

Arayüz Türkçe, mobil öncelikli ve koyu modern temalı. Kurulum gerektirmeyen vanilla JavaScript + Node.js/Socket.IO ile yazıldı. 2026 görsel katmanında **Three.js** ile hafif 3D şekiller, **GSAP** ile ekran geçişleri ve mikro animasyonlar, cam efektli kartlar ve Fraunces/Manrope tipografisi kullanılır.

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

1. Bilgisayar ve **iki telefon aynı bağlantı ağında** olmalı.
2. **1. telefon:** uygulamayı aç → takma adını yaz → **Yeni oda kur**.
3. **2. telefon:** en kolay yol, lobideki **QR kodu** telefon kamerasıyla okutmak. Oda otomatik açılır.
   Alternatif: aynı adresi açıp oda kodunu elle gir.
4. **Soru-Cevap** modunda ikiniz de kendi 5 sorunuzu ve cevabınızı yazın → oyun başlar. **Adam Asmaca** ve **Doğru/Yanlış** modlarında hazırlık yoktur; arkadaşın katılınca oyun otomatik başlar.
5. **Takımlar Kapışması:** oda sahibi **2 veya 3 takım** seçer. Lobide her takım için ayrı **Davet et** düğmesi vardır; buradan WhatsApp’a gönderilen bağlantıyı ya da QR’ı **o takımın iki oyuncusu da** kullanır. Birinci oyuncu takımın 1. koltuğuna, ikinci oyuncu 2. koltuğuna girer. En az 2 takım hazır olduğunda oda sahibi **Oyunu başlat** der.

---

## Sesli sohbet

Odadayken sağ alttaki **🎙️** düğmesine basıp **“Mikrofonu aç”** de. Arkadaşın da açınca sesli sohbet başlar. Görüşme oyun boyunca açık kalır; panelden **sessize al** veya **bitir** yapabilirsin.

> Takımlar Kapışması’nda sesli sohbet düğmesi gizlenir; mevcut WebRTC bağlantısı ikili görüşme için tasarlanmıştır.

- Ses, **WebRTC ile doğrudan iki telefon arasında** gider; sunucu yalnızca eşleşme sinyalini iletir, ses **kaydedilmez**.
- Mikrofon erişimi için **HTTPS** gerekir. Yayındaki Render adresi uygundur; `http://192.168.x.x` LAN adresinde tarayıcı mikrofona izin vermez.
- Ev/Wi-Fi ağlarında STUN ile çalışır. Çok kısıtlı kurumsal ağlarda TURN sunucusu gerekebilir.
- Kulaklık kullanmak echo’yu azaltır.

### Bağlantı olmuyorsa
- Telefonun ve bilgisayarın gerçekten aynı bağlantı'de olduğundan emin ol (misafir ağı olmasın).
- Windows **Güvenlik Duvarı** Node.js'e özel ağ izni isterse **İzin ver**.
- Adresi `localhost` yerine terminalde yazan `192.168.x.x` biçimindeki adresle aç.
- Farklı ağlardan (ör. ev + iş) oynamak için projeyi bir sunucuya yükleyebilirsin (aşağıya bak).

---

## Oyun modları

| Mod | Nasıl oynanır |
| --- | --- |
| ⌨️ **Soru-Cevap** | 5 soru hazırlanır. Rakibinin cevabını yazarak tahmin edersin. Her soru için 45 saniye. |
| 🔤 **Adam Asmaca** | Hazırlık yok. **Sırayla birbirinize soru sorarsınız:** biri kendisiyle ilgili soru + cevap yazar, diğeri cevabı harf harf tahmin eder; sonra roller değişir. Her soruda 6 can; doğru harf **+5**, cevabı bitiren **+10**. 6 yanlışta o sorudan puan yok. |
| ✅ **Doğru mu Yanlış mı?** | Hazırlık yok. Sistem genel kültür/ilişki ifadesi sorar; **ikiniz de** Doğru/Yanlış dersiniz. 15 saniye; doğru **+10**, ikisi de doğruysa hızlı olan **+2** ekstra. |
| 🏆 **Takımlar Kapışması** | Hazırlık yok. 2 veya 3 takım aynı odada. Sistem ortak geçmiş sorusu sorar; **her takımın iki oyuncusu ayrı ayrı** cevap verir. Cevaplar aynıysa takım **+10** alır. 10 soru / tur; 45 saniye cevap süresi. |

---

## Oyun akışı

| Aşama | Ne oluyor |
| --- | --- |
| **Lobi** | Ana sayfada mod seçilir; oda kodu + QR kod oluşur, arkadaşın katılır. Takımlar Kapışması’nda her takım için ayrı davet bağlantısı/QR oluşur. |
| **Soru hazırlığı** | Yalnızca **Soru-Cevap** modunda. Herkes kendisi hakkında 5 soru ve cevabını yazar. **Karışık** kategori veya 10 kategoriden biri seçilir; “Tümünü gör” ile 203 soru aranır. |
| **Oyun** | Soru-Cevap’ta cevap yazılır; Adam Asmaca’da sırayla soru sorulur ve cevap harf harf tahmin edilir; Doğru/Yanlış’ta iki oyuncu da karar verir; Takımlar Kapışması’nda her takımın iki oyuncusu aynı soruya ayrı ayrı cevap verir. |
| **Tur sonu** | Soru-Cevap’ta 10 soru, Adam Asmaca’da **2 soru (bir sen bir rakibin)**, Doğru/Yanlış’ta 10 ifade, Takımlar Kapışması’nda **10 soru** biter. Skorlar ve geçmiş gösterilir. Takımlar Kapışması’nda oda sahibi “Sonraki 10 soru” veya “Bitir” der. Diğer modlarda iki taraf da devam derse yeni tur başlar. |
| **Final** | "Bitir" ile toplam puanlar, kazanan ve (quizde) uyum yüzdesi gösterilir. Takımlar Kapışması’nda kazanan takım ve tüm soruların aynı cevap geçmişi listelenir. "Yeniden oyna" ile sıfırdan başlanır. |

### Puanlama

**Soru-Cevap:**

| Durum | Puan |
| --- | --- |
| Tam isabet (aynı cevap) | **10** |
| Cevabı kapsayan tahmin ("adana kebap" ↔ "kebap") | **8** |
| Kelime eşleşmesi / küçük yazım farkı | **6** |
| Bilemedi veya süre doldu | **0** |

**Adam Asmaca:** doğru harf **+5**, cevabı bitiren **+10**. 6 yanlışta o soru kaybedilir; o ana kadar kazanılan harf puanları kalır.
**Doğru/Yanlış:** doğru karar **10**, ikisi de doğruysa ilk cevaplayan **+2**; yanlış veya boş **0**.

**Takımlar Kapışması:** bir soruda iki takım arkadaşının cevabı aynıysa takım **+10**. Aynı cevap için büyük/küçük harf, Türkçe karakter, kelime içerme ve küçük yazım farkları hoş görülür (“okul” ↔ “okulda” aynı sayılır). Biri boş bıraktıysa o soruda puan yoktur.

Türkçe karakterler ve büyük/küçük harf farkı önemsenmez (`İ`/`i`, `Ş`/`ş` gibi).

---

## Proje yapısı

```
esimitanıyorum/
├─ server.js              # Express + Socket.IO oyun sunucusu (oda, tur, puanlama)
├─ game-data.js           # Doğru/yanlış ifadeleri, takımlar soruları ve yedek kelime bankası
├─ public/
│  ├─ index.html          # Ekranlar ve modal
│  ├─ styles.css          # Mobil öncelikli tema
│  ├─ app.js              # İstemci mantığı ve ekran çizimi
│  ├─ visuals.bundle.js   # 3D + animasyon paketi (esbuild çıktısı)
│  ├─ questions.js        # 10 kategori, 203 hazır soru
│  ├─ manifest.webmanifest
│  └─ icon.svg
├─ src/
│  └─ visuals.js          # Three.js/GSAP görsel katmanı (kaynak)
├─ test/
│  ├─ flow.js             # Uçtan uca sunucu testi (iki sahte oyuncu)
│  └─ visual.js           # Chrome ile mobil ekran görüntüsü testi
├─ baslat.bat             # Windows tek tık başlatıcı
└─ package.json
```

### Teknik notlar
- Sunucu otoriterdir: sorular, cevaplar ve puanlar sunucuda tutulur; istemciye oyun sırasında doğru cevap **gönderilmez**.
- Bağlantı koparsa oyun duraklar; oyuncu geri döndüğünde süre yenilenir ve kaldığı yerden devam eder. (Bu davranış ikili modlar içindir; Takımlar Kapışması’nda soru süresi işlemeye devam eder, oyuncu süre dolmadan dönerse cevap verebilir.)
- Takımlar Kapışması’nda oda sahibi takımlar için ayrı davet bağlantısı üretir: `/?oda=KOD&takim=1`, `takim=2`, `takim=3`. Aynı bağlantıyı kullanan iki takım arkadaşı aynı takımın 1. ve 2. koltuğuna yerleşir.
- Takımlar Kapışması’nda oyun sırasında biri odadan ayrılırsa oda lobiye döner; kalan oyuncular yeni davetle eksik koltuğu doldurabilir.
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
npm run ciftler      # Takımlar Kapışması sunucu akışı (4 ve 6 oyuncu, aynı cevap, puan, final)
npm run ciftler-ui   # Takımlar Kapışması arayüzü (davet, lobi, 4 oyunculu oyun, final)
npm run ses          # Sesli sohbet sinyal rölesi (SDP/ICE, katılma/ayrılma)
npm run ses-ui       # Sahte mikrofonla gerçek WebRTC bağlantısı + mute/ayrılma
```

`npm run gorsel` için Chrome gerekir. Farklı bir konumdaysa:

```bash
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Görsel katmanı yeniden derleme

3D/animasyon kaynağı `src/visuals.js` içindedir; tarayıcıya giden sürüm `public/visuals.bundle.js` olarak derlenir. Kaynakta değişiklik yaptıysan:

```bash
npm run build:ui
```

Bu komut Three.js ve GSAP'i tek, küçültülmüş bir dosyada birleştirir. Oyun mantığı, socket/WebRTC, puanlama ve soru akışı bu katmandan etkilenmez.

---

## İnternete taşıma (online oynama)

Telefonlar aynı bağlantı'de olmak zorunda kalmasın istersen uygulamayı internete taşıyabilirsin. **Render** ile ücretsiz ve kalıcı bir link 5–10 dakikada hazır olur; Vercel bu oyun için uygun değildir (nedenleriyle birlikte).

➡️ Adım adım rehber: **[DEPLOY.md](DEPLOY.md)**

- Hazır dosyalar: `render.yaml` (Blueprint), `Dockerfile`, `/saglik` sağlık kontrolü.
- `PORT` ortam değişkeni otomatik kullanılır.
- Hızlı deneme için: `cloudflared tunnel --url http://localhost:4173`

---

## Not

Bu bir eğlence uygulamasıdır; cevaplar sunucu belleğinde tutulur ve sunucu kapanınca silinir. Kalıcı bir veritabanı yok.
