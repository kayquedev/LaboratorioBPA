"use strict";

const { norm, limpo, digitos, TIPOS_IMOVEL } = require("./texto");

// Campos que qualquer cliente (painel/app) pode editar num domicílio importado.
const CAMPOS_LIVRES = ["complemento", "ponto_referencia", "tipo_imovel", "observacao", "lat", "lng", "precisao_m", "coletado_em"];
// Endereço só é editável em domicílio criado à mão (o importado é a fonte oficial).
const CAMPOS_ENDERECO = ["microarea", "tipo_logradouro", "logradouro", "numero", "cep", "bairro"];

const SELECT_DOM = `
  SELECT d.id, d.microarea, d.tipo_logradouro, d.logradouro, d.numero, d.complemento, d.cep, d.bairro,
         d.ponto_referencia, d.tipo_imovel, d.observacao, d.lat, d.lng, d.precisao_m, d.coletado_em,
         d.origem, d.excluido, d.atualizado_em,
         (SELECT count(*)::int FROM km_cidadao c WHERE c.domicilio_id = d.id) AS moradores,
         COALESCE((SELECT json_agg(json_build_object(
              'id', f.id, 'responsavel_nome', f.responsavel_nome, 'responsavel_cpf', f.responsavel_cpf,
              'responsavel_cns', f.responsavel_cns, 'prontuario', f.prontuario) ORDER BY f.responsavel_nome)
            FROM km_familia f WHERE f.domicilio_id = d.id), '[]'::json) AS familias
  FROM km_domicilio d`;

// Busca sem acento/caixa sem depender da extensão unaccent do Postgres.
const sa = (expr) => `translate(upper(${expr}), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')`;

function validaCoord(lat, lng) {
  if (lat == null && lng == null) return null;
  const a = Number(lat);
  const o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) throw new Error("Coordenada inválida.");
  return [a, o];
}

function valorCampo(campo, v) {
  if (campo === "tipo_imovel") {
    const t = String(v || "").toUpperCase().trim();
    if (!TIPOS_IMOVEL.includes(t)) throw new Error(`Tipo de imóvel inválido: ${v}`);
    return t;
  }
  if (campo === "lat" || campo === "lng" || campo === "precisao_m") return v == null || v === "" ? null : Number(v);
  if (campo === "coletado_em") return v ? new Date(v) : null;
  return limpo(v);
}

async function listaFamilias(db, domicilioId, familias, agora) {
  for (const f of familias || []) {
    const nome = limpo(f.responsavel_nome);
    const cpf = digitos(f.responsavel_cpf);
    const cpfOk = cpf.length === 11 ? cpf : null;
    if (f.id) {
      const r = await db.query(
        `UPDATE km_familia SET responsavel_nome = $3, responsavel_cpf = $4, prontuario = $5, atualizado_em = $6
         WHERE id = $1 AND domicilio_id = $2`,
        [f.id, domicilioId, nome, cpfOk, limpo(f.prontuario), agora]
      );
      if (r.rowCount) continue;
    }
    if (!nome && !cpfOk) continue;
    await db.query(
      `INSERT INTO km_familia (id, domicilio_id, resp_chave, responsavel_nome, responsavel_cpf, prontuario, atualizado_em)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
       ON CONFLICT (domicilio_id, resp_chave) DO UPDATE SET responsavel_nome = EXCLUDED.responsavel_nome,
         responsavel_cpf = EXCLUDED.responsavel_cpf, prontuario = EXCLUDED.prontuario, atualizado_em = EXCLUDED.atualizado_em`,
      [f.id || null, domicilioId, cpfOk || norm(nome), nome, cpfOk, limpo(f.prontuario), agora]
    );
  }
}

// Cria ou atualiza um domicílio (usado pelo painel e pelo sync do app).
async function salvarDomicilio(db, dados, { origem }) {
  const agora = new Date();
  validaCoord(dados.lat, dados.lng);
  const exist = dados.id ? (await db.query("SELECT id, origem FROM km_domicilio WHERE id = $1", [dados.id])).rows[0] : null;

  if (!exist) {
    const d = {};
    for (const c of [...CAMPOS_LIVRES, ...CAMPOS_ENDERECO]) if (c in dados) d[c] = valorCampo(c, dados[c]);
    if (!d.logradouro && !d.complemento && !d.ponto_referencia) throw new Error("Informe ao menos o logradouro ou um ponto de referência.");
    const r = await db.query(
      `INSERT INTO km_domicilio (id, microarea, tipo_logradouro, logradouro, numero, complemento, cep, bairro, ponto_referencia,
                                 tipo_imovel, observacao, lat, lng, precisao_m, coletado_em, origem, atualizado_em)
       VALUES (COALESCE($1, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10,'SEM INFO'), $11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [dados.id || null, d.microarea ?? null, d.tipo_logradouro ?? null, d.logradouro ?? null, d.numero ?? null, d.complemento ?? null,
       d.cep ?? null, d.bairro ?? null, d.ponto_referencia ?? null, d.tipo_imovel ?? null, d.observacao ?? null,
       d.lat ?? null, d.lng ?? null, d.precisao_m ?? null, d.coletado_em ?? null, origem, agora]
    );
    await listaFamilias(db, r.rows[0].id, dados.familias, agora);
    return { id: r.rows[0].id, criado: true };
  }

  const permitidos = exist.origem === "app" || exist.origem === "painel" ? [...CAMPOS_LIVRES, ...CAMPOS_ENDERECO] : CAMPOS_LIVRES;
  const sets = [];
  const vals = [exist.id];
  for (const c of permitidos) {
    if (!(c in dados)) continue;
    vals.push(valorCampo(c, dados[c]));
    sets.push(`${c} = $${vals.length}`);
  }
  if ("excluido" in dados && (exist.origem === "app" || exist.origem === "painel")) {
    vals.push(!!dados.excluido);
    sets.push(`excluido = $${vals.length}`);
  }
  vals.push(agora);
  sets.push(`atualizado_em = $${vals.length}`);
  await db.query(`UPDATE km_domicilio SET ${sets.join(", ")} WHERE id = $1`, vals);
  await listaFamilias(db, exist.id, dados.familias, agora);
  return { id: exist.id, criado: false };
}

async function obterDomicilio(db, id) {
  return (await db.query(`${SELECT_DOM} WHERE d.id = $1`, [id])).rows[0] || null;
}

async function listarDomicilios(db, { microarea, q, status, limite = 500, deslocamento = 0 } = {}) {
  const w = ["NOT d.excluido"];
  const v = [];
  if (microarea) { v.push(microarea); w.push(`d.microarea = $${v.length}`); }
  if (status === "coletado") w.push("d.lat IS NOT NULL");
  if (status === "pendente") w.push("d.lat IS NULL");
  if (q) {
    v.push(`%${norm(q)}%`);
    w.push(`(${sa("coalesce(d.logradouro,'') || ' ' || coalesce(d.numero,'') || ' ' || coalesce(d.complemento,'')")} LIKE $${v.length}
             OR EXISTS (SELECT 1 FROM km_familia f WHERE f.domicilio_id = d.id AND ${sa("coalesce(f.responsavel_nome,'')")} LIKE $${v.length}))`);
  }
  const where = w.join(" AND ");
  const total = (await db.query(`SELECT count(*)::int AS n FROM km_domicilio d WHERE ${where}`, v)).rows[0].n;
  v.push(limite, deslocamento);
  const rows = (await db.query(
    `${SELECT_DOM} WHERE ${where} ORDER BY d.microarea NULLS LAST, d.logradouro, NULLIF(regexp_replace(d.numero,'\\D','','g'),'')::bigint NULLS LAST, d.complemento
     LIMIT $${v.length - 1} OFFSET $${v.length}`, v)).rows;
  return { total, domicilios: rows };
}

async function resumo(db) {
  const r = (await db.query(
    `SELECT d.microarea, count(*)::int AS domicilios,
            count(*) FILTER (WHERE d.lat IS NOT NULL)::int AS coletados,
            (SELECT count(*)::int FROM km_familia f JOIN km_domicilio d2 ON d2.id = f.domicilio_id
               WHERE NOT d2.excluido AND d2.microarea IS NOT DISTINCT FROM d.microarea) AS familias
     FROM km_domicilio d WHERE NOT d.excluido GROUP BY d.microarea ORDER BY d.microarea NULLS LAST`)).rows;
  const sem = (await db.query("SELECT count(*)::int AS n FROM km_cidadao WHERE domicilio_id IS NULL")).rows[0].n;
  return { microareas: r, cidadaos_sem_domicilio: sem };
}

async function changesDesde(db, desde) {
  const agora = (await db.query("SELECT now() AS t")).rows[0].t;
  const d = desde ? new Date(desde) : new Date(0);
  const rows = (await db.query(`${SELECT_DOM} WHERE d.atualizado_em > $1 ORDER BY d.atualizado_em`, [d])).rows;
  return { servidor_agora: agora, domicilios: rows };
}

// ── Exportação MyMaps ──────────────────────────────────────────────────────
const COLUNAS_MYMAPS = ["WKT", "nome", "Tipo Imovel", "Nº Prontuário Familiar", "Responsavel Familiar", "CPF", "Endereco", "Complemento", "Ponto de Referencia", "descrição"];

function csvCampo(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fmtCpf(c) {
  const d = digitos(c);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : "";
}

function enderecoTexto(d) {
  const rua = [d.tipo_logradouro, d.logradouro].filter(Boolean).join(" ");
  return [rua, d.numero].filter(Boolean).join(", ");
}

// Uma linha por família, no ponto do domicílio. Domicílio sem família sai
// numa linha só, com o endereço no `nome`.
function linhasMyMaps(domicilios) {
  const out = [];
  for (const d of domicilios) {
    if (d.lat == null || d.lng == null) continue;
    const wkt = `POINT (${Number(d.lng)} ${Number(d.lat)})`;
    const end = enderecoTexto(d);
    const desc = [d.microarea ? `Microárea ${d.microarea}` : null, d.observacao].filter(Boolean).join(" | ");
    const familias = d.familias && d.familias.length ? d.familias : [null];
    for (const f of familias) {
      const resp = f && f.responsavel_nome;
      out.push([wkt, resp || end || "Domicílio", d.tipo_imovel, f && f.prontuario, resp, f && fmtCpf(f.responsavel_cpf), end, d.complemento, d.ponto_referencia, desc]);
    }
  }
  return out;
}

function csvMyMaps(domicilios) {
  const linhas = [COLUNAS_MYMAPS, ...linhasMyMaps(domicilios)];
  return linhas.map((l) => l.map(csvCampo).join(",")).join("\r\n") + "\r\n";
}

module.exports = {
  salvarDomicilio, obterDomicilio, listarDomicilios, resumo, changesDesde,
  csvMyMaps, linhasMyMaps, COLUNAS_MYMAPS, enderecoTexto, fmtCpf,
};
