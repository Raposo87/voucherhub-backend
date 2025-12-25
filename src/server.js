import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import 'dotenv/config.js';

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import partnersRouter from './routes/partners.js';
import { initDb } from './db.js';
import adminRouter from './routes/admin.js';

const app = express();

// =============================================================
// 1️⃣ CORS
// =============================================================
const allowedOrigins = [
  'https://modest-comfort-production.up.railway.app',
  'https://voucherhub.pt',
  'https://www.voucherhub.pt',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'null'
];

app.use(cors({ origin: allowedOrigins }));

// =============================================================
// 2️⃣ WEBHOOK DA STRIPE — TEM QUE VIR ***ANTES DE express.json()***
// =============================================================

// Encontrar rota exata dentro do paymentsRouter
const stripeWebhook = paymentsRouter.stack
  .find(r => r.route?.path === "/webhook" && r.route.methods.post)
  .route.stack[0].handle;

app.post(
  "/api/payments/webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhook
);

// =============================================================
// 3️⃣ DEMO MAIS TODAS AS OUTRAS ROTAS
// =============================================================
app.use(express.json());

app.use('/api/payments', paymentsRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/partners', partnersRouter);
app.use('/api/admin', adminRouter);

// =============================================================
// HEALTH
// =============================================================
app.get('/health', (req, res) => res.json({ ok: true }));

// =============================================================
// START
// =============================================================
const port = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Backend ok na porta ${port}`);
  });
});