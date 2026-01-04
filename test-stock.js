import 'dotenv/config.js';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupTest() {
  try {
    const query = `
      INSERT INTO offer_inventory (partner_slug, offer_title, stock_limit) 
      VALUES ('surf-wave-lisbon', 'Aulas de Surf', 0)
      ON CONFLICT (partner_slug, offer_title) DO UPDATE SET stock_limit = 0;
    `;
    await pool.query(query);
    console.log("✅ Estoque de teste configurado: Limite de 0 para 'Aulas de Surf'");
  } catch (err) {
    console.error("❌ Erro ao configurar:", err);
  } finally {
    process.exit();
  }
}

setupTest();