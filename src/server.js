import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import 'dotenv/config.js';

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import partnersRouter from './routes/partners.js';
import { initDb } from './db.js';

const app = express();

// 🌐 CONFIGURAÇÃO CORS CORRETA
const allowedOrigins = [
  'https://modest-comfort-production.up.railway.app',
  'https://voucherhub.pt',
  'https://www.voucherhub.pt',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

const corsOptions = {
  origin: allowedOrigins,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  credentials: true,
};

// CORS deve vir ANTES de qualquer rota
app.use(cors(corsOptions));


// =============================================================
// 1️⃣ JSON NORMAL PARA TODAS AS ROTAS EXCETO WEBHOOK
// =============================================================
app.use(express.json());

// =============================================================
// 2️⃣ ROTAS NORMAIS DO BACKEND (payments, vouchers, partners)
// =============================================================
app.use('/api/payments', paymentsRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/partners', partnersRouter);


// =============================================================
// 3️⃣ WEBHOOK STRIPE (usa RAW BODY → TEM QUE VIR DEPOIS DAS ROTAS NORMAIS!)
// =============================================================
app.use(
  '/api/payments/webhook',
  bodyParser.raw({ type: 'application/json' })
);


// =============================================================
// HEALTH CHECK
// =============================================================
app.get('/health', (req, res) => res.status(200).json({ ok: true }));


// =============================================================
// START SERVER
// =============================================================
const port = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`✅ VoucherHub backend listening on port ${port}`);
      console.log('🌐 CORS liberado para:', allowedOrigins.join(', '));
    });
  })
  .catch((err) => {
    console.error('❌ Failed to init DB', err);
    process.exit(1);
  });
