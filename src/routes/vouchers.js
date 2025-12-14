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

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Buscar o voucher e os dados do parceiro
    // 💡 CORRIGIDO: Usando v.status, v.used_at da sua tabela
    const voucherRes = await client.query(
      `SELECT 
        v.id, v.status, v.expires_at, v.stripe_payment_intent_id, 
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
    const isExpired = new Date() > new Date(voucher.expires_at);
    // 💡 A sua coluna de status tem 'valid', 'used', etc.
    const isUsed = voucher.status === 'used'; 


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
      if (isUsed) { // 💡 USANDO A VARIÁVEL ISUSED COM BASE EM v.status
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Voucher já utilizado." });
      }

      if (isExpired) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Voucher expirado. Não pode ser utilizado." });
      }

            // 4. Realizar a Transferência Stripe (Lógica de Escrow)
const transferAmount = voucher.partner_share_cents;
const destinationAccountId = voucher.stripe_account_id;

// VALIDAR AS CONDIÇÕES MÍNIMAS PARA TRANSFERÊNCIA
if (!destinationAccountId) {
    console.warn(`⚠️ Parceiro ${voucher.partner_slug} sem Stripe Account ID. Transferência não tentada.`);
    // Marcar o voucher como usado DEPOIS de alertar (necessário repasse manual)
    await client.query("UPDATE vouchers SET status = 'used', used_at = NOW(), transfer_status = 'failed:no_stripe_account' WHERE id = $1", [voucher.id]);
    await client.query("COMMIT");
    return res.status(200).json({ 
        success: false, 
        message: "Voucher validado. ATENÇÃO: Repasse ao parceiro pendente por falta de conta Stripe. Contate o suporte.",
        code: code 
    });
}
if (transferAmount <= 0) {
    console.warn(`⚠️ Voucher ${code} com valor de repasse zero. Apenas marca como usado.`);
    // Marca como usado pois não há nada a transferir
    await client.query("UPDATE vouchers SET status = 'used', used_at = NOW(), transfer_status = 'success:zero_amount' WHERE id = $1", [voucher.id]);
    await client.query("COMMIT");
    return res.status(200).json({ 
        success: true, 
        message: "Voucher validado. Repasse zero ou gratuito.",
        code: code 
    });
}

let sourceTransactionId = null;

// 4A. BUSCAR O ID DA COBRANÇA (CH_...) E VALIDAR O PAGAMENTO
try {
    const paymentIntent = await stripe.paymentIntents.retrieve(
        voucher.stripe_payment_intent_id,
        { expand: ['charges'] } // Garante que a informação da Cobrança venha junto
    );

    if (paymentIntent.status !== 'succeeded') {
        console.warn(`⚠️ Payment Intent ${voucher.stripe_payment_intent_id} não concluído (Status: ${paymentIntent.status}). Abortando transferência.`);
        throw new Error(`Pagamento não concluído (Status: ${paymentIntent.status}).`);
    }

    if (paymentIntent.charges.data.length > 0) {
        sourceTransactionId = paymentIntent.charges.data[0].id; 
    } else {
        console.error(`❌ Payment Intent ${voucher.stripe_payment_intent_id} succeeded mas sem Charge ID.`);
        throw new Error("ID da Cobrança Stripe não encontrado. Abortando.");
    }

} catch (intentError) {
    console.error("❌ ERRO GRAVE NO FLUXO DE PAGAMENTO. TRANSFERÊNCIA ABORTADA:", intentError.message);
    await client.query("ROLLBACK");
    return res.status(500).json({ 
        success: false, 
        error: "Falha na validação do pagamento. Tente novamente ou contate o suporte.",
        details: intentError.message 
    });
}

// 4B. TENTAR A TRANSFERÊNCIA COM O ID CORRETO (CH_...)
try {
    const transfer = await stripe.transfers.create({
        amount: transferAmount,
        currency: 'eur',
        destination: destinationAccountId,
        source_transaction: sourceTransactionId,
        metadata: {
            voucher_code: code,
            partner_slug: voucher.partner_slug,
            voucher_id: voucher.id
        }
    });

    console.log(`✅ Transferência iniciada (ID ${transfer.id}) para ${voucher.partner_slug}. Status: ${transfer.status}`);

    await client.query(
        "UPDATE vouchers SET status = 'used', used_at = NOW(), transfer_status = 'success', stripe_transfer_id = $2 WHERE id = $1", 
        [voucher.id, transfer.id]
    );

    await client.query("COMMIT");
    
    return res.status(200).json({ 
        success: true,
        message: "Voucher validado e utilizado. Transferência para o parceiro processada.",
        code: code 
    });

} catch (stripeError) {
    console.warn("⚠️ ERRO NA TRANSFERÊNCIA:", stripeError.message);
    
    await client.query(
        "UPDATE vouchers SET status = 'used', used_at = NOW(), transfer_status = 'failed:stripe_error', transfer_error_msg = $2 WHERE id = $1", 
        [voucher.id, stripeError.message]
    );
    
    await client.query("COMMIT");

    return res.status(200).json({ 
        success: true, 
        message: "Voucher validado, mas o repasse ao parceiro está pendente (erro Stripe). O voucher foi marcado como utilizado.",
        code: code,
        pending_transfer: true,
        transfer_error: stripeError.message 
    });
}

    } 
    // ==========================================================
    // FIM DO PORTÃO DE SEGURANÇA. A PARTIR DAQUI, É STATUS CHECK
    // ==========================================================

    // 6. STATUS CHECK RETURN (Se não for tentativa de uso, devolve apenas o status)
    if (isUsed) { // 💡 USANDO A VARIÁVEL ISUSED
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