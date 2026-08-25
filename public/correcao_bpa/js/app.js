(function () {
  "use strict";

  const writer = window.CorrecaoBpaWriter;
  const STORAGE_KEY = "qualidade_bpa_correcao_payload";

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtData(aaaammdd) {
    if (!/^\d{8}$/.test(aaaammdd || "")) return aaaammdd || "";
    return aaaammdd.slice(6, 8) + "/" + aaaammdd.slice(4, 6) + "/" + aaaammdd.slice(0, 4);
  }

  const viewVazio = document.getElementById("viewVazio");
  const viewCorrecao = document.getElementById("viewCorrecao");

  let payload = null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    payload = raw ? JSON.parse(raw) : null;
  } catch (err) {
    payload = null;
  }

  if (!payload || !payload.fontes || !payload.fontes.length) {
    viewVazio.classList.remove("hidden");
    viewCorrecao.classList.add("hidden");
    return;
  }

  viewVazio.classList.add("hidden");
  viewCorrecao.classList.remove("hidden");

  const fontes = payload.fontes;

  // -------- resumo geral --------
  function renderResumo() {
    let totalComProblema = 0, soAuto = 0, precisaManual = 0;
    fontes.forEach((fonte) => {
      fonte.registros.forEach((r) => {
        if (!r.problemas || !r.problemas.length) return;
        totalComProblema++;
        const soFolhaSeq = r.problemas.every((p) => p.cod === "FOLHA_SEQ_DUPLICADA");
        if (soFolhaSeq) soAuto++; else precisaManual++;
      });
    });

    const el = document.getElementById("resumoBox");
    if (!totalComProblema) {
      el.className = "alert-banner show ok";
      el.innerHTML = "<b>Nenhuma pendência encontrada.</b> Folha/sequência já renumerada e conferida para " +
        fontes.length + " arquivo(s) — pode baixar direto.";
    } else {
      el.className = "alert-banner show";
      el.innerHTML = "<b>" + totalComProblema + " registro(s) com pendência</b> em " + fontes.length + " arquivo(s). " +
        "<b>" + soAuto + "</b> resolvido(s) automaticamente (renumeração de folha/sequência). " +
        "<b>" + precisaManual + "</b> precisa(m) de revisão manual abaixo — corrija ou deixe como está (pular).";
    }
  }

  // -------- lista de fontes --------
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

  // -------- tabela de revisao manual --------
  function camposEditaveis(problemas) {
    const set = new Set();
    problemas.forEach((p) => {
      const campos = writer.CAMPOS_POR_PROBLEMA[p.cod];
      if (campos) campos.forEach((c) => set.add(c));
    });
    return [...set];
  }

  function valorAtual(registro, campo) {
    if (registro.correcoes && registro.correcoes[campo] != null) return registro.correcoes[campo];
    if (campo === "dataAtendimento" || campo === "dataNascimento") return fmtData(registro[campo]);
    return registro[campo];
  }

  function linhaRevisaoHtml(fonteIdx, regIdx, registro) {
    const campos = camposEditaveis(registro.problemas);
    const inputs = campos.map((campo) =>
      '<label class="campo-corrigir">' + writer.CAMPO_LABEL[campo] + ":" +
      '<input data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '" data-campo="' + campo + '" value="' +
      escapeHtml(valorAtual(registro, campo)) + '"></label>'
    ).join("");

    const problemasHtml = registro.problemas.map((p) =>
      '<div class="probitem probitem-' + p.sev + '"><b>' + escapeHtml(p.texto) + ":</b> " + escapeHtml(p.explicacao) +
      '<span class="resolver">Como resolver: ' + escapeHtml(p.resolver) + "</span></div>"
    ).join("");

    return '<tr data-linha-fonte="' + fonteIdx + '" data-linha-reg="' + regIdx + '">' +
      "<td>" + registro.tipo + "</td>" +
      "<td>" + escapeHtml(registro.origem || "") + "</td>" +
      '<td class="num">' + registro.folha + "/" + registro.seq + "</td>" +
      "<td>" + (registro.tipo === "03" ? escapeHtml(registro.nomePaciente || "") : "—") + "</td>" +
      '<td><div class="problema-list">' + problemasHtml + "</div></td>" +
      "<td>" + (inputs || '<span class="ok-txt">sem campo — só revisar</span>') + "</td>" +
      '<td class="col-acoes"><label><input type="checkbox" data-revisado data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '"> Revisado</label>' +
      '<label><input type="checkbox" data-excluir data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '"> Excluir linha</label></td>' +
      "</tr>";
  }

  function renderTabela() {
    const linhas = [];
    fontes.forEach((fonte, fonteIdx) => {
      fonte.registros.forEach((registro, regIdx) => {
        if (!registro.problemas || !registro.problemas.length) return;
        const soFolhaSeq = registro.problemas.every((p) => p.cod === "FOLHA_SEQ_DUPLICADA");
        if (soFolhaSeq) return; // resolvido automaticamente, nao entra na revisao manual
        linhas.push(linhaRevisaoHtml(fonteIdx, regIdx, registro));
      });
    });

    const bloco = document.getElementById("blocoRevisao");
    if (!linhas.length) {
      bloco.classList.add("hidden");
      return;
    }
    bloco.classList.remove("hidden");
    document.getElementById("tabelaRevisaoBody").innerHTML = linhas.join("");
    atualizarContadorRevisados();
    wireTabelaEventos();
  }

  function wireTabelaEventos() {
    document.querySelectorAll("#tabelaRevisaoBody input[data-campo]").forEach((input) => {
      input.addEventListener("input", () => {
        const fonte = fontes[+input.dataset.fonte];
        const registro = fonte.registros[+input.dataset.reg];
        registro.correcoes = registro.correcoes || {};
        registro.correcoes[input.dataset.campo] = input.value;
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody input[data-revisado]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const tr = chk.closest("tr");
        tr.classList.toggle("linha-revisada", chk.checked);
        atualizarContadorRevisados();
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody input[data-excluir]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const fonte = fontes[+chk.dataset.fonte];
        const registro = fonte.registros[+chk.dataset.reg];
        registro.excluido = chk.checked;
        chk.closest("tr").classList.toggle("linha-excluida", chk.checked);
      });
    });
  }

  function atualizarContadorRevisados() {
    const total = document.querySelectorAll("#tabelaRevisaoBody tr").length;
    const revisados = document.querySelectorAll("#tabelaRevisaoBody input[data-revisado]:checked").length;
    document.getElementById("contadorRevisados").textContent = revisados + " de " + total + " revisado(s)";
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

  renderResumo();
  renderFontes();
  renderTabela();
  renderDownloads();

})();
