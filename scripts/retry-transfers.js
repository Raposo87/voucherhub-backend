// scripts/retry-transfers.js
import 'dotenv/config.js';
import Stripe from "stripe";
import { pool } from '../src/db.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

async function retryFailedTransfers() {
  console.log('🔄 Iniciando repetição de transferências pendentes...');
  const client = await pool.connect();

  try {
    // 1. Encontrar todos os vouchers que precisam de repetição
    const pendingTransfers = await client.query(
      `SELECT 
        id, code, partner_share_cents, partner_slug, stripe_account_id
      FROM vouchers 
      WHERE status = 'transfer_pending' 
      ORDER BY used_at ASC`
    );

    if (pendingTransfers.rows.length === 0) {
      console.log('✅ Nenhuma transferência pendente encontrada. Encerrando.');
      return;
    }

    for (const voucher of pendingTransfers.rows) {
      await client.query("BEGIN");
      
      const transferAmount = voucher.partner_share_cents;
      const destinationAccountId = voucher.stripe_account_id;
      
      try {
        console.log(`➡️ Tentando transferir ${transferAmount}c para ${voucher.partner_slug} (Voucher ${voucher.code})...`);

        // 2. Tentar a transferência
        await stripe.transfers.create({
            amount: transferAmount,
            currency: 'eur',
            destination: destinationAccountId,
            metadata: {
                voucher_code: voucher.code,
                partner_slug: voucher.partner_slug,
                voucher_id: voucher.id,
                retry_attempt: new Date().toISOString()
            }
        });

        // 3. Se SUCESSO: Atualizar o status para 'used'
        await client.query(
            "UPDATE vouchers SET status = 'used' WHERE id = $1", 
            [voucher.id]
        );
        console.log(`✅ Sucesso! Voucher ${voucher.code} atualizado para 'used'.`);

        await client.query("COMMIT");

      } catch (error) {
        await client.query("ROLLBACK");
        
        // 4. Se falhar novamente por falta de fundos, apenas loga e tenta de novo no próximo ciclo
        if (error.raw?.code === 'insufficient_funds') {
            console.warn(`⚠️ Falha por saldo insuficiente para ${voucher.code}. Vai tentar de novo mais tarde.`);
        } else {
            console.error(`❌ Erro FATAL na repetição de ${voucher.code}:`, error.message);
            // Recomenda-se um mecanismo de alerta aqui para falhas graves
        }
        // Nenhuma atualização de status é feita, permanece 'transfer_pending'
      }
    }

  } catch (err) {
    console.error('❌ ERRO GERAL NO SCRIPT DE REPETIÇÃO:', err);
  } finally {
    client.release();
    console.log('🏁 Repetição de transferências concluída.');
  }
}

retryFailedTransfers();