# 🔍 Entendendo Por Que "Transferido para" Está Vazio no Stripe

## 📊 O Problema

Você está vendo no Stripe Dashboard que os pagamentos foram concluídos, mas a coluna **"Transferido para"** está vazia.

---

## ✅ **RESPOSTA: Isso é NORMAL e ESPERADO!**

### Por quê?

O VoucherHub usa um sistema **Escrow** (retenção de pagamento). Isso significa:

1. ✅ **Pagamento é recebido** → Payment Intent criado (você vê isso no Stripe)
2. ⏳ **Dinheiro fica RETIDO** → Aguardando validação do voucher
3. ✅ **Voucher é validado** → Transfer criada (aí sim aparece "Transferido para")

---

## 🔄 Como Funciona o Fluxo

### Etapa 1: Cliente Paga (Webhook)

**Arquivo:** `src/routes/payments.js` (webhook)

```javascript
// Quando checkout.session.completed acontece:
// 1. Cria o voucher no banco
// 2. Envia email para cliente
// 3. NÃO cria transfer ainda! ❌
```

**Resultado no Stripe:**

- ✅ Payment Intent aparece
- ❌ Transfer NÃO existe ainda
- 💰 Dinheiro está na sua conta Stripe (retenido)

---

### Etapa 2: Parceiro Valida Voucher

**Arquivo:** `src/routes/vouchers.js` (POST /validate com PIN)

```javascript
// Quando parceiro valida o voucher:
// 1. Verifica PIN
// 2. Cria transfer para parceiro:
const transfer = await stripe.transfers.create({
  amount: transferAmount,
  currency: "eur",
  destination: destinationAccountId, // Conta do parceiro
  source_transaction: sourceTransactionId,
});
// 3. Marca voucher como usado
```

**Resultado no Stripe:**

- ✅ Transfer criada
- ✅ "Transferido para" aparece com nome do parceiro
- 💰 Dinheiro sai da sua conta e vai para parceiro

---

## 🔍 Como Verificar Se Foi Transferido

### Opção 1: Verificar no Banco de Dados

As transfers são registradas no banco quando criadas:

```sql
SELECT
    code,
    partner_slug,
    status,
    transfer_status,
    stripe_transfer_id,
    used_at
FROM vouchers
WHERE stripe_payment_intent_id = 'pi_3SfdE7L0LJVAbepR08Dd4UrD';
```

**Se `transfer_status = 'success'` e `stripe_transfer_id` tem valor:**

- ✅ Transfer foi criada
- ✅ Deve aparecer no Stripe Dashboard

**Se `transfer_status = 'pending'` ou NULL:**

- ⏳ Voucher ainda não foi validado
- ⏳ Transfer ainda não foi criada

---

### Opção 2: Verificar no Stripe Dashboard

**Localização das Transfers:**

1. **No Dashboard principal:** Vá em **"Pagamentos"** → Clique em um Payment Intent
2. **Seção separada:** Vá em **"Transfers"** no menu lateral
3. **Filtros:** Use o filtro por Payment Intent ID

**Se não aparecer na seção de Transfers:**

- O voucher ainda não foi validado pelo parceiro
- É normal e esperado (sistema Escrow)

---

## 📋 Checklist: Por Que Pode Estar Vazio?

### ✅ Cenário 1: Voucher Ainda Não Foi Validado (NORMAL)

**Sintomas:**

- Payment Intent existe ✅
- Transfer não existe ❌
- Voucher ainda está com `status = 'valid'` no banco

**É normal?** SIM! Cliente comprou, mas ainda não usou o voucher.

**Solução:** Aguardar validação do parceiro.

---

### ❌ Cenário 2: Erro na Validação

**Sintomas:**

- Payment Intent existe ✅
- Voucher foi validado (`status = 'used'`)
- `transfer_status = 'failed'` no banco

**Possíveis causas:**

- Parceiro não tem `stripe_account_id` configurado
- Erro na API do Stripe
- Valor de transfer é zero

**Solução:** Verificar logs do backend quando voucher foi validado.

---

### ⚠️ Cenário 3: Voucher Validado Mas Transfer Não Aparece

**Sintomas:**

- Voucher foi validado ✅
- `transfer_status = 'success'` no banco ✅
- Transfer ID existe no banco ✅
- Mas não aparece no Stripe Dashboard

**Possíveis causas:**

- Visualização incorreta (procurar na seção Transfers)
- Atraso na sincronização do Stripe
- Transfer foi criada mas está pendente

**Solução:**

1. Buscar transfer diretamente pelo ID no Stripe API
2. Verificar seção "Transfers" separadamente
3. Verificar logs do backend na hora da validação

---

## 🛠️ Como Criar um Script de Verificação

Quer que eu crie um script para verificar o status de todas as transfers?

Ele pode:

- Listar todos os vouchers e seu status de transfer
- Mostrar quais foram transferidos e quais estão pendentes
- Identificar possíveis problemas

---

## 💡 Como Melhorar a Visualização

### Sugestão: Adicionar Metadata no Payment Intent

No webhook, você pode adicionar metadata para facilitar:

```javascript
// No webhook, quando criar o voucher:
await stripe.paymentIntents.update(paymentIntentId, {
  metadata: {
    partner_slug: partnerSlug,
    voucher_code: code,
    transfer_status: "pending", // Será atualizado quando transferida
  },
});
```

Assim, no Stripe Dashboard, você verá na metadata do Payment Intent qual parceiro receberá a transfer.

---

## 📊 Resumo

| Situação                         | Payment Intent | Transfer      | "Transferido para"  |
| -------------------------------- | -------------- | ------------- | ------------------- |
| Cliente pagou, voucher não usado | ✅ Existe      | ❌ Não existe | ❌ Vazio (NORMAL)   |
| Cliente pagou, voucher validado  | ✅ Existe      | ✅ Existe     | ✅ Aparece nome     |
| Erro na validação                | ✅ Existe      | ❌ Falhou     | ❌ Vazio (PROBLEMA) |

---

## ✅ Conclusão

**A coluna "Transferido para" estar vazia é ESPERADO** se:

- Os vouchers ainda não foram validados pelos parceiros
- O sistema está funcionando corretamente (Escrow)

**É um PROBLEMA** se:

- Vouchers foram validados (`status = 'used'`)
- Mas `transfer_status` está com erro
- Ou transfers não foram criadas

---

## 🔍 Próximos Passos

Quer que eu:

1. Crie um script para verificar status de todos os vouchers?
2. Adicione metadata no Payment Intent para facilitar visualização?
3. Crie um endpoint de relatório de transfers?
