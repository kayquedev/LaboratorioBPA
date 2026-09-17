(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Visão geral" (antigo dashboard principal do Qualidade BPA sozinho).
  // renderSummaryHtml()/renderAlertHtml() abaixo são cópia fiel (mesma lógica,
  // mesmos textos) de renderSummary()/renderAlert() de public/qualidade_bpa/js/app.js
  // antes da divisão em telas — só reapontadas pro container desta tela em vez
  // dos ids globais summaryRow/headerAlert. O bloco de faturamento é uma
  // versão compacta (3 cards) do mesmo cálculo de renderFaturamento() daquele
  // arquivo; a versão completa mora na tela Faturamento.
  // ─────────────────────────────────────────────────────────────────────────

  function alertHtml(parsed, utils) {
    const escapeHtml = utils.escapeHtml;
    const checarCabecalho = utils.checarCabecalho;
    const linhas = [];
    let algumaDivergencia = false;

    parsed.fontes.forEach((fonte) => {
      const rotulo = "<b>" + escapeHtml(fonte.label) + "</b>";
      if (!fonte.header) {
        algumaDivergencia = true;
        linhas.push(rotulo + ": sem cabeçalho (tipo 01) — não dá pra conferir numLinhas/numFolhas declarados.");
        return;
      }
      const chk = checarCabecalho(fonte);
      if (!chk.ok) {
        algumaDivergencia = true;
        const partes = [];
        if (!chk.linhasOk) partes.push("cabeçalho declara <b>" + fonte.header.numLinhas + "</b> linha(s), o arquivo tem <b>" + fonte.registros.length + "</b>");
        if (!chk.folhasOk) partes.push("cabeçalho declara <b>" + fonte.header.numFolhas + "</b> folha(s), foram encontradas <b>" + chk.distinctFolhas + "</b>");
        linhas.push(rotulo + " (competência " + fonte.header.competencia + "): " + partes.join("; ") + ".");
      }
    });

    if (algumaDivergencia) {
      return {
        className: "alert-banner show",
        inner: "<b>Divergência no cabeçalho.</b><br>" + linhas.join("<br>"),
      };
    }
    const nomes = parsed.fontes.map((f) => escapeHtml(f.label)).join(", ");
    const plural = parsed.fontes.length > 1 ? "s conferem" : " confere";
    return {
      className: "alert-banner show ok",
      inner: "<b>Cabeçalho" + plural + ".</b> " + nomes + " — contagem de linhas e folhas batem com o declarado. Processado 100% no navegador, nada é enviado ao servidor.",
    };
  }

  function summaryStats(parsed, utils) {
    const pacienteChave = utils.pacienteChave;
    const regs = parsed.registros;
    const t02 = regs.filter((r) => r.tipo === "02").length;
    const t03 = regs.filter((r) => r.tipo === "03").length;
    const pacientes = new Set(regs.filter((r) => r.tipo === "03").map(pacienteChave)).size;
    const competencias = [...new Set(parsed.fontes.map((f) => f.header ? f.header.competencia : null).filter(Boolean))];
    const quartaStat = parsed.fontes.length > 1
      ? ["Arquivos importados", parsed.fontes.length]
      : ["Competência", competencias[0] || "—"];
    return [
      ["Registros", regs.length],
      ["BPA-C × BPA-I", t02 + " <small>/</small> " + t03],
      ["Pacientes distintos", pacientes],
      quartaStat,
    ];
  }

  function faturamentoCards(parsed, utils) {
    const fmtMoeda = utils.fmtMoeda;
    const cardHtml = utils.cardHtml;
    const regs = parsed.registros;
    let receber = 0, pendente = 0;
    regs.forEach((r) => {
      if (!r.sigtapEncontrado) return;
      if (r.problemas.length > 0) pendente += r.valorEstimado; else receber += r.valorEstimado;
    });
    const total = receber + pendente;
    const pctReceber = total ? Math.round((receber / total) * 100) : 0;
    const pctPendente = total ? 100 - pctReceber : 0;

    const cards = [
      {
        id: "fatTotalGeral", badge: '<span class="badge b-soon">Estimado</span>',
        valor: fmtMoeda(total), titulo: "Faturamento total estimado",
        desc: "Soma do valor SIGTAP × quantidade, para os registros com procedimento localizado na tabela carregada.",
      },
      {
        id: "fatReceberGeral", badge: '<span class="badge b-ok pct-badge">' + pctReceber + '% do total</span>',
        corValor: "var(--teal)", pct: pctReceber, barColor: "var(--teal)",
        valor: fmtMoeda(receber), titulo: "Estimado a receber",
        desc: "Registros sem nenhuma pendência detectada.",
      },
      {
        id: "fatPendenteGeral", badge: '<span class="badge sev-erro pct-badge">' + pctPendente + '% do total</span>',
        corValor: "var(--red)", pct: pctPendente, barColor: "var(--red)",
        valor: fmtMoeda(pendente), titulo: "Pendente / risco de glosa",
        desc: "Registros com pelo menos uma pendência — risco de rejeição ou glosa.",
      },
    ];
    return cards.map(cardHtml).join("");
  }

  function render() {
    const el = document.getElementById("tela-geral");
    const parsed = QBPA.parsed;
    const utils = QBPA.utils;

    if (!parsed) {
      el.innerHTML =
        '<div class="tela-header"><h1>Qualidade da Produção BPA</h1>' +
        "<p>Monitore a produção, identifique inconsistências e garanta um faturamento seguro.</p></div>" +
        '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    const alerta = alertHtml(parsed, utils);
    const stats = summaryStats(parsed, utils);

    el.innerHTML =
      '<div class="tela-header"><h1>Qualidade da Produção BPA</h1>' +
      "<p>Monitore a produção, identifique inconsistências e garanta um faturamento seguro.</p></div>" +
      '<div class="' + alerta.className + '">' + alerta.inner + "</div>" +
      '<div class="stat-row">' +
        stats.map(([l, n]) => '<div class="stat-box"><div class="l">' + l + '</div><div class="n">' + n + "</div></div>").join("") +
      "</div>" +
      '<div class="group-label">Faturamento (R$)</div>' +
      '<div class="cards-grid">' + faturamentoCards(parsed, utils) + "</div>";
  }

  QBPA.telas.geral = { render };
})();
