const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================================================
// HEALTH CHECK — buat verifikasi server jalan
// ============================================================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'CekDulu Backend berjalan!',
    version: '1.0.0',
    endpoints: [
      'GET  /search?q=nama+produk',
      'GET  /health',
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// HELPER — generate affiliate link
// Nanti kamu isi dengan affiliate ID asli kamu di file .env
// ============================================================
function buildAffiliateLink(marketplace, originalUrl) {
  const affiliateIds = {
    shopee:    process.env.SHOPEE_AFFILIATE_ID    || 'DEMO_SHOPEE',
    tokopedia: process.env.TOKOPEDIA_AFFILIATE_ID || 'DEMO_TOKOPEDIA',
    lazada:    process.env.LAZADA_AFFILIATE_ID    || 'DEMO_LAZADA',
    bukalapak: process.env.BUKALAPAK_AFFILIATE_ID || 'DEMO_BUKALAPAK',
  };

  // Format affiliate link per marketplace
  // Ini akan diupdate di Phase 2B saat kamu dapet affiliate API key resmi
  switch (marketplace) {
    case 'shopee':
      return `${originalUrl}?af_id=${affiliateIds.shopee}`;
    case 'tokopedia':
      return `${originalUrl}?ref=${affiliateIds.tokopedia}`;
    case 'lazada':
      return `${originalUrl}?clickid=${affiliateIds.lazada}`;
    case 'bukalapak':
      return `${originalUrl}?ref=${affiliateIds.bukalapak}`;
    default:
      return originalUrl;
  }
}

// ============================================================
// HELPER — scrape Tokopedia (workaround tanpa API resmi)
// ============================================================
async function searchTokopedia(query) {
  try {
    const url = `https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(query)}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9',
    };
    const response = await axios.get(url, { headers, timeout: 8000 });
    const $ = cheerio.load(response.data);

    const results = [];
    // Tokopedia renders via React — kita ambil dari script tag JSON
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data['@type'] === 'Product' || (Array.isArray(data) && data[0]?.['@type'] === 'Product')) {
          const products = Array.isArray(data) ? data : [data];
          products.slice(0, 3).forEach(p => {
            results.push({
              name: p.name || query,
              price: p.offers?.price ? `Rp ${parseInt(p.offers.price).toLocaleString('id-ID')}` : 'Cek di Tokopedia',
              priceNum: parseInt(p.offers?.price) || 0,
              marketplace: 'tokopedia',
              url: buildAffiliateLink('tokopedia', p.url || url),
              rating: p.aggregateRating?.ratingValue || '4.5',
              reviews: p.aggregateRating?.reviewCount || '0',
              image: p.image || null,
            });
          });
        }
      } catch (e) {}
    });

    // Fallback: return placeholder jika scraping tidak berhasil
    if (results.length === 0) {
      results.push({
        name: `${query} - Tokopedia`,
        price: 'Cek di Tokopedia',
        priceNum: 0,
        marketplace: 'tokopedia',
        url: buildAffiliateLink('tokopedia', `https://www.tokopedia.com/search?q=${encodeURIComponent(query)}`),
        rating: '-',
        reviews: '-',
        image: null,
        note: 'Klik untuk lihat harga terbaru',
      });
    }

    return results;
  } catch (error) {
    console.error('Tokopedia search error:', error.message);
    return [{
      name: `${query} - Tokopedia`,
      price: 'Cek di Tokopedia',
      priceNum: 0,
      marketplace: 'tokopedia',
      url: buildAffiliateLink('tokopedia', `https://www.tokopedia.com/search?q=${encodeURIComponent(query)}`),
      rating: '-',
      reviews: '-',
      image: null,
      note: 'Klik untuk lihat harga terbaru',
    }];
  }
}

// ============================================================
// HELPER — scrape Bukalapak
// ============================================================
async function searchBukalapak(query) {
  try {
    const url = `https://www.bukalapak.com/products?search[keywords]=${encodeURIComponent(query)}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept-Language': 'id-ID,id;q=0.9',
    };
    const response = await axios.get(url, { headers, timeout: 8000 });
    const $ = cheerio.load(response.data);

    const results = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        const products = Array.isArray(data) ? data : [data];
        products.filter(p => p['@type'] === 'Product').slice(0, 3).forEach(p => {
          results.push({
            name: p.name || query,
            price: p.offers?.price ? `Rp ${parseInt(p.offers.price).toLocaleString('id-ID')}` : 'Cek di Bukalapak',
            priceNum: parseInt(p.offers?.price) || 0,
            marketplace: 'bukalapak',
            url: buildAffiliateLink('bukalapak', p.url || url),
            rating: p.aggregateRating?.ratingValue || '4.5',
            reviews: p.aggregateRating?.reviewCount || '0',
            image: p.image || null,
          });
        });
      } catch (e) {}
    });

    if (results.length === 0) {
      results.push({
        name: `${query} - Bukalapak`,
        price: 'Cek di Bukalapak',
        priceNum: 0,
        marketplace: 'bukalapak',
        url: buildAffiliateLink('bukalapak', `https://www.bukalapak.com/products?search[keywords]=${encodeURIComponent(query)}`),
        rating: '-',
        reviews: '-',
        image: null,
        note: 'Klik untuk lihat harga terbaru',
      });
    }

    return results;
  } catch (error) {
    console.error('Bukalapak search error:', error.message);
    return [{
      name: `${query} - Bukalapak`,
      price: 'Cek di Bukalapak',
      priceNum: 0,
      marketplace: 'bukalapak',
      url: buildAffiliateLink('bukalapak', `https://www.bukalapak.com/products?search[keywords]=${encodeURIComponent(query)}`),
      rating: '-',
      reviews: '-',
      image: null,
      note: 'Klik untuk lihat harga terbaru',
    }];
  }
}

// ============================================================
// MAIN SEARCH ENDPOINT
// GET /search?q=nama+produk
// ============================================================
app.get('/search', async (req, res) => {
  const query = req.query.q;

  if (!query || query.trim() === '') {
    return res.status(400).json({
      error: 'Parameter q (query) wajib diisi',
      contoh: '/search?q=Sony+WH-1000XM5'
    });
  }

  console.log(`[CekDulu] Searching: "${query}"`);

  try {
    // Jalankan semua scraping secara paralel (lebih cepat)
    const [tokopediaResults, bukalapakResults] = await Promise.all([
      searchTokopedia(query),
      searchBukalapak(query),
    ]);

    // Gabungkan semua hasil
    const allResults = [
      ...tokopediaResults,
      ...bukalapakResults,
      // Shopee & Lazada: link langsung ke search page dengan affiliate
      // (akan di-upgrade ke API resmi saat affiliate account aktif)
      {
        name: `${query} - Shopee`,
        price: 'Cek di Shopee',
        priceNum: 0,
        marketplace: 'shopee',
        url: buildAffiliateLink('shopee', `https://shopee.co.id/search?keyword=${encodeURIComponent(query)}`),
        rating: '-',
        reviews: '-',
        image: null,
        note: 'Klik untuk lihat harga terbaru',
      },
      {
        name: `${query} - Lazada`,
        price: 'Cek di Lazada',
        priceNum: 0,
        marketplace: 'lazada',
        url: buildAffiliateLink('lazada', `https://www.lazada.co.id/catalog/?q=${encodeURIComponent(query)}`),
        rating: '-',
        reviews: '-',
        image: null,
        note: 'Klik untuk lihat harga terbaru',
      },
    ];

    // Sort: yang ada harga dulu, yang belum ada harga di bawah
    allResults.sort((a, b) => {
      if (a.priceNum > 0 && b.priceNum === 0) return -1;
      if (a.priceNum === 0 && b.priceNum > 0) return 1;
      return a.priceNum - b.priceNum;
    });

    res.json({
      query,
      total: allResults.length,
      timestamp: new Date().toISOString(),
      disclaimer: 'Harga dapat berubah sewaktu-waktu. Semua link adalah link afiliasi.',
      results: allResults,
    });

  } catch (error) {
    console.error('[CekDulu] Search error:', error.message);
    res.status(500).json({
      error: 'Terjadi kesalahan saat mencari produk',
      message: error.message
    });
  }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   CekDulu Backend v1.0.0             ║
║   Server berjalan di port ${PORT}        ║
║   http://localhost:${PORT}               ║
╚══════════════════════════════════════╝
  `);
});
