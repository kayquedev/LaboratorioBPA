(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Faturamento" — versão completa (dashboard original do Qualidade BPA
  // sozinho). Cópia fiel de renderFaturamento() de public/qualidade_bpa/js/app.js
  // (mesmo loop sobre os registros, mesmos textos de badge/desc, mesmos
  // percentuais) — só reapontada pro container desta tela (#tela-faturamento)
  // em vez do antigo #cardsFaturamento. A tela "Visão geral" tem sua própria
  // versão compacta (3 cards) do mesmo cálculo — não é esta.
  // ─────────────────────────────────────────────────────────────────────────

  function cardsFaturamento(parsed, utils) {
    const fmtMoeda = utils.fmtMoeda;
    const regs = parsed.registros;
    let receber = 0, pendente = 0, naoLocalizados = 0;
    regs.forEach((r) => {
      if (!r.sigtapEncontrado) { naoLocalizados++; return; }
      const temPendencia = r.problemas.length > 0;
      if (temPendencia) pendente += r.valorEstimado; else receber += r.valorEstimado;
    });
    const total = receber + pendente;
    const pctReceber = total ? Math.round((receber / total) * 100) : 0;
    const pctPendente = total ? 100 - pctReceber : 0;

    const cards = [
      {
        id: "fatTotal", badge: '<span class="badge b-soon">Estimado</span>',
        valor: fmtMoeda(total), titulo: "Faturamento total estimado",
        desc: "Soma do valor SIGTAP (ambulatorial + profissional) × quantidade, para os registros com procedimento localizado na tabela carregada.",
      },
      {
        id: "fatReceber", badge: '<span class="badge b-ok pct-badge">' + pctReceber + '% do total</span>',
        corValor: "var(--teal)", pct: pctReceber, barColor: "var(--teal)",
        valor: fmtMoeda(receber), titulo: "Faturamento estimado a receber",
        desc: "Registros sem nenhuma pendência detectada — tendência de serem aceitos e pagos pelo SIA.",
      },
      {
        id: "fatPendente", badge: '<span class="badge sev-erro pct-badge">' + pctPendente + '% do total</span>',
        corValor: "var(--red)", pct: pctPendente, barColor: "var(--red)",
        valor: fmtMoeda(pendente), titulo: "Pendente / risco de glosa",
        desc: "Registros com pelo menos uma pendência (erro ou aviso — SIGTAP/CBO inválido, data suspeita, CEP inválido, possível duplicidade etc.), risco de rejeição, glosa, ou que merece revisão antes do envio.",
      },
    ];
    if (naoLocalizados) {
      cards.push({
        id: "fatNaoLocalizado", badge: '<span class="badge b-soon">Fora do cálculo</span>',
        valor: naoLocalizados, titulo: "SIGTAP não localizado",
        desc: "Registro(s) com código SIGTAP que não foi encontrado na tabela carregada — não entram na soma acima.",
      });
    }
    return cards.map(utils.cardHtml).join("");
  }

  function render() {
    const el = document.getElementById("tela-faturamento");
    const parsed = QBPA.parsed;
    const utils = QBPA.utils;

    const header =
      '<div class="tela-header"><h1>Faturamento (R$)</h1>' +
      "<p>Valores calculados com base nos registros importados e nas regras vigentes do SIA/SUS.</p></div>";

    if (!parsed) {
      el.innerHTML = header + '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    el.innerHTML = header + '<div class="cards-grid">' + cardsFaturamento(parsed, utils) + "</div>";
  }

  QBPA.telas.faturamento = { render };
})();
