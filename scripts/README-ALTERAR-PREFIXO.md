# 📝 Como Alterar o Prefixo dos Códigos de Sponsor Vouchers

## O que é o prefixo?

O prefixo é a parte inicial dos códigos de vouchers patrocinados. Por exemplo:

- Código: `BANC-4CCC06`
- Prefixo: `BANC`
- Código único: `4CCC06`

## ⚠️ Isso vai quebrar o sistema?

**NÃO!** O sistema busca os códigos pelo código **COMPLETO**, não pelo prefixo.
Você pode alterar o prefixo sem problemas.

## 📋 Opções para alterar o prefixo

### Opção 1: Atualizar apenas o CSV (para novos códigos)

Se você ainda **não importou** os códigos no banco de dados:

1. **Atualize o prefixo no CSV:**

   ```bash
   node scripts/update-csv-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=NOVOPREFIXO
   ```

   Substitua `NOVOPREFIXO` pelo prefixo desejado (ex: `BANK`, `SPON`, etc.)

2. **Importe o CSV atualizado:**
   ```bash
   node scripts/import-sponsor-vouchers.js --file=sponsor-vouchers-BANC-1763900611440.csv
   ```

### Opção 2: Atualizar códigos já existentes no banco

Se os códigos **já estão no banco de dados** e você quer alterá-los:

```bash
node scripts/update-prefix-in-db.js --old=BANC --new=NOVOPREFIXO
```

⚠️ **ATENÇÃO:**

- Isso altera **todos** os códigos que começam com o prefixo antigo
- Códigos já usados também serão alterados
- Certifique-se de que não existe conflito (códigos com o novo prefixo já existentes)

### Opção 3: Substituir completamente (deletar antigos e importar novos)

1. **Atualize o prefixo no CSV:**

   ```bash
   node scripts/update-csv-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=NOVOPREFIXO
   ```

2. **Delete os códigos antigos do banco** (usando psql ou um cliente SQL):

   ```sql
   DELETE FROM sponsor_vouchers WHERE code LIKE 'BANC-%';
   ```

3. **Importe os novos códigos:**
   ```bash
   node scripts/import-sponsor-vouchers.js --file=sponsor-vouchers-BANC-1763900611440.csv
   ```

## 🔍 Verificar códigos no banco

Para ver quais códigos existem no banco:

```sql
SELECT code, sponsor, used, created_at
FROM sponsor_vouchers
WHERE code LIKE 'BANC-%'
ORDER BY created_at DESC
LIMIT 10;
```

## ❓ Dúvidas comuns

**Q: Posso ter códigos com prefixos diferentes ao mesmo tempo?**  
A: Sim! O sistema funciona com qualquer prefixo, desde que o código completo seja único.

**Q: O que acontece se eu mudar um código que já foi usado?**  
A: O código será alterado, mas o registro de uso permanece. É melhor não alterar códigos já usados.

**Q: Preciso mudar o nome do arquivo CSV também?**  
A: Não é obrigatório, mas você pode renomear para manter a organização.
