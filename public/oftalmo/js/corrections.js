(function (root) {
  "use strict";

  /**
   * OftalmoCorrections - Módulo de correção manual com sugestões e confirmação.
   * Adaptado do fluxo de correcao_bpa, mas sem dependência de writer/parser BPA-C.
   * Opera sobre os objetos de paciente/procedimento do oftalmo diretamente.
   */

  const CAMPO_LABEL = {
    sigtap: "Procedimento SIGTAP",
    quantidade: "Quantidade",
    dataAtendimento: "Data Atendimento",
    nasc: "Data Nascimento",
    cnsPaciente: "CNS Paciente",
    cpfPaciente: "CPF Paciente",
    ibge: "Município IBGE",
    endereco: "Logradouro",
    bairro: "Bairro",
    cep: "CEP",
    racaCor: "Raça/Cor",
    nacionalidade: "Nacionalidade",
    servico: "Serviço",
    classificacao: "Classificação"
  };

  // Sugestões automáticas determinísticas (seguras, sem invenção de dados)
  const SUGESTOES_AUTO = {
    RACA_COR_AUSENTE: { campo: "racaCor", valor: "03", texto: "Parda (padrão IBGE quando não informado)" },
    NACIONALIDADE_AUSENTE: { campo: "nacionalidade", valor: "010", texto: "Brasileira" },
    CARATER_ATENDIMENTO_AUSENTE: { campo: "caraterAtendimento", valor: "01", texto: "Eletivo" }
  };

  /**
   * Gera sugestões de correção para uma ocorrência.
   * Retorna array de { campo, valorAtual, valorSugerido, justificativa, automatica }.
   * automática=true significa que pode ser aplicada sem confirmação (determinística).
   */
  function gerarSugestoes(ocorrencia, registro) {
    const sugestoes = [];
    const cod = ocorrencia.regraId || ocorrencia.codigo;

    // Sugestões automáticas determinísticas
    if (SUGESTOES_AUTO[cod]) {
      const auto = SUGESTOES_AUTO[cod];
      const atual = registro[auto.campo] || "";
      if (!atual || atual === "" || /^0+$/.test(atual)) {
        sugestoes.push({
          campo: auto.campo,
          label: CAMPO_LABEL[auto.campo] || auto.campo,
          valorAtual: atual || "(vazio)",
          valorSugerido: auto.valor,
          justificativa: auto.texto,
          automatica: true
        });
      }
    }

    // Sugestões manuais (exigem confirmação)
    if (cod === "SIGTAP_DV_INVALIDO") {
      // Não sugerir SIGTAP corrigido automaticamente - risco de inventar procedimento
      sugestoes.push({
        campo: "sigtap",
        label: CAMPO_LABEL.sigtap,
        valorAtual: registro.sigtap || "",
        valorSugerido: "",
        justificativa: "Verifique o código SIGTAP correto no catálogo oficial. O DV atual está incorreto.",
        automatica: false
      });
    }

    if (cod === "ENDERECO_INVALIDO") {
      if (!String(registro.endereco || "").trim()) {
        sugestoes.push({
          campo: "endereco",
          label: CAMPO_LABEL.endereco,
          valorAtual: registro.endereco || "",
          valorSugerido: "",
          justificativa: "Informe o logradouro do paciente. Não preencher com dados do estabelecimento.",
          automatica: false
        });
      }
      if (!String(registro.bairro || "").trim()) {
        sugestoes.push({
          campo: "bairro",
          label: CAMPO_LABEL.bairro,
          valorAtual: registro.bairro || "",
          valorSugerido: "",
          justificativa: "Informe o bairro real do paciente.",
          automatica: false
        });
      }
    }

    if (cod === "MUNICIPIO_INVALIDO") {
      sugestoes.push({
        campo: "ibge",
        label: CAMPO_LABEL.ibge,
        valorAtual: registro.ibge || "(vazio)",
        valorSugerido: "",
        justificativa: "Informe o código IBGE de residência do paciente (6-7 dígitos).",
        automatica: false
      });
    }

    if (cod === "CEP_INVALIDO") {
      sugestoes.push({
        campo: "cep",
        label: CAMPO_LABEL.cep,
        valorAtual: registro.cep || "(vazio)",
        valorSugerido: "",
        justificativa: "Informe o CEP de residência do paciente (8 dígitos).",
        automatica: false
      });
    }

    if (cod === "CLASSIFICACAO_INVALIDA") {
      // Mapa de procedimentos que exigem serviço/classificação específicos (mesmo da regra)
      const EXIGENTES = {
        '0701040050': { servico: '164', classificacao: '007' },
        '0211060127': { servico: '131', classificacao: '001' },
        '0211060224': { servico: '131', classificacao: '001' },
        '0211060232': { servico: '131', classificacao: '001' },
        '0211060259': { servico: '131', classificacao: '001' }
      };
      const req = EXIGENTES[registro.sigtap];
      if (req) {
        sugestoes.push({
          campo: "servico",
          label: CAMPO_LABEL.servico,
          valorAtual: registro.servico || "(vazio)",
          valorSugerido: req.servico,
          justificativa: "Procedimento exige Serviço " + req.servico + " conforme tabela SIGTAP.",
          automatica: true
        });
        sugestoes.push({
          campo: "classificacao",
          label: CAMPO_LABEL.classificacao,
          valorAtual: registro.classificacao || "(vazio)",
          valorSugerido: req.classificacao,
          justificativa: "Procedimento exige Classificação " + req.classificacao + " conforme tabela SIGTAP.",
          automatica: true
        });
      } else {
        sugestoes.push({
          campo: "servico_classificacao",
          label: "Serviço/Classificação",
          valorAtual: (registro.servico || "") + "/" + (registro.classificacao || ""),
          valorSugerido: "",
          justificativa: "Escolha o par Serviço/Classificação compatível com o procedimento SIGTAP.",
          automatica: false
        });
      }
    }

    return sugestoes;
  }

  /**
   * Aplica correções confirmadas ao registro do paciente/procedimento.
   * Preserva valores originais em _original para rastreabilidade.
   * Retorna o registro modificado.
   */
  function aplicarCorrecao(registro, correcoes) {
    if (!registro._original) {
      registro._original = {};
    }

    Object.keys(correcoes).forEach(function (campo) {
      const novoValor = correcoes[campo];
      if (novoValor === undefined || novoValor === null) return;

      // Salvar original apenas na primeira correção do campo
      if (!(campo in registro._original)) {
        registro._original[campo] = registro[campo];
      }

      registro[campo] = novoValor;
    });

    registro._corrigidoEm = new Date().toISOString();
    return registro;
  }

  /**
   * Reverte todas as correções de um registro, restaurando valores originais.
   */
  function reverterCorrecoes(registro) {
    if (!registro._original) return registro;

    Object.keys(registro._original).forEach(function (campo) {
      registro[campo] = registro._original[campo];
    });

    delete registro._original;
    delete registro._corrigidoEm;
    return registro;
  }

  /**
   * Verifica se um registro tem correções aplicadas.
   */
  function temCorrecoes(registro) {
    return !!(registro._original && Object.keys(registro._original).length > 0);
  }

  const api = {
    CAMPO_LABEL: CAMPO_LABEL,
    gerarSugestoes: gerarSugestoes,
    aplicarCorrecao: aplicarCorrecao,
    reverterCorrecoes: reverterCorrecoes,
    temCorrecoes: temCorrecoes
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoCorrections = api;
})(typeof window !== "undefined" ? window : globalThis);
