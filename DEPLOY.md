## İnternete taşıma (online oynama)

Uygulama tek bir kalıcı Node süreci + WebSocket kullanıyor. Bu yüzden **Render** (veya Railway / Fly.io / bir VPS) en kolay yol.

### Render — ücretsiz, kalıcı link (5–10 dk)

1. GitHub'da boş bir repo aç (ör. `esimi-taniyorum`) ve bu klasörü gönder:

   ```bash
   git remote add origin https://github.com/KULLANICI/esimi-taniyorum.git
   git push -u origin main
   ```

2. [render.com](https://render.com) → **New** → **Blueprint** → repoyu seç → **Apply**.
   `render.yaml` hazır: `npm ci --omit=dev` ile kurar, `npm start` ile başlatır, sağlık kontrolü `/saglik`.
   (Blueprint yerine **New → Web Service** ile de kurabilirsin: Build `npm install`, Start `npm start`.)
3. 1–2 dakika içinde `https://esimi-taniyorum.onrender.com` gibi bir adres hazır olur.
4. İki telefon da bu adrese girsin: biri **Yeni oda kur**sun, diğeri QR kodu okutsun veya kodu yazsın.

**Deploy sonrası kontrol:** adresin gerçekten çalıştığını iki sahte oyuncuyla tam bir tur oynayarak doğrulayabilirsin:

```bash
set URL=https://esimi-taniyorum.onrender.com
node test/flow.js
```

PowerShell:

```powershell
$env:URL="https://esimi-taniyorum.onrender.com"; node test/flow.js
```

Bu betik oda kurar, iki oyuncuyu bağlar, 5+5 soru gönderir, 10 soruyu oynar, puanları ve finali kontrol eder.

Notlar:
- **Free plan** 15 dakika hareketsizlikte uyur; ilk açılış 30–60 sn sürebilir. Oyun sırasında uyumaz.
- Yeniden başlatmada oda belleği sıfırlanır (oyun sırasında sorun olmaz).
- Adresin alt alan adını Render ayarlarından değiştirebilirsin.

### Güncelleme akışı (push → otomatik deploy)

`render.yaml` içinde `autoDeploy: true` olduğu için **`main` dalına yapılan her push otomatik deploy tetikler**. Ayrıca bir şey yapmana gerek yok.

1. Değişikliği yap ve test et: `npm test`
2. Push et:

   ```bash
   git add -A
   git commit -m "Kisa aciklama"
   git push
   ```

3. Render → servis → **Events** / **Logs** sekmesinde yeni deployu izle. "Deploy live" yazınca site güncellenmiş olur (genelde 1–2 dk).
4. Siteyi yenile. O sırada açık olan eski sekmeler eski JS'i çalıştırmaya devam eder; onları da yenile.

Önemli notlar:

- Deploy sırasında servis yeniden başlar: **açık WebSocket bağlantıları kopar ve bellekteki odalar sıfırlanır.** Oyun ortasında deploy etme; turlar arasında yap.
- Otomatik deploy kapalıysa: **Settings → Build & Deploy → Auto-Deploy → Yes**. Ya da **Manual Deploy → Deploy latest commit**.
- `render.yaml` içindeki plan/env/build komutu gibi ayarlar değişirse Render Blueprint senkronizasyonu isteyebilir. Sıradan kod değişiklikleri otomatik akar.
- Deploy başarısız olursa **Logs**'ta build/start hatası görünür; son commit'i düzeltip tekrar push etmek yeterlidir.

## Neden Vercel değil?

Vercel'de WebSocket desteği Ekim 2026'da genel kullanıma açıldı, ancak bu oyun için uygun değil:

- **Bağlantı süresi:** Hobby planda tek bağlantı en fazla 300 saniye (5 dk) açık kalabilir; 10 soruluk bir tur bunu rahatça aşar.
- **Örnek (instance) sabitlemesi:** Her bağlantı tek bir function örneğine bağlanır; oda durumu bellekte olduğu için iki oyuncu farklı örneklere düşerse birbirini görmez.
- **Çözüm maliyeti:** Upstash Redis + Socket.IO Redis adapter + durum katmanının yeniden yazılması gerekir. Kalıcı süreç çalıştıran bir servis çok daha basit.

Yine de Vercel'de ısrar edersen: istemciyi `transports: ['websocket']` ile, sunucuyu `api/socket-io.ts` olarak çalıştırıp oda durumunu Redis'e taşımak gerekir.

### Docker / VPS

```bash
docker build -t esimi .
docker run -p 4173:4173 esimi
```

`PORT` ortam değişkeni her yerde desteklenir. Sağlık kontrolü: `/saglik`.

### Hızlı test: geçici tünel

Kalıcı sunucu kurmadan, bilgisayarın açıkken oynamak için Cloudflare tüneli:

```bash
cloudflared tunnel --url http://localhost:4173
```

Verdiği `https://...trycloudflare.com` adresini iki telefonla da açabilirsin. Bilgisayar kapanınca link ölür.

> Genel bir adres yayınladığında oda kodu bilen herkes odaya katılabilir. Özel bilgi girmeyin.

