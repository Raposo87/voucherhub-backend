import { Router } from 'express';
import Stripe from 'stripe';
import { pool } from '../db.js';
import { sendEmail } from '../utils/sendEmail.js';
import { randomBytes } from 'crypto';
import fs from 'fs';

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
      const expFile = JSON.parse(fs.readFileSync('./experiences.json', 'utf8'));

      let partnerData = null;

      for (const mode of expFile.modes) {
        const found = mode.partners?.find(p => p.slug === partnerSlug);
        if (found) {
          partnerData = found;
          break;
        }
      }
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

      const originalPrice = partnerData.price_original || "";
      const discountPrice = partnerData.price_discount || "";
      const discountLabel = partnerData.discount_label || "";
      const savings = partnerData.savings || "";
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 20);
      
      const html = `
      <div style="max-width:600px;margin:auto;font-family:Arial;background:#f8f9fa;padding:20px;border-radius:10px">
      
        <div style="text-align:center;padding:20px;background:#234;width:100%;border-radius:10px 10px 0 0;color:white">
          <h2 style="margin:0">🎉 O seu Voucher chegou!</h2>
        </div>
      
        <p>Obrigado por adquirir uma experiência com <strong>${partnerData.name}</strong> através da VoucherHub.</p>
      
        <div style="background:#eef3ff;padding:15px;border-radius:8px;margin-bottom:20px">
          <p><strong>Código do Voucher:</strong><br>
          <span style="font-size:22px;font-weight:bold;color:#2c4cff">${code}</span></p>
      
          <p><strong>Valor pago:</strong> €${(amountCents/100).toFixed(2)}</p>
          <p><strong>Preço original:</strong> ${originalPrice}</p>
          <p><strong>Desconto:</strong> ${discountLabel}</p>
          <p><strong>Você economizou:</strong> ${savings}</p>
          
          <p><strong>Parceiro:</strong> ${partnerData.name}</p>
          <p><strong>Endereço:</strong> ${partnerData.location}</p>
          <p><strong>Email:</strong> ${partnerData.email || '—'}</p>
          <p><strong>Telefone:</strong> ${partnerData.phone || '—'}</p>
      
          <p><strong>Validade:</strong> Até ${expirationDate.toLocaleDateString('pt-PT')}<br>
          (Voucher válido por 20 dias corridos. Após esse período o voucher estará expirado.)</p>
        </div>
      
        <div style="text-align:center;margin:20px 0">
          <img src="${qrCodeImage}" style="width:250px;height:250px">
        </div>
      
        <p style="text-align:center">
          Aponte a câmara ou clique no QR Code para validar o voucher
        </p>
      
        <div style="text-align:center;margin-top:15px">
          <a href="${process.env.FRONTEND_URL}/validate?code=${code}"
             style="background:#ff7a00;color:white;padding:12px 20px;border-radius:8px;
             text-decoration:none;font-size:18px;font-weight:bold;display:inline-block">
             Validar Voucher
          </a>
        </div>
      
        <p style="text-align:center;margin-top:40px;font-size:12px;color:#777">
          VoucherHub © ${new Date().getFullYear()} — Todos os direitos reservados.
        </p>
      </div>
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