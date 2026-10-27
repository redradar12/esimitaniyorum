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

Notlar:
- **Free plan** 15 dakika hareketsizlikte uyur; ilk açılış 30–60 sn sürebilir. Oyun sırasında uyumaz.
- Yeniden başlatmada oda belleği sıfırlanır (oyun sırasında sorun olmaz).
- Adresin alt alan adını Render ayarlarından değiştirebilirsin.

### Neden Vercel değil?

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

