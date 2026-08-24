(function () {
  "use strict";

  const parser = window.QualidadeBpaParser;

  let parsed = null; // { header, registros, linhasIgnoradas }

  // ---------- helpers ----------
  function enableCard(id) { document.getElementById(id).classList.remove("disabled"); }
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
        parsed = parser.parseFile(e.target.result);
        if (!parsed.header && parsed.registros.length === 0) {
          setMsg(uploadMsg, "error", "Não encontrei um cabeçalho (tipo 01) nem linhas de produção (tipo 02/03) nesse arquivo.");
          return;
        }
        setMsg(uploadMsg, "ok", parsed.registros.length + " registro(s) lido(s)" +
          (parsed.linhasIgnoradas.length ? " — " + parsed.linhasIgnoradas.length + " linha(s) com tipo desconhecido, ignoradas." : "."));
        runAll();
      } catch (err) {
        setMsg(uploadMsg, "error", "Não foi possível ler o arquivo. (" + err.message + ")");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // ---------- resumo ----------
  function renderResumo() {
    const regs = parsed.registros;
    const t02 = regs.filter((r) => r.tipo === "02");
    const t03 = regs.filter((r) => r.tipo === "03");
    const somaQtd = regs.reduce((s, r) => s + (r.quantidade || 0), 0);
    const pacientes = new Set(t03.map(pacienteChave));
    const procedimentos = new Set(regs.map((r) => r.sigtap));

    const stats = [
      ["Registros", regs.length],
      ["Tipo 02 (BPA-C)", t02.length],
      ["Tipo 03 (BPA-I)", t03.length],
      ["Soma quantidade", somaQtd.toLocaleString("pt-BR")],
      ["Pacientes distintos", pacientes.size],
      ["Procedimentos SIGTAP distintos", procedimentos.size],
    ];
    document.getElementById("summaryRow").innerHTML = stats.map(
      ([l, n]) => '<div class="stat"><div class="n">' + n + '</div><div class="l">' + l + "</div></div>"
    ).join("");

    const headerMsg = document.getElementById("headerMsg");
    if (parsed.header) {
      const maxFolha = regs.reduce((m, r) => Math.max(m, r.folha || 0), 0);
      const problemas = [];
      if (parsed.header.numLinhas !== regs.length) {
        problemas.push("cabeçalho declara " + parsed.header.numLinhas + " linha(s), mas o arquivo tem " + regs.length + ".");
      }
      if (parsed.header.numFolhas !== maxFolha) {
        problemas.push("cabeçalho declara " + parsed.header.numFolhas + " folha(s), mas a maior folha encontrada é " + maxFolha + ".");
      }
      if (problemas.length) {
        setMsg(headerMsg, "warn", "Competência " + parsed.header.competencia + " — " + problemas.join(" "));
      } else {
        setMsg(headerMsg, "ok", "Competência " + parsed.header.competencia + " — contagens do cabeçalho batem com o arquivo.");
      }
    } else {
      setMsg(headerMsg, "warn", "Arquivo sem linha de cabeçalho (tipo 01) — não dá pra conferir numLinhas/numFolhas declarados.");
    }
  }

  // ---------- qualidade ----------
  function runQualidade() {
    const regs = parsed.registros;
    const achados = []; // { severidade, descricao, ocorrencias }
    const add = (severidade, descricao, ocorrencias) => {
      if (ocorrencias > 0) achados.push({ severidade, descricao, ocorrencias });
    };

    add("erro", "SIGTAP com formato inválido (não são 10 dígitos, ou é só zero)",
      regs.filter((r) => !/^\d{10}$/.test(r.sigtap) || /^0+$/.test(r.sigtap)).length);

    add("erro", "Quantidade inválida (zero ou negativa)",
      regs.filter((r) => (r.quantidade || 0) <= 0).length);

    add("erro", "CBO com formato inválido (não são 6 dígitos)",
      regs.filter((r) => !/^\d{6}$/.test(r.cbo)).length);

    if (parsed.header) {
      add("erro", "Linha com competência diferente da do cabeçalho (" + parsed.header.competencia + ")",
        regs.filter((r) => r.competencia !== parsed.header.competencia).length);
    }

    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const t03 = regs.filter((r) => r.tipo === "03");
    add("aviso", "Data de atendimento fora do mês da competência",
      regs.filter((r) => r.tipo === "03" && /^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento.slice(0, 6) !== r.competencia).length);
    add("aviso", "Data de atendimento no futuro",
      regs.filter((r) => r.tipo === "03" && /^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento > hoje).length);
    add("aviso", "Data de nascimento inválida ou não informada",
      t03.filter((r) => !isValidDate(r.dataNascimento)).length);
    add("aviso", "Data de nascimento no futuro",
      t03.filter((r) => isValidDate(r.dataNascimento) && r.dataNascimento > hoje).length);
    add("aviso", "CEP com formato inválido (quando informado)",
      t03.filter((r) => r.cep && !/^\d{8}$/.test(r.cep)).length);

    const folhaSeq = {};
    let duplicados = 0;
    regs.forEach((r) => {
      const k = r.folha + "/" + r.seq;
      folhaSeq[k] = (folhaSeq[k] || 0) + 1;
    });
    Object.values(folhaSeq).forEach((n) => { if (n > 1) duplicados += n; });
    add("erro", "Folha/sequência duplicada (mesma folha+seq em mais de uma linha)", duplicados);

    const dupKey = {};
    let regDup = 0;
    t03.forEach((r) => {
      const k = pacienteChave(r) + "|" + r.sigtap + "|" + r.dataAtendimento;
      dupKey[k] = (dupKey[k] || 0) + 1;
    });
    Object.values(dupKey).forEach((n) => { if (n > 1) regDup += n; });
    add("aviso", "Possível duplicidade (mesmo paciente + procedimento + data)", regDup);

    const tbody = document.getElementById("qualidadeBody");
    if (!achados.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--cinza-600);">Nenhum problema encontrado nas verificações abaixo.</td></tr>';
    } else {
      achados.sort((a, b) => (a.severidade === b.severidade ? 0 : a.severidade === "erro" ? -1 : 1));
      tbody.innerHTML = achados.map((a) =>
        "<tr><td><span class=\"badge sev-" + a.severidade + "\">" + (a.severidade === "erro" ? "Erro" : "Aviso") + "</span></td>" +
        '<td class="num">' + a.ocorrencias + "</td>" +
        "<td>" + escapeHtml(a.descricao) + "</td></tr>"
      ).join("");
    }
  }

  // ---------- painéis ----------
  function topN(map, n) {
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  function painelHtml(titulo, entries, formatKey) {
    if (!entries.length) return '<div class="painel"><h3>' + titulo + '</h3><div class="vazio">Sem dados.</div></div>';
    const rows = entries.map(([k, v]) =>
      "<tr><td>" + escapeHtml(formatKey ? formatKey(k) : k) + '</td><td class="n">' + v.toLocaleString("pt-BR") + "</td></tr>"
    ).join("");
    return '<div class="painel"><h3>' + titulo + "</h3><table>" + rows + "</table></div>";
  }

  function renderPaineis(regs) {
    const porProcedimentoQtd = {}, porProcedimentoOcorr = {}, porCbo = {}, porDia = {}, porSexo = {}, porBairro = {};
    regs.forEach((r) => {
      porProcedimentoQtd[r.sigtap] = (porProcedimentoQtd[r.sigtap] || 0) + (r.quantidade || 0);
      porProcedimentoOcorr[r.sigtap] = (porProcedimentoOcorr[r.sigtap] || 0) + 1;
      porCbo[r.cbo] = (porCbo[r.cbo] || 0) + 1;
      if (r.tipo === "03") {
        const dia = fmtData(r.dataAtendimento);
        porDia[dia] = (porDia[dia] || 0) + 1;
        porSexo[r.sexo || "—"] = (porSexo[r.sexo || "—"] || 0) + 1;
        const bairro = r.bairro || "—";
        porBairro[bairro] = (porBairro[bairro] || 0) + 1;
      }
    });

    document.getElementById("paineisGrid").innerHTML = [
      painelHtml("Top procedimentos (por quantidade)", topN(porProcedimentoQtd, 8)),
      painelHtml("Top procedimentos (por ocorrências)", topN(porProcedimentoOcorr, 8)),
      painelHtml("Por CBO", topN(porCbo, 8)),
      painelHtml("Por dia de atendimento (BPA-I)", topN(porDia, 8)),
      painelHtml("Por sexo (BPA-I)", topN(porSexo, 8)),
      painelHtml("Por bairro (BPA-I)", topN(porBairro, 8)),
    ].join("");
  }

  // ---------- tabela + filtros ----------
  const fTipo = document.getElementById("fTipo");
  const fCbo = document.getElementById("fCbo");
  const fSigtap = document.getElementById("fSigtap");
  const fBusca = document.getElementById("fBusca");
  const filterMsg = document.getElementById("filterMsg");

  function filteredRegistros() {
    const tipo = fTipo.value;
    const cbo = fCbo.value.trim();
    const sigtap = fSigtap.value.trim();
    const busca = fBusca.value.trim().toLowerCase();

    return parsed.registros.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      if (cbo && r.cbo.indexOf(cbo) === -1) return false;
      if (sigtap && r.sigtap.indexOf(sigtap) === -1) return false;
      if (busca) {
        const alvo = ((r.nomePaciente || "") + " " + r.sigtap).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function renderTabela(regs) {
    const body = document.getElementById("registrosBody");
    const MAX = 500;
    const linhas = regs.slice(0, MAX);
    body.innerHTML = linhas.map((r) =>
      "<tr><td>" + r.tipo + "</td>" +
      '<td class="num">' + r.folha + "</td>" +
      '<td class="num">' + r.seq + "</td>" +
      '<td class="num">' + r.cbo + "</td>" +
      '<td class="num">' + r.sigtap + "</td>" +
      "<td>" + (r.tipo === "03" ? fmtData(r.dataAtendimento) : "—") + "</td>" +
      '<td class="num">' + r.quantidade + "</td>" +
      "<td>" + (r.tipo === "03" ? escapeHtml(r.nomePaciente) : "—") + "</td></tr>"
    ).join("");

    clearMsg(filterMsg);
    if (regs.length === 0) {
      setMsg(filterMsg, "warn", "Nenhum registro corresponde aos filtros aplicados.");
    } else if (regs.length > MAX) {
      setMsg(filterMsg, "warn", regs.length + " registros encontrados — mostrando os primeiros " + MAX + ".");
    }
  }

  function renderFiltrados() {
    const regs = filteredRegistros();
    renderPaineis(regs);
    renderTabela(regs);
  }
  [fTipo, fCbo, fSigtap, fBusca].forEach((el) => el.addEventListener("input", renderFiltrados));

  // ---------- boot por arquivo ----------
  function runAll() {
    enableCard("card-resumo");
    enableCard("card-qualidade");
    enableCard("card-paineis");
    enableCard("card-tabela");
    renderResumo();
    runQualidade();
    renderFiltrados();
  }

})();
