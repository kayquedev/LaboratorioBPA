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
  // Sinaliza se cada setor teve QUALQUER producao no arquivo, usando um ou
  // mais codigos SIGTAP "indicadores" desse setor (basta achar um pra contar
  // como importado). E so um alerta de atencao pro profissional do BPA, nao
  // afeta as demais checagens de qualidade/faturamento.
  const SETOR_INDICADORES = {
    "Laboratório": ["0202020380"],
    "Pronto Atendimento": ["0301060096"],
    "Especialidades": ["0301010072", "0301010048"],
    "Fisioterapia": ["0302050027"],
    "TFD (transporte)": ["0803010125", "0803010109"],
  };

  function renderSetores() {
    const codigosPresentes = new Set(parsed.registros.map((r) => r.sigtap));
    const html = Object.entries(SETOR_INDICADORES).map(([nome, codigos]) => {
      const importado = codigos.some((c) => codigosPresentes.has(c));
      return '<span class="badge ' + (importado ? "b-ok" : "sev-erro") + '" style="margin-right:8px;">' +
        (importado ? "✓" : "✗") + " " + escapeHtml(nome) + "</span>";
    }).join(" ");
    document.getElementById("setoresResumo").innerHTML = html;
  }

  // ---------- estabelecimentos (CNES -> nome, cadastrado manualmente e
  // salvo no navegador — a tabela SIGTAP não traz nome de estabelecimento) ----------
  const ESTAB_STORAGE_KEY = "qualidade_bpa_estabelecimentos";
  function carregarEstabelecimentos() {
    try { return JSON.parse(window.localStorage.getItem(ESTAB_STORAGE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function salvarEstabelecimentosStorage() {
    try { window.localStorage.setItem(ESTAB_STORAGE_KEY, JSON.stringify(estabelecimentos)); } catch (e) { /* localStorage indisponível */ }
  }
  let estabelecimentos = carregarEstabelecimentos();
  function nomeEstabelecimento(cnes) { return estabelecimentos[cnes] || ""; }

  const estabCnesInput = document.getElementById("estabCnesInput");
  const estabNomeInput = document.getElementById("estabNomeInput");
  const estabFormList = document.getElementById("estabFormList");

  function renderEstabFormList() {
    const codigos = Object.keys(estabelecimentos).sort();
    if (!codigos.length) {
      estabFormList.innerHTML = '<div class="vazio-estab">Nenhum estabelecimento cadastrado ainda.</div>';
      return;
    }
    estabFormList.innerHTML = codigos.map((cnes) =>
      '<div class="fonte-row"><div class="fonte-info">' +
        '<span class="fonte-nome">' + escapeHtml(cnes) + "</span>" +
        '<span class="fonte-original">' + escapeHtml(estabelecimentos[cnes]) + "</span>" +
      "</div>" +
      '<button class="btn btn-ghost-dark" data-remover-estab="' + escapeHtml(cnes) + '">✕ Remover</button></div>'
    ).join("");
    estabFormList.querySelectorAll("[data-remover-estab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        delete estabelecimentos[btn.dataset.removerEstab];
        salvarEstabelecimentosStorage();
        renderEstabFormList();
        if (parsed) renderEstabelecimentos();
      });
    });
  }

  document.getElementById("btnSalvarEstab").addEventListener("click", () => {
    const cnes = estabCnesInput.value.trim();
    const nome = estabNomeInput.value.trim();
    if (!/^\d{7}$/.test(cnes)) { window.alert("Informe um CNES com 7 dígitos."); return; }
    if (!nome) { window.alert("Informe o nome do estabelecimento."); return; }
    estabelecimentos[cnes] = nome;
    salvarEstabelecimentosStorage();
    estabCnesInput.value = "";
    estabNomeInput.value = "";
    renderEstabFormList();
    if (parsed) renderEstabelecimentos();
  });

  function cadastrarNomeEstabelecimento(cnes) {
    const novo = window.prompt("Nome do estabelecimento CNES " + cnes + ":", nomeEstabelecimento(cnes));
    if (novo == null) return;
    const nomeFinal = novo.trim();
    if (nomeFinal) estabelecimentos[cnes] = nomeFinal; else delete estabelecimentos[cnes];
    salvarEstabelecimentosStorage();
    renderEstabFormList();
    renderEstabelecimentos();
  }

  function renderEstabelecimentos() {
    const el = document.getElementById("estabList");
    const porCnes = {};
    parsed.registros.forEach((r) => { porCnes[r.cnes] = (porCnes[r.cnes] || 0) + 1; });
    const cnesList = Object.keys(porCnes).sort();
    el.innerHTML = cnesList.map((cnes) => {
      const nome = nomeEstabelecimento(cnes);
      return '<div class="fonte-row"><div class="fonte-info">' +
        '<span class="fonte-nome">' + escapeHtml(cnes) + "</span>" +
        (nome ? '<span class="fonte-original">' + escapeHtml(nome) + "</span>" : '<span class="fonte-original estab-sem-nome">nome não cadastrado</span>') +
        '<span class="fonte-count">' + porCnes[cnes] + " registro(s)</span>" +
        "</div>" +
        '<button class="btn btn-ghost-dark" data-cadastrar-cnes="' + escapeHtml(cnes) + '">' + (nome ? "✎ Editar nome" : "+ Cadastrar nome") + "</button></div>";
    }).join("");
    el.querySelectorAll("[data-cadastrar-cnes]").forEach((btn) => {
      btn.addEventListener("click", () => cadastrarNomeEstabelecimento(btn.dataset.cadastrarCnes));
    });
  }

  renderEstabFormList();

  // ---------- STEP 1: upload ----------
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("fileInput");
  const fname = document.getElementById("fname");
  const uploadMsg = document.getElementById("uploadMsg");
  const addFileInput = document.getElementById("addFileInput");
  const addFileInputInicial = document.getElementById("addFileInputInicial");

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleFiles(fileInput.files, "novo"); }
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFiles(fileInput.files, "novo"); });
  addFileInput.addEventListener("change", () => {
    if (addFileInput.files.length) handleFiles(addFileInput.files, "adicionar");
    addFileInput.value = "";
  });
  addFileInputInicial.addEventListener("change", () => {
    if (addFileInputInicial.files.length) handleFiles(addFileInputInicial.files, "novo");
    addFileInputInicial.value = "";
  });
  document.getElementById("btnAddFileInicial").addEventListener("click", () => addFileInputInicial.click());

  function readFileAsync(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("falha ao ler o arquivo"));
      reader.readAsText(file, "utf-8");
    });
  }

  // processa um arquivo e junta ao "parsed" atual; devolve o modo a usar no
  // proximo arquivo do mesmo lote (depois do 1º, sempre "adicionar")
  async function processarUmArquivo(file, modo) {
    const texto = await readFileAsync(file);
    const result = parser.parseFile(texto);
    if (!result.header && result.registros.length === 0) {
      throw new Error("Não encontrei um cabeçalho (tipo 01) nem linhas de produção (tipo 02/03) em \"" + file.name + "\".");
    }
    result.registros.forEach((r) => { r.origem = file.name; });
    const fonte = { nome: file.name, label: file.name, header: result.header, registros: result.registros };
    if (modo === "adicionar" && parsed) {
      parsed.fontes.push(fonte);
      parsed.registros = parsed.registros.concat(result.registros);
    } else {
      parsed = { fontes: [fonte], registros: result.registros.slice() };
    }
    return "adicionar";
  }

  async function handleFiles(fileList, modoInicial) {
    const files = Array.from(fileList);
    if (!files.length) return;
    if (modoInicial === "novo") { fname.textContent = files[0].name; clearMsg(uploadMsg); }

    let modo = modoInicial;
    const erros = [];
    for (const file of files) {
      try {
        modo = await processarUmArquivo(file, modo);
      } catch (err) {
        erros.push(err.message);
      }
    }

    if (!parsed) {
      if (erros.length) setMsg(uploadMsg, "error", erros.join(" "));
      return;
    }
    avaliarTodos();
    window.QualidadeBpaLookup.ready.finally(() => {
      showDashboard();
      if (erros.length) window.alert(erros.join("\n"));
    });
  }

  // numeração de folha/seq e a competência do cabeçalho são escopadas a cada
  // arquivo (cada BPA magnético é uma submissão independente) — por isso as
  // checagens abaixo comparam cada registro só com os outros do mesmo arquivo.
  function checarCabecalho(fonte) {
    if (!fonte.header) return null;
    // folha e um documento por (instrumento + CNES): a folha 3 do BPA-C de um
    // CNES e a folha 3 do BPA-I (ou de outro CNES) sao folhas diferentes.
    const distinctFolhas = new Set(fonte.registros.map((r) => r.tipo + "|" + r.cnes + "|" + r.folha)).size;
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
    // duplicidade real = mesmo instrumento + mesmo CNES + mesma folha/seq
    // (folha e escopada por instrumento e por estabelecimento)
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

        // CEP: 8 dígitos, não zerado; e obrigatório quando há endereço.
        // (o BPA Magnético ainda cruza o CEP com o município na base dos Correios —
        // isso este módulo não replica, então um CEP "bem-formado" pode mesmo assim
        // ser recusado lá se não pertencer à cidade informada.)
        const cep = (r.cep || "").trim();
        const cepFmtOk = /^\d{8}$/.test(cep) && !/^0+$/.test(cep);
        if (!cepFmtOk && (cep !== "" || (r.endereco || "").trim() !== "")) codigos.push("CEP_INVALIDO");

        // identificação do paciente: CNS (60-74) ou CPF (339-349)
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

        // CNS do profissional executante (16-30)
        const cnsProf = (r.cnsProfissional || "").trim();
        if (!/^\d{15}$/.test(cnsProf)) codigos.push("CNS_PROFISSIONAL_AUSENTE");
        else if (!cnsDvOk(cnsProf)) codigos.push("CNS_PROFISSIONAL_INVALIDO");

        // município de residência (IBGE, 76-81) — crítica 024
        const muni = (r.municipioIbge || "").trim();
        if (!/^\d{6,7}$/.test(muni) || /^0+$/.test(muni)) codigos.push("MUNICIPIO_INVALIDO");

        // endereço do paciente (logradouro, 203-232) — crítica 054
        if ((r.endereco || "").trim() === "") codigos.push("ENDERECO_INVALIDO");

        // campos obrigatórios do BPA-I que o BPA Magnético também critica
        const caten = (r.caraterAtendimento || "").trim();
        if (caten === "" || caten === "00") codigos.push("CARATER_ATENDIMENTO_AUSENTE");
        const raca = (r.racaCor || "").trim();
        if (raca === "" || raca === "00") codigos.push("RACA_COR_AUSENTE");
        const nac = (r.nacionalidade || "").trim();
        if (nac === "" || nac === "000") codigos.push("NACIONALIDADE_AUSENTE");

        // serviço/classificação (160-165) x procedimento — crítica 050
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

      // detalha, no próprio registro, quais pares Serviço/Classificação o
      // procedimento aceita (o texto do catálogo é genérico demais pra isso)
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

  // ---------- dashboard ----------
  function renderAlert() {
    const el = document.getElementById("headerAlert");
    const linhas = [];
    let algumaDivergencia = false;

    parsed.fontes.forEach((fonte) => {
      const rotulo = "<b>" + escapeHtml(fonte.label) + "</b>";
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
      const nomes = parsed.fontes.map((f) => escapeHtml(f.label)).join(", ");
      const plural = parsed.fontes.length > 1 ? "s conferem" : " confere";
      el.innerHTML = "<b>Cabeçalho" + plural + ".</b> " + nomes + " — contagem de linhas e folhas batem com o declarado. Processado 100% no navegador, nada é enviado ao servidor.";
    }
  }

  function renderFontesList() {
    const el = document.getElementById("fontesList");
    el.innerHTML = parsed.fontes.map((fonte, i) =>
      '<div class="fonte-row">' +
        '<div class="fonte-info">' +
          '<span class="fonte-nome">' + escapeHtml(fonte.label) + "</span>" +
          (fonte.label !== fonte.nome ? '<span class="fonte-original">arquivo: ' + escapeHtml(fonte.nome) + "</span>" : "") +
          '<span class="fonte-count">' + fonte.registros.length + " registro(s)</span>" +
        "</div>" +
        '<button class="btn btn-ghost-dark" data-rename-fonte="' + i + '">✎ Renomear</button>' +
      "</div>"
    ).join("");
    el.querySelectorAll("[data-rename-fonte]").forEach((btn) => {
      btn.addEventListener("click", () => renomearFonte(parsed.fontes[+btn.dataset.renameFonte]));
    });
  }

  function renomearFonte(fonte) {
    const novo = window.prompt('Novo nome para "' + fonte.nome + '" (ex: Pronto Atendimento, Laboratório...):', fonte.label);
    if (novo == null) return;
    const nomeFinal = novo.trim() || fonte.nome;
    fonte.registros.forEach((r) => { r.origem = nomeFinal; });
    fonte.label = nomeFinal;

    renderFontesList();
    populateOrigemFilter();
    renderSummary();
    renderFaturamento();
    renderPaineis();
    if (!viewDrilldown.classList.contains("hidden")) renderDrilldown();
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
      const temPendencia = r.problemas.length > 0;
      if (temPendencia) pendente += r.valorEstimado; else receber += r.valorEstimado;
    });
    const total = receber + pendente;
    const pctReceber = total ? Math.round((receber / total) * 100) : 0;
    const pctPendente = total ? 100 - pctReceber : 0;

    const cards = [
      {
        id: "fatTotal", badge: '<span class="badge b-soon">Estimado</span>',
        valor: fmtMoeda(total), titulo: "Faturamento total estimado",
        desc: "Soma do valor SIGTAP (ambulatorial + profissional) × quantidade, para os registros com procedimento localizado na tabela carregada.",
      },
      {
        id: "fatReceber", badge: '<span class="badge b-ok pct-badge">' + pctReceber + '% do total</span>',
        corValor: "var(--teal)", pct: pctReceber, barColor: "var(--teal)",
        valor: fmtMoeda(receber), titulo: "Faturamento estimado a receber",
        desc: "Registros sem nenhuma pendência detectada — tendência de serem aceitos e pagos pelo SIA.",
      },
      {
        id: "fatPendente", badge: '<span class="badge sev-erro pct-badge">' + pctPendente + '% do total</span>',
        corValor: "var(--red)", pct: pctPendente, barColor: "var(--red)",
        valor: fmtMoeda(pendente), titulo: "Pendente / risco de glosa",
        desc: "Registros com pelo menos uma pendência (erro ou aviso — SIGTAP/CBO inválido, data suspeita, CEP inválido, possível duplicidade etc.), risco de rejeição, glosa, ou que merece revisão antes do envio.",
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

  function renderCards() {
    const regs = parsed.registros;
    const total = regs.length;
    const semProblema = regs.filter((r) => r.problemas.length === 0).length;
    const pct = total ? Math.round((semProblema / total) * 100) : 0;

    const cardsQ = [];
    cardsQ.push({
      id: "qualidade", onClick: true, pct, badge: "",
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
      { id: "todos", onClick: true, valor: total, titulo: "Todos", desc: "BPA-C e BPA-I juntos.", link: "Ver registros", preset: {}, title: "Todos" },
      { id: "t02", onClick: true, valor: regs.filter((r) => r.tipo === "02").length, titulo: "Consolidado", desc: "Linhas tipo 02 · BPA-C.", link: "Ver registros", preset: { tipo: "02" }, title: "Consolidado (BPA-C)" },
      { id: "t03", onClick: true, valor: regs.filter((r) => r.tipo === "03").length, titulo: "Individual", desc: "Linhas tipo 03 · BPA-I, por paciente.", link: "Ver registros", preset: { tipo: "03" }, title: "Individual (BPA-I)" },
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
    const totaisLabel = document.getElementById("glossarioTotaisLabel");
    const totaisBox = document.getElementById("cardsGlossarioTotais");
    if (!codigos.length) {
      label.classList.add("hidden");
      totaisLabel.classList.add("hidden");
      box.innerHTML = "";
      totaisBox.innerHTML = "";
      return;
    }
    label.classList.remove("hidden");
    box.innerHTML = codigos.map((cod) => {
      const info = PROBLEMA_CATALOG[cod];
      return '<a class="gloss-item" href="javascript:void(0)" data-gloss-cod="' + cod + '"><span class="badge sev-' + info.sev + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + '</span>' +
        '<div class="gloss-body">' +
        '<div class="gloss-titulo">' + escapeHtml(info.texto) + ' <span class="gloss-count">— ' + counts[cod] + " ocorrência(s) · ver registros</span></div>" +
        '<div class="gloss-explicacao">' + escapeHtml(info.explicacao) + "</div>" +
        '<div class="gloss-resolver"><b>Como resolver:</b> ' + escapeHtml(info.resolver) + "</div>" +
        "</div></a>";
    }).join("");
    box.querySelectorAll("[data-gloss-cod]").forEach((el) => {
      const cod = el.dataset.glossCod;
      el.addEventListener("click", () => showDrilldown(PROBLEMA_CATALOG[cod].texto, { problema: cod }));
    });

    // ---- 3 cards: valor estimado das pendências, por severidade ----
    // "pendente" = registro com SIGTAP localizado na tabela E com ao menos um
    // problema. Se tiver qualquer "erro" conta em erros; se só tiver aviso(s),
    // conta em avisos. Total = erros + avisos (mesmo valor do card "Pendente /
    // risco de glosa" do painel de Faturamento).
    let vErro = 0, vAviso = 0, nErro = 0, nAviso = 0;
    regs.forEach((r) => {
      if (!r.sigtapEncontrado || !r.problemas.length) return;
      if (r.problemas.some((p) => p.sev === "erro")) { vErro += r.valorEstimado; nErro++; }
      else { vAviso += r.valorEstimado; nAviso++; }
    });
    totaisLabel.classList.remove("hidden");
    totaisBox.innerHTML = [
      { badge: '<span class="badge b-soon">Estimado</span>', corValor: "var(--red)",
        valor: fmtMoeda(vErro + vAviso), titulo: "Valor total pendente",
        desc: (nErro + nAviso) + " registro(s) com erro ou aviso e SIGTAP localizado — soma de tudo que precisa de revisão." },
      { badge: '<span class="badge sev-aviso">Avisos</span>', corValor: "var(--amber)",
        valor: fmtMoeda(vAviso), titulo: "Valor avisos pendente",
        desc: nAviso + " registro(s) só com aviso(s) — revisar antes de enviar, mas tende a ser aceito." },
      { badge: '<span class="badge sev-erro">Erros</span>', corValor: "var(--red)",
        valor: fmtMoeda(vErro), titulo: "Valor erros pendente",
        desc: nErro + " registro(s) com pelo menos um erro — tendem a ser rejeitados ou glosados pelo SIA." },
    ].map(cardHtml).join("");
  }

  // ---------- handoff pro modulo Correcao BPA ----------
  const CORRECAO_STORAGE_KEY = "qualidade_bpa_correcao_payload";

  function renderCorrecaoCta() {
    const regs = parsed.registros;
    const comProblema = regs.filter((r) => r.problemas.length > 0);
    const soAuto = comProblema.filter((r) => r.problemas.every((p) => p.cod === "FOLHA_SEQ_DUPLICADA")).length;
    const precisaManual = comProblema.length - soAuto;

    const texto = comProblema.length === 0
      ? "Nenhuma pendência encontrada neste arquivo — pode conferir mesmo assim."
      : soAuto + " pendência(s) podem ser resolvidas automaticamente (renumeração de folha/sequência). " +
        precisaManual + " precisa(m) de revisão manual, registro por registro.";
    document.getElementById("correcaoResumoTexto").textContent = texto;
  }

  // Payload enxuto: "linhas" leva só o texto bruto de TODOS os registros
  // (precisa de todos pra renumerar certo, e o Correção BPA decodifica os
  // campos de exibição sozinho a partir dela, com o mesmo parser.js — por
  // isso não precisa levar campo nenhum aqui). "pendencias" só marca, por
  // índice, quais registros têm pendência e com quais códigos (sem o texto
  // do catálogo) — os só-folha/seq-duplicada nem entram, já que aquilo é
  // resolvido automaticamente do outro lado.
  function payloadParaCorrecao() {
    let autoResolvidos = 0;
    const fontes = parsed.fontes.map((fonte) => {
      const linhas = [];
      const pendencias = [];
      fonte.registros.forEach((r, idx) => {
        linhas.push(r.linha);
        if (!r.problemas.length) return;
        const soFolhaSeq = r.problemas.every((p) => p.cod === "FOLHA_SEQ_DUPLICADA");
        if (soFolhaSeq) { autoResolvidos++; return; }
        pendencias.push({
          idx,
          // folha/seq duplicada nunca aparece aqui mesmo quando o registro tem
          // outro problema junto — aquela parte já foi resolvida automaticamente
          cods: r.problemas.map((p) => p.cod).filter((cod) => cod !== "FOLHA_SEQ_DUPLICADA"),
        });
      });
      return {
        nome: fonte.nome,
        label: fonte.label,
        header: fonte.header ? {
          competencia: fonte.header.competencia, numLinhas: fonte.header.numLinhas,
          numFolhas: fonte.header.numFolhas, linha: fonte.header.linha,
        } : null,
        linhas, pendencias,
      };
    });
    return { geradoEm: Date.now(), autoResolvidos, fontes };
  }

  document.getElementById("btnIrCorrigir").addEventListener("click", () => {
    try {
      window.sessionStorage.setItem(CORRECAO_STORAGE_KEY, JSON.stringify(payloadParaCorrecao()));
    } catch (err) {
      window.alert("Não foi possível levar os dados pra correção — o conjunto carregado é grande demais pro navegador guardar temporariamente. Tente corrigir uma fonte de cada vez (remova as outras antes de clicar aqui, ou baixe cada arquivo separadamente).");
      return;
    }
    window.location.href = "/correcao_bpa/";
  });

  // ---------- drilldown ----------
  const fTipo = document.getElementById("fTipo");
  const fOrigem = document.getElementById("fOrigem");
  const fCbo = document.getElementById("fCbo");
  const fSigtap = document.getElementById("fSigtap");
  const fBusca = document.getElementById("fBusca");
  const fProblema = document.getElementById("fProblema");
  const fSoProblemas = document.getElementById("fSoProblemas");
  const fSoNaoLocalizado = document.getElementById("fSoNaoLocalizado");
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
      parsed.fontes.map((f) => '<option value="' + escapeHtml(f.label) + '">' + escapeHtml(f.label) + "</option>").join("");
    fOrigem.value = parsed.fontes.some((f) => f.label === atual) ? atual : "";
  }

  function populateCboSigtapFilters() {
    const cbos = [...new Set(parsed.registros.map((r) => r.cbo))].sort();
    const sigtaps = [...new Set(parsed.registros.map((r) => r.sigtap))].sort();
    const atualCbo = fCbo.value, atualSigtap = fSigtap.value;

    fCbo.innerHTML = '<option value="">Todos</option>' + cbos.map((c) =>
      '<option value="' + escapeHtml(c) + '">' + escapeHtml(c + (cboNome(c) ? " · " + cboNome(c) : "")) + "</option>"
    ).join("");
    fSigtap.innerHTML = '<option value="">Todos</option>' + sigtaps.map((c) =>
      '<option value="' + escapeHtml(c) + '">' + escapeHtml(c + (sigtapNome(c) ? " · " + sigtapNome(c) : "")) + "</option>"
    ).join("");

    fCbo.value = cbos.indexOf(atualCbo) !== -1 ? atualCbo : "";
    fSigtap.value = sigtaps.indexOf(atualSigtap) !== -1 ? atualSigtap : "";
  }

  function populateProblemaFilter() {
    const counts = {};
    parsed.registros.forEach((r) => r.problemas.forEach((p) => { counts[p.cod] = (counts[p.cod] || 0) + 1; }));
    const codigos = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const atual = fProblema.value;
    fProblema.innerHTML = '<option value="">Todos</option>' + codigos.map((cod) => {
      const info = PROBLEMA_CATALOG[cod];
      return '<option value="' + cod + '">' + (info.sev === "erro" ? "Erro" : "Aviso") + " · " + escapeHtml(info.texto) + " (" + counts[cod] + ")</option>";
    }).join("");
    fProblema.value = codigos.indexOf(atual) !== -1 ? atual : "";
  }

  function filteredRegistros() {
    const tipo = fTipo.value;
    const origem = fOrigem.value;
    const cbo = fCbo.value;
    const sigtap = fSigtap.value;
    const problema = fProblema.value;
    const busca = fBusca.value.trim().toLowerCase();
    const soProblemas = fSoProblemas.checked;
    const soNaoLocalizado = fSoNaoLocalizado.checked;

    return parsed.registros.filter((r) => {
      if (tipo && r.tipo !== tipo) return false;
      if (origem && r.origem !== origem) return false;
      if (cbo && r.cbo !== cbo) return false;
      if (sigtap && r.sigtap !== sigtap) return false;
      if (problema && !r.problemas.some((p) => p.cod === problema)) return false;
      if (soProblemas && r.problemas.length === 0) return false;
      if (soNaoLocalizado && r.sigtapEncontrado) return false;
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

    let receberF = 0, pendenteF = 0;
    regs.forEach((r) => {
      if (!r.sigtapEncontrado) return;
      const temPendencia = r.problemas.length > 0;
      if (temPendencia) pendenteF += r.valorEstimado; else receberF += r.valorEstimado;
    });
    const totalF = receberF + pendenteF;
    const pctPagarF = totalF ? Math.round((receberF / totalF) * 100) : 0;
    document.getElementById("sidebarValorTotal").textContent = fmtMoeda(totalF);
    document.getElementById("sidebarValorPagar").textContent = fmtMoeda(receberF);
    document.getElementById("sidebarValorPagarLabel").textContent =
      "valor total a pagar (" + pctPagarF + "% do total · " + fmtMoeda(pendenteF) + " pendente)";

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
  [fTipo, fOrigem, fCbo, fSigtap, fProblema, fBusca, fSoProblemas, fSoNaoLocalizado].forEach((el) => el.addEventListener("input", renderDrilldown));

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
    populateCboSigtapFilters();
    populateProblemaFilter();
    renderAlert();
    renderSetores();
    renderFontesList();
    renderEstabelecimentos();
    renderSummary();
    renderFaturamento();
    renderCards();
    renderPaineis();
    renderCorrecaoCta();
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
    fProblema.value = preset.problema || "";
    fBusca.value = "";
    fSoProblemas.checked = !!preset.soProblemas;
    fSoNaoLocalizado.checked = !!preset.soNaoLocalizado;

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
  document.getElementById("btnAddFileList").addEventListener("click", () => addFileInput.click());

})();
