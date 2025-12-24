// scripts/check-transfers-status.js
// Script para verificar status de transfers e vouchers
import 'dotenv/config.js';
import { pool } from '../src/db.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

function getArg(flag, def = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

async function checkTransferStatus(paymentIntentId) {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      created: new Date(pi.created * 1000).toISOString(),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function checkStripeTransfer(transferId) {
  if (!transferId) return null;
  try {
    const transfer = await stripe.transfers.retrieve(transferId);
    return {
      id: transfer.id,
      amount: transfer.amount,
      destination: transfer.destination,
      status: transfer.status,
      created: new Date(transfer.created * 1000).toISOString(),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function run() {
  const paymentIntentId = getArg('--pi');
  const allFlag = getArg('--all');

  const client = await pool.connect();

  try {
    if (paymentIntentId) {
      // Verificar um Payment Intent específico
      console.log(`\n🔍 Verificando Payment Intent: ${paymentIntentId}\n`);
      
      const voucherRes = await client.query(
        `SELECT 
          v.*, 
          p.name as partner_name,
          p.stripe_account_id
        FROM vouchers v
        LEFT JOIN partners p ON v.partner_slug = p.slug
        WHERE v.stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );

      if (voucherRes.rows.length === 0) {
        console.log('❌ Nenhum voucher encontrado para este Payment Intent');
        return;
      }

      const voucher = voucherRes.rows[0];
      
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📄 INFORMAÇÕES DO VOUCHER');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`Código: ${voucher.code}`);
      console.log(`Status: ${voucher.status}`);
      console.log(`Parceiro: ${voucher.partner_name || voucher.partner_slug}`);
      console.log(`Valor: €${(voucher.amount_cents / 100).toFixed(2)}`);
      console.log(`Partner Share: €${(voucher.partner_share_cents / 100).toFixed(2)}`);
      console.log(`Transfer Status: ${voucher.transfer_status || 'pending'}`);
      console.log(`Transfer ID: ${voucher.stripe_transfer_id || 'N/A'}`);
      console.log(`Usado em: ${voucher.used_at || 'Não usado ainda'}`);
      console.log(`Criado em: ${voucher.created_at}`);
      console.log(`Expira em: ${voucher.expires_at}`);

      // Verificar Payment Intent no Stripe
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('💳 PAYMENT INTENT NO STRIPE');
      console.log('═══════════════════════════════════════════════════════════');
      const piStatus = await checkTransferStatus(paymentIntentId);
      if (piStatus.error) {
        console.log(`❌ Erro ao buscar Payment Intent: ${piStatus.error}`);
      } else {
        console.log(`Status: ${piStatus.status}`);
        console.log(`Valor: €${(piStatus.amount / 100).toFixed(2)} ${piStatus.currency}`);
        console.log(`Criado: ${piStatus.created}`);
      }

      // Verificar Transfer no Stripe (se existe)
      if (voucher.stripe_transfer_id) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('💰 TRANSFER NO STRIPE');
        console.log('═══════════════════════════════════════════════════════════');
        const transferStatus = await checkStripeTransfer(voucher.stripe_transfer_id);
        if (transferStatus?.error) {
          console.log(`❌ Erro ao buscar Transfer: ${transferStatus.error}`);
        } else if (transferStatus) {
          console.log(`Transfer ID: ${transferStatus.id}`);
          console.log(`Status: ${transferStatus.status}`);
          console.log(`Valor: €${(transferStatus.amount / 100).toFixed(2)}`);
          console.log(`Destino (Account ID): ${transferStatus.destination}`);
          console.log(`Criado: ${transferStatus.created}`);
        }
      } else {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('⚠️  TRANSFER AINDA NÃO CRIADA');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('Isso é NORMAL se o voucher ainda não foi validado pelo parceiro.');
        console.log('O dinheiro está retido (Escrow) aguardando validação.');
        
        if (voucher.partner_share_cents > 0 && voucher.status === 'valid') {
          console.log('\n💡 O voucher está válido e aguardando uso.');
          console.log('   Quando o parceiro validar, a transfer será criada automaticamente.');
        }
      }

      console.log('\n═══════════════════════════════════════════════════════════\n');

    } else if (allFlag) {
      // Listar todos os vouchers e seu status
      console.log('\n📊 STATUS DE TODOS OS VOUCHERS\n');
      
      const vouchersRes = await client.query(
        `SELECT 
          v.code,
          v.stripe_payment_intent_id,
          v.status,
          v.transfer_status,
          v.stripe_transfer_id,
          v.amount_cents,
          v.partner_share_cents,
          v.used_at,
          v.created_at,
          p.name as partner_name,
          p.stripe_account_id
        FROM vouchers v
        LEFT JOIN partners p ON v.partner_slug = p.slug
        ORDER BY v.created_at DESC
        LIMIT 50`
      );

      console.log('═══════════════════════════════════════════════════════════');
      console.log(`Total de vouchers: ${vouchersRes.rows.length}`);
      console.log('═══════════════════════════════════════════════════════════\n');

      const stats = {
        total: vouchersRes.rows.length,
        valid: 0,
        used: 0,
        transferred: 0,
        pending: 0,
        failed: 0,
      };

      vouchersRes.rows.forEach((v, index) => {
        const status = v.status;
        const transferStatus = v.transfer_status || 'pending';
        
        if (status === 'valid') stats.valid++;
        if (status === 'used') stats.used++;
        if (transferStatus === 'success' || transferStatus?.includes('success')) stats.transferred++;
        if (transferStatus === 'pending' || !transferStatus) stats.pending++;
        if (transferStatus?.includes('failed')) stats.failed++;

        console.log(`${index + 1}. ${v.code}`);
        console.log(`   Payment Intent: ${v.stripe_payment_intent_id}`);
        console.log(`   Status: ${status} | Transfer: ${transferStatus || 'pending'}`);
        console.log(`   Parceiro: ${v.partner_name || v.partner_slug}`);
        console.log(`   Valor: €${(v.amount_cents / 100).toFixed(2)} → Parceiro: €${(v.partner_share_cents / 100).toFixed(2)}`);
        if (v.stripe_transfer_id) {
          console.log(`   Transfer ID: ${v.stripe_transfer_id} ✅`);
        } else if (status === 'used') {
          console.log(`   ⚠️  Usado mas sem Transfer ID (pode ter falhado)`);
        } else {
          console.log(`   ⏳ Aguardando validação (Escrow)`);
        }
        console.log(`   Criado: ${v.created_at}`);
        if (v.used_at) console.log(`   Usado: ${v.used_at}`);
        console.log('');
      });

      console.log('═══════════════════════════════════════════════════════════');
      console.log('📈 ESTATÍSTICAS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`Total: ${stats.total}`);
      console.log(`Válidos (não usados): ${stats.valid}`);
      console.log(`Usados: ${stats.used}`);
      console.log(`Transferidos com sucesso: ${stats.transferred}`);
      console.log(`Pendentes (aguardando validação): ${stats.pending}`);
      console.log(`Falhas na transfer: ${stats.failed}`);
      console.log('═══════════════════════════════════════════════════════════\n');

    } else {
      console.error('❌ Use:');
      console.error('   node check-transfers-status.js --pi=pi_xxx (verificar um Payment Intent)');
      console.error('   node check-transfers-status.js --all (listar todos)');
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Erro:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

