(function () {
  "use strict";

  const parser = window.QualidadeBpaParser;

  let parsed = null;      // { header, registros, linhasIgnoradas }
  let drillState = null;  // { title, preset: {tipo, cbo, sigtap, soProblemas} }

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
  function progressColor(pct) {
    return pct >= 90 ? "var(--teal)" : pct >= 70 ? "var(--amber)" : "var(--red)";
  }

  // ---------- STEP 1: upload ----------
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("fileInput");
  const fname = document.getElementById("fname");
  const uploadMsg = document.getElementById("uploadMsg");

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleFile(e.dataTransfer.files[0]); }
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  function handleFile(file) {
    fname.textContent = file.name;
    clearMsg(uploadMsg);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = parser.parseFile(e.target.result);
        if (!result.header && result.registros.length === 0) {
          setMsg(uploadMsg, "error", "Não encontrei um cabeçalho (tipo 01) nem linhas de produção (tipo 02/03) nesse arquivo.");
          return;
        }
        parsed = result;
        avaliarTodos();
        showDashboard();
      } catch (err) {
        setMsg(uploadMsg, "error", "Não foi possível ler o arquivo. (" + err.message + ")");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // ---------- qualidade (por registro + agregada) ----------
  function avaliarTodos() {
    const regs = parsed.registros;
    const header = parsed.header;
    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const folhaSeqCount = {};
    regs.forEach((r) => { const k = r.folha + "/" + r.seq; folhaSeqCount[k] = (folhaSeqCount[k] || 0) + 1; });

    const dupCount = {};
    regs.filter((r) => r.tipo === "03").forEach((r) => {
      const k = pacienteChave(r) + "|" + r.sigtap + "|" + r.dataAtendimento;
      dupCount[k] = (dupCount[k] || 0) + 1;
    });

    regs.forEach((r) => {
      const problemas = [];
      if (!/^\d{10}$/.test(r.sigtap) || /^0+$/.test(r.sigtap)) problemas.push({ sev: "erro", texto: "SIGTAP inválido" });
      if ((r.quantidade || 0) <= 0) problemas.push({ sev: "erro", texto: "Quantidade inválida" });
      if (!/^\d{6}$/.test(r.cbo)) problemas.push({ sev: "erro", texto: "CBO inválido" });
      if (header && r.competencia !== header.competencia) problemas.push({ sev: "erro", texto: "Competência diverge do cabeçalho" });
      if (folhaSeqCount[r.folha + "/" + r.seq] > 1) problemas.push({ sev: "erro", texto: "Folha/seq duplicada" });

      if (r.tipo === "03") {
        if (/^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento.slice(0, 6) !== r.competencia) problemas.push({ sev: "aviso", texto: "Data fora da competência" });
        if (/^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento > hoje) problemas.push({ sev: "aviso", texto: "Data de atendimento futura" });
        if (!isValidDate(r.dataNascimento)) problemas.push({ sev: "aviso", texto: "Data de nascimento inválida" });
        else if (r.dataNascimento > hoje) problemas.push({ sev: "aviso", texto: "Data de nascimento futura" });
        if (r.cep && !/^\d{8}$/.test(r.cep)) problemas.push({ sev: "aviso", texto: "CEP inválido" });
        const k = pacienteChave(r) + "|" + r.sigtap + "|" + r.dataAtendimento;
        if (dupCount[k] > 1) problemas.push({ sev: "aviso", texto: "Possível duplicidade" });
      }

      r.problemas = problemas;
    });
  }

  // ---------- dashboard ----------
  function renderAlert() {
    const el = document.getElementById("headerAlert");
    const regs = parsed.registros;
    if (!parsed.header) {
      el.className = "alert-banner show";
      el.innerHTML = "<b>Sem cabeçalho.</b> O arquivo não tem uma linha tipo 01 — não dá pra conferir numLinhas/numFolhas declarados.";
      return;
    }
    const maxFolha = regs.reduce((m, r) => Math.max(m, r.folha || 0), 0);
    const divergencias = [];
    if (parsed.header.numLinhas !== regs.length) {
      divergencias.push("cabeçalho declara <b>" + parsed.header.numLinhas + "</b> linha(s), o arquivo tem <b>" + regs.length + "</b>");
    }
    if (parsed.header.numFolhas !== maxFolha) {
      divergencias.push("cabeçalho declara <b>" + parsed.header.numFolhas + "</b> folha(s), a maior folha encontrada é <b>" + maxFolha + "</b>");
    }
    if (divergencias.length) {
      el.className = "alert-banner show";
      el.innerHTML = "<b>Divergência no cabeçalho.</b> Competência " + parsed.header.competencia + " — " + divergencias.join("; ") + ".";
    } else {
      el.className = "alert-banner show ok";
      el.innerHTML = "<b>Cabeçalho confere.</b> Competência " + parsed.header.competencia + " — contagem de linhas e folhas batem com o declarado. Processado 100% no navegador, nada é enviado ao servidor.";
    }
  }

  function renderSummary() {
    const regs = parsed.registros;
    const t02 = regs.filter((r) => r.tipo === "02").length;
    const t03 = regs.filter((r) => r.tipo === "03").length;
    const pacientes = new Set(regs.filter((r) => r.tipo === "03").map(pacienteChave)).size;
    const stats = [
      ["Registros", regs.length],
      ["BPA-C × BPA-I", t02 + " <small>/</small> " + t03],
      ["Pacientes distintos", pacientes],
      ["Competência", parsed.header ? parsed.header.competencia : "—"],
    ];
    document.getElementById("summaryRow").innerHTML = stats.map(
      ([l, n]) => '<div class="stat-box"><div class="l">' + l + '</div><div class="n">' + n + "</div></div>"
    ).join("");
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

    let headerValor = "—", headerDesc = "Arquivo sem cabeçalho (tipo 01).", headerCor = null;
    if (parsed.header) {
      const maxFolha = regs.reduce((m, r) => Math.max(m, r.folha || 0), 0);
      const ok = parsed.header.numLinhas === total && parsed.header.numFolhas === maxFolha;
      headerValor = ok ? "✓" : "✗";
      headerCor = ok ? "var(--teal)" : "var(--red)";
      headerDesc = ok
        ? "numLinhas e numFolhas do cabeçalho batem com o arquivo."
        : "numLinhas/numFolhas do cabeçalho não batem com o arquivo — veja o aviso acima.";
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
  function painelHtml(titulo, entries) {
    if (!entries.length) return '<div class="painel"><h3>' + titulo + '</h3><div class="vazio">Sem dados.</div></div>';
    const rows = entries.map(([k, v]) =>
      "<tr><td>" + escapeHtml(k) + '</td><td class="n">' + v.toLocaleString("pt-BR") + "</td></tr>"
    ).join("");
    return '<div class="painel"><h3>' + titulo + "</h3><table>" + rows + "</table></div>";
  }

  function renderPaineis() {
    const regs = parsed.registros;
    const porProcedimentoQtd = {}, porProcedimentoOcorr = {}, porCbo = {}, porDia = {}, porSexo = {}, porBairro = {};
    regs.forEach((r) => {
      porProcedimentoQtd[r.sigtap] = (porProcedimentoQtd[r.sigtap] || 0) + (r.quantidade || 0);
      porProcedimentoOcorr[r.sigtap] = (porProcedimentoOcorr[r.sigtap] || 0) + 1;
      porCbo[r.cbo] = (porCbo[r.cbo] || 0) + 1;
      if (r.tipo === "03") {
        porDia[fmtData(r.dataAtendimento)] = (porDia[fmtData(r.dataAtendimento)] || 0) + 1;
        porSexo[r.sexo || "—"] = (porSexo[r.sexo || "—"] || 0) + 1;
        porBairro[r.bairro || "—"] = (porBairro[r.bairro || "—"] || 0) + 1;
      }
    });
    document.getElementById("paineisGrid").innerHTML = [
      painelHtml("Top procedimentos (quantidade)", topN(porProcedimentoQtd, 8)),
      painelHtml("Top procedimentos (ocorrências)", topN(porProcedimentoOcorr, 8)),
      painelHtml("Por CBO", topN(porCbo, 8)),
      painelHtml("Por dia (BPA-I)", topN(porDia, 8)),
      painelHtml("Por sexo (BPA-I)", topN(porSexo, 8)),
      painelHtml("Por bairro (BPA-I)", topN(porBairro, 8)),
    ].join("");
  }

  // ---------- drilldown ----------
  const fTipo = document.getElementById("fTipo");
  const fCbo = document.getElementById("fCbo");
  const fSigtap = document.getElementById("fSigtap");
  const fBusca = document.getElementById("fBusca");
  const fSoProblemas = document.getElementById("fSoProblemas");
  const filterMsg = document.getElementById("filterMsg");

  function filteredRegistros() {
    const tipo = fTipo.value;
    const cbo = fCbo.value.trim();
    const sigtap = fSigtap.value.trim();
    const busca = fBusca.value.trim().toLowerCase();
    const soProblemas = fSoProblemas.checked;

    return parsed.registros.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      if (cbo && r.cbo.indexOf(cbo) === -1) return false;
      if (sigtap && r.sigtap.indexOf(sigtap) === -1) return false;
      if (soProblemas && r.problemas.length === 0) return false;
      if (busca) {
        const alvo = ((r.nomePaciente || "") + " " + r.sigtap).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function situacaoHtml(r) {
    if (!r.problemas.length) return '<span class="badge b-ok">OK</span>';
    const pior = r.problemas.some((p) => p.sev === "erro") ? "erro" : "aviso";
    return '<span class="badge sev-' + pior + '" title="' + escapeHtml(r.problemas.map((p) => p.texto).join("; ")) + '">' +
      (pior === "erro" ? "Erro" : "Aviso") + " (" + r.problemas.length + ")</span>";
  }

  function renderDrilldown() {
    const regs = filteredRegistros();
    const MAX = 500;

    document.getElementById("sidebarCount").textContent = regs.length.toLocaleString("pt-BR");

    const body = document.getElementById("registrosBody");
    body.innerHTML = regs.slice(0, MAX).map((r) =>
      "<tr><td>" + r.tipo + "</td>" +
      '<td class="num">' + r.folha + "</td>" +
      '<td class="num">' + r.seq + "</td>" +
      '<td class="num">' + r.cbo + "</td>" +
      '<td class="num">' + r.sigtap + "</td>" +
      "<td>" + (r.tipo === "03" ? fmtData(r.dataAtendimento) : "—") + "</td>" +
      '<td class="num">' + r.quantidade + "</td>" +
      "<td>" + (r.tipo === "03" ? escapeHtml(r.nomePaciente) : "—") + "</td>" +
      "<td>" + situacaoHtml(r) + "</td></tr>"
    ).join("");

    clearMsg(filterMsg);
    if (regs.length === 0) setMsg(filterMsg, "warn", "Nenhum registro corresponde aos filtros aplicados.");
    else if (regs.length > MAX) setMsg(filterMsg, "warn", regs.length + " registros encontrados — mostrando os primeiros " + MAX + ".");
  }
  [fTipo, fCbo, fSigtap, fBusca, fSoProblemas].forEach((el) => el.addEventListener("input", renderDrilldown));

  function exportCsv() {
    const regs = filteredRegistros();
    const header = ["tipo", "folha", "seq", "cbo", "sigtap", "data_atendimento", "quantidade", "paciente", "situacao"];
    const linhas = regs.map((r) => [
      r.tipo, r.folha, r.seq, r.cbo, r.sigtap,
      r.tipo === "03" ? r.dataAtendimento : "",
      r.quantidade,
      r.tipo === "03" ? r.nomePaciente : "",
      r.problemas.length ? r.problemas.map((p) => p.texto).join(" | ") : "OK",
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
    renderAlert();
    renderSummary();
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

    renderDrilldown();
  }

  btnBack.addEventListener("click", showDashboard);
  document.getElementById("btnReimport").addEventListener("click", showUpload);
  document.getElementById("btnExport").addEventListener("click", exportCsv);

})();
