import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db.js";
// ❌ CORREÇÃO DA IMPORTAÇÃO (Ajustado para caminho relativo, ex: ../utils/sendEmail.js)
import { sendEmail } from "../utils/sendEmail.js"; 
import { randomBytes } from "crypto";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function generateVoucherCode() {
  return "VH-" + randomBytes(4).toString("hex").toUpperCase();
}

// Normalização do sponsorCode
function normalize(code) {
  return (code || "").trim().toUpperCase();
}

// ==========================================================
// 1) CREATE CHECKOUT SESSION (com suporte a sponsorCode)
//    (Lógica já estava 99% correta, apenas confirmada)
// ==========================================================
router.post("/create-checkout-session", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      email,
      partnerSlug,
      productName,
      amountCents,
      originalPriceCents,
      currency = "eur",
      sponsorCode: rawSponsorCode,
    } = req.body;

    if (!email || !partnerSlug || !productName || !amountCents) {
      return res.status(400).json({
        error: "Missing fields: email, partnerSlug, productName, amountCents",
      });
    }

    const sponsorCode = normalize(rawSponsorCode);
    let extraDiscount = 0;
    let sponsorName = null;
    let baseAmountCents = Number(amountCents); // O preço com desconto normal do parceiro.

    await client.query("BEGIN");

    // -----------------------------------------------
    // 1. Buscar parceiro (INALTERADO)
    // -----------------------------------------------
    const partnerRes = await client.query(
      "SELECT stripe_account_id FROM partners WHERE slug=$1",
      [partnerSlug]
    );

    if (!partnerRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Parceiro não encontrado." });
    }

    const partner = partnerRes.rows[0];

    if (!partner.stripe_account_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Parceiro não tem stripe_account_id configurado — configure no banco.",
      });
    }

    // ------------------------------------------------
    // 2. Validar sponsorCode (INALTERADO - a lógica de validação já estava perfeita)
    // ------------------------------------------------
    if (sponsorCode) {
      const { rows } = await client.query(
        "SELECT * FROM sponsor_vouchers WHERE code = $1",
        [sponsorCode]
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Código especial inválido." });
      }

      const voucher = rows[0];

      if (voucher.used) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Este código especial já foi utilizado." });
      }

      if (!voucher.discount_extra || voucher.discount_extra <= 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Código especial não possui desconto ativo." });
      }

      extraDiscount = voucher.discount_extra;
      sponsorName = voucher.sponsor;
    }

    // ------------------------------------------------
    // 3. Cálculo financeiro (REFINADO para garantir baseAmountCents e totalCents corretos)
    // ------------------------------------------------
    const totalCents = Number(amountCents); // Este é o valor que o cliente PAGARÁ (com desconto extra se houver)
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "amountCents inválido." });
    }
    
    // O baseAmountCents é o valor após o desconto PADRÃO do parceiro, mas antes do desconto EXTRA
    // Se não há desconto extra, o valor base é o total que o cliente paga.
    
    let amountToChargeCents = totalCents; // Valor final que vai para o Stripe
    const platformPctOriginal = 0.18; // 18%

    let applicationFeeCents;

    if (extraDiscount > 0) {
      // Valor antes do desconto EXTRA: baseAmountCents (que veio do frontend)
      
      // Cálculo do NOVO valor a ser pago (totalCents já está correto vindo do frontend com o desconto extra)
      const multiplier = 1 - extraDiscount / 100;
      // Recalcular o valor antes do desconto extra (para uso futuro no webhook)
      baseAmountCents = Math.round(totalCents / multiplier);
      
      // TAXA DA PLATAFORMA: Margem Original (18%) - Desconto Extra (5%) = 13%
      const platformPctFinal = platformPctOriginal - extraDiscount / 100; // 0.18 - 0.05 = 0.13
      
      // A taxa é aplicada SOBRE o valor BASE (antes do desconto extra),
      // pois queremos que o parceiro receba o valor cheio (totalCents - (baseAmountCents * 0.18))
      // e o patrocinador cubra a diferença de 5%
      applicationFeeCents = Math.round(baseAmountCents * platformPctFinal);
      
    } else {
      // Cliente normal: Taxa de 18% sobre o valor pago
      applicationFeeCents = Math.round(totalCents * platformPctOriginal);
      baseAmountCents = totalCents; // baseAmountCents é igual ao valor pago
    }
    
    // Garantir que a taxa não seja negativa ou zero
    applicationFeeCents = Math.max(1, applicationFeeCents); // Stripe exige um valor mínimo

    // ------------------------------------------------
    // 4. Criar sessão Stripe (INALTERADO)
    // ------------------------------------------------
    const successUrl = `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.FRONTEND_URL}/cancel.html`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: productName },
            unit_amount: amountToChargeCents, // Valor final que o cliente paga
          },
          quantity: 1,
        },
      ],

      success_url: successUrl,
      cancel_url: cancelUrl,

      metadata: {
        email,
        partnerSlug,
        productName,
        originalPriceCents,
        sponsorCode: sponsorCode || "", // Garante que seja string vazia se nulo
        extraDiscount,
        sponsorName: sponsorName || "",
        baseAmountCents, // Valor antes do desconto EXTRA, mas depois do desconto PADRÃO
        platformPctOriginal: platformPctOriginal * 100, // 18 para cálculo
      },

      payment_intent_data: {
        application_fee_amount: applicationFeeCents,
        transfer_data: {
          destination: partner.stripe_account_id,
        },
      },
    });

    await client.query("COMMIT");
    return res.json({ url: session.url });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERRO CREATE-SESSION:", err);
    return res.status(500).json({ error: "Erro ao criar checkout session" });
  } finally {
    client.release();
  }
});

// ==========================================================
// 2) STRIPE WEBHOOK — emitir voucher + marcar sponsorCode como usado
//    (Ajuste de cálculo e E-mail Customizado)
// ==========================================================
router.post("/webhook", async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err);
    return res.status(400).send("Webhook signature failed");
  }

  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  const session = event.data.object;

  try {
    const email =
      session.customer_details?.email || session.metadata?.email || "no-email";
    const partnerSlug = session.metadata?.partnerSlug;
    const productName = session.metadata?.productName;
    const sponsorCode = normalize(session.metadata?.sponsorCode);
    const extraDiscount = Number(session.metadata?.extraDiscount || 0);
    const sponsorName = session.metadata?.sponsorName || "";
    const originalPriceCents = Number(session.metadata?.originalPriceCents || 0);

    const amountCents = session.amount_total; // Valor pago pelo cliente
    const currency = session.currency || "eur";
    const baseAmountCents = Number(session.metadata?.baseAmountCents || amountCents); // Valor ANTES do desconto EXTRA

    // Cálculos financeiros (Garantindo que a plataforma absorva o desconto extra)
    const platformPctOriginal = 0.18;
    let platformFeeCents;
    let partnerShareCents;

    if (extraDiscount > 0) {
      // Cliente especial: comissão da plataforma = 18% - Desconto Extra
      const platformPctFinal = platformPctOriginal - extraDiscount / 100; // Ex: 0.13
      
      // A taxa é aplicada sobre o valor BASE (antes do desconto extra)
      platformFeeCents = Math.round(baseAmountCents * platformPctFinal);
      
      // O parceiro recebe o valor pago pelo cliente MENOS a nova comissão da plataforma
      partnerShareCents = amountCents - platformFeeCents; 
      
      // === VALIDAÇÃO DE SEGURANÇA ANTIFRAUDE ===
      // Comparar a Application Fee que o Stripe calculou com a que o backend calculou
      const stripeFee = session.total_details.amount_application_fee;
      if (Math.abs(stripeFee - platformFeeCents) > 2) { // 2 centavos de margem de erro
         // Isso nunca deve acontecer se o create-session rodar corretamente
         console.warn(`[WEBHOOK] Alerta: Divergência na Application Fee! Stripe: ${stripeFee}, Calculado: ${platformFeeCents}`);
      }

    } else {
      // Cliente normal: comissão de 18% sobre o valor pago
      platformFeeCents = Math.round(amountCents * platformPctOriginal);
      partnerShareCents = amountCents - platformFeeCents;
    }

    // Criar voucher (INALTERADO)
    const code = generateVoucherCode();

    // Validade (INALTERADO)
    const partnerRes = await pool.query(
      "SELECT voucher_validity_days, name, discount_percent FROM partners WHERE slug = $1",
      [partnerSlug]
    );
    const partner = partnerRes.rows[0] || {};
    const daysValidity = partner.voucher_validity_days || 60;
    const partnerDiscount = partner.discount_percent || 15;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysValidity);

    await pool.query(
      `INSERT INTO vouchers (
        email, partner_slug, code, amount_cents, currency, 
        stripe_session_id, expires_at, platform_fee_cents, partner_share_cents
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        email,
        partnerSlug,
        code,
        amountCents,
        currency,
        session.id,
        expiryDate.toISOString(),
        platformFeeCents,
        partnerShareCents,
      ]
    );

    // Marcar sponsorCode como usado (INALTERADO)
    if (sponsorCode && extraDiscount > 0) {
      await pool.query(
        `UPDATE sponsor_vouchers 
         SET used = TRUE, used_at = NOW()
         WHERE code=$1 AND used=FALSE`,
        [sponsorCode]
      );
    }

    // ===============================================
    // ENVIAR EMAIL AO CLIENTE (Lógica do template customizado)
    // ===============================================
    const validateUrl = `${process.env.FRONTEND_URL}/validate.html?code=${code}`;
    const amountPaidEuros = (amountCents / 100).toFixed(2);
    const originalPriceEuros = (originalPriceCents / 100).toFixed(2);
    
    // Cálculo total de economia
    let totalEconomyCents = originalPriceCents - amountCents;
    const totalEconomyEuros = (totalEconomyCents / 100).toFixed(2);
    
    let html;

    if (extraDiscount > 0) {
        // CLIENTE ESPECIAL - E-mail customizado
        
        // CÁLCULO DE DESCONTOS INDIVIDUAIS
        // Preço antes de tudo
        // Desconto Padrão = Preço Original - Base Amount
        const baseAmountEuros = (baseAmountCents / 100).toFixed(2);
        const partnerDiscountEuros = ((originalPriceCents - baseAmountCents) / 100).toFixed(2);
        
        // Desconto Extra = Base Amount - Valor Pago
        const extraDiscountEuros = ((baseAmountCents - amountCents) / 100).toFixed(2);
        
        html = `
            <h2>🎉 O seu voucher especial chegou!</h2>
            <p>Olá,</p>
            <p>Parabéns! Você adquiriu a seguinte experiência com seu código de patrocinador:</p>
            
            <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Experiência Adquirida:</td><td style="padding: 8px; border: 1px solid #ddd;">${productName}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Preço Original:</td><td style="padding: 8px; border: 1px solid #ddd;">€${originalPriceEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">✔ Desconto Padrão (${partnerDiscount}%):</td><td style="padding: 8px; border: 1px solid #ddd; color: #cc0000;">- €${partnerDiscountEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">✔ Desconto Patrocinador (+${extraDiscount}%):</td><td style="padding: 8px; border: 1px solid #ddd; color: #cc0000;">- €${extraDiscountEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Total de Economia:</td><td style="padding: 8px; border: 1px solid #ddd; color: #00AA00;">€${totalEconomyEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Valor Pago:</td><td style="padding: 8px; border: 1px solid #ddd; font-size: 1.1em;">€${amountPaidEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Código Especial Utilizado:</td><td style="padding: 8px; border: 1px solid #ddd;">${sponsorCode} (${sponsorName})</td></tr>
            </table>

            <p>Seu código de voucher é: <b style="font-size: 1.2em;">${code}</b></p>
            <p>Você pode utilizá-lo aqui: <a href="${validateUrl}">${validateUrl}</a></p>
            <p>Obrigado!</p>
        `;
    } else {
        // CLIENTE NORMAL - E-mail padrão
        const partnerDiscount = partner.discount_percent || 15;
        
        html = `
            <h2>🎉 O seu voucher chegou!</h2>
            <p>Olá,</p>
            <p>Você adquiriu a seguinte experiência com o desconto padrão de ${partnerDiscount}%:</p>
            
            <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Experiência Adquirida:</td><td style="padding: 8px; border: 1px solid #ddd;">${productName}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Preço Original:</td><td style="padding: 8px; border: 1px solid #ddd;">€${originalPriceEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Total de Economia:</td><td style="padding: 8px; border: 1px solid #ddd; color: #00AA00;">€${totalEconomyEuros}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Valor Pago:</td><td style="padding: 8px; border: 1px solid #ddd; font-size: 1.1em;">€${amountPaidEuros}</td></tr>
            </table>
            
            <p>Seu código de voucher é: <b style="font-size: 1.2em;">${code}</b></p>
            <p>Você pode utilizá-lo aqui: <a href="${validateUrl}">${validateUrl}</a></p>
            <p>Obrigado!</p>
        `;
    }
    
    // Disparo do email
    await sendEmail({
      to: email,
      subject: `Seu voucher para ${productName}`,
      html,
    });

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ ERRO WEBHOOK:", err);
    return res.status(500).json({ error: "Erro processando webhook" });
  }
});

export default router;