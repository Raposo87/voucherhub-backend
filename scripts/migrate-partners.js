// scripts/migrate-partners.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
  const statements = [
    // ⚠️ ALTER TABLE para adicionar os novos campos. 
    // Execute isto antes de tudo para garantir que a sua tabela está completa.
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS location VARCHAR(255);`,
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS price_original_cents INTEGER;`,
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS voucher_validity_days INTEGER DEFAULT 20;`,
    
    // ATUALIZAÇÃO DA ESTRUTURA INICIAL (Se for um novo projeto)
    `
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(50),
      location VARCHAR(255),  
      price_original_cents INTEGER,  
      voucher_validity_days INTEGER DEFAULT 20, 
      pin VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    `,
    
    // Exemplo de atualização de dados (você deve ajustar os valores)
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('yoga-kula', 'Yoga Kula Lisboa', 'contato@yogakula.pt', '+351900000001', 'Rua da Paz, Lisboa', 5000, 20, '1234')
    ON CONFLICT (slug) DO UPDATE SET 
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = EXCLUDED.voucher_validity_days;
    `,
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('surf-wave-lisbon', 'Surf Wave Lisbon', 'info@surfwave.pt', '+351900000002', 'Praia da Cova do Vapor, Caparica', 7000, 20, '5678')
    ON CONFLICT (slug) DO UPDATE SET 
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = EXCLUDED.voucher_validity_days;
    `,
    // Adicione os outros parceiros com os novos dados...
  ];

  try {
    for (const sql of statements) {
      console.log('[migrate] running:', sql.trim().split('\n')[0] + '...');
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