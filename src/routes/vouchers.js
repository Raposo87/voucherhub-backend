import express from 'express';
import { pool } from '../db.js';

const router = express.Router();
/**
 * GET /api/vouchers/validate/:code
 * Retorna informações sobre o voucher e seu status
 */
router.get("/validate/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const { rows } = await pool.query("SELECT * FROM vouchers WHERE code = $1", [code]);

    if (!rows.length) {
      return res.status(404).json({ valid: false, message: "Voucher não encontrado." });
    }

    const voucher = rows[0];
    const now = new Date();

    // Verifica status
    if (voucher.status === "used") {
      return res.json({ valid: false, status: "used", message: "Voucher já foi utilizado.", voucher });
    }

    if (voucher.expires_at && new Date(voucher.expires_at) < now) {
      return res.json({ valid: false, status: "expired", message: "Voucher expirado.", voucher });
    }

    // Voucher ativo
    return res.json({
      valid: true,
      status: voucher.status,
      message: "Voucher válido.",
      voucher: {
        code: voucher.code,
        partner_slug: voucher.partner_slug,
        email: voucher.email,
        amount_cents: voucher.amount_cents,
        currency: voucher.currency,
        created_at: voucher.created_at,
        expires_at: voucher.expires_at
      }
    });
  } catch (err) {
    console.error("Erro ao validar voucher:", err);
    res.status(500).json({ valid: false, message: "Erro interno do servidor." });
  }
});

/**
 * POST /api/vouchers/use/:code
 * Marca o voucher como "used", exigindo um PIN de parceiro
 */
router.post("/use/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({ error: "PIN é obrigatório." });
    }

    // 1) Buscar o voucher
    const result = await pool.query("SELECT * FROM vouchers WHERE code = $1", [code]);
    if (!result.rows.length) {
      return res.status(404).json({ error: "Voucher não encontrado." });
    }
    const voucher = result.rows[0];

    // 2) Buscar o PIN do parceiro na tabela partners
    const partnerRes = await pool.query(
      "SELECT pin FROM partners WHERE slug = $1",
      [voucher.partner_slug]
    );

    if (!partnerRes.rows.length) {
      return res.status(403).json({ error: "Parceiro não encontrado ou não autorizado." });
    }

    const expectedPin = partnerRes.rows[0].pin;

    // 3) Validar PIN
    if (pin !== expectedPin) {
      return res.status(403).json({ error: "PIN incorreto." });
    }

    // 4) Se já usado → bloqueia
    if (voucher.status === "used") {
      return res.status(400).json({ error: "Este voucher já foi utilizado." });
    }

    // 5) Atualizar status
    await pool.query(
      "UPDATE vouchers SET status = 'used', used_at = NOW() WHERE code = $1",
      [code]
    );

    console.log(`✅ Voucher ${code} marcado como usado (${voucher.partner_slug})`);

    res.json({ success: true, message: "Voucher marcado como usado com sucesso." });
  } catch (err) {
    console.error("Erro ao marcar voucher como usado:", err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

export default router;