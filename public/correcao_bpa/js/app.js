(function () {
  "use strict";

  const parser = window.QualidadeBpaParser;
  const writer = window.CorrecaoBpaWriter;
  const lookup = window.QualidadeBpaLookup;
  const STORAGE_KEY = "qualidade_bpa_correcao_payload";

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtData(aaaammdd) {
    if (!/^\d{8}$/.test(aaaammdd || "")) return aaaammdd || "";
    return aaaammdd.slice(6, 8) + "/" + aaaammdd.slice(4, 6) + "/" + aaaammdd.slice(0, 4);
  }
  function fmtMoeda(v) {
    return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function cboNome(codigo) { return lookup.nomeCbo(codigo); }
  function sigtapNome(codigo) { return lookup.nomeSigtap(codigo); }
  function cboCelHtml(codigo) {
    const nome = cboNome(codigo);
    return escapeHtml(codigo) + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }
  function sigtapCelHtml(codigo) {
    const nome = sigtapNome(codigo);
    return escapeHtml(codigo) + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }
  function progressColor(pct) {
    return pct >= 90 ? "var(--teal)" : pct >= 70 ? "var(--amber)" : "var(--red)";
  }

  const viewVazio = document.getElementById("viewVazio");
  const viewResumo = document.getElementById("viewResumo");
  const viewRevisao = document.getElementById("viewRevisao");
  const btnVoltarResumo = document.getElementById("btnVoltarResumo");

  let payload = null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    payload = raw ? JSON.parse(raw) : null;
  } catch (err) {
    payload = null;
  }

  if (!payload || !payload.fontes || !payload.fontes.length) {
    viewVazio.classList.remove("hidden");
    viewResumo.classList.add("hidden");
    return;
  }

  viewVazio.classList.add("hidden");

  const autoResolvidos = payload.autoResolvidos || 0;

  // decodifica cada linha bruta com o mesmo parser do Qualidade BPA (dá
  // acesso a todos os campos - SIGTAP, CBO, data, CNES, paciente etc. - sem
  // precisar levar nada disso no payload), e aplica por cima os codigos de
  // pendencia (por indice) que vieram do handoff.
  function hidratarFonte(fonte) {
    const pendMap = {};
    (fonte.pendencias || []).forEach((p) => { pendMap[p.idx] = p; });
    const registros = (fonte.linhas || []).map((linha, idx) => {
      const tipo = linha.slice(0, 2);
      const registro = tipo === "03" ? parser.parseTipo03(linha) : parser.parseTipo02(linha);
      registro.idx = idx;
      const pend = pendMap[idx];
      if (pend) registro.cods = pend.cods;
      return registro;
    });
    return { nome: fonte.nome, label: fonte.label, header: fonte.header, registros };
  }

  const fontes = payload.fontes.map(hidratarFonte);

  function pendenciasFlat() {
    const lista = [];
    fontes.forEach((fonte, fonteIdx) => {
      fonte.registros.forEach((registro, regIdx) => {
        if (registro.cods && registro.cods.length) lista.push({ fonte, fonteIdx, regIdx, registro });
      });
    });
    return lista;
  }
  const todasPendencias = pendenciasFlat();

  // -------- resumo geral --------
  function renderResumo() {
    const totalComProblema = autoResolvidos + todasPendencias.length;
    const el = document.getElementById("resumoBox");
    if (!totalComProblema) {
      el.className = "alert-banner show ok";
      el.innerHTML = "<b>Nenhuma pendência encontrada.</b> Folha/sequência já renumerada e conferida para " +
        fontes.length + " arquivo(s) — pode baixar direto.";
    } else {
      el.className = "alert-banner show";
      el.innerHTML = "<b>" + totalComProblema + " registro(s) com pendência</b> em " + fontes.length + " arquivo(s). " +
        "<b>" + autoResolvidos + "</b> resolvido(s) automaticamente (renumeração de folha/sequência). " +
        "<b>" + todasPendencias.length + "</b> precisa(m) de revisão manual — corrija ou deixe como está (pular).";
    }

    const btnVer = document.getElementById("btnVerPendencias");
    if (todasPendencias.length) btnVer.classList.remove("hidden"); else btnVer.classList.add("hidden");
  }

  function renderFontes() {
    document.getElementById("fontesResumo").innerHTML = fontes.map((fonte) => {
      const comp = fonte.header ? fonte.header.competencia : "—";
      return '<div class="fonte-row"><div class="fonte-info">' +
        '<span class="fonte-nome">' + escapeHtml(fonte.label || fonte.nome) + "</span>" +
        '<span class="fonte-original">competência ' + escapeHtml(comp) + "</span>" +
        '<span class="fonte-count">' + fonte.registros.length + " registro(s)</span>" +
        "</div></div>";
    }).join("");
  }

  // -------- faturamento (recalcula a cada correcao/revisao) --------
  function calcularFaturamento() {
    let total = 0, pendente = 0, resolvido = 0, naoLocalizados = 0;
    fontes.forEach((fonte) => fonte.registros.forEach((r) => {
      const info = lookup.sigtapInfo(r.sigtap);
      if (!info) { naoLocalizados++; return; }
      const valor = info.valor * (r.quantidade || 0);
      total += valor;
      if (r.cods && r.cods.length) {
        if (r.excluido || r.revisado) resolvido += valor; else pendente += valor;
      }
    }));
    return { total, pendente, resolvido, naoLocalizados };
  }

  function cardHtml(opts) {
    const badge = opts.badge !== undefined ? opts.badge : "";
    const bar = opts.pct != null
      ? '<div class="bar-track"><div class="bar-fill" style="width:' + opts.pct + '%;background:' + (opts.barColor || progressColor(opts.pct)) + '"></div></div>'
      : "";
    return '<div class="ind-card"><div class="ind-card-top">' + badge + "</div>" +
      '<div class="valor" style="' + (opts.corValor ? "color:" + opts.corValor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + opts.desc + "</div>" + bar + "</div>";
  }

  function renderFaturamento() {
    const f = calcularFaturamento();
    const baseRevisao = f.pendente + f.resolvido;
    const pctResolvido = baseRevisao ? Math.round((f.resolvido / baseRevisao) * 100) : 100;

    const cards = [
      {
        valor: fmtMoeda(f.total), titulo: "Faturamento total estimado",
        desc: "Soma do valor SIGTAP × quantidade de todos os registros do arquivo (auto-resolvidos, pendentes e limpos).",
        badge: '<span class="badge b-soon">Estimado</span>',
      },
      {
        valor: fmtMoeda(f.pendente), titulo: "Em risco (pendência ainda não revisada)",
        desc: "Registros com pendência que ainda não foram corrigidos, revisados ou excluídos — risco de rejeição/glosa.",
        corValor: "var(--red)", badge: '<span class="badge sev-erro pct-badge">' + (100 - pctResolvido) + "% pendente</span>",
      },
      {
        valor: fmtMoeda(f.resolvido), titulo: "Já revisado/corrigido",
        desc: "Registros com pendência que você já corrigiu, marcou como revisado ou excluiu.",
        corValor: "var(--teal)", pct: pctResolvido, barColor: "var(--teal)",
        badge: '<span class="badge b-ok pct-badge">' + pctResolvido + "%</span>",
      },
    ];
    document.getElementById("cardsFaturamento").innerHTML = cards.map(cardHtml).join("");
  }

  // -------- filtros / tabela de revisao (view clara) --------
  const fTipo = document.getElementById("fTipo");
  const fOrigem = document.getElementById("fOrigem");
  const fUnidade = document.getElementById("fUnidade");
  const fProblema = document.getElementById("fProblema");
  const fBusca = document.getElementById("fBusca");
  const fSoNaoRevisados = document.getElementById("fSoNaoRevisados");
  const campoOrigem = document.getElementById("campoOrigem");
  const filterMsg = document.getElementById("filterMsg");

  function popularFiltrosRevisao() {
    if (fontes.length > 1) {
      campoOrigem.classList.remove("hidden");
      const origens = [...new Set(fontes.map((f) => f.label || f.nome))];
      fOrigem.innerHTML = '<option value="">Todas</option>' + origens.map((o) => '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + "</option>").join("");
    }

    const unidades = [...new Set(todasPendencias.map((p) => p.registro.cnes))].sort();
    fUnidade.innerHTML = '<option value="">Todas</option>' + unidades.map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>").join("");

    const counts = {};
    todasPendencias.forEach((p) => p.registro.cods.forEach((cod) => { counts[cod] = (counts[cod] || 0) + 1; }));
    const codigos = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    fProblema.innerHTML = '<option value="">Todos</option>' + codigos.map((cod) => {
      const info = writer.PROBLEMA_CATALOG[cod] || { sev: "aviso", texto: cod };
      return '<option value="' + cod + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + " · " + escapeHtml(info.texto) + " (" + counts[cod] + ")</option>";
    }).join("");
  }

  function filteredPendencias() {
    const tipo = fTipo.value, origem = fOrigem.value, unidade = fUnidade.value, problema = fProblema.value;
    const busca = fBusca.value.trim().toLowerCase();
    const soNaoRevisados = fSoNaoRevisados.checked;

    return todasPendencias.filter(({ fonte, registro }) => {
      if (tipo && registro.tipo !== tipo) return false;
      if (origem && (fonte.label || fonte.nome) !== origem) return false;
      if (unidade && registro.cnes !== unidade) return false;
      if (problema && registro.cods.indexOf(problema) === -1) return false;
      if (soNaoRevisados && registro.revisado) return false;
      if (busca) {
        const alvo = ((registro.nomePaciente || "") + " " + registro.sigtap + " " + sigtapNome(registro.sigtap) + " " + registro.cbo + " " + cboNome(registro.cbo)).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function camposEditaveis(cods) {
    const set = new Set();
    cods.forEach((cod) => {
      const campos = writer.CAMPOS_POR_PROBLEMA[cod];
      if (campos) campos.forEach((c) => set.add(c));
    });
    return [...set];
  }

  function valorAtual(registro, campo) {
    if (registro.correcoes && registro.correcoes[campo] != null) return registro.correcoes[campo];
    if (campo === "dataAtendimento" || campo === "dataNascimento") return fmtData(registro[campo]);
    return registro[campo];
  }

  function linhaRevisaoHtml(fonteIdx, regIdx, registro, origemLabel) {
    const campos = camposEditaveis(registro.cods);
    const inputs = campos.map((campo) =>
      '<label class="campo-corrigir">' + writer.CAMPO_LABEL[campo] + ":" +
      '<input data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '" data-campo="' + campo + '" value="' +
      escapeHtml(valorAtual(registro, campo)) + '"></label>'
    ).join("");

    const problemasHtml = registro.cods.map((cod) => {
      const info = writer.PROBLEMA_CATALOG[cod] || { sev: "aviso", texto: cod, explicacao: "", resolver: "" };
      return '<div class="probitem probitem-' + info.sev + '"><b>' + escapeHtml(info.texto) + ":</b> " + escapeHtml(info.explicacao) +
        '<span class="resolver">Como resolver: ' + escapeHtml(info.resolver) + "</span></div>";
    }).join("");

    return '<tr data-linha-fonte="' + fonteIdx + '" data-linha-reg="' + regIdx + '">' +
      "<td>" + registro.tipo + "</td>" +
      "<td>" + escapeHtml(registro.cnes) + "</td>" +
      "<td>" + escapeHtml(origemLabel) + "</td>" +
      "<td>" + (registro.tipo === "03" ? fmtData(registro.dataAtendimento) : "—") + "</td>" +
      '<td class="num">' + sigtapCelHtml(registro.sigtap) + "</td>" +
      '<td class="num">' + cboCelHtml(registro.cbo) + "</td>" +
      "<td>" + (registro.tipo === "03" ? escapeHtml(registro.nomePaciente || "") : "—") + "</td>" +
      '<td><div class="problema-list">' + problemasHtml + "</div></td>" +
      "<td>" + (inputs || '<span class="ok-txt">sem campo — só revisar</span>') + "</td>" +
      '<td class="col-acoes"><label><input type="checkbox" data-revisado data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '"' + (registro.revisado ? " checked" : "") + '> Revisado</label>' +
      '<label><input type="checkbox" data-excluir data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '"' + (registro.excluido ? " checked" : "") + '> Excluir linha</label></td>' +
      "</tr>";
  }

  function renderTabela() {
    const lista = filteredPendencias();
    const MAX = 500;
    document.getElementById("sidebarCount").textContent = lista.length.toLocaleString("pt-BR");
    document.getElementById("tabelaRevisaoBody").innerHTML = lista.slice(0, MAX).map(({ fonteIdx, regIdx, registro, fonte }) =>
      linhaRevisaoHtml(fonteIdx, regIdx, registro, fonte.label || fonte.nome)
    ).join("");
    wireTabelaEventos();

    clearMsg(filterMsg);
    if (lista.length === 0) setMsg(filterMsg, "warn", "Nenhuma pendência corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(filterMsg, "warn", lista.length + " pendências encontradas — mostrando as primeiras " + MAX + ".");
  }
  [fTipo, fOrigem, fUnidade, fProblema, fBusca, fSoNaoRevisados].forEach((el) => el.addEventListener("input", renderTabela));

  function wireTabelaEventos() {
    document.querySelectorAll("#tabelaRevisaoBody input[data-campo]").forEach((input) => {
      input.addEventListener("input", () => {
        const registro = fontes[+input.dataset.fonte].registros[+input.dataset.reg];
        registro.correcoes = registro.correcoes || {};
        registro.correcoes[input.dataset.campo] = input.value;
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody input[data-revisado]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const registro = fontes[+chk.dataset.fonte].registros[+chk.dataset.reg];
        registro.revisado = chk.checked;
        chk.closest("tr").classList.toggle("linha-revisada", chk.checked);
        renderFaturamento();
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody input[data-excluir]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const registro = fontes[+chk.dataset.fonte].registros[+chk.dataset.reg];
        registro.excluido = chk.checked;
        chk.closest("tr").classList.toggle("linha-excluida", chk.checked);
        renderFaturamento();
      });
    });
  }

  // -------- geracao/download --------
  function baixarTexto(nomeArquivo, texto) {
    const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function nomeCorrigido(nomeOriginal) {
    return nomeOriginal.replace(/\.txt$/i, "") + "_corrigido.txt";
  }

  function renderDownloads() {
    const el = document.getElementById("downloadsBox");
    let html = fontes.map((fonte, i) =>
      '<button class="btn btn-ghost-dark" data-baixar-fonte="' + i + '">⬇ Baixar corrigido — ' + escapeHtml(fonte.label || fonte.nome) + "</button>"
    ).join("");

    if (fontes.length > 1 && writer.mesmaCompetencia(fontes)) {
      html += '<button class="btn" id="btnBaixarUnico" style="background:var(--teal);color:#04241c;">⬇ Baixar arquivo único (todas as fontes)</button>';
    } else if (fontes.length > 1) {
      html += '<div class="msg show warn" style="margin-top:10px;">As fontes têm competências diferentes — não gero um arquivo único automaticamente pra não misturar competência errada. Baixe cada uma separadamente acima.</div>';
    }
    el.innerHTML = html;

    document.querySelectorAll("[data-baixar-fonte]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fonte = fontes[+btn.dataset.baixarFonte];
        const out = writer.montarArquivo(fonte);
        baixarTexto(nomeCorrigido(fonte.nome), out.texto);
      });
    });
    const btnUnico = document.getElementById("btnBaixarUnico");
    if (btnUnico) {
      btnUnico.addEventListener("click", () => {
        const out = writer.montarArquivoUnico(fontes);
        baixarTexto("bpa_corrigido_unico.txt", out.texto);
      });
    }
  }

  // -------- navegacao entre as 2 views --------
  function showResumo() {
    viewResumo.classList.remove("hidden");
    viewRevisao.classList.add("hidden");
    btnVoltarResumo.classList.add("hidden");
  }
  function showRevisao() {
    viewResumo.classList.add("hidden");
    viewRevisao.classList.remove("hidden");
    btnVoltarResumo.classList.remove("hidden");
    popularFiltrosRevisao();
    renderTabela();
  }
  document.getElementById("btnVerPendencias").addEventListener("click", showRevisao);
  btnVoltarResumo.addEventListener("click", showResumo);

  lookup.ready.finally(() => {
    renderResumo();
    renderFontes();
    renderFaturamento();
    renderDownloads();
    showResumo();
  });

})();
