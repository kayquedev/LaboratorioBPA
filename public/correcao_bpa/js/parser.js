(function (root) {
  "use strict";

  // Layout fixo do arquivo BPA Magnetico (tipo 01 = cabecalho, 02 = BPA-C,
  // 03 = BPA-I). Campos marcados "best-effort" abaixo tem a posicao
  // aproximada, derivada comparando varias linhas de amostra reais -
  // ajustar aqui se um arquivo maior mostrar offset errado.

  function cut(line, start, len) {
    return line.slice(start, start + len);
  }
  function trim(s) {
    return String(s == null ? "" : s).trim();
  }
  function toInt(s) {
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  function parseHeader(line) {
    return {
      tipo: "01",
      linha: line,
      competencia: cut(line, 7, 6),
      numLinhas: toInt(cut(line, 13, 6)),
      numFolhas: toInt(cut(line, 19, 6)),
    };
  }

  function parseTipo02(line) {
    return {
      tipo: "02",
      linha: line,
      cnes: cut(line, 2, 7),
      competencia: cut(line, 9, 6),
      cbo: cut(line, 15, 6),
      folha: toInt(cut(line, 21, 3)),
      seq: toInt(cut(line, 24, 2)),
      sigtap: cut(line, 26, 10),
      idade: toInt(cut(line, 36, 3)),
      quantidade: toInt(cut(line, 39, 6)),
    };
  }

  function parseTipo03(line) {
    return {
      tipo: "03",
      linha: line,
      cnes: cut(line, 2, 7),
      competencia: cut(line, 9, 6),
      cnsProfissional: trim(cut(line, 15, 15)),
      cbo: cut(line, 30, 6),
      dataAtendimento: cut(line, 36, 8),
      folha: toInt(cut(line, 44, 3)),
      seq: toInt(cut(line, 47, 2)),
      sigtap: cut(line, 49, 10),
      quantidade: 1, // BPA-I: uma linha = um atendimento
      cnsCpfPaciente: trim(cut(line, 59, 15)), // CNS do paciente (posicoes 60-74)
      sexo: trim(cut(line, 74, 1)),
      municipioIbge: trim(cut(line, 75, 6)),
      cid: trim(cut(line, 81, 4)),
      caraterAtendimento: trim(cut(line, 94, 2)),
      nomePaciente: trim(cut(line, 112, 30)),
      dataNascimento: cut(line, 142, 8),
      racaCor: trim(cut(line, 150, 2)),
      etnia: trim(cut(line, 152, 4)),
      nacionalidade: trim(cut(line, 156, 3)),
      servico: trim(cut(line, 159, 3)),
      classificacao: trim(cut(line, 162, 3)),
      cep: trim(cut(line, 191, 8)),
      codLogradouro: trim(cut(line, 199, 3)),
      endereco: trim(cut(line, 202, 30)),
      complemento: trim(cut(line, 232, 10)),
      numero: trim(cut(line, 242, 5)),
      bairro: trim(cut(line, 247, 30)),
      telefone: trim(cut(line, 277, 11)),
      cpfPaciente: trim(cut(line, 338, 11)), // CPF do paciente (posicoes 339-349)
    };
  }

  function parseFile(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .filter((l) => l.length > 0);

    const result = { header: null, registros: [], linhasIgnoradas: [] };

    lines.forEach((line, idx) => {
      const tipo = line.slice(0, 2);
      if (tipo === "01") {
        result.header = parseHeader(line);
      } else if (tipo === "02") {
        result.registros.push(parseTipo02(line));
      } else if (tipo === "03") {
        result.registros.push(parseTipo03(line));
      } else {
        result.linhasIgnoradas.push({ numero: idx + 1, conteudo: line });
      }
    });

    return result;
  }

  const api = { parseHeader, parseTipo02, parseTipo03, parseFile };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.QualidadeBpaParser = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
