import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db.js";
import { sendEmail } from "../utils/sendEmail.js"; // <-- VERIFIQUE ESTE CAMINHO NOVAMENTE! Deve ser ../utils/
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
// (Nenhuma mudança necessária aqui, o código que você enviou estava correto)
router.post("/create-checkout-session", async (req, res) => {
    // ... [Seu código CREATE-CHECKOUT-SESSION completo e correto aqui] ...
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
            "Parceiro não tem stripe_account_id configurado — configure no banco.",
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
  
      // 3. Cálculo financeiro
      const totalCents = Number(amountCents);
      if (!Number.isFinite(totalCents) || totalCents <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "amountCents inválido." });
      }
  
      let baseAmountCents = totalCents;
      const platformPctOriginal = 0.18; // 18%
  
      let applicationFeeCents;
  
      if (extraDiscount > 0) {
        // Correção de cálculo se você estiver usando a versão anterior:
        // A lógica de aplicação de taxas é mais simples: 
        // A taxa é aplicada sobre o valor original (baseAmountCents) menos o desconto extra que você assumiu.
        // Já que você está a passar o valor final no amountCents do POST, vamos usar essa lógica aqui:
        const factor = 1 - extraDiscount / 100;
        // baseAmountCents deve ser o valor *antes* do desconto extra
        baseAmountCents = Math.round(originalPriceCents * (1 - (partner.discount_percent || 15) / 100)); // Calculamos o valor base (com desconto normal)
        
        const platformPctFinal = platformPctOriginal - extraDiscount / 100;
        applicationFeeCents = Math.round(baseAmountCents * platformPctFinal);
      } else {
        applicationFeeCents = Math.round(totalCents * platformPctOriginal);
      }
      
      applicationFeeCents = Math.max(1, applicationFeeCents); // Garante taxa mínima de 1 cent

  
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
          baseAmountCents, // Valor após desconto normal, antes de qualquer desconto extra
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


// ==========================================================
// 2) STRIPE WEBHOOK — NOVO CÓDIGO SIMPLIFICADO
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

    const amountCents = session.amount_total;
    const currency = session.currency || "eur";
    let baseAmountCents = Number(session.metadata?.baseAmountCents || amountCents);

    // Cálculos financeiros (seu código existente)
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

    // Validade
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

    // ------------------------------------------------------------
    // QR CODE SIMPLES (melhor para evitar spam)
    // ------------------------------------------------------------
    const validateUrl = `${process.env.FRONTEND_URL}/validate.html?code=${code}`;
    
    // QR Code Simples sem logo
    const qrCodeUrl = `https://quickchart.io/qr?text=${encodeURIComponent(validateUrl)}&size=300&ecLevel=H&margin=1`;

    const amountPaidEuros = (amountCents / 100).toFixed(2);
    const originalPriceEuros = (originalPriceCents / 100).toFixed(2);
    const standardDiscPct = Math.round(((originalPriceCents - baseAmountCents) / originalPriceCents) * 100);

    // ------------------------------------------------------------
    // TEMPLATE DE EMAIL SIMPLIFICADO (melhor para evitar spam)
    // ------------------------------------------------------------
    const discountInfo = extraDiscount > 0 
        ? `<p style="color:#D35400; font-weight:bold;">✅ Desconto Especial Patrocinador (${extraDiscount}%) aplicado!</p>`
        : '';

    const html = `
        <div style="font-family: sans-serif; max-width: 500px; margin: auto; border: 1px solid #ccc; border-radius: 8px;">
            <div style="background-color: #000; color: #fff; padding: 15px; text-align: center; border-radius: 8px 8px 0 0;">
                <h2 style="margin:0;">Voucher para ${partner.name || 'Sua Experiência'}</h2>
            </div>
            <div style="padding: 20px; text-align: center;">
                <p style="font-size: 1.1em;">Obrigado por adquirir <b>${productName}</b>.</p>
                
                <div style="margin: 25px 0; border: 1px solid #eee; padding: 15px; border-radius: 5px; background: #f9f9f9;">
                    <p style="font-size: 1.2em; margin: 0 0 10px 0; color: #555;">Código de Validação:</p>
                    <p style="font-size: 2em; font-weight: bold; color: #006400; margin: 0;">${code}</p>
                    <img src="${qrCodeUrl}" alt="QR Code" style="width: 150px; height: 150px; margin-top: 15px; border: 1px solid #ddd; padding: 5px;">
                    <p style="font-size: 0.8em; color: #777; margin-top: 5px;">Aponte a câmara para validar.</p>
                </div>
                
                <table style="width:100%; text-align:left; font-size: 0.9em;">
                    <tr><td style="padding: 5px 0;">Preço Original:</td><td style="padding: 5px 0; text-align:right;">€${originalPriceEuros}</td></tr>
                    <tr><td style="padding: 5px 0;">Desconto Padrão (${standardDiscPct}%):</td><td style="padding: 5px 0; text-align:right; color:#CC0000;">- €${(originalPriceCents / 100 - baseAmountCents / 100).toFixed(2)}</td></tr>
                    <tr style="font-weight:bold; background:#e8ffe8;"><td style="padding: 5px 0;">Total Pago:</td><td style="padding: 5px 0; text-align:right; color:#006400;">€${amountPaidEuros}</td></tr>
                </table>
                
                ${discountInfo}
                
                <p style="margin-top: 30px;">Validade: ${expiryDate.toLocaleDateString('pt-PT')}</p>
                <p style="font-size: 0.9em;"><a href="${validateUrl}">Link de Validação</a></p>
            </div>
        </div>
    `;

    await sendEmail({
      to: email,
      subject: `Seu Voucher para ${partner.name} - ${productName}`,
      html,
    });

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ ERRO WEBHOOK:", err);
    return res.status(500).json({ error: "Erro processando webhook" });
  }
});

export default router;