(function () {
  "use strict";

  const parser = window.QualidadeBpaParser;
  const writer = window.CorrecaoBpaWriter;
  const lookup = window.QualidadeBpaLookup;
  const STORAGE_KEY = "qualidade_bpa_correcao_payload";

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtData(aaaammdd) {
    if (!/^\d{8}$/.test(aaaammdd || "")) return aaaammdd || "";
    return aaaammdd.slice(6, 8) + "/" + aaaammdd.slice(4, 6) + "/" + aaaammdd.slice(0, 4);
  }
  function fmtMoeda(v) {
    return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }
  function cboNome(codigo) { return lookup.nomeCbo(codigo); }
  function sigtapNome(codigo) { return lookup.nomeSigtap(codigo); }
  function cboCelHtml(codigo) {
    const nome = cboNome(codigo);
    return escapeHtml(codigo) + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }
  function sigtapCelHtml(codigo) {
    const nome = sigtapNome(codigo);
    return escapeHtml(codigo) + (nome ? '<span class="sub-nome">' + escapeHtml(nome) + "</span>" : "");
  }
  function progressColor(pct) {
    return pct >= 90 ? "var(--teal)" : pct >= 70 ? "var(--amber)" : "var(--red)";
  }

  const viewVazio = document.getElementById("viewVazio");
  const viewResumo = document.getElementById("viewResumo");
  const viewRevisao = document.getElementById("viewRevisao");
  const viewFinal = document.getElementById("viewFinal");
  const btnVoltarResumo = document.getElementById("btnVoltarResumo");

  function sigtapEfetivo(registro) {
    return (registro.correcoes && registro.correcoes.sigtap) || registro.sigtap;
  }
  function pacienteChave(r) {
    if (r.cnsCpfPaciente) return "cns:" + r.cnsCpfPaciente;
    if (r.cpfPaciente) return "cpf:" + r.cpfPaciente;
    return "nb:" + r.nomePaciente + "|" + r.dataNascimento;
  }

  let payload = null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    payload = raw ? JSON.parse(raw) : null;
  } catch (err) {
    payload = null;
  }

  if (!payload || !payload.fontes || !payload.fontes.length) {
    viewVazio.classList.remove("hidden");
    viewResumo.classList.add("hidden");
    return;
  }

  viewVazio.classList.add("hidden");

  const autoResolvidos = payload.autoResolvidos || 0;

  // decodifica cada linha bruta com o mesmo parser do Qualidade BPA (dá
  // acesso a todos os campos - SIGTAP, CBO, data, CNES, paciente etc. - sem
  // precisar levar nada disso no payload), e aplica por cima os codigos de
  // pendencia (por indice) que vieram do handoff.
  function hidratarFonte(fonte) {
    const pendMap = {};
    (fonte.pendencias || []).forEach((p) => { pendMap[p.idx] = p; });
    const registros = (fonte.linhas || []).map((linha, idx) => {
      const tipo = linha.slice(0, 2);
      const registro = tipo === "03" ? parser.parseTipo03(linha) : parser.parseTipo02(linha);
      registro.idx = idx;
      const pend = pendMap[idx];
      if (pend) registro.cods = pend.cods;
      return registro;
    });
    return { nome: fonte.nome, label: fonte.label, header: fonte.header, registros };
  }

  const fontes = payload.fontes.map(hidratarFonte);

  function pendenciasFlat() {
    const lista = [];
    fontes.forEach((fonte, fonteIdx) => {
      fonte.registros.forEach((registro, regIdx) => {
        if (registro.cods && registro.cods.length) lista.push({ fonte, fonteIdx, regIdx, registro });
      });
    });
    return lista;
  }
  const todasPendencias = pendenciasFlat();

  // -------- padrões do município (IBGE único + endereço da Secretaria) --------
  const PADROES_KEY = "correcao_bpa_padroes_municipio";
  const PADROES_DEFAULT = {
    municipioIbge: "316180",
    cepTodos: "35544000",
    servicoPreferencial: "126",
    preencherServico: true,
    secretaria: { cep: "", tipoLogradouro: "081", logradouro: "", numero: "", complemento: "", bairro: "" },
  };
  function carregarPadroes() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(PADROES_KEY) || "null");
      if (raw && typeof raw === "object") {
        return {
          municipioIbge: typeof raw.municipioIbge === "string" ? raw.municipioIbge : PADROES_DEFAULT.municipioIbge,
          cepTodos: typeof raw.cepTodos === "string" ? raw.cepTodos : PADROES_DEFAULT.cepTodos,
          servicoPreferencial: typeof raw.servicoPreferencial === "string" ? raw.servicoPreferencial : PADROES_DEFAULT.servicoPreferencial,
          preencherServico: typeof raw.preencherServico === "boolean" ? raw.preencherServico : PADROES_DEFAULT.preencherServico,
          secretaria: Object.assign({}, PADROES_DEFAULT.secretaria, raw.secretaria || {}),
        };
      }
    } catch (e) { /* localStorage indisponível ou JSON inválido */ }
    return JSON.parse(JSON.stringify(PADROES_DEFAULT));
  }
  function salvarPadroes() {
    try { window.localStorage.setItem(PADROES_KEY, JSON.stringify(padroes)); } catch (e) { /* ignore */ }
  }
  let padroes = carregarPadroes();

  const padInputs = {
    municipioIbge: document.getElementById("padMunicipio"),
    cepTodos: document.getElementById("padCepTodos"),
    servicoPref: document.getElementById("padServicoPref"),
    preencherServico: document.getElementById("padPreencherServico"),
    cep: document.getElementById("padCep"),
    tipoLogradouro: document.getElementById("padTipoLograd"),
    logradouro: document.getElementById("padLogradouro"),
    numero: document.getElementById("padNumero"),
    complemento: document.getElementById("padComplemento"),
    bairro: document.getElementById("padBairro"),
  };
  function preencherPadroesForm() {
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
  function lerPadroesForm() {
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
    salvarPadroes();
    aplicarPreenchimentoServico();
    recalcularComPadroes();
  }
  Object.keys(padInputs).forEach((k) => {
    if (!padInputs[k]) return;
    padInputs[k].addEventListener("input", lerPadroesForm);
    padInputs[k].addEventListener("change", lerPadroesForm);
  });

  function registrosIncluidosFlat() {
    const arr = [];
    fontes.forEach((f) => f.registros.forEach((r) => { if (!r.excluido) arr.push(r); }));
    return arr;
  }
  function ibgePadraoOk() { return /^\d{6,7}$/.test((padroes.municipioIbge || "").trim()); }
  function cepPadraoOk() {
    const c = (padroes.cepTodos || "").trim();
    return /^\d{8}$/.test(c) && !/^0+$/.test(c);
  }
  function secretariaOk() {
    return (padroes.secretaria.logradouro || "").trim() !== "" && (padroes.secretaria.bairro || "").trim() !== "";
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
  function aplicarPreenchimentoServico() {
    fontes.forEach((f) => f.registros.forEach((r) => {
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
  function renderImpactoPadroes() {
    const el = document.getElementById("padroesImpacto");
    if (!el) return;
    const imp = writer.contarImpactoPadroes(registrosIncluidosFlat(), padroes);
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
      const autoServico = registrosIncluidosFlat().filter((r) => r.correcoesAuto).length;
      const ambiguos = todasPendencias.filter((p) =>
        (p.registro.cods || []).indexOf("CLASSIFICACAO_INVALIDA") !== -1 &&
        codsResolvidosPorPadroes(p.registro).indexOf("CLASSIFICACAO_INVALIDA") === -1
      ).length;
      partes.push("<b>" + autoServico + "</b> serviço/classificação preenchido(s) automaticamente" +
        (ambiguos ? " · <b>" + ambiguos + "</b> ambíguo(s) para escolher na revisão" : ""));
    }
    el.className = "msg show " + (ibgePadraoOk() && cepPadraoOk() ? "ok" : "warn");
    el.innerHTML = "Ao gerar o arquivo: " + partes.join(" · ") + ".";
  }
  // referência: pra cada procedimento pendente de Serviço/Classificação no
  // arquivo, mostra os pares aceitos e marca qual será preenchido
  function renderPadroesServicoRef() {
    const el = document.getElementById("padroesServicoRef");
    if (!el) return;
    const porProc = {};
    todasPendencias.forEach((p) => {
      const r = p.registro;
      if ((r.cods || []).indexOf("CLASSIFICACAO_INVALIDA") === -1) return;
      (porProc[r.sigtap] = porProc[r.sigtap] || []).push(r);
    });
    const procs = Object.keys(porProc).sort();
    if (!procs.length) { el.innerHTML = ""; return; }
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
  function recalcularComPadroes() {
    renderImpactoPadroes();
    renderPadroesServicoRef();
    renderResumo();
    atualizarFaturamentos();
    if (!viewRevisao.classList.contains("hidden")) renderTabela();
  }

  // -------- resumo geral --------
  function renderResumo() {
    const totalComProblema = autoResolvidos + todasPendencias.length;
    const el = document.getElementById("resumoBox");
    if (!totalComProblema) {
      el.className = "alert-banner show ok";
      el.innerHTML = "<b>Nenhuma pendência encontrada.</b> Folha/sequência já renumerada e conferida para " +
        fontes.length + " arquivo(s) — pode baixar direto.";
    } else {
      const cobertas = todasPendencias.filter((p) => !temPendenciaAtiva(p.registro)).length;
      el.className = "alert-banner show";
      el.innerHTML = "<b>" + totalComProblema + " registro(s) com pendência</b> em " + fontes.length + " arquivo(s). " +
        "<b>" + autoResolvidos + "</b> resolvido(s) automaticamente (renumeração de folha/sequência). " +
        (cobertas ? "<b>" + cobertas + "</b> cobertos pelos padrões (município / CEP / endereço da Secretaria). " : "") +
        "<b>" + (todasPendencias.length - cobertas) + "</b> ainda precisa(m) de revisão manual — corrija ou deixe como está (pular).";
    }

    const btnVer = document.getElementById("btnVerPendencias");
    if (todasPendencias.length) btnVer.classList.remove("hidden"); else btnVer.classList.add("hidden");
  }

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

  // -------- faturamento (recalcula a cada correcao/revisao) --------
  // "pendente" so conta registros com pendencia AINDA nao revisada/corrigida/
  // excluida; "receber" e tudo o resto (sempre limpos, auto-resolvidos, e
  // pendencias ja tratadas) - mesma logica do Qualidade BPA. Usa o SIGTAP
  // ja corrigido (se houver) pra refletir o valor real que vai sair no
  // arquivo final.
  function calcularFaturamento() {
    let total = 0, pendente = 0;
    fontes.forEach((fonte) => fonte.registros.forEach((r) => {
      if (r.excluido) return;
      const info = lookup.sigtapInfo(sigtapEfetivo(r));
      if (!info) return;
      const valor = info.valor * (r.quantidade || 0);
      total += valor;
      if (temPendenciaAtiva(r)) pendente += valor;
    }));
    return { total, pendente, receber: total - pendente };
  }

  function cardHtml(opts) {
    const badge = opts.badge !== undefined ? opts.badge : "";
    const bar = opts.pct != null
      ? '<div class="bar-track"><div class="bar-fill" style="width:' + opts.pct + '%;background:' + (opts.barColor || progressColor(opts.pct)) + '"></div></div>'
      : "";
    return '<div class="ind-card"><div class="ind-card-top">' + badge + "</div>" +
      '<div class="valor" style="' + (opts.corValor ? "color:" + opts.corValor : "") + '">' + opts.valor + "</div>" +
      '<div class="titulo">' + opts.titulo + "</div>" +
      '<div class="desc">' + opts.desc + "</div>" + bar + "</div>";
  }

  // painel simplificado no resumo: so % sem problema + valor em risco
  function renderFaturamento() {
    const totalRegistros = fontes.reduce((s, f) => s + f.registros.length, 0);
    const pendentesAtivas = todasPendencias.reduce((n, p) => n + (temPendenciaAtiva(p.registro) ? 1 : 0), 0);
    const semProblemas = totalRegistros - pendentesAtivas;
    const pct = totalRegistros ? Math.round((semProblemas / totalRegistros) * 100) : 100;
    const f = calcularFaturamento();

    const cards = [
      {
        valor: pct + '<span class="un">%</span>', titulo: "Registros sem problemas",
        desc: semProblemas + " de " + totalRegistros + " registro(s) sem pendência (já considerando o que foi resolvido automaticamente).",
        pct, badge: "",
      },
      {
        valor: fmtMoeda(f.pendente), titulo: "Valor faturamento em risco",
        desc: "Soma do valor SIGTAP das pendências ainda não revisadas — o que ainda pode causar rejeição/glosa se for enviado assim.",
        corValor: "var(--red)", badge: "",
      },
    ];
    document.getElementById("cardsFaturamento").innerHTML = cards.map(cardHtml).join("");
  }

  // painel rico, mostrado no "painel final" antes de gerar o arquivo -
  // mesmos 3 nomes/nomenclatura do Qualidade BPA, pra ficar familiar
  function renderFaturamentoFinal() {
    const f = calcularFaturamento();
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
    document.getElementById("cardsFaturamentoFinal").innerHTML = cards.map(cardHtml).join("");
  }

  // -------- resumo/estatisticas do painel final (ja descontando exclusoes) --------
  function renderSummaryFinal() {
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
    document.getElementById("summaryRowFinal").innerHTML = stats.map(
      ([l, n]) => '<div class="stat-box"><div class="l">' + l + '</div><div class="n">' + n + "</div></div>"
    ).join("");
  }

  // -------- setores com producao esperada (mesmos indicadores do Qualidade BPA) --------
  const SETOR_INDICADORES = {
    "Laboratório": ["0202020380"],
    "Pronto Atendimento": ["0301060096"],
    "Especialidades": ["0301010072", "0301010048"],
    "Fisioterapia": ["0302050027"],
    "TFD (transporte)": ["0803010125", "0803010109"],
  };
  function renderSetoresFinal() {
    const codigosPresentes = new Set();
    fontes.forEach((fonte) => fonte.registros.forEach((r) => { if (!r.excluido) codigosPresentes.add(sigtapEfetivo(r)); }));
    const html = Object.entries(SETOR_INDICADORES).map(([nome, codigos]) => {
      const importado = codigos.some((c) => codigosPresentes.has(c));
      return '<span class="badge ' + (importado ? "b-ok" : "sev-erro") + '" style="margin-right:8px;">' +
        (importado ? "✓" : "✗") + " " + escapeHtml(nome) + "</span>";
    }).join(" ");
    document.getElementById("setoresResumoFinal").innerHTML = html;
  }

  // -------- filtros / tabela de revisao (view clara) --------
  const fTipo = document.getElementById("fTipo");
  const fOrigem = document.getElementById("fOrigem");
  const fUnidade = document.getElementById("fUnidade");
  const fProblema = document.getElementById("fProblema");
  const fBusca = document.getElementById("fBusca");
  const fSoNaoRevisados = document.getElementById("fSoNaoRevisados");
  const campoOrigem = document.getElementById("campoOrigem");
  const filterMsg = document.getElementById("filterMsg");

  function popularFiltrosRevisao() {
    if (fontes.length > 1) {
      campoOrigem.classList.remove("hidden");
      const origens = [...new Set(fontes.map((f) => f.label || f.nome))];
      fOrigem.innerHTML = '<option value="">Todas</option>' + origens.map((o) => '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + "</option>").join("");
    }

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
    const tipo = fTipo.value, origem = fOrigem.value, unidade = fUnidade.value, problema = fProblema.value;
    const busca = fBusca.value.trim().toLowerCase();
    const soNaoRevisados = fSoNaoRevisados.checked;

    return todasPendencias.filter(({ fonte, registro }) => {
      if (tipo && registro.tipo !== tipo) return false;
      if (origem && (fonte.label || fonte.nome) !== origem) return false;
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
    const valorHtml = infoSigtap ? fmtMoeda(infoSigtap.valor * (registro.quantidade || 0)) : "—";

    return '<tr data-linha-fonte="' + fonteIdx + '" data-linha-reg="' + regIdx + '">' +
      "<td>" + registro.tipo + "</td>" +
      "<td>" + escapeHtml(registro.cnes) + "</td>" +
      "<td>" + escapeHtml(origemLabel) + "</td>" +
      "<td>" + (registro.tipo === "03" ? fmtData(registro.dataAtendimento) : "—") + "</td>" +
      '<td class="num">' + sigtapCelHtml(registro.sigtap) + "</td>" +
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
    document.getElementById("sidebarCount").textContent = lista.length.toLocaleString("pt-BR");
    const valorFiltrado = lista.reduce((s, { registro: r }) => {
      const info = lookup.sigtapInfo(sigtapEfetivo(r));
      return s + (info ? info.valor * (r.quantidade || 0) : 0);
    }, 0);
    document.getElementById("sidebarValorPend").textContent = fmtMoeda(valorFiltrado);
    document.getElementById("tabelaRevisaoBody").innerHTML = lista.slice(0, MAX).map(({ fonteIdx, regIdx, registro, fonte }) =>
      linhaRevisaoHtml(fonteIdx, regIdx, registro, fonte.label || fonte.nome)
    ).join("");
    wireTabelaEventos();

    clearMsg(filterMsg);
    if (lista.length === 0) setMsg(filterMsg, "warn", "Nenhuma pendência corresponde aos filtros aplicados.");
    else if (lista.length > MAX) setMsg(filterMsg, "warn", lista.length + " pendências encontradas — mostrando as primeiras " + MAX + ".");
  }
  [fTipo, fOrigem, fUnidade, fProblema, fBusca, fSoNaoRevisados].forEach((el) => el.addEventListener("input", renderTabela));

  function wireTabelaEventos() {
    document.querySelectorAll("#tabelaRevisaoBody input[data-campo]").forEach((input) => {
      input.addEventListener("input", () => {
        const registro = fontes[+input.dataset.fonte].registros[+input.dataset.reg];
        registro.correcoes = registro.correcoes || {};
        registro.correcoes[input.dataset.campo] = input.value;
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody select[data-srvclf]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const registro = fontes[+sel.dataset.fonte].registros[+sel.dataset.reg];
        registro.correcoes = registro.correcoes || {};
        if (sel.value) {
          registro.correcoes.servico = sel.value.slice(0, 3);
          registro.correcoes.classificacao = sel.value.slice(3);
        } else {
          delete registro.correcoes.servico;
          delete registro.correcoes.classificacao;
        }
        atualizarFaturamentos();
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody input[data-revisado]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const registro = fontes[+chk.dataset.fonte].registros[+chk.dataset.reg];
        registro.revisado = chk.checked;
        chk.closest("tr").classList.toggle("linha-revisada", chk.checked);
        atualizarFaturamentos();
      });
    });
    document.querySelectorAll("#tabelaRevisaoBody input[data-excluir]").forEach((chk) => {
      chk.addEventListener("change", () => {
        const registro = fontes[+chk.dataset.fonte].registros[+chk.dataset.reg];
        registro.excluido = chk.checked;
        chk.closest("tr").classList.toggle("linha-excluida", chk.checked);
        atualizarFaturamentos();
      });
    });
  }
  function atualizarFaturamentos() {
    renderFaturamento();
    renderFaturamentoFinal();
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
        const out = writer.montarArquivo(fonte, padroes);
        if (out.avisos && out.avisos.length) window.alert(out.avisos.join("\n\n"));
        baixarTexto(nomeCorrigido(fonte.nome), out.texto);
      });
    });
    const btnUnico = document.getElementById("btnBaixarUnico");
    if (btnUnico) {
      btnUnico.addEventListener("click", () => {
        const out = writer.montarArquivoUnico(fontes, padroes);
        if (out.avisos && out.avisos.length) window.alert(out.avisos.join("\n\n"));
        baixarTexto("bpa_corrigido_unico.txt", out.texto);
      });
    }
  }

  // -------- navegacao entre as 3 views --------
  function showResumo() {
    viewResumo.classList.remove("hidden");
    viewRevisao.classList.add("hidden");
    viewFinal.classList.add("hidden");
    btnVoltarResumo.classList.add("hidden");
    renderFaturamento();
  }
  function showRevisao() {
    viewResumo.classList.add("hidden");
    viewRevisao.classList.remove("hidden");
    viewFinal.classList.add("hidden");
    btnVoltarResumo.classList.remove("hidden");
    popularFiltrosRevisao();
    renderTabela();
  }
  function showFinal() {
    viewResumo.classList.add("hidden");
    viewRevisao.classList.add("hidden");
    viewFinal.classList.remove("hidden");
    btnVoltarResumo.classList.remove("hidden");
    renderSummaryFinal();
    renderFaturamentoFinal();
    renderSetoresFinal();
  }
  document.getElementById("btnVerPendencias").addEventListener("click", showRevisao);
  document.getElementById("btnIrParaFinal").addEventListener("click", showFinal);
  document.getElementById("btnIrParaFinalRevisao").addEventListener("click", showFinal);
  btnVoltarResumo.addEventListener("click", showResumo);

  lookup.ready.finally(() => {
    preencherPadroesForm();
    aplicarPreenchimentoServico();
    renderImpactoPadroes();
    renderPadroesServicoRef();
    renderResumo();
    renderFontes();
    renderFaturamento();
    renderDownloads();
    showResumo();
  });

})();
