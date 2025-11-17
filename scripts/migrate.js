// scripts/migrate.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
  const statements = [
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL;`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);`,
    `CREATE INDEX IF NOT EXISTS idx_vouchers_partner_status ON vouchers(partner_slug, status);`
  ];

  try {
    for (const sql of statements) {
      console.log('[migrate] running:', sql);
      await pool.query(sql);
    }
    console.log('✅ Migração concluída com sucesso.');
  } catch (err) {
    console.error('❌ Erro na migração:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();
