import { Router } from "express";
import Stripe from "stripe";
import { pool } from "./db.js";
import { sendEmail } from "./utils/sendEmail.js";
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

    // -----------------------------------------------
    // 1. Buscar parceiro
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
    // 2. Validar sponsorCode
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
    // 3. Cálculo financeiro
    // ------------------------------------------------
    const totalCents = Number(amountCents);
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "amountCents inválido." });
    }

    let baseAmountCents = totalCents;
    const platformPctOriginal = 0.18; // 18%

    let applicationFeeCents;

    if (extraDiscount > 0) {
      const factor = 1 - extraDiscount / 100;
      baseAmountCents = Math.round(totalCents / factor);

      const platformPctFinal = platformPctOriginal - extraDiscount / 100;
      applicationFeeCents = Math.round(baseAmountCents * platformPctFinal);
    } else {
      applicationFeeCents = Math.round(totalCents * platformPctOriginal);
    }

    // ------------------------------------------------
    // 4. Criar sessão Stripe
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
            unit_amount: totalCents,
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
        sponsorCode,
        extraDiscount,
        sponsorName: sponsorName || "",
        baseAmountCents,
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

    const amountCents = session.amount_total;
    const currency = session.currency || "eur";
    let baseAmountCents = Number(session.metadata?.baseAmountCents || amountCents);

    // Cálculos financeiros
    const platformPctOriginal = 0.18;
    let platformFeeCents;
    let partnerShareCents;

    if (extraDiscount > 0) {
      const platformPctFinal = platformPctOriginal - extraDiscount / 100;
      platformFeeCents = Math.round(baseAmountCents * platformPctFinal);
      partnerShareCents = amountCents - platformFeeCents;
    } else {
      platformFeeCents = Math.round(amountCents * platformPctOriginal);
      partnerShareCents = amountCents - platformFeeCents;
    }

    // Criar voucher
    const code = generateVoucherCode();

    // Validade (diam padrão 60)
    const partnerRes = await pool.query(
      "SELECT voucher_validity_days, name FROM partners WHERE slug = $1",
      [partnerSlug]
    );
    const partner = partnerRes.rows[0] || {};
    const daysValidity = partner.voucher_validity_days || 60;

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

    // Marcar sponsorCode como usado
    if (sponsorCode && extraDiscount > 0) {
      await pool.query(
        `UPDATE sponsor_vouchers 
         SET used = TRUE, used_at = NOW()
         WHERE code=$1 AND used=FALSE`,
        [sponsorCode]
      );
    }

    // ENVIAR EMAIL AO CLIENTE (resumo especial)
    const validateUrl = `${process.env.FRONTEND_URL}/validate.html?code=${code}`;

    const html = `
      <h2>🎉 O seu voucher chegou!</h2>
      <p>Experiência: <b>${productName}</b></p>
      <p>Código: <b>${code}</b></p>
      <p>Valor pago: €${(amountCents / 100).toFixed(2)}</p>
      ${
        extraDiscount > 0
          ? `<p>Desconto especial patrocinador: <b>${extraDiscount}%</b> (${sponsorName})</p>`
          : ""
      }
      <p>Use aqui: <a href="${validateUrl}">${validateUrl}</a></p>
    `;

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
