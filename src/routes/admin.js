import express from 'express';
import { pool } from '../db.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Função para gerar PIN de 4 dígitos aleatórios
const generatePIN = () => Math.floor(1000 + Math.random() * 9000).toString();

router.post('/setup-partner', async (req, res) => {
  const { 
    slug, 
    name, 
    email, 
    phone, 
    location, 
    price_cents, 
    password // Senha vinda do formulário
  } = req.body;

  // 1. Verificação de segurança simples
  // Substitua 'SUA_SENHA_AQUI' pela senha que desejar
  if (password !== 'VoucherHub2025') {
    return res.status(401).json({ 
      success: false, 
      error: "Acesso negado: Senha de administrador incorreta." 
    });
  }

  // GERAÇÃO AUTOMÁTICA DO PIN
  const autoPin = generatePIN();

  try {
    console.log(`[Admin] Iniciando criação do parceiro: ${name} (${slug})`);

    // 2. Criar conta na Stripe (Connect Express)
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      capabilities: {
        transfers: { requested: true },
      },
    });

    // 3. Salvar na Railway com as 9 colunas
    await pool.query(`
      INSERT INTO partners (
        slug, 
        name, 
        email, 
        phone, 
        location, 
        price_original_cents, 
        voucher_validity_days, 
        pin, 
        stripe_account_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (slug) DO UPDATE SET 
        stripe_account_id = EXCLUDED.stripe_account_id,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location,
        price_original_cents = EXCLUDED.price_original_cents;
    `, [
      slug, 
      name, 
      email, 
      phone || '', 
      location || '', 
      price_cents || 0, 
      60,       // voucher_validity_days padrão
      autoPin,  // PIN gerado automaticamente
      account.id // ID vindo da Stripe
    ]);

    // 4. Gerar link de Onboarding da Stripe para o parceiro completar o cadastro
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'https://voucherhub.pt', 
      return_url: 'https://voucherhub.pt',
      type: 'account_onboarding',
    });

    // Resposta final para o seu formulário HTML
    res.json({
      success: true,
      message: "Parceiro cadastrado com sucesso!",
      pin_gerado: autoPin,
      stripe_id: account.id,
      onboarding_url: accountLink.url
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