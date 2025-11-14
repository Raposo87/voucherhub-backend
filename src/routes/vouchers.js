import { Router } from "express";
import { pool } from "../db.js";
import { randomUUID } from "crypto";

const router = Router();

/**
 * POST /api/vouchers
 * Cria um novo voucher com base no slug do parceiro.
 */
router.post("/", async (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug) {
      return res.status(400).json({ error: "Parâmetro 'slug' é obrigatório." });
    }

    // Gera código aleatório de 8 caracteres
    const code = randomUUID().split("-")[0].toUpperCase();

    // Insere no banco
    const insertQuery = `
      INSERT INTO vouchers (code, partner_slug, created_at)
      VALUES ($1, $2, NOW())
      RETURNING id, code, partner_slug, created_at
    `;
    const { rows } = await pool.query(insertQuery, [code, slug]);

    console.log(`🎟️ Novo voucher criado: ${code} (slug: ${slug})`);

    // Responde ao frontend
    return res.status(201).json({
      message: "Voucher criado com sucesso! Você receberá as instruções por e-mail.",
      voucher: rows[0]
    });

  } catch (err) {
    console.error("❌ Erro ao criar voucher:", err);
    return res.status(500).json({ error: "Erro interno ao criar voucher." });
  }
});

/**
 * GET /api/vouchers/:code
 * Busca voucher existente pelo código.
 */
router.get("/:code", async (req, res) => {
  const { code } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM vouchers WHERE code = $1", [code]);
    if (!rows.length) return res.status(404).json({ error: "Voucher não encontrado." });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

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

    // 🔐 PINs temporários por parceiro (pode vir do banco depois)
    const partnerPins = {
      "yoga-kula": "1234",
      "surf-wave-lisbon": "5678",
      "caparica-kite-center": "2468",
      "twolines": "4321"
    };

    const result = await pool.query("SELECT * FROM vouchers WHERE code = $1", [code]);
    if (!result.rows.length) {
      return res.status(404).json({ error: "Voucher não encontrado." });
    }

    const voucher = result.rows[0];
    const expectedPin = partnerPins[voucher.partner_slug];

    if (!expectedPin || pin !== expectedPin) {
      return res.status(403).json({ error: "PIN incorreto ou parceiro não autorizado." });
    }

    if (voucher.status === "used") {
      return res.status(400).json({ error: "Este voucher já foi utilizado." });
    }

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
