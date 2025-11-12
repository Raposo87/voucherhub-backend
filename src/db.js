import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const useSSL = process.env.PGSSLMODE === 'require' || process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

export async function initDb() {
  // Cria a tabela se não existir
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      partner_slug VARCHAR(100) NOT NULL,
      code VARCHAR(64) NOT NULL UNIQUE,
      amount_cents INTEGER,
      currency VARCHAR(10) DEFAULT 'eur',
      stripe_session_id VARCHAR(255) UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      used_at TIMESTAMP NULL,
      expires_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Garante colunas novas em bases já existentes
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL;`);
  await pool.query(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;`);

  // Índices úteis
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vouchers_partner_status ON vouchers(partner_slug, status);`);
}
