(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Produção": arquivos importados (renomear), estabelecimentos (CNES →
  // nome cadastrado) e setores com produção no período. Ported verbatim (em
  // lógica) de public/qualidade_bpa/js/app.js: renderSetores(), renderFontesList()
  // + renomearFonte(), renderEstabelecimentos() + cadastrarNomeEstabelecimento(),
  // e a porção cardsE de renderCards() (cardsQ ficou em outra tela).
  // ─────────────────────────────────────────────────────────────────────────

  function setoresHtml() {
    const codigosPresentes = new Set(QBPA.parsed.registros.map((r) => r.sigtap));
    return Object.entries(QBPA.SETOR_INDICADORES).map(([nome, codigos]) => {
      const importado = codigos.some((c) => codigosPresentes.has(c));
      return '<span class="badge ' + (importado ? "b-ok" : "sev-erro") + '" style="margin-right:8px;">' +
        (importado ? "✓" : "✗") + " " + QBPA.utils.escapeHtml(nome) + "</span>";
    }).join(" ");
  }

  function fontesListHtml() {
    return QBPA.parsed.fontes.map((fonte, i) =>
      '<div class="fonte-row">' +
        '<div class="fonte-info">' +
          '<span class="fonte-nome">' + QBPA.utils.escapeHtml(fonte.label) + "</span>" +
          (fonte.label !== fonte.nome ? '<span class="fonte-original">arquivo: ' + QBPA.utils.escapeHtml(fonte.nome) + "</span>" : "") +
          '<span class="fonte-count">' + fonte.registros.length + " registro(s)</span>" +
        "</div>" +
        '<button class="btn btn-ghost-dark" data-rename-fonte="' + i + '">✎ Renomear</button>' +
      "</div>"
    ).join("");
  }

  function renomearFonte(fonte) {
    const novo = window.prompt('Novo nome para "' + fonte.nome + '" (ex: Pronto Atendimento, Laboratório...):', fonte.label);
    if (novo == null) return;
    const nomeFinal = novo.trim() || fonte.nome;
    fonte.registros.forEach((r) => { r.origem = nomeFinal; });
    fonte.label = nomeFinal;
    // outras telas (ex: Painéis, Registros) leem r.origem/fonte.label direto
    // do QBPA.parsed compartilhado — não precisam ser avisadas aqui, só
    // re-renderizam sozinhas na próxima vez que ficarem visíveis.
    render();
  }

  function estabelecimentosHtml() {
    const porCnes = {};
    QBPA.parsed.registros.forEach((r) => { porCnes[r.cnes] = (porCnes[r.cnes] || 0) + 1; });
    const cnesList = Object.keys(porCnes).sort();
    if (!cnesList.length) return '<div class="vazio-estab">Nenhum registro com CNES encontrado.</div>';
    return cnesList.map((cnes) => {
      const nome = QBPA.utils.nomeEstabelecimento(cnes);
      return '<div class="fonte-row"><div class="fonte-info">' +
        '<span class="fonte-nome">' + QBPA.utils.escapeHtml(cnes) + "</span>" +
        (nome ? '<span class="fonte-original">' + QBPA.utils.escapeHtml(nome) + "</span>" : '<span class="fonte-original estab-sem-nome">nome não cadastrado</span>') +
        '<span class="fonte-count">' + porCnes[cnes] + " registro(s)</span>" +
        "</div>" +
        '<button class="btn btn-ghost-dark" data-cadastrar-cnes="' + QBPA.utils.escapeHtml(cnes) + '">' + (nome ? "✎ Editar nome" : "+ Cadastrar nome") + "</button></div>";
    }).join("");
  }

  function cadastrarNomeEstabelecimento(cnes) {
    const novo = window.prompt("Nome do estabelecimento CNES " + cnes + ":", QBPA.utils.nomeEstabelecimento(cnes));
    if (novo == null) return;
    const nomeFinal = novo.trim();
    if (nomeFinal) QBPA.estabelecimentos[cnes] = nomeFinal; else delete QBPA.estabelecimentos[cnes];
    QBPA.utils.salvarEstabelecimentos();
    render();
  }

  function cardsExplorar() {
    const regs = QBPA.parsed.registros;
    return [
      { id: "todos", onClick: true, valor: regs.length, titulo: "Todos", desc: "BPA-C e BPA-I juntos.", link: "Ver registros", preset: {} },
      { id: "t02", onClick: true, valor: regs.filter((r) => r.tipo === "02").length, titulo: "Consolidado", desc: "Linhas tipo 02 · BPA-C.", link: "Ver registros", preset: { tipo: "02" } },
      { id: "t03", onClick: true, valor: regs.filter((r) => r.tipo === "03").length, titulo: "Individual", desc: "Linhas tipo 03 · BPA-I, por paciente.", link: "Ver registros", preset: { tipo: "03" } },
    ];
  }

  function render() {
    const el = document.getElementById("tela-producao");
    if (!QBPA.parsed) { el.innerHTML = ""; return; }

    const cards = cardsExplorar();

    el.innerHTML =
      '<div class="tela-header"><h1>Produção</h1><p>Arquivos importados, estabelecimentos e setores com produção no período.</p></div>' +
      '<div class="group-label">Explorar registros</div>' +
      '<div class="cards-grid">' + cards.map(QBPA.utils.cardHtml).join("") + "</div>" +
      '<div class="group-label">Arquivos importados</div>' +
      '<div class="fontes-list">' + fontesListHtml() + "</div>" +
      '<div class="group-label">Estabelecimentos (CNES)</div>' +
      '<div class="fontes-list">' + estabelecimentosHtml() + "</div>" +
      '<div class="group-label">Setores com produção</div>' +
      '<div>' + setoresHtml() + "</div>";

    el.querySelectorAll("[data-card]").forEach((a) => {
      const card = cards.find((c) => c.id === a.dataset.card);
      if (card) a.addEventListener("click", () => QBPA.irPara("registros", { preset: card.preset }));
    });

    el.querySelectorAll("[data-rename-fonte]").forEach((btn) => {
      btn.addEventListener("click", () => renomearFonte(QBPA.parsed.fontes[+btn.dataset.renameFonte]));
    });

    el.querySelectorAll("[data-cadastrar-cnes]").forEach((btn) => {
      btn.addEventListener("click", () => cadastrarNomeEstabelecimento(btn.dataset.cadastrarCnes));
    });
  }

  QBPA.telas.producao = { render };
})();
