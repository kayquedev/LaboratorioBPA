"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { PGlite } = require("@electric-sql/pglite");

const parser = require("../public/mapa_territorio/js/parserCsvGenerico.js");
const { importaTerritorio, importaVinculados } = require("../lib/kodemaps/importador");
const { parseEnderecoVinculados, chaveDomicilio } = require("../lib/kodemaps/endereco");
const repo = require("../lib/kodemaps/repo");

const DOCS = "D:/Documentos/KODE/kode-maps/docs";
const temDocs = fs.existsSync(DOCS);

function lerCsv(nome) {
  const buf = fs.readFileSync(path.join(DOCS, nome));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parser.parseCsv(parser.decodeArrayBuffer(ab));
}

async function novoBanco() {
  const pg = new PGlite();
  const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  await pg.exec(schema);
  return { query: async (t, p) => { const r = await pg.query(t, p); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } };
}

test("parseEnderecoVinculados: com e sem complemento", () => {
  const a = parseEnderecoVinculados("Praça JK, 400. CASA FUNDOS - CENTRO, Brasília - DF | 35544-000");
  assert.deepEqual(
    [a.tipo_logradouro, a.logradouro, a.numero, a.complemento, a.bairro, a.cidade, a.uf, a.cep],
    ["Praça", "JK", "400", "CASA FUNDOS", "CENTRO", "Brasília", "DF", "35544000"]
  );
  const b = parseEnderecoVinculados("Praça JK, 300. CENTRO, Brasília - DF | 35544-000");
  assert.equal(b.complemento, null);
  assert.equal(b.bairro, "CENTRO");
  assert.equal(parseEnderecoVinculados("-"), null);
});

test("a chave bate entre Território e Vinculados", () => {
  const t = chaveDomicilio({ tipo_logradouro: "PRAÇA", logradouro: "JK", numero: "400", complemento: "CASA FUNDOS" });
  const v = parseEnderecoVinculados("Praça JK, 400. CASA FUNDOS - CENTRO, Brasília - DF | 35544-000").chave;
  assert.equal(t, v);
});

test("importa Território + Vinculados, liga, coleta GPS e exporta MyMaps", { skip: !temDocs }, async () => {
  const db = await novoBanco();
  const t1 = lerCsv("TERRITORIO (1).csv");
  const t2 = lerCsv("TERRITORIO (2).csv");
  assert.equal(t1.erro, null);

  const r1 = await importaTerritorio(db, t1.filtros, t1.linhas);
  assert.equal(r1.microarea, "04");
  const r2 = await importaTerritorio(db, t2.filtros, t2.linhas);
  assert.equal(r2.microarea, "03");

  const v = lerCsv("VINCULADOS.csv");
  const rv = await importaVinculados(db, v.linhas);
  assert.ok(rv.cidadaos > 10);
  assert.ok(rv.ligados > 0);

  // Reimportar não duplica nem apaga GPS.
  const { domicilios } = await repo.listarDomicilios(db, { microarea: "04" });
  const dom = domicilios.find((d) => d.numero === "150");
  assert.ok(dom, "Praça JK 150 deve existir");
  assert.equal(dom.familias.length, 1);
  assert.equal(dom.familias[0].responsavel_nome, "DIEGO MATHEUS TEIXEIRA FARIAS");
  assert.equal(dom.familias[0].responsavel_cpf, "86854266009");
  assert.equal(dom.moradores, 2);

  await repo.salvarDomicilio(db, { id: dom.id, lat: -19.9781, lng: -44.8726, tipo_imovel: "DPO", ponto_referencia: "Ao lado da praça" }, { origem: "app" });
  const antes = (await repo.listarDomicilios(db, {})).total;
  await importaTerritorio(db, t1.filtros, t1.linhas);
  const depois = await repo.listarDomicilios(db, {});
  assert.equal(depois.total, antes);
  const igual = depois.domicilios.find((d) => d.id === dom.id);
  assert.equal(igual.lat, -19.9781);
  assert.equal(igual.tipo_imovel, "DPO");

  const csv = repo.csvMyMaps(depois.domicilios);
  const linhas = csv.trim().split("\r\n");
  assert.equal(linhas[0], "WKT,nome,Tipo Imovel,Nº Prontuário Familiar,Responsavel Familiar,CPF,Endereco,Complemento,Ponto de Referencia,descrição");
  assert.equal(linhas.length, 2);
  assert.match(linhas[1], /^POINT \(-44\.8726 -19\.9781\),DIEGO MATHEUS TEIXEIRA FARIAS,DPO,,DIEGO MATHEUS TEIXEIRA FARIAS,868\.542\.660-09,"?PRAÇA JK, 150"?,,Ao lado/);

  // Domicílio recusado fica marcado e sem família.
  const todos = depois.domicilios;
  const recusado = todos.find((d) => d.numero === "360");
  assert.match(recusado.observacao, /RECUSADO/);
  assert.equal(recusado.familias.length, 0);
});

test("domicílio rural criado no app (sem endereço padronizado) e sync incremental", async () => {
  const db = await novoBanco();
  const id = "11111111-1111-4111-8111-111111111111";
  await repo.salvarDomicilio(db, {
    id, tipo_imovel: "DPO", ponto_referencia: "Após entrada Jacaré, 2ª fazenda", logradouro: "Fazenda Bom Sucesso",
    lat: -19.97, lng: -44.88, familias: [{ responsavel_nome: "Antonio Celso", responsavel_cpf: "529.982.247-25", prontuario: "207" }],
  }, { origem: "app" });
  const s1 = await repo.changesDesde(db, null);
  assert.equal(s1.domicilios.length, 1);
  assert.equal(s1.domicilios[0].origem, "app");
  const s2 = await repo.changesDesde(db, s1.servidor_agora);
  assert.equal(s2.domicilios.length, 0);
  await assert.rejects(() => repo.salvarDomicilio(db, { id, tipo_imovel: "XYZ" }, { origem: "app" }), /inválido/);
  await assert.rejects(() => repo.salvarDomicilio(db, { logradouro: "x", lat: 999, lng: 0 }, { origem: "app" }), /Coordenada/);
});
