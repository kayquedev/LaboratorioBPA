(function () {
  "use strict";

  const bf = window.BolsaFamiliaParser;
  const esus = window.EsusParser;

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const viewUpload = document.getElementById("viewUpload");
  const viewResultado = document.getElementById("viewResultado");
  const btnVoltar = document.getElementById("btnVoltarUpload");
  const msgUpload = document.getElementById("msgUpload");

  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }

  // -------- cruzamento: nome normalizado + data de nascimento --------
  function normalizarNome(nome) {
    return (nome || "")
      .replace(/\(O\)\s*$/i, "")
      .normalize("NFD").replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  function chave(nome, dataNascimento) {
    return normalizarNome(nome) + "|" + (dataNascimento || "").trim();
  }
  function construirMapaMicroarea(registrosEsus) {
    const mapa = new Map();
    registrosEsus.forEach((r) => {
      const k = chave(r.nome, r.dataNascimento);
      const atual = mapa.get(k);
      if (!atual) mapa.set(k, r.microarea);
    });
    return mapa;
  }
  function microareaFinal(nome, dataNascimento, mapa) {
    const v = mapa.get(chave(nome, dataNascimento));
    if (!v || !v.trim() || /^n[aã]o informad/i.test(v.trim())) return "FA";
    return v.trim();
  }

  // -------- upload dos 2 arquivos --------
  let arquivoBf = null;
  let arquivoEsus = null;

  function wireUpload(dropId, inputId, fnameId, accept, onSelect) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const fname = document.getElementById(fnameId);
    drop.addEventListener("click", () => input.click());
    ["dragover", "dragleave", "drop"].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.toggle("drag", ev === "dragover");
        if (ev === "drop" && e.dataTransfer.files[0]) {
          input.files = e.dataTransfer.files;
          onSelect(e.dataTransfer.files[0]);
          fname.textContent = e.dataTransfer.files[0].name;
        }
      });
    });
    input.addEventListener("change", () => {
      if (!input.files[0]) return;
      onSelect(input.files[0]);
      fname.textContent = input.files[0].name;
    });
  }

  wireUpload("dropBf", "inputBf", "fnameBf", ".html,.htm", (f) => { arquivoBf = f; tentarProcessar(); });
  wireUpload("dropEsus", "inputEsus", "fnameEsus", ".csv", (f) => { arquivoEsus = f; tentarProcessar(); });

  function lerArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  let beneficiarios = [];

  function tentarProcessar() {
    if (!arquivoBf || !arquivoEsus) return;
    clearMsg(msgUpload);
    Promise.all([lerArrayBuffer(arquivoBf), lerArrayBuffer(arquivoEsus)])
      .then(([bufBf, bufEsus]) => {
        const textoBf = bf.decodeArrayBuffer(bufBf);
        const lista = bf.parseHtml(textoBf);
        if (!lista.length) {
          setMsg(msgUpload, "error", "Não encontrei nenhum beneficiário no arquivo do Bolsa Família — confirme se é o export \"Mapa de Acompanhamento\" correto.");
          return;
        }

        const textoEsus = esus.decodeArrayBuffer(bufEsus);
        const resultado = esus.parseCsv(textoEsus);
        if (resultado.erro) {
          setMsg(msgUpload, "error", resultado.erro);
          return;
        }

        const mapa = construirMapaMicroarea(resultado.registros);
        lista.forEach((b) => { b.microarea = microareaFinal(b.nome, b.dataNascimento, mapa); });

        beneficiarios = lista;
        renderResultado();
        showResultado();
      })
      .catch((err) => {
        setMsg(msgUpload, "error", "Erro ao ler os arquivos: " + (err && err.message ? err.message : err));
      });
  }

  // -------- render da tela de resultado --------
  function cardHtml(opts) {
    return '<div class="ind-card"><div class="ind-card-top">' + (opts.badge || "") + "</div>" +
      '<div class="valor" style="' + (opts.cor ? "color:" + opts.cor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + opts.desc + "</div></div>";
  }

  function renderResumo() {
    const total = beneficiarios.length;
    const fa = beneficiarios.filter((b) => b.microarea === "FA").length;
    const localizados = total - fa;
    const pct = total ? Math.round((localizados / total) * 100) : 0;
    const cards = [
      { valor: String(total), titulo: "Total de beneficiários", desc: "Extraídos do Mapa de Acompanhamento do Bolsa Família." },
      { valor: String(localizados), titulo: "Microárea localizada", cor: "var(--teal)", desc: pct + "% do total — encontrados no e-SUS PEC por nome + data de nascimento." },
      { valor: String(fa), titulo: "FA — fora de área", cor: "var(--red)", desc: "Sem correspondência no e-SUS PEC (ou sem microárea informada lá)." },
    ];
    document.getElementById("cardsResumo").innerHTML = cards.map(cardHtml).join("");
  }

  function popularFiltros() {
    const microareas = [...new Set(beneficiarios.map((b) => b.microarea))].sort();
    const fMicroarea = document.getElementById("fMicroarea");
    fMicroarea.innerHTML = '<option value="">Todas</option>' +
      microareas.map((m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + "</option>").join("");
  }

  function filtrados() {
    const microarea = document.getElementById("fMicroarea").value;
    const busca = document.getElementById("fBusca").value.trim().toLowerCase();
    return beneficiarios.filter((b) => {
      if (microarea && b.microarea !== microarea) return false;
      if (busca && b.nome.toLowerCase().indexOf(busca) === -1) return false;
      return true;
    });
  }

  function renderTabela() {
    const lista = filtrados();
    const MAX = 800;
    document.getElementById("sidebarCount").textContent = lista.length.toLocaleString("pt-BR");

    const thead = document.getElementById("tabelaHead");
    thead.innerHTML = "<tr>" + bf.COLUNAS_SAIDA.map((c) => "<th>" + escapeHtml(c.titulo) + "</th>").join("") + "</tr>";

    const tbody = document.getElementById("tabelaBody");
    tbody.innerHTML = lista.slice(0, MAX).map((b) => {
      return "<tr>" + bf.COLUNAS_SAIDA.map((c) => {
        if (c.campo === "microarea") {
          const cls = b.microarea === "FA" ? "sev-erro" : "b-ok";
          return '<td><span class="badge ' + cls + '">' + escapeHtml(b.microarea) + "</span></td>";
        }
        return "<td>" + escapeHtml(b[c.campo]) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    const msg = document.getElementById("filterMsg");
    clearMsg(msg);
    if (lista.length === 0) setMsg(msg, "warn", "Nenhum beneficiário corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(msg, "warn", lista.length + " beneficiários encontrados — mostrando os primeiros " + MAX + ".");
  }

  function renderResultado() {
    renderResumo();
    popularFiltros();
    renderTabela();
  }

  ["fMicroarea", "fBusca"].forEach((id) => document.getElementById(id).addEventListener("input", renderTabela));

  function showResultado() {
    viewUpload.classList.add("hidden");
    viewResultado.classList.remove("hidden");
    btnVoltar.classList.remove("hidden");
  }
  function showUpload() {
    viewResultado.classList.add("hidden");
    viewUpload.classList.remove("hidden");
    btnVoltar.classList.add("hidden");
  }
  btnVoltar.addEventListener("click", showUpload);

  // -------- exportação --------
  function nomeArquivo(ext) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "bolsa_familia_microarea_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "." + ext;
  }

  document.getElementById("btnExportarExcel").addEventListener("click", () => {
    const linhas = filtrados().map((b) => {
      const obj = {};
      bf.COLUNAS_SAIDA.forEach((c) => { obj[c.titulo] = b[c.campo]; });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bolsa Família");
    XLSX.writeFile(wb, nomeArquivo("xlsx"));
  });

  document.getElementById("btnExportarPdf").addEventListener("click", () => {
    const lista = filtrados();
    const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
    const dataHora = new Date().toLocaleString("pt-BR");
    const usuario = document.getElementById("topbarUsername").textContent || "";

    doc.setFontSize(13);
    doc.text("Bolsa Família × e-SUS PEC — Cruzamento de Microárea", 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Gerado em " + dataHora + " por " + usuario + " · " + lista.length + " beneficiário(s)", 14, 20);

    doc.autoTable({
      startY: 25,
      head: [bf.COLUNAS_SAIDA.map((c) => c.titulo)],
      body: lista.map((b) => bf.COLUNAS_SAIDA.map((c) => b[c.campo] || "")),
      styles: { fontSize: 6.5, cellPadding: 1.5 },
      headStyles: { fillColor: [13, 26, 48] },
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
    doc.save(nomeArquivo("pdf"));
  });

})();
