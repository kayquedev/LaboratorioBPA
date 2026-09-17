(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Tela "Configurações" — junta dois formulários que antes viviam em lugares
  // diferentes e difíceis de achar:
  //   1) Estabelecimentos (CNES → nome), que morava dentro do dashboard do
  //      antigo Qualidade BPA sozinho (public/qualidade_bpa/js/app.js).
  //   2) Padrões do município (IBGE / CEP / endereço da Secretaria / serviço
  //      preferencial), que morava na tela de resumo do antigo Correção BPA
  //      (public/correcao_bpa/js/app.js).
  // Pura reorganização de layout/navegação — nenhuma regra de cálculo foi
  // alterada em relação aos dois arquivos originais.
  // ─────────────────────────────────────────────────────────────────────────

  const escapeHtml = QBPA.utils.escapeHtml;

  // ---------- helpers dos "padrões do município" ----------
  // Cópia fiel de public/correcao_bpa/js/app.js. Uma cópia idêntica também
  // existe na tela de Pendências (outro arquivo, feito em paralelo) — a
  // duplicação é intencional pra não acoplar telas independentes via funções
  // privadas compartilhadas (mesmo padrão já tolerado em outras partes deste
  // módulo, ex.: PROBLEMA_CATALOG do writer.js).
  function paresDoProc(sigtap) {
    const lookup = window.QualidadeBpaLookup;
    return (lookup && lookup.servicosDoProcedimento && lookup.servicosDoProcedimento(sigtap)) || null;
  }
  // par (6 díg.) que deve ser gravado numa linha 03 com Serviço/Classificação
  // em branco/inválido: único possível, ou o do serviço preferencial. null =
  // ambíguo, escolher manualmente. `forcar` ignora o checkbox (usado na prévia).
  function parAlvoServico(registro, forcar) {
    const padroes = QBPA.padroes;
    if (registro.tipo !== "03") return null;
    if (!forcar && !padroes.preencherServico) return null;
    const pares = paresDoProc(registro.sigtap);
    if (!pares || !pares.length) return null;
    const atual = (registro.servico || "").trim() + (registro.classificacao || "").trim();
    if (/^\d{6}$/.test(atual) && pares.indexOf(atual) !== -1) return null; // já válido
    const pref = (padroes.servicoPreferencial || "").trim();
    if (pref) {
      const m = pares.filter((p) => p.slice(0, 3) === pref);
      if (m.length === 1) return m[0];
      if (m.length > 1) return null;
    }
    return pares.length === 1 ? pares[0] : null;
  }
  function ibgePadraoOk() { return /^\d{6,7}$/.test((QBPA.padroes.municipioIbge || "").trim()); }
  function cepPadraoOk() {
    const c = (QBPA.padroes.cepTodos || "").trim();
    return /^\d{8}$/.test(c) && !/^0+$/.test(c);
  }
  function secretariaOk() {
    const s = QBPA.padroes.secretaria || {};
    return (s.logradouro || "").trim() !== "" && (s.bairro || "").trim() !== "";
  }
  function parCorrecaoManual(registro) {
    const c = registro.correcoes || {};
    return String(c.servico || "") + String(c.classificacao || "");
  }
  // códigos de pendência que os padrões já resolvem ao gerar o arquivo —
  // usado só pra calcular o texto de impacto/ambiguidade abaixo.
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
  function registrosIncluidos() {
    return (QBPA.parsed.registros || []).filter((r) => !r.excluido);
  }
  function pendenciasComProblema() {
    return (QBPA.parsed.registros || []).filter((r) => r.cods && r.cods.length);
  }

  // ---------- HTML ----------
  // mesma lista de opções do <select id="padTipoLograd"> de public/correcao_bpa/index.html
  const TIPO_LOGRADOURO_OPTIONS = [
    ["081", "Rua"], ["008", "Avenida"], ["086", "Travessa"], ["065", "Praça"],
    ["034", "Estrada"], ["075", "Rodovia"], ["094", "Via"], ["002", "Acesso"],
    ["004", "Área"], ["011", "Beco"], ["019", "Caminho"], ["021", "Chácara"],
    ["029", "Distrito"], ["037", "Fazenda"], ["045", "Jardim"], ["046", "Ladeira"],
    ["049", "Largo"], ["050", "Loteamento"], ["056", "Parque"], ["068", "Quadra"],
    ["072", "Residencial"], ["079", "Setor"], ["082", "Sítio"], ["095", "Vila"],
    ["", "— não informar —"],
  ];

  function estabFormHtml() {
    return (
      '<div class="estab-form-block">' +
        '<div class="sidebar-title">Estabelecimentos (CNES) cadastrados</div>' +
        '<p class="lead" style="margin:0 0 14px;font-size:12.5px;">A tabela SIGTAP não traz o nome dos estabelecimentos — cadastre aqui o nome de cada CNES que aparece nos seus arquivos. Fica salvo neste navegador e é reaproveitado sempre que você importar um arquivo novo.</p>' +
        '<div class="estab-form-row">' +
          '<input id="estabCnesInput" placeholder="CNES (7 dígitos)" maxlength="7">' +
          '<input id="estabNomeInput" placeholder="Nome do estabelecimento">' +
          '<button class="btn btn-ghost-dark" id="btnSalvarEstab">Salvar</button>' +
        "</div>" +
        '<div class="fontes-list" id="estabFormList"></div>' +
      "</div>"
    );
  }

  function padroesFormHtml() {
    const opts = TIPO_LOGRADOURO_OPTIONS.map(([v, l]) =>
      '<option value="' + v + '">' + (v ? v + " — " + l : l) + "</option>"
    ).join("");
    return (
      '<div class="padroes-block">' +
        '<div class="sidebar-title">Padrões do município</div>' +
        '<p class="lead" style="font-size:12.5px;margin:0 0 14px;">' +
          "O <b>código IBGE</b> e o <b>CEP</b> abaixo são gravados em <b>todas</b> as linhas do BPA-I — " +
          "o IBGE quando estiver em branco ou diferente, e o CEP <b>sempre</b> (independe de ter endereço). " +
          "O endereço da Secretaria de Saúde substitui o endereço dos pacientes com " +
          "<b>logradouro ou bairro em branco</b>. Fica salvo neste navegador." +
        "</p>" +
        '<div class="padroes-grid">' +
          '<label class="pcampo"><span>Município — código IBGE (6 díg., sem dígito verificador)</span>' +
            '<input id="padMunicipio" maxlength="7" inputmode="numeric" placeholder="316180"></label>' +
          '<label class="pcampo"><span>CEP — aplicar em TODOS os pacientes</span>' +
            '<input id="padCepTodos" maxlength="8" inputmode="numeric" placeholder="35544000"></label>' +
        "</div>" +
        '<div class="padroes-sub">Endereço padrão — Secretaria de Saúde</div>' +
        '<div class="padroes-grid">' +
          '<label class="pcampo"><span>CEP do endereço da Secretaria (usado só na substituição)</span>' +
            '<input id="padCep" maxlength="8" inputmode="numeric" placeholder="35544000"></label>' +
          '<label class="pcampo"><span>Tipo de logradouro</span><select id="padTipoLograd">' + opts + "</select></label>" +
          '<label class="pcampo pcampo-wide"><span>Logradouro (rua / avenida)</span>' +
            '<input id="padLogradouro" maxlength="30" placeholder="RUA DA SECRETARIA DE SAUDE"></label>' +
          '<label class="pcampo"><span>Número (ou SN)</span><input id="padNumero" maxlength="5" placeholder="SN"></label>' +
          '<label class="pcampo"><span>Complemento (opcional)</span><input id="padComplemento" maxlength="10"></label>' +
          '<label class="pcampo pcampo-wide"><span>Bairro</span><input id="padBairro" maxlength="30" placeholder="CENTRO"></label>' +
        "</div>" +
        '<div class="padroes-sub">Serviço / Classificação (crítica 050)</div>' +
        '<p class="lead" style="font-size:12px;margin:0 0 12px;">' +
          "Procedimentos que exigem Serviço/Classificação e estão em branco: quando houver <b>um único</b> " +
          "par possível, ou um par com o <b>serviço preferencial</b> abaixo, ele é preenchido ao gerar. " +
          "Os ambíguos ficam para escolher na tela de revisão." +
        "</p>" +
        '<div class="padroes-grid">' +
          '<label class="pcampo"><span>Serviço preferencial (código, p/ desambiguar)</span>' +
            '<input id="padServicoPref" maxlength="3" inputmode="numeric" placeholder="126"></label>' +
          '<label class="pcampo pcampo-checkbox"><input type="checkbox" id="padPreencherServico">' +
            "<span>Preencher Serviço/Classificação em branco automaticamente</span></label>" +
        "</div>" +
        '<div id="padroesServicoRef"></div>' +
        '<div class="msg" id="padroesImpacto" style="margin-top:14px;"></div>' +
      "</div>"
    );
  }

  // ---------- Form 1: estabelecimentos (funciona mesmo sem QBPA.parsed) ----------
  function renderEstabFormList(el) {
    const listEl = el.querySelector("#estabFormList");
    const codigos = Object.keys(QBPA.estabelecimentos).sort();
    if (!codigos.length) {
      listEl.innerHTML = '<div class="vazio-estab">Nenhum estabelecimento cadastrado ainda.</div>';
      return;
    }
    listEl.innerHTML = codigos.map((cnes) =>
      '<div class="fonte-row"><div class="fonte-info">' +
        '<span class="fonte-nome">' + escapeHtml(cnes) + "</span>" +
        '<span class="fonte-original">' + escapeHtml(QBPA.estabelecimentos[cnes]) + "</span>" +
      "</div>" +
      '<button class="btn btn-ghost-dark" data-remover-estab="' + escapeHtml(cnes) + '">✕ Remover</button></div>'
    ).join("");
    listEl.querySelectorAll("[data-remover-estab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete QBPA.estabelecimentos[btn.dataset.removerEstab];
        QBPA.utils.salvarEstabelecimentos();
        renderEstabFormList(el);
      });
    });
  }

  function wireEstabForm(el) {
    const cnesInput = el.querySelector("#estabCnesInput");
    const nomeInput = el.querySelector("#estabNomeInput");
    el.querySelector("#btnSalvarEstab").addEventListener("click", () => {
      const cnes = cnesInput.value.trim();
      const nome = nomeInput.value.trim();
      if (!/^\d{7}$/.test(cnes)) { window.alert("Informe um CNES com 7 dígitos."); return; }
      if (!nome) { window.alert("Informe o nome do estabelecimento."); return; }
      QBPA.estabelecimentos[cnes] = nome;
      QBPA.utils.salvarEstabelecimentos();
      cnesInput.value = "";
      nomeInput.value = "";
      renderEstabFormList(el);
    });
    renderEstabFormList(el);
  }

  // ---------- Form 2: padrões do município ----------
  function padInputsFrom(el) {
    return {
      municipioIbge: el.querySelector("#padMunicipio"),
      cepTodos: el.querySelector("#padCepTodos"),
      servicoPref: el.querySelector("#padServicoPref"),
      preencherServico: el.querySelector("#padPreencherServico"),
      cep: el.querySelector("#padCep"),
      tipoLogradouro: el.querySelector("#padTipoLograd"),
      logradouro: el.querySelector("#padLogradouro"),
      numero: el.querySelector("#padNumero"),
      complemento: el.querySelector("#padComplemento"),
      bairro: el.querySelector("#padBairro"),
    };
  }
  function preencherPadroesForm(padInputs) {
    const padroes = QBPA.padroes;
    padInputs.municipioIbge.value = padroes.municipioIbge || "";
    padInputs.cepTodos.value = padroes.cepTodos || "";
    padInputs.servicoPref.value = padroes.servicoPreferencial || "";
    padInputs.preencherServico.checked = !!padroes.preencherServico;
    padInputs.cep.value = padroes.secretaria.cep || "";
    padInputs.tipoLogradouro.value = padroes.secretaria.tipoLogradouro || "";
    padInputs.logradouro.value = padroes.secretaria.logradouro || "";
    padInputs.numero.value = padroes.secretaria.numero || "";
    padInputs.complemento.value = padroes.secretaria.complemento || "";
    padInputs.bairro.value = padroes.secretaria.bairro || "";
  }
  function lerPadroesForm(padInputs) {
    const padroes = QBPA.padroes;
    padroes.municipioIbge = padInputs.municipioIbge.value.replace(/\D/g, "").slice(0, 7);
    padroes.cepTodos = padInputs.cepTodos.value.replace(/\D/g, "").slice(0, 8);
    padroes.servicoPreferencial = padInputs.servicoPref.value.replace(/\D/g, "").slice(0, 3);
    padroes.preencherServico = padInputs.preencherServico.checked;
    padroes.secretaria.cep = padInputs.cep.value.replace(/\D/g, "").slice(0, 8);
    padroes.secretaria.tipoLogradouro = padInputs.tipoLogradouro.value.replace(/\D/g, "").slice(0, 3);
    padroes.secretaria.logradouro = padInputs.logradouro.value.slice(0, 30);
    padroes.secretaria.numero = padInputs.numero.value.slice(0, 5);
    padroes.secretaria.complemento = padInputs.complemento.value.slice(0, 10);
    padroes.secretaria.bairro = padInputs.bairro.value.slice(0, 30);
    QBPA.utils.salvarPadroes();
  }

  function renderImpactoPadroes(el) {
    const writer = window.CorrecaoBpaWriter;
    if (!el || !writer) return;
    const padroes = QBPA.padroes;
    const registros = registrosIncluidos();
    const imp = writer.contarImpactoPadroes(registros, padroes);
    const ibge = (padroes.municipioIbge || "").trim();
    const cepAlvo = (padroes.cepTodos || "").trim();
    const partes = [];
    partes.push(ibgePadraoOk()
      ? "<b>" + imp.municipio + "</b> linha(s) com município ajustado para <b>" + escapeHtml(ibge) + "</b>"
      : "informe o código IBGE do município");
    partes.push(cepPadraoOk()
      ? "<b>" + imp.cep + "</b> linha(s) com CEP forçado para <b>" + escapeHtml(cepAlvo) + "</b>"
      : "informe o CEP a aplicar em todos os pacientes");
    partes.push(secretariaOk()
      ? "<b>" + imp.endereco + "</b> endereço(s) em branco substituído(s) pelo da Secretaria"
      : "preencha logradouro e bairro da Secretaria para cobrir os endereços em branco");
    if (padroes.preencherServico) {
      const autoServico = registros.filter((r) => r.correcoesAuto).length;
      const ambiguos = pendenciasComProblema().filter((r) =>
        (r.cods || []).indexOf("CLASSIFICACAO_INVALIDA") !== -1 &&
        codsResolvidosPorPadroes(r).indexOf("CLASSIFICACAO_INVALIDA") === -1
      ).length;
      partes.push("<b>" + autoServico + "</b> serviço/classificação preenchido(s) automaticamente" +
        (ambiguos ? " · <b>" + ambiguos + "</b> ambíguo(s) para escolher na revisão" : ""));
    }
    el.className = "msg show " + (ibgePadraoOk() && cepPadraoOk() ? "ok" : "warn");
    el.innerHTML = "Ao gerar o arquivo: " + partes.join(" · ") + ".";
  }

  // referência: pra cada procedimento pendente de Serviço/Classificação no
  // arquivo, mostra os pares aceitos e marca qual será preenchido
  function renderPadroesServicoRef(el) {
    if (!el) return;
    const lookup = window.QualidadeBpaLookup;
    const porProc = {};
    pendenciasComProblema().forEach((r) => {
      if ((r.cods || []).indexOf("CLASSIFICACAO_INVALIDA") === -1) return;
      (porProc[r.sigtap] = porProc[r.sigtap] || []).push(r);
    });
    const procs = Object.keys(porProc).sort();
    if (!procs.length) { el.className = ""; el.innerHTML = ""; return; }
    el.className = "padroes-ref";
    el.innerHTML = procs.map((pa) => {
      const pares = paresDoProc(pa) || [];
      const alvo = parAlvoServico(porProc[pa][0], true);
      const paresHtml = pares.map((sc) => {
        const isAlvo = sc === alvo;
        return '<div class="padroes-ref-par' + (isAlvo ? " is-alvo" : "") + '">' +
          '<span class="cod">' + sc.slice(0, 3) + "-" + sc.slice(3) + "</span> · " +
          escapeHtml(lookup.nomeServico(sc.slice(0, 3))) + " / " + escapeHtml(lookup.nomeClassificacao(sc)) +
          (isAlvo ? " — preenchido automaticamente" : "") + "</div>";
      }).join("");
      return '<div class="padroes-ref-item">' +
        '<div class="padroes-ref-proc">' + escapeHtml(pa) + " <small>" + escapeHtml(lookup.nomeSigtap(pa)) + "</small>" +
        " · <small>" + porProc[pa].length + " linha(s) pendente(s)</small></div>" +
        '<div class="padroes-ref-pares">' + paresHtml +
        (!alvo ? '<div class="padroes-ref-par" style="color:var(--amber)">nenhum preenchido automaticamente — escolha na tela de revisão</div>' : "") +
        "</div></div>";
    }).join("");
  }

  // reexecuta só a prévia de impacto desta tela — o preenchimento automático
  // de serviço/classificação nos registros (aplicarPreenchimentoServico) é
  // responsabilidade da tela de Pendências, que roda isso a cada render dela.
  function renderImpactoBlock(el) {
    if (!QBPA.parsed) return; // sem arquivo importado: só os campos do formulário mesmo
    renderImpactoPadroes(el.querySelector("#padroesImpacto"));
    renderPadroesServicoRef(el.querySelector("#padroesServicoRef"));
  }

  function wirePadroesForm(el) {
    const padInputs = padInputsFrom(el);
    preencherPadroesForm(padInputs);

    function onChange() {
      lerPadroesForm(padInputs);
      renderImpactoBlock(el);
    }
    Object.keys(padInputs).forEach((k) => {
      if (!padInputs[k]) return;
      padInputs[k].addEventListener("input", onChange);
      padInputs[k].addEventListener("change", onChange);
    });

    renderImpactoBlock(el);
  }

  function render() {
    const el = document.getElementById("tela-configuracoes");
    el.innerHTML =
      '<div class="tela-header"><h1>Configurações</h1><p>Estabelecimentos (CNES) e padrões do município usados na correção.</p></div>' +
      estabFormHtml() +
      padroesFormHtml();

    wireEstabForm(el);
    wirePadroesForm(el);
  }

  QBPA.telas.configuracoes = { render };
})();
