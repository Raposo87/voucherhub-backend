# VoucherHub Backend (Node.js + Express + Stripe + PostgreSQL)

Backend simples para processar pagamentos de vouchers via Stripe, emitir código de voucher e enviar e-mail automático.

## 1) Requisitos
- Node.js 18+
- Conta Stripe (chave secreta + webhook)
- Banco PostgreSQL (Railway recomendado)
- Credenciais SMTP (SendGrid/Resend/Outro) para envio de e-mails

## 2) Configuração local
```bash
cp .env.example .env
# Edite .env com suas chaves
npm install
npm run dev
```

Endpoints:
- `POST /api/payments/create-checkout-session`
- `POST /api/payments/webhook` (Stripe chama)
- `GET /api/vouchers/:code`
- `GET /health`

## 3) Deploy no Railway (passo a passo)
1. Crie um novo **project** no Railway.
2. Adicione um **PostgreSQL** (Add Plugin → PostgreSQL).
3. **Deploy** este repo (GitHub ou upload).
4. Em **Variables**, configure:
   - `PORT=3000` (Railway injeta, mas deixe)
   - `DATABASE_URL` (use o valor do plugin PostgreSQL)
   - `PGSSLMODE=require`
   - `STRIPE_SECRET_KEY=...`
   - `STRIPE_WEBHOOK_SECRET=...` (depois de criar o webhook no painel Stripe)
   - `FRONTEND_URL=https://seu-dominio-frontend`
   - SMTP:
     - `SMTP_HOST=...`
     - `SMTP_PORT=587`
     - `SMTP_USER=...`
     - `SMTP_PASS=...`
     - `SMTP_FROM="VoucherHub <no-reply@seu-dominio.com>"`
5. Em **Deploys**, verifique os logs até ver `listening on port`.

## 4) Stripe (passos)
- Crie um **produto** (opcional) ou deixe dinâmico como no código.
- Em **Developers → Webhooks**, adicione endpoint:
  - URL: `https://SEU_BACKEND_URL/api/payments/webhook`
  - Evento: `checkout.session.completed`
  - Copie o `Signing secret` e coloque em `STRIPE_WEBHOOK_SECRET` nas variáveis.

## 5) Frontend (integração rápida)
Exemplo JS no botão “Adquirir Voucher Agora”:
```js
// Substitua estes com os dados reais do parceiro/experiência
const amountCents = 2550; // €25,50
const productName = 'Voucher Surf Wave Lisbon';
const partnerSlug = 'surf-wave-lisbon';
const email = prompt('Qual o seu e-mail para receber o voucher?');

const res = await fetch('https://SEU_BACKEND_URL/api/payments/create-checkout-session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, partnerSlug, productName, amountCents })
});
const data = await res.json();
window.location.href = data.url;
```

## 6) Segurança
- O webhook do Stripe usa **verificação de assinatura**.
- A rota de criação de sessão só aceita campos que precisamos.
- Considere adicionar **Rate Limiting** e **CSP** em produção.

## 7) SQL manual (opcional)
Se precisar criar a tabela manualmente:
```sql
\i schema.sql
```

---
Feito com ❤️ para o VoucherHub.
