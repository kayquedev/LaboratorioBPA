(function (root) {
  "use strict";

  const COD_TIPO_LOGRADOURO = {
    ACESSO: "001", ALAMEDA: "004", AVENIDA: "008", AV: "008",
    BECO: "011", CAMINHO: "017", CONJUNTO: "020", CONJ: "020",
    ESTRADA: "031", EST: "031", FAZENDA: "037", JARDIM: "052",
    LADEIRA: "053", LARGO: "054", LOTEAMENTO: "056", PRACA: "065",
    PC: "065", PARQUE: "072", QUADRA: "077", RUA: "081",
    RODOVIA: "090", BR: "090", SITIO: "092", SERVIDAO: "094",
    SETOR: "095", TRAVESSA: "100", TV: "100", VIA: "101",
    VIADUTO: "103", VILA: "104", VIELA: "105", CHACARA: "481",
    CONDOMINIO: "485", AREA: "472", QUINTAS: "475",
    "1ª RUA": "552", "1A RUA": "552", "2ª RUA": "553", "2A RUA": "553",
    "3ª RUA": "554", "3A RUA": "554", "5ª RUA": "555", "5A RUA": "555",
    "4ª RUA": "556", "4A RUA": "556", "6ª RUA": "557", "6A RUA": "557",
    "7ª RUA": "558", "7A RUA": "558"
  };

  function stripAccents(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function clean(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  }

  function digits(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  function emptyAddress() {
    return {
      codTipo: "", tipoLogradouro: "", logradouro: "", numero: "",
      complemento: "", bairro: "", cidade: "", uf: "", cep: ""
    };
  }

  function splitStreet(value) {
    const text = clean(value);
    if (!text) return { codTipo: "", tipoLogradouro: "", logradouro: "" };
    const parts = text.split(" ");
    const normalized = stripAccents(text).toUpperCase();
    const typeKey = Object.keys(COD_TIPO_LOGRADOURO)
      .sort((left, right) => right.length - left.length)
      .find((key) => normalized === key || normalized.startsWith(key + " "));
    const code = typeKey ? COD_TIPO_LOGRADOURO[typeKey] : "";
    const typeParts = typeKey ? typeKey.split(" ").length : 0;
    if (!code || parts.length === typeParts) {
      return {
        codTipo: code,
        tipoLogradouro: code ? parts.slice(0, typeParts).join(" ") : "",
        logradouro: code ? "" : text
      };
    }
    return {
      codTipo: code,
      tipoLogradouro: parts.slice(0, typeParts).join(" "),
      logradouro: clean(parts.slice(typeParts).join(" "))
    };
  }

  // Formato padrão do relatório de vinculados do e-SUS:
  // "Praça VIA SINTETICA, 123. COMPLEMENTO - BAIRRO, CIDADE - UF | 00000-000"
  // Também aceita endereço manual mais simples, sem cidade/UF ou sem complemento.
  function parseEndereco(value) {
    const raw = clean(value);
    if (!raw || /^[-–—]+$/.test(raw)) return emptyAddress();

    const pipeParts = raw.split("|");
    let body = clean(pipeParts.shift());
    const cepDigits = digits(pipeParts.join(" "));
    const result = emptyAddress();
    result.cep = cepDigits.length === 8 ? cepDigits : "";

    let cityMatch = body.match(/,\s*([^,]+?)\s+-\s+([A-Za-z]{2})\s*$/);
    if (cityMatch) {
      result.cidade = clean(cityMatch[1]);
      result.uf = cityMatch[2].toUpperCase();
      body = clean(body.slice(0, cityMatch.index));
    }

    // Primeiro tenta o layout e-SUS: via, numero. restante
    let match = body.match(/^(.*?),\s*([^.,]+?)\.\s*(.*)$/);
    let streetText = body;
    let remainder = "";
    if (match) {
      streetText = clean(match[1]);
      result.numero = clean(match[2]);
      remainder = clean(match[3]);
    } else {
      // Fallback para entrada manual: via, numero - bairro
      match = body.match(/^(.*?),\s*(\d+|S\/?N|SN)\b[.,]?\s*(.*)$/i);
      if (match) {
        streetText = clean(match[1]);
        result.numero = clean(match[2]);
        remainder = clean(match[3]).replace(/^[-–—]\s*/, "");
      }
    }

    const street = splitStreet(streetText);
    result.codTipo = street.codTipo;
    result.tipoLogradouro = street.tipoLogradouro;
    result.logradouro = street.logradouro;

    if (remainder) {
      const separator = remainder.lastIndexOf(" - ");
      if (separator >= 0) {
        result.complemento = clean(remainder.slice(0, separator));
        result.bairro = clean(remainder.slice(separator + 3));
      } else {
        result.bairro = remainder;
      }
    }

    return result;
  }

  const api = { COD_TIPO_LOGRADOURO, parseEndereco };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoAddress = api;
})(typeof window !== "undefined" ? window : globalThis);
