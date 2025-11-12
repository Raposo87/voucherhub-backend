import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const useSSL = process.env.PGSSLMODE === 'require' || process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      partner_slug VARCHAR(100) NOT NULL,
      code VARCHAR(64) NOT NULL UNIQUE,
      amount_cents INTEGER,
      currency VARCHAR(10) DEFAULT 'eur',
      stripe_session_id VARCHAR(255) UNIQUE,
      status VARCHAR(20) DEFAULT 'active',
      validated_at TIMESTAMP,
      partner_pin VARCHAR(10),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);  
}
