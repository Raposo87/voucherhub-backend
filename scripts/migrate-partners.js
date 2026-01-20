// scripts/migrate-partners.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

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
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
      ('surf-wave-lisbon', 'Surf Wave Lisbon', 'surfwavelisbon@gmail.com', '+351 969 013 614 / +351 961 793 637', 'Cabana do Pescador, Costa da Caparica', 3000, 120, '5678', 'acct_1SZI1ULEy1X3DVbg')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 120,
        stripe_account_id = EXCLUDED.stripe_account_id;
    `,

    // SLUG: twolines
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
      ('twolines', 'Twolines', '', '', 'Costa da Caparica', 6783, 120, '4321', 'acct_1SZJJgL4DtZvafHC')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 120,
        stripe_account_id = EXCLUDED.stripe_account_id;
    `,

    // SLUG: nanan-adventures
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
      ('nanan-adventures', 'Nanan Adventures', 'nananadventures@gmail.com', '+351 922 256 634', 'Praça Dom Afonso V, 2710-521  - Portela de Sintra, Portugal', 3000, 120, '9876', 'acct_1SZHJLLoU1hNtDZa')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 120,
        stripe_account_id = EXCLUDED.stripe_account_id;
    `,

    // SLUG: yoga-kula
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
      ('yoga-kula', 'Yoga Kula', 'geral@yogakulabenfica.com', '(+351)933782610', 'Rua General Morais Sarmento, Nº60, Lisboa', 1500, 120, '1234', 'acct_1SXVcrLNA7rb0Hw5')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 120,
        stripe_account_id = EXCLUDED.stripe_account_id;
    `,

    // SLUG: espaco-libela
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
      ('espaco-libela', 'Espaço libélula', 'nicoleraposof7@gmail.com', '+351 936 065 569', 'Rua Vieira da Silva, 54 Lisboa', 9000, 120, '5555', 'acct_1SZHN8Lh9REGl42S')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 120,
        stripe_account_id = EXCLUDED.stripe_account_id;
    `,

    // SLUG: loopitour //
    `
    INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
      ('loopitour', 'Loopitour', 'loopitour@gmail.com', '+351 925 987 650', 'Rua Heliodoro Salgado, 1170-174 Lisboa Ímpares de 1 a 47A', 9500, 120, '5566', 'acct_1SZzyqLDZjWc3hZz')
    ON CONFLICT (slug) DO UPDATE SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location, 
        price_original_cents = EXCLUDED.price_original_cents,
        voucher_validity_days = 120,
        stripe_account_id = EXCLUDED.stripe_account_id;
    `,

    // SLUG: azonda-surf-club
    `
INSERT INTO partners (slug, name, email, phone, location, price_original_cents, voucher_validity_days, pin, stripe_account_id) VALUES
  ('azonda-surf-club', 'Azonda Surf Club', 'ian.fcosta@icloud.com', '+351 913 545 440', 'Classico By Olivier', 4000, 60, '2244', 'acct_1ScCLRL0iebOL7yv')
ON CONFLICT (slug) DO UPDATE SET 
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    location = EXCLUDED.location, 
    price_original_cents = EXCLUDED.price_original_cents,
    voucher_validity_days = 120,
    stripe_account_id = EXCLUDED.stripe_account_id;
`,

    // SLUG: ecoasters
    `
INSERT INTO partners (
    slug, 
    name, 
    email, 
    phone, 
    location, 
    price_original_cents, 
    voucher_validity_days, 
    pin, 
    stripe_account_id
) VALUES (
    'ecoasters', 
    'eCoasters', 
    'ecoasters24@mailg.com', 
    '+351 969 638 466', 
    'Costa da Caparica', 
    10000,
    120,
    3333,
    'acct_1SdfEFLfCpwo7PiJ'
)
ON CONFLICT (slug) DO UPDATE SET 
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    location = EXCLUDED.location, 
    price_original_cents = EXCLUDED.price_original_cents,
    voucher_validity_days = 120;
`,

    // SLUG: giravela-eco-sailing
    `
INSERT INTO partners (
    slug, 
    name, 
    email, 
    phone, 
    location, 
    price_original_cents, 
    voucher_validity_days, 
    pin, 
    stripe_account_id
) VALUES (
    'giravela-eco-sailing', 
    'Gira Vela Eco Sailing', 
    'contacto@giravelaecosailing.com', 
    '+351 911 871 640', 
    'Doca da Marinha - Av. Infante Dom Henrique, S/N - Baixa - Lisboa, Lisbon, Portugal', 
    34999,
    120,
    3331,
    ''
)
ON CONFLICT (slug) DO UPDATE SET 
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    location = EXCLUDED.location, 
    price_original_cents = EXCLUDED.price_original_cents,
    voucher_validity_days = 120;
`

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