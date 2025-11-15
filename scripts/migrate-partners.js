// scripts/migrate-partners.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      phone VARCHAR(50),
      pin VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    `,
    // dados de exemplo (só insere se não existir)
    `
    INSERT INTO partners (slug, name, email, phone, pin) VALUES
      ('yoga-kula', 'Yoga Kula Lisboa', 'contato@yogakula.pt', '+351900000001', '1234'),
      ('surf-wave-lisbon', 'Surf Wave Lisbon', 'info@surfwave.pt', '+351900000002', '5678'),
      ('caparica-kite-center', 'Caparica Kite Center', 'contact@caparikite.pt', '+351900000003', '2468'),
      ('twolines', 'TwoLines Barber Shop', 'ola@twolines.pt', '+351900000004', '4321'),
      ('sintra-quad-adventures', 'Sintra Quad Adventures', 'booking@sintraquad.pt', '+351900000005', '9999'),
      ('espaco-libela', 'Espaço Libelã', 'info@libela.pt', '+351900000006', '5555')
    ON CONFLICT (slug) DO NOTHING;
    `
  ];

  try {
    for (const sql of statements) {
      console.log('[partners:migrate] running:', sql.split('\n')[1]?.trim() || sql);
      await pool.query(sql);
    }
    console.log('✅ Tabela partners criada/populada.');
  } catch (err) {
    console.error('❌ Erro na migração partners:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();
