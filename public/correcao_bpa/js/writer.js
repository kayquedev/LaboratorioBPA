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
      sexo: [74, 1, "txt"],
      dataNascimento: [142, 8, "num"],
      cep: [191, 8, "num"],
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

  function patchField(linha, tipo, campo, valor) {
    const tabela = tipo === "header" ? HEADER_OFFSETS : OFFSETS[tipo];
    const def = tabela && tabela[campo];
    if (!def || linha == null) return linha;
    const [start, len, kind] = def;
    return kind === "num" ? patchNum(linha, start, len, valor) : patchTxt(linha, start, len, valor);
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
    // FOLHA_SEQ_DUPLICADA: resolvido automaticamente, nao aparece pra revisao manual
    // POSSIVEL_DUPLICIDADE / SIGTAP_NAO_ENCONTRADO: sem campo unico, so "excluir" ou "revisar"
  };

  const CAMPO_LABEL = {
    sigtap: "SIGTAP", quantidade: "Quantidade", cbo: "CBO", competencia: "Competência",
    dataAtendimento: "Data atendimento", dataNascimento: "Data nascimento", cep: "CEP", sexo: "Sexo",
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
    CEP_INVALIDO: { sev: "aviso", texto: "CEP inválido",
      explicacao: "O CEP informado não tem 8 dígitos numéricos.",
      resolver: "Confira o CEP no cadastro do paciente; se não houver CEP correto, prefira deixar em branco." },
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
    SIGTAP_NAO_ENCONTRADO: { sev: "aviso", texto: "SIGTAP não encontrado na tabela carregada",
      explicacao: "O código tem formato válido, mas não foi encontrado na tabela SIGTAP usada por este módulo (pode ser de uma competência diferente da carregada aqui).",
      resolver: "Confirme se o código existe na competência vigente do SIGTAP; esse aviso, sozinho, não indica que a linha está errada." },
  };

  // reconstroi os registros de uma fonte a partir do payload enxuto
  // (linhas: so texto bruto; pendencias: campos decodificados + codigos de
  // problema, so pros registros que precisam de revisao manual)
  function hidratarFonte(fonte) {
    const pendMap = {};
    (fonte.pendencias || []).forEach((p) => { pendMap[p.idx] = p; });
    const registros = (fonte.linhas || []).map((linha, idx) => {
      const tipo = linha.slice(0, 2);
      const registro = { linha, tipo, idx };
      const pend = pendMap[idx];
      if (pend) {
        registro.sigtap = pend.sigtap; registro.cbo = pend.cbo; registro.quantidade = pend.quantidade;
        registro.competencia = pend.competencia; registro.dataAtendimento = pend.dataAtendimento;
        registro.dataNascimento = pend.dataNascimento; registro.cep = pend.cep; registro.sexo = pend.sexo;
        registro.nomePaciente = pend.nomePaciente; registro.cods = pend.cods;
      }
      return registro;
    });
    return { nome: fonte.nome, label: fonte.label, header: fonte.header, registros };
  }

  // 20 registros por folha, ordem original preservada (mesma convencao
  // observada num arquivo real: folha muda a cada 20 sequencias)
  function renumerar(registros) {
    return registros.map((r, i) => {
      const idx = i + 1;
      return { registro: r, novaFolha: Math.ceil(idx / 20), novoSeq: ((idx - 1) % 20) + 1 };
    });
  }

  function linhaFinal(registro, novaFolha, novoSeq) {
    let linha = registro.linha;
    const tipo = registro.tipo;
    linha = patchField(linha, tipo, "folha", novaFolha);
    linha = patchField(linha, tipo, "seq", novoSeq);
    const correcoes = registro.correcoes || {};
    Object.keys(correcoes).forEach((campo) => {
      if (correcoes[campo] !== "" && correcoes[campo] != null) {
        linha = patchField(linha, tipo, campo, correcoes[campo]);
      }
    });
    return linha;
  }

  function montarConteudo(headerLinhaOriginal, registrosIncluidos) {
    const renum = renumerar(registrosIncluidos);
    const linhas = renum.map(({ registro, novaFolha, novoSeq }) => linhaFinal(registro, novaFolha, novoSeq));
    const numFolhas = renum.length ? renum[renum.length - 1].novaFolha : 0;
    let headerLine = headerLinhaOriginal || null;
    if (headerLine) {
      headerLine = patchField(headerLine, "header", "numLinhas", linhas.length);
      headerLine = patchField(headerLine, "header", "numFolhas", numFolhas);
    }
    const todasLinhas = headerLine ? [headerLine].concat(linhas) : linhas;
    return { texto: todasLinhas.join("\r\n") + "\r\n", numLinhas: linhas.length, numFolhas };
  }

  function montarArquivo(fonte) {
    const incluidos = fonte.registros.filter((r) => !r.excluido);
    return montarConteudo(fonte.header && fonte.header.linha, incluidos);
  }

  function montarArquivoUnico(fontes) {
    const incluidos = [];
    fontes.forEach((fonte) => {
      fonte.registros.filter((r) => !r.excluido).forEach((r) => incluidos.push(r));
    });
    const fonteComHeader = fontes.find((f) => f.header && f.header.linha);
    return montarConteudo(fonteComHeader && fonteComHeader.header.linha, incluidos);
  }

  function mesmaCompetencia(fontes) {
    const comps = fontes.filter((f) => f.header).map((f) => f.header.competencia);
    return comps.length > 0 && comps.every((c) => c === comps[0]);
  }

  const api = {
    patchField, renumerar, linhaFinal, montarArquivo, montarArquivoUnico, mesmaCompetencia,
    hidratarFonte, CAMPOS_POR_PROBLEMA, CAMPO_LABEL, PROBLEMA_CATALOG,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CorrecaoBpaWriter = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
