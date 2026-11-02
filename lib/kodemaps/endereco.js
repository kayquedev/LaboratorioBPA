"use strict";

const { norm, limpo, digitos } = require("./texto");

// Tipos de logradouro do e-SUS, para separar "Praça JK" em tipo + nome.
const TIPOS = [
  "AVENIDA", "RUA", "PRACA", "TRAVESSA", "ALAMEDA", "ESTRADA", "RODOVIA", "BECO", "LARGO",
  "VILA", "VIELA", "FAZENDA", "SITIO", "CHACARA", "LOTEAMENTO", "POVOADO", "DISTRITO",
  "BAIRRO", "PARQUE", "VIA", "LADEIRA", "CAMINHO", "FAIXA", "ROTATORIA", "RETORNO",
];

function separaTipo(texto) {
  const t = limpo(texto);
  if (!t) return { tipo: null, logradouro: null };
  const [primeira, ...resto] = t.split(" ");
  if (resto.length && TIPOS.includes(norm(primeira))) return { tipo: primeira, logradouro: resto.join(" ") };
  return { tipo: null, logradouro: t };
}

// Chave que liga o mesmo domicílio nos dois relatórios. Não usa CEP nem bairro
// (o relatório de vinculados escreve bairro/cidade de forma diferente).
function chaveDomicilio({ tipo_logradouro, logradouro, numero, complemento }) {
  const num = digitos(numero) || norm(numero) || "SN";
  return [norm(tipo_logradouro), norm(logradouro), num, norm(complemento)].join("|");
}

// "Praça JK, 400. CASA FUNDOS - CENTRO, Brasília - DF | 35544-000"
// "Praça JK, 300. CENTRO, Brasília - DF | 35544-000"
function parseEnderecoVinculados(texto) {
  const bruto = limpo(texto);
  if (!bruto) return null;
  const [corpo, cepTxt] = bruto.split("|").map((s) => s.trim());
  const m = corpo.match(/^(.*?),\s*([^.,]+?)\.\s*(.*)$/);
  if (!m) return null;
  const { tipo, logradouro } = separaTipo(m[1]);
  const numero = limpo(m[2]);
  let resto = m[3];

  let cidade = null;
  let uf = null;
  const cu = resto.match(/,\s*([^,]+?)\s+-\s+([A-Za-z]{2})\s*$/);
  if (cu) {
    cidade = cu[1];
    uf = cu[2].toUpperCase();
    resto = resto.slice(0, cu.index);
  }
  let complemento = null;
  let bairro = null;
  const idx = resto.lastIndexOf(" - ");
  if (idx >= 0) {
    complemento = limpo(resto.slice(0, idx));
    bairro = limpo(resto.slice(idx + 3));
  } else {
    bairro = limpo(resto);
  }
  const cep = digitos(cepTxt);
  const dom = { tipo_logradouro: tipo, logradouro, numero, complemento, bairro, cidade, uf, cep: cep.length === 8 ? cep : null };
  return { ...dom, chave: chaveDomicilio(dom) };
}

module.exports = { separaTipo, chaveDomicilio, parseEnderecoVinculados };
