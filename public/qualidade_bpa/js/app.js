(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Shell do módulo: topbar, sidebar, gate de upload e roteamento por hash
  // entre telas. Toda a lógica de negócio (regras SIGTAP, faturamento,
  // correção, geração do arquivo) mora em js/state.js + js/tela-*.js — este
  // arquivo só liga a navegação.
  // ─────────────────────────────────────────────────────────────────────────

  const TELAS = ["geral", "producao", "registros", "pendencias", "faturamento", "qualidade", "paineis", "alertas", "configuracoes", "arquivo-corrigido"];
  const TELA_META = {
    geral: { titulo: "Qualidade da Produção BPA", subtitulo: "Monitore a produção, identifique inconsistências e garanta um faturamento seguro." },
    producao: { titulo: "Produção", subtitulo: "Arquivos importados, estabelecimentos e setores com produção no período." },
    registros: { titulo: "Registros nominais", subtitulo: "Consulte, filtre e analise os registros da produção BPA." },
    pendencias: { titulo: "Módulo de pendências", subtitulo: "Revise inconsistências e gere o arquivo corrigido." },
    faturamento: { titulo: "Faturamento (R$)", subtitulo: "Valores calculados com base nos registros importados." },
    qualidade: { titulo: "Qualidade dos dados", subtitulo: "Consistência do cabeçalho e valor estimado das pendências." },
    paineis: { titulo: "Painéis", subtitulo: "Distribuição da produção por procedimento, CBO, dia, sexo e bairro." },
    alertas: { titulo: "Alertas", subtitulo: "O que significam os avisos e erros encontrados, por prioridade." },
    configuracoes: { titulo: "Configurações", subtitulo: "Estabelecimentos (CNES) e padrões do município usados na correção." },
    "arquivo-corrigido": { titulo: "Arquivo BPA corrigido", subtitulo: "Tela final para geração do arquivo após correção das pendências." },
  };

  // ---------- topbar / gate ----------
  const viewUpload = document.getElementById("viewUpload");
  const viewDashboard = document.getElementById("viewDashboard");
  const topbarTitulo = document.getElementById("topbarTitulo");
  const topbarSubtitulo = document.getElementById("topbarSubtitulo");
  const topbarCompetencia = document.getElementById("topbarCompetencia");
  const topbarActions = document.getElementById("topbarActions");
  const btnVoltarInicio = document.getElementById("btnVoltarInicio");

  function competenciaTexto() {
    if (!QBPA.parsed) return "";
    const comps = [...new Set(QBPA.parsed.fontes.map((f) => f.header ? f.header.competencia : null).filter(Boolean))];
    if (!comps.length) return "";
    return "Competência " + (comps.length === 1 ? comps[0] : "vários");
  }

  function mostrarGate() {
    viewUpload.classList.remove("hidden");
    viewDashboard.classList.add("hidden");
    topbarCompetencia.classList.add("hidden");
    topbarActions.classList.add("hidden");
    topbarTitulo.textContent = "Qualidade BPA";
    topbarSubtitulo.textContent = "";
  }

  let telaAtual = "geral";

  function ativarTela(nome) {
    if (TELAS.indexOf(nome) === -1) nome = "geral";
    telaAtual = nome;
    document.querySelectorAll(".app-nav-item").forEach((el) => el.classList.toggle("active", el.dataset.tela === nome));
    document.querySelectorAll(".tela").forEach((el) => el.classList.toggle("hidden", el.id !== "tela-" + nome));
    const meta = TELA_META[nome];
    topbarTitulo.textContent = meta.titulo;
    topbarSubtitulo.textContent = meta.subtitulo;
    const tela = QBPA.telas[nome];
    if (tela && typeof tela.render === "function") tela.render();
  }

  function mostrarDashboard() {
    viewUpload.classList.add("hidden");
    viewDashboard.classList.remove("hidden");
    topbarCompetencia.textContent = competenciaTexto();
    topbarCompetencia.classList.toggle("hidden", !competenciaTexto());
    topbarActions.classList.remove("hidden");
    const nome = (location.hash || "#geral").slice(1);
    ativarTela(nome);
  }

  function rotear() {
    if (!QBPA.parsed) { mostrarGate(); return; }
    mostrarDashboard();
  }
  window.addEventListener("hashchange", rotear);
  window.addEventListener("popstate", rotear);

  document.querySelectorAll(".app-nav-item[data-tela]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = "#" + btn.dataset.tela; });
  });

  // "Início" tem duas camadas: de qualquer tela do módulo, o botão só volta
  // pra tela inicial (Visão Geral) — sem confirmação, já que os dados não se
  // perdem. Só quando já se está na tela inicial (ou ainda no gate de
  // importação, antes de qualquer tela existir) é que clicar de novo
  // pergunta se quer mesmo sair do módulo.
  btnVoltarInicio.addEventListener("click", () => {
    if (QBPA.parsed && telaAtual !== "geral") {
      location.hash = "#geral";
      return;
    }
    if (window.confirm("Sair do Qualidade BPA? Os dados carregados nesta sessão serão perdidos.")) {
      window.location.href = "/";
    }
  });

  // ---------- upload ----------
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("fileInput");
  const fname = document.getElementById("fname");
  const uploadMsg = document.getElementById("uploadMsg");
  const addFileInput = document.getElementById("addFileInput");

  async function tratarArquivos(fileList, modo) {
    if (modo === "novo") { fname.textContent = fileList[0] ? fileList[0].name : ""; QBPA.utils.clearMsg(uploadMsg); }
    const res = await QBPA.processarArquivos(fileList, modo);
    if (!res.ok) {
      if (res.erros.length) QBPA.utils.setMsg(uploadMsg, "error", res.erros.join(" "));
      return;
    }
    if (res.erros.length) window.alert(res.erros.join("\n"));
    location.hash = "#geral";
    mostrarDashboard();
  }

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; tratarArquivos(fileInput.files, "novo"); }
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) tratarArquivos(fileInput.files, "novo"); });
  addFileInput.addEventListener("change", () => {
    if (addFileInput.files.length) tratarArquivos(addFileInput.files, "adicionar").then(() => ativarTela((location.hash || "#geral").slice(1)));
    addFileInput.value = "";
  });
  document.getElementById("btnAddFile").addEventListener("click", () => addFileInput.click());
  document.getElementById("btnReimport").addEventListener("click", () => {
    QBPA.parsed = null;
    fileInput.value = "";
    fname.textContent = "";
    QBPA.utils.clearMsg(uploadMsg);
    location.hash = "";
    mostrarGate();
  });

  mostrarGate();
})();
