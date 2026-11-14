# quora-mcp

MCP server read-only untuk membaca Quora dari Claude (atau client MCP lain). Quora tidak punya API publik untuk konten, jadi server ini merender halaman pakai headless Chromium (Playwright) lalu mengubahnya jadi JSON yang rapi: pertanyaan, jawaban teratas, author, upvote, dan profil.

- **Read-only.** Tidak ada tool yang menulis, vote, atau login atas nama kamu.
- **Pelan secara sengaja.** Maksimal 2 browser sekaligus, jeda 1,5 detik antar request, dan cache 30 menit.
- **Dua mode.** Lokal tanpa secret untuk laptop sendiri, atau di VPS dengan secret di URL untuk dipakai sebagai custom connector di Claude.

## Daftar isi

- [Tools](#tools)
- [Cara kerja](#cara-kerja)
- [Mulai cepat](#mulai-cepat)
- [Sambungkan ke client](#sambungkan-ke-client)
- [Konfigurasi](#konfigurasi)
- [Deploy ke VPS](#deploy-ke-vps)
- [Keamanan](#keamanan)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Catatan dan risiko](#catatan-dan-risiko)

## Tools

| Tool                 | Input                                                                                                                  | Hasil                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `quora_get_question` | `url` (URL pertanyaan atau jawaban), `max_answers` (1–30, default 8), `max_chars_per_answer` (200–20000, default 3000) | Judul, detail, jumlah jawaban, dan jawaban teratas (author, URL author, upvote, teks)     |
| `quora_get_profile`  | `user` (URL profil atau slug seperti `Jane-Doe-12`)                                                                    | Nama, bio, dan statistik (followers, following, answers, questions, posts, content views) |
| `quora_search`       | `query`, `limit` (1–25), `lang` (`any` / `en` / `id`)                                                                  | Judul dan URL pertanyaan. **Hanya muncul kalau `QUORA_COOKIE` diisi**                     |

Contoh hasil `quora_get_question` (dipotong):

```json
{
  "url": "https://www.quora.com/What-is-the-best-way-to-learn-programming",
  "title": "What is the best way to learn programming?",
  "answers": [
    {
      "author": "Yishan Wong",
      "authorUrl": "https://www.quora.com/profile/Yishan-Wong",
      "upvotes": 999401,
      "text": "By writing a lot of programs. …"
    }
  ],
  "source": "dom",
  "warnings": []
}
```

`source` menunjukkan dari mana data diambil (`json-ld` atau `dom`). `warnings` berisi penjelasan kalau hasilnya kosong, misalnya karena kena login wall.

## Cara kerja

**Mencari pertanyaan.** Tanpa cookie Quora, server ini tidak bisa mencari dengan andal: halaman search Quora butuh login, dan search engine yang di-scrape dari server (DuckDuckGo, Bing, Brave, dll.) sering memblokir bot atau diblokir ISP. Jadi tanpa `QUORA_COOKIE`, `quora_search` tidak didaftarkan, dan server mengirim `instructions` ke client: cari dengan web search milik client sendiri (`site:quora.com <kata kunci>`), lalu baca hasilnya dengan `quora_get_question`. Claude melakukan ini otomatis.

Kalau `QUORA_COOKIE` diisi, `quora_search` muncul dan memakai halaman search Quora asli.

**Membaca pertanyaan.** Halaman dibuka di Chromium (gambar, media, dan font diblokir supaya hemat), di-scroll untuk memuat lebih banyak jawaban, dan tombol "(more)" / "Continue Reading" diklik. Parser mencoba JSON-LD `QAPage` dulu karena paling stabil. Kalau tidak ada, parser memakai heuristik DOM.

**Struktur kode:**

```
src/
  server.ts   entry point: validasi config, HTTP (Express), endpoint MCP
  auth.ts     cek secret di path atau Host header (mode lokal)
  tools.ts    definisi tool MCP dan instructions
  quora.ts    alur per tool: URL, throttle, cache, browser, parser
  browser.ts  satu instance Chromium bersama (Playwright)
  parse.ts    fungsi murni HTML → data (dites dengan fixture)
  util.ts     Throttle, TtlCache, helper teks
  config.ts   pembacaan environment variable
test/         node:test, tanpa jaringan
deploy/       contoh config Apache
```

## Mulai cepat

Butuh Docker, atau Node.js 20+.

### Docker (disarankan)

```bash
git clone https://github.com/ahmadnathanfirdaus/quora-mcp.git
cd quora-mcp
cp .env.example .env
```

Untuk pemakaian di laptop sendiri, edit `.env`: biarkan `MCP_SECRET` kosong dan set `LOCAL_ONLY=1`. Lalu:

```bash
docker compose up -d --build
```

```bash
curl http://127.0.0.1:8787/healthz
```

Endpoint MCP: `http://127.0.0.1:8787/mcp`. Container nyala lagi otomatis setiap Docker start (`restart: unless-stopped`). Setelah mengubah kode, jalankan `docker compose up -d --build` lagi.

### Node.js

```bash
npm install
npx playwright install chromium
cp .env.example .env
set -a && source .env && set +a
npm run dev
```

Untuk mode lokal lewat Node, `LOCAL_ONLY` tidak perlu: cukup `MCP_SECRET` kosong dan `HOST=127.0.0.1` (default di `.env.example`).

## Sambungkan ke client

Server harus sudah jalan sebelum session client dimulai. Client membaca daftar MCP server hanya waktu session baru dibuka.

### Claude Code

```bash
claude mcp add --transport http --scope user quora http://127.0.0.1:8787/mcp
```

Atau tambahkan langsung ke `~/.claude.json`:

```json
{
  "mcpServers": {
    "quora": { "type": "http", "url": "http://127.0.0.1:8787/mcp" }
  }
}
```

Buka session baru, lalu coba: _"cari pertanyaan Quora soal belajar programming dan rangkum jawabannya"_.

### Claude Desktop (tab Chat)

"Add custom connector" di Settings tidak bisa menjangkau `127.0.0.1`, karena connector dihubungi dari server Anthropic. Untuk server lokal, pakai bridge [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) di `~/Library/Application Support/Claude/claude_desktop_config.json`, lalu restart Claude Desktop:

```json
{
  "mcpServers": {
    "quora": { "command": "npx", "args": ["-y", "mcp-remote", "http://127.0.0.1:8787/mcp"] }
  }
}
```

Untuk custom connector sungguhan, deploy ke VPS (lihat [Deploy ke VPS](#deploy-ke-vps)).

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Pilih transport **Streamable HTTP** dan URL `http://127.0.0.1:8787/mcp` (atau `.../mcp/<MCP_SECRET>` kalau secret diisi).

## Konfigurasi

Semua lewat environment variable (lihat `.env.example`).

| Variable          | Default        | Keterangan                                                                                                                                    |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_SECRET`      | kosong         | Kosong: mode lokal, endpoint `/mcp`. Diisi (min. 24 karakter): endpoint `/mcp/<MCP_SECRET>`. Wajib di VPS. Buat dengan `openssl rand -hex 24` |
| `HOST`            | `0.0.0.0`      | Alamat listen. `.env.example` memakai `127.0.0.1`. Di Docker selalu `0.0.0.0` (diatur di `docker-compose.yml`)                                |
| `PORT`            | `8787`         | Port HTTP                                                                                                                                     |
| `LOCAL_ONLY`      | kosong         | `1` mengizinkan mode tanpa secret walaupun `HOST` bukan loopback. Hanya untuk Docker di laptop sendiri. **Jangan dipakai di VPS**             |
| `QUORA_COOKIE`    | kosong         | Cookie sesi Quora (minimal `m-b` dan `m-lat`, format `m-b=...; m-lat=...`). Mengaktifkan `quora_search`. Pakai akun cadangan                  |
| `MAX_CONCURRENCY` | `2`            | Jumlah halaman yang boleh dibuka bersamaan                                                                                                    |
| `MIN_DELAY_MS`    | `1500`         | Jeda minimal antar request ke Quora                                                                                                           |
| `CACHE_TTL_MIN`   | `30`           | Umur cache hasil (menit)                                                                                                                      |
| `CACHE_MAX`       | `200`          | Jumlah maksimal entri cache                                                                                                                   |
| `NAV_TIMEOUT_MS`  | `30000`        | Timeout membuka halaman                                                                                                                       |
| `CHROME_PATH`     | kosong         | Path Chrome/Chromium sendiri (default: Chromium bawaan Playwright)                                                                            |
| `USER_AGENT`      | Chrome desktop | User agent browser                                                                                                                            |

## Deploy ke VPS

Contoh di bawah memakai Docker, Apache sebagai reverse proxy, dan Cloudflare.

```bash
git clone https://github.com/ahmadnathanfirdaus/quora-mcp.git && cd quora-mcp
cp .env.example .env
nano .env    # isi MCP_SECRET=$(openssl rand -hex 24), biarkan LOCAL_ONLY kosong
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
```

Tanpa `MCP_SECRET`, container menolak start di VPS (selama `LOCAL_ONLY` tidak diisi). Ini disengaja.

**Apache:**

```bash
sudo a2enmod proxy proxy_http headers ssl
sudo cp deploy/apache-quora-mcp.conf /etc/apache2/sites-available/quora-mcp.conf
sudo nano /etc/apache2/sites-available/quora-mcp.conf    # ganti ServerName dan path sertifikat
sudo a2ensite quora-mcp && sudo apachectl configtest && sudo systemctl reload apache2
```

Config contoh sudah mematikan buffering untuk streaming MCP (`flushpackets=on`) dan tidak mencatat path `/mcp/` di access log, karena path itu berisi secret.

**Cloudflare:** buat A record (misalnya `mcp`) ke IP VPS, proxied boleh, SSL mode **Full (strict)**. Kalau Claude gagal konek, cek **Security → Bots / WAF**: Bot Fight Mode bisa memblokir request dari server Anthropic. Buat rule _Skip_ untuk path `/mcp/`.

**Pasang di Claude:** Settings → Connectors → **Add custom connector**, nama `Quora`, URL `https://mcp.example.com/mcp/<MCP_SECRET>`. Biarkan OAuth kosong.

**RAM:** Chromium memakai sekitar 300–600 MB. Untuk VPS 1 GB, set `MAX_CONCURRENCY=1` dan tambahkan swap.

## Keamanan

| Mode           | Kapan                                 | Perlindungan                                                                                                                                                                                 |
| -------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lokal (Node)   | `MCP_SECRET` kosong, `HOST=127.0.0.1` | Hanya listen di loopback. Request dengan header `Host` selain `localhost` / `127.0.0.1` / `[::1]` ditolak, supaya website yang kamu buka tidak bisa memanggil server ini lewat DNS rebinding |
| Lokal (Docker) | `MCP_SECRET` kosong, `LOCAL_ONLY=1`   | Sama seperti di atas. Port hanya dipublish ke `127.0.0.1` (lihat `docker-compose.yml`)                                                                                                       |
| Server         | `MCP_SECRET` diisi                    | Secret di path URL, dibandingkan dengan constant-time compare. Path yang salah dijawab 404                                                                                                   |

Server menolak start kalau `MCP_SECRET` kosong dan `HOST` bukan loopback (kecuali `LOCAL_ONLY=1`). Siapa pun yang tahu URL berisi secret bisa memakai server ini, jadi **jangan bagikan URL itu**.

## Development

```bash
npm run dev        # jalankan dari source (tsx)
npm run build      # compile ke dist/
npm start          # jalankan dist/server.js
npm test           # node:test, tanpa jaringan
npm run lint       # Biome: lint + format check
npm run format     # Biome: perbaiki format dan import
npm run check      # typecheck + lint + test
```

Test memakai fixture HTML, bukan halaman Quora live. Setelah mengubah parser, cek juga ke Quora asli lewat MCP Inspector.

## Troubleshooting

**Tool quora tidak muncul di client.** Server belum jalan waktu session dibuka (misalnya Docker Desktop mati). Nyalakan server, cek `curl http://127.0.0.1:8787/healthz`, lalu buka session baru.

**`warnings`: "No answers found".** Lihat `source`. Kalau `dom`, kemungkinan layout Quora berubah: perbarui heuristik di `src/parse.ts`. Kalau JSON-LD masih ada, hasilnya harusnya `json-ld`.

**`warnings`: "login wall / bot check".** Quora meminta login atau verifikasi. Isi `QUORA_COOKIE`, atau kurangi frekuensi request.

**`quora_search` error `fetch failed`.** Dengan cookie, kalau search Quora tidak mengembalikan hasil, server mencoba DuckDuckGo. Beberapa ISP di Indonesia memblokir DuckDuckGo lewat DNS. Cek dengan `dig +short html.duckduckgo.com`: kalau hasilnya domain blokir ISP, ganti DNS ke `1.1.1.1` atau `8.8.8.8`.

**HTTP 404 dari `/mcp`.** Kalau `MCP_SECRET` diisi, endpoint-nya `/mcp/<MCP_SECRET>`. Kalau kosong, pastikan request memakai `127.0.0.1` atau `localhost` dengan port yang sama dengan `PORT`.

## Catatan dan risiko

- Scraping melanggar Terms of Service Quora. Server ini sengaja read-only dan pelan. Kalau memakai `QUORA_COOKIE`, gunakan **akun cadangan**, bukan akun utama.
- Selector DOM Quora sering berubah, jadi heuristik di `src/parse.ts` mungkin perlu diperbarui sewaktu-waktu.
- Konten jawaban berasal dari pengguna Quora dan dikembalikan apa adanya.
