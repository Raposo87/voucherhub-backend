import express from 'express';
import bodyParser from 'body-parser'; // Mantenha o import do bodyParser
import cors from 'cors';
import 'dotenv/config.js';

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import partnersRouter from './routes/partners.js';
import { initDb } from './db.js';

const app = express();

// ... (Configuração CORS e allowedOrigins inalteradas) ...
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://voucherhub.pt",
  "https://www.voucherhub.pt",
  "https://voucherhub-backend-production.up.railway.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requests sem origin (ex: Stripe Webhooks)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log("❌ CORS bloqueado para:", origin);
      return callback(new Error("CORS not allowed"), false);
    }
  },
  credentials: true,
};


// CORS deve vir ANTES de qualquer rota
app.use(cors(corsOptions));


// =============================================================
// 2️⃣ JSON NORMAL PARA TODAS AS OUTRAS ROTAS
// =============================================================
// O corpo JSON será analisado AQUI para TODAS as outras rotas (ex: /create-checkout-session)
app.use(express.json());


// =============================================================
// 3️⃣ ROTAS NORMAIS DO BACKEND
// =============================================================
app.use('/api/payments', paymentsRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/partners', partnersRouter);


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
