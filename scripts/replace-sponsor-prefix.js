// scripts/replace-sponsor-prefix.js
// Script completo para substituir o prefixo dos sponsor vouchers
// 1. Atualiza o CSV
// 2. Deleta códigos antigos do banco
// 3. Importa os novos códigos
import 'dotenv/config.js';
import { pool } from '../src/db.js';
import fs from 'fs';
import path from 'path';

function getArg(flag, def = undefined) {
  // Procura por --flag=valor
  const flagWithEquals = process.argv.find(arg => arg.startsWith(`${flag}=`));
  if (flagWithEquals) {
    return flagWithEquals.split('=')[1];
  }
  
  // Procura por --flag valor (sem =)
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function updateCSV(filepath, oldPrefix, newPrefix) {
  console.log(`📄 Atualizando arquivo CSV: ${filepath}`);
  console.log(`🔄 Substituindo "${oldPrefix}-" por "${newPrefix}-"`);
  
  let fileContent = fs.readFileSync(filepath, 'utf-8');
  const lines = fileContent.split('\n');
  
  let replacedCount = 0;
  const updatedLines = lines.map((line, index) => {
    if (index === 0) return line; // Pula cabeçalho
    
    if (line.includes(`${oldPrefix}-`)) {
      replacedCount++;
      return line.replace(new RegExp(`${oldPrefix}-`, 'g'), `${newPrefix}-`);
    }
    
    return line;
  });

  fs.writeFileSync(filepath, updatedLines.join('\n'), 'utf-8');
  console.log(`✅ ${replacedCount} códigos atualizados no CSV\n`);
  return replacedCount;
}

async function deleteOldCodes(oldPrefix) {
  console.log(`🗑️  Deletando códigos antigos com prefixo "${oldPrefix}-" do banco...`);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Verifica quantos serão deletados
    const checkResult = await client.query(
      `SELECT COUNT(*) as count FROM sponsor_vouchers WHERE code LIKE $1`,
      [`${oldPrefix}-%`]
    );
    const count = parseInt(checkResult.rows[0].count, 10);
    
    if (count === 0) {
      console.log(`ℹ️  Nenhum código encontrado com prefixo "${oldPrefix}-"\n`);
      await client.query('ROLLBACK');
      return 0;
    }
    
    // Mostra quantos estão usados
    const usedResult = await client.query(
      `SELECT COUNT(*) as count FROM sponsor_vouchers WHERE code LIKE $1 AND used = TRUE`,
      [`${oldPrefix}-%`]
    );
    const usedCount = parseInt(usedResult.rows[0].count, 10);
    
    console.log(`📊 Encontrados ${count} códigos (${usedCount} já usados, ${count - usedCount} disponíveis)`);
    
    // Deleta os códigos
    const deleteResult = await client.query(
      `DELETE FROM sponsor_vouchers WHERE code LIKE $1`,
      [`${oldPrefix}-%`]
    );
    
    await client.query('COMMIT');
    console.log(`✅ ${deleteResult.rowCount} códigos deletados do banco\n`);
    return deleteResult.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function importCSV(filepath) {
  console.log(`📥 Importando códigos do CSV: ${filepath}`);
  
  const fileContent = fs.readFileSync(filepath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV inválido');
  }
  
  const dataLines = lines.slice(1);
  const rows = [];
  
  for (const line of dataLines) {
    const parts = line.split(';');
    if (parts.length < 4) continue;
    
    const [code, sponsor, discount_extra, created_at] = parts;
    if (!code || !sponsor || !discount_extra) continue;
    
    rows.push({
      code: code.trim(),
      sponsor: sponsor.trim(),
      discount_extra: parseInt(discount_extra.trim(), 10),
      created_at: created_at ? new Date(created_at.trim()) : new Date()
    });
  }
  
  console.log(`📊 Encontrados ${rows.length} registros válidos para importar`);
  
  const client = await pool.connect();
  let inserted = 0;
  
  try {
    await client.query('BEGIN');
    
    for (const row of rows) {
      await client.query(
        `INSERT INTO sponsor_vouchers (code, sponsor, discount_extra, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET
           sponsor = EXCLUDED.sponsor,
           discount_extra = EXCLUDED.discount_extra,
           created_at = EXCLUDED.created_at`,
        [row.code, row.sponsor, row.discount_extra, row.created_at]
      );
      inserted++;
    }
    
    await client.query('COMMIT');
    console.log(`✅ ${inserted} códigos importados com sucesso!\n`);
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function run() {
  const csvFile = getArg('--file', 'sponsor-vouchers-BANC-1763900611440.csv');
  const oldPrefix = getArg('--old', 'BANC');
  const newPrefix = getArg('--new');

  if (!newPrefix) {
    console.error('❌ Use: node replace-sponsor-prefix.js --file=arquivo.csv --old=BANC --new=NOVOPREFIXO');
    console.error('');
    console.error('   Exemplo: node replace-sponsor-prefix.js --file=sponsor-vouchers-BANC-1763900611440.csv --old=BANC --new=BANK');
    console.error('');
    console.error('⚠️  ATENÇÃO: Este script vai:');
    console.error('   1. Atualizar o CSV com o novo prefixo');
    console.error('   2. DELETAR todos os códigos antigos do banco');
    console.error('   3. Importar os novos códigos do CSV');
    process.exit(1);
  }

  const filepath = path.isAbsolute(csvFile) ? csvFile : path.join(process.cwd(), csvFile);

  if (!fs.existsSync(filepath)) {
    console.error(`❌ Arquivo não encontrado: ${filepath}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔄 SUBSTITUIÇÃO COMPLETA DE PREFIXO DE SPONSOR VOUCHERS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📁 Arquivo: ${csvFile}`);
  console.log(`🔄 Prefixo antigo: ${oldPrefix}`);
  console.log(`✨ Prefixo novo: ${newPrefix}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Passo 1: Atualizar CSV
    await updateCSV(filepath, oldPrefix, newPrefix);
    
    // Passo 2: Deletar códigos antigos do banco
    await deleteOldCodes(oldPrefix);
    
    // Passo 3: Importar novos códigos
    await importCSV(filepath);
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SUBSTITUIÇÃO CONCLUÍDA COM SUCESSO!');
    console.log('═══════════════════════════════════════════════════════════');
    
  } catch (err) {
    console.error('\n❌ ERRO durante a substituição:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

