"use strict";

const { norm, limpo, digitos, achaColuna } = require("./texto");
const { separaTipo, chaveDomicilio, parseEnderecoVinculados } = require("./endereco");

// Os CSVs são lidos no navegador (parserCsvGenerico) e chegam aqui como lista
// de objetos { "NOME DA COLUNA": valor }. Estas funções só mapeiam e gravam.

function fmtMicro(v) {
  const d = digitos(v);
  if (!d) return limpo(v);
  return d.padStart(2, "0");
}

function microareaDeFiltros(filtros) {
  for (const k of Object.keys(filtros || {})) {
    if (norm(k) === "MICROAREA" || norm(k) === "MICROAREAS") {
      const v = limpo(filtros[k]);
      if (v && norm(v) !== "TODAS") return fmtMicro(v);
    }
  }
  return null;
}

// ── TERRITÓRIO: uma linha por morador/domicílio ────────────────────────────
function mapeiaTerritorio(linhas, microarea) {
  const doms = new Map(); // chave -> { dom, familias: Map, cidadaos: [], notas: Set }
  let ignoradas = 0;
  for (const l of linhas) {
    const tipoLog = achaColuna(l, "TIPO DE LOGRADOURO");
    const logr = achaColuna(l, "LOGRADOURO");
    if (!limpo(logr) && !limpo(tipoLog)) { ignoradas++; continue; }
    const dom = {
      tipo_logradouro: limpo(tipoLog),
      logradouro: limpo(logr),
      numero: limpo(achaColuna(l, "NUMERO")),
      complemento: limpo(achaColuna(l, "COMPLEMENTO")),
      cep: digitos(achaColuna(l, "CEP")) || null,
      bairro: limpo(achaColuna(l, "BAIRRO")),
    };
    if (!dom.tipo_logradouro && dom.logradouro) {
      const s = separaTipo(dom.logradouro);
      dom.tipo_logradouro = s.tipo;
      dom.logradouro = s.logradouro;
    }
    const chave = chaveDomicilio(dom);
    let reg = doms.get(chave);
    if (!reg) {
      reg = {
        dom: { ...dom, chave, ponto_referencia: limpo(achaColuna(l, "PONTO DE REFERENCIA")) },
        familias: new Map(), cidadaos: [], notas: new Set(),
      };
      doms.set(chave, reg);
    }
    const nome = limpo(achaColuna(l, "NOME CIDADAO"));
    const sexo = limpo(achaColuna(l, "SEXO"));
    const cpf = digitos(achaColuna(l, "CPF"));
    const cns = digitos(achaColuna(l, "CNS"));
    // Domicílio sem morador: o e-SUS escreve um aviso na coluna do nome
    // ("O CADASTRO DO IMÓVEL FOI RECUSADO"...), sem sexo/CPF/CNS.
    if (!sexo && !cpf && !cns) {
      if (nome) reg.notas.add(nome);
      continue;
    }
    if (!nome) continue;
    const eResp = norm(achaColuna(l, "É O RESPONSÁVEL FAMILIAR?", "E O RESPONSAVEL FAMILIAR")) === "SIM";
    const respDoc = digitos(achaColuna(l, "CPF/CNS RESPONSÁVEL FAMILIAR"));
    const respNome = limpo(achaColuna(l, "NOME DO RESPONSÁVEL FAMILIAR"));
    const respChave = eResp ? (cpf || cns || norm(nome)) : (respDoc || norm(respNome) || "SEM RESPONSAVEL");
    if (!reg.familias.has(respChave)) {
      reg.familias.set(respChave, { resp_chave: respChave, responsavel_nome: null, responsavel_cpf: null, responsavel_cns: null });
    }
    const fam = reg.familias.get(respChave);
    if (eResp) {
      fam.responsavel_nome = nome;
      fam.responsavel_cpf = cpf.length === 11 ? cpf : (respDoc.length === 11 ? respDoc : null);
      fam.responsavel_cns = cns.length === 15 ? cns : (respDoc.length === 15 ? respDoc : null);
    } else if (!fam.responsavel_nome && respNome) {
      fam.responsavel_nome = respNome;
      if (respDoc.length === 11) fam.responsavel_cpf = respDoc;
      else if (respDoc.length === 15) fam.responsavel_cns = respDoc;
    }
    reg.cidadaos.push({
      chave: cpf || cns || `${norm(nome)}|${limpo(achaColuna(l, "DATA DE NASCIMENTO")) || ""}`,
      nome,
      cpf: cpf.length === 11 ? cpf : null,
      cns: cns.length === 15 ? cns : null,
      microarea,
      e_responsavel: eResp,
      resp_chave: respChave,
    });
  }
  return { doms, ignoradas };
}

async function importaTerritorio(db, filtros, linhas) {
  const micro = microareaDeFiltros(filtros);
  if (!micro) {
    throw new Error("Não achei a Microárea no cabeçalho do arquivo (linha 'Microárea;..'). Exporte o relatório filtrando uma microárea.");
  }
  const { doms, ignoradas } = mapeiaTerritorio(linhas, micro);
  const r = { microarea: micro, domicilios_novos: 0, domicilios_atualizados: 0, excluidos_ignorados: 0, familias: 0, cidadaos: 0, ignoradas };

  for (const reg of doms.values()) {
    const d = reg.dom;
    const exist = (await db.query("SELECT id, excluido FROM km_domicilio WHERE chave = $1", [d.chave])).rows[0];
    let id;
    if (!exist) {
      const tipoPadrao = /\bVAG[OA]\b/.test(norm([...reg.notas].join(" "))) ? "VAGO" : "SEM INFO";
      id = (await db.query(
        `INSERT INTO km_domicilio (chave, microarea, tipo_logradouro, logradouro, numero, complemento, cep, bairro, ponto_referencia, tipo_imovel, observacao, origem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'territorio') RETURNING id`,
        [d.chave, micro, d.tipo_logradouro, d.logradouro, d.numero, d.complemento, d.cep, d.bairro, d.ponto_referencia, tipoPadrao, reg.notas.size ? [...reg.notas].join("; ") : null]
      )).rows[0].id;
      r.domicilios_novos++;
    } else if (exist.excluido) {
      r.excluidos_ignorados++;
      continue;
    } else {
      id = exist.id;
      // Reimportar nunca mexe em GPS, tipo, observação nem ponto de referência.
      await db.query(
        `UPDATE km_domicilio SET microarea = $2, cep = COALESCE(cep, $3), bairro = COALESCE(bairro, $4),
                ponto_referencia = COALESCE(ponto_referencia, $5), atualizado_em = now() WHERE id = $1`,
        [id, micro, d.cep, d.bairro, d.ponto_referencia]
      );
      r.domicilios_atualizados++;
    }
    const famIds = new Map();
    for (const f of reg.familias.values()) {
      const fid = (await db.query(
        `INSERT INTO km_familia (domicilio_id, resp_chave, responsavel_nome, responsavel_cpf, responsavel_cns)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (domicilio_id, resp_chave) DO UPDATE SET
           responsavel_nome = COALESCE(EXCLUDED.responsavel_nome, km_familia.responsavel_nome),
           responsavel_cpf = COALESCE(EXCLUDED.responsavel_cpf, km_familia.responsavel_cpf),
           responsavel_cns = COALESCE(EXCLUDED.responsavel_cns, km_familia.responsavel_cns),
           atualizado_em = now()
         RETURNING id`,
        [id, f.resp_chave, f.responsavel_nome, f.responsavel_cpf, f.responsavel_cns]
      )).rows[0].id;
      famIds.set(f.resp_chave, fid);
      r.familias++;
    }
    for (const c of reg.cidadaos) {
      await db.query(
        `INSERT INTO km_cidadao (chave, nome, cpf, cns, microarea, domicilio_id, familia_id, e_responsavel)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (chave) DO UPDATE SET nome = EXCLUDED.nome, cpf = EXCLUDED.cpf, cns = EXCLUDED.cns,
           microarea = EXCLUDED.microarea, domicilio_id = EXCLUDED.domicilio_id,
           familia_id = EXCLUDED.familia_id, e_responsavel = EXCLUDED.e_responsavel`,
        [c.chave, c.nome, c.cpf, c.cns, c.microarea, id, famIds.get(c.resp_chave), c.e_responsavel]
      );
      r.cidadaos++;
    }
  }
  return r;
}

// ── VINCULADOS: cidadãos com microárea e endereço em texto ─────────────────
async function importaVinculados(db, linhas) {
  const r = { cidadaos: 0, ligados: 0, domicilios_novos: 0, sem_endereco: 0, fora_da_area: 0 };
  for (const l of linhas) {
    const nome = limpo(achaColuna(l, "NOME"));
    if (!nome) continue;
    const doc = digitos(achaColuna(l, "CPF/CNS"));
    const microTxt = limpo(achaColuna(l, "MICROAREA"));
    const micro = microTxt && /\d/.test(microTxt) ? fmtMicro(microTxt) : null;
    if (microTxt && !micro) r.fora_da_area++;
    const endTxt = limpo(achaColuna(l, "ENDERECO"));
    const end = parseEnderecoVinculados(endTxt);
    const cpf = doc.length === 11 ? doc : null;
    const cns = doc.length === 15 ? doc : null;
    const chave = doc || `${norm(nome)}|${limpo(achaColuna(l, "DATA DE NASCIMENTO")) || ""}`;

    let domId = null;
    if (end) {
      const exist = (await db.query("SELECT id, excluido FROM km_domicilio WHERE chave = $1", [end.chave])).rows[0];
      if (exist) {
        if (!exist.excluido) { domId = exist.id; r.ligados++; }
      } else {
        domId = (await db.query(
          `INSERT INTO km_domicilio (chave, microarea, tipo_logradouro, logradouro, numero, complemento, cep, bairro, cidade, uf, origem)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'vinculados') RETURNING id`,
          [end.chave, micro, end.tipo_logradouro, end.logradouro, end.numero, end.complemento, end.cep, end.bairro, end.cidade, end.uf]
        )).rows[0].id;
        r.domicilios_novos++;
      }
    } else {
      r.sem_endereco++;
    }
    // Não rebaixa o vínculo já feito pelo Território (que sabe a família).
    await db.query(
      `INSERT INTO km_cidadao (chave, nome, cpf, cns, microarea, domicilio_id, endereco_texto)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (chave) DO UPDATE SET nome = EXCLUDED.nome,
         microarea = COALESCE(EXCLUDED.microarea, km_cidadao.microarea),
         domicilio_id = COALESCE(km_cidadao.domicilio_id, EXCLUDED.domicilio_id),
         endereco_texto = EXCLUDED.endereco_texto`,
      [chave, nome, cpf, cns, micro, domId, endTxt]
    );
    r.cidadaos++;
  }
  return r;
}

module.exports = { importaTerritorio, importaVinculados, mapeiaTerritorio, microareaDeFiltros, fmtMicro };
