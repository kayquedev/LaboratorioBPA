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

  function formatDate(value) {
    let date = String(value || "").replace(/\D/g, "");
    if (date.length === 8 && parseInt(date.slice(0, 4), 10) > 1900) {
      date = date.slice(6, 8) + date.slice(4, 6) + date.slice(0, 4);
    } else if (!(date.length === 8 && parseInt(date.slice(4, 8), 10) > 1900)) {
      date = "";
    }
    return date;
  }

  function montarLinhaBpaI(data) {
    let line = " ".repeat(351) + "N";
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
    line = patchNum(line, 59, 15, data.cnsPaciente || "");
    line = patchTxt(line, 74, 1, data.sexo || "");
    line = patchNum(line, 75, 6, data.ibge || "");
    line = patchTxt(line, 81, 4, data.cid || "");
    line = patchNum(line, 85, 9, data.numAutorizacao || "");
    line = patchNum(line, 94, 2, data.caraterAtendimento || "01");
    line = patchTxt(line, 112, 30, data.nome || "");
    line = patchNum(line, 142, 8, data.nasc || "");
    line = patchNum(line, 150, 2, data.racaCor || "99");
    line = patchTxt(line, 152, 4, data.etnia || "");
    line = patchNum(line, 156, 3, data.nacionalidade || "010");
    line = patchNum(line, 159, 3, data.servico || "");
    line = patchNum(line, 162, 3, data.classificacao || "");
    line = patchNum(line, 191, 8, data.cep || "");
    line = patchNum(line, 199, 3, data.codLogradouro || "");
    line = patchTxt(line, 202, 30, data.endereco || "");
    line = patchTxt(line, 232, 10, data.complemento || "");
    line = patchTxt(line, 242, 5, data.numero || "");
    line = patchTxt(line, 247, 30, data.bairro || "");
    line = patchNum(line, 277, 11, data.telefone || "");
    line = patchNum(line, 338, 11, data.cpfPaciente || "");
    return line;
  }

  const api = { patchNum, patchTxt, formatDate, montarLinhaBpaI };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoWriter = api;
})(typeof window !== "undefined" ? window : globalThis);
