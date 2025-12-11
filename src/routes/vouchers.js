// src/routes/vouchers.js (VERSÃO FINAL E CORRIGIDA)
import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ==========================================================
// ROTA DE VALIDAÇÃO DO VOUCHER E TRANSFERÊNCIA DE FUNDOS
// ==========================================================
router.post("/validate", async (req, res) => {
  const { code, pin } = req.body; 

  if (!code) {
    return res.status(400).json({ error: "Código do voucher é obrigatório." });
  }

  const isUsageAttempt = !!pin; 

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Buscar o voucher e os dados do parceiro (usando FOR UPDATE para bloquear o registo)
    const voucherRes = await client.query(
      `SELECT 
        v.id, v.status, v.expires_at, v.partner_share_cents, 
        v.partner_slug, p.stripe_account_id, p.pin,
        v.stripe_payment_intent_id  /* 🚨 CORRIGIDO: Vírgula adicionada */
      FROM vouchers v
      JOIN partners p ON v.partner_slug = p.slug
      WHERE v.code = $1
      FOR UPDATE`, 
      [code]
    );

    if (!voucherRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Voucher não encontrado." });
    }

    const voucher = voucherRes.rows[0];
    const isExpired = new Date() > new Date(voucher.expires_at);

    // 🚨 CORREÇÃO DE SEGURANÇA: Considerar 'used' e 'transfer_pending' como estados consumidos
    const isConsumed = voucher.status === 'used' || voucher.status === 'transfer_pending';


    // ==========================================================
    // PORTÃO DE SEGURANÇA: LÓGICA DE USO/TRANSFERÊNCIA (SÓ COM PIN)
    // ==========================================================
    if (isUsageAttempt) {

      console.log(`🔑 Tentativa de USO para: ${code}`);

      // 2. 🔑 AUTENTICAÇÃO DO PARCEIRO (PIN)
      if (pin !== voucher.pin) {
          await client.query("ROLLBACK");
          return res.status(403).json({ error: "PIN incorreto. Acesso negado." });
      }

      // 3. Verificar o estado do voucher (usado ou expirado)
      if (isConsumed) { 
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Voucher já utilizado ou em processamento de transferência." });
      }

      if (isExpired) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Voucher expirado. Não pode ser utilizado." });
      }

      // 4. Realizar a Transferência Stripe (Lógica de Escrow)
      const transferAmount = voucher.partner_share_cents;
      const destinationAccountId = voucher.stripe_account_id;
      const sourcePaymentIntentId = voucher.stripe_payment_intent_id; // ID do Pagamento Original


      try {
          // Checagem final do ID do parceiro
          if (!destinationAccountId) { 
              throw new Error(`Partner ${voucher.partner_slug} is not configured for Stripe transfer.`);
          }
          if (transferAmount <= 0) {
              throw new Error("Transfer amount is zero or less.");
          }
          if (!sourcePaymentIntentId) {
             console.warn(`⚠️ Payment Intent ID em falta para ${code}. A transferência será feita, mas não será ligada visualmente na Stripe.`);
          }
          
          await stripe.transfers.create({
              amount: transferAmount,
              currency: 'eur',
              destination: destinationAccountId,
              // 🚨 CORREÇÃO PARA LIGAR AO PAGAMENTO ORIGINAL NA VISUALIZAÇÃO DA STRIPE
              source_transaction: sourcePaymentIntentId, 
              metadata: {
                  voucher_code: code,
                  partner_slug: voucher.partner_slug,
                  voucher_id: voucher.id
              }
          });

          console.log(`✅ Transferência direta concluída para ${voucher.partner_slug}.`);

          // Se a transferência foi BEM-SUCEDIDA:
          await client.query(
              "UPDATE vouchers SET status = 'used', used_at = NOW() WHERE id = $1", 
              [voucher.id]
          );
          await client.query("COMMIT");

          return res.status(200).json({ 
              success: true,
              message: "Voucher validado e utilizado. Transferência para o parceiro processada.",
              code: code 
          });
          
      } catch (stripeError) {
          
          // ⚠️ TRATAMENTO DE ERRO DE SALDO (Insufficient Funds)
          if (stripeError.raw?.code === 'insufficient_funds') {
              
              console.warn(`⚠️ Transferência ADIADA para ${code}. Saldo Stripe insuficiente. Status: transfer_pending.`);

              // Marcar o voucher como AGUARDANDO REPETIÇÃO
              await client.query(`
                  UPDATE vouchers 
                  SET status = 'transfer_pending', 
                      used_at = NOW()
                  WHERE id = $1
              `, [voucher.id]);

              await client.query("COMMIT");

              // Retorno AMIGÁVEL: O voucher é válido, mas o repasse será feito mais tarde
              return res.status(200).json({
                  success: true,
                  status: "transfer_pending",
                  message: "Voucher validado. A transferência será processada automaticamente pela nossa plataforma assim que os fundos estiverem disponíveis (até 5 dias úteis).",
                  code
              });

          } else {
              // Qualquer outro erro Stripe (fatal)
              await client.query("ROLLBACK");
              console.error("❌ ERRO FATAL NA TRANSFERÊNCIA STRIPE:", stripeError.message);
              return res.status(500).json({ error: "Erro ao processar a transferência Stripe. Verifique os logs." });
          }
      }

    } 
    // ==========================================================
    // FIM DO PORTÃO DE SEGURANÇA. A PARTIR DAQUI, É STATUS CHECK (SEM PIN)
    // ==========================================================

    // 5. STATUS CHECK RETURN
    // Responde ao cliente/parceiro se o voucher está ATIVO, USADO ou EXPIRADO
    if (isConsumed) { 
        // Retorna "used" para o frontend, mesmo que o status seja 'transfer_pending' no DB
        return res.status(200).json({ status: "used", error: "Voucher já utilizado ou em processamento." });
    }
    if (isExpired) {
        return res.status(200).json({ status: "expired", error: "Voucher expirado." });
    }
    
    // Se chegou aqui, o voucher está ATIVO (status: 'active' no DB)
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