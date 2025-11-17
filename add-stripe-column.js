
import 'dotenv/config';
import { pool } from '../db.js'

async function run() {
  try {
    console.log("🔧 Adicionando coluna stripe_account_id...");

    await pool.query(`
      ALTER TABLE partners 
      ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
    `);

    console.log("✅ Coluna criada com sucesso!");
  } catch (err) {
    console.error("❌ ERRO:", err);
  } finally {
    await pool.end();
  }
}

run();
