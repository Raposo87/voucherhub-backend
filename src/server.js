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
