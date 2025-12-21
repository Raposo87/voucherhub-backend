// scripts/update-prefix-in-db.js
// ATENÇÃO: Este script atualiza os códigos EXISTENTES no banco de dados
// Use com cuidado! Isso altera códigos que podem já estar sendo usados.
import 'dotenv/config.js';
import { pool } from '../src/db.js';

function getArg(flag, def = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function run() {
  const oldPrefix = getArg('--old', 'BANC');
  const newPrefix = getArg('--new');

  if (!newPrefix) {
    console.error('❌ Use: node update-prefix-in-db.js --old=BANC --new=NOVOPREFIXO');
    console.error('');
    console.error('   Exemplo: node update-prefix-in-db.js --old=BANC --new=BANK');
    console.error('');
    console.error('⚠️  ATENÇÃO: Isso vai alterar TODOS os códigos que começam com o prefixo antigo!');
    process.exit(1);
  }

  console.log(`🔄 Atualizando prefixo "${oldPrefix}-" para "${newPrefix}-" no banco de dados...`);
  console.log('');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Primeiro, verifica quantos códigos serão afetados
    const checkResult = await client.query(
      `SELECT COUNT(*) as count FROM sponsor_vouchers WHERE code LIKE $1`,
      [`${oldPrefix}-%`]
    );
    const count = parseInt(checkResult.rows[0].count, 10);

    if (count === 0) {
      console.log(`ℹ️  Nenhum código encontrado com o prefixo "${oldPrefix}-"`);
      await client.query('ROLLBACK');
      return;
    }

    console.log(`📊 Encontrados ${count} códigos para atualizar.`);
    console.log('');

    // Verifica se algum código já existe com o novo prefixo (para evitar conflitos)
    const conflictCheck = await client.query(
      `SELECT COUNT(*) as count FROM sponsor_vouchers WHERE code LIKE $1`,
      [`${newPrefix}-%`]
    );
    const conflictCount = parseInt(conflictCheck.rows[0].count, 10);

    if (conflictCount > 0) {
      console.error(`❌ ERRO: Já existem ${conflictCount} códigos com o prefixo "${newPrefix}-"`);
      console.error('   Isso causaria conflitos. Remova ou renomeie esses códigos primeiro.');
      await client.query('ROLLBACK');
      process.exit(1);
    }

    // Atualiza os códigos
    const updateResult = await client.query(
      `UPDATE sponsor_vouchers 
       SET code = REPLACE(code, $1, $2)
       WHERE code LIKE $3
       RETURNING code`,
      [`${oldPrefix}-`, `${newPrefix}-`, `${oldPrefix}-%`]
    );

    await client.query('COMMIT');

    console.log(`✅ ${updateResult.rowCount} códigos atualizados com sucesso!`);
    console.log('');
    console.log('📝 Exemplos de códigos atualizados:');
    updateResult.rows.slice(0, 5).forEach((row, index) => {
      console.log(`   ${index + 1}. ${row.code}`);
    });
    if (updateResult.rows.length > 5) {
      console.log(`   ... e mais ${updateResult.rows.length - 5} códigos`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao atualizar códigos:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});


