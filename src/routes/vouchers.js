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
// Recebe: { code: 'VH-XXXXX', pin: '1234' }
// ==========================================================
router.post("/validate", async (req, res) => {
  const { code, pin } = req.body; // 🔑 AGORA RECEBE O PIN

  if (!code || !pin) { // Verifica a obrigatoriedade
    return res.status(400).json({ error: "Código do voucher e PIN são obrigatórios." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Buscar o voucher e os dados do parceiro (incluindo o PIN e o Stripe ID)
    const voucherRes = await client.query(
      `SELECT 
        v.id, v.used, v.expires_at, v.stripe_payment_intent_id, 
        v.partner_share_cents, v.partner_slug, p.stripe_account_id, p.pin
      FROM vouchers v
      JOIN partners p ON v.partner_slug = p.slug
      WHERE v.code = $1
      FOR UPDATE`, // Garante exclusividade de acesso
      [code]
    );

    if (!voucherRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Voucher não encontrado." });
    }

    const voucher = voucherRes.rows[0];

    // 2. 🔑 AUTENTICAÇÃO DO PARCEIRO (PIN)
    if (pin !== voucher.pin) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "PIN incorreto. Acesso negado." });
    }


    // 3. Verificar o estado do voucher (usado ou expirado)
    if (voucher.used) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Voucher já utilizado." });
    }

    if (new Date() > new Date(voucher.expires_at)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Voucher expirado." });
    }

    // 4. Realizar a Transferência Stripe (Lógica de Escrow)
    const transferAmount = voucher.partner_share_cents;
    const destinationAccountId = voucher.stripe_account_id;

    if (transferAmount > 0) {
        if (!destinationAccountId) {
            // Se não houver Stripe ID, o voucher é marcado como usado, mas a transferência fica pendente
            console.warn(`⚠️ Parceiro ${voucher.partner_slug} sem Stripe ID. Transferência adiada.`);
            // Neste caso, prosseguimos para marcar como usado, pois o serviço foi prestado.
        } else {
            // Executa a transferência se houver valor e destino
            try {
                await stripe.transfers.create({
                    amount: transferAmount,
                    currency: 'eur',
                    destination: destinationAccountId,
                    source_transaction: voucher.stripe_payment_intent_id,
                    metadata: {
                        voucher_code: code,
                        partner_slug: voucher.partner_slug,
                        voucher_id: voucher.id,
                    },
                });
                console.log(`✅ Transferência de €${(transferAmount / 100).toFixed(2)} para ${voucher.partner_slug} (ID: ${voucher.id}) efetuada com sucesso.`);

            } catch (stripeError) {
                // Se a transferência falhar (ex: conta Stripe inativa), 
                // o voucher NÃO é marcado como usado e a transação é revertida
                await client.query("ROLLBACK");
                console.error("❌ ERRO STRIPE TRANSFERÊNCIA:", stripeError.message);
                return res.status(500).json({ 
                    error: "Erro na transferência Stripe. O voucher não foi utilizado.",
                    details: stripeError.message 
                });
            }
        }
    }


    // 5. Marcar o voucher como utilizado na base de dados
    await client.query(
      "UPDATE vouchers SET used = TRUE, used_at = NOW() WHERE id = $1",
      [voucher.id]
    );

    await client.query("COMMIT");
    
    return res.status(200).json({ 
        success: true,
        message: "Voucher validado e utilizado. Transferência para o parceiro processada.",
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