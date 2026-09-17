(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Registros nominais" — o antigo drilldown (view #viewDrilldown) de
  // public/qualidade_bpa/js/app.js, virado tela própria. Filtros, busca,
  // exportação de CSV e o cálculo de cada card/coluna são cópia fiel daquele
  // arquivo (populateOrigemFilter, populateCboSigtapFilters, populateIbgeFilter,
  // populateProblemaFilter, filteredRegistros, situacaoHtml, problemasDetalheHtml,
  // exportCsv, renderDrilldown) — nenhuma regra de filtro/validação mudou.
  // A única mudança de comportamento é a paginação: no lugar do scroll com
  // corte fixo em 500 linhas ("mostrando os primeiros 500"), agora é paginação
  // de verdade (25/50/100 por página, com Anterior/Próxima) sobre o mesmo
  // conjunto já filtrado — puramente uma melhoria de UX pedida no spec.
  // ─────────────────────────────────────────────────────────────────────────

  function shellHtml(parsed) {
    return (
      '<div class="tela-header"><h1>Registros nominais</h1><p>Consulte, filtre e analise os registros da produção BPA.</p></div>' +
      '<div class="cards-grid" data-reg-kpis></div>' +
      '<div class="drill-layout">' +
        '<aside class="sidebar">' +
          '<div class="sidebar-block">' +
            '<div class="sidebar-title">Resultado</div>' +
            '<div class="sidebar-stat" data-reg-count>—</div>' +
            '<div class="sidebar-stat-label">registro(s)</div>' +
            '<div class="sidebar-stat sidebar-stat-money" data-reg-valor-total>—</div>' +
            '<div class="sidebar-stat-label">valor total estimado</div>' +
            '<div class="sidebar-stat sidebar-stat-money" data-reg-valor-pagar>—</div>' +
            '<div class="sidebar-stat-label" data-reg-valor-pagar-label>valor total a pagar</div>' +
          '</div>' +

          '<div class="sidebar-block">' +
            '<div class="sidebar-title">Filtros</div>' +
            '<div class="field">' +
              '<label for="regFTipo">Tipo</label>' +
              '<select id="regFTipo" data-f="tipo">' +
                '<option value="">Todos</option>' +
                '<option value="02">02 · BPA-C</option>' +
                '<option value="03">03 · BPA-I</option>' +
              '</select>' +
            '</div>' +
            '<div class="field hidden" data-campo-origem>' +
              '<label for="regFOrigem">Origem (arquivo)</label>' +
              '<select id="regFOrigem" data-f="origem"><option value="">Todas</option></select>' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFCbo">CBO</label>' +
              '<select id="regFCbo" data-f="cbo"><option value="">Todos</option></select>' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFSigtap">SIGTAP</label>' +
              '<select id="regFSigtap" data-f="sigtap"><option value="">Todos</option></select>' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFIbge">Município (IBGE) — BPA-I</label>' +
              '<select id="regFIbge" data-f="ibge"><option value="">Todos</option></select>' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFCep">CEP — BPA-I</label>' +
              '<input id="regFCep" data-f="cep" placeholder="Ex.: 35300000">' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFProblema">Tipo de erro/aviso</label>' +
              '<select id="regFProblema" data-f="problema"><option value="">Todos</option></select>' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFSoProblemas"><input type="checkbox" id="regFSoProblemas" data-f="soProblemas"> Só com problema</label>' +
            '</div>' +
            '<div class="field">' +
              '<label for="regFSoNaoLocalizado"><input type="checkbox" id="regFSoNaoLocalizado" data-f="soNaoLocalizado"> Só SIGTAP não localizado</label>' +
            '</div>' +
            '<button class="btn btn-ghost-dark" data-acao="limpar" style="width:100%;justify-content:center;">Limpar filtros</button>' +
          '</div>' +

          '<div class="sidebar-block">' +
            '<div class="sidebar-title">Legenda</div>' +
            '<div class="legenda-item"><span class="badge sev-erro">Erro</span> impede envio ao SIA</div>' +
            '<div class="legenda-item"><span class="badge sev-aviso">Aviso</span> revisar antes de enviar</div>' +
          '</div>' +
        '</aside>' +

        '<main class="drill-main">' +
          '<div class="search-row" style="display:flex;gap:10px;">' +
            '<input id="regFBusca" data-f="busca" placeholder="Buscar por paciente ou código SIGTAP..." style="flex:1;">' +
            '<button class="btn btn-teal" data-acao="exportar">⬇ Exportar CSV</button>' +
          '</div>' +
          '<div class="msg" data-reg-filter-msg></div>' +
          '<div class="tbl-wrap">' +
            '<table class="preview">' +
              '<thead><tr>' +
                '<th>Tipo</th><th>Origem</th><th>Folha</th><th>Seq.</th><th>CBO</th><th>SIGTAP</th>' +
                '<th>Data</th><th>Qtd.</th><th>Valor (R$)</th><th>Paciente</th><th>IBGE</th><th>CEP</th><th>Situação</th><th>O que é / Como resolver</th>' +
              '</tr></thead>' +
              '<tbody data-reg-body></tbody>' +
            '</table>' +
          '</div>' +
          '<div class="pager-row">' +
            '<div data-reg-pager-label>Mostrando 0 de 0</div>' +
            '<div style="display:flex;align-items:center;gap:10px;">' +
              '<label style="font-size:12.5px;color:var(--text-dim);display:flex;align-items:center;gap:6px;">Por página' +
                '<select data-f="pageSize">' +
                  '<option value="25">25</option>' +
                  '<option value="50" selected>50</option>' +
                  '<option value="100">100</option>' +
                '</select>' +
              '</label>' +
              '<button class="btn btn-ghost-dark" data-acao="prev">‹ Anterior</button>' +
              '<button class="btn btn-ghost-dark" data-acao="next">Próxima ›</button>' +
            '</div>' +
          '</div>' +
        '</main>' +
      '</div>'
    );
  }

  // ---------- KPIs (topo da tela — sempre sobre TODOS os registros, igual
  // renderFaturamento/renderCards em app.js, não sobre o subconjunto filtrado) ----------
  function kpiCardsHtml(parsed, utils) {
    const cardHtml = utils.cardHtml;
    const fmtMoeda = utils.fmtMoeda;
    const regs = parsed.registros;
    const total = regs.length;
    let valorTotal = 0, valorPagar = 0, comPendencia = 0;
    regs.forEach((r) => {
      if (r.sigtapEncontrado) valorTotal += r.valorEstimado;
      if (r.problemas.length > 0) comPendencia++;
      else if (r.sigtapEncontrado) valorPagar += r.valorEstimado;
    });
    const pctPendencia = total ? Math.round((comPendencia / total) * 100) : 0;

    const cards = [
      {
        id: "regTotal", badge: '<span class="badge b-soon">Resumo</span>',
        valor: total.toLocaleString("pt-BR"), titulo: "Total de registros",
        desc: "BPA-C e BPA-I juntos, somando todas as fontes carregadas.",
      },
      {
        id: "regValorTotal", badge: '<span class="badge b-soon">Estimado</span>',
        valor: fmtMoeda(valorTotal), titulo: "Valor total estimado",
        desc: "Soma do valor SIGTAP × quantidade, para os registros com procedimento localizado na tabela.",
      },
      {
        id: "regValorPagar", corValor: "var(--teal)", badge: '<span class="badge b-ok">Sem pendência</span>',
        valor: fmtMoeda(valorPagar), titulo: "Valor a pagar",
        desc: "Registros sem nenhuma pendência detectada — tendência de serem aceitos e pagos pelo SIA.",
      },
      {
        id: "regComPendencia", corValor: "var(--red)", pct: pctPendencia, barColor: "var(--red)",
        badge: '<span class="badge sev-erro pct-badge">' + pctPendencia + '%</span>',
        valor: comPendencia.toLocaleString("pt-BR"), titulo: "Registros com pendência",
        desc: comPendencia + " de " + total + " registro(s) com pelo menos um problema (erro ou aviso).",
      },
    ];
    return cards.map(cardHtml).join("");
  }

  // ---------- filtros: popular selects ----------
  function populateOrigemFilter(el, f, parsed, escapeHtml) {
    const campoOrigem = el.querySelector("[data-campo-origem]");
    if (parsed.fontes.length <= 1) {
      campoOrigem.classList.add("hidden");
      f.origem.value = "";
      return;
    }
    campoOrigem.classList.remove("hidden");
    const atual = f.origem.value;
    f.origem.innerHTML = '<option value="">Todas</option>' +
      parsed.fontes.map((fo) => '<option value="' + escapeHtml(fo.label) + '">' + escapeHtml(fo.label) + "</option>").join("");
    f.origem.value = parsed.fontes.some((fo) => fo.label === atual) ? atual : "";
  }

  function populateCboSigtapFilters(f, parsed, utils) {
    const escapeHtml = utils.escapeHtml, cboNome = utils.cboNome, sigtapNome = utils.sigtapNome;
    const cbos = [...new Set(parsed.registros.map((r) => r.cbo))].sort();
    const sigtaps = [...new Set(parsed.registros.map((r) => r.sigtap))].sort();
    const atualCbo = f.cbo.value, atualSigtap = f.sigtap.value;

    f.cbo.innerHTML = '<option value="">Todos</option>' + cbos.map((c) =>
      '<option value="' + escapeHtml(c) + '">' + escapeHtml(c + (cboNome(c) ? " · " + cboNome(c) : "")) + "</option>"
    ).join("");
    f.sigtap.innerHTML = '<option value="">Todos</option>' + sigtaps.map((c) =>
      '<option value="' + escapeHtml(c) + '">' + escapeHtml(c + (sigtapNome(c) ? " · " + sigtapNome(c) : "")) + "</option>"
    ).join("");

    f.cbo.value = cbos.indexOf(atualCbo) !== -1 ? atualCbo : "";
    f.sigtap.value = sigtaps.indexOf(atualSigtap) !== -1 ? atualSigtap : "";
  }

  // município (IBGE) só existe no BPA-I (tipo 03) — dropdown porque a
  // cardinalidade costuma ser pequena (ao contrário do CEP, texto livre).
  function populateIbgeFilter(f, parsed, escapeHtml) {
    const ibges = [...new Set(parsed.registros.filter((r) => r.tipo === "03").map((r) => (r.municipioIbge || "").trim()).filter(Boolean))].sort();
    const atual = f.ibge.value;
    f.ibge.innerHTML = '<option value="">Todos</option>' + ibges.map((c) =>
      '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>"
    ).join("");
    f.ibge.value = ibges.indexOf(atual) !== -1 ? atual : "";
  }

  function populateProblemaFilter(f, parsed, escapeHtml) {
    const counts = {};
    parsed.registros.forEach((r) => r.problemas.forEach((p) => { counts[p.cod] = (counts[p.cod] || 0) + 1; }));
    const codigos = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const atual = f.problema.value;
    f.problema.innerHTML = '<option value="">Todos</option>' + codigos.map((cod) => {
      const info = QBPA.PROBLEMA_CATALOG[cod];
      return '<option value="' + cod + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + " · " + escapeHtml(info.texto) + " (" + counts[cod] + ")</option>";
    }).join("");
    f.problema.value = codigos.indexOf(atual) !== -1 ? atual : "";
  }

  // ---------- filtragem / apresentação de cada linha ----------
  function filteredRegistros(parsed, f, utils) {
    const cboNome = utils.cboNome, sigtapNome = utils.sigtapNome;
    const tipo = f.tipo.value;
    const origem = f.origem.value;
    const cbo = f.cbo.value;
    const sigtap = f.sigtap.value;
    const ibge = f.ibge.value;
    const cep = f.cep.value.trim();
    const problema = f.problema.value;
    const busca = f.busca.value.trim().toLowerCase();
    const soProblemas = f.soProblemas.checked;
    const soNaoLocalizado = f.soNaoLocalizado.checked;

    return parsed.registros.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      if (origem && r.origem !== origem) return false;
      if (cbo && r.cbo !== cbo) return false;
      if (sigtap && r.sigtap !== sigtap) return false;
      if (ibge && (r.municipioIbge || "").trim() !== ibge) return false;
      if (cep && (r.cep || "").indexOf(cep) === -1) return false;
      if (problema && !r.problemas.some((p) => p.cod === problema)) return false;
      if (soProblemas && r.problemas.length === 0) return false;
      if (soNaoLocalizado && r.sigtapEncontrado) return false;
      if (busca) {
        const alvo = ((r.nomePaciente || "") + " " + r.sigtap + " " + sigtapNome(r.sigtap) + " " + r.cbo + " " + cboNome(r.cbo)).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function situacaoHtml(r) {
    if (!r.problemas.length) return '<span class="badge b-ok">OK</span>';
    const pior = r.problemas.some((p) => p.sev === "erro") ? "erro" : "aviso";
    return '<span class="badge sev-' + pior + '">' +
      (pior === "erro" ? "Erro" : "Aviso") + " (" + r.problemas.length + ")</span>";
  }

  function problemasDetalheHtml(r, escapeHtml) {
    if (!r.problemas.length) return '<span class="ok-txt">—</span>';
    return '<div class="problema-list">' + r.problemas.map((p) =>
      '<div class="probitem probitem-' + p.sev + '"><b>' + escapeHtml(p.texto) + ":</b> " + escapeHtml(p.explicacao) +
      '<span class="resolver">Como resolver: ' + escapeHtml(p.resolver) + "</span></div>"
    ).join("") + "</div>";
  }

  function exportCsv(parsed, f, utils) {
    const cboNome = utils.cboNome, sigtapNome = utils.sigtapNome;
    const regs = filteredRegistros(parsed, f, utils);
    const header = ["tipo", "origem", "folha", "seq", "cbo", "cbo_nome", "sigtap", "sigtap_nome", "data_atendimento", "quantidade", "valor_estimado_rs", "paciente", "ibge", "cep", "situacao", "o_que_e_como_resolver"];
    const linhas = regs.map((r) => [
      r.tipo, r.origem, r.folha, r.seq, r.cbo, cboNome(r.cbo), r.sigtap, sigtapNome(r.sigtap),
      r.tipo === "03" ? r.dataAtendimento : "",
      r.quantidade,
      r.valorEstimado.toFixed(2).replace(".", ","),
      r.tipo === "03" ? r.nomePaciente : "",
      r.tipo === "03" ? r.municipioIbge : "",
      r.tipo === "03" ? r.cep : "",
      r.problemas.length ? r.problemas.map((p) => p.texto).join(" | ") : "OK",
      r.problemas.length ? r.problemas.map((p) => p.texto + ": " + p.explicacao + " Como resolver: " + p.resolver).join(" | ") : "",
    ]);
    const csv = [header].concat(linhas).map((row) =>
      row.map((v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(";")
    ).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "qualidade_bpa_registros.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- tabela + paginação (substitui o corte fixo em 500 linhas do
  // app.js original por paginação de verdade sobre o mesmo resultado filtrado) ----------
  function renderDrilldown(el, f, parsed, utils, state) {
    const escapeHtml = utils.escapeHtml;
    const fmtData = utils.fmtData;
    const fmtMoeda = utils.fmtMoeda;
    const cboCelHtml = utils.cboCelHtml;
    const sigtapCelHtml = utils.sigtapCelHtml;
    const setMsg = utils.setMsg;
    const clearMsg = utils.clearMsg;

    const regsAll = filteredRegistros(parsed, f, utils);

    el.querySelector("[data-reg-count]").textContent = regsAll.length.toLocaleString("pt-BR");

    let receberF = 0, pendenteF = 0;
    regsAll.forEach((r) => {
      if (!r.sigtapEncontrado) return;
      if (r.problemas.length > 0) pendenteF += r.valorEstimado; else receberF += r.valorEstimado;
    });
    const totalF = receberF + pendenteF;
    const pctPagarF = totalF ? Math.round((receberF / totalF) * 100) : 0;
    el.querySelector("[data-reg-valor-total]").textContent = fmtMoeda(totalF);
    el.querySelector("[data-reg-valor-pagar]").textContent = fmtMoeda(receberF);
    el.querySelector("[data-reg-valor-pagar-label]").textContent =
      "valor total a pagar (" + pctPagarF + "% do total · " + fmtMoeda(pendenteF) + " pendente)";

    const total = regsAll.length;
    const pageSize = parseInt(f.pageSize.value, 10) || 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.min(Math.max(state.page, 1), totalPages);
    const startIdx = (state.page - 1) * pageSize;
    const pageRegs = regsAll.slice(startIdx, startIdx + pageSize);

    const body = el.querySelector("[data-reg-body]");
    body.innerHTML = pageRegs.map((r) =>
      "<tr><td>" + r.tipo + "</td>" +
      '<td title="' + escapeHtml(r.origem) + '">' + escapeHtml(r.origem) + "</td>" +
      '<td class="num">' + r.folha + "</td>" +
      '<td class="num">' + r.seq + "</td>" +
      '<td class="num">' + cboCelHtml(r.cbo) + "</td>" +
      '<td class="num">' + sigtapCelHtml(r.sigtap) + "</td>" +
      "<td>" + (r.tipo === "03" ? fmtData(r.dataAtendimento) : "—") + "</td>" +
      '<td class="num">' + r.quantidade + "</td>" +
      '<td class="num">' + (r.sigtapEncontrado ? fmtMoeda(r.valorEstimado) : "—") + "</td>" +
      "<td>" + (r.tipo === "03" ? escapeHtml(r.nomePaciente) : "—") + "</td>" +
      "<td>" + (r.tipo === "03" ? escapeHtml(r.municipioIbge) : "—") + "</td>" +
      "<td>" + (r.tipo === "03" ? escapeHtml(r.cep) : "—") + "</td>" +
      "<td>" + situacaoHtml(r) + "</td>" +
      "<td>" + problemasDetalheHtml(r, escapeHtml) + "</td></tr>"
    ).join("");

    const filterMsg = el.querySelector("[data-reg-filter-msg]");
    clearMsg(filterMsg);
    if (total === 0) setMsg(filterMsg, "warn", "Nenhum registro corresponde aos filtros aplicados.");

    const from = total === 0 ? 0 : startIdx + 1;
    const to = Math.min(startIdx + pageSize, total);
    el.querySelector("[data-reg-pager-label]").textContent =
      "Mostrando " + from.toLocaleString("pt-BR") + "–" + to.toLocaleString("pt-BR") + " de " + total.toLocaleString("pt-BR");

    el.querySelector('[data-acao="prev"]').disabled = state.page <= 1;
    el.querySelector('[data-acao="next"]').disabled = state.page >= totalPages;
  }

  function filterEls(el) {
    return {
      tipo: el.querySelector('[data-f="tipo"]'),
      origem: el.querySelector('[data-f="origem"]'),
      cbo: el.querySelector('[data-f="cbo"]'),
      sigtap: el.querySelector('[data-f="sigtap"]'),
      ibge: el.querySelector('[data-f="ibge"]'),
      cep: el.querySelector('[data-f="cep"]'),
      problema: el.querySelector('[data-f="problema"]'),
      busca: el.querySelector('[data-f="busca"]'),
      soProblemas: el.querySelector('[data-f="soProblemas"]'),
      soNaoLocalizado: el.querySelector('[data-f="soNaoLocalizado"]'),
      pageSize: el.querySelector('[data-f="pageSize"]'),
    };
  }

  function render() {
    const el = document.getElementById("tela-registros");
    el.classList.add("tela-larga");
    const parsed = QBPA.parsed;
    const utils = QBPA.utils;
    const escapeHtml = utils.escapeHtml;

    if (!parsed) {
      el.innerHTML =
        '<div class="tela-header"><h1>Registros nominais</h1><p>Consulte, filtre e analise os registros da produção BPA.</p></div>' +
        '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    el.innerHTML = shellHtml(parsed);
    const f = filterEls(el);
    const state = { page: 1 };

    // preset de navegação (ex.: vindo de um card "Ver registros" de outra tela)
    // — lido e aplicado uma única vez, depois zerado pra não reaparecer numa
    // próxima visita manual a esta tela.
    const preset = QBPA.navPreset || {};
    QBPA.navPreset = null;

    populateOrigemFilter(el, f, parsed, escapeHtml);
    populateCboSigtapFilters(f, parsed, utils);
    populateIbgeFilter(f, parsed, escapeHtml);
    populateProblemaFilter(f, parsed, escapeHtml);

    f.tipo.value = preset.tipo || "";
    f.origem.value = preset.origem || "";
    f.cbo.value = preset.cbo || "";
    f.sigtap.value = preset.sigtap || "";
    f.ibge.value = preset.ibge || "";
    f.cep.value = preset.cep || "";
    f.problema.value = preset.problema || "";
    f.busca.value = "";
    f.soProblemas.checked = !!preset.soProblemas;
    f.soNaoLocalizado.checked = !!preset.soNaoLocalizado;

    el.querySelector("[data-reg-kpis]").innerHTML = kpiCardsHtml(parsed, utils);

    function doRender() { renderDrilldown(el, f, parsed, utils, state); }

    [f.tipo, f.origem, f.cbo, f.sigtap, f.ibge, f.cep, f.problema, f.busca, f.soProblemas, f.soNaoLocalizado].forEach((elIn) => {
      elIn.addEventListener("input", () => { state.page = 1; doRender(); });
    });
    f.pageSize.addEventListener("input", () => { state.page = 1; doRender(); });

    el.querySelector('[data-acao="prev"]').addEventListener("click", () => {
      state.page -= 1; doRender();
    });
    el.querySelector('[data-acao="next"]').addEventListener("click", () => {
      state.page += 1; doRender();
    });
    el.querySelector('[data-acao="limpar"]').addEventListener("click", () => {
      f.tipo.value = ""; f.origem.value = ""; f.cbo.value = ""; f.sigtap.value = "";
      f.ibge.value = ""; f.cep.value = ""; f.problema.value = ""; f.busca.value = "";
      f.soProblemas.checked = false; f.soNaoLocalizado.checked = false;
      state.page = 1;
      doRender();
    });
    el.querySelector('[data-acao="exportar"]').addEventListener("click", () => {
      exportCsv(parsed, f, utils);
    });

    doRender();
  }

  QBPA.telas.registros = { render };
})();
