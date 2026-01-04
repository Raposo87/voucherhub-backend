// scripts/migrate.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
  const statements = [
    // --- 1. COLUNAS EXISTENTES ---
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL;`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;`,
    
    // --- 2. NOVAS COLUNAS PARA TRANSFERÊNCIA STRIPE ---
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS stripe_transfer_id VARCHAR(50);`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS transfer_status VARCHAR(50) DEFAULT 'pending';`,
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS transfer_error_msg TEXT;`,

    // --- 3. SUPORTE A ESTOQUE (NOVO) ---
    // Adicionamos o título da oferta no voucher para saber o que foi comprado
    `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS offer_title VARCHAR(255);`,

    // Criamos a tabela de inventário
    `CREATE TABLE IF NOT EXISTS offer_inventory (
      id SERIAL PRIMARY KEY,
      partner_slug VARCHAR(100) NOT NULL,
      offer_title VARCHAR(255) NOT NULL,
      stock_limit INTEGER DEFAULT NULL, 
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(partner_slug, offer_title)
    );`,

    // --- 4. ANALYTICS ---
    `CREATE TABLE IF NOT EXISTS search_analytics (
      id SERIAL PRIMARY KEY,
      search_term TEXT NOT NULL,
      results_found INTEGER NOT NULL,
      city TEXT,
      country TEXT,
      device_type TEXT,
      search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,

    // --- 5. ÍNDICES ---
    `CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);`,
    `CREATE INDEX IF NOT EXISTS idx_vouchers_partner_status ON vouchers(partner_slug, status);`,
    `CREATE INDEX IF NOT EXISTS idx_vouchers_transfer_status ON vouchers(transfer_status);`,
    `CREATE INDEX IF NOT EXISTS idx_inventory_partner ON offer_inventory(partner_slug);`
  ];

  try {
    for (const sql of statements) {
      console.log('[migrate] running:', sql);
      await pool.query(sql);
    }
    console.log('✅ Migração de estoque e tabelas concluída.');
  } catch (err) {
    console.error('❌ Erro na migração:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();