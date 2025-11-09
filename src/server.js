import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import paymentsRouter from './routes/payments.js';
import vouchersRouter from './routes/vouchers.js';
import { initDb } from './db.js';

const app = express();

// === 🌐 Configuração de CORS ===
const allowedOrigins = [
  'https://modest-comfort-production.up.railway.app', // ✅ frontend no Railway
  'http://localhost:3000' // ✅ ambiente local de desenvolvimento
];

app.use(cors({
  origin: (origin, callback) => {
    // Permite chamadas sem origem (Postman, servidor interno) ou de domínios permitidos
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

// ✅ Health check no topo
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// ⚙️ Middleware especial para webhooks do Stripe (mantido como estava)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/payments/webhook')) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      req.rawBody = data;
      next();
    });
  } else {
    next();
  }
});

// 🧠 Middleware padrão
app.use(express.json());

// 🧭 Rotas principais
app.use('/api/payments', paymentsRouter);
app.use('/api/vouchers', vouchersRouter);

// 🚀 Inicialização do servidor
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
