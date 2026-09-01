(function (root) {
  "use strict";

  // Espelha os offsets de LEITURA de public/qualidade_bpa/js/parser.js -
  // qualquer ajuste de offset ali precisa ser refletido aqui tambem.
  // Corrige por patch cirurgico na linha bruta original (so troca o
  // intervalo de bytes do campo que mudou), nunca remonta a linha inteira -
  // assim os campos "best-effort" do BPA-I que o parser nao decompoe por
  // completo (raca/cor, nacionalidade, codigo de logradouro etc.) saem
  // intactos, iguais ao arquivo original.

  const HEADER_OFFSETS = {
    competencia: [7, 6, "num"],
    numLinhas: [13, 6, "num"],
    numFolhas: [19, 6, "num"],
  };
  const OFFSETS = {
    "02": {
      competencia: [9, 6, "num"],
      cbo: [15, 6, "num"],
      folha: [21, 3, "num"],
      seq: [24, 2, "num"],
      sigtap: [26, 10, "num"],
      quantidade: [39, 6, "num"],
    },
    "03": {
      competencia: [9, 6, "num"],
      cbo: [30, 6, "num"],
      dataAtendimento: [36, 8, "num"],
      folha: [44, 3, "num"],
      seq: [47, 2, "num"],
      sigtap: [49, 10, "num"],
      cnsCpfPaciente: [59, 15, "num"],
      sexo: [74, 1, "txt"],
      municipio: [75, 6, "num"],
      dataNascimento: [142, 8, "num"],
      cpfPaciente: [338, 11, "num"],
      servico: [159, 3, "num"],
      classificacao: [162, 3, "num"],
      cep: [191, 8, "num"],
      codLogradouro: [199, 3, "num"],
      endereco: [202, 30, "txt"],
      complemento: [232, 10, "txt"],
      numero: [242, 5, "numTxt"],
      bairro: [247, 30, "txt"],
    },
  };

  function patchNum(line, start, len, valor) {
    let v = String(valor == null ? "" : valor).replace(/\D/g, "");
    if (!v) v = "0";
    if (v.length > len) v = v.slice(-len);
    v = v.padStart(len, "0");
    return line.slice(0, start) + v + line.slice(start + len);
  }
  function patchTxt(line, start, len, valor) {
    let v = String(valor == null ? "" : valor).toUpperCase();
    v = (v + " ".repeat(len)).slice(0, len);
    return line.slice(0, start) + v + line.slice(start + len);
  }
  // numero da residencia: preenche com zeros a esquerda quando e so digito,
  // senao trata como texto ("SN", "S/N", "KM 12"...) alinhado a esquerda.
  function patchNumTxt(line, start, len, valor) {
    const raw = String(valor == null ? "" : valor).trim();
    return /^\d+$/.test(raw) ? patchNum(line, start, len, raw) : patchTxt(line, start, len, raw);
  }

  function patchField(linha, tipo, campo, valor) {
    const tabela = tipo === "header" ? HEADER_OFFSETS : OFFSETS[tipo];
    const def = tabela && tabela[campo];
    if (!def || linha == null) return linha;
    const [start, len, kind] = def;
    if (kind === "num") return patchNum(linha, start, len, valor);
    if (kind === "numTxt") return patchNumTxt(linha, start, len, valor);
    return patchTxt(linha, start, len, valor);
  }

  // campos editaveis manualmente por codigo de problema (usado pela tela de revisao)
  const CAMPOS_POR_PROBLEMA = {
    SIGTAP_INVALIDO: ["sigtap"],
    QUANTIDADE_INVALIDA: ["quantidade"],
    CBO_INVALIDO: ["cbo"],
    COMPETENCIA_DIVERGENTE: ["competencia"],
    DATA_FORA_COMPETENCIA: ["dataAtendimento"],
    DATA_ATENDIMENTO_FUTURA: ["dataAtendimento"],
    NASCIMENTO_INVALIDO: ["dataNascimento"],
    NASCIMENTO_FUTURO: ["dataNascimento"],
    CEP_INVALIDO: ["cep"],
    REGISTRO_INCOMPATIVEL: ["sigtap"],
    SIGTAP_SEXO_INCOMPATIVEL: ["sexo", "sigtap"],
    SIGTAP_IDADE_INCOMPATIVEL: ["dataNascimento", "dataAtendimento", "sigtap"],
    SIGTAP_DV_INVALIDO: ["sigtap"],
    SIGTAP_NAO_ENCONTRADO: ["sigtap"],
    CLASSIFICACAO_INVALIDA: ["servico", "classificacao"],
    PACIENTE_SEM_IDENTIFICACAO: ["cnsCpfPaciente", "cpfPaciente"],
    // FOLHA_SEQ_DUPLICADA: resolvido automaticamente, nao aparece pra revisao manual
    // POSSIVEL_DUPLICIDADE: sem campo unico, so "excluir" ou "revisar"
    // MUNICIPIO_INVALIDO / ENDERECO_INVALIDO: cobertos pelos Padroes do municipio
    // CNS_* / CARATER_ATENDIMENTO_AUSENTE / RACA_COR_AUSENTE / NACIONALIDADE_AUSENTE:
    //   sem patch de campo unico aqui, corrigir na origem e reimportar
  };

  const CAMPO_LABEL = {
    sigtap: "SIGTAP", quantidade: "Quantidade", cbo: "CBO", competencia: "Competência",
    dataAtendimento: "Data atendimento", dataNascimento: "Data nascimento", cep: "CEP", sexo: "Sexo",
    servico: "Serviço", classificacao: "Classificação",
    cnsCpfPaciente: "CNS do paciente", cpfPaciente: "CPF do paciente",
  };

  // mesmo texto do catalogo em public/qualidade_bpa/js/app.js (menos
  // FOLHA_SEQ_DUPLICADA, que nunca chega aqui - ja e resolvido automaticamente
  // antes do payload sair do Qualidade BPA). Duplicado aqui pra nao precisar
  // mandar o texto inteiro (explicacao/como resolver) por registro no payload
  // - só o codigo curto viaja, e o texto é resolvido localmente na exibição.
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
      explicacao: "A linha do BPA-I não traz CNS nem CPF do paciente. O BPA Magnético recusa (críticas 060 — CNS obrigatório / 025 — procedimento exige CNS). Vários procedimentos não aceitam CPF no lugar do CNS.",
      resolver: "Informe o CNS do paciente (15 dígitos). Onde o procedimento aceitar, o CPF pode ser usado — mas confira, porque muitos exigem o CNS." },
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

  // Folha/seq no BPA magnetico NAO e um contador corrido: cada folha e
  // homogenea — um so instrumento (02 = BPA-C / 03 = BPA-I), CNES,
  // competencia, CBO e, no BPA-I, um so profissional. Agrupa os registros
  // por essa chave, preserva a ordem original dentro do grupo, e numera cada
  // grupo com contagem propria — folha nova quando a chave muda OU a cada 20
  // linhas. As linhas saem reordenadas por folha (BPA-C primeiro, depois
  // BPA-I), do jeito que o BPAMAG gera; assim o mesmo numero de folha nunca
  // aparece em dois CNES / dois CBOs / dois instrumentos diferentes.
  const LINHAS_POR_FOLHA = 20;

  function chaveGrupo(r) {
    return [
      r.tipo || "",
      r.cnes || "",
      r.competencia || "",
      r.cbo || "",
      r.tipo === "03" ? (r.cnsProfissional || "") : "",
    ].join("|");
  }

  function renumerar(registros) {
    const ordenados = registros
      .map((registro, ordemOriginal) => ({ registro, ordemOriginal }))
      .sort((a, b) => {
        const ka = chaveGrupo(a.registro);
        const kb = chaveGrupo(b.registro);
        if (ka < kb) return -1;
        if (ka > kb) return 1;
        return a.ordemOriginal - b.ordemOriginal; // estavel dentro do grupo
      });

    let folha = 0;
    let seq = 0;
    let chaveAnterior = null;

    return ordenados.map(({ registro }) => {
      const chave = chaveGrupo(registro);
      if (chave !== chaveAnterior || seq >= LINHAS_POR_FOLHA) {
        folha += 1;
        seq = 0;
        chaveAnterior = chave;
      }
      seq += 1;
      return { registro, novaFolha: folha, novoSeq: seq };
    });
  }

  // ---------- padroes do municipio (definidos na tela de resumo) ----------
  // padroes = { municipioIbge: "316180", cepTodos: "35544000",
  //   secretaria: { cep, tipoLogradouro, logradouro, numero, complemento, bairro } }
  // Municipio: grava o IBGE em toda linha 03 cujo valor esteja em branco ou
  // diferente. cepTodos: grava o CEP em TODAS as linhas 03 (tenha endereco ou
  // nao). Endereco: quando logradouro OU bairro do paciente estao em branco,
  // troca o bloco de endereco inteiro pelo da Secretaria de Saude.
  function ibgePadraoOk(padroes) {
    return !!padroes && /^\d{6,7}$/.test(String(padroes.municipioIbge || "").trim());
  }
  function cepTodosOk(padroes) {
    const c = String((padroes && padroes.cepTodos) || "").trim();
    return /^\d{8}$/.test(c) && !/^0+$/.test(c);
  }
  function enderecoSecretariaOk(padroes) {
    const s = (padroes && padroes.secretaria) || {};
    return String(s.logradouro || "").trim() !== "" && String(s.bairro || "").trim() !== "";
  }
  function registroEnderecoIncompleto(r) {
    return String(r.endereco || "").trim() === "" || String(r.bairro || "").trim() === "";
  }
  function aplicarPadroes(linha, registro, padroes) {
    if (!padroes || registro.tipo !== "03") return linha;
    const ibge = String(padroes.municipioIbge || "").trim();
    if (ibgePadraoOk(padroes) && String(registro.municipioIbge || "").trim() !== ibge) {
      linha = patchField(linha, "03", "municipio", ibge);
    }
    if (enderecoSecretariaOk(padroes) && registroEnderecoIncompleto(registro)) {
      const s = padroes.secretaria;
      if (String(s.cep || "").trim()) linha = patchField(linha, "03", "cep", s.cep);
      if (String(s.tipoLogradouro || "").trim()) linha = patchField(linha, "03", "codLogradouro", s.tipoLogradouro);
      linha = patchField(linha, "03", "endereco", s.logradouro);
      linha = patchField(linha, "03", "numero", String(s.numero || "").trim() || "SN");
      linha = patchField(linha, "03", "complemento", s.complemento || "");
      linha = patchField(linha, "03", "bairro", s.bairro);
    }
    // CEP forcado em todas as linhas 03 - por ultimo, prevalece sobre o da Secretaria
    if (cepTodosOk(padroes)) {
      linha = patchField(linha, "03", "cep", String(padroes.cepTodos).trim());
    }
    return linha;
  }
  // quantas linhas 03 (nao excluidas) cada padrao vai tocar - pra previa na UI
  function contarImpactoPadroes(registros, padroes) {
    let municipio = 0, endereco = 0, cep = 0;
    if (!padroes) return { municipio, endereco, cep };
    const ibge = String(padroes.municipioIbge || "").trim();
    const cepAlvo = String(padroes.cepTodos || "").trim();
    const ibgeOk = ibgePadraoOk(padroes);
    const cepOk = cepTodosOk(padroes);
    const secOk = enderecoSecretariaOk(padroes);
    (registros || []).forEach((r) => {
      if (r.tipo !== "03" || r.excluido) return;
      if (ibgeOk && String(r.municipioIbge || "").trim() !== ibge) municipio++;
      if (cepOk && String(r.cep || "").trim() !== cepAlvo) cep++;
      if (secOk && registroEnderecoIncompleto(r)) endereco++;
    });
    return { municipio, endereco, cep };
  }

  function linhaFinal(registro, novaFolha, novoSeq, padroes) {
    let linha = registro.linha;
    const tipo = registro.tipo;
    linha = patchField(linha, tipo, "folha", novaFolha);
    linha = patchField(linha, tipo, "seq", novoSeq);
    // ordem de prioridade (menor -> maior): padroes do municipio, preenchimento
    // automatico de servico/classificacao, correcao manual da tela de revisao.
    linha = aplicarPadroes(linha, registro, padroes);
    const auto = registro.correcoesAuto || {};
    Object.keys(auto).forEach((campo) => {
      if (auto[campo] !== "" && auto[campo] != null) linha = patchField(linha, tipo, campo, auto[campo]);
    });
    const correcoes = registro.correcoes || {};
    Object.keys(correcoes).forEach((campo) => {
      if (correcoes[campo] !== "" && correcoes[campo] != null) {
        linha = patchField(linha, tipo, campo, correcoes[campo]);
      }
    });
    return linha;
  }

  function montarConteudo(headerLinhaOriginal, registrosIncluidos, padroes) {
    const renum = renumerar(registrosIncluidos);
    const linhas = renum.map(({ registro, novaFolha, novoSeq }) => linhaFinal(registro, novaFolha, novoSeq, padroes));
    const numFolhas = renum.reduce((max, x) => (x.novaFolha > max ? x.novaFolha : max), 0);
    let headerLine = headerLinhaOriginal || null;
    if (headerLine) {
      headerLine = patchField(headerLine, "header", "numLinhas", linhas.length);
      headerLine = patchField(headerLine, "header", "numFolhas", numFolhas);
    }
    const todasLinhas = headerLine ? [headerLine].concat(linhas) : linhas;
    const avisos = [];
    if (numFolhas > 999) {
      avisos.push(
        "O arquivo ficou com " + numFolhas + " folhas, mas o campo de folha do BPA " +
        "magnetico so tem 3 digitos (maximo 999). O SIA vai recusar o arquivo — " +
        "separe a producao em mais de um arquivo antes de enviar."
      );
    }
    return {
      texto: todasLinhas.join("\r\n") + "\r\n", numLinhas: linhas.length, numFolhas, avisos,
      impacto: contarImpactoPadroes(registrosIncluidos, padroes),
    };
  }

  function montarArquivo(fonte, padroes) {
    const incluidos = fonte.registros.filter((r) => !r.excluido);
    return montarConteudo(fonte.header && fonte.header.linha, incluidos, padroes);
  }

  function montarArquivoUnico(fontes, padroes) {
    const incluidos = [];
    fontes.forEach((fonte) => {
      fonte.registros.filter((r) => !r.excluido).forEach((r) => incluidos.push(r));
    });
    const fonteComHeader = fontes.find((f) => f.header && f.header.linha);
    return montarConteudo(fonteComHeader && fonteComHeader.header.linha, incluidos, padroes);
  }

  function mesmaCompetencia(fontes) {
    const comps = fontes.filter((f) => f.header).map((f) => f.header.competencia);
    return comps.length > 0 && comps.every((c) => c === comps[0]);
  }

  const api = {
    patchField, renumerar, linhaFinal, montarArquivo, montarArquivoUnico, mesmaCompetencia,
    contarImpactoPadroes, aplicarPadroes,
    CAMPOS_POR_PROBLEMA, CAMPO_LABEL, PROBLEMA_CATALOG,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CorrecaoBpaWriter = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
