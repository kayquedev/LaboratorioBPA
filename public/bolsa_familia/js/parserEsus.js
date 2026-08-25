(function (root) {
  "use strict";

  // Parseia o export CSV "Acompanhamento de cidadãos vinculados" do e-SUS
  // PEC. Não é um CSV simples com cabeçalho na linha 1 - tem um preâmbulo
  // (título, filtros aplicados, "gerado em...") antes da linha de cabeçalho
  // de verdade, que é a primeira cujo 1º campo é "Nome equipe". Delimitador
  // é ";" (padrão BR), com alguns campos entre aspas.

  function decodeArrayBuffer(buffer) {
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    // heurística simples de mojibake (UTF-8 decodificado como Latin-1 e
    // depois re-salvo, ou export em windows-1252 lido como utf-8): padrões
    // "Ã?" repetidos, ou caractere de substituição.
    const suspeito = (utf8.match(/Ã[-¿]|�/g) || []).length;
    if (suspeito > 2) {
      try {
        return new TextDecoder("windows-1252").decode(buffer);
      } catch (err) {
        return utf8;
      }
    }
    return utf8;
  }

  // parser de 1 linha CSV com suporte a campos entre aspas (com "" como
  // aspas literal escapada) - não assume que nunca haverá ";" dentro de aspas.
  function parseLinhaCsv(linha, delim) {
    const campos = [];
    let atual = "";
    let dentroAspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (dentroAspas) {
        if (c === '"') {
          if (linha[i + 1] === '"') { atual += '"'; i++; } else { dentroAspas = false; }
        } else {
          atual += c;
        }
      } else if (c === '"') {
        dentroAspas = true;
      } else if (c === delim) {
        campos.push(atual);
        atual = "";
      } else {
        atual += c;
      }
    }
    campos.push(atual);
    return campos.map((c) => c.trim());
  }

  function normalizarCabecalho(s) {
    return String(s || "")
      .normalize("NFD").replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  const NOMES_COLUNA = {
    microarea: ["microarea", "micro-area", "micro area"],
    nome: ["nome"],
    dataNascimento: ["data de nascimento", "data nascimento"],
    cpfCns: ["cpf/cns", "cpf / cns", "cpf ou cns"],
  };

  function acharIndiceColuna(cabecalhoNormalizado, candidatos) {
    for (const nome of candidatos) {
      const i = cabecalhoNormalizado.indexOf(nome);
      if (i !== -1) return i;
    }
    return -1;
  }

  function parseCsv(texto, delim) {
    delim = delim || ";";
    const linhasBrutas = texto.split(/\r\n|\r|\n/);

    let idxHeader = -1;
    let campos = [];
    for (let i = 0; i < linhasBrutas.length; i++) {
      const l = linhasBrutas[i];
      if (!l || !l.trim()) continue;
      const c = parseLinhaCsv(l, delim);
      if (normalizarCabecalho(c[0]) === "nome equipe") { idxHeader = i; campos = c; break; }
    }
    if (idxHeader === -1) {
      return { erro: "Não encontrei a linha de cabeçalho (esperava uma coluna \"Nome equipe\") - confirme se é o arquivo certo.", registros: [] };
    }

    const cabecalhoNorm = campos.map(normalizarCabecalho);
    const iMicroarea = acharIndiceColuna(cabecalhoNorm, NOMES_COLUNA.microarea);
    const iNome = acharIndiceColuna(cabecalhoNorm, NOMES_COLUNA.nome);
    const iDataNasc = acharIndiceColuna(cabecalhoNorm, NOMES_COLUNA.dataNascimento);
    const iCpfCns = acharIndiceColuna(cabecalhoNorm, NOMES_COLUNA.cpfCns);

    if (iMicroarea === -1 || iNome === -1 || iDataNasc === -1) {
      return {
        erro: "Não encontrei as colunas esperadas (Microárea / Nome / Data de nascimento) no cabeçalho do e-SUS - os nomes das colunas podem ter mudado.",
        registros: [],
      };
    }

    const registros = [];
    for (let i = idxHeader + 1; i < linhasBrutas.length; i++) {
      const l = linhasBrutas[i];
      if (!l || !l.trim()) continue;
      const c = parseLinhaCsv(l, delim);
      if (c.length < campos.length - 2) continue; // linha claramente incompleta/lixo
      registros.push({
        nome: c[iNome] || "",
        dataNascimento: c[iDataNasc] || "",
        microarea: c[iMicroarea] || "",
        cpfCns: iCpfCns !== -1 ? (c[iCpfCns] || "") : "",
      });
    }

    return { erro: null, registros, colunas: { iMicroarea, iNome, iDataNasc, iCpfCns } };
  }

  const api = { decodeArrayBuffer, parseLinhaCsv, parseCsv, normalizarCabecalho };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.EsusParser = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
