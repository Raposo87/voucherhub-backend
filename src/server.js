import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config.js";

import paymentsRouter, { handleWebhook } from "./routes/payments.js";
import vouchersRouter from "./routes/vouchers.js";
import partnersRouter from "./routes/partners.js";
import { initDb } from "./db.js";

const app = express();

// =============================================================
// 1️⃣ CORS
// =============================================================
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://voucherhub.pt",
  "https://www.voucherhub.pt",
  "https://voucherhub-backend-production.up.railway.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS not allowed"), false);
  },
};

app.use(cors(corsOptions));


// =============================================================
// 2️⃣ WEBHOOK STRIPE — DEVE VIR ANTES DO EXPRESS.JSON()
// =============================================================
app.post(
  "/api/payments/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook
);


// =============================================================
// 3️⃣ EXPRESS.JSON PARA TODAS AS OUTRAS ROTAS
// =============================================================
app.use(express.json());


// =============================================================
// 4️⃣ ROTAS NORMAIS
// =============================================================
app.use("/api/payments", paymentsRouter);
app.use("/api/vouchers", vouchersRouter);
app.use("/api/partners", partnersRouter);


// =============================================================
// HEALTH CHECK
// =============================================================
app.get("/health", (req, res) => res.status(200).json({ ok: true }));


// =============================================================
// START SERVER
// =============================================================
const port = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(port, "0.0.0.0", () =>
    console.log(`🚀 Backend rodando na porta ${port}`)
  );
});
