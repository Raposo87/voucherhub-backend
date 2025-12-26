# VoucherHub Backend — Mapa Completo

Este repositório contém o backend do VoucherHub: um serviço Node.js/Express que cria, vende e valida vouchers usando Stripe e armazena dados em PostgreSQL. Também envia e-mails (Resend) para notificações.

**Sumário rápido**

- Linguagem: Node.js (ES modules)
- Framework: Express
- Pagamentos: Stripe (Checkout + Webhooks + Transfers)
- DB: PostgreSQL
- E-mail: Resend (via `src/utils/sendEmail.js`)

## Estrutura do projeto

```
voucherhub-backend/
├── src/
│   ├── server.js                # Inicializa Express, CORS, rotas e health
│   ├── db.js                    # Pool Postgres + initDb()
│   ├── routes/
│   │   ├── payments.js          # Cria sessões Stripe, webhook
│   │   └── vouchers.js          # Validação e uso de vouchers
│   └── utils/
│       └── sendEmail.js         # Envio de e-mail via Resend
├── scripts/                     # Migrações e geradores CSV
├── sponsor-vouchers-*.csv       # CSVs gerados/importáveis
├── schema.sql                   # Esquema inicial (opcional)
├── package.json
└── README.md
```

## Arquivos/chaves importantes

- `src/server.js`: configura `express`, `cors`, rotas e `GET /health`.
- `src/db.js`: exporta `pool` e `initDb()` que cria a tabela `vouchers`, adiciona colunas ausentes e cria índices (`idx_vouchers_status`, `idx_vouchers_partner_status`).
- `src/routes/payments.js`: endpoints `POST /api/payments/create-checkout-session` e `POST /api/payments/webhook`.
- `src/routes/vouchers.js`: endpoint `POST /api/vouchers/validate` (validação e transferências para partner).
- `src/utils/sendEmail.js`: função `sendEmail(to, subject, html)` que usa Resend API.

## Banco de dados (resumo)

Tabela `vouchers` (criada/atualizada por `initDb()` / `scripts/migrate.js`):

| Coluna                | Tipo                                  | Observações                       |
| --------------------- | ------------------------------------- | --------------------------------- |
| `id`                  | SERIAL PRIMARY KEY                    |                                   |
| `email`               | VARCHAR(255) NOT NULL                 | comprador / receptor              |
| `partner_slug`        | VARCHAR(100) NOT NULL                 | identificador do parceiro         |
| `code`                | VARCHAR(64) UNIQUE                    | código do voucher                 |
| `amount_cents`        | INTEGER                               | valor em centavos                 |
| `currency`            | VARCHAR(10) DEFAULT 'eur'             |                                   |
| `stripe_session_id`   | VARCHAR(255) UNIQUE                   | session id do Checkout            |
| `status`              | VARCHAR(20) NOT NULL DEFAULT 'active' | `active`, `used`, `expired`, etc. |
| `used_at`             | TIMESTAMP NULL                        | quando foi usado                  |
| `expires_at`          | TIMESTAMP NULL                        | quando expira                     |
| `platform_fee_cents`  | INTEGER                               | taxa da plataforma                |
| `partner_share_cents` | INTEGER                               | parcela do parceiro               |
| `created_at`          | TIMESTAMP DEFAULT NOW()               |                                   |

Outras tabelas esperadas (via scripts): `partners` (slug, name, stripe_account_id, commission_percentage) e `sponsor_vouchers` (code, sponsor, discount_extra).

## Endpoints Principais

- `POST /api/payments/create-checkout-session`

  - Cria uma Checkout Session Stripe, aplica `sponsorCode` (opcional), grava voucher (associado à session) e retorna `url` da sessão.
  - Campos usados: `email`, `partnerSlug`, `amountCents`, `currency`, `platformFeeCents`, `partnerShareCents`, `sponsorCode`.

- `POST /api/payments/webhook`

  - Processa eventos Stripe (ex.: `checkout.session.completed`), valida assinatura (`STRIPE_WEBHOOK_SECRET`) e ativa voucher.

- `POST /api/vouchers/validate`

  - Valida `code`, verifica `status` e `expires_at`, cria `transfer` Stripe para `partners.stripe_account_id`, marca voucher como `used` e registra `used_at`.

- `GET /health`
  - Health check simples.

## CSV `sponsor-vouchers-*.csv`

- Formato: `code;sponsor;discount_extra;created_at` (separador `;`).
- Exemplo: `BANC-4CCC06;BANCO_X;5;2025-11-23T12:23:09.054Z`.
- Uso: `scripts/generate-sponsor-vouchers.js` cria e exporta estes arquivos; podem ser importados em `sponsor_vouchers` (via script ou `psql \copy`).

## Variáveis de ambiente (essenciais)

- `DATABASE_URL` — string de conexão Postgres
- `PGSSLMODE` — `require` para produção (o `db.js` ativa ssl se `PGSSLMODE=require` ou NODE_ENV=production)
- `STRIPE_SECRET_KEY` — chave secreta Stripe
- `STRIPE_WEBHOOK_SECRET` — signing secret do webhook
- `RESEND_API_KEY` — API key do Resend
- `RESEND_FROM_EMAIL` — remetente padrão
- `PORT`, `NODE_ENV`, `FRONTEND_URL` (CORS)

## Scripts úteis

- `node scripts/migrate.js` — cria/atualiza tabela `vouchers` e índices.
- `node scripts/migrate-partners.js` — cria/atualiza tabela `partners`.
- `node scripts/migrate-sponsor-vouchers.js` — cria tabela `sponsor_vouchers`.
- `node scripts/generate-sponsor-vouchers.js` — gera e exporta CSV de sponsor vouchers.
- `node add-stripe-column.js` / `node update-stripe-id.js` — operações pontuais em `partners`.

## Como rodar localmente

1. Copie o `.env` e preencha variáveis necessárias.

```powershell
npm install
node scripts/migrate.js
node scripts/migrate-partners.js
node scripts/migrate-sponsor-vouchers.js
# (opcional) node scripts/generate-sponsor-vouchers.js
npm start
```

Verifique `GET /health` para confirmar que o servidor está vivo.

## Fluxo de compra e resgate (resumido)

1. Cliente chama `create-checkout-session` → recebe `url` do Stripe.
2. Pagamento concluído no Stripe → webhook `checkout.session.completed` ativa voucher.
3. Parceiro/PDV chama `POST /api/vouchers/validate` com `code`.
4. Backend valida, transfere fundos ao parceiro (Stripe Connect), marca voucher `used` e envia e-mail.

## Observações e sugestões

- Use `psql \copy` para importar CSVs grandes para `sponsor_vouchers` por performance.
- Adicione testes unitários para `payments.js` e `vouchers.js` (mock de Stripe).
- Considere um job cron para expirar vouchers e relatórios administrativos por parceiro.


## URL mostra como esta o andamento dos pagamentos via stripe dos vouchers validados:

https://voucherhub-backend-production.up.railway.app/api/admin/audit-transfers

---


