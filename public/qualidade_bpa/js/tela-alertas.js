(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Alertas": glossário de problemas encontrados (o que significa cada
  // código, quantas vezes apareceu, como resolver). Ported verbatim (em
  // lógica) da PRIMEIRA metade de renderGlossario() de public/qualidade_bpa/js/app.js
  // — contagem de problemas por código + lista de .gloss-item. A segunda
  // metade (3 cards de valor-pendência por severidade) NÃO foi portada aqui;
  // ela pertence à tela "Qualidade". Clique no item: no original chamava
  // showDrilldown(PROBLEMA_CATALOG[cod].texto, { problema: cod }); aqui vira
  // QBPA.irPara('registros', { preset: { problema: cod } }).
  // ─────────────────────────────────────────────────────────────────────────

  function glossarioHtml(counts, codigos) {
    const escapeHtml = QBPA.utils.escapeHtml;
    const PROBLEMA_CATALOG = QBPA.PROBLEMA_CATALOG;
    return codigos.map((cod) => {
      const info = PROBLEMA_CATALOG[cod];
      return '<a class="gloss-item" href="javascript:void(0)" data-gloss-cod="' + cod + '"><span class="badge sev-' + info.sev + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + '</span>' +
        '<div class="gloss-body">' +
        '<div class="gloss-titulo">' + escapeHtml(info.texto) + ' <span class="gloss-count">— ' + counts[cod] + " ocorrência(s) · ver registros</span></div>" +
        '<div class="gloss-explicacao">' + escapeHtml(info.explicacao) + "</div>" +
        '<div class="gloss-resolver"><b>Como resolver:</b> ' + escapeHtml(info.resolver) + "</div>" +
        "</div></a>";
    }).join("");
  }

  function render() {
    const el = document.getElementById("tela-alertas");
    const header = '<div class="tela-header"><h1>Alertas</h1><p>O que significam os avisos e erros encontrados, por prioridade.</p></div>';

    if (!QBPA.parsed) {
      el.innerHTML = header + '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    const regs = QBPA.parsed.registros;
    const counts = {};
    regs.forEach((r) => r.problemas.forEach((p) => { counts[p.cod] = (counts[p.cod] || 0) + 1; }));
    const codigos = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    if (!codigos.length) {
      el.innerHTML = header + '<div class="vazio">Nenhum problema encontrado — nada para revisar.</div>';
      return;
    }

    el.innerHTML = header + '<div class="glossario">' + glossarioHtml(counts, codigos) + "</div>";

    el.querySelectorAll("[data-gloss-cod]").forEach((a) => {
      const cod = a.dataset.glossCod;
      a.addEventListener("click", () => QBPA.irPara("registros", { preset: { problema: cod } }));
    });
  }

  QBPA.telas.alertas = { render };
})();
