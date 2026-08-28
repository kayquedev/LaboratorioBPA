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

  // -------- cruzamento: nome + data de nascimento --------
  // 1) match exato: nome completo normalizado + data de nascimento.
  // 2) se não achar, dentro dos registros do e-SUS com a MESMA data de
  //    nascimento, casa por NOME PARCIAL: um conjunto de nomes contido no
  //    outro, com pelo menos 2 nomes em comum. Cobre sobrenome a mais ou a
  //    menos (nome de casada, sobrenome faltando) e ordem trocada —
  //    ex.: "KATIA LUCIA GUIMARAES" (e-SUS) x "KATIA LUCIA GUIMARAES CABRAL"
  //    (Bolsa Família). Só vale se for inequívoco: se sobrar mais de uma
  //    microárea possível entre os compatíveis, fica FA.
  const CONECTORES = new Set(["DE", "DA", "DAS", "DO", "DOS", "E"]);

  function normalizarNome(nome) {
    return (nome || "")
      .replace(/\(O\)\s*$/i, "")
      .normalize("NFD").replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  function tokensNome(nome) {
    return normalizarNome(nome).split(" ").filter((t) => t && !CONECTORES.has(t));
  }
  function chave(nome, dataNascimento) {
    return normalizarNome(nome) + "|" + (dataNascimento || "").trim();
  }
  function microareaValida(m) {
    const v = (m || "").trim();
    return v && !/^n[aã]o informad/i.test(v) ? v : "";
  }
  // um conjunto de nomes está contido no outro e há >= 2 nomes em comum
  function nomeParcialCompativel(tokensA, tokensB) {
    const A = new Set(tokensA), B = new Set(tokensB);
    if (A.size < 2 || B.size < 2) return false;
    const comuns = [...A].filter((t) => B.has(t)).length;
    if (comuns < 2) return false;
    const menor = A.size <= B.size ? A : B;
    const maior = A.size <= B.size ? B : A;
    return [...menor].every((t) => maior.has(t));
  }
  function construirMapaMicroarea(registrosEsus) {
    const exato = new Map();        // "NOME COMPLETO|nasc" -> microárea (1ª ocorrência)
    const porNascimento = new Map(); // "nasc" -> [{ tokens, microarea }]
    registrosEsus.forEach((r) => {
      const kE = chave(r.nome, r.dataNascimento);
      if (!exato.has(kE)) exato.set(kE, r.microarea);

      const nasc = (r.dataNascimento || "").trim();
      if (!nasc) return;
      let arr = porNascimento.get(nasc);
      if (!arr) { arr = []; porNascimento.set(nasc, arr); }
      arr.push({ tokens: tokensNome(r.nome), microarea: r.microarea });
    });
    return { exato, porNascimento };
  }
  // devolve { microarea, match } — match: "exata" | "parcial" | "" (FA)
  function microareaFinal(nome, dataNascimento, mapa) {
    const vExato = microareaValida(mapa.exato.get(chave(nome, dataNascimento)));
    if (vExato) return { microarea: vExato, match: "exata" };

    const nasc = (dataNascimento || "").trim();
    const bfTokens = tokensNome(nome);
    if (!nasc || bfTokens.length < 2) return { microarea: "FA", match: "" };

    const bucket = mapa.porNascimento.get(nasc) || [];
    const microareas = new Set();
    bucket.forEach((r) => {
      const m = microareaValida(r.microarea);
      if (m && nomeParcialCompativel(bfTokens, r.tokens)) microareas.add(m);
    });
    if (microareas.size === 1) return { microarea: [...microareas][0], match: "parcial" };
    return { microarea: "FA", match: "" };
  }

  // -------- unificação de beneficiários duplicados no próprio arquivo do
  // Bolsa Família (mesmo NIS, ou — se o NIS faltar — mesmo nome + data de
  // nascimento) --------
  function chaveBeneficiario(b) {
    const nis = (b.nis || "").trim();
    return nis ? "nis:" + nis : chave(b.nome, b.dataNascimento);
  }
  function unificarDuplicados(lista) {
    const vistos = new Set();
    const unicos = [];
    let duplicados = 0;
    lista.forEach((b) => {
      const k = chaveBeneficiario(b);
      if (vistos.has(k)) { duplicados++; return; }
      vistos.add(k);
      unicos.push(b);
    });
    return { unicos, duplicados };
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
  let duplicadosUnificados = 0;

  function tentarProcessar() {
    if (!arquivoBf || !arquivoEsus) return;
    clearMsg(msgUpload);
    Promise.all([lerArrayBuffer(arquivoBf), lerArrayBuffer(arquivoEsus)])
      .then(([bufBf, bufEsus]) => {
        const textoBf = bf.decodeArrayBuffer(bufBf);
        const listaBruta = bf.parseHtml(textoBf);
        if (!listaBruta.length) {
          setMsg(msgUpload, "error", "Não encontrei nenhum beneficiário no arquivo do Bolsa Família — confirme se é o export \"Mapa de Acompanhamento\" correto.");
          return;
        }
        const { unicos: lista, duplicados } = unificarDuplicados(listaBruta);
        duplicadosUnificados = duplicados;

        const textoEsus = esus.decodeArrayBuffer(bufEsus);
        const resultado = esus.parseCsv(textoEsus);
        if (resultado.erro) {
          setMsg(msgUpload, "error", resultado.erro);
          return;
        }

        const mapa = construirMapaMicroarea(resultado.registros);
        lista.forEach((b) => {
          const r = microareaFinal(b.nome, b.dataNascimento, mapa);
          b.microarea = r.microarea;
          b.microareaMatch = r.match;
        });

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
      { valor: String(localizados), titulo: "Microárea localizada", cor: "var(--teal)", desc: "Encontrados no e-SUS PEC por nome completo + data de nascimento, ou por nome parcial + nascimento quando o sobrenome difere." },
      { valor: pct + "%", titulo: "Vinculados à ESF", cor: "var(--blue-link)", desc: "Percentual de beneficiários encontrados como vinculados a uma equipe de saúde (ESF) no e-SUS PEC." },
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
          if (b.microarea === "FA") return '<td><span class="badge sev-erro">FA</span></td>';
          if (b.microareaMatch === "parcial") {
            return '<td><span class="badge sev-aviso" title="Vinculado por nome parcial + data de nascimento — o sobrenome difere entre o Bolsa Família e o e-SUS PEC (sobrenome a mais ou a menos). Confira.">' + escapeHtml(b.microarea) + "</span></td>";
          }
          return '<td><span class="badge b-ok">' + escapeHtml(b.microarea) + "</span></td>";
        }
        return "<td>" + escapeHtml(b[c.campo]) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    const msg = document.getElementById("filterMsg");
    clearMsg(msg);
    if (lista.length === 0) setMsg(msg, "warn", "Nenhum beneficiário corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(msg, "warn", lista.length + " beneficiários encontrados — mostrando os primeiros " + MAX + ".");
  }

  function renderDuplicados() {
    const el = document.getElementById("alertDuplicados");
    if (duplicadosUnificados > 0) {
      el.className = "alert-banner show";
      el.innerHTML = "<b>" + duplicadosUnificados + " cadastro(s) duplicado(s)</b> encontrado(s) no Mapa de Acompanhamento (mesmo NIS, ou mesmo nome + data de nascimento quando o NIS faltava) — foram unificados automaticamente, mantendo só a primeira ocorrência de cada beneficiário.";
    } else {
      el.className = "alert-banner";
      el.innerHTML = "";
    }
  }

  function renderNomeParcial() {
    const el = document.getElementById("alertPrimeiroNome");
    if (!el) return;
    const n = beneficiarios.filter((b) => b.microareaMatch === "parcial").length;
    if (n > 0) {
      el.className = "alert-banner show";
      el.innerHTML = "<b>" + n + " beneficiário(s) vinculado(s) por nome parcial + data de nascimento</b> — " +
        "o sobrenome difere entre o Bolsa Família e o e-SUS PEC (sobrenome a mais ou a menos, nome de casada, ordem trocada). " +
        "Estão marcados em <span class=\"badge sev-aviso\">amarelo</span> na tabela; confira antes de usar.";
    } else {
      el.className = "alert-banner";
      el.innerHTML = "";
    }
  }

  function renderResultado() {
    renderDuplicados();
    renderNomeParcial();
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
  // o PDF usa só um subconjunto de colunas (mais legível pra impressão) -
  // o Excel continua com todas as colunas originais + Microárea.
  const CAMPOS_PDF = [
    "nis", "cns", "nome", "microarea", "dataNascimento", "dataAcompanhamento",
    "peso", "estatura", "vacinacaoEmDia", "codigoFamiliar", "endereco", "eas",
  ];
  const COLUNAS_PDF = CAMPOS_PDF.map((campo) => bf.COLUNAS_SAIDA.find((c) => c.campo === campo));

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

    const idxEndereco = CAMPOS_PDF.indexOf("endereco");

    doc.autoTable({
      startY: 25,
      head: [COLUNAS_PDF.map((c) => c.titulo)],
      body: lista.map((b) => COLUNAS_PDF.map((c) => b[c.campo] || "")),
      theme: "grid",
      styles: { fontSize: 6.5, cellPadding: 1.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
      headStyles: { fillColor: [13, 26, 48] },
      columnStyles: idxEndereco === -1 ? {} : { [idxEndereco]: { cellWidth: 40, fontSize: 5 } },
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
