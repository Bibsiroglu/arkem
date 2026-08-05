require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Veritabanı Tablolarını Başlat
const initDb = async () => {
  try {
    // 1. Siteler Tablosu
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Daireler/Sakinler Tablosu (Foreign Key İle Bağlı)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apartments (
        id SERIAL PRIMARY KEY,
        tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
        apartment_number VARCHAR(50) NOT NULL,
        resident_name VARCHAR(255),
        phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('⚡ Veritabanı ve ilişkili "apartments" tablosu hazır!');
  } catch (err) {
    console.error('❌ Veritabanı hatası:', err.message);
  }
};
initDb();

/* --- SİTE (TENANTS) ROTALARI --- */

app.get('/api/tenants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tenants ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.put('/api/tenants/:id', async (req, res) => {
  const { id } = req.params;
  const { name, address } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tenants SET name = $1, address = $2 WHERE id = $3 RETURNING *',
      [name, address, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
    res.json({ message: 'Site ve bağlı tüm daireler silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --- DAİRELER / SAKİNLER (APARTMENTS) ROTALARI --- */

// Belirli Bir Sitenin Dairelerini Getir
app.get('/api/tenants/:tenantId/apartments', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM apartments WHERE tenant_id = $1 ORDER BY id ASC',
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Siteye Yeni Daire/Sakin Ekle
app.post('/api/tenants/:tenantId/apartments', async (req, res) => {
  const { tenantId } = req.params;
  const { apartment_number, resident_name, phone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO apartments (tenant_id, apartment_number, resident_name, phone) VALUES ($1, $2, $3, $4) RETURNING *',
      [tenantId, apartment_number, resident_name, phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daire Sil
app.delete('/api/apartments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM apartments WHERE id = $1', [id]);
    res.json({ message: 'Daire başarıyla silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} adresinde yayında!`);
});