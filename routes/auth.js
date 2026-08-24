const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const { setSessionCookie, clearSessionCookie, requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/login", async (req, res) => {
  const cpf = String((req.body && req.body.cpf) || "").replace(/\D/g, "");
  const password = (req.body && req.body.senha) || "";

  if (!cpf || !password) {
    return res.status(400).json({ error: "Informe CPF e senha." });
  }

  const { rows } = await pool.query("SELECT * FROM users WHERE cpf = $1", [cpf]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "CPF ou senha inválidos." });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "CPF ou senha inválidos." });

  setSessionCookie(res, user);
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT slug, name, status, sort_order FROM modules ORDER BY sort_order"
  );
  const modules = rows.map((m) => ({
    slug: m.slug,
    name: m.name,
    status: m.status,
    granted: req.user.isAdmin || req.user.grantedSlugs.includes(m.slug),
  }));

  res.json({
    name: req.user.name,
    email: req.user.email,
    isAdmin: req.user.isAdmin,
    modules,
  });
});

module.exports = router;
