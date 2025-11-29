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

// Formatar data em português
function formatDatePT(date) {
  return new Date(date).toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ==========================================================
// 1) CREATE CHECKOUT SESSION (AGORA RETÉM OS FUNDOS)
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



    if (!email || !productName || !amountCents || typeof partnerSlug !== "string") {
      return res.status(400).json({
        error: "Missing fields: email, partnerSlug, productName, amountCents",
      });
    }

    const sponsorCode = normalize(rawSponsorCode);
    let extraDiscount = 0;
    let sponsorName = null;

    await client.query("BEGIN");

    // 1. Buscar parceiro
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
          "Parceiro não tem stripe_account_id configurado – configure no banco.",
      });
    }

    // 2. Validar sponsorCode
    if (sponsorCode) {
      const { rows } = await client.query(
        "SELECT * FROM sponsor_vouchers WHERE code = $1",
        [sponsorCode]
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Código especial inválido." });
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
        return res.status(400).json({
          error: "Código especial não possui desconto ativo.",
        });
      }

      extraDiscount = voucher.discount_extra;
      sponsorName = voucher.sponsor;
    }

    // 3. Cálculo financeiro
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
      const multiplier = 1 - extraDiscount / 100;
      finalAmountToChargeCents = Math.round(baseAmountCents * multiplier);

      // Percentagem efetiva da plataforma após desconto patrocinador
      const platformPctFinal = platformPctOriginal - extraDiscount / 100;
      applicationFeeCents = Math.round(
        baseAmountCents * platformPctFinal
      );
    } else {
      applicationFeeCents = Math.round(
        incomingCents * platformPctOriginal
      );
    }

    // Garante pelo menos 1 cêntimo
    applicationFeeCents = Math.max(1, applicationFeeCents);

    // 🔑 Taxa da plataforma como inteiro final
    const finalApplicationFee = parseInt(applicationFeeCents, 10);

    // 💡 NOVO: valor estimado do parceiro (com base no valor cobrado, já com descontos)
    const partnerShareCents = Math.max(
      0,
      finalAmountToChargeCents - finalApplicationFee
    );

    // 4. Criar sessão Stripe
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
        // 💡 NOVO: info para gestão de repasse posterior
        partnerStripeId: partner.stripe_account_id,
        partnerShareCents: partnerShareCents,
        finalAmountToChargeCents,
      },
    });

    await client.query("COMMIT");
    return res.json({ url: session.url });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERRO CREATE-SESSION:", err);
    return res
      .status(500)
      .json({ error: "Erro ao criar checkout session" });
  } finally {
    client.release();
  }
});

// ==========================================================
// 2) STRIPE WEBHOOK (AGORA ARMAZENA O CHARGE ID CORRETO)
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
      session.customer_details?.email ||
      session.metadata?.email ||
      "no-email";
    const partnerSlug = session.metadata?.partnerSlug;
    const productName = session.metadata?.productName;
    const sponsorCode = normalize(session.metadata?.sponsorCode);
    const extraDiscount = Number(session.metadata?.extraDiscount || 0);
    const sponsorName = session.metadata?.sponsorName || "";

    const originalPriceCents = Number(
      session.metadata?.originalPriceCents || 0
    );
    const baseAmountCents = Number(
      session.metadata?.baseAmountCents || session.amount_total
    );
    const amountCents = session.amount_total;
    const currency = session.currency || "eur";

    // 🔴 MUDANÇA CRÍTICA 1: Buscar o Charge ID (ch_...)
    const paymentIntentId = session.payment_intent;
    
    // É essencial buscar o Payment Intent completo para obter o Charge ID (latest_charge)
    // O Charge ID é o que referencia o dinheiro retido na sua conta (Escrow)
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const sourceChargeId = paymentIntent.latest_charge;


    // Cálculos para comissão
    const platformPctOriginal = 0.18;
    let platformFeeCents;
    let partnerShareCents;

    if (extraDiscount > 0) {
      const platformPctFinal =
        platformPctOriginal - extraDiscount / 100;
      platformFeeCents = Math.round(
        baseAmountCents * platformPctFinal
      );
      partnerShareCents = amountCents - platformFeeCents;
    } else {
      platformFeeCents = Math.round(
        amountCents * platformPctOriginal
      );
      partnerShareCents = amountCents - platformFeeCents;
    }

    // Criar código do voucher
    const code = generateVoucherCode();

    // Buscar informações do parceiro
    const partnerRes = await pool.query(
      "SELECT voucher_validity_days, name, location, phone, email, partner_pin FROM partners WHERE slug = $1",
      [partnerSlug]
    );
    const partner = partnerRes.rows[0] || {};
    const daysValidity = partner.voucher_validity_days || 60;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysValidity);

    // 💡 NOVO: Valor do voucher em Euros (para coluna 'value' DECIMAL)
    const valueEuros = (amountCents / 100).toFixed(2);
    // 💡 NOVO: Data limite para uso (para coluna 'valid_until' DATE)
    const validUntilDate = expiryDate.toISOString().split('T')[0];


    // 🔴 MUDANÇA CRÍTICA 2: Inserir Voucher com o Charge ID (sourceChargeId)
    // E todas as colunas do schema que estavam em falta (product_name, value, valid_until, status)
    await pool.query(
      `INSERT INTO vouchers (
        email, partner_slug, code, amount_cents, currency, product_name, 
        stripe_session_id, stripe_payment_intent_id, expires_at, platform_fee_cents, partner_share_cents,
        value, valid_until, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        email,                      // $1
        partnerSlug,                // $2
        code,                       // $3
        amountCents,                // $4
        currency,                   // $5
        productName,                // $6 (NOVO)
        session.id,                 // $7
        sourceChargeId,             // $8 (CORRIGIDO: ch_ ID)
        expiryDate.toISOString(),   // $9
        platformFeeCents,           // $10
        partnerShareCents,          // $11
        valueEuros,                 // $12 (NOVO)
        validUntilDate,             // $13 (NOVO)
        'active'                    // $14 (NOVO, valor padrão)
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
    // ENVIAR EMAIL COM QR CODE E INFORMAÇÕES COMPLETAS
    // ------------------------------------------------------------
    const validateUrl = `${process.env.FRONTEND_URL}/validate.html?code=${code}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
      validateUrl
    )}`;

    const originalPriceEuros = (originalPriceCents / 100).toFixed(2);
    const amountPaidEuros = (amountCents / 100).toFixed(2);
    const totalSavedEuros = (
      (originalPriceCents - amountCents) /
      100
    ).toFixed(2);
    const totalDiscountPct = Math.round(
      ((originalPriceCents - amountCents) / originalPriceCents) * 100
    );

    const expiryDateFormatted = formatDatePT(expiryDate);

    let html;

    if (extraDiscount > 0) {
      // CLIENTE COM CÓDIGO DE PATROCINADOR
      const standardDiscPct = Math.round(
        ((originalPriceCents - baseAmountCents) /
          originalPriceCents) *
          100
      );
      const partnerDiscountEuros = (
        (originalPriceCents - baseAmountCents) /
        100
      ).toFixed(2);
      const extraDiscountEuros = (
        (baseAmountCents - amountCents) /
        100
      ).toFixed(2);

      html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: 'Helvetica Neue', Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 40px 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 600;">🎉 Voucher Exclusivo!</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Condições especiais de patrocinador</p>
        </div>

        <div style="text-align: center; padding: 30px 20px; background: linear-gradient(to bottom, #f8f9ff 0%, #ffffff 100%);">
            <div style="display: inline-block; padding: 15px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <img src="${qrCodeUrl}" alt="QR Code" style="width: 200px; height: 200px; display: block;">
            </div>
            <p style="margin: 15px 0 5px 0; font-size: 14px; color: #666; font-weight: 500;">SEU CÓDIGO VOUCHER</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: #667eea; letter-spacing: 2px;">${code}</p>
            <p style="margin: 10px 0 0 0; font-size: 13px; color: #888;">Apresente este código ao parceiro</p>
        </div>

        <div style="padding: 0 30px 20px 30px;">
            <div style="background: #f8f9ff; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea;">
                <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #333;">📦 ${productName}</h3>
                <p style="margin: 0; font-size: 14px; color: #666;">Experiência adquirida com sucesso</p>
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #333; font-weight: 600;">💰 Resumo Financeiro</h3>
            
            <table style="width: 100%; border-collapse: collapse; background: #fafafa; border-radius: 8px; overflow: hidden;">
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 15px; font-size: 14px; color: #666;">Valor Original:</td>
                    <td style="padding: 15px; text-align: right; font-size: 16px; font-weight: 600; color: #333;">€${originalPriceEuros}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee; background: #fff8f8;">
                    <td style="padding: 15px; font-size: 14px; color: #d63031;">Desconto Padrão (${standardDiscPct}%):</td>
                    <td style="padding: 15px; text-align: right; font-size: 16px; font-weight: 600; color: #d63031;">- €${partnerDiscountEuros}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee; background: #fff0f0;">
                    <td style="padding: 15px; font-size: 14px; color: #e17055;">Desconto Patrocinador (+${extraDiscount}%):</td>
                    <td style="padding: 15px; text-align: right; font-size: 16px; font-weight: 600; color: #e17055;">- €${extraDiscountEuros}</td>
                </tr>
                <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                    <td style="padding: 15px; font-size: 15px; font-weight: 600;">✓ Valor Pago:</td>
                    <td style="padding: 15px; text-align: right; font-size: 20px; font-weight: bold;">€${amountPaidEuros}</td>
                </tr>
            </table>

            <div style="margin-top: 15px; padding: 12px; background: #e8f5e9; border-radius: 6px; text-align: center;">
                <p style="margin: 0; font-size: 14px; color: #2d7738; font-weight: 600;">
                    🎁 Você economizou €${totalSavedEuros} (${totalDiscountPct}% de desconto total)
                </p>
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <div style="background: #fff8e1; border-left: 4px solid #ffa726; padding: 15px; border-radius: 6px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #e65100; font-weight: 600;">⏰ Validade do Voucher</p>
                <p style="margin: 0; font-size: 13px; color: #666;">Válido por ${daysValidity} dias (até ${expiryDateFormatted})</p>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #888;">⚠️ Lembre-se: Utilize seu voucher antes de ${expiryDateFormatted}</p>
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #333; font-weight: 600;">📍 Informações do Parceiro</h3>
            <div style="background: #f8f9ff; padding: 20px; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600; color: #667eea;">${
                  partner.name || "Parceiro"
                }</p>
                ${
                  partner.location
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #666;"><strong>📍 Localização:</strong> ${partner.location}</p>`
                    : ""
                } 
                ${
                  partner.phone
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #666;"><strong>📞 Telefone:</strong> ${partner.phone}</p>`
                    : ""
                }
                ${
                  partner.email
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #666;"><strong>✉️ E-mail:</strong> ${partner.email}</p>`
                    : ""
                }
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; border-radius: 6px;">
                <p style="margin: 0; font-size: 13px; color: #1565c0;">
                    <strong>🔄 Política de Devolução:</strong> Você tem até 14 dias para solicitar o reembolso, caso necessário.
                </p>
            </div>
        </div>

        <div style="background: #f5f5f5; padding: 25px 30px; text-align: center; border-top: 1px solid #eee;">
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #666;">
                <a href="${validateUrl}" style="color: #667eea; text-decoration: none; font-weight: 500;">🔗 Link de validação manual</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
                Obrigado por escolher nossos serviços! ❤️
            </p>
        </div>

    </div>
</body>
</html>
      `;
    } else {
      // CLIENTE NORMAL
      html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: 'Helvetica Neue', Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 40px 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; font-weight: 600;">🎉 Seu Voucher Chegou!</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Aproveite sua experiência</p>
        </div>

        <div style="text-align: center; padding: 30px 20px; background: linear-gradient(to bottom, #f8f9ff 0%, #ffffff 100%);">
            <div style="display: inline-block; padding: 15px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <img src="${qrCodeUrl}" alt="QR Code" style="width: 200px; height: 200px; display: block;">
            </div>
            <p style="margin: 15px 0 5px 0; font-size: 14px; color: #666; font-weight: 500;">SEU CÓDIGO VOUCHER</p>
            <p style="margin: 0; font-size: 24px; font-weight: bold; color: #667eea; letter-spacing: 2px;">${code}</p>
            <p style="margin: 10px 0 0 0; font-size: 13px; color: #888;">Apresente este código ao parceiro</p>
        </div>

        <div style="padding: 0 30px 20px 30px;">
            <div style="background: #f8f9ff; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea;">
                <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #333;">📦 ${productName}</h3>
                <p style="margin: 0; font-size: 14px; color: #666;">Experiência adquirida com sucesso</p>
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #333; font-weight: 600;">💰 Resumo Financeiro</h3>
            
            <table style="width: 100%; border-collapse: collapse; background: #fafafa; border-radius: 8px; overflow: hidden;">
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 15px; font-size: 14px; color: #666;">Valor Original:</td>
                    <td style="padding: 15px; text-align: right; font-size: 16px; font-weight: 600; color: #333;">€${originalPriceEuros}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee; background: #fff8f8;">
                    <td style="padding: 15px; font-size: 14px; color: #d63031;">Desconto (${totalDiscountPct}%):</td>
                    <td style="padding: 15px; text-align: right; font-size: 16px; font-weight: 600; color: #d63031;">- €${totalSavedEuros}</td>
                </tr>
                <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                    <td style="padding: 15px; font-size: 15px; font-weight: 600;">✓ Valor Pago:</td>
                    <td style="padding: 15px; text-align: right; font-size: 20px; font-weight: bold;">€${amountPaidEuros}</td>
                </tr>
            </table>

            <div style="margin-top: 15px; padding: 12px; background: #e8f5e9; border-radius: 6px; text-align: center;">
                <p style="margin: 0; font-size: 14px; color: #2d7738; font-weight: 600;">
                    🎁 Você economizou €${totalSavedEuros}
                </p>
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <div style="background: #fff8e1; border-left: 4px solid #ffa726; padding: 15px; border-radius: 6px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #e65100; font-weight: 600;">⏰ Validade do Voucher</p>
                <p style="margin: 0; font-size: 13px; color: #666;">Válido por ${daysValidity} dias (até ${expiryDateFormatted})</p>
                <p style="margin: 8px 0 0 0; font-size: 12px; color: #888;">⚠️ Lembre-se: Utilize seu voucher antes de ${expiryDateFormatted}</p>
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #333; font-weight: 600;">📍 Informações do Parceiro</h3>
            <div style="background: #f8f9ff; padding: 20px; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; font-size: 16px; font-weight: 600; color: #667eea;">${
                  partner.name || "Parceiro"
                }</p>
                ${
                  partner.location
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #666;"><strong>📍 Localização:</strong> ${partner.location}</p>`
                    : ""
                }
                ${
                  partner.phone
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #666;"><strong>📞 Telefone:</strong> ${partner.phone}</p>`
                    : ""
                }
                ${
                  partner.email
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; color: #666;"><strong>✉️ E-mail:</strong> ${partner.email}</p>`
                    : ""
                }
            </div>
        </div>

        <div style="padding: 0 30px 30px 30px;">
            <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; border-radius: 6px;">
                <p style="margin: 0; font-size: 13px; color: #1565c0;">
                    <strong>🔄 Política de Devolução:</strong> Você tem até 14 dias para solicitar o reembolso, caso necessário.
                </p>
            </div>
        </div>

        <div style="background: #f5f5f5; padding: 25px 30px; text-align: center; border-top: 1px solid #eee;">
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #666;">
                <a href="${validateUrl}" style="color: #667eea; text-decoration: none; font-weight: 500;">🔗 Link de validação manual</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
                Obrigado por escolher nossos serviços! ❤️
            </p>
        </div>

    </div>
</body>
</html>
      `;
    }

    await sendEmail({
      to: email,
      subject: `✨ Seu voucher para ${productName}`,
      html,
    });

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ ERRO WEBHOOK:", err);
    return res.status(500).json({ error: "Erro processando webhook" });
  }
});

export default router;