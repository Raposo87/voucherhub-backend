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

export default router;
