(function () {
  "use strict";

  const csv = window.CsvGenericoParser;

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }

  // -------- normalização / chaves de cruzamento (cascata CPF -> CNS -> nome+nascimento) --------
  function normalizarDocumento(v) { return (v || "").replace(/\D/g, ""); }
  function separarCpfCns(bruto) {
    const d = normalizarDocumento(bruto);
    if (d.length === 11) return { cpf: d, cns: "" };
    if (d.length === 15) return { cpf: "", cns: d };
    return { cpf: "", cns: "" };
  }
  function normalizarNome(nome) {
    return (nome || "")
      .normalize("NFD").replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  function normalizarData(d) {
    // aceita "19/07/1998" (vinculados/condições) e "19-07-1998" (território)
    const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec((d || "").trim());
    return m ? m[1] + "/" + m[2] + "/" + m[3] : (d || "").trim();
  }
  function chaveNome(nome, dataNascimento) {
    return normalizarNome(nome) + "|" + normalizarData(dataNascimento);
  }

  function construirMapas(linhas, getCpf, getCns, getNome, getNascimento) {
    const porCpf = new Map(), porCns = new Map(), porNome = new Map();
    linhas.forEach((l) => {
      const cpf = normalizarDocumento(getCpf(l));
      const cns = normalizarDocumento(getCns(l));
      const nome = getNome(l);
      if (!nome || nome === "-") return;
      if (cpf) porCpf.set(cpf, l);
      if (cns) porCns.set(cns, l);
      porNome.set(chaveNome(nome, getNascimento(l)), l);
    });
    return { porCpf, porCns, porNome };
  }

  function existeCorrespondencia(mapas, cpf, cns, nome, nascimento) {
    if (cpf && mapas.porCpf.has(cpf)) return true;
    if (cns && mapas.porCns.has(cns)) return true;
    return mapas.porNome.has(chaveNome(nome, nascimento));
  }

  // -------- idade / faixa etária --------
  function idadeAnos(textoIdade) {
    const m = /^(\d+)\s*anos?/i.exec((textoIdade || "").trim());
    return m ? parseInt(m[1], 10) : 0;
  }
  function faixaEtaria(textoIdade) {
    const a = idadeAnos(textoIdade);
    if (a <= 4) return "0-4";
    if (a <= 9) return "5-9";
    if (a <= 14) return "10-14";
    if (a <= 19) return "15-19";
    if (a <= 39) return "20-39";
    if (a <= 59) return "40-59";
    return "60+";
  }

  // -------- data de atualização cadastral: desatualizado há mais de 2 anos --------
  function parseDataBr(d) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || "").trim());
    if (!m) return null;
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }
  function desatualizadoHaMais2Anos(dataStr) {
    const d = parseDataBr(dataStr);
    if (!d) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    return d < cutoff;
  }

  // -------- estado --------
  const viewUpload = document.getElementById("viewUpload");
  const viewDashboard = document.getElementById("viewDashboard");
  const viewTabela = document.getElementById("viewTabela");
  const btnVoltar = document.getElementById("btnVoltarDashboard");
  const msgUpload = document.getElementById("msgUpload");

  let arquivoVinc = null;
  let arquivoCond = null;
  let arquivosTerr = [];
  let vinculados = [];
  let condicoesLinhas = [];
  let territorioLinhas = [];

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

  const btnGerarPainel = document.getElementById("btnGerarPainel");

  wireUpload("dropVinc", "inputVinc", "fnameVinc", false, (files) => { arquivoVinc = files[0]; clearMsg(msgUpload); });
  wireUpload("dropCond", "inputCond", "fnameCond", false, (files) => { arquivoCond = files[0]; clearMsg(msgUpload); });
  wireUpload("dropTerr", "inputTerr", "fnameTerr", true, (files) => { arquivosTerr = arquivosTerr.concat(files); clearMsg(msgUpload); });
  wireUpload("dropTerrDashboard", "inputTerrDashboard", null, true, (files) => { arquivosTerr = arquivosTerr.concat(files); processar(); });

  btnGerarPainel.addEventListener("click", () => {
    if (!arquivoVinc) {
      setMsg(msgUpload, "error", "Selecione ao menos o arquivo de cidadãos vinculados antes de gerar o painel.");
      return;
    }
    processar();
  });

  function processar() {
    if (!arquivoVinc) return;
    clearMsg(msgUpload);

    const tarefas = [lerTexto(arquivoVinc).then((buf) => ({ tipo: "vinc", buf }))];
    if (arquivoCond) tarefas.push(lerTexto(arquivoCond).then((buf) => ({ tipo: "cond", buf })));
    arquivosTerr.forEach((f) => tarefas.push(lerTexto(f).then((buf) => ({ tipo: "terr", buf, nome: f.name }))));

    Promise.all(tarefas)
      .then((resultados) => {
        const rVinc = resultados.find((r) => r.tipo === "vinc");
        const parsedVinc = csv.parseCsv(csv.decodeArrayBuffer(rVinc.buf));
        if (parsedVinc.erro) { setMsg(msgUpload, "error", parsedVinc.erro); return; }
        if (!parsedVinc.linhas.length) {
          setMsg(msgUpload, "error", "Não encontrei nenhum cidadão vinculado no arquivo — confirme se é o export \"Acompanhamento de cidadãos vinculados\" correto.");
          return;
        }
        vinculados = parsedVinc.linhas;

        const rCond = resultados.find((r) => r.tipo === "cond");
        if (rCond) {
          const parsedCond = csv.parseCsv(csv.decodeArrayBuffer(rCond.buf));
          if (parsedCond.erro) { setMsg(msgUpload, "error", parsedCond.erro); return; }
          condicoesLinhas = parsedCond.linhas;
        } else {
          condicoesLinhas = [];
        }

        territorioLinhas = [];
        const rsTerr = resultados.filter((r) => r.tipo === "terr");
        rsTerr.forEach((r) => {
          const parsedTerr = csv.parseCsv(csv.decodeArrayBuffer(r.buf));
          if (parsedTerr.erro) return;
          const microarea = (parsedTerr.filtros["Microárea"] || "").trim();
          parsedTerr.linhas.forEach((l) => { l.__microareaArquivo = microarea; l.__arquivo = r.nome; });
          territorioLinhas = territorioLinhas.concat(parsedTerr.linhas);
        });

        renderDashboard();
        showDashboard();
      })
      .catch((err) => {
        setMsg(msgUpload, "error", "Erro ao ler o(s) arquivo(s): " + (err && err.message ? err.message : err));
      });
  }

  // -------- cálculo dos indicadores por vinculado --------
  function calcularIndicadores() {
    const mapasCond = condicoesLinhas.length
      ? construirMapas(condicoesLinhas, (l) => l["CPF"], (l) => l["CNS"], (l) => l["Nome"], (l) => l["Data de nascimento"])
      : null;
    const mapasTerr = territorioLinhas.length
      ? construirMapas(territorioLinhas, (l) => l["CPF"], (l) => l["CNS"], (l) => l["NOME CIDADÃO"], (l) => l["DATA DE NASCIMENTO"])
      : null;

    return vinculados.map((v) => {
      const nome = v["Nome"];
      const nascimento = v["Data de nascimento"];
      const { cpf, cns } = separarCpfCns(v["CPF/CNS"]);
      const endereco = (v["Endereço"] || "").trim();
      const semEndereco = !endereco || endereco === "-";
      const desatualizado = desatualizadoHaMais2Anos(v["Última atualização cadastral"]);

      let semAtendimento = null;
      if (mapasCond) {
        const camposAtend = [
          "Dias desde o último atendimento médico", "Dias desde o último atendimento de enfermagem",
          "Dias desde o último atendimento odontológico", "Dias desde a última visita domiciliar",
        ];
        if (cpf && mapasCond.porCpf.has(cpf)) {
          const c = mapasCond.porCpf.get(cpf);
          semAtendimento = camposAtend.every((campo) => !c[campo] || c[campo] === "-");
        } else if (cns && mapasCond.porCns.has(cns)) {
          const c = mapasCond.porCns.get(cns);
          semAtendimento = camposAtend.every((campo) => !c[campo] || c[campo] === "-");
        } else if (mapasCond.porNome.has(chaveNome(nome, nascimento))) {
          const c = mapasCond.porNome.get(chaveNome(nome, nascimento));
          semAtendimento = camposAtend.every((campo) => !c[campo] || c[campo] === "-");
        } else {
          semAtendimento = true; // nem aparece no arquivo de condições -> nunca atendido
        }
      }

      const semDomicilio = mapasTerr ? !existeCorrespondencia(mapasTerr, cpf, cns, nome, nascimento) : null;

      return {
        raw: v, nome, microarea: v["Microárea"], origem: v["Origem"], sexo: v["Sexo"],
        idade: v["Idade"], faixaEtaria: faixaEtaria(v["Idade"]), ultimaAtualizacao: v["Última atualização cadastral"],
        endereco, semEndereco, desatualizado, semAtendimento, semDomicilio,
      };
    });
  }

  let indicadores = [];

  // -------- dashboard --------
  function cardHtml(opts) {
    return '<div class="ind-card"><div class="ind-card-top">' + (opts.badge || "") + "</div>" +
      '<div class="valor" style="' + (opts.cor ? "color:" + opts.cor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + opts.desc + "</div></div>";
  }

  function renderResumo() {
    const total = indicadores.length;
    const cds = indicadores.filter((i) => (i.origem || "").toUpperCase() === "CDS").length;
    const pec = indicadores.filter((i) => (i.origem || "").toUpperCase() === "PEC").length;
    const microareas = new Set(indicadores.map((i) => i.microarea)).size;
    const stats = [["Total de vinculados", total], ["Cadastros CDS", cds], ["Cadastros PEC", pec], ["Microáreas distintas", microareas]];
    document.getElementById("statsRow").innerHTML = stats.map(
      ([l, n]) => '<div class="stat-box"><div class="l">' + l + '</div><div class="n">' + n + "</div></div>"
    ).join("");
  }

  function renderOrigem() {
    const total = indicadores.length;
    const cds = indicadores.filter((i) => (i.origem || "").toUpperCase() === "CDS").length;
    const pec = indicadores.filter((i) => (i.origem || "").toUpperCase() === "PEC").length;
    const pctCds = total ? Math.round((cds / total) * 100) : 0;
    const pctPec = total ? Math.round((pec / total) * 100) : 0;
    document.getElementById("cardsOrigem").innerHTML = [
      cardHtml({
        valor: String(cds), titulo: "Cadastros CDS", cor: "var(--teal)",
        desc: "Fichas de coleta de dados simplificada (CDS), em papel, digitadas depois no sistema.",
        badge: '<span class="badge b-ok pct-badge">' + pctCds + "%</span>",
      }),
      cardHtml({
        valor: String(pec), titulo: "Cadastros PEC", cor: "var(--blue-link)",
        desc: "Cadastros feitos diretamente no Prontuário Eletrônico do Cidadão (PEC).",
        badge: '<span class="badge b-ok pct-badge">' + pctPec + "%</span>",
      }),
    ].join("");
  }

  function painelConteudo(titulo, itens, vazio) {
    if (!itens.length) return "<h3>" + titulo + " (0)</h3><p class=\"vazio\">" + vazio + "</p>";
    return "<h3>" + titulo + " (" + itens.length + ")</h3><table><tbody>" +
      itens.slice(0, 12).map((i) => "<tr><td>" + escapeHtml(i.nome) + '<span class="sub-nome">Microárea ' + escapeHtml(i.microarea) + "</span></td></tr>").join("") +
      "</tbody></table>" + (itens.length > 12 ? '<p class="vazio">+ ' + (itens.length - 12) + " outro(s) — veja na tabela completa.</p>" : "");
  }
  function painelLista(titulo, itens, vazio) {
    return '<div class="painel">' + painelConteudo(titulo, itens, vazio) + "</div>";
  }

  function renderPaineis() {
    const semEndereco = indicadores.filter((i) => i.semEndereco);
    const desatualizados = indicadores.filter((i) => i.desatualizado);

    const porMicroarea = new Map();
    indicadores.forEach((i) => porMicroarea.set(i.microarea, (porMicroarea.get(i.microarea) || 0) + 1));
    const listaMicroarea = [...porMicroarea.entries()].sort((a, b) => b[1] - a[1]);

    let html = '<div class="paineis-grid">' +
      painelLista("Sem endereço informado", semEndereco, "Todos os cadastros têm endereço informado.") +
      painelLista("Desatualizados (há mais de 2 anos)", desatualizados, "Nenhum cadastro desatualizado.") +
      '<div class="painel"><h3>Cadastros por microárea</h3><table><tbody>' +
      listaMicroarea.map(([ma, n]) => "<tr><td>" + escapeHtml(ma || "—") + '</td><td class="n">' + n + "</td></tr>").join("") +
      "</tbody></table></div>" +
      "</div>";
    document.getElementById("paineisBasicos").innerHTML = html;

    // painel condicional: sem atendimento (só com arquivo de condições)
    const blocoAtendimento = document.getElementById("blocoAtendimento");
    if (condicoesLinhas.length) {
      blocoAtendimento.classList.remove("hidden");
      const semAtend = indicadores.filter((i) => i.semAtendimento);
      document.getElementById("cardSemAtendimento").innerHTML = cardHtml({
        valor: String(semAtend.length), titulo: "Sem nenhum atendimento registrado", cor: "var(--red)",
        desc: "Nenhum atendimento médico, de enfermagem, odontológico ou visita domiciliar encontrado no acompanhamento de condições de saúde — verificar se ainda reside na área.",
        badge: '<span class="badge sev-erro pct-badge">' + (indicadores.length ? Math.round((semAtend.length / indicadores.length) * 100) : 0) + "%</span>",
      });
      document.getElementById("painelSemAtendimento").innerHTML = painelConteudo("Exemplos sem atendimento", semAtend, "Todos têm pelo menos um atendimento registrado.");

      // consolidado faixa etária / sexo / microárea (a partir do arquivo de condições, que tem os 3 campos limpos)
      const porFaixa = new Map(), porSexo = new Map();
      condicoesLinhas.forEach((l) => {
        const f = faixaEtaria(l["Idade"]);
        porFaixa.set(f, (porFaixa.get(f) || 0) + 1);
        const s = l["Sexo"] || "—";
        porSexo.set(s, (porSexo.get(s) || 0) + 1);
      });
      const ORDEM_FAIXA = ["0-4", "5-9", "10-14", "15-19", "20-39", "40-59", "60+"];
      document.getElementById("painelConsolidado").innerHTML =
        '<div class="paineis-grid">' +
        '<div class="painel"><h3>Por faixa etária</h3><table><tbody>' +
        ORDEM_FAIXA.filter((f) => porFaixa.has(f)).map((f) => "<tr><td>" + f + '</td><td class="n">' + porFaixa.get(f) + "</td></tr>").join("") +
        "</tbody></table></div>" +
        '<div class="painel"><h3>Por sexo</h3><table><tbody>' +
        [...porSexo.entries()].map(([s, n]) => "<tr><td>" + escapeHtml(s) + '</td><td class="n">' + n + "</td></tr>").join("") +
        "</tbody></table></div>" +
        "</div>";
    } else {
      blocoAtendimento.classList.add("hidden");
    }

    // painel condicional: sem domicílio (só com pelo menos 1 arquivo de território)
    const blocoTerritorio = document.getElementById("blocoTerritorio");
    if (territorioLinhas.length) {
      blocoTerritorio.classList.remove("hidden");
      const semDom = indicadores.filter((i) => i.semDomicilio);
      document.getElementById("cardSemDomicilio").innerHTML = cardHtml({
        valor: String(semDom.length), titulo: "Sem domicílio no território", cor: "var(--red)",
        desc: "Vinculado não encontrado em nenhum arquivo de Acompanhamento do Território carregado (" + new Set(territorioLinhas.map((l) => l.__arquivo)).size + " arquivo(s)) — cadastro pode estar desatualizado ou incompleto no território.",
        badge: '<span class="badge sev-erro pct-badge">' + (indicadores.length ? Math.round((semDom.length / indicadores.length) * 100) : 0) + "%</span>",
      });
      document.getElementById("painelSemDomicilio").innerHTML = painelConteudo("Exemplos sem domicílio", semDom, "Todos os vinculados foram encontrados em algum arquivo de território.");
    } else {
      blocoTerritorio.classList.add("hidden");
    }
  }

  function renderDashboard() {
    indicadores = calcularIndicadores();
    renderOrigem();
    renderResumo();
    renderPaineis();
    renderArquivos();
  }

  function renderArquivos() {
    const linhas = [];
    linhas.push('<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(arquivoVinc.name) + '</span><span class="fonte-count">cidadãos vinculados · ' + vinculados.length + " registro(s)</span></div></div>");
    if (arquivoCond) linhas.push('<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(arquivoCond.name) + '</span><span class="fonte-count">condições de saúde · ' + condicoesLinhas.length + " registro(s)</span></div></div>");
    arquivosTerr.forEach((f) => {
      const qtd = territorioLinhas.filter((l) => l.__arquivo === f.name).length;
      linhas.push('<div class="fonte-row"><div class="fonte-info"><span class="fonte-nome">' + escapeHtml(f.name) + '</span><span class="fonte-count">território · ' + qtd + " registro(s)</span></div></div>");
    });
    document.getElementById("fontesResumo").innerHTML = linhas.join("");
  }

  // -------- filtros / tabela --------
  const fMicroarea = document.getElementById("fMicroarea");
  const fOrigem = document.getElementById("fOrigem");
  const fSexo = document.getElementById("fSexo");
  const fBusca = document.getElementById("fBusca");
  const fSoSemEndereco = document.getElementById("fSoSemEndereco");
  const fSoDesatualizado = document.getElementById("fSoDesatualizado");
  const fSoSemAtendimento = document.getElementById("fSoSemAtendimento");
  const fSoSemDomicilio = document.getElementById("fSoSemDomicilio");
  const filterMsg = document.getElementById("filterMsg");

  function popularFiltros() {
    const microareas = [...new Set(indicadores.map((i) => i.microarea))].sort();
    fMicroarea.innerHTML = '<option value="">Todas</option>' + microareas.map((m) => '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + "</option>").join("");
    const sexos = [...new Set(indicadores.map((i) => i.sexo).filter(Boolean))].sort();
    fSexo.innerHTML = '<option value="">Todos</option>' + sexos.map((s) => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + "</option>").join("");
    document.getElementById("campoSemAtendimento").classList.toggle("hidden", !condicoesLinhas.length);
    document.getElementById("campoSemDomicilio").classList.toggle("hidden", !territorioLinhas.length);
  }

  function filtrados() {
    const microarea = fMicroarea.value, origem = fOrigem.value, sexo = fSexo.value;
    const busca = fBusca.value.trim().toLowerCase();
    return indicadores.filter((i) => {
      if (microarea && i.microarea !== microarea) return false;
      if (origem && (i.origem || "").toUpperCase() !== origem) return false;
      if (sexo && i.sexo !== sexo) return false;
      if (fSoSemEndereco.checked && !i.semEndereco) return false;
      if (fSoDesatualizado.checked && !i.desatualizado) return false;
      if (fSoSemAtendimento.checked && !i.semAtendimento) return false;
      if (fSoSemDomicilio.checked && !i.semDomicilio) return false;
      if (busca && i.nome.toLowerCase().indexOf(busca) === -1) return false;
      return true;
    });
  }

  function badgeSimNao(cond, simTexto, naoTexto) {
    if (cond === null) return '<span class="sub-nome">—</span>';
    return cond
      ? '<span class="badge sev-erro">' + naoTexto + "</span>"
      : '<span class="badge b-ok">' + simTexto + "</span>";
  }

  function renderTabela() {
    const lista = filtrados();
    const MAX = 800;
    document.getElementById("sidebarCount").textContent = lista.length.toLocaleString("pt-BR");
    document.getElementById("tabelaBody").innerHTML = lista.slice(0, MAX).map((i) => (
      "<tr><td>" + escapeHtml(i.nome) + "</td>" +
      "<td>" + escapeHtml(i.microarea) + "</td>" +
      "<td>" + escapeHtml(i.origem) + "</td>" +
      "<td>" + escapeHtml(i.ultimaAtualizacao) + (i.desatualizado ? ' <span class="badge sev-erro">+2 anos</span>' : "") + "</td>" +
      "<td>" + (i.semEndereco ? '<span class="badge sev-erro">Sem endereço</span>' : escapeHtml(i.endereco)) + "</td>" +
      "<td>" + badgeSimNao(i.semAtendimento, "Tem atendimento", "Sem atendimento") + "</td>" +
      "<td>" + badgeSimNao(i.semDomicilio, "No território", "Sem domicílio") + "</td>" +
      "</tr>"
    )).join("");
    clearMsg(filterMsg);
    if (lista.length === 0) setMsg(filterMsg, "warn", "Nenhum cidadão corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(filterMsg, "warn", lista.length + " encontrados — mostrando os primeiros " + MAX + ".");
  }
  [fMicroarea, fOrigem, fSexo, fBusca, fSoSemEndereco, fSoDesatualizado, fSoSemAtendimento, fSoSemDomicilio].forEach((el) => el.addEventListener("input", renderTabela));

  // -------- exportação PDF --------
  const COLUNAS_PDF = [
    { titulo: "Nome", get: (i) => i.nome },
    { titulo: "Microárea", get: (i) => i.microarea },
    { titulo: "Origem", get: (i) => i.origem },
    { titulo: "Última atualização", get: (i) => i.ultimaAtualizacao + (i.desatualizado ? " (+2 anos)" : "") },
    { titulo: "Endereço", get: (i) => (i.semEndereco ? "Sem endereço" : i.endereco) },
    { titulo: "Atendimento", get: (i) => (i.semAtendimento === null ? "—" : i.semAtendimento ? "Sem atendimento" : "Tem atendimento") },
    { titulo: "Domicílio", get: (i) => (i.semDomicilio === null ? "—" : i.semDomicilio ? "Sem domicílio" : "No território") },
  ];

  function nomeArquivoPdf() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return "acompanhamento_pec_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".pdf";
  }

  document.getElementById("btnExportarPdf").addEventListener("click", () => {
    const lista = filtrados();
    const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
    const dataHora = new Date().toLocaleString("pt-BR");
    const usuario = document.getElementById("topbarUsername").textContent || "";

    doc.setFontSize(13);
    doc.text("Acompanhamento Cidadãos PEC", 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text("Gerado em " + dataHora + " por " + usuario + " · " + lista.length + " cidadão(s)", 14, 20);

    const idxEndereco = COLUNAS_PDF.findIndex((c) => c.titulo === "Endereço");

    doc.autoTable({
      startY: 25,
      head: [COLUNAS_PDF.map((c) => c.titulo)],
      body: lista.map((i) => COLUNAS_PDF.map((c) => c.get(i) || "")),
      theme: "grid",
      styles: { fontSize: 6.5, cellPadding: 1.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
      headStyles: { fillColor: [13, 26, 48] },
      columnStyles: idxEndereco === -1 ? {} : { [idxEndereco]: { cellWidth: 45, fontSize: 5.5 } },
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
    doc.save(nomeArquivoPdf());
  });

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

  viewUpload.classList.remove("hidden");
})();
