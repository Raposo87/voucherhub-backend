import express from 'express';
import bodyParser from 'body-parser';
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

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }
  next();
});

// ✅ Health check
app.get('/health', (req, res) => res.status(200).json({ ok: true }));

// ⚙️ Usa raw body apenas no webhook Stripe
// ESTA PARTE É O QUE GARANTE QUE O req.body NO WEHOOK CONTÉM O BUFFER RAW.
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