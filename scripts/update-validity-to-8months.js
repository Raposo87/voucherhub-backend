// scripts/update-validity-to-8months.js
// Script para atualizar a validade de todos os parceiros para 240 dias (8 meses)
import 'dotenv/config.js';
import { pool } from '../src/db.js';

async function run() {
    console.log('🔄 Atualizando validade dos vouchers para 8 meses (240 dias)...\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar quantos parceiros serão afetados
        const checkResult = await client.query(
            `SELECT COUNT(*) as count FROM partners WHERE voucher_validity_days IS NOT NULL`
        );
        const count = parseInt(checkResult.rows[0].count, 10);

        console.log(`📊 Encontrados ${count} parceiros para atualizar.\n`);

        // Atualizar todos os parceiros para 240 dias
        const updateResult = await client.query(
            `UPDATE partners 
       SET voucher_validity_days = 240
       WHERE voucher_validity_days IS NOT NULL
       RETURNING slug, name, voucher_validity_days`
        );

        await client.query('COMMIT');

        console.log(`✅ ${updateResult.rowCount} parceiros atualizados com sucesso!\n`);
        console.log('📝 Parceiros atualizados:');
        updateResult.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.name} (${row.slug}) → ${row.voucher_validity_days} dias`);
        });

        console.log('\n💡 IMPORTANTE:');
        console.log('   - Novos vouchers usarão 240 dias (8 meses) de validade');
        console.log('   - Vouchers já criados NÃO serão alterados');
        console.log('   - Apenas novos vouchers usarão a nova validade\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao atualizar validade:', err);
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
