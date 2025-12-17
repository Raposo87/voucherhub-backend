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
// 🚀 ROTA DE AUTO-ONBOARDING (DEBUG VERSION)
// =============================================================
app.get('/api/admin/onboard/:slug', async (req, res) => {
  const { slug } = req.params;
  console.log(`[ONBOARDING] Recebida tentativa para o slug: ${slug}`);

  try {
    const result = await pool.query(
      'SELECT email, stripe_account_id FROM partners WHERE slug = $1', 
      [slug]
    );
    
    if (result.rows.length === 0) {
      console.log(`[ONBOARDING] Erro: Slug ${slug} não encontrado no banco.`);
      return res.status(404).send("❌ Parceiro não encontrado no banco de dados.");
    }

    let { email, stripe_account_id } = result.rows[0];
    console.log(`[ONBOARDING] Parceiro encontrado: ${email}, ID Stripe Atual: ${stripe_account_id}`);

    if (!stripe_account_id) {
      console.log(`[ONBOARDING] Criando nova conta Express no Stripe para ${email}...`);
      const account = await stripe.accounts.create({
        type: 'express',
        email: email,
        capabilities: { transfers: { requested: true } },
      });
      stripe_account_id = account.id;
      
      await pool.query('UPDATE partners SET stripe_account_id = $1 WHERE slug = $2', [stripe_account_id, slug]);
      console.log(`[ONBOARDING] Nova conta criada e salva: ${stripe_account_id}`);
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripe_account_id,
      refresh_url: `https://modest-comfort-production.up.railway.app/api/admin/onboard/${slug}`, 
      return_url: 'https://voucherhub.pt',
      type: 'account_onboarding',
    });

    console.log(`[ONBOARDING] Redirecionando utilizador para o Stripe...`);
    return res.redirect(accountLink.url);

  } catch (error) {
    console.error("[ONBOARDING] ERRO CRÍTICO:", error);
    res.status(500).send("Erro interno ao processar Stripe: " + error.message);
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