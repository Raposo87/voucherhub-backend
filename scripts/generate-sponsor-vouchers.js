// scripts/generate-sponsor-vouchers.js
import 'dotenv/config.js';
import { pool } from '../src/db.js';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

function getArg(flag, def = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function run() {
  const sponsor = getArg('--sponsor');
  const qtd = Number(getArg('--qtd', '100'));
  const discount = Number(getArg('--discount', '5'));

  if (!sponsor) {
    console.error('❌ Use: node generate-sponsor-vouchers.js --sponsor=BANCO_X --qtd=500 --discount=5');
    process.exit(1);
  }

  if (!Number.isFinite(qtd) || qtd <= 0) {
    console.error('❌ Quantidade inválida.');
    process.exit(1);
  }

  if (!Number.isFinite(discount) || discount <= 0) {
    console.error('❌ Desconto inválido.');
    process.exit(1);
  }

  const prefixRaw = sponsor.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = (prefixRaw || 'SPN').slice(0, 4);

  const rows = [];
  const now = new Date();

  for (let i = 0; i < qtd; i++) {
    const unique = randomBytes(3).toString('hex').toUpperCase(); // 6 chars
    const code = `${prefix}-${unique}`;
    rows.push({ code, sponsor, discount_extra: discount, created_at: now });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of rows) {
      await client.query(
        `INSERT INTO sponsor_vouchers (code, sponsor, discount_extra, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO NOTHING`,
        [r.code, r.sponsor, r.discount_extra, r.created_at]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Inseridos ${rows.length} códigos para ${sponsor}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao inserir códigos:', err);
    process.exit(1);
  } finally {
    client.release();
  }

  // Exportar CSV simples
  const header = 'code;sponsor;discount_extra;created_at\n';
  const lines = rows.map(r =>
    `${r.code};${r.sponsor};${r.discount_extra};${r.created_at.toISOString()}`
  );
  const csv = header + lines.join('\n');

  const filename = `sponsor-vouchers-${prefix}-${Date.now()}.csv`;
  const filepath = path.join(process.cwd(), filename);
  fs.writeFileSync(filepath, csv);
  console.log(`📄 CSV gerado: ${filepath}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
