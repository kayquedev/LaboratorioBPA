(function (root) {
  "use strict";

  const COPY_FIELDS = [
    "nome", "nasc", "cns", "cpf", "ibge", "cep", "cbo", "microarea",
    "equipe", "endereco", "codLogradouro", "numero", "complemento",
    "bairro", "telefone", "sexo", "nacionalidade", "racaCor", "dataAtendimento"
  ];

  function applyPatientData(patient, data) {
    COPY_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field) && data[field] != null) {
        patient[field] = data[field];
      }
    });
    patient.match = true;
    patient.vinculado = true;
    patient.origemVinculo = data.origem || patient.origemVinculo || "manual";
    return patient;
  }

  function createPatient(id, data) {
    const patient = {
      id,
      nome: "", nasc: "", cns: "", cpf: "", ibge: "", cep: "", cbo: "",
      microarea: "", equipe: "", comunidade: "", endereco: "",
      codLogradouro: "", numero: "", complemento: "", bairro: "",
      telefone: "", sexo: "", nacionalidade: "", racaCor: "",
      match: true, vinculado: true, origemVinculo: data.origem || "manual",
      naoCompareceu: false, dataAtendimento: "", procedimentos: []
    };
    return applyPatientData(patient, data);
  }

  const api = { COPY_FIELDS, applyPatientData, createPatient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OftalmoPatient = api;
})(typeof window !== "undefined" ? window : globalThis);
