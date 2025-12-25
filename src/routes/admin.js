import express from 'express';
import { pool } from '../db.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Nova rota de teste: POST /api/admin/setup-partner
router.post('/setup-partner', async (req, res) => {
  const { 
    slug, 
    name, 
    email, 
    phone, 
    location, 
    price_cents, 
    pin 
  } = req.body;

  try {
    console.log(`[Admin] Iniciando setup para: ${slug}`);

    // 1. Criar a conta na Stripe (Express)
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      capabilities: {
        transfers: { requested: true },
      },
    });

    // 2. Inserir no Banco de Dados da Railway
    // Usando a mesma lógica do seu migrate-partners.js
    await pool.query(`
      INSERT INTO partners (
        slug, name, email, phone, location, 
        price_original_cents, voucher_validity_days, pin, stripe_account_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (slug) DO UPDATE SET 
        stripe_account_id = EXCLUDED.stripe_account_id,
        name = EXCLUDED.name,
        email = EXCLUDED.email;
    `, [
      slug, 
      name, 
      email, 
      phone, 
      location, 
      price_cents || 0, 
      60, // voucher_validity_days padrão
      pin, 
      account.id
    ]);

    // 3. Gerar o link de Onboarding para enviar ao parceiro
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'https://voucherhub.pt/admin/retry', // URLs de exemplo
      return_url: 'https://voucherhub.pt/admin/success',
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      message: "Parceiro criado com sucesso!",
      partner: {
        slug,
        stripe_id: account.id,
        onboarding_url: accountLink.url
      }
    });

  } catch (error) {
    console.error('[Admin Error]:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;