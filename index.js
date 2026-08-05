require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Veritabanı Bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') 
    ? false 
    : { rejectUnauthorized: false }
});

// Veritabanı Tablolarını ve İndeksleri Başlat
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

    // 3. Aidat & Ödemeler Tablosu
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        apartment_id INT REFERENCES apartments(id) ON DELETE CASCADE,
        period VARCHAR(50) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'Ödenmedi',
        payment_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Performans için İndeksler
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_apartments_tenant ON apartments(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_payments_apartment ON payments(apartment_id);
    `);

    console.log('⚡ Veritabanı, tablolar ve indeksler hazır!');
  } catch (err) {
    console.error('❌ Veritabanı başlatma hatası:', err.message);
  }
};
initDb();

/* --- DASHBOARD / İSTATİSTİK (TEK SORGU OPTİMİZASYONU) --- */

app.get('/api/stats', async (req, res) => {
  try {
    // 4 farklı sorgu yerine tek bir SQL ile tüm istatistikleri çekiyoruz
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM tenants) AS total_tenants,
        (SELECT COUNT(*) FROM apartments) AS total_apartments,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'Ödendi') AS total_collected,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'Ödenmedi') AS total_pending
    `;
    const result = await pool.query(statsQuery);
    const row = result.rows[0];

    res.json({
      totalTenants: parseInt(row.total_tenants, 10),
      totalApartments: parseInt(row.total_apartments, 10),
      totalCollected: parseFloat(row.total_collected),
      totalPending: parseFloat(row.total_pending)
    });
  } catch (err) {
    console.error('Stats Hatası:', err);
    res.status(500).json({ error: 'İstatistikler alınırken bir hata oluştu.' });
  }
});

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
    if (!name) return res.status(400).json({ error: 'Site adı zorunludur.' });

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
    if (result.rows.length === 0) return res.status(404).json({ error: 'Site bulunamadı.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM tenants WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Site bulunamadı.' });
    res.json({ message: 'Site ve bağlı tüm veriler silindi.' });
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

  if (!apartment_number) return res.status(400).json({ error: 'Daire numarası zorunludur.' });

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

// Daire Bilgilerini Güncelleme (Yeni Eklendi)
app.put('/api/apartments/:id', async (req, res) => {
  const { id } = req.params;
  const { apartment_number, resident_name, phone } = req.body;
  try {
    const result = await pool.query(
      'UPDATE apartments SET apartment_number = $1, resident_name = $2, phone = $3 WHERE id = $4 RETURNING *',
      [apartment_number, resident_name, phone, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Daire bulunamadı.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/apartments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM apartments WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Daire bulunamadı.' });
    res.json({ message: 'Daire ve aidat geçmişi silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --- AİDAT & ÖDEMELER (PAYMENTS) ROTALARI --- */

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

app.post('/api/apartments/:apartmentId/payments', async (req, res) => {
  const { apartmentId } = req.params;
  const { period, amount, status } = req.body;

  if (!period || !amount) {
    return res.status(400).json({ error: 'Dönem ve Tutar alanları zorunludur.' });
  }

  try {
    const paymentStatus = status || 'Ödenmedi';
    const paymentDate = paymentStatus === 'Ödendi' ? new Date() : null;

    const result = await pool.query(
      'INSERT INTO payments (apartment_id, period, amount, status, payment_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [apartmentId, period, amount, paymentStatus, paymentDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/payments/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const current = await pool.query('SELECT status FROM payments WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Ödeme kaydı bulunamadı' });

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

app.delete('/api/payments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM payments WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ödeme kaydı bulunamadı.' });
    res.json({ message: 'Ödeme kaydı silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Port Dinleme
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu http://localhost:${PORT} adresinde aktif!`);
});