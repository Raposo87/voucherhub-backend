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
// Funciona como Status Check (sem PIN) ou Uso (com PIN)
// ==========================================================
router.post("/validate", async (req, res) => {
  const { code, pin } = req.body; // O PIN pode vir vazio/nulo

  // 1. Apenas o código é OBRIGATÓRIO (para Status Check ou Uso)
  if (!code) {
    return res.status(400).json({ error: "Código do voucher é obrigatório." });
  }

  // 2. Variável de Controle: Se o PIN existe, é uma tentativa de uso (portão de segurança)
  const isUsageAttempt = !!pin; 

  const client = await pool.connect(); // 🧹 Removida declaração duplicada

  try {
    await client.query("BEGIN");

    // 1. Buscar o voucher e os dados do parceiro (incluindo o PIN e o Stripe ID)
    const voucherRes = await client.query(
      `SELECT 
        v.id, v.used, v.expires_at, v.stripe_payment_intent_id, 
        v.partner_share_cents, v.partner_slug, v.product_name, p.stripe_account_id, p.pin
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
    const isExpired = new Date() > new Date(voucher.expires_at);

    // ==========================================================
    // PORTÃO DE SEGURANÇA: LÓGICA DE USO/TRANSFERÊNCIA (SÓ COM PIN)
    // ==========================================================
    if (isUsageAttempt) {

      console.log(`🔑 Tentativa de USO para: ${code}`);

      // 2. 🔑 AUTENTICAÇÃO DO PARCEIRO (PIN) - SÓ AQUI!
      if (pin !== voucher.pin) {
          await client.query("ROLLBACK");
          return res.status(403).json({ error: "PIN incorreto. Acesso negado." });
      }

      // 3. Verificar o estado do voucher (usado ou expirado) - SÓ AQUI!
      if (voucher.used) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Voucher já utilizado." });
      }

      if (isExpired) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Voucher expirado. Não pode ser utilizado." });
      }

      // 4. Realizar a Transferência Stripe (Lógica de Escrow) - SÓ AQUI!
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
                  // Se a transferência falhar, o voucher NÃO é marcado como usado
                  await client.query("ROLLBACK");
                  console.error("❌ ERRO STRIPE TRANSFERÊNCIA:", stripeError.message);
                  return res.status(500).json({ 
                      error: "Erro na transferência Stripe. O voucher não foi utilizado.",
                      details: stripeError.message 
                  });
              }
          }
      }

      // 5. Marcar o voucher como utilizado na base de dados - SÓ AQUI!
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

    } 
    // ==========================================================
    // FIM DO PORTÃO DE SEGURANÇA. A PARTIR DAQUI, É STATUS CHECK
    // ==========================================================

    // 6. STATUS CHECK RETURN (Se não for tentativa de uso, devolve apenas o status)
    if (voucher.used) {
        return res.status(200).json({ status: "used", error: "Voucher já utilizado." });
    }
    if (isExpired) {
        return res.status(200).json({ status: "expired", error: "Voucher expirado." });
    }
    
    // Se chegou aqui, o voucher é válido e pronto para uso
    return res.status(200).json({ 
        status: "valid", 
        productName: voucher.product_name,
        partnerSlug: voucher.partner_slug
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