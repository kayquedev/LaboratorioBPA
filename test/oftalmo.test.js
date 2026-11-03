"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const address = require("../public/oftalmo/js/address");
const patient = require("../public/oftalmo/js/patient");
const writer = require("../public/oftalmo/js/writer");
const rules = require("../public/oftalmo/js/rules");
const corrections = require("../public/oftalmo/js/corrections");
const qualidadeParser = require("../public/qualidade_bpa/js/parser");

test("Oftalmo separa o endereço padrão do relatório de vinculados", () => {
  const parsed = address.parseEndereco(
    "Praça VIA SINTETICA, 123. CASA FUNDOS - BAIRRO TESTE, CIDADE TESTE - UF | 00000-000"
  );
  assert.deepEqual(parsed, {
    codTipo: "065",
    tipoLogradouro: "Praça",
    logradouro: "VIA SINTETICA",
    numero: "123",
    complemento: "CASA FUNDOS",
    bairro: "BAIRRO TESTE",
    cidade: "CIDADE TESTE",
    uf: "UF",
    cep: "00000000"
  });
});

test("Oftalmo separa exatamente o exemplo Rua do relatório de vinculados", () => {
  const parsed = address.parseEndereco(
    "Rua DR EZEQUIEL DE MACEDO, 221. CASA - CENTRO, São Gonçalo do Pará - MG | 35544-000"
  );
  assert.deepEqual(parsed, {
    codTipo: "081",
    tipoLogradouro: "Rua",
    logradouro: "DR EZEQUIEL DE MACEDO",
    numero: "221",
    complemento: "CASA",
    bairro: "CENTRO",
    cidade: "São Gonçalo do Pará",
    uf: "MG",
    cep: "35544000"
  });
});

test("Oftalmo não transforma UF em bairro e trata hífen como endereço ausente", () => {
  const parsed = address.parseEndereco(
    "Rua VIA SINTETICA, 45. BAIRRO TESTE, CIDADE TESTE - UF | 00000-000"
  );
  assert.equal(parsed.bairro, "BAIRRO TESTE");
  assert.equal(parsed.uf, "UF");
  assert.equal(parsed.codTipo, "081");
  assert.equal(address.parseEndereco("-").logradouro, "");
});

test("vinculação e preenchimento manual preservam todos os campos do endereço", () => {
  const original = patient.createPatient(1, { nome: "PACIENTE TESTE", nasc: "01/01/2000" });
  patient.applyPatientData(original, {
    endereco: "VIA SINTETICA",
    codLogradouro: "081",
    numero: "123",
    complemento: "CASA",
    bairro: "BAIRRO TESTE",
    cep: "00000000",
    origem: "esus"
  });
  assert.deepEqual(
    [original.endereco, original.codLogradouro, original.numero, original.complemento, original.bairro, original.cep],
    ["VIA SINTETICA", "081", "123", "CASA", "BAIRRO TESTE", "00000000"]
  );
});

test("validação bloqueia logradouro ou bairro ausente e oferece correção sem inventar valor", () => {
  const base = {
    nome: "PACIENTE TESTE", sigtap: "0301010072", quantidade: 1,
    dataAtendimento: "01/11/2026", nasc: "01/01/2000",
    cnsPaciente: "", cpfPaciente: "00000000000", ibge: "000000",
    endereco: "", bairro: "", cep: "00000000", racaCor: "03",
    nacionalidade: "010", caraterAtendimento: "01", servico: "", classificacao: ""
  };
  const result = rules.analisarLote([base], { competencia: "202611", cbo: "225265" });
  const occurrence = result.ocorrencias.find((item) => item.regraId === "ENDERECO_INVALIDO");
  assert.ok(occurrence);
  assert.equal(occurrence._registro, base);
  const suggestions = corrections.gerarSugestoes(occurrence, occurrence._registro);
  assert.deepEqual(suggestions.map((item) => item.campo), ["endereco", "bairro"]);
  assert.ok(suggestions.every((item) => item.valorSugerido === "" && item.automatica === false));

  const missingDistrict = { ...base, endereco: "VIA SINTETICA", bairro: "" };
  const stillInvalid = rules.analisarLote([missingDistrict], { competencia: "202611", cbo: "225265" });
  assert.ok(stillInvalid.ocorrencias.some((item) => item.regraId === "ENDERECO_INVALIDO"));
});

test("BPA-I preserva SIGTAP, tipo, logradouro e bairro nos offsets lidos pelo Qualidade BPA", () => {
  const line = writer.montarLinhaBpaI({
    tipo: "03", cnes: "1234567", competencia: "202611",
    cnsProfissional: "700000000000000", cbo: "225265",
    dataAtendimento: "01/11/2026", folha: 1, sequencia: 1,
    sigtap: "0301010072", cnsPaciente: "700000000000000", sexo: "F",
    ibge: "123456", nome: "PACIENTE TESTE", nasc: "01012000",
    racaCor: "03", nacionalidade: "010", cep: "00000000",
    codLogradouro: "081", endereco: "VIA SINTETICA", numero: "123",
    complemento: "CASA", bairro: "BAIRRO TESTE", cpfPaciente: "00000000000"
  });
  const parsed = qualidadeParser.parseTipo03(line);
  assert.equal(parsed.sigtap, "0301010072");
  assert.equal(parsed.codLogradouro, "081");
  assert.equal(parsed.endereco, "VIA SINTETICA");
  assert.equal(parsed.numero, "123");
  assert.equal(parsed.complemento, "CASA");
  assert.equal(parsed.bairro, "BAIRRO TESTE");
});
