import express from 'express';
import { pool } from '../db.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Função para gerar PIN de 4 dígitos aleatórios
const generatePIN = () => Math.floor(1000 + Math.random() * 9000).toString();

router.post('/setup-partner', async (req, res) => {
  const { 
    slug, 
    name, 
    email, 
    phone, 
    location, 
    price_cents
  } = req.body;

  // GERAÇÃO AUTOMÁTICA DO PIN
  const autoPin = generatePIN();

  try {
    console.log(`[Admin] Iniciando criação do parceiro: ${name} (${slug})`);

    // 1. Criar conta na Stripe (Connect Express)
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      capabilities: {
        transfers: { requested: true },
      },
    });

    // 2. Salvar na Railway com as 9 colunas
    await pool.query(`
      INSERT INTO partners (
        slug, name, email, phone, location, 
        price_original_cents, voucher_validity_days, pin, stripe_account_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (slug) DO UPDATE SET 
        stripe_account_id = EXCLUDED.stripe_account_id,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        location = EXCLUDED.location,
        price_original_cents = EXCLUDED.price_original_cents;
    `, [
      slug, 
      name, 
      email, 
      phone || '', 
      location || '', 
      price_cents || 0, 
      60,       
      autoPin,  
      account.id
    ]);

    // 3. Gerar link de Onboarding da Stripe
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'https://voucherhub.pt', 
      return_url: 'https://voucherhub.pt',
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      message: "Parceiro cadastrado com sucesso!",
      pin_gerado: autoPin,
      onboarding_url: accountLink.url
    });

  } catch (error) {
    console.error('[Admin Error]:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ROTA DE AUDITORIA DE REPASSES PRESOS
router.get('/audit-transfers', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          code, 
          partner_slug, 
          (amount_cents / 100.0) as valor_total,
          ((amount_cents * 0.8) / 100.0) as deve_receber,
          transfer_error_msg,
          used_at
        FROM vouchers 
        WHERE status = 'used' 
        AND transfer_status = 'failed:stripe_error'
      `);
  
      if (result.rows.length === 0) {
        return res.json({ message: "✅ Tudo em dia! Nenhum repasse pendente." });
      }
  
      res.json({
        message: "⚠️ Atenção: Existem repasses que falharam!",
        total_pendente: result.rows.length,
        vouchers: result.rows
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- NOVAS ROTAS PARA GESTÃO DE STOCK ---

// 1. Listar todos os limites de stock atuais
router.get("/stock-list", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM offer_inventory ORDER BY partner_slug ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao procurar stocks" });
  }
});

// 2. Atualizar ou Criar um limite
router.post("/update-stock", async (req, res) => {
  const { partner_slug, offer_title, stock_limit } = req.body;
  try {
    await pool.query(
      `INSERT INTO offer_inventory (partner_slug, offer_title, stock_limit) 
       VALUES ($1, $2, $3)
       ON CONFLICT (partner_slug, offer_title) 
       DO UPDATE SET stock_limit = $3`,
      [partner_slug, offer_title, stock_limit]
    );
    res.json({ success: true, message: "Stock atualizado com sucesso!" });
  } catch (err) {
    console.error("Erro ao atualizar stock:", err);
    res.status(500).json({ success: false, error: "Erro ao atualizar stock" });
  }
});

export default router;