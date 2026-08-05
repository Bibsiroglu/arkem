require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Supabase Veritabanı Bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Veritabanında tablo yoksa otomatik oluştur
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('⚡ Supabase veritabanına bağlandık ve "tenants" tablosu hazır!');
  } catch (err) {
    console.error('❌ Veritabanı bağlantı hatası:', err.message);
  }
};
initDb();

// 1. API: Yeni Site Ekle
app.post('/api/tenants', async (req, res) => {
  try {
    const { name, address } = req.body;
    const result = await pool.query(
      'INSERT INTO tenants (name, address) VALUES ($1, $2) RETURNING *',
      [name, address]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. API: Tüm Siteleri Listele
app.get('/api/tenants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tenants ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. API: Site Sil (DELETE) - PostgreSQL SQL Sorgusu ile
app.delete('/api/tenants/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM tenants WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Silinecek kayıt bulunamadı.' });
    }

    res.json({ message: 'Site başarıyla silindi.', deletedTenant: result.rows[0] });
  } catch (err) {
    console.error('Silme Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} adresinde yayında!`);
});