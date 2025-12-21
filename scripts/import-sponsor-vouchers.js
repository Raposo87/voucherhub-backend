// scripts/import-sponsor-vouchers.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';
import fs from 'fs';
import path from 'path';

function getArg(flag, def = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function run() {
  const csvFile = getArg('--file');

  if (!csvFile) {
    console.error('❌ Use: node import-sponsor-vouchers.js --file=sponsor-vouchers-BANC-1763900611440.csv');
    console.error('   Ou: node import-sponsor-vouchers.js --file=./caminho/para/arquivo.csv');
    process.exit(1);
  }

  const filepath = path.isAbsolute(csvFile) ? csvFile : path.join(process.cwd(), csvFile);

  if (!fs.existsSync(filepath)) {
    console.error(`❌ Arquivo não encontrado: ${filepath}`);
    process.exit(1);
  }

  console.log(`📄 Lendo arquivo: ${filepath}`);

  const fileContent = fs.readFileSync(filepath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    console.error('❌ Arquivo CSV inválido. Deve ter pelo menos um cabeçalho e uma linha de dados.');
    process.exit(1);
  }

  // Pula o cabeçalho
  const dataLines = lines.slice(1);
  const rows = [];

  for (const line of dataLines) {
    const parts = line.split(';');
    if (parts.length < 4) {
      console.warn(`⚠️  Linha ignorada (formato inválido): ${line}`);
      continue;
    }

    const [code, sponsor, discount_extra, created_at] = parts;
    
    if (!code || !sponsor || !discount_extra) {
      console.warn(`⚠️  Linha ignorada (dados incompletos): ${line}`);
      continue;
    }

    rows.push({
      code: code.trim(),
      sponsor: sponsor.trim(),
      discount_extra: parseInt(discount_extra.trim(), 10),
      created_at: created_at ? new Date(created_at.trim()) : new Date()
    });
  }

  if (rows.length === 0) {
    console.error('❌ Nenhum registro válido encontrado no arquivo.');
    process.exit(1);
  }

  console.log(`📊 Encontrados ${rows.length} registros válidos para importar.`);

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      // Verifica se o código já existe
      const existing = await client.query(
        'SELECT id, code FROM sponsor_vouchers WHERE code = $1',
        [row.code]
      );

      if (existing.rows.length > 0) {
        // Atualiza o registro existente
        await client.query(
          `UPDATE sponsor_vouchers 
           SET sponsor = $1, discount_extra = $2, created_at = $3
           WHERE code = $4`,
          [row.sponsor, row.discount_extra, row.created_at, row.code]
        );
        updated++;
      } else {
        // Insere novo registro
        await client.query(
          `INSERT INTO sponsor_vouchers (code, sponsor, discount_extra, created_at)
           VALUES ($1, $2, $3, $4)`,
          [row.code, row.sponsor, row.discount_extra, row.created_at]
        );
        inserted++;
      }
    }

    await client.query('COMMIT');
    
    console.log('\n✅ Importação concluída com sucesso!');
    console.log(`   📥 Inseridos: ${inserted} registros`);
    console.log(`   🔄 Atualizados: ${updated} registros`);
    console.log(`   ⏭️  Ignorados: ${skipped} registros`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao importar dados:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

