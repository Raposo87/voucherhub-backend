# 📅 Como Funciona a Validade dos Vouchers

## 🔍 Onde a Validade é Configurada

A validade dos vouchers é definida no campo `voucher_validity_days` da tabela `partners`.

### 1. **Para Parceiros NOVOS (via HTML/Admin)**

**Arquivo:** `src/routes/admin.js` (linha 55)

Quando você cria um novo parceiro via HTML (endpoint `/api/admin/setup-partner`):
```javascript
voucher_validity_days: 240  // 8 meses (240 dias)
```

**Atualizado para:** 240 dias (8 meses)

---

### 2. **Para Parceiros JÁ EXISTENTES no Banco**

**Script:** `scripts/update-validity-to-8months.js`

**O que faz:**
- Atualiza TODOS os parceiros já cadastrados no banco
- Define `voucher_validity_days = 240` para todos

**Quando executar:**
```bash
node scripts/update-validity-to-8months.js
```

**Exemplo de uso:**
- Você tem 10 parceiros no banco com validade de 120 dias (4 meses)
- Executa o script
- Todos passam a ter 240 dias (8 meses)
- Novos vouchers desses parceiros usarão 8 meses

---

### 3. **Valor Padrão (Fallback)**

**Arquivo:** `src/routes/payments.js` (linha 305)

Se um parceiro não tiver `voucher_validity_days` definido:
```javascript
const daysValidity = partner.voucher_validity_days || 240;
```

**Fallback:** 240 dias (8 meses)

---

## 📊 Fluxo Completo

### Quando um Cliente Compra um Voucher:

1. **Webhook Stripe recebe pagamento** (`payments.js`)
2. **Busca informações do parceiro:**
   ```javascript
   SELECT voucher_validity_days FROM partners WHERE slug = ?
   ```
3. **Usa o valor do parceiro ou fallback:**
   ```javascript
   const daysValidity = partner.voucher_validity_days || 240;
   ```
4. **Calcula data de expiração:**
   ```javascript
   const expiryDate = new Date();
   expiryDate.setDate(expiryDate.getDate() + daysValidity);
   ```
5. **Salva no voucher:**
   ```javascript
   INSERT INTO vouchers (..., expires_at) VALUES (..., expiryDate)
   ```

---

## 🛠️ Como Mudar a Validade

### Opção 1: Mudar TODOS os Parceiros Existentes

Execute o script:
```bash
node scripts/update-validity-to-8months.js
```

**Resultado:**
- Todos os parceiros passam a ter 240 dias
- Novos vouchers usarão 240 dias
- Vouchers antigos continuam com suas datas originais

---

### Opção 2: Mudar APENAS um Parceiro Específico

Use SQL direto ou crie um script:

```sql
UPDATE partners 
SET voucher_validity_days = 240 
WHERE slug = 'nome-do-parceiro';
```

---

### Opção 3: Mudar o Valor Padrão para Novos Parceiros

**Arquivo:** `src/routes/admin.js` (linha 55)

Mude de:
```javascript
60,  // 60 dias
```

Para:
```javascript
240, // 240 dias (8 meses)
```

**Resultado:**
- Novos parceiros criados via HTML terão 240 dias
- Parceiros existentes não são alterados

---

## ⚠️ IMPORTANTE: O Que NÃO é Afetado

### ❌ Vouchers JÁ Criados

Vouchers já criados **NÃO** são alterados. Eles mantêm suas datas de expiração originais.

**Exemplo:**
- Voucher criado em 1 de janeiro com 120 dias → Expira em 1 de maio
- Você muda validade para 240 dias em 15 de janeiro
- O voucher ainda expira em 1 de maio (não muda!)

**Por quê?** A data de expiração é calculada e salva quando o voucher é criado.

---

### ✅ Apenas Novos Vouchers

Apenas vouchers **criados DEPOIS** da mudança usarão a nova validade.

**Exemplo:**
- Você executa o script em 15 de janeiro
- Novo voucher criado em 20 de janeiro → Usa 240 dias (8 meses)

---

## 📝 Resumo dos Arquivos Envolvidos

| Arquivo | O Que Faz | Quando Afeta |
|---------|-----------|--------------|
| `src/routes/admin.js` | Define validade para NOVOS parceiros | Quando cria parceiro via HTML |
| `src/routes/payments.js` | Usa validade do parceiro ao criar voucher | Quando cliente compra |
| `scripts/update-validity-to-8months.js` | Atualiza parceiros EXISTENTES | Quando executa o script |
| `scripts/migrate-partners.js` | Não usado mais (você usa HTML) | - |

---

## ✅ Checklist: Mudar de 4 para 8 Meses

1. ✅ **Atualizar fallback padrão** (`payments.js` linha 305) → Já feito (240)
2. ✅ **Atualizar admin para novos parceiros** (`admin.js` linha 55) → Já feito (240)
3. ⏳ **Atualizar parceiros existentes** → Execute: `node scripts/update-validity-to-8months.js`

---

## 🎯 Conclusão

**Para mudar de 4 meses (120 dias) para 8 meses (240 dias):**

1. **Código já está atualizado** ✅
   - Novos parceiros criados via HTML terão 240 dias
   - Novos vouchers usarão 240 dias

2. **Execute o script para atualizar parceiros existentes:**
   ```bash
   node scripts/update-validity-to-8months.js
   ```

3. **Vouchers antigos não mudam** (comportamento esperado)
