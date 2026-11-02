(function (root) {
  "use strict";

  // Parser CSV genérico e reutilizável pros relatórios do e-SUS PEC, que
  // sempre vêm com um preâmbulo (título, ministério/estado/município/
  // unidade, bloco FILTROS, "gerado em...") antes da linha de cabeçalho de
  // verdade - e cada tipo de relatório tem colunas diferentes. Em vez de um
  // parser hard-coded por formato, esse aqui acha o cabeçalho genericamente
  // e devolve cada linha como objeto chaveado pelo texto original da coluna.

  function decodeArrayBuffer(buffer) {
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    const suspeito = (utf8.match(/Ã[-¿]|�/g) || []).length;
    if (suspeito > 2) {
      try {
        return new TextDecoder("windows-1252").decode(buffer);
      } catch (err) {
        return utf8;
      }
    }
    return utf8;
  }

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

  const NOMES_CABECALHO_VALIDOS = ["nome", "nome equipe", "nome cidadao"];

  function pareceLinhaCabecalho(campos) {
    if (campos.length < 8) return false;
    return campos.some((c) => NOMES_CABECALHO_VALIDOS.indexOf(normalizarCabecalho(c)) !== -1);
  }

  function parseCsv(texto, delim) {
    delim = delim || ";";
    const linhasBrutas = texto.split(/\r\n|\r|\n/);

    const filtros = {};
    let idxHeader = -1;
    let campos = [];
    for (let i = 0; i < linhasBrutas.length; i++) {
      const l = linhasBrutas[i];
      if (!l || !l.trim()) continue;
      const c = parseLinhaCsv(l, delim);
      if (pareceLinhaCabecalho(c)) { idxHeader = i; campos = c; break; }
      if (c.length === 2 && c[0]) filtros[c[0].trim()] = c[1];
    }

    if (idxHeader === -1) {
      return { erro: "Não encontrei a linha de cabeçalho do relatório - confirme se é um export do e-SUS PEC.", cabecalho: [], linhas: [], filtros };
    }

    const linhas = [];
    for (let i = idxHeader + 1; i < linhasBrutas.length; i++) {
      const l = linhasBrutas[i];
      if (!l || !l.trim()) continue;
      const c = parseLinhaCsv(l, delim);
      const obj = {};
      campos.forEach((nomeCol, idx) => { obj[nomeCol.trim()] = c[idx] !== undefined ? c[idx] : ""; });
      linhas.push(obj);
    }

    return { erro: null, cabecalho: campos.map((c) => c.trim()), linhas, filtros };
  }

  const api = { decodeArrayBuffer, parseLinhaCsv, normalizarCabecalho, parseCsv };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CsvGenericoParser = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
