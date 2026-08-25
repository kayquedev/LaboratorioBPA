(function () {
  "use strict";

  const parser = window.QualidadeBpaParser;

  let parsed = null;      // { fontes: [{nome, header, registros}], registros } - registros junta todas as fontes
  let drillState = null;  // { title, preset: {tipo, cbo, sigtap, soProblemas, origem} }

  // ---------- helpers ----------
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtData(aaaammdd) {
    if (!/^\d{8}$/.test(aaaammdd || "")) return aaaammdd || "—";
    return aaaammdd.slice(6, 8) + "/" + aaaammdd.slice(4, 6) + "/" + aaaammdd.slice(0, 4);
  }
  function isValidDate(aaaammdd) {
    if (!/^\d{8}$/.test(aaaammdd || "")) return false;
    const y = +aaaammdd.slice(0, 4), m = +aaaammdd.slice(4, 6), d = +aaaammdd.slice(6, 8);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function pacienteChave(r) {
    return r.cnsCpfPaciente ? "cns:" + r.cnsCpfPaciente : "nb:" + r.nomePaciente + "|" + r.dataNascimento;
  }
  function idadeEmMeses(nasc, atend) {
    if (!isValidDate(nasc) || !/^\d{8}$/.test(atend || "")) return null;
    const ny = +nasc.slice(0, 4), nm = +nasc.slice(4, 6), nd = +nasc.slice(6, 8);
    const ay = +atend.slice(0, 4), am = +atend.slice(4, 6), ad = +atend.slice(6, 8);
    let meses = (ay - ny) * 12 + (am - nm);
    if (ad < nd) meses -= 1;
    return meses < 0 ? null : meses;
  }
  function fmtMoeda(v) {
    return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function cboNome(codigo) { return window.QualidadeBpaLookup.nomeCbo(codigo); }
  function sigtapNome(codigo) { return window.QualidadeBpaLookup.nomeSigtap(codigo); }
  function cboCelHtml(codigo) {
    const nome = cboNome(codigo);
    return codigo + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }
  function sigtapCelHtml(codigo) {
    const nome = sigtapNome(codigo);
    return codigo + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }
  function progressColor(pct) {
    return pct >= 90 ? "var(--teal)" : pct >= 70 ? "var(--amber)" : "var(--red)";
  }

  // ---------- catálogo de problemas (o que é / como resolver) ----------
  const PROBLEMA_CATALOG = {
    SIGTAP_INVALIDO: { sev: "erro", texto: "SIGTAP inválido",
      explicacao: "O código do procedimento não tem 10 dígitos numéricos, ou é só zeros.",
      resolver: "Confira o código SIGTAP na planilha/sistema de origem e corrija a linha (10 dígitos)." },
    QUANTIDADE_INVALIDA: { sev: "erro", texto: "Quantidade inválida",
      explicacao: "A quantidade informada é zero ou negativa.",
      resolver: "Corrija a quantidade do procedimento para um valor maior que zero." },
    CBO_INVALIDO: { sev: "erro", texto: "CBO inválido",
      explicacao: "O código CBO do profissional não tem 6 dígitos numéricos.",
      resolver: "Verifique o CBO cadastrado para o profissional responsável e corrija no sistema de origem." },
    COMPETENCIA_DIVERGENTE: { sev: "erro", texto: "Competência diverge do cabeçalho",
      explicacao: "A competência da linha é diferente da competência declarada no cabeçalho do arquivo.",
      resolver: "Confira se a linha pertence a este arquivo/competência, ou se o cabeçalho foi gerado errado." },
    FOLHA_SEQ_DUPLICADA: { sev: "erro", texto: "Folha/seq duplicada",
      explicacao: "Duas ou mais linhas usam a mesma folha+sequência — o SIA pode rejeitar ou sobrescrever uma delas.",
      resolver: "Renumere a folha/sequência das linhas duplicadas antes de reenviar." },
    DATA_FORA_COMPETENCIA: { sev: "aviso", texto: "Data fora da competência",
      explicacao: "A data de atendimento não está dentro do mês/ano da competência do arquivo.",
      resolver: "Confirme se o atendimento ocorreu nesse mês antes de enviar ao SIA." },
    DATA_ATENDIMENTO_FUTURA: { sev: "aviso", texto: "Data de atendimento futura",
      explicacao: "A data de atendimento está no futuro em relação a hoje.",
      resolver: "Provavelmente é erro de digitação — confira e corrija no sistema de origem." },
    NASCIMENTO_INVALIDO: { sev: "aviso", texto: "Data de nascimento inválida",
      explicacao: "A data de nascimento do paciente não é uma data real, ou não foi informada.",
      resolver: "Confira o cadastro do paciente e corrija a data de nascimento." },
    NASCIMENTO_FUTURO: { sev: "aviso", texto: "Data de nascimento futura",
      explicacao: "A data de nascimento do paciente está no futuro.",
      resolver: "Provavelmente é erro de digitação — confira o cadastro do paciente." },
    CEP_INVALIDO: { sev: "aviso", texto: "CEP inválido",
      explicacao: "O CEP informado não tem 8 dígitos numéricos.",
      resolver: "Confira o CEP no cadastro do paciente; se não houver CEP correto, prefira deixar em branco." },
    POSSIVEL_DUPLICIDADE: { sev: "aviso", texto: "Possível duplicidade",
      explicacao: "Outra linha tem o mesmo paciente, mesmo procedimento e mesma data — pode ser faturamento em duplicidade.",
      resolver: "Confira se não é um lançamento duplicado; se for um caso legítimo (dois atendimentos no mesmo dia), pode ignorar." },
    REGISTRO_INCOMPATIVEL: { sev: "erro", texto: "Instrumento de registro incompatível",
      explicacao: "Esse código SIGTAP não está habilitado, na tabela oficial, para o instrumento em que foi lançado (BPA-C ou BPA-I) — o SIA tende a rejeitar ou glosar essa linha.",
      resolver: "Confira na tabela SIGTAP em qual(is) instrumento(s) esse procedimento pode ser faturado, e lance na guia certa (BPA-C ou BPA-I)." },
    SIGTAP_SEXO_INCOMPATIVEL: { sev: "erro", texto: "Sexo incompatível com o procedimento",
      explicacao: "O procedimento SIGTAP é restrito a um sexo específico, e o sexo do paciente nesta linha não bate.",
      resolver: "Confira o sexo cadastrado do paciente e o código SIGTAP lançado — um dos dois está errado." },
    SIGTAP_IDADE_INCOMPATIVEL: { sev: "erro", texto: "Idade fora da faixa do procedimento",
      explicacao: "A idade do paciente na data do atendimento está fora da faixa etária permitida pela tabela SIGTAP para esse procedimento.",
      resolver: "Confira a data de nascimento e a data do atendimento do paciente, ou se o código SIGTAP lançado é o correto para a idade dele." },
    SIGTAP_NAO_ENCONTRADO: { sev: "aviso", texto: "SIGTAP não encontrado na tabela carregada",
      explicacao: "O código tem formato válido, mas não foi encontrado na tabela SIGTAP usada por este módulo (pode ser de uma competência diferente da carregada aqui).",
      resolver: "Confirme se o código existe na competência vigente do SIGTAP; esse aviso, sozinho, não indica que a linha está errada." },
  };

  // ---------- STEP 1: upload ----------
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("fileInput");
  const fname = document.getElementById("fname");
  const uploadMsg = document.getElementById("uploadMsg");
  const addFileInput = document.getElementById("addFileInput");

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleFile(e.dataTransfer.files[0], "novo"); }
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0], "novo"); });
  addFileInput.addEventListener("change", () => {
    if (addFileInput.files.length) handleFile(addFileInput.files[0], "adicionar");
    addFileInput.value = "";
  });

  function handleFile(file, modo) {
    if (modo === "novo") { fname.textContent = file.name; clearMsg(uploadMsg); }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = parser.parseFile(e.target.result);
        if (!result.header && result.registros.length === 0) {
          const msg = "Não encontrei um cabeçalho (tipo 01) nem linhas de produção (tipo 02/03) em \"" + file.name + "\".";
          if (modo === "adicionar") { window.alert(msg); } else { setMsg(uploadMsg, "error", msg); }
          return;
        }
        result.registros.forEach((r) => { r.origem = file.name; });
        const fonte = { nome: file.name, header: result.header, registros: result.registros };
        if (modo === "adicionar" && parsed) {
          parsed.fontes.push(fonte);
          parsed.registros = parsed.registros.concat(result.registros);
        } else {
          parsed = { fontes: [fonte], registros: result.registros.slice() };
        }
        avaliarTodos();
        window.QualidadeBpaLookup.ready.finally(showDashboard);
      } catch (err) {
        const msg = "Não foi possível ler \"" + file.name + "\". (" + err.message + ")";
        if (modo === "adicionar") { window.alert(msg); } else { setMsg(uploadMsg, "error", msg); }
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // numeração de folha/seq e a competência do cabeçalho são escopadas a cada
  // arquivo (cada BPA magnético é uma submissão independente) — por isso as
  // checagens abaixo comparam cada registro só com os outros do mesmo arquivo.
  function checarCabecalho(fonte) {
    if (!fonte.header) return null;
    const distinctFolhas = new Set(fonte.registros.map((r) => r.folha)).size;
    const linhasOk = fonte.header.numLinhas === fonte.registros.length;
    const folhasOk = fonte.header.numFolhas === distinctFolhas;
    return { linhasOk, folhasOk, distinctFolhas, ok: linhasOk && folhasOk };
  }

  // ---------- qualidade (por registro + agregada) ----------
  function avaliarTodos() {
    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const lookup = window.QualidadeBpaLookup;

    // duplicidade de paciente/procedimento/data vale entre TODAS as fontes
    // (o mesmo atendimento pode ter sido lançado duas vezes em arquivos diferentes)
    const dupCount = {};
    parsed.registros.filter((r) => r.tipo === "03").forEach((r) => {
      const k = pacienteChave(r) + "|" + r.sigtap + "|" + r.dataAtendimento;
      dupCount[k] = (dupCount[k] || 0) + 1;
    });

    parsed.fontes.forEach((fonte) => {
    const header = fonte.header;
    const folhaSeqCount = {};
    fonte.registros.forEach((r) => { const k = r.folha + "/" + r.seq; folhaSeqCount[k] = (folhaSeqCount[k] || 0) + 1; });

    fonte.registros.forEach((r) => {
      const codigos = [];
      const sigtapValido = /^\d{10}$/.test(r.sigtap) && !/^0+$/.test(r.sigtap);
      if (!sigtapValido) codigos.push("SIGTAP_INVALIDO");
      if ((r.quantidade || 0) <= 0) codigos.push("QUANTIDADE_INVALIDA");
      if (!/^\d{6}$/.test(r.cbo)) codigos.push("CBO_INVALIDO");
      if (header && r.competencia !== header.competencia) codigos.push("COMPETENCIA_DIVERGENTE");
      if (folhaSeqCount[r.folha + "/" + r.seq] > 1) codigos.push("FOLHA_SEQ_DUPLICADA");

      const info = sigtapValido && lookup ? lookup.sigtapInfo(r.sigtap) : null;
      if (sigtapValido && !info) codigos.push("SIGTAP_NAO_ENCONTRADO");
      if (info) {
        const registroEsperado = r.tipo === "02" ? "01" : r.tipo === "03" ? "02" : null;
        if (registroEsperado && info.registros.length && info.registros.indexOf(registroEsperado) === -1) {
          codigos.push("REGISTRO_INCOMPATIVEL");
        }
      }

      if (r.tipo === "03") {
        if (/^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento.slice(0, 6) !== r.competencia) codigos.push("DATA_FORA_COMPETENCIA");
        if (/^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento > hoje) codigos.push("DATA_ATENDIMENTO_FUTURA");
        if (!isValidDate(r.dataNascimento)) codigos.push("NASCIMENTO_INVALIDO");
        else if (r.dataNascimento > hoje) codigos.push("NASCIMENTO_FUTURO");
        if (r.cep && !/^\d{8}$/.test(r.cep)) codigos.push("CEP_INVALIDO");
        const k = pacienteChave(r) + "|" + r.sigtap + "|" + r.dataAtendimento;
        if (dupCount[k] > 1) codigos.push("POSSIVEL_DUPLICIDADE");

        if (info) {
          if (r.sexo && (info.sexo === "M" || info.sexo === "F") && r.sexo !== info.sexo) {
            codigos.push("SIGTAP_SEXO_INCOMPATIVEL");
          }
          const naoRestrito = info.idadeMin === 9999 && info.idadeMax === 9999;
          if (!naoRestrito && (info.idadeMin || info.idadeMax)) {
            const meses = idadeEmMeses(r.dataNascimento, r.dataAtendimento);
            if (meses != null && (meses < info.idadeMin || meses > info.idadeMax)) {
              codigos.push("SIGTAP_IDADE_INCOMPATIVEL");
            }
          }
        }
      }

      r.problemas = codigos.map((cod) => Object.assign({ cod }, PROBLEMA_CATALOG[cod]));
      r.sigtapEncontrado = !!info;
      r.valorEstimado = info ? info.valor * (r.quantidade || 0) : 0;
    });
    });
  }

  // ---------- dashboard ----------
  function renderAlert() {
    const el = document.getElementById("headerAlert");
    const linhas = [];
    let algumaDivergencia = false;

    parsed.fontes.forEach((fonte) => {
      const rotulo = "<b>" + escapeHtml(fonte.nome) + "</b>";
      if (!fonte.header) {
        algumaDivergencia = true;
        linhas.push(rotulo + ": sem cabeçalho (tipo 01) — não dá pra conferir numLinhas/numFolhas declarados.");
        return;
      }
      const chk = checarCabecalho(fonte);
      if (!chk.ok) {
        algumaDivergencia = true;
        const partes = [];
        if (!chk.linhasOk) partes.push("cabeçalho declara <b>" + fonte.header.numLinhas + "</b> linha(s), o arquivo tem <b>" + fonte.registros.length + "</b>");
        if (!chk.folhasOk) partes.push("cabeçalho declara <b>" + fonte.header.numFolhas + "</b> folha(s), foram encontradas <b>" + chk.distinctFolhas + "</b>");
        linhas.push(rotulo + " (competência " + fonte.header.competencia + "): " + partes.join("; ") + ".");
      }
    });

    if (algumaDivergencia) {
      el.className = "alert-banner show";
      el.innerHTML = "<b>Divergência no cabeçalho.</b><br>" + linhas.join("<br>");
    } else {
      el.className = "alert-banner show ok";
      const nomes = parsed.fontes.map((f) => escapeHtml(f.nome)).join(", ");
      const plural = parsed.fontes.length > 1 ? "s conferem" : " confere";
      el.innerHTML = "<b>Cabeçalho" + plural + ".</b> " + nomes + " — contagem de linhas e folhas batem com o declarado. Processado 100% no navegador, nada é enviado ao servidor.";
    }
  }

  function renderSummary() {
    const regs = parsed.registros;
    const t02 = regs.filter((r) => r.tipo === "02").length;
    const t03 = regs.filter((r) => r.tipo === "03").length;
    const pacientes = new Set(regs.filter((r) => r.tipo === "03").map(pacienteChave)).size;
    const competencias = [...new Set(parsed.fontes.map((f) => f.header ? f.header.competencia : null).filter(Boolean))];
    const quartaStat = parsed.fontes.length > 1
      ? ["Arquivos importados", parsed.fontes.length]
      : ["Competência", competencias[0] || "—"];
    const stats = [
      ["Registros", regs.length],
      ["BPA-C × BPA-I", t02 + " <small>/</small> " + t03],
      ["Pacientes distintos", pacientes],
      quartaStat,
    ];
    document.getElementById("summaryRow").innerHTML = stats.map(
      ([l, n]) => '<div class="stat-box"><div class="l">' + l + '</div><div class="n">' + n + "</div></div>"
    ).join("");
  }

  function renderFaturamento() {
    const regs = parsed.registros;
    let receber = 0, pendente = 0, naoLocalizados = 0;
    regs.forEach((r) => {
      if (!r.sigtapEncontrado) { naoLocalizados++; return; }
      const temErro = r.problemas.some((p) => p.sev === "erro");
      if (temErro) pendente += r.valorEstimado; else receber += r.valorEstimado;
    });
    const total = receber + pendente;

    const cards = [
      {
        id: "fatTotal", badge: '<span class="badge b-soon">Estimado</span>',
        valor: fmtMoeda(total), titulo: "Faturamento total estimado",
        desc: "Soma do valor SIGTAP (ambulatorial + profissional) × quantidade, para os registros com procedimento localizado na tabela carregada.",
      },
      {
        id: "fatReceber", corValor: "var(--teal)",
        valor: fmtMoeda(receber), titulo: "A receber",
        desc: "Registros sem erro bloqueante — tendência de serem aceitos e pagos pelo SIA.",
      },
      {
        id: "fatPendente", corValor: "var(--red)",
        valor: fmtMoeda(pendente), titulo: "Pendente / risco de glosa",
        desc: "Registros com pelo menos um erro (SIGTAP/CBO inválido, instrumento incompatível, sexo/idade incompatível etc.) — risco de rejeição ou glosa.",
      },
    ];
    if (naoLocalizados) {
      cards.push({
        id: "fatNaoLocalizado", badge: '<span class="badge b-soon">Fora do cálculo</span>',
        valor: naoLocalizados, titulo: "SIGTAP não localizado",
        desc: "Registro(s) com código SIGTAP que não foi encontrado na tabela carregada — não entram na soma acima.",
      });
    }
    document.getElementById("cardsFaturamento").innerHTML = cards.map(cardHtml).join("");
  }

  function cardHtml(opts) {
    const badge = opts.badge || '<span class="badge b-ok">Dado real</span>';
    const bar = opts.pct != null
      ? '<div class="bar-track"><div class="bar-fill" style="width:' + opts.pct + '%;background:' + progressColor(opts.pct) + '"></div></div>'
      : "";
    const inner =
      '<div class="ind-card-top">' + badge + "</div>" +
      '<div class="valor" style="' + (opts.corValor ? "color:" + opts.corValor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + opts.desc + "</div>" +
      bar +
      (opts.link ? '<div class="link">' + opts.link + " →</div>" : "");
    if (opts.onClick) {
      return '<a class="ind-card" href="javascript:void(0)" data-card="' + opts.id + '">' + inner + "</a>";
    }
    return '<div class="ind-card">' + inner + "</div>";
  }

  function renderCards() {
    const regs = parsed.registros;
    const total = regs.length;
    const semProblema = regs.filter((r) => r.problemas.length === 0).length;
    const pct = total ? Math.round((semProblema / total) * 100) : 0;

    const cardsQ = [];
    cardsQ.push({
      id: "qualidade", onClick: true, pct,
      valor: pct + '<span class="un">%</span>',
      titulo: "Registros sem problemas",
      desc: semProblema + " de " + total + " registro(s) sem nenhum problema encontrado.",
      link: "Ver registros com problema",
      preset: { soProblemas: true }, title: "Registros com problema de qualidade",
    });

    let headerValor = "—", headerDesc = "Nenhum arquivo com cabeçalho (tipo 01).", headerCor = null;
    const comHeader = parsed.fontes.filter((f) => f.header);
    if (comHeader.length) {
      const ok = comHeader.every((f) => checarCabecalho(f).ok);
      headerValor = ok ? "✓" : "✗";
      headerCor = ok ? "var(--teal)" : "var(--red)";
      headerDesc = ok
        ? "numLinhas e numFolhas do(s) cabeçalho(s) batem com o(s) arquivo(s)."
        : "numLinhas/numFolhas de algum cabeçalho não bate com o arquivo — veja o aviso acima.";
    }
    cardsQ.push({
      id: "cabecalho", badge: '<span class="badge b-soon">Resumo</span>', corValor: headerCor,
      valor: headerValor, titulo: "Cabeçalho consistente", desc: headerDesc,
    });

    document.getElementById("cardsQualidade").innerHTML = cardsQ.map(cardHtml).join("");

    const cardsE = [
      { id: "todos", onClick: true, valor: total, titulo: "Todos os registros", desc: "BPA-C e BPA-I juntos.", link: "Ver registros", preset: {}, title: "Todos os registros" },
      { id: "t02", onClick: true, valor: regs.filter((r) => r.tipo === "02").length, titulo: "BPA-C (consolidado)", desc: "Linhas tipo 02.", link: "Ver registros", preset: { tipo: "02" }, title: "BPA-C (consolidado)" },
      { id: "t03", onClick: true, valor: regs.filter((r) => r.tipo === "03").length, titulo: "BPA-I (individualizado)", desc: "Linhas tipo 03, por paciente.", link: "Ver registros", preset: { tipo: "03" }, title: "BPA-I (individualizado)" },
    ];
    document.getElementById("cardsExplorar").innerHTML = cardsE.map(cardHtml).join("");

    const allCards = cardsQ.concat(cardsE).filter((c) => c.onClick);
    document.querySelectorAll(".ind-card[data-card]").forEach((el) => {
      const card = allCards.find((c) => c.id === el.dataset.card);
      if (card) el.addEventListener("click", () => showDrilldown(card.title, card.preset));
    });
  }

  // ---------- painéis ----------
  function topN(map, n) { return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n); }
  function painelHtml(titulo, entries, formatKey, formatVal) {
    if (!entries.length) return '<div class="painel"><h3>' + titulo + '</h3><div class="vazio">Sem dados.</div></div>';
    const rows = entries.map(([k, v]) =>
      "<tr><td>" + (formatKey ? formatKey(k) : escapeHtml(k)) + '</td><td class="n">' + (formatVal ? formatVal(v) : v.toLocaleString("pt-BR")) + "</td></tr>"
    ).join("");
    return '<div class="painel"><h3>' + titulo + "</h3><table>" + rows + "</table></div>";
  }
  function labelComNome(codigo, nome) {
    return escapeHtml(codigo) + (nome ? ' <span style="color:var(--text-dim)">· ' + escapeHtml(nome) + "</span>" : "");
  }

  function renderPaineis() {
    const regs = parsed.registros;
    const porProcedimentoQtd = {}, porProcedimentoOcorr = {}, porCbo = {}, porDia = {}, porSexo = {}, porBairro = {};
    const porOrigemCount = {}, porOrigemValor = {};
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
    document.getElementById("paineisGrid").innerHTML = paineis.join("");
    renderGlossario();
  }

  function renderGlossario() {
    const regs = parsed.registros;
    const counts = {};
    regs.forEach((r) => r.problemas.forEach((p) => { counts[p.cod] = (counts[p.cod] || 0) + 1; }));
    const codigos = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    const box = document.getElementById("glossarioBox");
    const label = document.getElementById("glossarioLabel");
    if (!codigos.length) {
      label.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    label.classList.remove("hidden");
    box.innerHTML = codigos.map((cod) => {
      const info = PROBLEMA_CATALOG[cod];
      return '<div class="gloss-item"><span class="badge sev-' + info.sev + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + '</span>' +
        '<div class="gloss-body">' +
        '<div class="gloss-titulo">' + escapeHtml(info.texto) + ' <span class="gloss-count">— ' + counts[cod] + " ocorrência(s)</span></div>" +
        '<div class="gloss-explicacao">' + escapeHtml(info.explicacao) + "</div>" +
        '<div class="gloss-resolver"><b>Como resolver:</b> ' + escapeHtml(info.resolver) + "</div>" +
        "</div></div>";
    }).join("");
  }

  // ---------- drilldown ----------
  const fTipo = document.getElementById("fTipo");
  const fOrigem = document.getElementById("fOrigem");
  const fCbo = document.getElementById("fCbo");
  const fSigtap = document.getElementById("fSigtap");
  const fBusca = document.getElementById("fBusca");
  const fSoProblemas = document.getElementById("fSoProblemas");
  const filterMsg = document.getElementById("filterMsg");
  const campoOrigem = document.getElementById("campoOrigem");

  function populateOrigemFilter() {
    if (parsed.fontes.length <= 1) {
      campoOrigem.classList.add("hidden");
      fOrigem.value = "";
      return;
    }
    campoOrigem.classList.remove("hidden");
    const atual = fOrigem.value;
    fOrigem.innerHTML = '<option value="">Todas</option>' +
      parsed.fontes.map((f) => '<option value="' + escapeHtml(f.nome) + '">' + escapeHtml(f.nome) + "</option>").join("");
    fOrigem.value = parsed.fontes.some((f) => f.nome === atual) ? atual : "";
  }

  function filteredRegistros() {
    const tipo = fTipo.value;
    const origem = fOrigem.value;
    const cbo = fCbo.value.trim();
    const sigtap = fSigtap.value.trim();
    const busca = fBusca.value.trim().toLowerCase();
    const soProblemas = fSoProblemas.checked;

    return parsed.registros.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      if (origem && r.origem !== origem) return false;
      if (cbo && r.cbo.indexOf(cbo) === -1) return false;
      if (sigtap && r.sigtap.indexOf(sigtap) === -1) return false;
      if (soProblemas && r.problemas.length === 0) return false;
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

  function problemasDetalheHtml(r) {
    if (!r.problemas.length) return '<span class="ok-txt">—</span>';
    return '<div class="problema-list">' + r.problemas.map((p) =>
      '<div class="probitem probitem-' + p.sev + '"><b>' + escapeHtml(p.texto) + ":</b> " + escapeHtml(p.explicacao) +
      '<span class="resolver">Como resolver: ' + escapeHtml(p.resolver) + "</span></div>"
    ).join("") + "</div>";
  }

  function renderDrilldown() {
    const regs = filteredRegistros();
    const MAX = 500;

    document.getElementById("sidebarCount").textContent = regs.length.toLocaleString("pt-BR");

    const body = document.getElementById("registrosBody");
    body.innerHTML = regs.slice(0, MAX).map((r) =>
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
      "<td>" + situacaoHtml(r) + "</td>" +
      "<td>" + problemasDetalheHtml(r) + "</td></tr>"
    ).join("");

    clearMsg(filterMsg);
    if (regs.length === 0) setMsg(filterMsg, "warn", "Nenhum registro corresponde aos filtros aplicados.");
    else if (regs.length > MAX) setMsg(filterMsg, "warn", regs.length + " registros encontrados — mostrando os primeiros " + MAX + ".");
  }
  [fTipo, fOrigem, fCbo, fSigtap, fBusca, fSoProblemas].forEach((el) => el.addEventListener("input", renderDrilldown));

  function exportCsv() {
    const regs = filteredRegistros();
    const header = ["tipo", "origem", "folha", "seq", "cbo", "cbo_nome", "sigtap", "sigtap_nome", "data_atendimento", "quantidade", "valor_estimado_rs", "paciente", "situacao", "o_que_e_como_resolver"];
    const linhas = regs.map((r) => [
      r.tipo, r.origem, r.folha, r.seq, r.cbo, cboNome(r.cbo), r.sigtap, sigtapNome(r.sigtap),
      r.tipo === "03" ? r.dataAtendimento : "",
      r.quantidade,
      r.valorEstimado.toFixed(2).replace(".", ","),
      r.tipo === "03" ? r.nomePaciente : "",
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

  // ---------- navegação entre views ----------
  const viewUpload = document.getElementById("viewUpload");
  const viewDashboard = document.getElementById("viewDashboard");
  const viewDrilldown = document.getElementById("viewDrilldown");
  const topbarTitle = document.getElementById("topbarTitle");
  const btnBack = document.getElementById("btnBack");
  const topbarActions = document.getElementById("topbarActions");

  function showUpload() {
    parsed = null;
    fileInput.value = "";
    fname.textContent = "";
    clearMsg(uploadMsg);
    viewUpload.classList.remove("hidden");
    viewDashboard.classList.add("hidden");
    viewDrilldown.classList.add("hidden");
    topbarTitle.textContent = "Qualidade BPA";
    btnBack.classList.add("hidden");
    topbarActions.classList.add("hidden");
  }

  function showDashboard() {
    populateOrigemFilter();
    renderAlert();
    renderSummary();
    renderFaturamento();
    renderCards();
    renderPaineis();
    viewUpload.classList.add("hidden");
    viewDashboard.classList.remove("hidden");
    viewDrilldown.classList.add("hidden");
    topbarTitle.textContent = "Qualidade BPA";
    btnBack.classList.add("hidden");
    topbarActions.classList.add("hidden");
  }

  function showDrilldown(title, preset) {
    fTipo.value = preset.tipo || "";
    fOrigem.value = preset.origem || "";
    fCbo.value = preset.cbo || "";
    fSigtap.value = preset.sigtap || "";
    fBusca.value = "";
    fSoProblemas.checked = !!preset.soProblemas;

    viewUpload.classList.add("hidden");
    viewDashboard.classList.add("hidden");
    viewDrilldown.classList.remove("hidden");
    topbarTitle.textContent = title;
    btnBack.classList.remove("hidden");
    topbarActions.classList.remove("hidden");

    history.pushState({ qualidadeBpa: "drilldown" }, "");
    renderDrilldown();
  }

  // botão voltar do navegador (ou dos botões do mouse/gestos) sempre volta
  // pro início do módulo, igual clicar em "← Início" — nunca sai da página.
  window.addEventListener("popstate", () => {
    if (parsed) showDashboard(); else showUpload();
  });

  btnBack.addEventListener("click", () => { history.back(); });
  document.getElementById("btnReimport").addEventListener("click", showUpload);
  document.getElementById("btnExport").addEventListener("click", exportCsv);
  document.getElementById("btnAddFile").addEventListener("click", () => addFileInput.click());

})();
