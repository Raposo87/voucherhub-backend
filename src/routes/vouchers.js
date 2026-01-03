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
      // 🔑 MUDANÇA CRÍTICA AQUI: Use 'latest_charge' em vez de 'charges'
      { expand: ['latest_charge'] } 
  );

  if (paymentIntent.status !== 'succeeded') {
      console.warn(`⚠️ Payment Intent ${voucher.stripe_payment_intent_id} não concluído (Status: ${paymentIntent.status}). Abortando transferência.`);
      throw new Error(`Pagamento não concluído (Status: ${paymentIntent.status}).`);
  }

  // 🔑 MUDANÇA CRÍTICA AQUI: Pegar o ID diretamente da propriedade latest_charge.
  // O latest_charge é o objeto da Cobrança (ch_...)
  if (paymentIntent.latest_charge && paymentIntent.latest_charge.id) {
      sourceTransactionId = paymentIntent.latest_charge.id; 
  } else {
      // Se não houver latest_charge (o que causou o erro), abortamos.
      console.error(`❌ A intenção de pagamento ${voucher.stripe_payment_intent_id} foi bem-sucedida, mas sem ID de cobrança.`);
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

// ROTA PARA CONSULTAR DISPONIBILIDADE DE ESTOQUE
// GET /api/vouchers/availability/:slug
router.get("/availability/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
    // 1. Busca o limite do parceiro
    const partnerRes = await pool.query(
      "SELECT max_vouchers FROM partners WHERE slug = $1",
      [slug]
    );

    if (partnerRes.rowCount === 0) {
      return res.status(404).json({ error: "Parceiro não encontrado" });
    }

    const maxVouchers = partnerRes.rows[0].max_vouchers;

    // Se for NULL, é ilimitado
    if (maxVouchers === null) {
      return res.json({ infinite: true });
    }

    // 2. Conta quantos vouchers já foram vendidos (ativos ou usados)
    const countRes = await pool.query(
      "SELECT COUNT(*) as sold FROM vouchers WHERE partner_slug = $1 AND status IN ('active', 'used')",
      [slug]
    );

    const sold = parseInt(countRes.rows[0].sold);
    const available = Math.max(0, maxVouchers - sold);

    return res.json({
      infinite: false,
      max: maxVouchers,
      sold: sold,
      available: available
    });

  } catch (err) {
    console.error("Erro ao consultar disponibilidade:", err);
    res.status(500).json({ error: "Erro interno ao consultar estoque" });
  }
});

export default router;