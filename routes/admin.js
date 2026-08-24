const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();
router.use(requireAdmin);

async function fetchUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.cpf, u.is_admin, u.is_super, u.created_at,
            COALESCE(json_agg(m.slug) FILTER (WHERE m.id IS NOT NULL), '[]') AS modules
     FROM users u
     LEFT JOIN user_modules um ON um.user_id = u.id
     LEFT JOIN modules m ON m.id = um.module_id
     GROUP BY u.id
     ORDER BY u.name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    cpf: r.cpf,
    isAdmin: r.is_admin,
    isSuper: r.is_super,
    createdAt: r.created_at,
    modules: r.modules,
  }));
}

async function setUserModules(client, userId, slugs) {
  await client.query("DELETE FROM user_modules WHERE user_id = $1", [userId]);
  if (!slugs || !slugs.length) return;
  const { rows } = await client.query(
    "SELECT id, slug FROM modules WHERE slug = ANY($1::text[])",
    [slugs]
  );
  for (const row of rows) {
    await client.query(
      "INSERT INTO user_modules (user_id, module_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, row.id]
    );
  }
}

router.get("/modules", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT slug, name, status FROM modules ORDER BY sort_order"
  );
  res.json(rows);
});

router.get("/users", async (req, res) => {
  res.json(await fetchUsers());
});

router.post("/users", async (req, res) => {
  const { name, email, cpf: rawCpf, senha, modules, isAdmin } = req.body || {};
  const cpf = String(rawCpf || "").replace(/\D/g, "");

  if (!name || !cpf || cpf.length !== 11 || !senha) {
    return res.status(400).json({ error: "Informe nome, CPF (11 dígitos) e senha." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hash = await bcrypt.hash(senha, 10);
    const inserted = await client.query(
      `INSERT INTO users (name, email, cpf, password_hash, is_admin)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, email || null, cpf, hash, !!isAdmin]
    );
    await setUserModules(client, inserted.rows[0].id, modules);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Já existe um usuário com esse CPF." });
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ ok: true, users: await fetchUsers() });
});

router.put("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, cpf: rawCpf, senha, modules, isAdmin } = req.body || {};
  const cpf = String(rawCpf || "").replace(/\D/g, "");

  if (!name || !cpf || cpf.length !== 11) {
    return res.status(400).json({ error: "Informe nome e CPF (11 dígitos)." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (senha) {
      const hash = await bcrypt.hash(senha, 10);
      await client.query(
        "UPDATE users SET name=$1, email=$2, cpf=$3, is_admin=$4, password_hash=$5 WHERE id=$6",
        [name, email || null, cpf, !!isAdmin, hash, id]
      );
    } else {
      await client.query(
        "UPDATE users SET name=$1, email=$2, cpf=$3, is_admin=$4 WHERE id=$5",
        [name, email || null, cpf, !!isAdmin, id]
      );
    }
    await setUserModules(client, id, modules);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Já existe um usuário com esse CPF." });
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true, users: await fetchUsers() });
});

router.delete("/users/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const target = await pool.query("SELECT is_admin, is_super FROM users WHERE id = $1", [id]);
  if (!target.rows.length) return res.status(404).json({ error: "Usuário não encontrado." });

  if (target.rows[0].is_super) {
    return res.status(400).json({ error: "Não é possível remover o usuário super-administrador." });
  }

  if (target.rows[0].is_admin) {
    const admins = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE is_admin = true");
    if (admins.rows[0].n <= 1) {
      return res.status(400).json({ error: "Não é possível remover o último administrador." });
    }
  }

  await pool.query("DELETE FROM users WHERE id = $1", [id]);
  res.json({ ok: true, users: await fetchUsers() });
});

module.exports = router;
