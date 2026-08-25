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
  const ready = Promise.all([
    fetch("data/cbo.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/sigtap.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([cboData, sigtapData]) => {
    cbo = cboData;
    sigtap = sigtapData;
  });

  function nomeCbo(codigo) { return cbo[codigo] || ""; }
  function sigtapInfo(codigo) { return sigtap[codigo] || null; }
  function nomeSigtap(codigo) { const i = sigtap[codigo]; return i ? i.nome : ""; }

  root.QualidadeBpaLookup = { ready, nomeCbo, nomeSigtap, sigtapInfo };
})(typeof window !== "undefined" ? window : globalThis);
