/*
 * Gera os JSONs de Serviço/Classificação usados pelo módulo Qualidade BPA
 * (checagem da crítica 050 do BPA Magnético — Serviço/Classificação x procedimento),
 * a partir das tabelas SIGTAP em dados/ (largura fixa, ISO-8859-1).
 *
 *   node scripts/build-qualidade-servico-json.js
 *
 * Saída:
 *   public/qualidade_bpa/data/proc_servico.json
 *     { "0302040021": ["113001","126004", ...] }  // pares Serviço+Classificação (6 díg.) aceitos
 *   public/qualidade_bpa/data/servico_classificacao.json
 *     { "srv": { "126": "Serviço de Fisioterapia" },
 *       "clf": { "126004": "Assistência fisioterapêutica cardiovasculares e pneumo-funcionais" } }
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DADOS = path.join(ROOT, "dados");
const OUT = path.join(ROOT, "public", "qualidade_bpa", "data");

function readLatin1(file) {
  return fs.readFileSync(path.join(DADOS, file), "latin1").split(/\r?\n/).filter((l) => l.length);
}

// rl_procedimento_servico: CO_PROCEDIMENTO(10) CO_SERVICO(3) CO_CLASSIFICACAO(3) DT_COMPETENCIA(6)
const procServico = {};
for (const l of readLatin1("rl_procedimento_servico.txt")) {
  const proc = l.slice(0, 10);
  const srvClf = l.slice(10, 16);
  if (!/^\d{10}$/.test(proc) || !/^\d{6}$/.test(srvClf)) continue;
  (procServico[proc] = procServico[proc] || []).push(srvClf);
}
for (const k of Object.keys(procServico)) procServico[k] = [...new Set(procServico[k])].sort();

// tb_servico: CO_SERVICO(3) NO_SERVICO(120) DT_COMPETENCIA(6)
const srv = {};
for (const l of readLatin1("tb_servico.txt")) {
  const co = l.slice(0, 3);
  if (/^\d{3}$/.test(co)) srv[co] = l.slice(3, 123).trim();
}

// tb_servico_classificacao: CO_SERVICO(3) CO_CLASSIFICACAO(3) NO_CLASSIFICACAO(150) DT_COMPETENCIA(6)
const clf = {};
for (const l of readLatin1("tb_servico_classificacao.txt")) {
  const co = l.slice(0, 6);
  if (/^\d{6}$/.test(co)) clf[co] = l.slice(6, 156).trim();
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "proc_servico.json"), JSON.stringify(procServico));
fs.writeFileSync(path.join(OUT, "servico_classificacao.json"), JSON.stringify({ srv, clf }));

console.log("proc_servico.json     :", Object.keys(procServico).length, "procedimentos");
console.log("servico_classificacao :", Object.keys(srv).length, "serviços /", Object.keys(clf).length, "classificações");
