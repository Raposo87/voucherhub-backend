// scripts/migrate-partners.js
import 'dotenv/config.js';
import { pool } from '../db.js'

async function run() {
  const partnerInserts = [
    // ETAPA 1: GARANTIR QUE AS COLUNAS EXISTEM
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS location VARCHAR(255);`,
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS price_original_cents INTEGER;`,
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS voucher_validity_days INTEGER DEFAULT 20;`, 
    `ALTER TABLE partners ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);`,

    // ETAPA 2: GARANTIR QUE A TABELA EXISTE
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
      stripe_account_id VARCHAR(255),    
      created_at TIMESTAMP DEFAULT NOW()
    );
    `,

    // ETAPA 3: INSERÇÃO E ATUALIZAÇÃO DOS DADOS DOS PARCEIROS. voucher_validity_days = 60
    
    // SLUG: surf-wave-lisbon
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('surf-wave-lisbon', 'Surf Wave Lisbon', 'surfwavelisbon@gmail.com', '+351 969 013 614 / +351 961 793 637', 'Cabana do Pescador, Costa da Caparica', 3000, 60, '1234')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 60;
    `,
    
    // SLUG: twolines
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('twolines', 'Twolines', '', '', 'Costa da Caparica', 6783, 60, '4321')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 60;
    `,

    // SLUG: nanan-adventures
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('nanan-adventures', 'Nanan Adventures', 'nananadventures@gmail.com', '+351 922 256 634', 'Praça Dom Afonso V, 2710-521  - Portela de Sintra, Portugal', 3000, 60, '9876')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 60;
    `,

    // SLUG: yoga-kula
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('yoga-kula', 'Yoga Kula', 'geral@yogakulabenfica.com', '(+351)933782610', 'Rua General Morais Sarmento, Nº60, Lisboa', 1500, 60, '5678')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 60;
    `,

    // SLUG: espaco-libela
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin) VALUES
      ('espaco-libela', 'Espaço libélula', 'nicoleraposof7@gmail.com', '+351 936 065 569', 'Rua Vieira da Silva, 54 Lisboa', 9000, 60, '1122')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 60;
    `,
  ];

  try {
    for (const sql of partnerInserts) {
      console.log('[migrate] running:', sql.trim().split('\n')[0] + '...');
      await pool.query(sql);
    }
    console.log('✅ Migração de Parceiros concluída com sucesso.');
  } catch (err) {
    console.error('❌ Erro na migração de Parceiros:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();