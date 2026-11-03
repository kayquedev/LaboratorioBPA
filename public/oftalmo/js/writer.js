(function (root) {
  "use strict";

  function patchNum(line, start, len, value) {
    let text = String(value == null ? "" : value).replace(/\D/g, "");
    if (!text) text = "0";
    if (text.length > len) text = text.slice(-len);
    text = text.padStart(len, "0");
    return line.slice(0, start) + text + line.slice(start + len);
  }

  function patchTxt(line, start, len, value) {
    let text = String(value == null ? "" : value).toUpperCase();
    text = (text + " ".repeat(len)).slice(0, len);
    return line.slice(0, start) + text + line.slice(start + len);
  }

  function patchOptionalNum(line, start, len, value) {
    const digits = String(value == null ? "" : value).replace(/\D/g, "");
    return digits ? patchNum(line, start, len, digits) : line;
  }

  function validYmd(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  function formatDate(value) {
    const text = String(value || "").trim();
    let match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (match && validYmd(match[1], match[2], match[3])) {
      return match[1] + match[2].padStart(2, "0") + match[3].padStart(2, "0");
    }
    match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (match && validYmd(match[3], match[2], match[1])) {
      return match[3] + match[2].padStart(2, "0") + match[1].padStart(2, "0");
    }
    const digits = text.replace(/\D/g, "");
    if (digits.length !== 8) return "";
    if (validYmd(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8))) return digits;
    if (validYmd(digits.slice(4, 8), digits.slice(2, 4), digits.slice(0, 2))) {
      return digits.slice(4, 8) + digits.slice(2, 4) + digits.slice(0, 2);
    }
    return "";
  }

  function montarCabecalhoBpa(data) {
    const values = data || {};
    let line = " ".repeat(126);
    line = patchTxt(line, 0, 2, "01");
    line = patchTxt(line, 2, 5, "#BPA#");
    line = patchNum(line, 7, 6, values.competencia || "");
    line = patchNum(line, 13, 6, values.numLinhas || 0);
    line = patchNum(line, 19, 6, values.numFolhas || 0);
    line = patchNum(line, 25, 4, values.controle || "1111");
    line = patchTxt(line, 29, 30, values.orgOrigem || "");
    line = patchTxt(line, 59, 6, values.siglaOrigem || "");
    line = patchOptionalNum(line, 65, 14, values.cgcCpf || "");
    line = patchTxt(line, 79, 40, values.orgDestino || "");
    line = patchTxt(line, 119, 1, values.indDestino || "M");
    line = patchTxt(line, 120, 6, values.versao || "D05.00");
    return line;
  }

  function encodeLatin1(value) {
    const text = String(value == null ? "" : value);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[i] = code <= 255 ? code : 63;
    }
    return bytes;
  }

  function montarLinhaBpaI(data) {
    // Layout BPA-I: 351 posições; situação de rua fica na posição 350 (N = não).
    let line = " ".repeat(349) + "N" + " ";
    line = patchTxt(line, 0, 2, data.tipo || "03");
    line = patchNum(line, 2, 7, data.cnes || "");
    line = patchNum(line, 9, 6, data.competencia || "");
    line = patchNum(line, 15, 15, data.cnsProfissional || "");
    line = patchNum(line, 30, 6, data.cbo || "");
    line = patchNum(line, 36, 8, formatDate(data.dataAtendimento));
    line = patchNum(line, 44, 3, data.folha || 1);
    line = patchNum(line, 47, 2, data.sequencia || 1);
    line = patchNum(line, 49, 10, data.sigtap || "");
    // BPA-I não possui quantidade entre SIGTAP e CNS; uma linha representa um atendimento.
    line = patchOptionalNum(line, 59, 15, data.cnsPaciente || "");
    line = patchTxt(line, 74, 1, data.sexo || "");
    line = patchNum(line, 75, 6, data.ibge || "");
    line = patchTxt(line, 81, 4, data.cid || "");
    line = patchOptionalNum(line, 85, 9, data.numAutorizacao || "");
    line = patchNum(line, 94, 2, data.caraterAtendimento || "01");
    line = patchTxt(line, 112, 30, data.nome || "");
    line = patchNum(line, 142, 8, formatDate(data.nasc));
    line = patchNum(line, 150, 2, data.racaCor || "99");
    line = patchTxt(line, 152, 4, data.etnia || "");
    line = patchNum(line, 156, 3, data.nacionalidade || "010");
    // O BPA Magnético converte estes campos para inteiro durante a importação.
    // Consulta não exige preenchimento pelo usuário, mas o layout usa 000/000,
    // como no arquivo de referência, em vez de espaços vazios.
    line = patchNum(line, 159, 3, data.servico || "0");
    line = patchNum(line, 162, 3, data.classificacao || "0");
    line = patchNum(line, 191, 8, data.cep || "");
    line = patchNum(line, 199, 3, data.codLogradouro || "");
    line = patchTxt(line, 202, 30, data.endereco || "");
    line = patchTxt(line, 232, 10, data.complemento || "");
    line = patchTxt(line, 242, 5, data.numero || "");
    line = patchTxt(line, 247, 30, data.bairro || "");
    line = patchOptionalNum(line, 277, 11, data.telefone || "");
    line = patchOptionalNum(line, 338, 11, data.cpfPaciente || "");
    return line;
  }

  const api = {
    patchNum, patchTxt, patchOptionalNum, formatDate,
    montarCabecalhoBpa, montarLinhaBpaI, encodeLatin1
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoWriter = api;
})(typeof window !== "undefined" ? window : globalThis);
