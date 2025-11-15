import { Router } from 'express';
import Stripe from 'stripe';
import { pool } from '../db.js';
import { sendEmail } from '../utils/sendEmail.js';
import { randomBytes } from 'crypto';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function generateVoucherCode() {
  return 'VH-' + randomBytes(4).toString('hex').toUpperCase();
}

// Create Stripe Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { email, partnerSlug, productName, amountCents, currency = 'eur' } = req.body;
    if (!email || !partnerSlug || !productName || !amountCents) {
      return res.status(400).json({ error: 'Missing fields: email, partnerSlug, productName, amountCents' });
    }

    const successUrl = `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${process.env.FRONTEND_URL}/cancel`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency,
          product_data: { name: productName },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { email, partnerSlug }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] create session error', err);
    res.status(500).json({ error: 'Could not create session' });
  }
});

// Stripe Webhook
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    // 💡 CORREÇÃO CRÍTICA: Use req.body. 
    // O middleware `express.raw` no server.js anexa o buffer RAW a req.body.
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      // Avoid duplicates
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

      // Certifique-se de que o email não é nulo antes da inserção
      if (!email) {
         console.error('[voucher] Cannot issue voucher: Email is missing in Stripe session.');
         return res.status(400).json({ error: 'Email missing from Stripe session for voucher insertion.' });
      }

      await pool.query(
        `INSERT INTO vouchers (email, partner_slug, code, amount_cents, currency, stripe_session_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, partnerSlug, code, amountCents, currency, session.id]
      );

      // Send email
      const validateUrl = `https://voucherhub.pt/validate.html?code=${code}`;

const html = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:40px 0;">
  <tr>
    <td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.1);font-family:Arial,sans-serif;">
        
        <!-- Header -->
        <tr>
          <td style="background:#1f2b6c;padding:25px;text-align:center;">
            <img src="https://voucherhub.pt/logo.png" width="120" alt="VoucherHub" />
          </td>
        </tr>

        <!-- Title -->
        <tr>
          <td style="padding:25px;text-align:center;color:#333;">
            <h2 style="margin:0;font-size:24px;">🎉 O seu Voucher chegou!</h2>
            <p style="margin:10px 0 0;font-size:15px;">
              Obrigado por adquirir uma experiência com o <b>${partnerSlug}</b> através da VoucherHub.
            </p>
          </td>
        </tr>

        <!-- Voucher box -->
        <tr>
          <td style="padding:20px 30px;">
            <table width="100%" style="background:#f1f4ff;border-radius:10px;padding:15px;">
              <tr>
                <td>
                  <p style="margin:0;font-size:14px;"><b>Código do Voucher:</b></p>
                  <p style="margin:4px 0 12px;font-size:22px;font-weight:bold;letter-spacing:2px;color:#1f2b6c;">
                    ${code}
                  </p>

                  <p style="margin:0;font-size:14px;"><b>Valor pago:</b> ${(amountCents/100).toFixed(2)} ${currency.toUpperCase()}</p>
                  <p style="margin:4px 0 0;font-size:14px;"><b>Parceiro:</b> ${partnerSlug}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- QR Code -->
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

        <!-- Button -->
        <tr>
          <td align="center" style="padding:0 20px 30px;">
            <a href="${validateUrl}"
               style="background:#ff7f50;color:white;text-decoration:none;padding:12px 25px;border-radius:6px;font-size:16px;font-weight:bold;display:inline-block;">
              Validar Voucher
            </a>
          </td>
        </tr>

        <!-- Footer -->
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

      
      // Assumindo que a função sendEmail está configurada corretamente com SMTP_USER/PASS
      await sendEmail({
        to: email,
        subject: 'Seu voucher VoucherHub',
        html
      });

    } catch (err) {
      console.error('[voucher] creation/email failed', err);
    }
  }

  res.json({ received: true });
});

export default router;