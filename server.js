const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// DATABASE — Railway PostgreSQL
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('[CekDulu] DATABASE_URL not set — blog CMS disabled (set it in Railway Variables)');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id          SERIAL PRIMARY KEY,
        slug        VARCHAR(255) UNIQUE NOT NULL,
        title       TEXT NOT NULL,
        category    VARCHAR(100) DEFAULT 'Tips',
        cat_class   VARCHAR(50)  DEFAULT 'cat-tips',
        date_str    VARCHAR(50),
        read_time   VARCHAR(50)  DEFAULT '3 menit baca',
        thumb       VARCHAR(20)  DEFAULT '📝',
        body        TEXT         DEFAULT '',
        tags        TEXT         DEFAULT '',
        published   BOOLEAN      DEFAULT true,
        created_at  TIMESTAMP    DEFAULT NOW(),
        updated_at  TIMESTAMP    DEFAULT NOW()
      )
    `);
    console.log('[CekDulu] Database ready ✓');
  } catch (err) {
    console.error('[CekDulu] DB init error:', err.message);
  }
}

initDB();

// ============================================================
// ADMIN MIDDLEWARE — protect write endpoints
// Set ADMIN_KEY in Railway Variables
// ============================================================
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== (process.env.ADMIN_KEY || 'cekdulu-admin')) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-admin-key header.' });
  }
  next();
}

// ============================================================
// KEYWORD LOG — simpan pencarian untuk insight SEO + trending
// ============================================================
const keywordLog = [];
const MAX_LOG = 1000;

function logKeyword(query) {
  keywordLog.unshift({ keyword: query, timestamp: new Date().toISOString() });
  if (keywordLog.length > MAX_LOG) keywordLog.splice(MAX_LOG);
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// BLOG API — READ (public)
// ============================================================

// GET /posts — semua post yang published
app.get('/posts', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ posts: [], total: 0 });
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await pool.query(
      `SELECT id, slug, title, category, cat_class, date_str, read_time, thumb, tags, published, created_at
       FROM posts WHERE published = true
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ posts: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /posts/latest?limit=3 — untuk section homepage
app.get('/posts/latest', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ posts: [] });
  try {
    const limit = Math.min(parseInt(req.query.limit) || 3, 10);
    const { rows } = await pool.query(
      `SELECT slug, title, category, cat_class, date_str, read_time, thumb
       FROM posts WHERE published = true
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /posts/:slug — satu post lengkap (untuk article page)
app.get('/posts/:slug', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(404).json({ error: 'Not found' });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM posts WHERE slug = $1 AND published = true`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trending — top keyword untuk hot search section
app.get('/trending', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 8, 20);
  const freq = {};
  keywordLog.forEach(e => {
    const kw = e.keyword.toLowerCase().trim();
    freq[kw] = (freq[kw] || 0) + 1;
  });
  const trending = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
  res.json({ trending, total_searches: keywordLog.length });
});

// ============================================================
// BLOG API — WRITE (admin only)
// ============================================================

// GET /admin/posts — semua post termasuk draft (untuk admin panel)
app.get('/admin/posts', requireAdmin, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ posts: [] });
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, title, category, date_str, read_time, thumb, published, created_at, updated_at
       FROM posts ORDER BY created_at DESC`
    );
    res.json({ posts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/posts — buat post baru
// Body: { slug, title, category, cat_class, date_str, read_time, thumb, body, tags, published }
app.post('/admin/posts', requireAdmin, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Database not configured' });
  const { slug, title, category, cat_class, date_str, read_time, thumb, body, tags, published } = req.body;
  if (!slug || !title) return res.status(400).json({ error: 'slug and title are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO posts (slug, title, category, cat_class, date_str, read_time, thumb, body, tags, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [slug, title, category||'Tips', cat_class||'cat-tips',
       date_str || new Date().toLocaleDateString('id-ID',{year:'numeric',month:'long'}),
       read_time||'3 menit baca', thumb||'📝', body||'', tags||'', published !== false]
    );
    res.status(201).json({ success: true, post: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/posts/:slug — update post
app.put('/admin/posts/:slug', requireAdmin, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Database not configured' });
  const { title, category, cat_class, date_str, read_time, thumb, body, tags, published } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE posts SET
         title=$1, category=$2, cat_class=$3, date_str=$4,
         read_time=$5, thumb=$6, body=$7, tags=$8, published=$9, updated_at=NOW()
       WHERE slug=$10 RETURNING *`,
      [title, category, cat_class, date_str, read_time, thumb, body, tags, published, req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true, post: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/posts/:slug/toggle — publish/unpublish
app.patch('/admin/posts/:slug/toggle', requireAdmin, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { rows } = await pool.query(
      `UPDATE posts SET published = NOT published, updated_at = NOW()
       WHERE slug = $1 RETURNING slug, title, published`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true, post: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /admin/posts/:slug — hapus post
app.delete('/admin/posts/:slug', requireAdmin, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { rowCount } = await pool.query(`DELETE FROM posts WHERE slug = $1`, [req.params.slug]);
    if (!rowCount) return res.status(404).json({ error: 'Post not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/keywords — top keyword log (insight SEO)
app.get('/admin/keywords', requireAdmin, (req, res) => {
  const freq = {};
  keywordLog.forEach(e => {
    const kw = e.keyword.toLowerCase();
    freq[kw] = (freq[kw] || 0) + 1;
  });
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1]).slice(0, 50)
    .map(([keyword, count]) => ({ keyword, count }));
  res.json({ total_searches: keywordLog.length, top_keywords: top, recent: keywordLog.slice(0, 100) });
});

// ============================================================
// MARKETPLACE HELPERS
// ============================================================
function buildAffiliateLink(marketplace, originalUrl) {
  const ids = {
    shopee:    process.env.SHOPEE_AFFILIATE_ID    || 'DEMO_SHOPEE',
    tokopedia: process.env.TOKOPEDIA_AFFILIATE_ID || 'DEMO_TOKOPEDIA',
    lazada:    process.env.LAZADA_AFFILIATE_ID    || 'DEMO_LAZADA',
    bukalapak: process.env.BUKALAPAK_AFFILIATE_ID || 'DEMO_BUKALAPAK',
  };
  switch (marketplace) {
    case 'shopee':    return `${originalUrl}?af_id=${ids.shopee}`;
    case 'tokopedia': return `${originalUrl}?ref=${ids.tokopedia}`;
    case 'lazada':    return `${originalUrl}?clickid=${ids.lazada}`;
    case 'bukalapak': return `${originalUrl}?ref=${ids.bukalapak}`;
    default:          return originalUrl;
  }
}

async function searchTokopedia(query) {
  try {
    const url = `https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(query)}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept-Language': 'id-ID,id;q=0.9' };
    const response = await axios.get(url, { headers, timeout: 8000 });
    const $ = cheerio.load(response.data);
    const results = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data['@type'] === 'Product' || (Array.isArray(data) && data[0]?.['@type'] === 'Product')) {
          const products = Array.isArray(data) ? data : [data];
          products.slice(0, 3).forEach(p => {
            results.push({ name: p.name||query, price: p.offers?.price?`Rp ${parseInt(p.offers.price).toLocaleString('id-ID')}`:'Cek di Tokopedia', priceNum: parseInt(p.offers?.price)||0, marketplace:'tokopedia', url: buildAffiliateLink('tokopedia', p.url||url), rating: p.aggregateRating?.ratingValue||'4.5', reviews: p.aggregateRating?.reviewCount||'0', image: p.image||null });
          });
        }
      } catch (e) {}
    });
    if (!results.length) results.push({ name:`${query} - Tokopedia`, price:'Cek di Tokopedia', priceNum:0, marketplace:'tokopedia', url: buildAffiliateLink('tokopedia',`https://www.tokopedia.com/search?q=${encodeURIComponent(query)}`), rating:'-', reviews:'-', image:null, note:'Klik untuk lihat harga terbaru' });
    return results;
  } catch (err) {
    return [{ name:`${query} - Tokopedia`, price:'Cek di Tokopedia', priceNum:0, marketplace:'tokopedia', url: buildAffiliateLink('tokopedia',`https://www.tokopedia.com/search?q=${encodeURIComponent(query)}`), rating:'-', reviews:'-', image:null, note:'Klik untuk lihat harga terbaru' }];
  }
}

async function searchBukalapak(query) {
  try {
    const url = `https://www.bukalapak.com/products?search[keywords]=${encodeURIComponent(query)}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept-Language': 'id-ID,id;q=0.9' };
    const response = await axios.get(url, { headers, timeout: 8000 });
    const $ = cheerio.load(response.data);
    const results = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        const products = Array.isArray(data)?data:[data];
        products.filter(p=>p['@type']==='Product').slice(0,3).forEach(p=>{
          results.push({ name:p.name||query, price:p.offers?.price?`Rp ${parseInt(p.offers.price).toLocaleString('id-ID')}`:'Cek di Bukalapak', priceNum:parseInt(p.offers?.price)||0, marketplace:'bukalapak', url:buildAffiliateLink('bukalapak',p.url||url), rating:p.aggregateRating?.ratingValue||'4.5', reviews:p.aggregateRating?.reviewCount||'0', image:p.image||null });
        });
      } catch (e) {}
    });
    if (!results.length) results.push({ name:`${query} - Bukalapak`, price:'Cek di Bukalapak', priceNum:0, marketplace:'bukalapak', url:buildAffiliateLink('bukalapak',`https://www.bukalapak.com/products?search[keywords]=${encodeURIComponent(query)}`), rating:'-', reviews:'-', image:null, note:'Klik untuk lihat harga terbaru' });
    return results;
  } catch (err) {
    return [{ name:`${query} - Bukalapak`, price:'Cek di Bukalapak', priceNum:0, marketplace:'bukalapak', url:buildAffiliateLink('bukalapak',`https://www.bukalapak.com/products?search[keywords]=${encodeURIComponent(query)}`), rating:'-', reviews:'-', image:null, note:'Klik untuk lihat harga terbaru' }];
  }
}

// ============================================================
// SEARCH ENDPOINT
// ============================================================
app.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query?.trim()) return res.status(400).json({ error: 'Parameter q wajib diisi', contoh: '/search?q=Sony+WH-1000XM5' });

  logKeyword(query.trim());
  console.log(`[CekDulu] Search: "${query}" | log: ${keywordLog.length}`);

  try {
    const [tokopediaResults, bukalapakResults] = await Promise.all([searchTokopedia(query), searchBukalapak(query)]);
    const allResults = [
      ...tokopediaResults, ...bukalapakResults,
      { name:`${query} - Shopee`, price:'Cek di Shopee', priceNum:0, marketplace:'shopee', url:buildAffiliateLink('shopee',`https://shopee.co.id/search?keyword=${encodeURIComponent(query)}`), rating:'-', reviews:'-', image:null, note:'Klik untuk lihat harga terbaru' },
      { name:`${query} - Lazada`, price:'Cek di Lazada', priceNum:0, marketplace:'lazada', url:buildAffiliateLink('lazada',`https://www.lazada.co.id/catalog/?q=${encodeURIComponent(query)}`), rating:'-', reviews:'-', image:null, note:'Klik untuk lihat harga terbaru' },
    ];
    allResults.sort((a,b)=>{ if(a.priceNum>0&&b.priceNum===0)return -1; if(a.priceNum===0&&b.priceNum>0)return 1; return a.priceNum-b.priceNum; });
    res.json({ query, total:allResults.length, timestamp:new Date().toISOString(), disclaimer:'Harga dapat berubah. Semua link adalah link afiliasi.', results:allResults });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan', message: err.message });
  }
});

// ============================================================
// YOUTUBE — search video review per produk
// Set YOUTUBE_API_KEY in Railway Variables
// ============================================================
const youtubeCache = new Map(); // key: query, value: { data, expiry }
const YOUTUBE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 jam

app.get('/youtube', async (req, res) => {
  const query = req.query.q;
  if (!query?.trim()) return res.status(400).json({ error: 'Parameter q wajib diisi' });
  if (!process.env.YOUTUBE_API_KEY) return res.json({ videos: [], note: 'YOUTUBE_API_KEY not set' });

  const cacheKey = query.toLowerCase().trim();
  const cached = youtubeCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return res.json({ videos: cached.data, cached: true });
  }

  try {
    const key = process.env.YOUTUBE_API_KEY;
    const toVideo = item => ({
      id:        item.id.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumb:     item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
      url:       `https://www.youtube.com/watch?v=${item.id.videoId}`,
      published: item.snippet.publishedAt?.split('T')[0] || '',
    });

    // Request 1 — konten Indonesia (tambah kata "indonesia" di query + regionCode ID)
    const qID  = encodeURIComponent(`${query} review indonesia`);
    const urlID = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${qID}&type=video&maxResults=3&regionCode=ID&relevanceLanguage=id&key=${key}`;

    // Request 2 — review umum (Inggris/global)
    const qEN  = encodeURIComponent(`${query} review`);
    const urlEN = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${qEN}&type=video&maxResults=3&key=${key}`;

    const [resID, resEN] = await Promise.all([
      axios.get(urlID, { timeout: 5000 }).catch(() => ({ data: { items: [] } })),
      axios.get(urlEN, { timeout: 5000 }).catch(() => ({ data: { items: [] } })),
    ]);

    const videosID = (resID.data.items || []).map(toVideo);
    const videosEN = (resEN.data.items || []).map(toVideo);

    // Gabungkan: prioritaskan Indo, tambah EN kalau belum ada (deduplikasi by id)
    const seen = new Set();
    const merged = [];
    for (const v of [...videosID, ...videosEN]) {
      if (!seen.has(v.id) && merged.length < 3) {
        seen.add(v.id);
        merged.push(v);
      }
    }

    youtubeCache.set(cacheKey, { data: merged, expiry: Date.now() + YOUTUBE_CACHE_TTL });
    res.json({ videos: merged });
  } catch (err) {
    console.error('[CekDulu] YouTube API error:', err.message);
    res.json({ videos: [], error: 'YouTube fetch failed' });
  }
});

// ============================================================
// SEO — robots.txt & sitemap.xml
// Set SITE_URL in Railway Variables, e.g. https://cekdulu.id
// ============================================================
app.get('/robots.txt', (req, res) => {
  const baseUrl = (process.env.SITE_URL || 'https://cekdulu.up.railway.app').replace(/\/$/, '');
  res.setHeader('Content-Type', 'text/plain');
  res.send(
    `User-agent: *\n` +
    `Allow: /\n` +
    `Disallow: /admin\n` +
    `Disallow: /admin/\n` +
    `Disallow: /search\n\n` +
    `Sitemap: ${baseUrl}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', async (req, res) => {
  const baseUrl = (process.env.SITE_URL || 'https://cekdulu.up.railway.app').replace(/\/$/, '');
  const today = new Date().toISOString().split('T')[0];

  // Static pages
  const staticPages = [
    { loc: `${baseUrl}/`,          priority: '1.0', changefreq: 'daily'   },
    { loc: `${baseUrl}/blog.html`, priority: '0.9', changefreq: 'daily'   },
  ];

  // Dynamic posts from DB
  let dynamicPages = [];
  if (process.env.DATABASE_URL) {
    try {
      const { rows } = await pool.query(
        `SELECT slug, updated_at FROM posts WHERE published = true ORDER BY created_at DESC`
      );
      dynamicPages = rows.map(p => ({
        loc:        `${baseUrl}/article.html?slug=${p.slug}`,
        lastmod:    p.updated_at ? p.updated_at.toISOString().split('T')[0] : today,
        priority:   '0.8',
        changefreq: 'weekly',
      }));
    } catch (err) {
      console.error('[CekDulu] Sitemap DB error:', err.message);
    }
  }

  const allPages = [...staticPages, ...dynamicPages];

  const urlEntries = allPages.map(p => `
  <url>
    <loc>${p.loc}</loc>
    ${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : `<lastmod>${today}</lastmod>`}
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urlEntries + `\n</urlset>`
  );
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   CekDulu Backend v2.0.0             ║
║   Port: ${PORT}                          ║
╚══════════════════════════════════════╝
  `);
});
