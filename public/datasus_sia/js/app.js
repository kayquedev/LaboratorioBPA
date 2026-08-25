(function () {
  "use strict";

  const parser = window.DatasusSiaParser;
  const lookup = window.QualidadeBpaLookup;

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtMoeda(v) {
    return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function fmtPct(v) {
    return Math.round((v || 0) * 100) + "%";
  }
  function fmtCompetencia(c) {
    if (!c || c.length !== 6) return c || "—";
    const MESES_NOME = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return MESES_NOME[parseInt(c.slice(4, 6), 10)] + "/" + c.slice(0, 4);
  }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function progressColor(pct) {
    return pct >= 90 ? "var(--teal)" : pct >= 70 ? "var(--amber)" : "var(--red)";
  }

  const viewUpload = document.getElementById("viewUpload");
  const viewDashboard = document.getElementById("viewDashboard");
  const viewTabela = document.getElementById("viewTabela");
  const btnVoltar = document.getElementById("btnVoltarDashboard");
  const msgUpload = document.getElementById("msgUpload");

  let fontes = [];

  function sigtapCelHtml(codigo) {
    const nome = lookup.nomeSigtap(codigo);
    return escapeHtml(codigo) + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }

  // -------- upload (multi-arquivo) --------
  function lerTexto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, "utf-8");
    });
  }

  function processarArquivos(fileList) {
    clearMsg(msgUpload);
    const arquivos = Array.from(fileList);
    Promise.all(arquivos.map((f) => lerTexto(f).then((texto) => parser.parseFile(texto, f.name))))
      .then((novasFontes) => {
        const semRegistro = novasFontes.filter((f) => !f.registros.length);
        if (semRegistro.length) {
          setMsg(msgUpload, "error", "Não encontrei nenhum procedimento em: " + semRegistro.map((f) => f.nome).join(", ") + " — confirme se é o relatório RSPROCED correto.");
        }
        const comRegistro = novasFontes.filter((f) => f.registros.length);
        if (!comRegistro.length) return;

        fontes = fontes.concat(comRegistro);
        renderDashboard();
        showDashboard();
      })
      .catch((err) => {
        setMsg(msgUpload, "error", "Erro ao ler o(s) arquivo(s): " + (err && err.message ? err.message : err));
      });
  }

  function wireUpload(dropId, inputId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    drop.addEventListener("click", () => input.click());
    ["dragover", "dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.toggle("drag", ev === "dragover");
        if (ev === "drop" && e.dataTransfer.files.length) processarArquivos(e.dataTransfer.files);
      });
    });
    input.addEventListener("change", () => {
      if (input.files.length) processarArquivos(input.files);
      input.value = "";
    });
  }
  wireUpload("dropArquivos", "inputArquivos");
  wireUpload("dropArquivosDashboard", "inputArquivosDashboard");

  function todosRegistros() {
    const lista = [];
    fontes.forEach((fonte) => fonte.registros.forEach((r) => lista.push(r)));
    return lista;
  }

  // -------- dashboard --------
  function cardHtml(opts) {
    const badge = opts.badge || "";
    const bar = opts.pct != null
      ? '<div class="bar-track"><div class="bar-fill" style="width:' + opts.pct + '%;background:' + (opts.barColor || progressColor(opts.pct)) + '"></div></div>'
      : "";
    return '<div class="ind-card"><div class="ind-card-top">' + badge + "</div>" +
      '<div class="valor" style="' + (opts.cor ? "color:" + opts.cor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + opts.desc + "</div>" + bar + "</div>";
  }

  function renderResumo() {
    const registros = todosRegistros();
    const total = registros.reduce((a, r) => { a.produzido += r.produzido; a.aprovado += r.aprovado; return a; }, { produzido: 0, aprovado: 0 });
    const glosa = total.produzido - total.aprovado;
    const pctAprovado = total.produzido ? Math.round((total.aprovado / total.produzido) * 100) : 100;

    const cards = [
      { valor: fmtMoeda(total.produzido), titulo: "Faturamento produzido", desc: registros.length + " registro(s) de procedimento, em " + fontes.length + " arquivo(s).", badge: '<span class="badge b-soon">Total</span>' },
      { valor: fmtMoeda(total.aprovado), titulo: "Faturamento aprovado", cor: "var(--teal)", pct: pctAprovado, barColor: "var(--teal)", desc: "Efetivamente pago pelo SIA/SUS nessa(s) competência(s).", badge: '<span class="badge b-ok pct-badge">' + pctAprovado + "%</span>" },
      { valor: fmtMoeda(glosa), titulo: "Glosa", cor: "var(--red)", desc: "Produzido menos aprovado — valor faturado e rejeitado pelo SIA.", badge: '<span class="badge sev-erro pct-badge">' + (100 - pctAprovado) + "% do produzido</span>" },
    ];
    document.getElementById("cardsResumo").innerHTML = cards.map(cardHtml).join("");
  }

  function renderConferencia() {
    const el = document.getElementById("alertConferencia");
    const problemas = [];
    fontes.forEach((fonte) => {
      const conf = parser.conferirTotais(fonte);
      if (conf.bateGeral === false) problemas.push("O total geral calculado de \"" + fonte.nome + "\" não bate com o TOTAL GERAL declarado no arquivo.");
      conf.divergenciasPorUnidade.forEach((d) => problemas.push("A unidade " + d.nome + " (" + fonte.nome + ") tem soma diferente do TOTAL DA UNIDADE declarado."));
    });
    if (problemas.length) {
      el.className = "alert-banner show";
      el.innerHTML = "<b>Atenção — divergência na conferência:</b><br>" + problemas.map(escapeHtml).join("<br>");
    } else {
      el.className = "alert-banner show ok";
      el.innerHTML = "<b>Conferência ok.</b> A soma calculada de cada arquivo bate exatamente com os totais (\"TOTAL DA UNIDADE\"/\"TOTAL GERAL\") declarados no próprio relatório.";
    }
  }

  function renderFontes() {
    document.getElementById("fontesResumo").innerHTML = fontes.map((fonte) => {
      const unidades = new Set(fonte.registros.map((r) => r.cnes)).size;
      return '<div class="fonte-row"><div class="fonte-info">' +
        '<span class="fonte-nome">' + escapeHtml(fonte.nome) + "</span>" +
        '<span class="fonte-original">competência ' + escapeHtml(fmtCompetencia(fonte.competencia)) + "</span>" +
        '<span class="fonte-count">' + fonte.registros.length + " registro(s) · " + unidades + " unidade(s)</span>" +
        "</div></div>";
    }).join("");
  }

  // mesmos indicadores por setor já usados no Qualidade BPA/Correção BPA
  const SETOR_INDICADORES = {
    "Laboratório": ["0202020380"],
    "Pronto Atendimento": ["0301060096"],
    "Especialidades": ["0301010072", "0301010048"],
    "Fisioterapia": ["0302050027"],
    "TFD (transporte)": ["0803010125", "0803010109"],
  };
  function renderSetores() {
    const codigosPresentes = new Set(todosRegistros().map((r) => r.sigtap));
    const html = Object.entries(SETOR_INDICADORES).map(([nome, codigos]) => {
      const importado = codigos.some((c) => codigosPresentes.has(c));
      return '<span class="badge ' + (importado ? "b-ok" : "sev-erro") + '" style="margin-right:8px;">' +
        (importado ? "✓" : "✗") + " " + escapeHtml(nome) + "</span>";
    }).join(" ");
    document.getElementById("setoresResumo").innerHTML = html;
  }

  function agruparPorChave(registros, chaveFn) {
    const mapa = new Map();
    registros.forEach((r) => {
      const k = chaveFn(r);
      if (!mapa.has(k)) mapa.set(k, { produzido: 0, aprovado: 0, registro: r });
      const g = mapa.get(k);
      g.produzido += r.produzido;
      g.aprovado += r.aprovado;
    });
    return [...mapa.values()].map((g) => ({ ...g, glosa: g.produzido - g.aprovado }));
  }

  function renderPainelGlosas() {
    const registros = todosRegistros();
    const grupos = agruparPorChave(registros, (r) => r.sigtap)
      .filter((g) => g.glosa > 0.001)
      .sort((a, b) => b.glosa - a.glosa)
      .slice(0, 12);
    const html = grupos.length
      ? '<table><tbody>' + grupos.map((g) => {
          const nomeCompleto = lookup.nomeSigtap(g.registro.sigtap);
          const subtitulo = nomeCompleto && nomeCompleto.toUpperCase() !== g.registro.descricao.toUpperCase() ? nomeCompleto : g.registro.sigtap;
          return "<tr><td>" + escapeHtml(g.registro.descricao) + '<span class="sub-nome">' + escapeHtml(subtitulo) + "</span></td>" +
            '<td class="n">' + fmtMoeda(g.glosa) + "</td></tr>";
        }).join("") + "</tbody></table>"
      : '<p class="vazio">Nenhuma glosa encontrada.</p>';
    document.getElementById("painelGlosas").innerHTML = html;
  }

  function renderPainelUnidades() {
    const registros = todosRegistros();
    const grupos = agruparPorChave(registros, (r) => r.cnes)
      .sort((a, b) => b.glosa - a.glosa);
    const html = grupos.length
      ? '<table><tbody>' + grupos.map((g) => (
          "<tr><td>" + escapeHtml(g.registro.nomeUnidade) + "<br><span class=\"sub-nome\">CNES " + escapeHtml(g.registro.cnes) + "</span></td>" +
          '<td class="n">' + fmtMoeda(g.glosa) + "</td></tr>"
        )).join("") + "</tbody></table>"
      : '<p class="vazio">—</p>';
    document.getElementById("painelUnidades").innerHTML = html;
  }

  function renderDashboard() {
    renderResumo();
    renderConferencia();
    renderFontes();
    renderSetores();
    renderPainelGlosas();
    renderPainelUnidades();
  }

  // -------- filtros / tabela (view clara) --------
  const fUnidade = document.getElementById("fUnidade");
  const fCompetencia = document.getElementById("fCompetencia");
  const campoCompetencia = document.getElementById("campoCompetencia");
  const fBusca = document.getElementById("fBusca");
  const fSoGlosa = document.getElementById("fSoGlosa");
  const filterMsg = document.getElementById("filterMsg");

  function popularFiltros() {
    const registros = todosRegistros();
    const unidades = [...new Map(registros.map((r) => [r.cnes, r.nomeUnidade])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    fUnidade.innerHTML = '<option value="">Todas</option>' + unidades.map(([cnes, nome]) => '<option value="' + escapeHtml(cnes) + '">' + escapeHtml(nome) + " (" + escapeHtml(cnes) + ")</option>").join("");

    if (fontes.length > 1) {
      campoCompetencia.classList.remove("hidden");
      const competencias = [...new Set(fontes.map((f) => f.competencia))].sort();
      fCompetencia.innerHTML = '<option value="">Todas</option>' + competencias.map((c) => '<option value="' + c + '">' + fmtCompetencia(c) + "</option>").join("");
    } else {
      campoCompetencia.classList.add("hidden");
    }
  }

  function filtrados() {
    const unidade = fUnidade.value;
    const competencia = fCompetencia.value;
    const soGlosa = fSoGlosa.checked;
    const busca = fBusca.value.trim().toLowerCase();
    return todosRegistros().filter((r) => {
      if (unidade && r.cnes !== unidade) return false;
      if (competencia && r.competencia !== competencia) return false;
      if (soGlosa && r.glosa <= 0.001) return false;
      if (busca) {
        const alvo = (r.descricao + " " + r.sigtap + " " + lookup.nomeSigtap(r.sigtap)).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function renderTabela() {
    const lista = filtrados().sort((a, b) => b.glosa - a.glosa);
    const MAX = 800;
    document.getElementById("sidebarCount").textContent = lista.length.toLocaleString("pt-BR");

    document.getElementById("tabelaBody").innerHTML = lista.slice(0, MAX).map((r) => (
      "<tr>" +
      "<td>" + fmtCompetencia(r.competencia) + "</td>" +
      "<td>" + escapeHtml(r.nomeUnidade) + '<span class="sub-nome">CNES ' + escapeHtml(r.cnes) + "</span></td>" +
      '<td class="num">' + sigtapCelHtml(r.sigtap) + "</td>" +
      "<td>" + escapeHtml(r.descricao) + "</td>" +
      '<td class="num">' + fmtMoeda(r.produzido) + "</td>" +
      '<td class="num">' + fmtMoeda(r.aprovado) + "</td>" +
      '<td class="num" style="color:' + (r.glosa > 0.001 ? "var(--red)" : "var(--light-text-dim)") + '">' + fmtMoeda(r.glosa) + "</td>" +
      '<td class="num">' + fmtPct(r.pctGlosa) + "</td>" +
      "</tr>"
    )).join("");

    clearMsg(filterMsg);
    if (lista.length === 0) setMsg(filterMsg, "warn", "Nenhum procedimento corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(filterMsg, "warn", lista.length + " procedimentos encontrados — mostrando os primeiros " + MAX + " (ordenados por maior glosa).");
  }
  [fUnidade, fCompetencia, fBusca, fSoGlosa].forEach((el) => el.addEventListener("input", renderTabela));

  // -------- navegação --------
  function showDashboard() {
    viewUpload.classList.add("hidden");
    viewTabela.classList.add("hidden");
    viewDashboard.classList.remove("hidden");
    btnVoltar.classList.add("hidden");
  }
  function showTabela() {
    viewUpload.classList.add("hidden");
    viewDashboard.classList.add("hidden");
    viewTabela.classList.remove("hidden");
    btnVoltar.classList.remove("hidden");
    popularFiltros();
    renderTabela();
  }
  document.getElementById("btnVerTabela").addEventListener("click", showTabela);
  btnVoltar.addEventListener("click", showDashboard);

  lookup.ready.finally(() => {
    viewUpload.classList.remove("hidden");
  });
})();
