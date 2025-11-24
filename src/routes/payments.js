import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db.js";
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
// 1) CREATE CHECKOUT SESSION
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
    
    await client.query("BEGIN");

    // Busca parceiro e validações (INALTERADO)
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
        error: "Parceiro não tem stripe_account_id configurado — configure no banco.",
      });
    }

    // Validar sponsorCode (INALTERADO)
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
        return res.status(400).json({ error: "Este código especial já foi utilizado." });
      }

      if (!voucher.discount_extra || voucher.discount_extra <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Código especial não possui desconto ativo." });
      }

      extraDiscount = voucher.discount_extra;
      sponsorName = voucher.sponsor;
    }

    // Cálculo financeiro (INALTERADO - Lógica composta)
    const incomingCents = Number(amountCents);
    
    if (!Number.isFinite(incomingCents) || incomingCents <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "amountCents inválido." });
    }

    let baseAmountCents = incomingCents; 
    let finalAmountToChargeCents = incomingCents; 
    let applicationFeeCents;
    const platformPctOriginal = 0.18; 

    if (extraDiscount > 0) {
      const multiplier = 1 - (extraDiscount / 100);
      finalAmountToChargeCents = Math.round(baseAmountCents * multiplier);
      const platformPctFinal = platformPctOriginal - (extraDiscount / 100); 
      applicationFeeCents = Math.round(baseAmountCents * platformPctFinal);
    } else {
      applicationFeeCents = Math.round(incomingCents * platformPctOriginal);
    }
    
    applicationFeeCents = Math.max(1, applicationFeeCents);

    // Criar sessão Stripe (INALTERADO)
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
            unit_amount: finalAmountToChargeCents,
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
        sponsorCode: sponsorCode || "",
        extraDiscount,
        sponsorName: sponsorName || "",
        baseAmountCents, 
        platformPctOriginal: platformPctOriginal * 100,
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
// 2) STRIPE WEBHOOK (QR CODE COM LOGO)
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
    const productName = session.metadata?.productName;
    const amountCents = session.amount_total;
    const code = "TESTE-BASIC-EMAIL"; // Código de teste

    // TESTE SIMPLIFICADO: Enviar e-mail sem QR Code e sem descontos especiais
    const html = `
      <h2>🚀 TESTE DE E-MAIL - Sucesso!</h2>
      <p>Se você recebeu este e-mail, o seu sistema de envio está funcionando perfeitamente.</p>
      <p>Experiência: <b>${productName}</b></p>
      <p>Valor pago: €${(amountCents / 100).toFixed(2)}</p>
      <p>Código de Referência: <b>${code}</b></p>
    `;

    await sendEmail({
      to: email,
      // IMPORTANTE: Mude o campo FROM para o e-mail verificado na sua conta Resend/Sendgrid
      from: 'seu-email-verificado@seudominio.pt', // <-- SUBSTITUIR AQUI!
      subject: `TESTE: Seu voucher para ${productName}`,
      html,
    });
    
    // NOTA: Os dados ainda serão inseridos no DB, pois não alteramos essa lógica acima.
    // O foco é apenas testar o e-mail.

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ ERRO WEBHOOK (TESTE DE E-MAIL):", err);
    return res.status(500).json({ error: "Erro processando webhook no teste" });
  }
});