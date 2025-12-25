import express from 'express';
import { pool } from '../db.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Função para gerar PIN de 4 dígitos
const generatePIN = () => Math.floor(1000 + Math.random() * 9000).toString();

router.post('/setup-partner', async (req, res) => {
  const { slug, name, email, phone, location, price_cents } = req.body;
  
  // GERAÇÃO AUTOMÁTICA DO PIN
  const autoPin = generatePIN();

  try {
    // 1. Criar conta na Stripe
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
    });

    // 2. Salvar na Railway (Note que o 'pin' vem da variável autoPin)
    await pool.query(`
      INSERT INTO partners (
        slug, name, email, phone, location, 
        price_original_cents, voucher_validity_days, pin, stripe_account_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (slug) DO UPDATE SET stripe_account_id = EXCLUDED.stripe_account_id;
    `, [slug, name, email, phone, location, price_cents || 0, 60, autoPin, account.id]);

    // 3. Link da Stripe
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'https://voucherhub.pt', 
      return_url: 'https://voucherhub.pt',
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      pin_gerado: autoPin, // Retorna o PIN para você ver qual foi
      onboarding_url: accountLink.url
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;