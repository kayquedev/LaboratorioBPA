(function (root) {
  "use strict";

  // Tabelas oficiais SIGTAP (tb_procedimento + rl_procedimento_registro do
  // DATASUS), convertidas pra JSON. Servidas como arquivo estatico do
  // proprio modulo (nenhum dado de paciente envolvido aqui). Cada entrada de
  // sigtap.json: { nome, sexo, idadeMin, idadeMax (em meses), valor (R$,
  // soma SA+SP - ambulatorial + profissional), registros (instrumentos de
  // registro em que o procedimento pode ser faturado: "01"=BPA Consolidado,
  // "02"=BPA Individualizado, etc., conforme tb_registro.txt) }.

  let cbo = {};
  let sigtap = {};
  // proc_servico.json: { "0302040048": ["126004","135003","135011"] } - pares
  //   Servico+Classificacao (6 digitos) aceitos por procedimento.
  // servico_classificacao.json: { srv: {"126":"Servico de Fisioterapia"}, clf: {"126004":"..."} }
  let procServico = {};
  let servicoClassif = { srv: {}, clf: {} };
  const ready = Promise.all([
    fetch("data/cbo.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/sigtap.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/proc_servico.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/servico_classificacao.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([cboData, sigtapData, procServicoData, servicoClassifData]) => {
    cbo = cboData;
    sigtap = sigtapData;
    procServico = procServicoData || {};
    if (servicoClassifData && servicoClassifData.clf) servicoClassif = servicoClassifData;
  });

  function nomeCbo(codigo) { return cbo[codigo] || ""; }
  function sigtapInfo(codigo) { return sigtap[codigo] || null; }
  function nomeSigtap(codigo) { const i = sigtap[codigo]; return i ? i.nome : ""; }
  function servicosDoProcedimento(codigo) { return procServico[codigo] || null; }
  function nomeServico(srv) { return servicoClassif.srv[srv] || ""; }
  function nomeClassificacao(srvClf) { return servicoClassif.clf[srvClf] || ""; }

  root.QualidadeBpaLookup = {
    ready, nomeCbo, nomeSigtap, sigtapInfo,
    servicosDoProcedimento, nomeServico, nomeClassificacao,
  };
})(typeof window !== "undefined" ? window : globalThis);
