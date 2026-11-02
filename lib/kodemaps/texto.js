"use strict";

// Utilidades de texto compartilhadas pela importação e pela exportação.

function semAcento(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/\p{M}/gu, "");
}

function norm(s) {
  return semAcento(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

// "-" e vazio viram null (o e-SUS usa "-" para "sem valor").
function limpo(s) {
  const v = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return v === "" || v === "-" ? null : v;
}

function digitos(s) {
  return String(s == null ? "" : s).replace(/\D/g, "");
}

function achaColuna(linha, ...nomes) {
  const alvo = nomes.map(norm);
  for (const k of Object.keys(linha)) if (alvo.includes(norm(k))) return linha[k];
  return undefined;
}

const TIPOS_IMOVEL = ["DPO", "DUO", "VAGO", "EST", "OUTROS", "SEM INFO"];

module.exports = { semAcento, norm, limpo, digitos, achaColuna, TIPOS_IMOVEL };
