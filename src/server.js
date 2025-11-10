import express from 'express';
import bodyParser from 'body-parser'; // <— adiciona esta importação
import cors from 'cors';
import 'dotenv/config.js';

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import { initDb } from './db.js';

const app = express();

// 🌐 CORS
const allowedOrigins = [
  'https://modest-comfort-production.up.railway.app',
  'https://voucherhub.pt',
  'https://www.voucherhub.pt',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('🚫 Bloqueado por CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ✅ Health check
app.get('/health', (req, res) => res.status(200).json({ ok: true }));

// ⚙️ Usa raw body apenas no webhook Stripe
app.use(
  '/api/payments/webhook',
  bodyParser.raw({ type: 'application/json' })
);

// 🧠 Para o resto, usa JSON normal
app.use(express.json());

// 🧭 Rotas
app.use('/api/payments', paymentsRouter);
app.use('/api/vouchers', vouchersRouter);

// 🚀 Inicialização
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
