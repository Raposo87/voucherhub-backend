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
      amountCents, // Este valor JÁ TEM o desconto padrão (ex: 1275 para 12.75€)
      originalPriceCents, // Preço cheio (ex: 1500 para 15.00€)
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
        error: "Parceiro não tem stripe_account_id configurado — configure no banco.",
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
        return res.status(400).json({ error: "Este código especial já foi utilizado." });
      }

      if (!voucher.discount_extra || voucher.discount_extra <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Código especial não possui desconto ativo." });
      }

      extraDiscount = voucher.discount_extra;
      sponsorName = voucher.sponsor;
    }

    // ------------------------------------------------
    // 3. Cálculo financeiro (LÓGICA CORRIGIDA)
    // ------------------------------------------------
    // O frontend manda o valor com desconto padrão (ex: 1275).
    // Esse será nosso "Preço Base" para o cálculo do patrocinador.
    const incomingCents = Number(amountCents);
    
    if (!Number.isFinite(incomingCents) || incomingCents <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "amountCents inválido." });
    }

    let baseAmountCents = incomingCents; // Ex: 1275
    let finalAmountToChargeCents = incomingCents; // Começa igual
    let applicationFeeCents;
    const platformPctOriginal = 0.18; // 18%

    if (extraDiscount > 0) {
      // APLICAR O DESCONTO EXTRA SOBRE O PREÇO JÁ DESCONTADO (COMPOSTO)
      // Ex: 1275 * (1 - 0.05) = 1275 * 0.95 = 1211.25 -> 1211
      const multiplier = 1 - (extraDiscount / 100);
      finalAmountToChargeCents = Math.round(baseAmountCents * multiplier);
      
      // A comissão da plataforma absorve esse desconto extra
      // A taxa é calculada sobre o BASE (1275), mas subtraída a % do patrocinador
      const platformPctFinal = platformPctOriginal - (extraDiscount / 100); 
      applicationFeeCents = Math.round(baseAmountCents * platformPctFinal);
    } else {
      // Cliente normal
      applicationFeeCents = Math.round(incomingCents * platformPctOriginal);
    }
    
    applicationFeeCents = Math.max(1, applicationFeeCents);

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
            unit_amount: finalAmountToChargeCents, // Valor FINAL cobrado (1211)
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
        baseAmountCents, // Guardamos o valor de 1275 aqui para o email
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
// 2) STRIPE WEBHOOK
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
    const email = session.customer_details?.email || session.metadata?.email || "no-email";
    const partnerSlug = session.metadata?.partnerSlug;
    const productName = session.metadata?.productName;
    const sponsorCode = normalize(session.metadata?.sponsorCode);
    const extraDiscount = Number(session.metadata?.extraDiscount || 0);
    const sponsorName = session.metadata?.sponsorName || "";
    
    const originalPriceCents = Number(session.metadata?.originalPriceCents || 0);
    const baseAmountCents = Number(session.metadata?.baseAmountCents || session.amount_total);
    const amountCents = session.amount_total; // O valor que foi realmente pago (1211)
    const currency = session.currency || "eur";

    // Cálculos para comissão
    const platformPctOriginal = 0.18;
    let platformFeeCents;
    let partnerShareCents;

    if (extraDiscount > 0) {
      const platformPctFinal = platformPctOriginal - extraDiscount / 100;
      // Taxa sobre o valor base (o valor que o parceiro esperava receber pedido sobre)
      platformFeeCents = Math.round(baseAmountCents * platformPctFinal);
      // Parceiro recebe o valor pago MENOS a taxa reduzida da plataforma
      partnerShareCents = amountCents - platformFeeCents;
    } else {
      platformFeeCents = Math.round(amountCents * platformPctOriginal);
      partnerShareCents = amountCents - platformFeeCents;
    }

    // Criar código do voucher
    const code = generateVoucherCode();

    // Validade (sem buscar discount_percent para evitar erro de coluna)
    const partnerRes = await pool.query(
      "SELECT voucher_validity_days, name FROM partners WHERE slug = $1",
      [partnerSlug]
    );
    const partner = partnerRes.rows[0] || {};
    const daysValidity = partner.voucher_validity_days || 60;
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysValidity);

    // Inserir Voucher
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

    // ------------------------------------------------------------
    // ENVIAR EMAIL COM QR CODE E CÁLCULOS CORRETOS
    // ------------------------------------------------------------
    const validateUrl = `${process.env.FRONTEND_URL}/validate.html?code=${code}`;
    
    // Gerar URL do QR Code (API pública, rápida e segura para emails)
    // Encoda a URL de validação dentro do QR Code
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(validateUrl)}`;

    const amountPaidEuros = (amountCents / 100).toFixed(2); // 12.11
    const originalPriceEuros = (originalPriceCents / 100).toFixed(2); // 15.00
    const totalEconomyEuros = ((originalPriceCents - amountCents) / 100).toFixed(2); // 2.89
    
    // Percentual de desconto padrão aproximado para exibição
    // (Original - Base) / Original * 100
    const standardDiscPct = Math.round(((originalPriceCents - baseAmountCents) / originalPriceCents) * 100);

    let html;

    if (extraDiscount > 0) {
        // CLIENTE ESPECIAL
        // Desconto Padrão em Euros (15.00 - 12.75 = 2.25)
        const partnerDiscountEuros = ((originalPriceCents - baseAmountCents) / 100).toFixed(2);
        // Desconto Extra em Euros (12.75 - 12.11 = 0.64)
        const extraDiscountEuros = ((baseAmountCents - amountCents) / 100).toFixed(2);
        
        html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #000; color: #fff; padding: 20px; text-align: center;">
                    <h2 style="margin:0;">🎉 Seu Voucher Especial!</h2>
                </div>
                <div style="padding: 20px;">
                    <p>Olá,</p>
                    <p>Você adquiriu a experiência <b>${productName}</b> com condições exclusivas de patrocinador.</p>
                    
                    <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
                        <img src="${qrCodeUrl}" alt="QR Code de Validação" style="width: 150px; height: 150px; border: 5px solid #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                        <p style="margin-top: 10px; font-size: 14px; color: #555;">Mostre este código ao parceiro</p>
                        <p style="font-size: 18px; font-weight: bold; margin: 5px 0;">${code}</p>
                    </div>

                    <table style="width:100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px;">Preço Original:</td><td style="padding: 10px; text-align: right;">€${originalPriceEuros}</td></tr>
                        <tr style="border-bottom: 1px solid #eee; color: #cc0000;"><td style="padding: 10px;">Desconto Padrão (~${standardDiscPct}%):</td><td style="padding: 10px; text-align: right;">- €${partnerDiscountEuros}</td></tr>
                        <tr style="border-bottom: 1px solid #eee; color: #cc0000;"><td style="padding: 10px;">Desconto Patrocinador (+${extraDiscount}%):</td><td style="padding: 10px; text-align: right;">- €${extraDiscountEuros}</td></tr>
                        <tr style="background-color: #f0fff4; color: #006400; font-weight: bold;"><td style="padding: 10px;">Valor Pago:</td><td style="padding: 10px; text-align: right;">€${amountPaidEuros}</td></tr>
                    </table>
                    
                    <p style="text-align: center; font-size: 0.9em; color: #777;">
                        <a href="${validateUrl}" style="color: #007bff; text-decoration: none;">Link de validação manual</a>
                    </p>
                </div>
            </div>
        `;
    } else {
        // CLIENTE NORMAL
        html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #000; color: #fff; padding: 20px; text-align: center;">
                    <h2 style="margin:0;">🎉 Seu Voucher Chegou!</h2>
                </div>
                <div style="padding: 20px;">
                    <p>Olá,</p>
                    <p>Você adquiriu a experiência <b>${productName}</b>.</p>
                    
                    <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
                        <img src="${qrCodeUrl}" alt="QR Code de Validação" style="width: 150px; height: 150px; border: 5px solid #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                        <p style="margin-top: 10px; font-size: 14px; color: #555;">Mostre este código ao parceiro</p>
                        <p style="font-size: 18px; font-weight: bold; margin: 5px 0;">${code}</p>
                    </div>

                    <table style="width:100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr style="border-bottom: 1px solid #eee;"><td style="padding: 10px;">Preço Original:</td><td style="padding: 10px; text-align: right;">€${originalPriceEuros}</td></tr>
                        <tr style="border-bottom: 1px solid #eee; color: #cc0000;"><td style="padding: 10px;">Desconto Padrão (~${standardDiscPct}%):</td><td style="padding: 10px; text-align: right;">- €${totalEconomyEuros}</td></tr>
                        <tr style="background-color: #f0fff4; color: #006400; font-weight: bold;"><td style="padding: 10px;">Valor Pago:</td><td style="padding: 10px; text-align: right;">€${amountPaidEuros}</td></tr>
                    </table>
                    
                     <p style="text-align: center; font-size: 0.9em; color: #777;">
                        <a href="${validateUrl}" style="color: #007bff; text-decoration: none;">Link de validação manual</a>
                    </p>
                </div>
            </div>
        `;
    }

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