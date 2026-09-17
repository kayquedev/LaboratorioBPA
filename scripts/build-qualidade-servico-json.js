/*
 * Gera os JSONs de referência SIGTAP usados pelos módulos Qualidade BPA e
 * Correção BPA (críticas 004 CBO não permitido, 050 Serviço/Classificação e
 * 025 "procedimento exige CPF/CNS" do BPA Magnético), a partir das tabelas
 * SIGTAP em dados/ (largura fixa, ISO-8859-1). Copia a saída para os dois
 * módulos.
 *
 *   node scripts/build-qualidade-servico-json.js
 *
 * Saída (em public/qualidade_bpa/data/ e public/correcao_bpa/data/):
 *   proc_servico.json
 *     { "0302040021": ["113001","126004", ...] }   // pares Serviço+Classificação (6 díg.) aceitos
 *   servico_classificacao.json
 *     { "srv": { "126": "Serviço de Fisioterapia" },
 *       "clf": { "126004": "Assistência fisioterapêutica ..." },
 *       "det": { "009": "Exige CPF/CNS", "048": "Exige CID", ... } }
 *   proc_detalhe.json
 *     { "0301100209": ["009"], ... }               // detalhes (tb_detalhe) por procedimento
 *   proc_cbo.json
 *     { "0301010072": ["225125","221805", ...] }   // CBOs (6 díg.) habilitados pra executar o procedimento
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DADOS = path.join(ROOT, "dados");
const OUTS = [
  path.join(ROOT, "public", "qualidade_bpa", "data"),
  path.join(ROOT, "public", "correcao_bpa", "data"),
];

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

// tb_detalhe: CO_DETALHE(3) NO_DETALHE(100) DT_COMPETENCIA(6)
const det = {};
for (const l of readLatin1("tb_detalhe.txt")) {
  const co = l.slice(0, 3);
  if (/^\d{3}$/.test(co)) det[co] = l.slice(3, 103).trim();
}

// rl_procedimento_detalhe: CO_PROCEDIMENTO(10) CO_DETALHE(3) DT_COMPETENCIA(6)
const procDetalhe = {};
for (const l of readLatin1("rl_procedimento_detalhe.txt")) {
  const proc = l.slice(0, 10);
  const cod = l.slice(10, 13);
  if (!/^\d{10}$/.test(proc) || !/^\d{3}$/.test(cod)) continue;
  (procDetalhe[proc] = procDetalhe[proc] || []).push(cod);
}
for (const k of Object.keys(procDetalhe)) procDetalhe[k] = [...new Set(procDetalhe[k])].sort();

// rl_procedimento_ocupacao: CO_PROCEDIMENTO(10) CO_OCUPACAO/CBO(6) DT_COMPETENCIA(6)
// (crítica 004 do BPA Magnético — "PROCED. NAO PERMITIDO P/CBO")
const procCbo = {};
for (const l of readLatin1("rl_procedimento_ocupacao.txt")) {
  const proc = l.slice(0, 10);
  const cbo = l.slice(10, 16);
  if (!/^\d{10}$/.test(proc) || !/^[0-9A-Z]{6}$/.test(cbo)) continue;
  (procCbo[proc] = procCbo[proc] || []).push(cbo);
}
for (const k of Object.keys(procCbo)) procCbo[k] = [...new Set(procCbo[k])].sort();

for (const OUT of OUTS) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "proc_servico.json"), JSON.stringify(procServico));
  fs.writeFileSync(path.join(OUT, "servico_classificacao.json"), JSON.stringify({ srv, clf, det }));
  fs.writeFileSync(path.join(OUT, "proc_detalhe.json"), JSON.stringify(procDetalhe));
  fs.writeFileSync(path.join(OUT, "proc_cbo.json"), JSON.stringify(procCbo));
}

const com009 = Object.values(procDetalhe).filter((a) => a.indexOf("009") !== -1).length;
console.log("proc_servico.json     :", Object.keys(procServico).length, "procedimentos");
console.log("servico_classificacao :", Object.keys(srv).length, "serviços /", Object.keys(clf).length, "classificações /", Object.keys(det).length, "detalhes");
console.log("proc_detalhe.json     :", Object.keys(procDetalhe).length, "procedimentos (", com009, "com 009 Exige CPF/CNS )");
console.log("proc_cbo.json         :", Object.keys(procCbo).length, "procedimentos com CBO(s) habilitado(s)");
