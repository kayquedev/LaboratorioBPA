(function (root) {
  "use strict";

  // Catálogo de regras SIGTAP e validações BPA-I adaptado para Oftalmologia
  // Baseado na auditoria dos módulos qualidade_bpa e correcao_bpa
  // Cada regra: id, severidade (erro|aviso), texto, explicacao, resolver, validar(registro, contexto) => boolean

  const REGRAS = [
    {
      id: "SIGTAP_INVALIDO",
      sev: "erro",
      texto: "SIGTAP inválido",
      explicacao: "O código do procedimento não tem 10 dígitos numéricos ou é só zeros.",
      resolver: "Confira o código SIGTAP (10 dígitos) na tabela oficial da competência.",
      validar: (r) => /^\d{10}$/.test(r.sigtap) && !/^0+$/.test(r.sigtap)
    },
    {
      id: "SIGTAP_DV_INVALIDO",
      sev: "erro",
      texto: "Dígito verificador do procedimento incorreto",
      explicacao: "O 10º dígito do SIGTAP (módulo 11) não confere com os 9 primeiros.",
      resolver: "Confira o código completo no SIGTAP oficial e corrija.",
      validar: (r) => {
        if (!/^\d{10}$/.test(r.sigtap)) return true; // já pego por SIGTAP_INVALIDO
        let soma = 0;
        for (let i = 0; i < 9; i++) soma += (+r.sigtap[i]) * (i + 1);
        const dv = soma % 11;
        return (dv === 10 ? 0 : dv) === +r.sigtap[9];
      }
    },
    {
      id: "QUANTIDADE_INVALIDA",
      sev: "erro",
      texto: "Quantidade inválida",
      explicacao: "A quantidade informada é zero ou negativa.",
      resolver: "Corrija a quantidade para um valor maior que zero.",
      validar: (r) => r.quantidade > 0
    },
    {
      id: "CBO_INVALIDO",
      sev: "erro",
      texto: "CBO inválido",
      explicacao: "O código CBO do profissional não tem 6 dígitos numéricos.",
      resolver: "Verifique o CBO cadastrado para o profissional responsável.",
      validar: (r, ctx) => /^\d{6}$/.test(ctx.cbo)
    },
    {
      id: "DATA_ATENDIMENTO_INVALIDA",
      sev: "erro",
      texto: "Data de atendimento inválida",
      explicacao: "A data de atendimento não é uma data real ou está vazia.",
      resolver: "Informe uma data válida (dd/mm/yyyy) dentro da competência.",
      validar: (r) => {
        if (!r.dataAtendimento) return false;
        const parts = r.dataAtendimento.split("/");
        if (parts.length !== 3) return false;
        const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
        if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
      }
    },
    {
      id: "DATA_FORA_COMPETENCIA",
      sev: "erro",
      texto: "Data fora da competência",
      explicacao: "A data de atendimento não está dentro do mês/ano da competência do arquivo.",
      resolver: "Ajuste a data de atendimento ou a competência selecionada.",
      validar: (r, ctx) => {
        if (!r.dataAtendimento || !ctx.competencia) return true;
        const parts = r.dataAtendimento.split("/");
        if (parts.length !== 3) return true;
        const mmYy = parts[2] + parts[1];
        return mmYy === ctx.competencia;
      }
    },
    {
      id: "NASCIMENTO_INVALIDO",
      sev: "aviso",
      texto: "Data de nascimento inválida",
      explicacao: "A data de nascimento do paciente não é uma data real.",
      resolver: "Confira o cadastro do paciente e corrija a data de nascimento.",
      validar: (r) => {
        if (!r.nasc) return false;
        const parts = r.nasc.split("/");
        if (parts.length !== 3) return false;
        const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
        if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
      }
    },
    {
      id: "PACIENTE_SEM_IDENTIFICACAO",
      sev: "erro",
      texto: "Paciente sem CNS nem CPF",
      explicacao: "A linha do BPA-I não traz CNS nem CPF do paciente. O BPA Magnético exige identificação.",
      resolver: "Informe o CNS (15 dígitos) ou o CPF do paciente.",
      validar: (r) => {
        const temCns = r.cnsPaciente && r.cnsPaciente.length === 15;
        const temCpf = r.cpfPaciente && r.cpfPaciente.length === 11;
        return temCns || temCpf;
      }
    },
    {
      id: "CNS_PACIENTE_INVALIDO",
      sev: "aviso",
      texto: "CNS do paciente com dígito verificador inválido",
      explicacao: "O CNS informado não passa na validação de dígito verificador.",
      resolver: "Confira o CNS do paciente (15 dígitos) no CADSUS.",
      validar: (r) => {
        if (!r.cnsPaciente || r.cnsPaciente.length !== 15) return true; // ausência já pega por outra regra
        const cns = r.cnsPaciente;
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
    },
    {
      id: "CPF_PACIENTE_INVALIDO",
      sev: "aviso",
      texto: "CPF do paciente inválido",
      explicacao: "O CPF informado não passa na validação de dígito verificador.",
      resolver: "Confira o CPF do paciente no cadastro.",
      validar: (r) => {
        if (!r.cpfPaciente || r.cpfPaciente.length !== 11) return true;
        const cpf = r.cpfPaciente;
        if (/^(\d)\1{10}$/.test(cpf)) return false;
        let s = 0;
        for (let i = 0; i < 9; i++) s += (+cpf[i]) * (10 - i);
        let d1 = 11 - (s % 11); if (d1 >= 10) d1 = 0;
        if (d1 !== +cpf[9]) return false;
        s = 0;
        for (let i = 0; i < 10; i++) s += (+cpf[i]) * (11 - i);
        let d2 = 11 - (s % 11); if (d2 >= 10) d2 = 0;
        return d2 === +cpf[10];
      }
    },
    {
      id: "MUNICIPIO_INVALIDO",
      sev: "erro",
      texto: "Município de residência inválido",
      explicacao: "O código IBGE do município está em branco, zerado ou não tem 6–7 dígitos.",
      resolver: "Preencha o código IBGE do município de residência (6 dígitos).",
      validar: (r) => r.ibge && /^\d{6,7}$/.test(r.ibge) && !/^0+$/.test(r.ibge)
    },
    {
      id: "ENDERECO_INVALIDO",
      sev: "erro",
      texto: "Endereço do paciente inválido",
      explicacao: "O logradouro ou o bairro do paciente está em branco na linha do BPA-I.",
      resolver: "Preencha logradouro, número (ou 'SN') e bairro do paciente.",
      validar: (r) => String(r.endereco || "").trim() !== "" && String(r.bairro || "").trim() !== ""
    },
    {
      id: "CEP_INVALIDO",
      sev: "erro",
      texto: "CEP inválido",
      explicacao: "O CEP do paciente não tem 8 dígitos ou está zerado.",
      resolver: "Confira o CEP no cadastro do paciente.",
      validar: (r) => r.cep && /^\d{8}$/.test(r.cep) && !/^0+$/.test(r.cep)
    },
    {
      id: "CLASSIFICACAO_INVALIDA",
      sev: "erro",
      texto: "Serviço/Classificação inválido para o procedimento",
      explicacao: "O procedimento exige um par Serviço/Classificação específico e o informado está em branco ou não é aceito.",
      resolver: "Ajuste os campos Serviço e Classificação para um par válido do procedimento.",
      validar: (r) => {
        // Procedimentos de oftalmo que exigem serviço/classificação específicos
        const EXIGENTES = {
          '0701040050': { servico: '164', classificacao: '007' },
          '0211060127': { servico: '131', classificacao: '001' },
          '0211060224': { servico: '131', classificacao: '001' },
          '0211060232': { servico: '131', classificacao: '001' },
          '0211060259': { servico: '131', classificacao: '001' }
        };
        const req = EXIGENTES[r.sigtap];
        if (!req) return true; // procedimento não exige
        return r.servico === req.servico && r.classificacao === req.classificacao;
      }
    },
    {
      id: "RACA_COR_AUSENTE",
      sev: "aviso",
      texto: "Raça/cor não informada",
      explicacao: "O campo raça/cor do paciente está em branco.",
      resolver: "Preencha a raça/cor (01 branca, 02 preta, 03 parda, 04 amarela, 05 indígena, 99 sem informação).",
      validar: (r) => r.racaCor && r.racaCor.trim().length > 0
    },
    {
      id: "NACIONALIDADE_AUSENTE",
      sev: "aviso",
      texto: "Nacionalidade não informada",
      explicacao: "O campo nacionalidade do paciente está em branco.",
      resolver: "Preencha a nacionalidade (010 = brasileira).",
      validar: (r) => r.nacionalidade && r.nacionalidade.trim().length > 0
    },
    {
      id: "CARATER_ATENDIMENTO_AUSENTE",
      sev: "aviso",
      texto: "Caráter do atendimento não informado",
      explicacao: "O caráter do atendimento (01 = eletivo, 02 = urgência) está em branco.",
      resolver: "Preencha o caráter do atendimento.",
      validar: (r) => r.caraterAtendimento && r.caraterAtendimento.trim().length > 0
    }
  ];

  /**
   * Analisa um lote de registros e retorna ocorrências
   * @param {Array} registros - Array de objetos com dados normalizados para exportação
   * @param {Object} contexto - { competencia, cbo, cnes, cnsProfissional }
   * @returns {{ ocorrencias: Array, totalErros: number, totalAvisos: number }}
   */
  function analisarLote(registros, contexto) {
    const ocorrencias = [];
    let totalErros = 0;
    let totalAvisos = 0;

    registros.forEach((reg, idx) => {
      REGRAS.forEach(regra => {
        try {
          if (!regra.validar(reg, contexto)) {
            ocorrencias.push({
              indice: idx,
              paciente: reg.nome || "(sem nome)",
              sigtap: reg.sigtap || "",
              regraId: regra.id,
              severidade: regra.sev,
              texto: regra.texto,
              explicacao: regra.explicacao,
              resolver: regra.resolver,
              _registro: reg
            });
            if (regra.sev === "erro") totalErros++;
            else totalAvisos++;
          }
        } catch (_) {
          // Regra que falha não deve bloquear as demais
        }
      });
    });

    return { ocorrencias, totalErros, totalAvisos };
  }

  const api = {
    REGRAS: REGRAS,
    analisarLote: analisarLote
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoRules = api;
})(typeof window !== "undefined" ? window : globalThis);
