(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Qualidade" (parte do antigo dashboard único do Qualidade BPA).
  // Duas peças copiadas sem NENHUMA alteração de lógica de
  // public/qualidade_bpa/js/app.js:
  //   1) o bloco `cardsQ` de renderCards() — cards "Registros sem problemas"
  //      (clicável) e "Cabeçalho consistente" (só informativo). O antigo
  //      `cardsE` (Todos/Consolidado/Individual) pertence à tela Produção.
  //   2) o bloco final de renderGlossario() ("3 cards: valor estimado das
  //      pendências, por severidade" — cardsGlossarioTotais). A lista de
  //      glossário em si (a primeira metade de renderGlossario()) pertence à
  //      tela Painéis/Glossário.
  // O antigo onClick:true + showDrilldown(card.title, card.preset) do card
  // "Registros sem problemas" virou QBPA.irPara('registros', { preset }).
  // ─────────────────────────────────────────────────────────────────────────

  function cardsQualidadeHtml(parsed, utils) {
    const cardHtml = utils.cardHtml;
    const checarCabecalho = utils.checarCabecalho;
    const regs = parsed.registros;
    const total = regs.length;
    const semProblema = regs.filter((r) => r.problemas.length === 0).length;
    const pct = total ? Math.round((semProblema / total) * 100) : 0;

    const cardsQ = [];
    cardsQ.push({
      id: "qualidade", onClick: true, pct, badge: "",
      valor: pct + '<span class="un">%</span>',
      titulo: "Registros sem problemas",
      desc: semProblema + " de " + total + " registro(s) sem nenhum problema encontrado.",
      link: "Ver registros com problema",
    });

    let headerValor = "—", headerDesc = "Nenhum arquivo com cabeçalho (tipo 01).", headerCor = null;
    const comHeader = parsed.fontes.filter((f) => f.header);
    if (comHeader.length) {
      const ok = comHeader.every((f) => checarCabecalho(f).ok);
      headerValor = ok ? "✓" : "✗";
      headerCor = ok ? "var(--teal)" : "var(--red)";
      headerDesc = ok
        ? "numLinhas e numFolhas do(s) cabeçalho(s) batem com o(s) arquivo(s)."
        : "numLinhas/numFolhas de algum cabeçalho não bate com o arquivo — veja o aviso acima.";
    }
    cardsQ.push({
      id: "cabecalho", badge: '<span class="badge b-soon">Resumo</span>', corValor: headerCor,
      valor: headerValor, titulo: "Cabeçalho consistente", desc: headerDesc,
    });

    return cardsQ.map(cardHtml).join("");
  }

  function cardsGlossarioTotaisHtml(parsed, utils) {
    const cardHtml = utils.cardHtml;
    const fmtMoeda = utils.fmtMoeda;
    const regs = parsed.registros;

    // "pendente" = registro com SIGTAP localizado na tabela E com ao menos um
    // problema. Se tiver qualquer "erro" conta em erros; se só tiver aviso(s),
    // conta em avisos. Total = erros + avisos (mesmo valor do card "Pendente /
    // risco de glosa" do painel de Faturamento).
    let vErro = 0, vAviso = 0, nErro = 0, nAviso = 0;
    regs.forEach((r) => {
      if (!r.sigtapEncontrado || !r.problemas.length) return;
      if (r.problemas.some((p) => p.sev === "erro")) { vErro += r.valorEstimado; nErro++; }
      else { vAviso += r.valorEstimado; nAviso++; }
    });

    return [
      { badge: '<span class="badge b-soon">Estimado</span>', corValor: "var(--red)",
        valor: fmtMoeda(vErro + vAviso), titulo: "Valor total pendente",
        desc: (nErro + nAviso) + " registro(s) com erro ou aviso e SIGTAP localizado — soma de tudo que precisa de revisão." },
      { badge: '<span class="badge sev-aviso">Avisos</span>', corValor: "var(--amber)",
        valor: fmtMoeda(vAviso), titulo: "Valor avisos pendente",
        desc: nAviso + " registro(s) só com aviso(s) — revisar antes de enviar, mas tende a ser aceito." },
      { badge: '<span class="badge sev-erro">Erros</span>', corValor: "var(--red)",
        valor: fmtMoeda(vErro), titulo: "Valor erros pendente",
        desc: nErro + " registro(s) com pelo menos um erro — tendem a ser rejeitados ou glosados pelo SIA." },
    ].map(cardHtml).join("");
  }

  function render() {
    const el = document.getElementById("tela-qualidade");
    const parsed = QBPA.parsed;
    const utils = QBPA.utils;

    if (!parsed) {
      el.innerHTML =
        '<div class="tela-header"><h1>Qualidade dos dados</h1><p>Consistência do cabeçalho e valor estimado das pendências.</p></div>' +
        '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    el.innerHTML =
      '<div class="tela-header"><h1>Qualidade dos dados</h1><p>Consistência do cabeçalho e valor estimado das pendências.</p></div>' +
      '<div class="cards-grid">' + cardsQualidadeHtml(parsed, utils) + "</div>" +
      '<div class="group-label">Valor estimado das pendências (R$)</div>' +
      '<div class="cards-grid">' + cardsGlossarioTotaisHtml(parsed, utils) + "</div>";

    const cardQualidade = el.querySelector('[data-card="qualidade"]');
    if (cardQualidade) {
      cardQualidade.addEventListener("click", () => QBPA.irPara("registros", { preset: { soProblemas: true } }));
    }
  }

  QBPA.telas.qualidade = { render };
})();
