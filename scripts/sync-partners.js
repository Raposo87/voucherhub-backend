import fs from 'fs';
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function syncPartners() {
  try {
    // 1. Lendo o arquivo JSON
    const rawData = fs.readFileSync('./experiences.json', 'utf8');
    const data = JSON.parse(rawData);

    console.log("🚀 Iniciando sincronização de parceiros...");

    // 2. Extraindo todos os parceiros de todas as categorias (modes)
    const allPartners = data.modes.flatMap(mode => mode.partners);

    for (const partner of allPartners) {
      // Tratando o preço: Remove o símbolo "€" e converte para centavos (inteiro)
      // Ex: "€30" -> 3000
      const priceCents = partner.price_original 
        ? parseInt(partner.price_original.replace('€', '').replace(',', '.')) * 100 
        : 0;

      const query = {
        text: `
          INSERT INTO partners (
            slug, name, email, phone, location, price_original_cents, pin, voucher_validity_days
          ) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (slug) 
          DO UPDATE SET 
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            location = EXCLUDED.location,
            price_original_cents = EXCLUDED.price_original_cents
          RETURNING slug;
        `,
        values: [
          partner.slug,
          partner.name,
          partner.email || null,
          partner.phone || null,
          partner.location || null,
          priceCents,
          partner.pin || '1234', // PIN padrão se não houver no JSON
          60 // validade padrão
        ],
      };

      const res = await pool.query(query);
      console.log(`✅ Parceiro sincronizado: ${res.rows[0].slug}`);
    }

    console.log("✨ Sincronização concluída com sucesso!");
  } catch (err) {
    console.error("❌ Erro na sincronização:", err);
  } finally {
    await pool.end();
  }
}

syncPartners();