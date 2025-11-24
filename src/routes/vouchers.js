import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ==========================================================
// ROTA DE VALIDAÇÃO DO VOUCHER E TRANSFERÊNCIA DE FUNDOS
// POST /api/vouchers/validate
// ==========================================================
router.post("/validate", async (req, res) => {
  const { code } = req.body; // O 'code' é o que é lido pelo QR Code

  if (!code) {
    return res.status(400).json({ error: "Código do voucher é obrigatório." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Buscar o voucher, incluindo o Payment Intent ID e o stripe_account_id do parceiro
    const voucherRes = await client.query(
      `SELECT 
        v.id, v.used, v.expires_at, v.stripe_payment_intent_id, 
        v.partner_share_cents, v.partner_slug, p.stripe_account_id
      FROM vouchers v
      JOIN partners p ON v.partner_slug = p.slug
      WHERE v.code = $1
      FOR UPDATE`, // Garante que mais ninguém modifique este voucher
      [code]
    );

    if (!voucherRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Voucher não encontrado." });
    }

    const voucher = voucherRes.rows[0];

    // 2. Verificar o estado do voucher
    if (voucher.used) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Voucher já utilizado." });
    }

    if (new Date() > new Date(voucher.expires_at)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Voucher expirado." });
    }

    // 3. Realizar a Transferência Stripe (Isto é a sua transferência automática)
    const transferAmount = voucher.partner_share_cents;
    const destinationAccountId = voucher.stripe_account_id;

    if (transferAmount > 0 && destinationAccountId) {
      try {
        await stripe.transfers.create({
          amount: transferAmount,
          currency: 'eur',
          destination: destinationAccountId,
          source_transaction: voucher.stripe_payment_intent_id, // O ID da transação original (Payment Intent ID)
          metadata: {
            voucher_code: code,
            partner_slug: voucher.partner_slug,
            voucher_id: voucher.id,
          },
        });
        console.log(`✅ Transferência de €${(transferAmount / 100).toFixed(2)} para ${voucher.partner_slug} (ID: ${voucher.id}) efetuada com sucesso.`);

      } catch (stripeError) {
        // Se a transferência falhar, o voucher NÃO é marcado como usado
        await client.query("ROLLBACK");
        console.error("❌ ERRO STRIPE TRANSFERÊNCIA:", stripeError.message);
        return res.status(500).json({ 
            error: "Erro na transferência Stripe. O voucher não foi utilizado.",
            details: stripeError.message 
        });
      }
    } else if (transferAmount <= 0) {
        // Se o valor for 0 (ex: voucher de oferta), apenas prossegue para marcar como usado
        console.log(`⚠️ Voucher ID ${voucher.id} validado, mas sem valor de transferência.`);
    }


    // 4. Marcar o voucher como utilizado na base de dados
    await client.query(
      "UPDATE vouchers SET used = TRUE, used_at = NOW() WHERE id = $1",
      [voucher.id]
    );

    await client.query("COMMIT");
    
    return res.status(200).json({ 
        success: true,
        message: "Voucher validado e marcado como utilizado. Transferência para o parceiro iniciada.",
        code: code 
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERRO VALIDAÇÃO VOUCHER:", err);
    return res.status(500).json({ error: "Erro interno do servidor ao validar o voucher." });
  } finally {
    client.release();
  }
});

export default router;