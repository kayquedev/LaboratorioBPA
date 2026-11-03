(function (root) {
  "use strict";

  function stripAccents(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function pad2(value) { return String(value).padStart(2, "0"); }

  function normalizeName(value) {
    return stripAccents(String(value || "").toUpperCase().trim()).replace(/\s+/g, " ");
  }

  function normalizeBirthDate(value) {
    if (value instanceof Date && !isNaN(value)) {
      return pad2(value.getDate()) + "/" + pad2(value.getMonth() + 1) + "/" + value.getFullYear();
    }
    const text = String(value || "").trim();
    let match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (match) return pad2(match[1]) + "/" + pad2(match[2]) + "/" + match[3];
    if (/^\d{8}$/.test(text)) return text.slice(6, 8) + "/" + text.slice(4, 6) + "/" + text.slice(0, 4);
    match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (match) return pad2(match[3]) + "/" + pad2(match[2]) + "/" + match[1];
    return text;
  }

  function citizenKey(name, birthDate) {
    const parts = normalizeBirthDate(birthDate).split("/");
    const dateKey = parts.length === 3 ? parts[2] + parts[1] + parts[0] : "";
    return normalizeName(name) + "|" + dateKey;
  }

  function sameCitizen(left, right) {
    if (!left || !right) return false;
    const leftKey = citizenKey(left.nome, left.nasc);
    return leftKey !== "|" && leftKey === citizenKey(right.nome, right.nasc);
  }

  function parseCpfCns(rawValue) {
    const raw = String(rawValue == null ? "" : rawValue).trim();
    let digits;
    if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(raw) && Number.isFinite(Number(raw))) {
      digits = String(Math.round(Number(raw)));
    } else {
      digits = raw.replace(/\D/g, "");
    }
    return { cpf: digits.length === 11 ? digits : "", cns: digits.length === 15 ? digits : "" };
  }

  function fingerprint(citizen) {
    return [
      citizen.cns || "", citizen.cpf || "", citizen.endereco || "", citizen.numero || "",
      citizen.complemento || "", citizen.bairro || "", citizen.cep || "", citizen.sexo || "",
      citizen.telefone || ""
    ].map(normalizeName).join("|");
  }

  function indexCitizen(index, ambiguousKeys, citizen) {
    const key = citizenKey(citizen.nome, citizen.nasc);
    if (!key || key === "|") return { status: "invalid", key: key };
    if (ambiguousKeys.has(key)) return { status: "ambiguous", key: key };
    const existing = index.get(key);
    if (!existing) {
      index.set(key, citizen);
      return { status: "added", key: key };
    }
    if (fingerprint(existing) === fingerprint(citizen)) return { status: "duplicate", key: key };
    index.delete(key);
    ambiguousKeys.add(key);
    return { status: "ambiguous", key: key };
  }

  function linkedPatientData(scheduleRow, citizen, fallbackIbge) {
    if (!sameCitizen(scheduleRow, citizen)) return null;
    return {
      nome: citizen.nome, nasc: normalizeBirthDate(citizen.nasc),
      comunidade: scheduleRow.comunidade || "", cns: citizen.cns || "", cpf: citizen.cpf || "",
      microarea: citizen.microarea || "", equipe: citizen.equipe || "",
      endereco: citizen.endereco || "", codLogradouro: citizen.codLogradouro || "",
      ibge: citizen.ibge || fallbackIbge || "", cep: citizen.cep || "", sexo: citizen.sexo || "",
      bairro: citizen.bairro || "", numero: citizen.numero || "", complemento: citizen.complemento || "",
      telefone: citizen.telefone || "", match: true, vinculado: true, origemVinculo: "esus"
    };
  }

  const api = { normalizeName, normalizeBirthDate, citizenKey, sameCitizen, parseCpfCns, indexCitizen, linkedPatientData };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoLinking = api;
})(typeof window !== "undefined" ? window : globalThis);
