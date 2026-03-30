# CekDulu Backend

Backend server untuk platform perbandingan harga CekDulu.

## Endpoints

| Method | URL | Keterangan |
|--------|-----|------------|
| GET | `/` | Info server |
| GET | `/health` | Health check |
| GET | `/search?q=nama+produk` | Cari produk di semua marketplace |

## Contoh penggunaan

```
GET https://your-railway-url.up.railway.app/search?q=Sony+WH-1000XM5
```

## Setup

1. Clone repo ini
2. Copy `.env.example` → `.env`
3. Isi affiliate ID di file `.env`
4. Deploy ke Railway
