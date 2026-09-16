(function () {
  "use strict";

  const csv = window.CsvGenericoParser;

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function normalizarDocumento(v) { return (v || "").replace(/\D/g, ""); }
  function normalizarTexto(s) {
    return (s || "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
  }
  function tituloCase(s) {
    const minusculas = new Set(["de", "da", "do", "dos", "das", "e"]);
    return (s || "").toLowerCase().split(" ").map((p, i) => {
      if (i > 0 && minusculas.has(p)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(" ");
  }

  // -------- chaves de agrupamento --------
  function chaveLogradouroBruto(l) {
    const tipo = normalizarTexto(l["TIPO DE LOGRADOURO"]);
    const nome = normalizarTexto(l["LOGRADOURO"]);
    const partes = [tipo, nome].filter((v) => v && v !== "-");
    return partes.length ? partes.join(" ") : "(SEM LOGRADOURO)";
  }
  function chaveBairro(l) {
    const b = normalizarTexto(l["BAIRRO"]);
    return b && b !== "-" ? b : "(SEM BAIRRO)";
  }

  // -------- persistência (unificações e observações duram entre sessões) --------
  const MESCLAS_KEY = "mapa_territorio_mesclas";
  const OBS_KEY = "mapa_territorio_observacoes";
  function carregarJson(chave) {
    try { return JSON.parse(window.localStorage.getItem(chave) || "{}"); } catch (e) { return {}; }
  }
  function salvarJson(chave, valor) {
    try { window.localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* localStorage indisponível */ }
  }
  let mesclas = carregarJson(MESCLAS_KEY); // { "NOME CANONICO": ["BRUTO A", "BRUTO B", ...] }
  let observacoes = carregarJson(OBS_KEY); // { "NOME CANONICO": "texto" }
  function salvarMesclas() { salvarJson(MESCLAS_KEY, mesclas); }
  function salvarObservacoes() { salvarJson(OBS_KEY, observacoes); }

  function brutoParaCanonico() {
    const mapa = {};
    Object.keys(mesclas).forEach((canonico) => {
      (mesclas[canonico] || []).forEach((bruto) => { mapa[bruto] = canonico; });
    });
    return mapa;
  }

  // -------- estado --------
  const viewUpload = document.getElementById("viewUpload");
  const viewDashboard = document.getElementById("viewDashboard");
  const msgUpload = document.getElementById("msgUpload");
  let arquivosTerr = [];
  let territorioLinhas = [];
  const bairrosAbertos = new Set();

  function lerTexto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }
  function wireUpload(dropId, inputId, fnameId, multiplo, onFiles) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const fname = fnameId ? document.getElementById(fnameId) : null;
    drop.addEventListener("click", () => input.click());
    ["dragover", "dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.toggle("drag", ev === "dragover");
        if (ev === "drop" && e.dataTransfer.files.length) {
          onFiles(multiplo ? Array.from(e.dataTransfer.files) : [e.dataTransfer.files[0]]);
          if (fname) fname.textContent = Array.from(e.dataTransfer.files).map((f) => f.name).join(", ");
        }
      });
    });
    input.addEventListener("change", () => {
      if (!input.files.length) return;
      onFiles(multiplo ? Array.from(input.files) : [input.files[0]]);
      if (fname) fname.textContent = Array.from(input.files).map((f) => f.name).join(", ");
      input.value = "";
    });
  }

  wireUpload("dropTerr", "inputTerr", "fnameTerr", true, (files) => { arquivosTerr = arquivosTerr.concat(files); clearMsg(msgUpload); });
  wireUpload("dropTerrDashboard", "inputTerrDashboard", null, true, (files) => { arquivosTerr = arquivosTerr.concat(files); processar(); });

  document.getElementById("btnGerarPainel").addEventListener("click", () => {
    if (!arquivosTerr.length) { setMsg(msgUpload, "error", "Selecione ao menos um arquivo de território."); return; }
    processar();
  });

  function processar() {
    if (!arquivosTerr.length) return;
    clearMsg(msgUpload);
    Promise.all(arquivosTerr.map((f) => lerTexto(f).then((buf) => ({ buf, nome: f.name }))))
      .then((resultados) => {
        territorioLinhas = [];
        const erros = [];
        let algumaLinha = false;
        resultados.forEach((r) => {
          const parsed = csv.parseCsv(csv.decodeArrayBuffer(r.buf));
          if (parsed.erro) { erros.push(r.nome + ": " + parsed.erro); return; }
          const microarea = (parsed.filtros["Microárea"] || "").trim();
          parsed.linhas.forEach((l) => { l.__microareaArquivo = microarea; l.__arquivo = r.nome; });
          territorioLinhas = territorioLinhas.concat(parsed.linhas);
          if (parsed.linhas.length) algumaLinha = true;
        });
        if (!algumaLinha) {
          setMsg(msgUpload, "error", erros.length ? erros.join(" ") : "Não encontrei nenhuma linha de território no(s) arquivo(s) selecionado(s) — confirme se é o export \"Acompanhamento do território\" do e-SUS.");
          return;
        }
        renderDashboard();
        showDashboard();
        if (erros.length) window.alert(erros.join("\n"));
      })
      .catch((err) => setMsg(msgUpload, "error", "Erro ao ler o(s) arquivo(s): " + (err && err.message ? err.message : err)));
  }

  // -------- cálculo: bairro -> logradouro (canônico) -> {pessoas, famílias, variantes} --------
  function linhasFiltradas() {
    const microarea = document.getElementById("fMicroarea").value;
    const bairroSel = document.getElementById("fBairro").value;
    return territorioLinhas.filter((l) => {
      if (microarea && (l.__microareaArquivo || "") !== microarea) return false;
      if (bairroSel && chaveBairro(l) !== bairroSel) return false;
      return true;
    });
  }

  function calcularRelatorio(linhas) {
    const indice = brutoParaCanonico();
    const porBairro = new Map();
    linhas.forEach((l) => {
      const nome = l["NOME CIDADÃO"];
      if (!nome || nome === "-") return; // domicílio sem morador não entra na contagem de pessoas/famílias
      const bairro = chaveBairro(l);
      const bruto = chaveLogradouroBruto(l);
      const canonico = indice[bruto] || bruto;

      if (!porBairro.has(bairro)) porBairro.set(bairro, new Map());
      const porLogradouro = porBairro.get(bairro);
      if (!porLogradouro.has(canonico)) porLogradouro.set(canonico, { pessoas: 0, familiasSet: new Set(), brutos: new Set() });
      const grupo = porLogradouro.get(canonico);
      grupo.pessoas++;
      grupo.brutos.add(bruto);

      const respDoc = normalizarDocumento(l["CPF/CNS RESPONSÁVEL FAMILIAR"]);
      const chaveFamilia = respDoc || (bairro + "|" + canonico + "|" + normalizarTexto(l["NOME DO RESPONSÁVEL FAMILIAR"] || nome));
      grupo.familiasSet.add(chaveFamilia);
    });
    return porBairro;
  }

  // -------- KPIs --------
  function kpiCardHtml(cor, bg, icone, label, valor, desc) {
    return '<div class="kpi-card" style="border-left-color:' + cor + '">' +
      '<div class="kpi-top"><div class="kpi-icone" style="background:' + bg + '">' + icone + '</div><div class="kpi-label">' + label + "</div></div>" +
      '<div class="kpi-valor">' + valor + "</div>" +
      '<div class="kpi-desc">' + desc + "</div></div>";
  }
  function renderKpis() {
    const porBairro = calcularRelatorio(linhasFiltradas());
    let pessoas = 0, familias = 0, logradouros = 0;
    porBairro.forEach((porLogradouro) => {
      porLogradouro.forEach((g) => { pessoas += g.pessoas; familias += g.familiasSet.size; logradouros++; });
    });
    document.getElementById("kpiGrid").innerHTML = [
      kpiCardHtml("var(--blue-link)", "var(--blue-bg)", "👥", "Total de pessoas", String(pessoas), "Cidadãos com residência mapeada no território."),
      kpiCardHtml("var(--teal)", "var(--teal-bg)", "👨‍👧", "Total de famílias", String(familias), "Agrupadas pelo responsável familiar dentro de cada logradouro."),
      kpiCardHtml("var(--violet)", "var(--violet-bg)", "🛣️", "Logradouros mapeados", String(logradouros), "Ruas/avenidas distintas, já considerando as unificações."),
      kpiCardHtml("var(--amber)", "var(--amber-bg)", "🏘️", "Bairros mapeados", String(porBairro.size), "Bairros distintos encontrados nos arquivos carregados."),
    ].join("");
  }

  // -------- filtros --------
  const fMicroarea = document.getElementById("fMicroarea");
  const fBairro = document.getElementById("fBairro");
  const fBusca = document.getElementById("fBusca");

  function popularFiltros() {
    const atualMa = fMicroarea.value;
    const microareas = [...new Set(territorioLinhas.map((l) => l.__microareaArquivo).filter(Boolean))].sort();
    fMicroarea.innerHTML = '<option value="">Todas</option>' + microareas.map((m) => '<option value="' + escapeHtml(m) + '">Microárea ' + escapeHtml(m) + "</option>").join("");
    fMicroarea.value = microareas.indexOf(atualMa) !== -1 ? atualMa : "";

    const atualB = fBairro.value;
    const bairros = [...new Set(territorioLinhas.map((l) => chaveBairro(l)))].sort();
    fBairro.innerHTML = '<option value="">Todos</option>' + bairros.map((b) => '<option value="' + escapeHtml(b) + '">' + escapeHtml(tituloCase(b)) + "</option>").join("");
    fBairro.value = bairros.indexOf(atualB) !== -1 ? atualB : "";
  }
  [fMicroarea, fBairro].forEach((el) => el.addEventListener("input", () => { renderKpis(); renderRelatorio(); }));
  fBusca.addEventListener("input", renderRelatorio);

  // -------- aba: relatório por bairro --------
  function renderRelatorio() {
    const porBairro = calcularRelatorio(linhasFiltradas());
    const busca = fBusca.value.trim().toUpperCase();

    const blocos = [];
    let bairrosExibidos = 0, totalPessoas = 0, totalFamilias = 0, totalLogradouros = 0;

    [...porBairro.keys()].sort().forEach((bairro) => {
      const porLogradouro = porBairro.get(bairro);
      let entradas = [...porLogradouro.entries()].map(([nome, g]) => ({ nome, pessoas: g.pessoas, familias: g.familiasSet.size, brutos: [...g.brutos] }));
      if (busca) entradas = entradas.filter((e) => e.nome.indexOf(busca) !== -1);
      if (!entradas.length) return;
      entradas.sort((a, b) => b.pessoas - a.pessoas);

      bairrosExibidos++;
      let pessoasBairro = 0, familiasBairro = 0;
      const linhasHtml = entradas.map((e) => {
        pessoasBairro += e.pessoas; familiasBairro += e.familias; totalLogradouros++;
        const variantes = e.brutos.filter((b) => b !== e.nome);
        return '<div class="logradouro-linha">' +
          '<div class="logradouro-nome">' + escapeHtml(tituloCase(e.nome)) +
          (variantes.length ? '<span class="fonte-original">unifica: ' + escapeHtml(variantes.map(tituloCase).join(", ")) + "</span>" : "") +
          "</div>" +
          '<div class="logradouro-stats"><span><b>' + e.familias + "</b> família(s)</span><span><b>" + e.pessoas + "</b> pessoa(s)</span></div>" +
          '<input class="logradouro-obs" data-obs="' + escapeHtml(e.nome) + '" placeholder="Observação..." value="' + escapeHtml(observacoes[e.nome] || "") + '">' +
          "</div>";
      }).join("");
      totalPessoas += pessoasBairro; totalFamilias += familiasBairro;

      blocos.push(
        '<div class="bairro-grupo' + (bairrosAbertos.has(bairro) ? " aberto" : "") + '" data-bairro="' + escapeHtml(bairro) + '">' +
          '<div class="bairro-cabecalho" data-toggle-bairro="' + escapeHtml(bairro) + '">' +
            '<span class="seta">▶</span>' +
            '<span class="bairro-nome">' + escapeHtml(tituloCase(bairro)) + "</span>" +
            '<div class="bairro-stats"><span><b>' + entradas.length + "</b> logradouro(s)</span><span><b>" + familiasBairro + "</b> família(s)</span><span><b>" + pessoasBairro + "</b> pessoa(s)</span></div>" +
          "</div>" +
          '<div class="bairro-logradouros">' + linhasHtml + "</div>" +
        "</div>"
      );
    });

    document.getElementById("listaBairros").innerHTML = blocos.length
      ? blocos.join("")
      : '<div class="bloco-vazio"><b>Nenhum resultado</b><br>Ajuste os filtros ou a busca.</div>';
    document.getElementById("resultadoContagem").textContent =
      bairrosExibidos + " bairro(s) · " + totalLogradouros + " logradouro(s) · " + totalFamilias + " família(s) · " + totalPessoas + " pessoa(s)";

    document.querySelectorAll("[data-toggle-bairro]").forEach((el) => {
      el.addEventListener("click", () => {
        const bairro = el.dataset.toggleBairro;
        if (bairrosAbertos.has(bairro)) bairrosAbertos.delete(bairro); else bairrosAbertos.add(bairro);
        el.closest(".bairro-grupo").classList.toggle("aberto");
      });
    });
    document.querySelectorAll(".logradouro-obs").forEach((input) => {
      input.addEventListener("change", () => {
        const chave = input.dataset.obs;
        const valor = input.value.trim();
        if (valor) observacoes[chave] = valor; else delete observacoes[chave];
        salvarObservacoes();
      });
    });
  }

  // -------- aba: unificar logradouros --------
  function todosLogradourosBrutos() {
    const contagem = new Map();
    territorioLinhas.forEach((l) => {
      if (!l["NOME CIDADÃO"] || l["NOME CIDADÃO"] === "-") return;
      const bruto = chaveLogradouroBruto(l);
      contagem.set(bruto, (contagem.get(bruto) || 0) + 1);
    });
    return contagem;
  }

  function renderUnificar() {
    const indice = brutoParaCanonico();
    const contagem = todosLogradourosBrutos();
    const brutos = [...contagem.keys()].sort();

    document.getElementById("mesclaLista").innerHTML = brutos.length
      ? brutos.map((bruto) => {
          const jaMesclado = indice[bruto];
          return '<div class="mescla-item' + (jaMesclado ? " ja-mesclado" : "") + '">' +
            '<label><input type="checkbox" value="' + escapeHtml(bruto) + '"' + (jaMesclado ? " disabled" : "") + "> " + escapeHtml(tituloCase(bruto)) + "</label>" +
            '<span class="contagem">' + contagem.get(bruto) + " pessoa(s)" + (jaMesclado ? ' · já em "' + escapeHtml(tituloCase(jaMesclado)) + '"' : "") + "</span>" +
            "</div>";
        }).join("")
      : '<p class="vazio">Nenhum logradouro encontrado nos arquivos carregados.</p>';

    document.getElementById("countMesclas").textContent = String(Object.keys(mesclas).length);
    const canonicos = Object.keys(mesclas).sort();
    document.getElementById("gruposMesclados").innerHTML = canonicos.length
      ? canonicos.map((c) => (
          '<div class="grupo-mesclado"><span class="canonico">' + escapeHtml(tituloCase(c)) + "</span>" +
          '<span class="variantes">' + mesclas[c].map((b) => escapeHtml(tituloCase(b))).join(", ") + "</span>" +
          '<button class="btn btn-ghost-dark" data-desfazer="' + escapeHtml(c) + '">Desfazer</button></div>'
        )).join("")
      : '<p class="vazio">Nenhum grupo unificado ainda.</p>';
    document.querySelectorAll("[data-desfazer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete mesclas[btn.dataset.desfazer];
        salvarMesclas();
        atualizarTudoAposMescla();
      });
    });
  }

  document.getElementById("btnMesclar").addEventListener("click", () => {
    const selecionados = [...document.querySelectorAll('#mesclaLista input[type=checkbox]:checked')].map((c) => c.value);
    const nomeFinalCampo = document.getElementById("mesclaNomeFinal");
    if (selecionados.length < 2) { window.alert("Selecione pelo menos 2 logradouros pra unificar."); return; }
    if (!nomeFinalCampo.value.trim()) { window.alert("Informe o nome final (consolidado) do logradouro."); return; }
    const nomeFinal = normalizarTexto(nomeFinalCampo.value);
    mesclas[nomeFinal] = [...new Set((mesclas[nomeFinal] || []).concat(selecionados))];
    salvarMesclas();
    nomeFinalCampo.value = "";
    atualizarTudoAposMescla();
  });

  function atualizarTudoAposMescla() {
    renderKpis();
    renderRelatorio();
    renderUnificar();
  }

  // -------- arquivos importados (escondido por padrão) --------
  function renderArquivos() {
    document.getElementById("fontesResumo").innerHTML = arquivosTerr.map((f) => {
      const qtd = territorioLinhas.filter((l) => l.__arquivo === f.name).length;
      return '<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(f.name) + '</span><span class="fonte-count">' + qtd + " registro(s)</span></div></div>";
    }).join("");
    document.getElementById("qtdArquivosImportados").textContent = String(arquivosTerr.length);
  }
  const btnToggleArquivos = document.getElementById("btnToggleArquivos");
  const blocoArquivosImportados = document.getElementById("blocoArquivosImportados");
  btnToggleArquivos.addEventListener("click", () => {
    const escondido = blocoArquivosImportados.classList.toggle("hidden");
    document.getElementById("setaArquivos").textContent = escondido ? "▸" : "▾";
  });

  // -------- abas --------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const alvo = "tab" + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === alvo));
      if (btn.dataset.tab === "unificar") renderUnificar();
    });
  });

  // -------- impressão (PDF) --------
  function exportarPdf() {
    const porBairro = calcularRelatorio(linhasFiltradas());
    const busca = fBusca.value.trim().toUpperCase();
    const corpo = [];
    let totalPessoas = 0, totalFamilias = 0;
    [...porBairro.keys()].sort().forEach((bairro) => {
      const porLogradouro = porBairro.get(bairro);
      let entradas = [...porLogradouro.entries()].map(([nome, g]) => ({ nome, pessoas: g.pessoas, familias: g.familiasSet.size }));
      if (busca) entradas = entradas.filter((e) => e.nome.indexOf(busca) !== -1);
      entradas.sort((a, b) => b.pessoas - a.pessoas);
      entradas.forEach((e) => {
        corpo.push([tituloCase(bairro), tituloCase(e.nome), String(e.familias), String(e.pessoas), observacoes[e.nome] || ""]);
        totalPessoas += e.pessoas; totalFamilias += e.familias;
      });
    });
    if (!corpo.length) { window.alert("Nada pra imprimir com os filtros/busca atuais."); return; }

    const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
    const dataHora = new Date().toLocaleString("pt-BR");
    const usuario = document.getElementById("topbarUsername").textContent || "";
    doc.setFontSize(13);
    doc.text("Mapa do Território — Relatório por Bairro e Logradouro", 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Gerado em " + dataHora + " por " + usuario + " · " + totalFamilias + " família(s) · " + totalPessoas + " pessoa(s)", 14, 20);
    doc.autoTable({
      startY: 25,
      head: [["Bairro", "Logradouro", "Famílias", "Pessoas", "Observação"]],
      body: corpo,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
      headStyles: { fillColor: [15, 23, 42] },
      didDrawPage: () => {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          "Página " + doc.internal.getCurrentPageInfo().pageNumber + " de " + pageCount,
          doc.internal.pageSize.getWidth() - 30,
          doc.internal.pageSize.getHeight() - 8
        );
      },
    });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    doc.save("mapa_territorio_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".pdf");
  }
  document.getElementById("btnImprimir").addEventListener("click", exportarPdf);

  // -------- orquestração / navegação --------
  function renderDashboard() {
    popularFiltros();
    renderKpis();
    renderRelatorio();
    renderUnificar();
    renderArquivos();
  }
  function showDashboard() {
    viewUpload.classList.add("hidden");
    viewDashboard.classList.remove("hidden");
  }

  document.getElementById("btnVoltar").addEventListener("click", () => {
    if (window.confirm("Sair do Mapa do Território? Os dados carregados nesta sessão serão perdidos (as unificações e observações continuam salvas neste navegador).")) {
      window.location.href = "/";
    }
  });

  viewUpload.classList.remove("hidden");
})();
