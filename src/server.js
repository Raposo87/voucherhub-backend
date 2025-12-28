import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import 'dotenv/config.js';
import helmet from 'helmet';

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import partnersRouter from './routes/partners.js';
import { initDb } from './db.js';
import adminRouter from './routes/admin.js';


const app = express();

// =============================================================
// 0️⃣ SEGURANÇA (HELMET) - Resolve HSTS, XSS, Clickjacking
// =============================================================
app.use(helmet({
  contentSecurityPolicy: false, // Mantemos false para não bloquear as imagens do Cloudinary/Google Fonts por agora
  crossOriginResourcePolicy: { policy: "cross-origin" } // Permite carregar recursos de diferentes domínios
}));

// Configuração específica para HSTS (Obrigatório para nota máxima no relatório)
app.use(helmet.hsts({
  maxAge: 31536000,        // 1 ano
  includeSubDomains: true, 
  preload: true
}));

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

// Rota de Analytics - Captura o que as pessoas pesquisam
app.post('/api/analytics/search', async (req, res) => {
  const { term, count, city, country, device } = req.body;

  try {
    // Insere os dados na tabela que acabamos de criar via migração
    await pool.query(
      `INSERT INTO search_analytics 
       (search_term, results_found, city, country, device_type) 
       VALUES ($1, $2, $3, $4, $5)`,
      [term, count, city, country, device]
    );

    res.status(201).json({ success: true, message: 'Busca registrada com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao gravar analytics de busca:', err);
    res.status(500).json({ error: 'Erro interno ao salvar dados' });
  }
});