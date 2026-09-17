(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Pendências" — porta a revisão manual do antigo Correção BPA
  // (public/correcao_bpa/js/app.js) pra dentro do Qualidade BPA unificado.
  // Nenhuma regra de cálculo/correção foi alterada: sigtapEfetivo,
  // quantidadeEfetiva, os helpers de "padrões do município"
  // (ibgePadraoOk/cepPadraoOk/secretariaOk/paresDoProc/parAlvoServico/
  // aplicarPreenchimentoServico/parCorrecaoManual/codsResolvidosPorPadroes/
  // temPendenciaAtiva) e calcularFaturamento() são cópia fiel daquele
  // arquivo (linhas 41-56 e 358-369), só trocando a fonte dos dados:
  //   - lá: `fontes` era hidratado de sessionStorage (hidratarFonte/payload) —
  //     aqui não existe handoff nenhum, os registros já vêm prontos (com
  //     .linha/.cods/.tipo/.cnes) em QBPA.parsed.fontes/registros.
  //   - lá: `padroes` era estado local do próprio módulo — aqui é só leitura
  //     de QBPA.padroes (outra tela, "Configurações", é dona do formulário).
  // O endereçamento por fonteIdx/regIdx dos handlers inline de edição foi
  // mantido igual, apontando pra QBPA.parsed.fontes em vez do array antigo.
  // ─────────────────────────────────────────────────────────────────────────

  const QBPA = window.QBPA;
  const writer = window.CorrecaoBpaWriter;
  const lookup = window.QualidadeBpaLookup;
  const utils = QBPA.utils;
  const escapeHtml = utils.escapeHtml;
  const fmtData = utils.fmtData;
  const fmtMoeda = utils.fmtMoeda;
  const cboCelHtml = utils.cboCelHtml;
  const sigtapCelHtml = utils.sigtapCelHtml;
  const cboNome = utils.cboNome;
  const sigtapNome = utils.sigtapNome;
  const setMsg = utils.setMsg;
  const clearMsg = utils.clearMsg;
  const cardHtml = utils.cardHtml;
  const progressColor = utils.progressColor;

  // estado local da tela — recalculado a cada render(), nunca guardado entre renders
  let el = null;
  let todasPendencias = [];

  // ---------- valores efetivos (considera correção manual, se houver) ----------
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

  function calcularTodasPendencias() {
    const lista = [];
    (QBPA.parsed.fontes || []).forEach((fonte, fonteIdx) => {
      fonte.registros.forEach((registro, regIdx) => {
        if (registro.cods && registro.cods.length) lista.push({ fonte, fonteIdx, regIdx, registro });
      });
    });
    return lista;
  }

  // ---------- padrões do município (lidos de QBPA.padroes, nunca mutados aqui) ----------
  function ibgePadraoOk() { return /^\d{6,7}$/.test((QBPA.padroes.municipioIbge || "").trim()); }
  function cepPadraoOk() {
    const c = (QBPA.padroes.cepTodos || "").trim();
    return /^\d{8}$/.test(c) && !/^0+$/.test(c);
  }
  function secretariaOk() {
    return (QBPA.padroes.secretaria.logradouro || "").trim() !== "" && (QBPA.padroes.secretaria.bairro || "").trim() !== "";
  }

  // ---- preenchimento de Serviço/Classificação (crítica 050) ----
  function paresDoProc(sigtap) {
    return (lookup.servicosDoProcedimento && lookup.servicosDoProcedimento(sigtap)) || null;
  }
  // par (6 díg.) que deve ser gravado numa linha 03 com Serviço/Classificação
  // em branco/inválido: único possível, ou o do serviço preferencial. null =
  // ambíguo, escolher manualmente. `forcar` ignora o checkbox (usado só na prévia).
  function parAlvoServico(registro, forcar) {
    if (registro.tipo !== "03") return null;
    if (!forcar && !QBPA.padroes.preencherServico) return null;
    const pares = paresDoProc(registro.sigtap);
    if (!pares || !pares.length) return null;
    const atual = (registro.servico || "").trim() + (registro.classificacao || "").trim();
    if (/^\d{6}$/.test(atual) && pares.indexOf(atual) !== -1) return null; // já válido
    const pref = (QBPA.padroes.servicoPreferencial || "").trim();
    if (pref) {
      const m = pares.filter((p) => p.slice(0, 3) === pref);
      if (m.length === 1) return m[0];
      if (m.length > 1) return null;
    }
    return pares.length === 1 ? pares[0] : null;
  }
  function aplicarPreenchimentoServico() {
    QBPA.parsed.fontes.forEach((f) => f.registros.forEach((r) => {
      const alvo = parAlvoServico(r, false);
      if (alvo) r.correcoesAuto = { servico: alvo.slice(0, 3), classificacao: alvo.slice(3) };
      else if (r.correcoesAuto) delete r.correcoesAuto;
    }));
  }
  function parCorrecaoManual(registro) {
    const c = registro.correcoes || {};
    return String(c.servico || "") + String(c.classificacao || "");
  }

  // códigos de pendência que os padrões já resolvem ao gerar o arquivo
  function codsResolvidosPorPadroes(registro) {
    if (registro.tipo !== "03" || !registro.cods) return [];
    const enderInc = String(registro.endereco || "").trim() === "" || String(registro.bairro || "").trim() === "";
    const out = [];
    registro.cods.forEach((c) => {
      if (c === "MUNICIPIO_INVALIDO" && ibgePadraoOk()) out.push(c);
      else if (c === "ENDERECO_INVALIDO" && secretariaOk()) out.push(c);
      else if (c === "CEP_INVALIDO" && (cepPadraoOk() || (secretariaOk() && enderInc))) out.push(c);
      else if (c === "CLASSIFICACAO_INVALIDA") {
        const pares = paresDoProc(registro.sigtap);
        const manual = parCorrecaoManual(registro);
        if (/^\d{6}$/.test(manual) && pares && pares.indexOf(manual) !== -1) out.push(c);
        else if (registro.correcoesAuto) out.push(c);
      }
    });
    return out;
  }
  function temPendenciaAtiva(registro) {
    if (!registro.cods || !registro.cods.length || registro.revisado) return false;
    const resolvidos = codsResolvidosPorPadroes(registro);
    return registro.cods.some((c) => resolvidos.indexOf(c) === -1);
  }

  // -------- faturamento (versão do Correção BPA: usa sigtapEfetivo/quantidadeEfetiva/temPendenciaAtiva) --------
  function calcularFaturamento() {
    let total = 0, pendente = 0;
    QBPA.parsed.fontes.forEach((fonte) => fonte.registros.forEach((r) => {
      if (r.excluido) return;
      const info = lookup.sigtapInfo(sigtapEfetivo(r));
      if (!info) return;
      const valor = info.valor * quantidadeEfetiva(r);
      total += valor;
      if (temPendenciaAtiva(r)) pendente += valor;
    }));
    return { total, pendente, receber: total - pendente };
  }

  // -------- cards de indicadores (topo da tela) --------
  function progressoCircularHtml(pct, revisados, total) {
    const r = 26, c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);
    const cor = progressColor(pct);
    return '<div class="progresso-circular">' +
      '<svg width="64" height="64" viewBox="0 0 64 64">' +
        '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="8"></circle>' +
        '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="' + cor + '" stroke-width="8" stroke-linecap="round" ' +
          'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '" transform="rotate(-90 32 32)"></circle>' +
      "</svg>" +
      '<div><div class="txt">' + pct + '%</div><div class="sub">' + revisados + " de " + total + " revisado(s)</div></div>" +
      "</div>";
  }

  function kpiCardsHtml() {
    const total = todasPendencias.length;
    const fat = calcularFaturamento();
    const revisados = todasPendencias.filter((p) => p.registro.revisado).length;
    const criticas = todasPendencias.filter((p) =>
      p.registro.cods.some((cod) => (writer.PROBLEMA_CATALOG[cod] || { sev: "aviso", texto: cod, explicacao: "", resolver: "" }).sev === "erro")
    ).length;
    const pct = total ? Math.round((revisados / total) * 100) : 100;

    const cards = [
      cardHtml({
        valor: String(total),
        titulo: "Total de pendências",
        desc: "Registros com pelo menos um problema aberto, somando todas as fontes carregadas.",
      }),
      cardHtml({
        valor: fmtMoeda(fat.pendente),
        titulo: "Valor em pendência",
        desc: "Soma do valor SIGTAP × quantidade das pendências ainda não revisadas — risco de rejeição/glosa se o arquivo for enviado assim.",
        corValor: "var(--red)",
      }),
      cardHtml({
        valor: String(revisados),
        titulo: "Revisados",
        desc: total ? (revisados + " de " + total + " pendência(s) já revisada(s) nesta sessão.") : "Nenhuma pendência para revisar.",
        corValor: "var(--teal)",
      }),
      cardHtml({
        valor: String(criticas),
        titulo: "Pendências críticas",
        desc: "Pendências com pelo menos um problema classificado como erro — impede o envio ao SIA.",
        corValor: "var(--red)",
      }),
      '<div class="ind-card">' +
        '<div class="ind-card-top"></div>' +
        '<div class="titulo">Progresso de revisão</div>' +
        progressoCircularHtml(pct, revisados, total) +
        '<div class="desc">Percentual de pendências já revisadas.</div>' +
      "</div>",
    ];
    return cards.join("");
  }

  function atualizarResumo() {
    const row = el.querySelector("#kpiRow");
    if (row) row.innerHTML = kpiCardsHtml();
  }

  // -------- filtros / tabela de revisão --------
  function popularFiltrosRevisao() {
    const fUnidade = el.querySelector("#fUnidade");
    const fProblema = el.querySelector("#fProblema");

    const unidades = [...new Set(todasPendencias.map((p) => p.registro.cnes))].sort();
    fUnidade.innerHTML = '<option value="">Todas</option>' + unidades.map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>").join("");

    const counts = {};
    todasPendencias.forEach((p) => p.registro.cods.forEach((cod) => { counts[cod] = (counts[cod] || 0) + 1; }));
    const codigos = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    fProblema.innerHTML = '<option value="">Todos</option>' + codigos.map((cod) => {
      const info = writer.PROBLEMA_CATALOG[cod] || { sev: "aviso", texto: cod };
      return '<option value="' + cod + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + " · " + escapeHtml(info.texto) + " (" + counts[cod] + ")</option>";
    }).join("");
  }

  function filteredPendencias() {
    const tipo = el.querySelector("#fTipo").value;
    const unidade = el.querySelector("#fUnidade").value;
    const problema = el.querySelector("#fProblema").value;
    const busca = el.querySelector("#fBusca").value.trim().toLowerCase();
    const soNaoRevisados = el.querySelector("#fSoNaoRevisados").checked;

    return todasPendencias.filter(({ registro }) => {
      if (tipo && registro.tipo !== tipo) return false;
      if (unidade && registro.cnes !== unidade) return false;
      if (problema && registro.cods.indexOf(problema) === -1) return false;
      if (soNaoRevisados && registro.revisado) return false;
      if (busca) {
        const alvo = ((registro.nomePaciente || "") + " " + registro.sigtap + " " + sigtapNome(registro.sigtap) + " " + registro.cbo + " " + cboNome(registro.cbo)).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function camposEditaveis(cods) {
    const set = new Set();
    cods.forEach((cod) => {
      const campos = writer.CAMPOS_POR_PROBLEMA[cod];
      if (campos) campos.forEach((c) => set.add(c));
    });
    return [...set];
  }

  function valorAtual(registro, campo) {
    if (registro.correcoes && registro.correcoes[campo] != null) return registro.correcoes[campo];
    if (campo === "dataAtendimento" || campo === "dataNascimento") return fmtData(registro[campo]);
    return registro[campo];
  }

  // dropdown com os pares Serviço/Classificação aceitos pelo procedimento
  function selectServicoClassificacaoHtml(fonteIdx, regIdx, registro) {
    const pares = paresDoProc(registro.sigtap) || [];
    if (!pares.length) return "";
    const manual = parCorrecaoManual(registro);
    const auto = registro.correcoesAuto ? registro.correcoesAuto.servico + registro.correcoesAuto.classificacao : "";
    const sel = /^\d{6}$/.test(manual) ? manual : auto;
    const opts = ['<option value="">— escolher —</option>'].concat(pares.map((sc) => {
      const nome = lookup.nomeClassificacao(sc) || lookup.nomeServico(sc.slice(0, 3));
      return '<option value="' + sc + '"' + (sc === sel ? " selected" : "") + ">" +
        escapeHtml(sc.slice(0, 3) + "-" + sc.slice(3) + " · " + nome) + "</option>";
    }));
    const dica = (auto && !/^\d{6}$/.test(manual))
      ? '<span class="campo-auto">preenchido automaticamente: ' + escapeHtml(auto.slice(0, 3) + "-" + auto.slice(3)) + "</span>"
      : "";
    return '<label class="campo-corrigir">Serviço/Classificação:' +
      '<select data-srvclf data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '">' + opts.join("") + "</select>" +
      dica + "</label>";
  }

  function linhaRevisaoHtml(fonteIdx, regIdx, registro, origemLabel) {
    const temClf = (registro.cods || []).indexOf("CLASSIFICACAO_INVALIDA") !== -1;
    const campos = camposEditaveis(registro.cods)
      .filter((c) => !(temClf && (c === "servico" || c === "classificacao")));
    const inputs = campos.map((campo) =>
      '<label class="campo-corrigir">' + writer.CAMPO_LABEL[campo] + ":" +
      '<input data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '" data-campo="' + campo + '" value="' +
      escapeHtml(valorAtual(registro, campo)) + '"></label>'
    ).join("");
    const selClf = temClf ? selectServicoClassificacaoHtml(fonteIdx, regIdx, registro) : "";

    const problemasHtml = registro.cods.map((cod) => {
      const info = writer.PROBLEMA_CATALOG[cod] || { sev: "aviso", texto: cod, explicacao: "", resolver: "" };
      return '<div class="probitem probitem-' + info.sev + '"><b>' + escapeHtml(info.texto) + ":</b> " + escapeHtml(info.explicacao) +
        '<span class="resolver">Como resolver: ' + escapeHtml(info.resolver) + "</span></div>";
    }).join("");

    const cobertos = codsResolvidosPorPadroes(registro);
    const notaPadroes = cobertos.length
      ? '<div class="probitem probitem-aviso"><b>Padrões do município:</b> ' +
        (cobertos.length === registro.cods.length
          ? "esta linha será corrigida automaticamente ao gerar o arquivo (IBGE / endereço da Secretaria)."
          : "parte desta linha (" + escapeHtml(cobertos.join(", ")) + ") será corrigida ao gerar.") +
        "</div>"
      : "";

    const infoSigtap = lookup.sigtapInfo(sigtapEfetivo(registro));
    const qtd = quantidadeEfetiva(registro);
    const valorHtml = infoSigtap ? fmtMoeda(infoSigtap.valor * qtd) : "—";

    // classe inicial da linha (revisado/excluído) — necessário aqui porque,
    // diferente do Correção BPA original (página de uso único), esta tela
    // pode ser renderizada de novo em cima dos MESMOS registros (ex.: o
    // usuário navega pra outra tela e volta): sem isso a linha "esqueceria"
    // visualmente que já foi revisada/excluída até o próximo clique.
    const rowClasses = [];
    if (registro.revisado) rowClasses.push("linha-revisada");
    if (registro.excluido) rowClasses.push("linha-excluida");

    return '<tr data-linha-fonte="' + fonteIdx + '" data-linha-reg="' + regIdx + '"' +
      (rowClasses.length ? ' class="' + rowClasses.join(" ") + '"' : "") + ">" +
      "<td>" + registro.tipo + "</td>" +
      "<td>" + escapeHtml(registro.cnes) + "</td>" +
      "<td>" + escapeHtml(origemLabel) + "</td>" +
      "<td>" + (registro.tipo === "03" ? fmtData(registro.dataAtendimento) : "—") + "</td>" +
      '<td class="num">' + sigtapCelHtml(registro.sigtap) + "</td>" +
      '<td class="num">' + qtd + "</td>" +
      '<td class="num">' + valorHtml + "</td>" +
      '<td class="num">' + cboCelHtml(registro.cbo) + "</td>" +
      "<td>" + (registro.tipo === "03" ? escapeHtml(registro.nomePaciente || "") : "—") + "</td>" +
      '<td><div class="problema-list">' + notaPadroes + problemasHtml + "</div></td>" +
      "<td>" + (selClf + inputs || '<span class="ok-txt">sem campo — só revisar</span>') + "</td>" +
      '<td class="col-acoes"><label><input type="checkbox" data-revisado data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '"' + (registro.revisado ? " checked" : "") + '> Revisado</label>' +
      '<label><input type="checkbox" data-excluir data-fonte="' + fonteIdx + '" data-reg="' + regIdx + '"' + (registro.excluido ? " checked" : "") + '> Excluir linha</label></td>' +
      "</tr>";
  }

  function renderTabela() {
    const lista = filteredPendencias();
    const MAX = 500;
    el.querySelector("#sidebarCount").textContent = lista.length.toLocaleString("pt-BR");
    const valorFiltrado = lista.reduce((s, { registro: r }) => {
      const info = lookup.sigtapInfo(sigtapEfetivo(r));
      return s + (info ? info.valor * quantidadeEfetiva(r) : 0);
    }, 0);
    el.querySelector("#sidebarValorPend").textContent = fmtMoeda(valorFiltrado);
    el.querySelector("#tabelaRevisaoBody").innerHTML = lista.slice(0, MAX).map(({ fonteIdx, regIdx, registro, fonte }) =>
      linhaRevisaoHtml(fonteIdx, regIdx, registro, fonte.label || fonte.nome)
    ).join("");
    wireTabelaEventos();

    const filterMsg = el.querySelector("#filterMsg");
    clearMsg(filterMsg);
    if (lista.length === 0) setMsg(filterMsg, "warn", "Nenhuma pendência corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(filterMsg, "warn", lista.length + " pendências encontradas — mostrando as primeiras " + MAX + ".");
  }

  function wireTabelaEventos() {
    el.querySelectorAll("#tabelaRevisaoBody input[data-campo]").forEach((input) => {
      input.addEventListener("input", () => {
        const registro = QBPA.parsed.fontes[+input.dataset.fonte].registros[+input.dataset.reg];
        registro.correcoes = registro.correcoes || {};
        registro.correcoes[input.dataset.campo] = input.value;
      });
    });
    el.querySelectorAll("#tabelaRevisaoBody select[data-srvclf]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const registro = QBPA.parsed.fontes[+sel.dataset.fonte].registros[+sel.dataset.reg];
        registro.correcoes = registro.correcoes || {};
        if (sel.value) {
          registro.correcoes.servico = sel.value.slice(0, 3);
          registro.correcoes.classificacao = sel.value.slice(3);
        } else {
          delete registro.correcoes.servico;
          delete registro.correcoes.classificacao;
        }
        atualizarResumo();
      });
    });
    el.querySelectorAll("#tabelaRevisaoBody input[data-revisado]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const registro = QBPA.parsed.fontes[+chk.dataset.fonte].registros[+chk.dataset.reg];
        registro.revisado = chk.checked;
        chk.closest("tr").classList.toggle("linha-revisada", chk.checked);
        atualizarResumo();
      });
    });
    el.querySelectorAll("#tabelaRevisaoBody input[data-excluir]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const registro = QBPA.parsed.fontes[+chk.dataset.fonte].registros[+chk.dataset.reg];
        registro.excluido = chk.checked;
        chk.closest("tr").classList.toggle("linha-excluida", chk.checked);
        atualizarResumo();
      });
    });
  }

  // -------- render principal --------
  function render() {
    el = document.getElementById("tela-pendencias");

    // preenchimento automático de Serviço/Classificação roda 1x por render,
    // antes de qualquer contagem/cálculo — igual ao Correção BPA original.
    aplicarPreenchimentoServico();
    todasPendencias = calcularTodasPendencias();

    el.innerHTML =
      '<div class="tela-header"><h1>Módulo de pendências</h1><p>Revise inconsistências e gere o arquivo corrigido.</p></div>' +
      '<div class="cards-grid" id="kpiRow">' + kpiCardsHtml() + "</div>" +
      '<div class="drill-layout">' +
        '<aside class="sidebar">' +
          '<div class="sidebar-block">' +
            '<div class="sidebar-title">Resultado</div>' +
            '<div class="sidebar-stat" id="sidebarCount">—</div>' +
            '<div class="sidebar-stat-label">pendência(s) no filtro</div>' +
            '<div class="sidebar-stat sidebar-stat-money is-risco" id="sidebarValorPend">—</div>' +
            '<div class="sidebar-stat-label">valor SIGTAP das pendências filtradas</div>' +
          "</div>" +
          '<div class="sidebar-block">' +
            '<div class="sidebar-title">Filtros</div>' +
            '<div class="field">' +
              '<label for="fTipo">Tipo</label>' +
              '<select id="fTipo">' +
                '<option value="">Todos</option>' +
                '<option value="02">02 · BPA-C</option>' +
                '<option value="03">03 · BPA-I</option>' +
              "</select>" +
            "</div>" +
            '<div class="field">' +
              '<label for="fUnidade">Unidade (CNES)</label>' +
              '<select id="fUnidade"><option value="">Todas</option></select>' +
            "</div>" +
            '<div class="field">' +
              '<label for="fProblema">Tipo de erro/aviso</label>' +
              '<select id="fProblema"><option value="">Todos</option></select>' +
            "</div>" +
            '<div class="field">' +
              '<label for="fSoNaoRevisados"><input type="checkbox" id="fSoNaoRevisados"> Só não revisados</label>' +
            "</div>" +
          "</div>" +
          '<div class="sidebar-block">' +
            '<div class="sidebar-title">Legenda</div>' +
            '<div class="legenda-item"><span class="badge sev-erro">Erro</span> impede envio ao SIA</div>' +
            '<div class="legenda-item"><span class="badge sev-aviso">Aviso</span> revisar antes de enviar</div>' +
          "</div>" +
        "</aside>" +
        '<main class="drill-main">' +
          '<div class="search-row"><input id="fBusca" placeholder="Buscar por paciente, SIGTAP ou CBO..."></div>' +
          '<p class="lead" style="font-size:12.5px;margin:0 0 12px;color:var(--text-dim);">Edite o(s) campo(s) relevante(s), marque "Revisado", ou deixe como está e pule — o registro sai igual no arquivo final.</p>' +
          '<div class="msg" id="filterMsg"></div>' +
          '<div class="tbl-wrap"><table class="preview"><thead><tr>' +
            "<th>Tipo</th><th>Unidade</th><th>Origem</th><th>Data</th><th>SIGTAP</th><th>Qtd.</th><th>Valor (R$)</th><th>CBO</th><th>Paciente</th><th>Problemas</th><th>Correção</th><th>Ações</th>" +
          "</tr></thead><tbody id=\"tabelaRevisaoBody\"></tbody></table></div>" +
        "</main>" +
      "</div>" +
      '<div style="margin-top:26px;text-align:center;">' +
        '<button class="btn btn-teal" id="btnGerarArquivoCorrigido" style="padding:14px 34px;font-size:14px;">Gerar arquivo corrigido →</button>' +
      "</div>";

    popularFiltrosRevisao();
    renderTabela();

    ["fTipo", "fUnidade", "fProblema", "fBusca", "fSoNaoRevisados"].forEach((id) => {
      el.querySelector("#" + id).addEventListener("input", renderTabela);
    });

    el.querySelector("#btnGerarArquivoCorrigido").addEventListener("click", () => QBPA.irPara("arquivo-corrigido"));
  }

  QBPA.telas.pendencias = { render };
})();
