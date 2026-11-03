// Script de validação pós-geração do TXT BPA-I
// Confirma: ENDEREÇO = nome da rua (não código), SEXO = M/F, sem "MIGUELIN BPA", 351 bytes

const writer = require('../public/oftalmo/js/writer.js');

const dadosExemplo = {
  cnes: '1119816',
  competencia: '202606',
  cnsProfissional: '787441561874154',
  cbo: '225265',
  dataAtendimento: '20260611',
  folha: 1,
  sequencia: 3,
  sigtap: '0301010072',
  cnsPaciente: '',
  sexo: 'Feminino', // Deve ser normalizado para F
  ibge: '316180',
  cid: 'H542',
  numAutorizacao: '011000001',
  caraterAtendimento: '01',
  origemSistema: '', // Removido MIGUELIN BPA
  nome: 'ANA CECILIA NASCIMENTO SOARES',
  dataNascimento: '19810110',
  racaCor: '03',
  etnia: '',
  nacionalidade: '010',
  servico: '000',
  classificacao: '000',
  cep: '35544000',
  codLogradouro: '081',
  endereco: 'DR EZEQUIEL DE MACEDO', // Nome da rua, NÃO o código
  complemento: 'CASA',
  numero: '221',
  bairro: 'CENTRO',
  telefone: '37999955830',
  cpfPaciente: '16218362663',
  situacaoRua: 'N'
};

// Normalizar sexo antes de passar ao writer (simula app.js)
const sexoNorm = String(dadosExemplo.sexo || '').toUpperCase().charAt(0);
dadosExemplo.sexo = (sexoNorm === 'M' || sexoNorm === 'F') ? sexoNorm : '';

const linha = writer.montarLinhaBpaI(dadosExemplo);

console.log('=== RELATÓRIO DE VALIDAÇÃO BPA-I ===\n');
console.log(`Tamanho da linha: ${linha.length} bytes (esperado: 351)`);
console.log(`Tamanho OK: ${linha.length === 351 ? '✅ SIM' : '❌ NÃO'}\n`);

// Extrair campos posicionais
const campos = {
  'Tipo Registro': { pos: [0, 2], val: linha.substring(0, 2) },
  'CNES': { pos: [2, 9], val: linha.substring(2, 9) },
  'Sexo': { pos: [74, 75], val: linha.substring(74, 75) },
  'Origem Sistema (96-111)': { pos: [96, 112], val: linha.substring(96, 112) },
  'Nome': { pos: [112, 142], val: linha.substring(112, 142).trim() },
  'CEP': { pos: [191, 199], val: linha.substring(191, 199) },
  'Cod. Logradouro': { pos: [199, 202], val: linha.substring(199, 202) },
  'ENDEREÇO': { pos: [202, 232], val: linha.substring(202, 232).trim() },
  'Complemento': { pos: [232, 242], val: linha.substring(232, 242).trim() },
  'Número': { pos: [242, 247], val: linha.substring(242, 247).trim() },
  'Bairro': { pos: [247, 277], val: linha.substring(247, 277).trim() }
};

let erros = [];

for (const [nome, info] of Object.entries(campos)) {
  console.log(`${nome.padEnd(25)} | Pos ${String(info.pos[0]).padStart(3)}-${String(info.pos[1]-1).padStart(3)} | "${info.val}"`);
}

console.log('\n=== VALIDAÇÕES CRÍTICAS ===');

// 1. ENDEREÇO não pode ser código numérico
const enderecoVal = campos['ENDEREÇO'].val;
const isApenasNumeros = /^\d+$/.test(enderecoVal);
if (isApenasNumeros) {
  console.log(`❌ ENDEREÇO contém apenas números: "${enderecoVal}"`);
  erros.push('ENDERECO_NUMERICO');
} else if (!enderecoVal) {
  console.log('❌ ENDEREÇO está vazio');
  erros.push('ENDERECO_VAZIO');
} else {
  console.log(`✅ ENDEREÇO contém nome da rua: "${enderecoVal}"`);
}

// 2. Cod. Logradouro deve ser 3 dígitos
const codLog = campos['Cod. Logradouro'].val;
if (codLog.length !== 3 || !/^\d{3}$/.test(codLog)) {
  console.log(`❌ Cod. Logradouro inválido: "${codLog}" (esperado 3 dígitos)`);
  erros.push('COD_LOG_INVALIDO');
} else {
  console.log(`✅ Cod. Logradouro: "${codLog}"`);
}

// 3. Sexo deve ser M ou F
const sexoVal = campos['Sexo'].val;
if (sexoVal !== 'M' && sexoVal !== 'F') {
  console.log(`❌ Sexo inválido: "${sexoVal}" (esperado M ou F)`);
  erros.push('SEXO_INVALIDO');
} else {
  console.log(`✅ Sexo: "${sexoVal}"`);
}

// 4. Origem Sistema não deve conter MIGUELIN BPA
const origemVal = campos['Origem Sistema (96-111)'].val;
if (origemVal.includes('MIGUELIN') || origemVal.includes('BPA')) {
  console.log(`❌ Origem Sistema contém texto indevido: "${origemVal}"`);
  erros.push('ORIGEM_INDEVIDA');
} else {
  console.log(`✅ Origem Sistema limpo: "${origemVal.trim() || '(espaços)'}"`);
}

// 5. Tamanho exato
if (linha.length !== 351) {
  console.log(`❌ Tamanho da linha: ${linha.length} (esperado 351)`);
  erros.push('TAMANHO_INCORRETO');
} else {
  console.log('✅ Tamanho da linha: 351 bytes');
}

console.log('\n=== RESULTADO FINAL ===');
if (erros.length === 0) {
  console.log('✅ TODAS AS VALIDAÇÕES PASSARAM');
} else {
  console.log(`❌ ${erros.length} ERRO(S): ${erros.join(', ')}`);
  process.exit(1);
}

console.log('\n=== LINHA COMPLETA (raw) ===');
console.log(linha);