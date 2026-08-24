(function (root) {
  "use strict";

  // Tabelas oficiais SIGTAP (tb_procedimento / tb_ocupacao do DATASUS),
  // convertidas pra JSON codigo->nome. Servidas como arquivo estatico do
  // proprio modulo (nenhum dado de paciente envolvido aqui).

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
  function nomeSigtap(codigo) { return sigtap[codigo] || ""; }

  root.QualidadeBpaLookup = { ready, nomeCbo, nomeSigtap };
})(typeof window !== "undefined" ? window : globalThis);
