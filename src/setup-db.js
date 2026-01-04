import { pool } from "./db.js";

async function setup() {
  try {
    console.log("🚀 Iniciando configuração do banco...");

    // 1. Criar a tabela
    await pool.query(`
      CREATE TABLE IF NOT EXISTS offer_inventory (
        id SERIAL PRIMARY KEY,
        partner_slug VARCHAR(100) NOT NULL,
        offer_title VARCHAR(255) NOT NULL,
        stock_limit INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(partner_slug, offer_title)
      );
    `);
    console.log("✅ Tabela offer_inventory verificada/criada.");

    // 2. Inserir o limite ZERO para teste
    await pool.query(`
      INSERT INTO offer_inventory (partner_slug, offer_title, stock_limit) 
      VALUES ('surf-wave-lisbon', 'Aulas de Surf', 0)
      ON CONFLICT (partner_slug, offer_title) 
      DO UPDATE SET stock_limit = 0;
    `);
    console.log("✅ Limite ZERO aplicado para 'Aulas de Surf'.");

    process.exit(0);
  } catch (err) {
    console.error("❌ Erro ao configurar banco:", err);
    process.exit(1);
  }
}

setup();