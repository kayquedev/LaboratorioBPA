(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela final "Arquivo BPA corrigido" — antigo viewFinal do módulo Correção
  // BPA (public/correcao_bpa/js/app.js). Ported verbatim em LÓGICA:
  // sigtapEfetivo/quantidadeEfetiva/temPendenciaAtiva/calcularFaturamento/
  // renderFaturamentoFinal/renderSummaryFinal/renderSetoresFinal/renderDownloads/
  // baixarTexto/nomeCorrigido — só adaptado pra ler QBPA.parsed.fontes
  // diretamente (sem sessionStorage, sem hidratarFonte: os registros já
  // chegam aqui com .cods/.correcoes/.correcoesAuto/.revisado/.excluido
  // preenchidos por avaliarTodos() e pela tela Pendências) e pra usar
  // window.CorrecaoBpaWriter (writer.js, cópia byte-a-byte do writer do
  // Correção BPA) em vez de reimplementar montarArquivo/montarArquivoUnico.
  //
  // codsResolvidosPorPadroes/ibgePadraoOk/cepPadraoOk/secretariaOk/
  // paresDoProc/parCorrecaoManual abaixo duplicam (de propósito) as cópias
  // da tela Pendências — cada tela foi portada de forma independente a
  // partir do mesmo arquivo original, sem compartilhar código entre elas.
  // ─────────────────────────────────────────────────────────────────────────

  const lookup = window.QualidadeBpaLookup;
  const writer = window.CorrecaoBpaWriter;

  function sigtapEfetivo(registro) {
    return (registro.correcoes && registro.correcoes.sigtap) || registro.sigtap;
  }
  function quantidadeEfetiva(registro) {
    const c = registro.correcoes && registro.correcoes.quantidade;
    if (c != null && c !== "") {
      const n = parseInt(c, 10);
      if (!isNaN(n)) return n;
    }
    return registro.quantidade || 0;
  }

  // ---- padrões do município (mesmas checagens da tela Pendências) ----
  function ibgePadraoOk(padroes) {
    return !!padroes && /^\d{6,7}$/.test(String(padroes.municipioIbge || "").trim());
  }
  function cepPadraoOk(padroes) {
    const c = String((padroes && padroes.cepTodos) || "").trim();
    return /^\d{8}$/.test(c) && !/^0+$/.test(c);
  }
  function secretariaOk(padroes) {
    const s = (padroes && padroes.secretaria) || {};
    return String(s.logradouro || "").trim() !== "" && String(s.bairro || "").trim() !== "";
  }
  function paresDoProc(sigtap) {
    return (lookup && lookup.servicosDoProcedimento && lookup.servicosDoProcedimento(sigtap)) || null;
  }
  function parCorrecaoManual(registro) {
    const c = registro.correcoes || {};
    return String(c.servico || "") + String(c.classificacao || "");
  }
  // códigos de pendência que os padrões do município já resolvem ao gerar o arquivo
  function codsResolvidosPorPadroes(registro, padroes) {
    if (registro.tipo !== "03" || !registro.cods) return [];
    const enderInc = String(registro.endereco || "").trim() === "" || String(registro.bairro || "").trim() === "";
    const out = [];
    registro.cods.forEach((c) => {
      if (c === "MUNICIPIO_INVALIDO" && ibgePadraoOk(padroes)) out.push(c);
      else if (c === "ENDERECO_INVALIDO" && secretariaOk(padroes)) out.push(c);
      else if (c === "CEP_INVALIDO" && (cepPadraoOk(padroes) || (secretariaOk(padroes) && enderInc))) out.push(c);
      else if (c === "CLASSIFICACAO_INVALIDA") {
        const pares = paresDoProc(registro.sigtap);
        const manual = parCorrecaoManual(registro);
        if (/^\d{6}$/.test(manual) && pares && pares.indexOf(manual) !== -1) out.push(c);
        else if (registro.correcoesAuto) out.push(c);
      }
    });
    return out;
  }
  function temPendenciaAtiva(registro, padroes) {
    if (!registro.cods || !registro.cods.length || registro.revisado) return false;
    const resolvidos = codsResolvidosPorPadroes(registro, padroes);
    return registro.cods.some((c) => resolvidos.indexOf(c) === -1);
  }

  // -------- faturamento (recalcula com o SIGTAP/quantidade já corrigidos) --------
  function calcularFaturamento(fontes, padroes) {
    let total = 0, pendente = 0;
    fontes.forEach((fonte) => fonte.registros.forEach((r) => {
      if (r.excluido) return;
      const info = lookup && lookup.sigtapInfo(sigtapEfetivo(r));
      if (!info) return;
      const valor = info.valor * quantidadeEfetiva(r);
      total += valor;
      if (temPendenciaAtiva(r, padroes)) pendente += valor;
    }));
    return { total, pendente, receber: total - pendente };
  }

  // painel rico: 3 cards (total / a receber com % / pendente-risco-de-glosa com %)
  function faturamentoFinalHtml(fontes, padroes) {
    const fmtMoeda = QBPA.utils.fmtMoeda;
    const cardHtml = QBPA.utils.cardHtml;
    const f = calcularFaturamento(fontes, padroes);
    const pctReceber = f.total ? Math.round((f.receber / f.total) * 100) : 100;
    const pctPendente = 100 - pctReceber;
    const cards = [
      {
        valor: fmtMoeda(f.total), titulo: "Faturamento total estimado",
        desc: "Soma do valor SIGTAP × quantidade de todos os registros que vão sair no arquivo (exclusões já descontadas).",
        badge: '<span class="badge b-soon">Estimado</span>',
      },
      {
        valor: fmtMoeda(f.receber), titulo: "Faturamento estimado a receber",
        desc: "Registros sem pendência, já corrigidos ou já marcados como revisados.",
        corValor: "var(--teal)", pct: pctReceber, barColor: "var(--teal)",
        badge: '<span class="badge b-ok pct-badge">' + pctReceber + "% do total</span>",
      },
      {
        valor: fmtMoeda(f.pendente), titulo: "Pendente / risco de glosa",
        desc: "Pendências que ainda não foram revisadas — se o arquivo for enviado assim, essas linhas correm risco de rejeição.",
        corValor: "var(--red)", badge: '<span class="badge sev-erro pct-badge">' + pctPendente + "% do total</span>",
      },
    ];
    return cards.map(cardHtml).join("");
  }

  // -------- resumo/estatísticas (já descontando exclusões) --------
  function summaryFinalHtml(fontes) {
    const pacienteChave = QBPA.utils.pacienteChave;
    let registros = 0, t02 = 0, t03 = 0;
    const pacientes = new Set();
    const competencias = new Set();
    fontes.forEach((fonte) => {
      if (fonte.header) competencias.add(fonte.header.competencia);
      fonte.registros.forEach((r) => {
        if (r.excluido) return;
        registros++;
        if (r.tipo === "02") t02++;
        else if (r.tipo === "03") { t03++; pacientes.add(pacienteChave(r)); }
      });
    });
    const competencia = competencias.size === 1 ? [...competencias][0] : competencias.size > 1 ? "vários" : "—";
    const stats = [
      ["Registros", registros],
      ["BPA-C × BPA-I", t02 + " <small>/</small> " + t03],
      ["Pacientes distintos", pacientes.size],
      ["Competência", competencia],
    ];
    return stats.map(([l, n]) => '<div class="stat-box"><div class="l">' + l + '</div><div class="n">' + n + "</div></div>").join("");
  }

  // -------- setores com produção esperada (mesmos indicadores do resto do módulo) --------
  function setoresFinalHtml(fontes) {
    const escapeHtml = QBPA.utils.escapeHtml;
    const codigosPresentes = new Set();
    fontes.forEach((fonte) => fonte.registros.forEach((r) => { if (!r.excluido) codigosPresentes.add(sigtapEfetivo(r)); }));
    return Object.entries(QBPA.SETOR_INDICADORES).map(([nome, codigos]) => {
      const importado = codigos.some((c) => codigosPresentes.has(c));
      return '<span class="badge ' + (importado ? "b-ok" : "sev-erro") + '" style="margin-right:8px;">' +
        (importado ? "✓" : "✗") + " " + escapeHtml(nome) + "</span>";
    }).join(" ");
  }

  // -------- banner de status (sucesso / pendências tratadas) --------
  // Mostra o banner verde só quando não sobra NENHUMA pendência ativa. O
  // texto muda conforme o caso pra nunca alegar "sem pendências" quando na
  // verdade existem `.cods` que só foram cobertos pelos padrões do município
  // (ou revisados manualmente) — nesse caso o texto fala em "tratadas".
  function statusBannerHtml(fontes, padroes) {
    const comCods = [];
    fontes.forEach((fonte) => fonte.registros.forEach((r) => {
      if (!r.excluido && r.cods && r.cods.length) comCods.push(r);
    }));
    const ativas = comCods.filter((r) => temPendenciaAtiva(r, padroes));
    if (ativas.length) return "";

    if (!comCods.length) {
      return '<div class="alert-banner show ok">✓ Nenhuma pendência encontrada. Arquivo validado para exportação.</div>';
    }
    return '<div class="alert-banner show ok">✓ Pendências tratadas/revisadas — nenhuma pendência ativa restante ' +
      "(cobertas pelos padrões do município ou já revisadas). Arquivo validado para exportação.</div>";
  }

  // -------- geração/download --------
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
  function downloadsHtml(fontes) {
    const escapeHtml = QBPA.utils.escapeHtml;
    let html = fontes.map((fonte, i) =>
      '<button class="btn btn-ghost-dark" data-baixar-fonte="' + i + '">⬇ Baixar corrigido — ' + escapeHtml(fonte.label || fonte.nome) + "</button>"
    ).join("");

    if (fontes.length > 1 && writer.mesmaCompetencia(fontes)) {
      html += '<button class="btn" id="btnBaixarUnico" style="background:var(--teal);color:#04241c;">⬇ Baixar arquivo único (todas as fontes)</button>';
    } else if (fontes.length > 1) {
      html += '<div class="msg show warn" style="margin-top:10px;">As fontes têm competências diferentes — não gero um arquivo único automaticamente pra não misturar competência errada. Baixe cada uma separadamente acima.</div>';
    }
    return html;
  }
  function wireDownloads(el, fontes, padroes) {
    el.querySelectorAll("[data-baixar-fonte]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fonte = fontes[+btn.dataset.baixarFonte];
        const out = writer.montarArquivo(fonte, padroes);
        if (out.avisos && out.avisos.length) window.alert(out.avisos.join("\n\n"));
        baixarTexto(nomeCorrigido(fonte.nome), out.texto);
      });
    });
    const btnUnico = el.querySelector("#btnBaixarUnico");
    if (btnUnico) {
      btnUnico.addEventListener("click", () => {
        const out = writer.montarArquivoUnico(fontes, padroes);
        if (out.avisos && out.avisos.length) window.alert(out.avisos.join("\n\n"));
        baixarTexto("bpa_corrigido_unico.txt", out.texto);
      });
    }
  }

  function render() {
    const el = document.getElementById("tela-arquivo-corrigido");
    const header = '<div class="tela-header"><h1>Arquivo BPA corrigido</h1>' +
      "<p>Tela final para geração do arquivo após correção das pendências.</p></div>";

    const parsed = QBPA.parsed;
    if (!parsed || !parsed.fontes || !parsed.fontes.length) {
      el.innerHTML = header + '<div class="alert-banner show">Nenhum arquivo importado ainda.</div>';
      return;
    }

    const fontes = parsed.fontes;
    const padroes = QBPA.padroes;

    el.innerHTML = header +
      statusBannerHtml(fontes, padroes) +
      '<div class="stat-row">' + summaryFinalHtml(fontes) + "</div>" +
      '<div class="group-label">Faturamento (R$)</div>' +
      '<div class="cards-grid">' + faturamentoFinalHtml(fontes, padroes) + "</div>" +
      '<div class="group-label">Setores com produção esperada</div>' +
      "<div>" + setoresFinalHtml(fontes) + "</div>" +
      '<div class="group-label">Gerar arquivo corrigido</div>' +
      '<div class="downloads-box">' + downloadsHtml(fontes) + "</div>";

    wireDownloads(el, fontes, padroes);
  }

  QBPA.telas["arquivo-corrigido"] = { render };
})();
