import { Router } from "express";
import Stripe from "stripe";
import { pool } from "../db.js";

const router = Router();
// Certifique-se de que a variável STRIPE_SECRET_KEY é a de PRODUÇÃO
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ==========================================================
// ROTA PARA INICIAR O ONBOARDING DE UM PARCEIRO
// POST /api/partners/create-onboarding-link
// 
// O frontend envia { partnerSlug: 'nome-do-parceiro', partnerEmail: 'email@parceiro.com' }
// ==========================================================
router.post("/create-onboarding-link", async (req, res) => {
  // Assume que o frontend envia o slug e o email do parceiro
  const { partnerSlug, partnerEmail } = req.body;
  const client = await pool.connect();

  if (!partnerSlug) {
    return res.status(400).json({ error: "Slug e Email do parceiro são obrigatórios." });
  }

  try {
    // 1. Buscar o parceiro no DB
    const partnerRes = await client.query(
      "SELECT id, stripe_account_id FROM partners WHERE slug=$1",
      [partnerSlug]
    );

    if (!partnerRes.rows.length) {
      return res.status(404).json({ error: "Parceiro não encontrado." });
    }

    const partner = partnerRes.rows[0];
    let accountId = partner.stripe_account_id;

    // --- 2. Cria ou Reutiliza a Conta Stripe ---
    if (!accountId) {
      console.log(`Criando nova conta Stripe Express para: ${partnerSlug}`);
      
      // Cria a conta Express na Stripe
      const account = await stripe.accounts.create({
        type: 'express', 
        country: 'PT', // ⚠️ IMPORTANTE: Defina o país do parceiro
        email: partnerEmail,
        metadata: {
            partner_slug: partnerSlug,
            partner_db_id: partner.id.toString(),
        },
        // Pedir as capacidades necessárias para receber pagamentos e transferências
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;

      // 3. SALVAR o accountId IMEDIATAMENTE no seu DB
      // Usamos o 'client' dentro da transação para garantir que, se algo falhar, o DB não seja atualizado
      await client.query(
        "UPDATE partners SET stripe_account_id = $1 WHERE slug = $2",
        [accountId, partnerSlug]
      );
    }
    
    // --- 4. Gerar o Link de Onboarding (URL) ---
    // Defina os URLs do seu frontend para Sucesso/Erro
    const FRONTEND_BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      // O parceiro será redirecionado para estas páginas após preencher os dados
      refresh_url: `${FRONTEND_BASE_URL}/partner/onboarding-refresh?slug=${partnerSlug}`, 
      return_url: `${FRONTEND_BASE_URL}/partner/onboarding-success?slug=${partnerSlug}`,
      type: 'account_onboarding',
      collect: 'currently_due', // Pede apenas os dados em falta
    });

    // 5. Retornar o URL para o frontend
    return res.json({ url: accountLink.url, accountId: accountId, message: "Use este URL para redirecionar o parceiro para o onboarding Stripe." });

  } catch (err) {
    console.error("❌ ERRO ONBOARDING:", err);
    return res.status(500).json({ error: "Erro ao criar o link de onboarding Stripe." });
  } finally {
    client.release();
  }
});

export default router;