"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const pool = require("../db/pool");
const { loadUserFromRequest, loadUserById } = require("../middleware/auth");
const { importaTerritorio, importaVinculados } = require("../lib/kodemaps/importador");
const repo = require("../lib/kodemaps/repo");
const { CAMADAS, LIMITES_MUNICIPIO, estilo } = require("../lib/kodemaps/estilo");

const SLUG = "kode-maps";
const AUD_APP = "kode-maps-app";
const TOKEN_APP_TTL = "180d";

// Monta o router recebendo o "db" (pool.query) — facilita testar com outro banco.
function criarRouter(db = pool) {
  const router = express.Router();
  // Importação manda milhares de linhas; este parser precisa vir antes do global.
  router.use(express.json({ limit: "25mb" }));
  router.use(cookieParser());

  const temAcesso = (u) => u && (u.isAdmin || u.grantedSlugs.includes(SLUG));

  async function usuarioDaRequisicao(req) {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) {
      try {
        const p = jwt.verify(auth.slice(7), process.env.JWT_SECRET, { audience: AUD_APP });
        const u = await loadUserById(p.sub);
        return temAcesso(u) ? u : null;
      } catch (e) {
        return null;
      }
    }
    const u = await loadUserFromRequest(req);
    return temAcesso(u) ? u : null;
  }

  const exigeAcesso = (req, res, next) => {
    usuarioDaRequisicao(req).then((u) => {
      if (!u) return res.status(401).json({ error: "Não autenticado." });
      req.user = u;
      next();
    }).catch(next);
  };

  const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch((e) => {
    if (e && e.expose) return res.status(400).json({ error: e.message });
    next(e);
  });
  const pedidoRuim = (msg) => Object.assign(new Error(msg), { expose: true });
  const comMensagem = (fn) => async (...a) => {
    try { return await fn(...a); } catch (e) {
      if (!e.expose && /inválid|Informe|Não achei|obrigat/i.test(e.message)) e.expose = true;
      throw e;
    }
  };

  // ── públicas (o MapLibre baixa o estilo sem enviar login) ────────────────
  router.get("/estilo.json", (req, res) => {
    const camada = req.query.camada || "satelite";
    if (!CAMADAS.includes(camada)) return res.status(400).json({ error: `camada deve ser: ${CAMADAS.join(", ")}` });
    res.set("Cache-Control", "public, max-age=3600").json(estilo(camada));
  });
  router.get("/limites", (req, res) => res.json(LIMITES_MUNICIPIO));

  // ── login do app (token de longa duração, só vale para este módulo) ──────
  const tentativas = new Map();
  router.post("/app/login", rota(async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    const agora = Date.now();
    const lista = (tentativas.get(ip) || []).filter((t) => agora - t < 60_000);
    if (lista.length >= 5) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    lista.push(agora);
    tentativas.set(ip, lista);

    const cpf = String((req.body && req.body.cpf) || "").replace(/\D/g, "");
    const senha = (req.body && req.body.senha) || "";
    if (!cpf || !senha) return res.status(400).json({ error: "Informe CPF e senha." });
    const { rows } = await db.query("SELECT * FROM users WHERE cpf = $1", [cpf]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(senha, user.password_hash));
    if (!ok) return res.status(401).json({ error: "CPF ou senha inválidos." });
    const u = await loadUserById(user.id);
    if (!temAcesso(u)) return res.status(403).json({ error: "Seu usuário não tem acesso ao módulo Kode Maps." });
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { audience: AUD_APP, expiresIn: TOKEN_APP_TTL });
    res.json({ token, nome: u.name, limites: LIMITES_MUNICIPIO });
  }));

  // ── sync do app ──────────────────────────────────────────────────────────
  router.get("/app/sync", exigeAcesso, rota(async (req, res) => {
    res.json(await repo.changesDesde(db, req.query.desde));
  }));

  router.post("/app/sync", exigeAcesso, rota(comMensagem(async (req, res) => {
    const alteracoes = Array.isArray(req.body && req.body.alteracoes) ? req.body.alteracoes : null;
    if (!alteracoes) throw pedidoRuim("Informe 'alteracoes'.");
    const resultados = [];
    for (const a of alteracoes) {
      try {
        const r = await repo.salvarDomicilio(db, a, { origem: "app" });
        resultados.push({ id: r.id, ok: true });
      } catch (e) {
        resultados.push({ id: a.id || null, ok: false, erro: e.message });
      }
    }
    res.json({ resultados, servidor_agora: (await db.query("SELECT now() AS t")).rows[0].t });
  })));

  // ── painel ───────────────────────────────────────────────────────────────
  router.get("/resumo", exigeAcesso, rota(async (req, res) => res.json(await repo.resumo(db))));

  router.post("/importar/territorio", exigeAcesso, rota(comMensagem(async (req, res) => {
    const { filtros, linhas } = req.body || {};
    if (!Array.isArray(linhas)) throw pedidoRuim("Envie as linhas do CSV.");
    res.json(await importaTerritorio(db, filtros || {}, linhas));
  })));

  router.post("/importar/vinculados", exigeAcesso, rota(comMensagem(async (req, res) => {
    const { linhas } = req.body || {};
    if (!Array.isArray(linhas)) throw pedidoRuim("Envie as linhas do CSV.");
    res.json(await importaVinculados(db, linhas));
  })));

  router.get("/domicilios", exigeAcesso, rota(async (req, res) => {
    const { microarea, q, status } = req.query;
    const limite = Math.min(Number(req.query.limite) || 200, 1000);
    const deslocamento = Math.max(Number(req.query.deslocamento) || 0, 0);
    res.json(await repo.listarDomicilios(db, { microarea, q, status, limite, deslocamento }));
  }));

  router.get("/domicilios/:id", exigeAcesso, rota(async (req, res) => {
    const d = await repo.obterDomicilio(db, req.params.id);
    if (!d) return res.status(404).json({ error: "Domicílio não encontrado." });
    res.json(d);
  }));

  router.post("/domicilios", exigeAcesso, rota(comMensagem(async (req, res) => {
    const { id, ...dados } = req.body || {};
    res.status(201).json(await repo.salvarDomicilio(db, dados, { origem: "painel" }));
  })));

  router.patch("/domicilios/:id", exigeAcesso, rota(comMensagem(async (req, res) => {
    if (!(await repo.obterDomicilio(db, req.params.id))) return res.status(404).json({ error: "Domicílio não encontrado." });
    res.json(await repo.salvarDomicilio(db, { ...req.body, id: req.params.id }, { origem: "painel" }));
  })));

  router.delete("/domicilios/:id", exigeAcesso, rota(async (req, res) => {
    const r = await db.query("UPDATE km_domicilio SET excluido = true, atualizado_em = now() WHERE id = $1", [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "Domicílio não encontrado." });
    res.json({ ok: true });
  }));

  router.get("/exportar/mymaps.csv", exigeAcesso, rota(async (req, res) => {
    const { domicilios } = await repo.listarDomicilios(db, { microarea: req.query.microarea || undefined, status: "coletado", limite: 100000 });
    const sufixo = req.query.microarea ? `_microarea_${String(req.query.microarea).replace(/\W/g, "")}` : "";
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kode-maps${sufixo}.csv"`,
    }).send(repo.csvMyMaps(domicilios));
  }));

  router.use((req, res) => res.status(404).json({ error: "Rota não encontrada." }));
  return router;
}

module.exports = { criarRouter };
