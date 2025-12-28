// scripts/migrate.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
  const statements = [
    // --- COLUNAS EXISTENTES (Status, Uso, Expiração) ---
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL;`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;`,
    
    // --- NOVAS COLUNAS PARA RASTREAR A TRANSFERÊNCIA STRIPE ---
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS stripe_transfer_id VARCHAR(50);`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS transfer_status VARCHAR(50) DEFAULT 'pending';`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS transfer_error_msg TEXT;`,

    // --- NOVA TABELA: SEARCH ANALYTICS (BI) ---
    `CREATE TABLE IF NOT EXISTS search_analytics (
      id SERIAL PRIMARY KEY,
      search_term TEXT NOT NULL,
      results_found INTEGER NOT NULL,
      city TEXT,
      country TEXT,
      device_type TEXT,
      search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`,

    // --- ÍNDICES EXISTENTES ---
    `CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);`,
    `CREATE INDEX IF NOT EXISTS idx_vouchers_partner_status ON vouchers(partner_slug, status);`,
    
    // --- NOVO ÍNDICE PARA PESQUISAR FALHAS DE TRANSFERÊNCIA ---
    `CREATE INDEX IF NOT EXISTS idx_vouchers_transfer_status ON vouchers(transfer_status);`
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
