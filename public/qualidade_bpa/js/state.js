(function (root) {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // Estado e utilitários compartilhados entre TODAS as telas do módulo
  // Qualidade BPA (unificação com o antigo Correção BPA). Nenhuma regra de
  // negócio aqui foi alterada em relação aos dois módulos originais — só
  // reunida num só lugar pra não duplicar entre telas.
  //
  // window.QBPA = {
  //   parsed,            // { fontes:[{nome,label,header,registros}], registros } | null
  //   padroes,           // padrões do município (localStorage) — ver PADROES_DEFAULT
  //   estabelecimentos,  // { "2160390": "Nome do posto" } (localStorage)
  //   navPreset,         // preset de filtro pra tela de destino de irPara() — consumido 1x
  //   telas: {},         // cada tela registra { render() } aqui — ver contrato no fim
  //   utils: {...}, PROBLEMA_CATALOG, SETOR_INDICADORES,
  //   avaliarTodos(), processarArquivos(fileList, modo), irPara(nome, opcoes),
  // }
  // ─────────────────────────────────────────────────────────────────────────

  const parser = root.QualidadeBpaParser;
  const lookup = root.QualidadeBpaLookup;

  const QBPA = {
    parsed: null,
    padroes: null,
    estabelecimentos: null,
    navPreset: null,
    telas: {},
  };

  // ---------- formatação / texto ----------
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
    if (r.cnsCpfPaciente) return "cns:" + r.cnsCpfPaciente;
    if (r.cpfPaciente) return "cpf:" + r.cpfPaciente;
    return "nb:" + r.nomePaciente + "|" + r.dataNascimento;
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
  function setMsg(el, type, text) { el.className = "msg show " + type; el.textContent = text; }
  function clearMsg(el) { el.className = "msg"; el.textContent = ""; }

  // dígito verificador do procedimento SIGTAP: 10º dígito = (Σ dᵢ·i, i=1..9) mod 11
  // (resto 10 vira 0). É a mesma checagem da crítica 003 do BPA Magnético.
  function sigtapDvOk(codigo) {
    if (!/^\d{10}$/.test(codigo)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += (+codigo[i]) * (i + 1);
    const dv = soma % 11;
    return (dv === 10 ? 0 : dv) === +codigo[9];
  }
  // CPF: 11 dígitos + 2 verificadores (mod 11). Rejeita sequências repetidas.
  function cpfDvOk(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    let s = 0;
    for (let i = 0; i < 9; i++) s += (+cpf[i]) * (10 - i);
    let d1 = 11 - (s % 11); if (d1 >= 10) d1 = 0;
    if (d1 !== +cpf[9]) return false;
    s = 0;
    for (let i = 0; i < 10; i++) s += (+cpf[i]) * (11 - i);
    let d2 = 11 - (s % 11); if (d2 >= 10) d2 = 0;
    return d2 === +cpf[10];
  }
  // CNS: 15 dígitos. Começando por 1/2 é definitivo (base PIS + 4 de controle);
  // começando por 7/8/9 é provisório (Σ dᵢ·(15-i) divisível por 11).
  function cnsDvOk(cns) {
    if (!/^\d{15}$/.test(cns)) return false;
    const p = +cns[0];
    if (p === 1 || p === 2) {
      let soma = 0;
      for (let i = 0; i < 11; i++) soma += (+cns[i]) * (15 - i);
      let resto = soma % 11;
      let dv = 11 - resto; if (dv === 11) dv = 0;
      let resultado;
      if (dv === 10) {
        soma += 2; resto = soma % 11; dv = 11 - resto;
        resultado = cns.slice(0, 11) + "001" + dv;
      } else {
        resultado = cns.slice(0, 11) + "000" + dv;
      }
      return resultado === cns;
    }
    if (p === 7 || p === 8 || p === 9) {
      let soma = 0;
      for (let i = 0; i < 15; i++) soma += (+cns[i]) * (15 - i);
      return soma % 11 === 0;
    }
    return false;
  }
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
  // card padrão (KPI/faturamento) usado em quase toda tela — opts.onClick
  // gera um <a data-card="id"> clicável (quem renderiza a tela liga o
  // listener depois de injetar o HTML, igual já era feito antes).
  function cardHtml(opts) {
    const badge = opts.badge !== undefined ? opts.badge : '<span class="badge b-ok">Dado real</span>';
    const bar = opts.pct != null
      ? '<div class="bar-track"><div class="bar-fill" style="width:' + opts.pct + '%;background:' + (opts.barColor || progressColor(opts.pct)) + '"></div></div>'
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

  // ---------- catálogo de problemas (o que é / como resolver) — cópia canônica,
  // igual à que existia em qualidade_bpa/js/app.js (29 códigos). O writer.js
  // (copiado do Correção BPA) tem sua própria cópia, com 27 códigos — mantida
  // como estava lá, sem sincronizar aqui (ver observação no plano). ----------
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
    CBO_NAO_PERMITIDO: { sev: "erro", texto: "Procedimento não permitido para o CBO",
      explicacao: "A tabela SIGTAP (rl_procedimento_ocupacao) não habilita esse CBO a executar este procedimento. O BPA Magnético recusa a linha (crítica 004 — proced. não permitido p/CBO).",
      resolver: "Confira o CBO do profissional que executou o procedimento, ou se o código SIGTAP lançado é mesmo o que esse profissional realizou." },
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
    CEP_INVALIDO: { sev: "erro", texto: "CEP inválido",
      explicacao: "O CEP do paciente não tem 8 dígitos, está zerado, ou falta quando há endereço. O BPA Magnético ainda cruza o CEP com o município na base dos Correios e recusa a linha (crítica 053) se não conferir.",
      resolver: "Confira o CEP no cadastro do paciente e confirme que ele pertence mesmo à cidade informada." },
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
    SIGTAP_NAO_ENCONTRADO: { sev: "erro", texto: "Procedimento não existe na tabela SIGTAP",
      explicacao: "O código tem formato e dígito verificador válidos, mas não consta na tabela SIGTAP deste módulo. O BPA Magnético rejeita o arquivo inteiro quando o procedimento não existe na competência de envio (crítica 003).",
      resolver: "Confira o código do procedimento no SIGTAP oficial da competência. Se você carregou aqui uma competência diferente da do arquivo, valide direto no SIGTAP antes de confiar neste alerta." },
    SIGTAP_DV_INVALIDO: { sev: "erro", texto: "Dígito verificador do procedimento incorreto",
      explicacao: "O 10º dígito do código SIGTAP (verificador, módulo 11) não confere com os 9 primeiros — o código foi digitado errado, truncado ou deslocado. Equivale à crítica 003 do BPA Magnético.",
      resolver: "Confira o código completo do procedimento no SIGTAP e corrija a linha (10 dígitos, incluindo o dígito verificador)." },
    MUNICIPIO_INVALIDO: { sev: "erro", texto: "Município de residência não informado / inválido",
      explicacao: "O código IBGE do município do paciente está em branco, zerado ou não tem 6–7 dígitos. O BPA Magnético recusa a linha (crítica 024 — município não cadastrado).",
      resolver: "Preencha o código IBGE do município de residência do paciente (6 dígitos, sem o dígito verificador) no cadastro/sistema de origem." },
    ENDERECO_INVALIDO: { sev: "erro", texto: "Endereço do paciente inválido",
      explicacao: "O logradouro (rua/endereço) do paciente está em branco na linha do BPA-I. O BPA Magnético recusa a linha (crítica 054 — endereço inválido).",
      resolver: "Preencha logradouro, número (ou 'SN' quando não houver) e bairro do paciente no cadastro/sistema de origem." },
    CLASSIFICACAO_INVALIDA: { sev: "erro", texto: "Serviço/Classificação inválido para o procedimento",
      explicacao: "O procedimento exige um par Serviço/Classificação específico (tabela SIGTAP) e o informado na linha está em branco ou não é um dos aceitos. O BPA Magnético recusa a linha (crítica 050 — classificação inválida).",
      resolver: "Ajuste os campos Serviço e Classificação da linha para um par válido do procedimento." },
    PACIENTE_SEM_IDENTIFICACAO: { sev: "erro", texto: "Paciente sem CNS nem CPF",
      explicacao: "A linha do BPA-I não traz CNS nem CPF do paciente. O BPA Magnético exige identificação do paciente no BPA-I.",
      resolver: "Informe o CNS (15 dígitos) ou o CPF do paciente." },
    PROCEDIMENTO_EXIGE_CNS: { sev: "erro", texto: "Procedimento exige CNS/CPF do paciente",
      explicacao: "Este procedimento está marcado na tabela SIGTAP como \"Exige CPF/CNS\" (detalhe 009) e a linha não traz nem CNS nem CPF do paciente. O BPA Magnético recusa a linha (críticas 025 — procedimento exige CNS / 060 — CNS obrigatório).",
      resolver: "Informe o CNS (15 dígitos) do paciente; para estes procedimentos o CPF também é aceito." },
    CNS_PACIENTE_INVALIDO: { sev: "aviso", texto: "CNS do paciente com dígito verificador inválido",
      explicacao: "O CNS informado para o paciente não passa na validação de dígito verificador — provavelmente foi digitado errado.",
      resolver: "Confira o CNS do paciente (15 dígitos) no CADSUS e corrija no cadastro." },
    CPF_PACIENTE_INVALIDO: { sev: "aviso", texto: "CPF do paciente inválido",
      explicacao: "O CPF informado para o paciente não passa na validação de dígito verificador.",
      resolver: "Confira o CPF do paciente no cadastro e corrija." },
    CNS_PROFISSIONAL_AUSENTE: { sev: "erro", texto: "CNS do profissional não informado",
      explicacao: "A linha do BPA-I não traz o CNS do profissional executante (15 dígitos). O BPA Magnético recusa a linha.",
      resolver: "Cadastre/importe o CNS do profissional responsável pelo atendimento no sistema de origem." },
    CNS_PROFISSIONAL_INVALIDO: { sev: "aviso", texto: "CNS do profissional com dígito verificador inválido",
      explicacao: "O CNS do profissional executante não passa na validação de dígito verificador.",
      resolver: "Confira o CNS do profissional no CNES/CADSUS." },
    CARATER_ATENDIMENTO_AUSENTE: { sev: "aviso", texto: "Caráter do atendimento não informado",
      explicacao: "O caráter do atendimento (01 = eletivo, 02 = urgência) está em branco na linha do BPA-I.",
      resolver: "Preencha o caráter do atendimento no sistema de origem." },
    RACA_COR_AUSENTE: { sev: "aviso", texto: "Raça/cor não informada",
      explicacao: "O campo raça/cor do paciente está em branco na linha do BPA-I.",
      resolver: "Preencha a raça/cor do paciente (01 branca, 02 preta, 03 parda, 04 amarela, 05 indígena, 99 sem informação)." },
    NACIONALIDADE_AUSENTE: { sev: "aviso", texto: "Nacionalidade não informada",
      explicacao: "O campo nacionalidade do paciente está em branco na linha do BPA-I.",
      resolver: "Preencha a nacionalidade do paciente (010 = brasileira) no sistema de origem." },
  };

  // ---------- setores (checagem por procedimento indicador) ----------
  const SETOR_INDICADORES = {
    "Laboratório": ["0202020380"],
    "Pronto Atendimento": ["0301060096"],
    "Especialidades": ["0301010072", "0301010048"],
    "Fisioterapia": ["0302050027"],
    "TFD (transporte)": ["0803010125", "0803010109"],
  };

  // ---------- estabelecimentos (CNES -> nome, cadastrado manualmente) ----------
  const ESTAB_STORAGE_KEY = "qualidade_bpa_estabelecimentos";
  function carregarEstabelecimentos() {
    try { return JSON.parse(window.localStorage.getItem(ESTAB_STORAGE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function salvarEstabelecimentos() {
    try { window.localStorage.setItem(ESTAB_STORAGE_KEY, JSON.stringify(QBPA.estabelecimentos)); } catch (e) { /* localStorage indisponível */ }
  }
  QBPA.estabelecimentos = carregarEstabelecimentos();
  function nomeEstabelecimento(cnes) { return QBPA.estabelecimentos[cnes] || ""; }

  // ---------- padrões do município (mesma chave/formato que o Correção BPA usava) ----------
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
    try { window.localStorage.setItem(PADROES_KEY, JSON.stringify(QBPA.padroes)); } catch (e) { /* ignore */ }
  }
  QBPA.padroes = carregarPadroes();

  // ---------- checagem de cabeçalho (numLinhas/numFolhas declarados x reais) ----------
  function checarCabecalho(fonte) {
    if (!fonte.header) return null;
    const distinctFolhas = new Set(fonte.registros.map((r) => r.tipo + "|" + r.cnes + "|" + r.folha)).size;
    const linhasOk = fonte.header.numLinhas === fonte.registros.length;
    const folhasOk = fonte.header.numFolhas === distinctFolhas;
    return { linhasOk, folhasOk, distinctFolhas, ok: linhasOk && folhasOk };
  }

  // ---------- avaliação de qualidade (motor de regras completo) ----------
  // Copiado sem NENHUMA alteração de lógica de public/qualidade_bpa/js/app.js.
  // A única adição é, no fim, popular `r.cods` (array de strings) a partir de
  // `r.problemas` (array de objetos do catálogo) — conveniência pra reusar o
  // writer.js do Correção BPA, que sempre trabalhou com `registro.cods`.
  function avaliarTodos() {
    const parsed = QBPA.parsed;
    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const dupCount = {};
    parsed.registros.filter((r) => r.tipo === "03").forEach((r) => {
      const k = pacienteChave(r) + "|" + r.sigtap + "|" + r.dataAtendimento;
      dupCount[k] = (dupCount[k] || 0) + 1;
    });

    parsed.fontes.forEach((fonte) => {
      const header = fonte.header;
      const folhaSeqChave = (r) => r.tipo + "/" + r.cnes + "/" + r.folha + "/" + r.seq;
      const folhaSeqCount = {};
      fonte.registros.forEach((r) => { const k = folhaSeqChave(r); folhaSeqCount[k] = (folhaSeqCount[k] || 0) + 1; });

      fonte.registros.forEach((r) => {
        const codigos = [];
        const sigtapValido = /^\d{10}$/.test(r.sigtap) && !/^0+$/.test(r.sigtap);
        if (!sigtapValido) codigos.push("SIGTAP_INVALIDO");
        if ((r.quantidade || 0) <= 0) codigos.push("QUANTIDADE_INVALIDA");
        if (!/^\d{6}$/.test(r.cbo)) codigos.push("CBO_INVALIDO");
        if (header && r.competencia !== header.competencia) codigos.push("COMPETENCIA_DIVERGENTE");
        if (folhaSeqCount[folhaSeqChave(r)] > 1) codigos.push("FOLHA_SEQ_DUPLICADA");

        const dvSigtapOk = sigtapValido && sigtapDvOk(r.sigtap);
        if (sigtapValido && !dvSigtapOk) codigos.push("SIGTAP_DV_INVALIDO");
        const info = sigtapValido && lookup ? lookup.sigtapInfo(r.sigtap) : null;
        if (sigtapValido && dvSigtapOk && !info) codigos.push("SIGTAP_NAO_ENCONTRADO");

        // CBO x procedimento (rl_procedimento_ocupacao) — crítica 004.
        if (sigtapValido && /^\d{6}$/.test(r.cbo) && lookup && lookup.cbosDoProcedimento) {
          const cbosPermitidos = lookup.cbosDoProcedimento(r.sigtap);
          if (cbosPermitidos && cbosPermitidos.length && cbosPermitidos.indexOf(r.cbo) === -1) {
            codigos.push("CBO_NAO_PERMITIDO");
          }
        }
        if (info) {
          const registroEsperado = r.tipo === "02" ? "01" : r.tipo === "03" ? "02" : null;
          if (registroEsperado && info.registros.length && info.registros.indexOf(registroEsperado) === -1) {
            codigos.push("REGISTRO_INCOMPATIVEL");
          }
        }

        let permitidosSrv = null;
        if (r.tipo === "03") {
          if (/^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento.slice(0, 6) !== r.competencia) codigos.push("DATA_FORA_COMPETENCIA");
          if (/^\d{8}$/.test(r.dataAtendimento) && r.dataAtendimento > hoje) codigos.push("DATA_ATENDIMENTO_FUTURA");
          if (!isValidDate(r.dataNascimento)) codigos.push("NASCIMENTO_INVALIDO");
          else if (r.dataNascimento > hoje) codigos.push("NASCIMENTO_FUTURO");

          const cep = (r.cep || "").trim();
          const cepFmtOk = /^\d{8}$/.test(cep) && !/^0+$/.test(cep);
          if (!cepFmtOk && (cep !== "" || (r.endereco || "").trim() !== "")) codigos.push("CEP_INVALIDO");

          const cnsPac = (r.cnsCpfPaciente || "").trim();
          const cpfPac = (r.cpfPaciente || "").trim();
          const temCnsPac = /^\d{15}$/.test(cnsPac);
          const temCpfPac = /^\d{11}$/.test(cpfPac) && !/^0+$/.test(cpfPac);
          if (!temCnsPac && !temCpfPac) {
            codigos.push(lookup && lookup.procExigeIdentificacao && lookup.procExigeIdentificacao(r.sigtap)
              ? "PROCEDIMENTO_EXIGE_CNS" : "PACIENTE_SEM_IDENTIFICACAO");
          }
          else if (temCnsPac && !cnsDvOk(cnsPac)) codigos.push("CNS_PACIENTE_INVALIDO");
          else if (!temCnsPac && temCpfPac && !cpfDvOk(cpfPac)) codigos.push("CPF_PACIENTE_INVALIDO");

          const cnsProf = (r.cnsProfissional || "").trim();
          if (!/^\d{15}$/.test(cnsProf)) codigos.push("CNS_PROFISSIONAL_AUSENTE");
          else if (!cnsDvOk(cnsProf)) codigos.push("CNS_PROFISSIONAL_INVALIDO");

          const muni = (r.municipioIbge || "").trim();
          if (!/^\d{6,7}$/.test(muni) || /^0+$/.test(muni)) codigos.push("MUNICIPIO_INVALIDO");

          if ((r.endereco || "").trim() === "") codigos.push("ENDERECO_INVALIDO");

          const caten = (r.caraterAtendimento || "").trim();
          if (caten === "" || caten === "00") codigos.push("CARATER_ATENDIMENTO_AUSENTE");
          const raca = (r.racaCor || "").trim();
          if (raca === "" || raca === "00") codigos.push("RACA_COR_AUSENTE");
          const nac = (r.nacionalidade || "").trim();
          if (nac === "" || nac === "000") codigos.push("NACIONALIDADE_AUSENTE");

          permitidosSrv = lookup && lookup.servicosDoProcedimento ? lookup.servicosDoProcedimento(r.sigtap) : null;
          if (permitidosSrv && permitidosSrv.length) {
            const par = (r.servico || "").trim() + (r.classificacao || "").trim();
            if (!/^\d{6}$/.test(par) || permitidosSrv.indexOf(par) === -1) codigos.push("CLASSIFICACAO_INVALIDA");
          }

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
        r.cods = codigos.slice(); // conveniência pro writer.js (Pendências / Arquivo corrigido)

        const pClf = r.problemas.find((p) => p.cod === "CLASSIFICACAO_INVALIDA");
        if (pClf && permitidosSrv && permitidosSrv.length) {
          pClf.resolver += " Para o procedimento " + r.sigtap + ", o BPA aceita: " +
            permitidosSrv.map((sc) => {
              const srvNome = lookup.nomeServico ? lookup.nomeServico(sc.slice(0, 3)) : "";
              const clfNome = lookup.nomeClassificacao ? lookup.nomeClassificacao(sc) : "";
              return sc.slice(0, 3) + "-" + sc.slice(3) +
                (srvNome ? " " + srvNome : "") + (clfNome ? " / " + clfNome : "");
            }).join(" | ") + ".";
        }

        r.sigtapEncontrado = !!info;
        r.valorEstimado = info ? info.valor * (r.quantidade || 0) : 0;
      });
    });
  }

  // ---------- upload / importação de arquivo(s) ----------
  function readFileAsync(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("falha ao ler o arquivo"));
      reader.readAsText(file, "utf-8");
    });
  }
  async function processarUmArquivo(file, modo) {
    const texto = await readFileAsync(file);
    const result = parser.parseFile(texto);
    if (!result.header && result.registros.length === 0) {
      throw new Error("Não encontrei um cabeçalho (tipo 01) nem linhas de produção (tipo 02/03) em \"" + file.name + "\".");
    }
    result.registros.forEach((r) => { r.origem = file.name; });
    const fonte = { nome: file.name, label: file.name, header: result.header, registros: result.registros };
    if (modo === "adicionar" && QBPA.parsed) {
      QBPA.parsed.fontes.push(fonte);
      QBPA.parsed.registros = QBPA.parsed.registros.concat(result.registros);
    } else {
      QBPA.parsed = { fontes: [fonte], registros: result.registros.slice() };
    }
    return "adicionar";
  }
  // processa a lista de arquivos, atualiza QBPA.parsed e reavalia as regras.
  // Retorna { ok: boolean, erros: string[] } — sem tocar em DOM (quem chama
  // decide como mostrar erro/nome de arquivo).
  async function processarArquivos(fileList, modoInicial) {
    const files = Array.from(fileList);
    if (!files.length) return { ok: false, erros: [] };
    let modo = modoInicial;
    const erros = [];
    for (const file of files) {
      try { modo = await processarUmArquivo(file, modo); }
      catch (err) { erros.push(err.message); }
    }
    if (!QBPA.parsed) return { ok: false, erros };
    avaliarTodos();
    await lookup.ready;
    return { ok: true, erros };
  }

  // ---------- navegação entre telas ----------
  // Toda tela ativa um único <div id="tela-<nome>"> (ver index.html) e chama
  // QBPA.telas[nome].render() quando fica visível. irPara() é o jeito de uma
  // tela mandar o usuário pra outra já com um preset de filtro (substitui o
  // antigo showDrilldown(title, preset) do Qualidade BPA sozinho).
  function irPara(nome, opcoes) {
    QBPA.navPreset = (opcoes && opcoes.preset) || null;
    location.hash = "#" + nome;
  }

  Object.assign(QBPA, {
    utils: {
      escapeHtml, fmtData, isValidDate, pacienteChave, idadeEmMeses, fmtMoeda,
      setMsg, clearMsg, sigtapDvOk, cpfDvOk, cnsDvOk,
      cboNome, sigtapNome, cboCelHtml, sigtapCelHtml, progressColor, cardHtml,
      checarCabecalho, nomeEstabelecimento, salvarEstabelecimentos, salvarPadroes,
    },
    PROBLEMA_CATALOG,
    SETOR_INDICADORES,
    PADROES_DEFAULT,
    avaliarTodos,
    processarArquivos,
    irPara,
  });

  root.QBPA = QBPA;
})(typeof window !== "undefined" ? window : globalThis);
