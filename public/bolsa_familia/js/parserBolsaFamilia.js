(function (root) {
  "use strict";

  // Parseia o "Mapa de Acompanhamento" do Bolsa Familia (export HTML) sem
  // DOMParser - so regex - pra rodar identico no navegador e no Node (teste).
  // Estrutura real do arquivo: 1 tabela, com linhas de titulo/agrupamento no
  // topo (ignoradas), depois blocos repetidos por familia: 1 linha de
  // cabecalho da familia (Codigo Familiar / Endereco / EAS / Profissional)
  // seguida de N linhas de integrante (NIS, CNS, Nome, Data nascimento, e
  // mais 11 campos de acompanhamento de saude, quase sempre vazios).

  const ENTIDADES = {
    aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â",
    atilde: "ã", Atilde: "Ã", eacute: "é", Eacute: "É", ecirc: "ê", Ecirc: "Ê",
    iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó", ocirc: "ô", Ocirc: "Ô",
    otilde: "õ", Otilde: "Õ", uacute: "ú", Uacute: "Ú", ccedil: "ç", Ccedil: "Ç",
    ordf: "ª", ordm: "º", nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  };

  function decodeEntities(s) {
    return String(s || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
      if (code[0] === "#") {
        const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
      }
      return code in ENTIDADES ? ENTIDADES[code] : m;
    });
  }

  function cellPlainText(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  // "15 - Codigo Familiar:8895482" -> "8895482" (tira ate o primeiro ":")
  function valorAposDoisPontos(texto) {
    const i = texto.indexOf(":");
    return (i === -1 ? texto : texto.slice(i + 1)).trim();
  }

  // "2 -  BEATRIZ PEREIRA SANTOS" -> "BEATRIZ PEREIRA SANTOS" (tira o rotulo numerico)
  function valorAposRotuloNumerico(texto) {
    return texto.replace(/^\d+(\.\d+)?\s*-\s*/, "").trim();
  }

  function extrairLinhas(html) {
    const linhas = [];
    const reLinha = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = reLinha.exec(html))) {
      const celulas = [];
      const reCel = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let c;
      while ((c = reCel.exec(m[1]))) celulas.push(cellPlainText(c[1]));
      linhas.push(celulas);
    }
    return linhas;
  }

  const CAMPOS_INTEGRANTE = [
    "nis", "cns", "nome", "dataNascimento", "dataAcompanhamento",
    "ocorrenciaNaoAcompanhamento", "peso", "estatura", "ocorrenciaNaoNutricional",
    "vacinacaoEmDia", "ocorrenciaNaoVacinacao", "informacaoGestacional",
    "realizouPreNatal", "ocorrenciaNaoPreNatal", "dum",
  ];

  function parseHtml(html) {
    const linhas = extrairLinhas(html);
    const beneficiarios = [];
    let familiaAtual = { codigoFamiliar: "", endereco: "", eas: "", profissional: "" };

    linhas.forEach((celulas) => {
      if (!celulas.length) return;
      const primeira = celulas[0];

      if (/c[oó]digo\s+familiar/i.test(primeira)) {
        familiaAtual = {
          codigoFamiliar: valorAposDoisPontos(primeira),
          endereco: celulas[1] ? valorAposDoisPontos(celulas[1]) : "",
          eas: celulas[2] ? valorAposDoisPontos(celulas[2]) : "",
          profissional: celulas[3] ? valorAposDoisPontos(celulas[3]) : "",
        };
        return;
      }

      if (/^\d+\s*-/.test(primeira) && celulas.length >= 4) {
        const registro = { fonte: "bolsa_familia" };
        CAMPOS_INTEGRANTE.forEach((campo, i) => {
          registro[campo] = celulas[i] ? valorAposRotuloNumerico(celulas[i]) : "";
        });
        registro.codigoFamiliar = familiaAtual.codigoFamiliar;
        registro.endereco = familiaAtual.endereco;
        registro.eas = familiaAtual.eas;
        registro.profissional = familiaAtual.profissional;
        if (registro.nis || registro.nome) beneficiarios.push(registro);
      }
    });

    return beneficiarios;
  }

  const COLUNAS_SAIDA = [
    { campo: "nis", titulo: "NIS" },
    { campo: "cns", titulo: "CNS" },
    { campo: "nome", titulo: "Nome" },
    { campo: "microarea", titulo: "Microárea" },
    { campo: "dataNascimento", titulo: "Data de nascimento" },
    { campo: "dataAcompanhamento", titulo: "Data de acompanhamento" },
    { campo: "ocorrenciaNaoAcompanhamento", titulo: "Ocorrência - Não acompanhamento" },
    { campo: "peso", titulo: "Peso em kg" },
    { campo: "estatura", titulo: "Estatura em cm" },
    { campo: "ocorrenciaNaoNutricional", titulo: "Ocorrência - Não Informação Nutricional" },
    { campo: "vacinacaoEmDia", titulo: "Vacinação em dia?" },
    { campo: "ocorrenciaNaoVacinacao", titulo: "Ocorrência - Não Vacinação" },
    { campo: "informacaoGestacional", titulo: "Informação Gestacional" },
    { campo: "realizouPreNatal", titulo: "Realizou o Pré-Natal?" },
    { campo: "ocorrenciaNaoPreNatal", titulo: "Ocorrência - Não Pré-Natal" },
    { campo: "dum", titulo: "DUM" },
    { campo: "codigoFamiliar", titulo: "Código Familiar" },
    { campo: "endereco", titulo: "Endereço" },
    { campo: "eas", titulo: "EAS" },
    { campo: "profissional", titulo: "Profissional" },
  ];

  // o export declara o charset no próprio <meta>; decodifica um trecho
  // inicial em latin1 (superset seguro pra ascii) só pra achar essa
  // declaração, depois decodifica o buffer inteiro com o charset certo.
  function decodeArrayBuffer(buffer) {
    const amostra = new TextDecoder("iso-8859-1").decode(buffer.slice(0, 2048));
    const m = /charset=["']?([\w-]+)/i.exec(amostra);
    let charset = (m && m[1] || "utf-8").toLowerCase();
    if (charset === "windows-1252" || charset === "cp1252") charset = "windows-1252";
    else if (charset === "iso-8859-1" || charset === "latin1") charset = "iso-8859-1";
    else charset = "utf-8";
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch (err) {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }

  const api = { parseHtml, COLUNAS_SAIDA, decodeEntities, cellPlainText, decodeArrayBuffer };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BolsaFamiliaParser = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
