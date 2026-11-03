"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const address = require("../public/oftalmo/js/address");
const linking = require("../public/oftalmo/js/linking");
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

test("Oftalmo reconhece Área e ruas ordinais conforme domínio de logradouro", () => {
  const area = address.parseEndereco("Área VIA SINTETICA, 10. CASA - BAIRRO TESTE, CIDADE - UF | 00000-000");
  const terceiraRua = address.parseEndereco("3ª Rua VIA SINTETICA, 20. CASA - BAIRRO TESTE, CIDADE - UF | 00000-000");
  assert.deepEqual([area.codTipo, area.logradouro], ["472", "VIA SINTETICA"]);
  assert.deepEqual([terceiraRua.codTipo, terceiraRua.logradouro], ["554", "VIA SINTETICA"]);
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

test("vínculo usa a mesma linha do cidadão para dados pessoais e endereço", () => {
  const agendado = { nome: "PACIENTE SINTETICO", nasc: "01/02/2010", comunidade: "TESTE" };
  const vinculado = {
    nome: "Paciente Sintético", nasc: "01/02/2010",
    cpf: "00000000000", cns: "", sexo: "F", telefone: "00000000000",
    microarea: "01", equipe: "EQUIPE TESTE", ibge: "000000",
    endereco: "VIA SINTETICA", codLogradouro: "081", numero: "123",
    complemento: "CASA", bairro: "BAIRRO TESTE", cep: "00000000"
  };
  const dados = linking.linkedPatientData(agendado, vinculado, "999999");
  assert.ok(dados);
  assert.deepEqual(
    [dados.nome, dados.nasc, dados.cpf, dados.sexo, dados.telefone, dados.endereco, dados.numero, dados.bairro, dados.cep],
    ["Paciente Sintético", "01/02/2010", "00000000000", "F", "00000000000", "VIA SINTETICA", "123", "BAIRRO TESTE", "00000000"]
  );
});

test("vínculo rejeita homônimo com nascimento diferente", () => {
  const agendado = { nome: "PACIENTE SINTETICO", nasc: "01/02/2010" };
  const outraPessoa = { nome: "PACIENTE SINTETICO", nasc: "02/02/2010", endereco: "OUTRA VIA" };
  assert.equal(linking.sameCitizen(agendado, outraPessoa), false);
  assert.equal(linking.linkedPatientData(agendado, outraPessoa, "000000"), null);
});

test("CPF/CNS combinado é classificado sem duplicar o documento", () => {
  assert.deepEqual(linking.parseCpfCns("000.000.000-00"), { cpf: "00000000000", cns: "" });
  assert.deepEqual(linking.parseCpfCns("700 0000 0000 0000"), { cpf: "", cns: "700000000000000" });
});

test("chave duplicada com dados pessoais divergentes é bloqueada", () => {
  const index = new Map();
  const ambiguous = new Set();
  const first = { nome: "PACIENTE TESTE", nasc: "01/01/2000", cpf: "00000000000", endereco: "VIA A" };
  const second = { nome: "PACIENTE TESTE", nasc: "01/01/2000", cpf: "11111111111", endereco: "VIA B" };
  assert.equal(linking.indexCitizen(index, ambiguous, first).status, "added");
  assert.equal(linking.indexCitizen(index, ambiguous, second).status, "ambiguous");
  assert.equal(index.size, 0);
  assert.equal(ambiguous.size, 1);
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

test("BPA-I preserva datas, quantidade, endereço e situação de rua no layout oficial", () => {
  const line = writer.montarLinhaBpaI({
    tipo: "03", cnes: "1234567", competencia: "202609",
    cnsProfissional: "700000000000000", cbo: "225265",
    dataAtendimento: "06/09/2026", folha: 1, sequencia: 1,
    sigtap: "0301010072", cnsPaciente: "700000000000000", sexo: "F",
    ibge: "123456", nome: "PACIENTE TESTE", nasc: "14/04/2020",
    racaCor: "03", nacionalidade: "010", cep: "00000000",
    codLogradouro: "081", endereco: "VIA SINTETICA", numero: "123",
    complemento: "CASA", bairro: "BAIRRO TESTE", cpfPaciente: "00000000000"
  });
  const parsed = qualidadeParser.parseTipo03(line);
  assert.equal(line.length, 351);
  assert.equal(line[349], "N");
  assert.equal(parsed.dataAtendimento, "20260906");
  assert.equal(parsed.dataNascimento, "20200414");
  assert.equal(parsed.quantidade, 1);
  assert.equal(parsed.sigtap, "0301010072");
  assert.equal(parsed.servico, "000");
  assert.equal(parsed.classificacao, "000");
  assert.equal(parsed.codLogradouro, "081");
  assert.equal(parsed.endereco, "VIA SINTETICA");
  assert.equal(parsed.numero, "123");
  assert.equal(parsed.complemento, "CASA");
  assert.equal(parsed.bairro, "BAIRRO TESTE");
});

test("arquivo BPA usa cabeçalho de 126 bytes e linha BPA-I de 351 bytes", () => {
  const header = writer.montarCabecalhoBpa({ competencia: "202609", numLinhas: 1, numFolhas: 1 });
  const line = writer.montarLinhaBpaI({
    tipo: "03", cnes: "1234567", competencia: "202609",
    cnsProfissional: "700000000000000", cbo: "225265", dataAtendimento: "06/09/2026",
    folha: 1, sequencia: 1, sigtap: "0301010072", sexo: "F", ibge: "123456",
    nome: "PACIENTE SINTÉTICO", nasc: "14/04/2020", racaCor: "03", nacionalidade: "010",
    cep: "00000000", codLogradouro: "081", endereco: "VIA SINTÉTICA",
    complemento: "CASA", numero: "123", bairro: "BAIRRO TESTE"
  });
  const fileBytes = writer.encodeLatin1(header + "\r\n" + line + "\r\n");
  assert.equal(header.length, 126);
  assert.equal(writer.encodeLatin1(header).length, 126);
  assert.equal(line.length, 351);
  assert.equal(writer.encodeLatin1(line).length, 351);
  assert.equal(fileBytes.length, 126 + 2 + 351 + 2);
  assert.equal(qualidadeParser.parseHeader(header).numLinhas, 1);
  assert.equal(qualidadeParser.parseHeader(header).numFolhas, 1);
});
