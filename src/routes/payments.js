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
    event = stripe.webhooks.constructEvent(req.rawBody, sig, whSecret);
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

      await pool.query(
        `INSERT INTO vouchers (email, partner_slug, code, amount_cents, currency, stripe_session_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, partnerSlug, code, amountCents, currency, session.id]
      );

      // Send email
      const productName = session?.display_items?.[0]?.custom?.name || 'Voucher VoucherHub';
      const html = `
        <div style="font-family:Arial,sans-serif">
          <h1>O seu voucher chegou 🎉</h1>
          <p>Obrigado pela sua compra!</p>
          <p><b>Parceiro:</b> ${partnerSlug}</p>
          <p><b>Produto:</b> ${productName}</p>
          <p><b>Código do Voucher:</b> <code style="font-size:18px">${code}</code></p>
          <p><b>Valor pago:</b> ${(amountCents/100).toFixed(2)} ${currency.toUpperCase()}</p>
          <hr/>
          <p>Guarde este e-mail. Utilize o voucher conforme as instruções na página do parceiro.</p>
          <p>Em caso de dúvida, responda a este e-mail.</p>
        </div>
      `;
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
