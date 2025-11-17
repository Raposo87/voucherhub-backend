import { Router } from 'express';
import Stripe from 'stripe';
import { pool } from './src/db.js';
import { sendEmail } from '../utils/sendEmail.js';
import { randomBytes } from 'crypto';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function generateVoucherCode() {
  return 'VH-' + randomBytes(4).toString('hex').toUpperCase();
}

// Create Stripe Checkout Session (com split 18% / 82%)
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { email, partnerSlug, productName, amountCents, currency = 'eur' } = req.body;

    if (!email || !partnerSlug || !productName || !amountCents) {
      return res
        .status(400)
        .json({ error: 'Missing fields: email, partnerSlug, productName, amountCents' });
    }

    // 1) Buscar dados do parceiro para obter o stripe_account_id
    const partnerResult = await pool.query(
      'SELECT stripe_account_id FROM partners WHERE slug = $1',
      [partnerSlug]
    );

    if (!partnerResult.rows.length) {
      return res.status(400).json({ error: 'Parceiro não encontrado no banco.' });
    }

    const partner = partnerResult.rows[0];

    if (!partner.stripe_account_id) {
      return res.status(400).json({
        error: 'Parceiro não possui stripe_account_id configurado. Configure no banco antes de vender.'
      });
    }

    // 2) Calcular a taxa da plataforma (18% pra você)
    const totalCents = Number(amountCents);
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return res.status(400).json({ error: 'amountCents inválido.' });
    }

    const platformFeeCents = Math.round(totalCents * 0.18); // 18% para você

    const successUrl = `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.FRONTEND_URL}/cancel`;

    // 3) Criar sessão de checkout com split usando Stripe Connect
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: productName },
            unit_amount: totalCents
          },
          quantity: 1
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { email, partnerSlug },

      // 💰 Aqui acontece a divisão:
      // - cobrança inteira ocorre na SUA conta
      // - 18% fica com você (application_fee_amount)
      // - restante é enviado ao parceiro (transfer_data.destination)
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: partner.stripe_account_id
        }
      }
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] create session error', err);
    return res.status(500).json({ error: 'Could not create session' });
  }
});


// Stripe Webhook
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      const existing = await pool.query('SELECT id FROM vouchers WHERE stripe_session_id = $1', [session.id]);
      if (existing.rows.length) {
        console.log('[voucher] already issued for session', session.id);
        return res.json({ received: true });
      }
      
      const email = session.customer_details?.email || session.metadata?.email;
      const partnerSlug = session.metadata?.partnerSlug || 'partner';
      const amountCents = session.amount_total || 0;
      const currency = session.currency || 'eur';
      const code = generateVoucherCode();
      // 18% para a plataforma, 82% para o parceiro
      const platformFeeCents = Math.round(amountCents * 0.18); // 18% para a plataforma
      const partnerShareCents = amountCents - platformFeeCents; // 82% para o parceiro


      if (!email) {
         console.error('[voucher] Cannot issue voucher: Email is missing in Stripe session.');
         return res.status(400).json({ error: 'Email missing from Stripe session for voucher insertion.' });
      }

      // ------------------------------------------------------------------
      // 1. BUSCAR DADOS DO PARCEIRO NO BANCO DE DADOS
      // ------------------------------------------------------------------
      const partnerRes = await pool.query(
        `SELECT name, email, phone, location, price_original_cents, voucher_validity_days FROM partners WHERE slug = $1`, 
        [partnerSlug]
      );
      const partnerData = partnerRes.rows[0] || {};
      
      const partnerName = partnerData.name || partnerSlug;
      // Garante que usa o valor original do parceiro, mas fallback para o valor pago se não houver
      const valorOriginal = partnerData.price_original_cents || amountCents; 
      const daysValidity = partnerData.voucher_validity_days || 60; 

      // ------------------------------------------------------------------
      // 2. CÁLCULOS
      // ------------------------------------------------------------------
      const valorPago = amountCents;
      const economia = valorOriginal - valorPago;

      // Desconto (%)
      const desconto = valorOriginal > 0 && economia > 0
          ? Math.round((economia / valorOriginal) * 100) 
          : 0; 
          
      // Validade (60 dias corridos)
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysValidity);
      const validadeFormatada = expiryDate.toLocaleDateString('pt-PT', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
      });
      const validadeAviso = `Válido por ${daysValidity} dias (até ${validadeFormatada})`;
      const expiryWarning = `⚠️ Lembre-se: Utilize o seu voucher antes de ${validadeFormatada}.`;
      
      // Insere o voucher no DB, incluindo a data de expiração
      await pool.query(
        `INSERT INTO vouchers (
          email,
          partner_slug,
          code,
          amount_cents,
          currency,
          stripe_session_id,
          expires_at,
          platform_fee_cents,
          partner_share_cents
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          email,
          partnerSlug,
          code,
          amountCents,
          currency,
          session.id,
          expiryDate.toISOString(),
          platformFeeCents,
          partnerShareCents
        ]
      );

      // Send email
      const validateUrl = `${process.env.FRONTEND_URL}/validate.html?code=${code}`;

const html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:40px 0;">
  <tr>
    <td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.1);font-family:Arial,sans-serif;">
        
        <tr>
          <td style="background:#1f2b6c;padding:25px;text-align:center;">
            <img src="https://voucherhub.pt/logo.png" width="120" alt="VoucherHub" />
          </td>
        </tr>

        <tr>
          <td style="padding:25px;text-align:center;color:#333;">
            <h2 style="margin:0;font-size:24px;">🎉 O seu Voucher chegou!</h2>
            <p style="margin:10px 0 0;font-size:15px;">
              Obrigado por adquirir uma experiência com o <b>${partnerName}</b> através da VoucherHub.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 30px;">
            <table width="100%" style="background:#f1f4ff;border-radius:10px;padding:15px;">
              <tr>
                <td>
                  <p style="margin:0;font-size:14px;"><b>Código do Voucher:</b></p>
                  <p style="margin:4px 0 12px;font-size:22px;font-weight:bold;letter-spacing:2px;color:#1f2b6c;">
                    ${code}
                  </p>
                  
                  <p style="margin:0;font-size:14px;">✔ **Valor Original:** <span style="text-decoration: line-through;">${(valorOriginal/100).toFixed(2)} ${currency.toUpperCase()}</span></p>
                  <p style="margin:4px 0 0;font-size:14px;">✔ **Valor Pago:** <span style="font-weight: bold;">${(valorPago/100).toFixed(2)} ${currency.toUpperCase()}</span></p>
                  <p style="margin:4px 0 0;font-size:14px;">✔ **Desconto (%):** ${desconto}%</p>
                  <p style="margin:4px 0 0;font-size:14px;">✔ **Quanto Economizou:** ${(economia/100).toFixed(2)} ${currency.toUpperCase()}</p>
                  
                  <p style="margin:12px 0 0;font-size:14px;font-weight:bold;color:#ff7f50;">
                    ✔ **Validade:** ${validadeAviso}
                  </p>
                  <p style="margin:4px 0 0;font-size:13px;color:#ef4444;">
                    ✔ **Aviso de Expiração:** ${expiryWarning}
                  </p>
                  
                </td>
              </tr>
            </table>
          </td>
        </tr>
        
        <tr>
          <td style="padding: 10px 30px 0;">
            <h3 style="color:#2563eb; font-size: 18px; margin-bottom: 10px;">Informações do Parceiro (${partnerName})</h3>
            <ul style="list-style-type: none; padding: 0; margin: 0; font-size: 14px;">
              <li style="margin-bottom: 5px;">
                <span style="font-weight: bold;">Endereço do Parceiro:</span> ${partnerData.location || 'Consulte o site do parceiro'}
              </li>
              <li style="margin-bottom: 5px;">
                <span style="font-weight: bold;">Telefone:</span> ${partnerData.phone || 'Não disponível'}
              </li>
              <li style="margin-bottom: 15px;">
                <span style="font-weight: bold;">E-mail do Parceiro:</span> ${partnerData.email || 'Não disponível'}
              </li>
            </ul>
          </td>
        </tr>
        
        <tr>
          <td style="padding:10px 0 20px;text-align:center;">
            <a href="${validateUrl}" target="_blank">
              <img src="https://quickchart.io/qr?text=${encodeURIComponent(validateUrl)}&centerImageUrl=https://voucherhub.pt/logo.png&size=300" 
                   width="200" 
                   style="border-radius:12px;"
                   alt="QRCode"/>
            </a>
            <p style="margin-top:10px;font-size:13px;color:#888;">
              Aponte a câmara ou clique no QR Code para validar o voucher
            </p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:0 20px 30px;">
            <a href="${validateUrl}"
               style="background:#ff7f50;color:white;text-decoration:none;padding:12px 25px;border-radius:6px;font-size:16px;font-weight:bold;display:inline-block;">
              Validar Voucher
            </a>
          </td>
        </tr>

        <tr>
          <td style="background:#f7f7f7;padding:15px;text-align:center;color:#777;font-size:12px;">
            VoucherHub © ${new Date().getFullYear()} — Todos os direitos reservados.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;
      
      // Envia o email
      await sendEmail({
        to: email,
        subject: `🎉 O seu Voucher para ${partnerName} chegou!`,
        html
      });

    } catch (err) {
      console.error('[voucher] creation/email failed', err);
    }
  }

  res.json({ received: true });
});

export default router;