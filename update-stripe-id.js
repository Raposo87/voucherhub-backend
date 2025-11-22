//QUER ATUALIZAR OUTROS PARCEIROS?

//É só repetir:

//trocar o slug

//trocar o stripe_account_id

//rodar node update-stripe-id.js novamente

import 'dotenv/config';
import { pool } from './src/db.js';

async function run() {
  try {
    const slug = 'surf-wave-lisbon'; // <-- ALTERE AQUI PARA O SLUG CORRETO
    const stripeId = 'acct_1SW2EfLtgtiOYNfV'; // <-- SEU STRIPE CONNECT ACCOUNT ID

    const result = await pool.query(
      `UPDATE partners SET stripe_account_id = $1 WHERE slug = $2`,
      [stripeId, slug]
    );

    console.log(`Atualizado! Linhas afetadas: ${result.rowCount}`);
  } catch (err) {
    console.error("Erro ao atualizar:", err);
  } finally {
    await pool.end();
  }
}

run();
