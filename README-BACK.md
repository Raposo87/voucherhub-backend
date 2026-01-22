# VoucherHub Backend — Documentação Completa

Este repositório contém o backend completo do **VoucherHub**: uma plataforma de vouchers que permite compra, validação e repasse automático de fundos para parceiros usando Stripe Connect e escrow.

## 📋 Sumário

- [Visão Geral](#visão-geral)
- [Tecnologias](#tecnologias)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Banco de Dados](#banco-de-dados)
- [Endpoints](#endpoints)
- [Sistema de Pagamentos](#sistema-de-pagamentos)
- [Sistema de Validação](#sistema-de-validação)
- [Sistema de Parceiros](#sistema-de-parceiros)
- [Sistema de Estoque](#sistema-de-estoque)
- [Sistema de Analytics](#sistema-de-analytics)
- [Scripts e Migrações](#scripts-e-migrações)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Segurança](#segurança)
- [Deploy](#deploy)
- [Fluxos Completos](#fluxos-completos)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

O VoucherHub Backend é uma API REST construída em Node.js/Express que gerencia:

- ✅ **Compra de vouchers** via Stripe Checkout
- ✅ **Validação de vouchers** com PIN de segurança
- ✅ **Repasse automático** de fundos para parceiros (Stripe Connect)
- ✅ **Sistema de escrow** (fundos retidos até validação)
- ✅ **Gestão de parceiros** e onboarding Stripe
- ✅ **Controle de estoque** por oferta
- ✅ **Códigos promocionais** (sponsor vouchers)
- ✅ **Analytics** de buscas
- ✅ **Notificações por email** via Resend

---

## 🛠 Tecnologias

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **Node.js** | ES Modules | Runtime |
| **Express** | ^4.19.2 | Framework web |
| **PostgreSQL** | - | Banco de dados |
| **Stripe** | ^16.6.0 | Pagamentos, webhooks, transfers |
| **Resend** | - | Envio de emails |
| **Helmet** | ^8.1.0 | Segurança HTTP |
| **CORS** | ^2.8.5 | Cross-origin requests |
| **dotenv** | ^16.5.0 | Variáveis de ambiente |
| **pg** | ^8.11.5 | Cliente PostgreSQL |

---

## 📁 Estrutura do Projeto

```
voucherhub-backend/
├── src/
│   ├── server.js                    # Inicialização Express, CORS, rotas, health
│   ├── db.js                        # Pool PostgreSQL + initDb()
│   ├── setup-db.js                  # Setup inicial do banco (opcional)
│   ├── routes/
│   │   ├── payments.js              # Checkout sessions, webhooks, emails
│   │   ├── vouchers.js              # Validação e transferências
│   │   ├── partners.js              # Onboarding Stripe Connect
│   │   └── admin.js                 # Gestão de parceiros e estoque
│   └── utils/
│       └── sendEmail.js             # Utilitário de email (Resend)
├── scripts/
│   ├── migrate.js                   # Migração tabela vouchers + índices
│   ├── migrate-partners.js          # Migração tabela partners
│   ├── migrate-sponsor-vouchers.js  # Migração tabela sponsor_vouchers
│   ├── generate-sponsor-vouchers.js # Gera CSVs de sponsor vouchers
│   ├── import-sponsor-vouchers.js   # Importa CSVs para DB
│   ├── replace-sponsor-prefix.js    # Substitui prefixos de sponsor codes
│   ├── update-csv-prefix.js         # Atualiza prefixos em CSV
│   ├── update-prefix-in-db.js       # Atualiza prefixos no DB
│   ├── update-validity-to-8months.js # Atualiza validade para 8 meses
│   ├── check-transfers-status.js    # Verifica status de transferências
│   └── delete-stripe-account.js     # Deleta conta Stripe
├── sponsor-vouchers-*.csv           # CSVs de sponsor vouchers
├── schema.sql                       # Esquema SQL inicial (referência)
├── package.json
├── .env.example                     # Exemplo de variáveis de ambiente
└── README-BACK.md                   # Esta documentação
```

---

## 🗄 Banco de Dados

### Tabela: `vouchers`

Armazena todos os vouchers criados, seus status e informações de pagamento.

| Coluna | Tipo | Observações |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | ID único |
| `email` | VARCHAR(255) NOT NULL | Email do comprador |
| `partner_slug` | VARCHAR(100) NOT NULL | Slug do parceiro |
| `code` | VARCHAR(64) UNIQUE NOT NULL | Código do voucher (ex: VH-XXXXX) |
| `offer_title` | VARCHAR(255) | Nome da oferta/produto |
| `amount_cents` | INTEGER | Valor total em centavos |
| `currency` | VARCHAR(10) DEFAULT 'eur' | Moeda (EUR) |
| `stripe_session_id` | VARCHAR(255) UNIQUE | ID da sessão Stripe Checkout |
| `stripe_payment_intent_id` | VARCHAR(255) | ID do Payment Intent Stripe |
| `stripe_transfer_id` | VARCHAR(50) | ID da transferência Stripe (se aplicável) |
| `status` | VARCHAR(20) NOT NULL DEFAULT 'active' | `active`, `valid`, `used`, `expired` |
| `used_at` | TIMESTAMP NULL | Data/hora de uso |
| `expires_at` | TIMESTAMP NULL | Data de expiração |
| `platform_fee_cents` | INTEGER | Taxa da plataforma em centavos |
| `partner_share_cents` | INTEGER | Valor repassado ao parceiro |
| `transfer_status` | VARCHAR(50) DEFAULT 'pending' | `pending`, `success`, `failed:stripe_error`, `failed:no_stripe_account` |
| `transfer_error_msg` | TEXT | Mensagem de erro (se houver) |
| `created_at` | TIMESTAMP DEFAULT NOW() | Data de criação |

**Índices:**
- `idx_vouchers_status` - Busca por status
- `idx_vouchers_partner_status` - Busca por parceiro e status
- `idx_vouchers_transfer_status` - Busca por status de transferência

---

### Tabela: `partners`

Armazena informações dos parceiros e suas contas Stripe Connect.

| Coluna | Tipo | Observações |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | ID único |
| `slug` | VARCHAR(100) UNIQUE NOT NULL | Slug único do parceiro |
| `name` | VARCHAR(255) NOT NULL | Nome do parceiro |
| `email` | VARCHAR(255) | Email do parceiro |
| `phone` | VARCHAR(50) | Telefone |
| `location` | VARCHAR(255) | Localização/endereço |
| `price_original_cents` | INTEGER | Preço original em centavos |
| `voucher_validity_days` | INTEGER DEFAULT 240 | Validade dos vouchers em dias (padrão: 8 meses) |
| `pin` | VARCHAR(10) NOT NULL | PIN de validação (4 dígitos) |
| `stripe_account_id` | VARCHAR(255) | ID da conta Stripe Connect |
| `created_at` | TIMESTAMP DEFAULT NOW() | Data de criação |

---

### Tabela: `sponsor_vouchers`

Armazena códigos promocionais (sponsor codes) que oferecem desconto extra.

| Coluna | Tipo | Observações |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | ID único |
| `code` | VARCHAR(30) UNIQUE NOT NULL | Código promocional (ex: BANC-XXXXX) |
| `sponsor` | VARCHAR(50) NOT NULL | Nome do patrocinador |
| `discount_extra` | INTEGER NOT NULL | Desconto extra em % (ex: 5 = 5%) |
| `used` | BOOLEAN DEFAULT FALSE | Se foi usado |
| `used_at` | TIMESTAMP NULL | Data de uso |
| `created_at` | TIMESTAMP DEFAULT NOW() | Data de criação |
| `expires_at` | TIMESTAMP NULL | Data de expiração (opcional) |

**Índices:**
- `idx_sponsor_vouchers_code` - Busca por código
- `idx_sponsor_vouchers_sponsor_used` - Busca por patrocinador e status

---

### Tabela: `offer_inventory`

Controla o estoque disponível por oferta de cada parceiro.

| Coluna | Tipo | Observações |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | ID único |
| `partner_slug` | VARCHAR(100) NOT NULL | Slug do parceiro |
| `offer_title` | VARCHAR(255) NOT NULL | Título da oferta |
| `stock_limit` | INTEGER DEFAULT NULL | Limite de estoque (NULL = ilimitado) |
| `created_at` | TIMESTAMP DEFAULT NOW() | Data de criação |

**Constraint:** `UNIQUE(partner_slug, offer_title)`

**Índice:** `idx_inventory_partner` - Busca por parceiro

---

### Tabela: `search_analytics`

Registra buscas realizadas no frontend para análise.

| Coluna | Tipo | Observações |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | ID único |
| `search_term` | TEXT NOT NULL | Termo buscado |
| `results_found` | INTEGER NOT NULL | Número de resultados |
| `city` | TEXT | Cidade do usuário |
| `country` | TEXT | País do usuário |
| `device_type` | TEXT | Tipo de dispositivo |
| `search_date` | TIMESTAMP DEFAULT CURRENT_TIMESTAMP | Data da busca |

---

## 🔌 Endpoints

### **Payments**

#### `POST /api/payments/create-checkout-session`

Cria uma sessão de checkout Stripe e registra o voucher no banco.

**Request Body:**
```json
{
  "email": "cliente@email.com",
  "partnerSlug": "surf-wave-lisbon",
  "productName": "Aulas de surf",
  "amountCents": 2550,
  "originalPriceCents": 3000,
  "currency": "eur",
  "sponsorCode": "BANC-XXXXX"  // opcional
}
```

**Validações:**
- ✅ Verifica se há estoque disponível (se `stock_limit` definido)
- ✅ Valida se o parceiro existe e tem conta Stripe
- ✅ Aplica desconto do sponsor code (se válido)

**Response:**
```json
{
  "url": "https://checkout.stripe.com/pay/cs_..."
}
```

**Fluxo:**
1. Valida estoque (se aplicável)
2. Busca sponsor code (se fornecido)
3. Calcula taxas (plataforma 20%, desconto sponsor aplicado)
4. Cria Payment Intent Stripe
5. Cria Checkout Session com metadata
6. Gera código de voucher único (VH-XXXXX)
7. Calcula data de expiração (usa `voucher_validity_days` do parceiro ou 240 dias)
8. Insere voucher no banco com status `valid`
9. Retorna URL do checkout

---

#### `POST /api/payments/webhook`

Processa eventos do Stripe (webhooks).

**Eventos processados:**
- `checkout.session.completed` - Ativa o voucher após pagamento
- `payment_intent.succeeded` - Confirma pagamento bem-sucedido

**Segurança:**
- ✅ Valida assinatura usando `STRIPE_WEBHOOK_SECRET`
- ✅ Usa `bodyParser.raw()` para preservar assinatura

**Fluxo (checkout.session.completed):**
1. Valida assinatura do webhook
2. Busca voucher por `stripe_session_id`
3. Atualiza status para `valid` (se necessário)
4. Envia email de confirmação ao cliente

---

#### `GET /api/payments/check-stock`

Verifica estoque disponível para uma oferta.

**Query Parameters:**
- `partnerSlug` - Slug do parceiro
- `productName` - Nome da oferta

**Response:**
```json
{
  "available": true,
  "stock_limit": 100,
  "sold": 45,
  "remaining": 55
}
```

---

### **Vouchers**

#### `POST /api/vouchers/validate`

Valida e utiliza um voucher. Suporta dois modos:

**1. Status Check (sem PIN):** Apenas verifica status do voucher

**Request Body:**
```json
{
  "code": "VH-XXXXX"
}
```

**Response (válido):**
```json
{
  "status": "valid",
  "productName": "Aulas de surf",
  "partnerSlug": "surf-wave-lisbon"
}
```

**Response (usado):**
```json
{
  "status": "used",
  "error": "Voucher já utilizado."
}
```

**Response (expirado):**
```json
{
  "status": "expired",
  "error": "Voucher expirado."
}
```

---

**2. Uso/Validação (com PIN):** Valida o voucher e transfere fundos

**Request Body:**
```json
{
  "code": "VH-XXXXX",
  "pin": "1234"
}
```

**Validações:**
- ✅ Verifica se PIN está correto
- ✅ Verifica se voucher não está usado
- ✅ Verifica se voucher não expirou
- ✅ Verifica se Payment Intent foi bem-sucedido

**Transferência Stripe:**
1. Busca Payment Intent Stripe
2. Obtém ID da cobrança (`latest_charge.id`)
3. Cria transfer para conta do parceiro via Stripe Connect
4. Usa `source_transaction` para transferir fundos retidos (escrow)

**Response (sucesso):**
```json
{
  "success": true,
  "message": "Voucher validado e utilizado. Transferência para o parceiro processada.",
  "code": "VH-XXXXX"
}
```

**Response (transferência pendente):**
```json
{
  "success": true,
  "message": "Voucher validado, mas o repasse ao parceiro está pendente (erro Stripe).",
  "code": "VH-XXXXX",
  "pending_transfer": true,
  "transfer_error": "..."
}
```

**Atualizações no banco:**
- `status` → `used`
- `used_at` → NOW()
- `transfer_status` → `success` ou `failed:stripe_error`
- `stripe_transfer_id` → ID da transferência

---

### **Partners**

#### `POST /api/partners/create-onboarding-link`

Gera link de onboarding Stripe Connect para um parceiro.

**Request Body:**
```json
{
  "partnerSlug": "surf-wave-lisbon",
  "partnerEmail": "parceiro@email.com"
}
```

**Fluxo:**
1. Busca parceiro no banco
2. Se não tiver `stripe_account_id`, cria conta Express Stripe
3. Salva `stripe_account_id` no banco
4. Gera link de onboarding
5. Retorna URL para redirecionamento

**Response:**
```json
{
  "url": "https://connect.stripe.com/setup/...",
  "accountId": "acct_...",
  "message": "Use este URL para redirecionar o parceiro para o onboarding Stripe."
}
```

---

### **Admin**

#### `POST /api/admin/setup-partner`

Cria um novo parceiro no sistema.

**Request Body:**
```json
{
  "slug": "surf-wave-lisbon",
  "name": "Surf Wave Lisbon",
  "email": "surf@email.com",
  "phone": "+351 123 456 789",
  "location": "Costa da Caparica",
  "price_cents": 3000
}
```

**Fluxo:**
1. Gera PIN aleatório de 4 dígitos
2. Cria conta Stripe Express
3. Insere parceiro no banco:
   - `voucher_validity_days` = 240 (8 meses)
   - `pin` = gerado automaticamente
   - `stripe_account_id` = ID da conta Stripe
4. Gera link de onboarding
5. Retorna PIN e URL de onboarding

**Response:**
```json
{
  "success": true,
  "message": "Parceiro cadastrado com sucesso!",
  "pin_gerado": "5678",
  "onboarding_url": "https://connect.stripe.com/setup/..."
}
```

---

#### `GET /api/admin/audit-transfers`

Lista vouchers com transferências falhadas (para auditoria).

**Response:**
```json
{
  "message": "⚠️ Atenção: Existem repasses que falharam!",
  "total_pendente": 2,
  "vouchers": [
    {
      "code": "VH-XXXXX",
      "partner_slug": "surf-wave-lisbon",
      "valor_total": 12.75,
      "deve_receber": 10.20,
      "transfer_error_msg": "...",
      "used_at": "2025-12-18T09:13:04.779Z"
    }
  ]
}
```

---

#### `GET /api/admin/stock-list`

Lista todos os limites de estoque configurados.

**Response:**
```json
[
  {
    "id": 1,
    "partner_slug": "surf-wave-lisbon",
    "offer_title": "Aulas de surf",
    "stock_limit": 100,
    "created_at": "2025-12-18T09:13:04.779Z"
  }
]
```

---

#### `POST /api/admin/update-stock`

Atualiza ou cria limite de estoque para uma oferta.

**Request Body:**
```json
{
  "partner_slug": "surf-wave-lisbon",
  "offer_title": "Aulas de surf",
  "stock_limit": 100
}
```

**Response:**
```json
{
  "success": true,
  "message": "Stock atualizado com sucesso!"
}
```

**Nota:** `stock_limit = null` significa estoque ilimitado.

---

### **Analytics**

#### `POST /api/analytics/search`

Registra uma busca realizada no frontend.

**Request Body:**
```json
{
  "term": "surf",
  "count": 5,
  "city": "Lisboa",
  "country": "Portugal",
  "device": "mobile"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Busca registrada com sucesso"
}
```

---

### **Health**

#### `GET /health`

Health check simples.

**Response:**
```json
{
  "ok": true
}
```

---

## 💳 Sistema de Pagamentos

### Arquitetura Escrow

O sistema usa **escrow** (retenção de fundos) até a validação do voucher:

1. **Compra:** Cliente paga → Stripe retém fundos na conta da plataforma
2. **Validação:** Parceiro valida voucher com PIN → Transferência automática para conta do parceiro
3. **Taxa:** Plataforma retém 20% (configurável via cálculo de taxas)

### Fluxo de Pagamento

```
Cliente → Checkout Session → Payment Intent → Voucher (status: valid)
                                            ↓
                                    Webhook recebe confirmação
                                            ↓
                                    Email enviado ao cliente
```

### Fluxo de Transferência

```
Parceiro valida voucher com PIN
        ↓
Sistema busca Payment Intent
        ↓
Obtém ID da cobrança (ch_...)
        ↓
Cria Transfer Stripe Connect
        ↓
Fundos transferidos para conta do parceiro
        ↓
Voucher marcado como usado
```

### Sponsor Codes

Códigos promocionais que reduzem a taxa da plataforma:

- **Desconto:** Reduz taxa da plataforma em X% (definido em `discount_extra`)
- **Uso único:** Cada código pode ser usado uma vez
- **Validação:** Verificado no momento da compra

**Exemplo:**
- Preço: €25,50 (código com 5% desconto extra)
- Taxa plataforma: 20% - 5% = 15%
- Parceiro recebe: €21,68

---

## ✅ Sistema de Validação

### Estados do Voucher

| Status | Descrição | Quando |
|--------|-----------|--------|
| `active` | Criado, aguardando pagamento | Após criação no checkout |
| `valid` | Pago e válido para uso | Após webhook `checkout.session.completed` |
| `used` | Utilizado e transferido | Após validação com PIN |
| `expired` | Expirado (não pode ser usado) | Quando `expires_at` passou |

### Segurança

- **PIN obrigatório** para validação/uso
- **Lock de transação** (`FOR UPDATE`) previne uso duplo
- **Validação de expiração** antes de transferência
- **Verificação de Payment Intent** antes de transferir

### Validade

A validade é configurada por parceiro:
- Campo: `voucher_validity_days` na tabela `partners`
- Padrão: **240 dias (8 meses)**
- Calculado no momento da compra: `expires_at = created_at + voucher_validity_days`

---

## 👥 Sistema de Parceiros

### Onboarding Stripe Connect

1. **Criação via Admin:**
   - Parceiro é criado via `POST /api/admin/setup-partner`
   - Conta Stripe Express é criada automaticamente
   - PIN é gerado automaticamente

2. **Onboarding:**
   - Link gerado via `POST /api/partners/create-onboarding-link`
   - Parceiro completa informações na Stripe
   - Após onboarding, pode receber transferências

3. **Validação:**
   - Parceiro usa PIN para validar vouchers
   - Transferências automáticas após validação

### Campos Importantes

- `stripe_account_id` - ID da conta Stripe Connect (necessário para transfers)
- `pin` - PIN de 4 dígitos para validação
- `voucher_validity_days` - Validade dos vouchers deste parceiro

---

## 📦 Sistema de Estoque

### Controle por Oferta

Cada oferta de cada parceiro pode ter um limite de estoque:

**Configuração:**
- Via `POST /api/admin/update-stock`
- `stock_limit = null` → Estoque ilimitado
- `stock_limit = N` → Máximo de N vouchers vendidos

**Validação:**
- Verificado em `POST /api/payments/create-checkout-session`
- Conta vouchers com status `valid`, `used` ou `active`
- Se `sold >= stock_limit`, bloqueia venda

**Exemplo:**
```json
{
  "partner_slug": "surf-wave-lisbon",
  "offer_title": "Aulas de surf",
  "stock_limit": 100
}
```

Isso limita a venda de 100 vouchers para esta oferta específica.

---

## 📊 Sistema de Analytics

### Buscas Registradas

Cada busca realizada no frontend é registrada na tabela `search_analytics`:

- Termo buscado
- Número de resultados encontrados
- Localização do usuário (city, country)
- Tipo de dispositivo

**Uso:** Análise de comportamento, termos mais buscados, etc.

---

## 📜 Scripts e Migrações

### Migrações

#### `node scripts/migrate.js`
Cria/atualiza tabela `vouchers` e tabelas relacionadas:
- Adiciona colunas de transferência (`stripe_transfer_id`, `transfer_status`, etc.)
- Cria tabela `offer_inventory`
- Cria tabela `search_analytics`
- Cria índices

#### `node scripts/migrate-partners.js`
Cria/atualiza tabela `partners`:
- Cria estrutura completa da tabela
- Insere parceiros pré-configurados
- Define valores padrão

#### `node scripts/migrate-sponsor-vouchers.js`
Cria tabela `sponsor_vouchers`:
- Estrutura para códigos promocionais
- Índices para busca

### Scripts Úteis

#### `node scripts/generate-sponsor-vouchers.js`
Gera CSV de sponsor vouchers:
```bash
node scripts/generate-sponsor-vouchers.js --sponsor="BANCO_X" --count=100 --discount=5
```

#### `node scripts/import-sponsor-vouchers.js`
Importa CSV para banco:
```bash
node scripts/import-sponsor-vouchers.js sponsor-vouchers-BANC-1763900611440.csv
```

#### `node scripts/replace-sponsor-prefix.js`
Substitui prefixos de sponsor codes:
```bash
node scripts/replace-sponsor-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=V-HUB
```

#### `node scripts/update-validity-to-8months.js`
Atualiza validade de todos os parceiros para 240 dias (8 meses):
```bash
node scripts/update-validity-to-8months.js
```

#### `node scripts/check-transfers-status.js`
Verifica status de transferências Stripe:
```bash
# Para um Payment Intent específico
node scripts/check-transfers-status.js --payment-intent=pi_3SfdE7L0LJVAbepR08Dd4UrD

# Para todos os vouchers usados
node scripts/check-transfers-status.js --all
```

### NPM Scripts

```json
{
  "dev": "nodemon src/server.js",
  "start": "node src/server.js",
  "migrate": "node scripts/migrate.js",
  "migrate:partners": "node scripts/migrate-partners.js",
  "migrate:sponsor-vouchers": "node scripts/migrate-sponsor-vouchers.js"
}
```

---

## 🔐 Variáveis de Ambiente

### Obrigatórias

```env
# Banco de Dados
DATABASE_URL=postgresql://user:password@host:port/database
PGSSLMODE=require  # Para produção

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (Resend)
RESEND_API_KEY=re_...
SMTP_FROM=VoucherHub <info@voucherhub.pt>

# Servidor
PORT=3000
NODE_ENV=production

# Frontend (CORS)
FRONTEND_URL=https://voucherhub.pt
```

### Opcionais

```env
# Frontend alternativo para CORS
FRONTEND_URL=http://localhost:5500
```

---

## 🛡 Segurança

### HTTP Headers (Helmet)

- **HSTS** configurado (1 ano, includeSubDomains, preload)
- **XSS Protection** habilitado
- **Content Security Policy** desabilitado (permite recursos externos)
- **Cross-Origin Resource Policy** configurado

### CORS

Origens permitidas:
- `https://voucherhub.pt`
- `https://www.voucherhub.pt`
- `https://modest-comfort-production.up.railway.app` (frontend antigo)
- `http://localhost:3000` (dev)
- `http://localhost:5500` (dev)
- `null` (para requests locais)

### Webhook Security

- Validação de assinatura Stripe usando `STRIPE_WEBHOOK_SECRET`
- `bodyParser.raw()` usado para preservar assinatura
- Rota de webhook processada ANTES de `express.json()`

### PIN de Validação

- PIN de 4 dígitos obrigatório para uso de voucher
- Gerado automaticamente para novos parceiros
- Validação no momento do uso

### Transações de Banco

- Uso de `BEGIN` / `COMMIT` / `ROLLBACK`
- `FOR UPDATE` em validações críticas (previne race conditions)

---

## 🚀 Deploy

### Railway

1. **Conectar repositório** ao Railway
2. **Configurar variáveis de ambiente** (ver seção acima)
3. **Database:** Criar PostgreSQL no Railway
4. **Deploy:** Railway faz deploy automático a cada push

### Migrações

Execute migrações após deploy:

```bash
# Via Railway CLI
railway run node scripts/migrate.js
railway run node scripts/migrate-partners.js
railway run node scripts/migrate-sponsor-vouchers.js
```

### Stripe Webhook

1. **Criar webhook** no dashboard Stripe
2. **URL:** `https://seu-backend.up.railway.app/api/payments/webhook`
3. **Eventos:** `checkout.session.completed`, `payment_intent.succeeded`
4. **Copiar signing secret** → `STRIPE_WEBHOOK_SECRET`

### Health Check

O Railway verifica `GET /health` para determinar se o serviço está rodando.

---

## 🔄 Fluxos Completos

### Fluxo 1: Compra de Voucher

```
1. Cliente escolhe oferta no frontend
2. Frontend chama POST /api/payments/create-checkout-session
3. Backend valida estoque (se aplicável)
4. Backend cria Payment Intent Stripe
5. Backend cria Checkout Session
6. Backend gera código de voucher (VH-XXXXX)
7. Backend calcula data de expiração (voucher_validity_days)
8. Backend insere voucher no banco (status: valid)
9. Backend retorna URL do checkout
10. Cliente é redirecionado para Stripe
11. Cliente completa pagamento
12. Stripe envia webhook checkout.session.completed
13. Backend recebe webhook e valida assinatura
14. Backend atualiza voucher (se necessário)
15. Backend envia email de confirmação ao cliente
```

### Fluxo 2: Validação de Voucher

```
1. Parceiro acessa sistema de validação
2. Parceiro insere código do voucher
3. Sistema faz POST /api/vouchers/validate (sem PIN) → Status check
4. Sistema retorna status: valid/used/expired
5. Se válido, parceiro insere PIN
6. Sistema faz POST /api/vouchers/validate (com PIN) → Validação
7. Backend valida PIN
8. Backend verifica se voucher não está usado/expirado
9. Backend busca Payment Intent Stripe
10. Backend obtém ID da cobrança (ch_...)
11. Backend cria Transfer Stripe Connect
12. Stripe transfere fundos para conta do parceiro
13. Backend atualiza voucher (status: used, used_at: NOW())
14. Backend atualiza transfer_status e stripe_transfer_id
15. Sistema retorna sucesso ao parceiro
```

### Fluxo 3: Onboarding de Parceiro

```
1. Admin acessa painel de gestão
2. Admin insere dados do parceiro
3. Sistema faz POST /api/admin/setup-partner
4. Backend gera PIN aleatório
5. Backend cria conta Stripe Express
6. Backend insere parceiro no banco
7. Backend gera link de onboarding
8. Backend retorna PIN e URL de onboarding
9. Admin envia PIN e link ao parceiro
10. Parceiro acessa link e completa onboarding Stripe
11. Após onboarding, parceiro pode receber transferências
```

### Fluxo 4: Aplicação de Sponsor Code

```
1. Cliente insere código promocional no checkout
2. Frontend envia sponsorCode no POST /api/payments/create-checkout-session
3. Backend normaliza código (uppercase, trim)
4. Backend busca código em sponsor_vouchers
5. Backend verifica se código não foi usado
6. Backend verifica se código não expirou (se expires_at definido)
7. Backend aplica discount_extra à taxa da plataforma
8. Backend calcula novos valores (platform_fee_cents reduzido)
9. Backend marca sponsor code como usado (se necessário)
10. Voucher é criado com desconto aplicado
```

---

## 🐛 Troubleshooting

### Voucher não recebe email

**Verificar:**
1. `RESEND_API_KEY` está configurado?
2. `SMTP_FROM` está correto?
3. Email está sendo enviado? (verificar logs do backend)
4. Email caiu no spam?

**Logs:** Verificar console do backend para erros de envio.

---

### Transferência Stripe falhou

**Verificar:**
1. Parceiro completou onboarding Stripe?
2. `stripe_account_id` está definido no banco?
3. Payment Intent foi bem-sucedido?
4. Verificar `transfer_error_msg` no banco

**Solução:**
- Usar `GET /api/admin/audit-transfers` para listar falhas
- Usar `node scripts/check-transfers-status.js` para verificar detalhes
- Repassar manualmente via Stripe Dashboard se necessário

---

### Voucher expira antes do tempo

**Verificar:**
1. `voucher_validity_days` do parceiro no banco
2. `expires_at` calculado corretamente na criação

**Solução:**
- Verificar valor em `partners.voucher_validity_days`
- Atualizar usando `node scripts/update-validity-to-8months.js`
- Novos vouchers usarão nova validade

---

### Estoque não está funcionando

**Verificar:**
1. `offer_inventory` tem registro para a oferta?
2. `stock_limit` não é `NULL`?
3. Vouchers contados corretamente (status: valid, used, active)?

**Solução:**
- Verificar via `GET /api/admin/stock-list`
- Atualizar via `POST /api/admin/update-stock`
- Verificar query de contagem em `payments.js`

---

### Webhook não está sendo recebido

**Verificar:**
1. URL do webhook está correto no Stripe?
2. `STRIPE_WEBHOOK_SECRET` está correto?
3. Webhook está sendo chamado? (verificar logs Stripe)
4. Rota de webhook está ANTES de `express.json()`?

**Solução:**
- Verificar logs do Railway/backend
- Testar webhook via Stripe CLI: `stripe listen --forward-to localhost:3000/api/payments/webhook`

---

### PIN incorreto

**Verificar:**
1. PIN está correto no banco (`partners.pin`)?
2. Parceiro está usando o PIN correto?

**Solução:**
- Verificar PIN no banco
- Gerar novo PIN se necessário (atualizar manualmente)

---

## 📞 URLs Úteis

### Produção

- **Backend:** `https://voucherhub-backend-production.up.railway.app`
- **Health Check:** `https://voucherhub-backend-production.up.railway.app/health`
- **Auditoria de Transferências:** `https://voucherhub-backend-production.up.railway.app/api/admin/audit-transfers`

### Stripe

- **Dashboard:** https://dashboard.stripe.com
- **Webhooks:** https://dashboard.stripe.com/webhooks
- **Connect:** https://dashboard.stripe.com/connect/overview

---

## 📝 Notas Importantes

1. **Fundos são retidos (escrow)** até validação do voucher
2. **PIN é obrigatório** para usar voucher
3. **Estoque é opcional** (NULL = ilimitado)
4. **Validade padrão** é 240 dias (8 meses)
5. **Taxa da plataforma** é 20% (reduzível com sponsor codes)
6. **Transações usam locks** para prevenir uso duplo
7. **Webhooks são assíncronos** (não bloqueiam resposta)

---

## 🔗 Referências

- [Stripe Connect Documentation](https://stripe.com/docs/connect)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Resend Documentation](https://resend.com/docs)
- [Express.js Documentation](https://expressjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

**Última atualização:** Dezembro 2025**Versão do Backend:** 1.0.0
