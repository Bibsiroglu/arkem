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

    // 2. Daireler Tablosu
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

    // 3. Aidat & Ödemeler Tablosu (YENİ)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        apartment_id INT REFERENCES apartments(id) ON DELETE CASCADE,
        period VARCHAR(50) NOT NULL, -- Örn: "Ağustos 2026"
        amount NUMERIC(10, 2) NOT NULL, -- Örn: 750.00
        status VARCHAR(20) DEFAULT 'Ödenmedi', -- 'Ödendi' veya 'Ödenmedi'
        payment_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('⚡ Veritabanı ve "payments" tablosu hazır!');
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
    res.json({ message: 'Site silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --- DAİRELER (APARTMENTS) ROTALARI --- */

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

app.delete('/api/apartments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM apartments WHERE id = $1', [id]);
    res.json({ message: 'Daire silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --- AİDAT & ÖDEMELER (PAYMENTS) ROTALARI (YENİ) --- */

// Bir dairenin ödeme geçmişini getir
app.get('/api/apartments/:apartmentId/payments', async (req, res) => {
  const { apartmentId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM payments WHERE apartment_id = $1 ORDER BY id DESC',
      [apartmentId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daireye Aidat / Borç Tanımla
app.post('/api/apartments/:apartmentId/payments', async (req, res) => {
  const { apartmentId } = req.params;
  const { period, amount, status } = req.body;
  try {
    const paymentDate = status === 'Ödendi' ? new Date() : null;
    const result = await pool.query(
      'INSERT INTO payments (apartment_id, period, amount, status, payment_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [apartmentId, period, amount, status || 'Ödenmedi', paymentDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ödeme Durumunu Değiştir (Ödendi / Ödenmedi Yap)
app.put('/api/payments/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const current = await pool.query('SELECT status FROM payments WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Kayıt bulunamadı' });

    const newStatus = current.rows[0].status === 'Ödendi' ? 'Ödenmedi' : 'Ödendi';
    const paymentDate = newStatus === 'Ödendi' ? new Date() : null;

    const result = await pool.query(
      'UPDATE payments SET status = $1, payment_date = $2 WHERE id = $3 RETURNING *',
      [newStatus, paymentDate, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ödeme Kaydını Sil
app.delete('/api/payments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM payments WHERE id = $1', [id]);
    res.json({ message: 'Ödeme kaydı silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} adresinde yayında!`);
});