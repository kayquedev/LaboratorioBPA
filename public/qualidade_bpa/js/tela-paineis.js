(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Painéis" — distribuição da produção por procedimento, CBO, dia,
  // sexo, bairro e faixa etária. Port fiel (mesma lógica, mesmos textos,
  // mesmo corte top-8, mesmas classes .painel/.paineis-grid) de
  // renderPaineis() de public/qualidade_bpa/js/app.js — nenhuma conta mudou.
  //
  // Único acréscimo (aprovado, não é invenção): o painel "Por faixa etária
  // (BPA-I)", usando o mesmo padrão topN/painelHtml das linhas acima, só que
  // com buckets fixos e ordem cronológica (não ordenado por contagem, e sem
  // corte top-8 — só existem 7 faixas).
  // ─────────────────────────────────────────────────────────────────────────

  function topN(map, n) {
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  function painelHtml(titulo, entries, formatKey, formatVal) {
    const escapeHtml = QBPA.utils.escapeHtml;
    if (!entries.length) return '<div class="painel"><h3>' + titulo + '</h3><div class="vazio">Sem dados.</div></div>';
    const rows = entries.map(([k, v]) =>
      "<tr><td>" + (formatKey ? formatKey(k) : escapeHtml(k)) + '</td><td class="n">' + (formatVal ? formatVal(v) : v.toLocaleString("pt-BR")) + "</td></tr>"
    ).join("");
    return '<div class="painel"><h3>' + titulo + "</h3><table>" + rows + "</table></div>";
  }
  function labelComNome(codigo, nome) {
    const escapeHtml = QBPA.utils.escapeHtml;
    return escapeHtml(codigo) + (nome ? ' <span style="color:var(--text-dim)">· ' + escapeHtml(nome) + "</span>" : "");
  }

  // faixas etárias (mesmos buckets usados em outros pontos do projeto)
  const FAIXAS_ETARIAS = ["0-4", "5-9", "10-14", "15-19", "20-39", "40-59", "60+"];
  function faixaEtaria(anos) {
    if (anos < 5) return "0-4";
    if (anos < 10) return "5-9";
    if (anos < 15) return "10-14";
    if (anos < 20) return "15-19";
    if (anos < 40) return "20-39";
    if (anos < 60) return "40-59";
    return "60+";
  }

  function render() {
    const el = document.getElementById("tela-paineis");
    const header =
      '<div class="tela-header"><h1>Painéis</h1>' +
      "<p>Distribuição da produção por procedimento, CBO, dia, sexo, bairro e faixa etária.</p></div>";

    const parsed = QBPA.parsed;
    if (!parsed) {
      el.innerHTML = header + '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    const utils = QBPA.utils;
    const sigtapNome = utils.sigtapNome;
    const cboNome = utils.cboNome;
    const fmtData = utils.fmtData;
    const fmtMoeda = utils.fmtMoeda;
    const idadeEmMeses = utils.idadeEmMeses;

    const regs = parsed.registros;
    const porProcedimentoQtd = {}, porProcedimentoOcorr = {}, porCbo = {}, porDia = {}, porSexo = {}, porBairro = {};
    const porOrigemCount = {}, porOrigemValor = {};
    const porFaixaEtaria = {};
    FAIXAS_ETARIAS.forEach((f) => { porFaixaEtaria[f] = 0; });

    regs.forEach((r) => {
      porProcedimentoQtd[r.sigtap] = (porProcedimentoQtd[r.sigtap] || 0) + (r.quantidade || 0);
      porProcedimentoOcorr[r.sigtap] = (porProcedimentoOcorr[r.sigtap] || 0) + 1;
      porCbo[r.cbo] = (porCbo[r.cbo] || 0) + 1;
      porOrigemCount[r.origem] = (porOrigemCount[r.origem] || 0) + 1;
      porOrigemValor[r.origem] = (porOrigemValor[r.origem] || 0) + r.valorEstimado;
      if (r.tipo === "03") {
        porDia[fmtData(r.dataAtendimento)] = (porDia[fmtData(r.dataAtendimento)] || 0) + 1;
        porSexo[r.sexo || "—"] = (porSexo[r.sexo || "—"] || 0) + 1;
        porBairro[r.bairro || "—"] = (porBairro[r.bairro || "—"] || 0) + 1;

        const meses = idadeEmMeses(r.dataNascimento, r.dataAtendimento);
        if (meses != null) {
          const anos = Math.floor(meses / 12);
          porFaixaEtaria[faixaEtaria(anos)] += 1;
        }
      }
    });

    const paineis = [
      painelHtml("Top procedimentos (quantidade)", topN(porProcedimentoQtd, 8), (c) => labelComNome(c, sigtapNome(c))),
      painelHtml("Top procedimentos (ocorrências)", topN(porProcedimentoOcorr, 8), (c) => labelComNome(c, sigtapNome(c))),
      painelHtml("Por CBO", topN(porCbo, 8), (c) => labelComNome(c, cboNome(c))),
      painelHtml("Por dia (BPA-I)", topN(porDia, 8)),
      painelHtml("Por sexo (BPA-I)", topN(porSexo, 8)),
      painelHtml("Por bairro (BPA-I)", topN(porBairro, 8)),
    ];
    if (parsed.fontes.length > 1) {
      paineis.push(painelHtml("Por origem (registros)", topN(porOrigemCount, 8)));
      paineis.push(painelHtml("Por origem (R$ estimado)", topN(porOrigemValor, 8), null, fmtMoeda));
    }
    // painel novo (aprovado): faixa etária, ordem cronológica fixa, sem top-8.
    paineis.push(painelHtml("Por faixa etária (BPA-I)", FAIXAS_ETARIAS.map((f) => [f, porFaixaEtaria[f]])));

    el.innerHTML = header + '<div class="paineis-grid">' + paineis.join("") + "</div>";
  }

  QBPA.telas.paineis = { render };
})();
