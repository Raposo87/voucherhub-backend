// scripts/migrate-sponsor-vouchers.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS sponsor_vouchers (
      id SERIAL PRIMARY KEY,
      code VARCHAR(30) UNIQUE NOT NULL,
      sponsor VARCHAR(50) NOT NULL,
      discount_extra INTEGER NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      used_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NULL
    );
    `,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_vouchers_code ON sponsor_vouchers (code);`,
    `CREATE INDEX IF NOT EXISTS idx_sponsor_vouchers_sponsor_used ON sponsor_vouchers (sponsor, used);`
  ];

  try {
    for (const sql of statements) {
      console.log('[migrate-sponsor] running:', sql.trim().split('\n')[0] + '...');
      await pool.query(sql);
    }
    console.log('✅ Migração de sponsor_vouchers concluída com sucesso.');
  } catch (err) {
    console.error('❌ Erro na migração de sponsor_vouchers:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();
