import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import 'dotenv/config.js';

import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import { initDb } from './db.js';

const app = express();

// 🌐 CONFIGURAÇÃO CORS CORRETA:
// Lista de origens permitidas (inclui seu ambiente local de desenvolvimento atual)
const allowedOrigins = [
  'https://modest-comfort-production.up.railway.app',
  'https://voucherhub.pt',
  'https://www.voucherhub.pt',
  'http://localhost:3000',
  'http://localhost:5500', // <-- ADICIONADO: URL comum para Live Server
  'http://127.0.0.1:5500' // <-- ADICIONADO: URL exata do seu erro
];

// Configure as opções do CORS
const corsOptions = {
    origin: allowedOrigins, // Usa a lista de origens que você já definiu
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
};

// Aplica o middleware CORS ANTES DE QUALQUER ROTA
app.use(cors(corsOptions));

// --- O RESTO DO SEU CÓDIGO PERMANECE O MESMO ---

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