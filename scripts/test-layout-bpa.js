"use strict";

const writer = require("../public/oftalmo/js/writer");

// Dados de teste baseados no PAOFT-CO.txt
const dados = {
  tipo: "03",
  cnes: "1119816",
  competencia: "202606",
  cnsProfissional: "787441561874154",
  cbo: "225265",
  dataAtendimento: "11/06/2026",
  folha: 1,
  sequencia: 3,
  sigtap: "0301010072",
  cnsPaciente: "", // Vazio no ref
  sexo: "F",
  ibge: "316180",
  cid: "H542",
  numAutorizacao: "011000001",
  caraterAtendimento: "01",
  origemSistema: "MIGUELIN     BPA",
  nome: "ANNA CAROLINE DA SILVA",
  nasc: "10/01/2015",
  racaCor: "03",
  etnia: "",
  nacionalidade: "010",
  servico: "000",
  classificacao: "000",
  cep: "35544000",
  codLogradouro: "081", // RUA
  endereco: "LOGRADOURO",
  complemento: "COMPLEMENT",
  numero: "100",
  bairro: "BAIRRO",
  telefone: "37999955830",
  cpfPaciente: "16218362663"
};

const linha = writer.montarLinhaBpaI(dados);

console.log("=== MAPA DE POSIÇÕES DA LINHA BPA-I (351 bytes) ===");
console.log(`Comprimento total: ${linha.length} bytes`);
console.log("");

const campos = [
  { nome: "Tipo Registro", ini: 0, fim: 1, val: linha.substring(0, 2) },
  { nome: "CNES", ini: 2, fim: 8, val: linha.substring(2, 9) },
  { nome: "Competência", ini: 9, fim: 14, val: linha.substring(9, 15) },
  { nome: "CNS Profissional", ini: 15, fim: 29, val: linha.substring(15, 30) },
  { nome: "CBO", ini: 30, fim: 35, val: linha.substring(30, 36) },
  { nome: "Data Atendimento", ini: 36, fim: 43, val: linha.substring(36, 44) },
  { nome: "Folha", ini: 44, fim: 46, val: linha.substring(44, 47) },
  { nome: "Sequência", ini: 47, fim: 48, val: linha.substring(47, 49) },
  { nome: "SIGTAP", ini: 49, fim: 58, val: linha.substring(49, 59) },
  { nome: "CNS Paciente", ini: 59, fim: 73, val: linha.substring(59, 74) },
  { nome: "Sexo", ini: 74, fim: 74, val: linha.substring(74, 75) },
  { nome: "IBGE", ini: 75, fim: 80, val: linha.substring(75, 81) },
  { nome: "CID", ini: 81, fim: 84, val: linha.substring(81, 85) },
  { nome: "Num. Autorização", ini: 85, fim: 93, val: linha.substring(85, 94) },
  { nome: "Caráter Atendimento", ini: 94, fim: 95, val: linha.substring(94, 96) },
  { nome: "Origem Sistema", ini: 96, fim: 111, val: linha.substring(96, 112) },
  { nome: "Nome", ini: 112, fim: 141, val: linha.substring(112, 142) },
  { nome: "Data Nasc.", ini: 142, fim: 149, val: linha.substring(142, 150) },
  { nome: "Raça/Cor", ini: 150, fim: 151, val: linha.substring(150, 152) },
  { nome: "Etnia", ini: 152, fim: 155, val: linha.substring(152, 156) },
  { nome: "Nacionalidade", ini: 156, fim: 158, val: linha.substring(156, 159) },
  { nome: "Serviço", ini: 159, fim: 161, val: linha.substring(159, 162) },
  { nome: "Classificação", ini: 162, fim: 164, val: linha.substring(162, 165) },
  { nome: "Reservado", ini: 165, fim: 190, val: linha.substring(165, 191) },
  { nome: "CEP", ini: 191, fim: 198, val: linha.substring(191, 199) },
  { nome: "Cod. Logradouro", ini: 199, fim: 201, val: linha.substring(199, 202) },
  { nome: "Logradouro", ini: 202, fim: 231, val: linha.substring(202, 232) },
  { nome: "Complemento", ini: 232, fim: 241, val: linha.substring(232, 242) },
  { nome: "Número", ini: 242, fim: 246, val: linha.substring(242, 247) },
  { nome: "Bairro", ini: 247, fim: 276, val: linha.substring(247, 277) },
  { nome: "Telefone", ini: 277, fim: 287, val: linha.substring(277, 288) },
  { nome: "Reservado 2", ini: 288, fim: 337, val: linha.substring(288, 338) },
  { nome: "CPF Paciente", ini: 338, fim: 348, val: linha.substring(338, 349) },
  { nome: "Situação Rua", ini: 349, fim: 349, val: linha.substring(349, 350) },
  { nome: "Espaço Final", ini: 350, fim: 350, val: linha.substring(350, 351) }
];

console.table(campos.map(c => ({
  Campo: c.nome,
  Posição: `${c.ini}-${c.fim}`,
  Bytes: c.fim - c.ini + 1,
  Valor: `'${c.val}'`
})));

// Verificação específica do Cod. Logradouro
const codLog = linha.substring(199, 202);
console.log(`\nVERIFICAÇÃO CRÍTICA:`);
console.log(`- Cod. Logradouro extraído: '${codLog}'`);
console.log(`- Comprimento: ${codLog.length} bytes`);
console.log(`- É '081'? ${codLog === '081'}`);
console.log(`- É '0081'? ${codLog === '0081'}`);

// Investigação de S_PRD_TEMP
console.log(`\nINVESTIGAÇÃO S_PRD_TEMP ('' is not a valid integer value):`);
console.log(`Esta mensagem geralmente indica um campo numérico vazio ou com espaços.`);
console.log(`Campos numéricos verificados:`);
console.log(`- CNES: '${dados.cnes}' (vazio? ${!dados.cnes})`);
console.log(`- Competência: '${dados.competencia}' (vazio? ${!dados.competencia})`);
console.log(`- CBO: '${dados.cbo}' (vazio? ${!dados.cbo})`);
console.log(`- Folha: ${dados.folha} (vazio? ${!dados.folha})`);
console.log(`- Sequência: ${dados.sequencia} (vazio? ${!dados.sequencia})`);
console.log(`- SIGTAP: '${dados.sigtap}' (vazio? ${!dados.sigtap})`);
console.log(`- IBGE: '${dados.ibge}' (vazio? ${!dados.ibge})`);
console.log(`- Caráter: '${dados.caraterAtendimento}' (vazio? ${!dados.caraterAtendimento})`);
console.log(`- Serviço: '${dados.servico}' (vazio? ${!dados.servico})`);
console.log(`- Classificação: '${dados.classificacao}' (vazio? ${!dados.classificacao})`);
console.log(`- CEP: '${dados.cep}' (vazio? ${!dados.cep})`);
console.log(`- Cod. Logradouro: '${dados.codLogradouro}' (vazio? ${!dados.codLogradouro})`);
console.log(`- Número: '${dados.numero}' (vazio? ${!dados.numero})`);
console.log(`- Telefone: '${dados.telefone}' (vazio? ${!dados.telefone})`);
console.log(`- CPF: '${dados.cpfPaciente}' (vazio? ${!dados.cpfPaciente})`);

// Salvar arquivo de teste
const fs = require("fs");
const path = require("path");
const outputPath = path.join(__dirname, "..", "test-output-bpa.txt");
const header = writer.montarCabecalhoBpa({ competencia: "202606", numLinhas: 1, numFolhas: 1 });
const conteudo = header + "\r\n" + linha + "\r\n";
fs.writeFileSync(outputPath, writer.encodeLatin1(conteudo));
console.log(`\nArquivo de teste gerado em: ${outputPath}`);
console.log(`Tamanho do arquivo: ${fs.statSync(outputPath).size} bytes`);