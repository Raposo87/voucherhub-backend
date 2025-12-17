import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import 'dotenv/config.js';
import Stripe from 'stripe'; // 1. NOVO: Import da SDK da Stripe

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import partnersRouter from './routes/partners.js';
import { initDb, pool } from './db.js'; // 2. ALTERADO: Adicionado 'pool'

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); // 3. NOVO: Inicialização da Stripe

// =============================================================
// 1️⃣ CORS
// =============================================================
const allowedOrigins = [
  'https://modest-comfort-production.up.railway.app',
  'https://voucherhub.pt',
  'https://www.voucherhub.pt',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

app.use(cors({ origin: allowedOrigins }));

// =============================================================
// 2️⃣ WEBHOOK DA STRIPE — MANTIDO EXATAMENTE COMO ESTAVA
// =============================================================
const stripeWebhook = paymentsRouter.stack
  .find(r => r.route?.path === "/webhook" && r.route.methods.post)
  .route.stack[0].handle;

app.post(
  "/api/payments/webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhook
);

// =============================================================
// 3️⃣ MIDDLEWARES E ROTAS PADRÃO
// =============================================================
app.use(express.json());

app.use('/api/payments', paymentsRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/partners', partnersRouter);

// =============================================================
// 🚀 4. NOVO: ROTA DE AUTO-ONBOARDING (Gera link do Stripe)
// =============================================================
app.get('/api/admin/onboard/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    // Busca dados no banco (que foram inseridos pelo sync-partners.js)
    const result = await pool.query(
      'SELECT email, stripe_account_id FROM partners WHERE slug = $1', 
      [slug]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send("❌ Parceiro não encontrado. Primeiro adicione ao JSON e rode o sync-partners.js.");
    }

    const { email, stripe_account_id } = result.rows[0];

    let accountId = stripe_account_id;

    // Se o parceiro ainda não tem conta Stripe, cria agora
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: email,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;
      
      await pool.query('UPDATE partners SET stripe_account_id = $1 WHERE slug = $2', [accountId, slug]);
      console.log(`✅ Conta Stripe criada e salva no banco: ${accountId}`);
    }

    // Gera o link de onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${req.protocol}://${req.get('host')}/api/admin/onboard/${slug}`, 
      return_url: 'https://voucherhub.pt',
      type: 'account_onboarding',
    });

    // Redireciona para o cadastro do Stripe
    res.redirect(accountLink.url);

  } catch (error) {
    console.error("Erro no Onboarding:", error);
    res.status(500).send("Erro ao processar: " + error.message);
  }
});

// =============================================================
// HEALTH & START
// =============================================================
app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, async () => {
  console.log(`🚀 Server running on port ${port}`);
  await initDb();
});