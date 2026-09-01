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
  // proc_servico.json: { "0302040021": ["113001","126004", ...] } - pares
  //   Servico+Classificacao (6 digitos) aceitos por procedimento (rl_procedimento_servico).
  // servico_classificacao.json: { srv: {"126":"..."}, clf: {"126004":"..."}, det: {"009":"Exige CPF/CNS"} }
  // proc_detalhe.json: { "0301100209": ["009"] } - detalhes (tb_detalhe) por procedimento
  let procServico = {};
  let procDetalhe = {};
  let servicoClassif = { srv: {}, clf: {}, det: {} };
  const ready = Promise.all([
    fetch("data/cbo.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/sigtap.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/proc_servico.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    fetch("data/servico_classificacao.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/proc_detalhe.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([cboData, sigtapData, procServicoData, servicoClassifData, procDetalheData]) => {
    cbo = cboData;
    sigtap = sigtapData;
    procServico = procServicoData || {};
    procDetalhe = procDetalheData || {};
    if (servicoClassifData && servicoClassifData.clf) servicoClassif = servicoClassifData;
  });

  function nomeCbo(codigo) { return cbo[codigo] || ""; }
  function sigtapInfo(codigo) { return sigtap[codigo] || null; }
  function nomeSigtap(codigo) { const i = sigtap[codigo]; return i ? i.nome : ""; }
  function servicosDoProcedimento(codigo) { return procServico[codigo] || null; }
  function nomeServico(srv) { return servicoClassif.srv[srv] || ""; }
  function nomeClassificacao(srvClf) { return servicoClassif.clf[srvClf] || ""; }
  function detalhesDoProcedimento(codigo) { return procDetalhe[codigo] || null; }
  function nomeDetalhe(cod) { return (servicoClassif.det && servicoClassif.det[cod]) || ""; }
  // detalhe 009 "Exige CPF/CNS" ou 058 "Obrigatório CPF" (crítica 025 do BPAMAG)
  function procExigeIdentificacao(codigo) {
    const d = procDetalhe[codigo];
    return !!d && (d.indexOf("009") !== -1 || d.indexOf("058") !== -1);
  }

  root.QualidadeBpaLookup = {
    ready, nomeCbo, nomeSigtap, sigtapInfo,
    servicosDoProcedimento, nomeServico, nomeClassificacao,
    detalhesDoProcedimento, nomeDetalhe, procExigeIdentificacao,
  };
})(typeof window !== "undefined" ? window : globalThis);
