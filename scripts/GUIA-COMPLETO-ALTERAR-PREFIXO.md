# 📚 Guia Completo: Como Alterar o Prefixo dos Códigos de Sponsor Vouchers

## 🎯 O que você vai aprender

Este guia explica como mudar o prefixo dos códigos de vouchers patrocinados.
**Exemplo:** Mudar de `BANC-4CCC06` para `V-HUB-4CCC06`

---

## 📖 Entendendo os Conceitos

### O que é o prefixo?

O prefixo é a primeira parte do código do voucher:

- **Código completo:** `BANC-4CCC06`
- **Prefix:** `BANC`
- **Código único:** `4CCC06`

### Por que mudar o prefixo?

- Mudança de marca/nome do patrocinador
- Padronização de códigos
- Organização melhor dos vouchers

### ⚠️ Isso vai quebrar o sistema?

**NÃO!** O sistema busca os códigos pelo código **COMPLETO**, não pelo prefixo.
Você pode alterar sem problemas, desde que faça corretamente.

---

## 🔧 Métodos Disponíveis

Você tem **3 opções** dependendo da sua situação:

### ✅ Método 1: Substituição Completa (Recomendado)

Use quando quer **substituir completamente** os códigos antigos pelos novos.

**O que faz:**

1. Atualiza o CSV com o novo prefixo
2. **DELETA** todos os códigos antigos do banco
3. Importa os novos códigos atualizados

**Comando:**

```bash
node scripts/replace-sponsor-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=V-HUB
```

**Quando usar:**

- ✅ Você quer começar do zero com novos códigos
- ✅ Os códigos antigos ainda não foram muito usados
- ✅ Você tem certeza que quer deletar os antigos

---

### ✅ Método 2: Atualizar apenas o CSV (para novos códigos)

Use quando ainda **não importou** os códigos no banco.

**O que faz:**

- Apenas atualiza o arquivo CSV
- Você importa depois manualmente

**Comando:**

```bash
# Passo 1: Atualizar o CSV
node scripts/update-csv-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=V-HUB

# Passo 2: Importar no banco
node scripts/import-sponsor-vouchers.js --file=sponsor-vouchers-BANC-1763900611440.csv
```

**Quando usar:**

- ✅ Você ainda não importou os códigos
- ✅ Quer mais controle sobre o processo

---

### ✅ Método 3: Atualizar códigos já no banco

Use quando os códigos **já estão no banco** e você quer alterá-los diretamente.

**O que faz:**

- Atualiza os códigos diretamente na tabela do banco
- Não mexe no CSV

**Comando:**

```bash
node scripts/update-prefix-in-db.js --old=BANC --new=V-HUB
```

**Quando usar:**

- ✅ Os códigos já estão importados
- ✅ Você quer alterar os existentes sem deletar
- ⚠️ **CUIDADO:** Isso altera códigos que podem já estar em uso!

---

## 📝 Passo a Passo Detalhado (Método 1 - Recomendado)

### Passo 1: Prepare-se

1. **Identifique o arquivo CSV:**

   - Nome do arquivo: `sponsor-vouchers-BANC-1763900611440.csv`
   - Localização: pasta raiz do projeto

2. **Identifique o prefixo atual:**

   - Abra o CSV
   - Veja o primeiro código: `BANC-4CCC06`
   - Prefixo atual: `BANC`

3. **Defina o novo prefixo:**
   - Exemplo: `V-HUB`
   - ⚠️ **IMPORTANTE:** Não use espaços ou caracteres especiais além de hífens

### Passo 2: Execute o Script

Abra o terminal na pasta do projeto e execute:

```bash
node scripts/replace-sponsor-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=V-HUB
```

**Explicação dos parâmetros:**

- `--file=arquivo.csv` → Nome do arquivo CSV
- `--old=BANC` → Prefixo antigo (sem o hífen)
- `--new=V-HUB` → Novo prefixo (sem o hífen final, o script adiciona automaticamente)

### Passo 3: Verifique o Resultado

O script vai mostrar:

```
✅ 483 códigos atualizados no CSV
✅ 500 códigos deletados do banco
✅ 483 códigos importados com sucesso!
```

### Passo 4: Confirme no Banco (Opcional)

Para verificar se funcionou, você pode executar no banco:

```sql
SELECT code, sponsor, used, created_at
FROM sponsor_vouchers
WHERE code LIKE 'V-HUB-%'
ORDER BY created_at DESC
LIMIT 10;
```

---

## 🔍 Verificações e Troubleshooting

### Como verificar os códigos no banco?

**Ver todos os códigos com um prefixo:**

```sql
SELECT COUNT(*) FROM sponsor_vouchers WHERE code LIKE 'V-HUB-%';
```

**Ver códigos usados:**

```sql
SELECT code, sponsor, used, used_at
FROM sponsor_vouchers
WHERE code LIKE 'V-HUB-%' AND used = TRUE;
```

**Ver códigos disponíveis:**

```sql
SELECT code, sponsor, created_at
FROM sponsor_vouchers
WHERE code LIKE 'V-HUB-%' AND used = FALSE
ORDER BY created_at DESC;
```

### Erros Comuns

**❌ Erro: "Arquivo não encontrado"**

- **Solução:** Verifique se está na pasta correta do projeto
- **Solução:** Use o caminho completo do arquivo

**❌ Erro: "Já existem códigos com o novo prefixo"**

- **Causa:** Já existem códigos com o prefixo que você quer usar
- **Solução:** Use um prefixo diferente ou delete os existentes primeiro

**❌ Erro: "Nenhum código encontrado"**

- **Causa:** Não há códigos com o prefixo antigo no banco
- **Solução:** Isso é normal se você ainda não importou

---

## 📋 Checklist Antes de Executar

Antes de alterar o prefixo, confirme:

- [ ] Tenho certeza do prefixo antigo
- [ ] Tenho certeza do novo prefixo
- [ ] O arquivo CSV existe e está acessível
- [ ] Entendo que códigos antigos serão deletados (no Método 1)
- [ ] Fiz backup do banco (recomendado)
- [ ] Verifiquei se há códigos importantes já usados

---

## 💡 Dicas Importantes

1. **Backup:** Sempre faça backup do banco antes de alterações em massa
2. **Teste primeiro:** Teste com um arquivo pequeno antes de fazer em produção
3. **Prefixo claro:** Use prefixos descritivos e fáceis de lembrar
4. **Documentação:** Mantenha registro das mudanças de prefixo que você fez
5. **Não use espaços:** Prefixos devem ser alfanuméricos com hífens opcionais

---

## 📞 Resumo Rápido

**Para substituir completamente (mais comum):**

```bash
node scripts/replace-sponsor-prefix.js --file=arquivo.csv --old=PREFIXO_ANTIGO --new=NOVO_PREFIXO
```

**Exemplo prático:**

```bash
node scripts/replace-sponsor-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=V-HUB
```

---

## ✅ Conclusão

Agora você sabe como alterar prefixos! Lembre-se:

- O prefixo é apenas uma parte visual do código
- O sistema funciona com qualquer prefixo
- Use o Método 1 (substituição completa) para a maioria dos casos
- Sempre verifique os resultados após a alteração

**Pronto para usar!** 🎉
