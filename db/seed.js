require("dotenv").config({ path: process.env.ENV_FILE || ".env" });

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const pool = require("./pool");

const MODULES = [
  { slug: "siaps_indicadores", name: "SIAPS · Monitor de Indicadores", description: "Ferramenta de análise de dados dos indicadores do Saúde Brasil 360, analisando através da importação das planilhas do SIAPS e dos Cidadãos Vinculados do ESUS PEC.", status: "live", sort_order: 1 },
  { slug: "laboratorio", name: "Laboratório", description: "Gere o arquivo BPA-I para exportar para o BPA/SIA, através da importação da planilha do Excel do laboratório.", status: "live", sort_order: 2 },
  { slug: "bolsa_familia", name: "Bolsa Família", description: "Cruza o Mapa de Acompanhamento do Bolsa Família com os cidadãos vinculados do e-SUS PEC para identificar a microárea de cada beneficiário.", status: "live", sort_order: 3 },
  { slug: "qualidade_bpa", name: "Qualidade BPA", description: "Analisa um arquivo BPA já gerado (BPA-C/BPA-I), com painéis, filtros e verificações de qualidade dos dados por procedimento SIGTAP.", status: "live", sort_order: 4 },
  { slug: "correcao_bpa", name: "Correção BPA", description: "Corrige as pendências detectadas no Qualidade BPA — renumera folha/sequência automaticamente e guia a correção manual do resto — e gera o arquivo corrigido.", status: "live", sort_order: 5 },
  { slug: "datasus_sia", name: "DATASUS · SIA/SUS", description: "Analisa o relatório RSPROCED (produzido × aprovado por procedimento SIGTAP e unidade) após o processamento do BPA/FPO pelo SIA/SUS, identificando glosas por procedimento e por unidade.", status: "live", sort_order: 6 },
  { slug: "acompanhamento_pec", name: "Acompanhamento Cidadãos PEC", description: "Cruza os relatórios de cidadãos vinculados, condições de saúde e território do e-SUS PEC para identificar cadastros sem endereço, desatualizados, sem atendimento registrado ou sem domicílio mapeado.", status: "live", sort_order: 7 },
  { slug: "mapa_territorio", name: "Mapa do Território", description: "Organiza o relatório de Acompanhamento do Território do e-SUS PEC por bairro e logradouro, com contagem de pessoas e famílias, unificação de ruas com nome divergente e impressão do relatório consolidado.", status: "live", sort_order: 8 },
  { slug: "oftalmo", name: "Oftalmo", description: "Gere o arquivo BPA para exportar para o SIA, através da importação da planilha dos dados dos pacientes.", status: "soon", sort_order: 9 },
  { slug: "esus_pec", name: "ESUS PEC", description: "Gerador de BPA a partir da produção registrada no ESUS PEC.", status: "soon", sort_order: 10 },
];

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);

  for (const m of MODULES) {
    await pool.query(
      `INSERT INTO modules (slug, name, description, status, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         status = EXCLUDED.status, sort_order = EXCLUDED.sort_order`,
      [m.slug, m.name, m.description, m.status, m.sort_order]
    );
  }
  console.log(`Módulos ok: ${MODULES.map((m) => m.slug).join(", ")}`);

  const cpf = String(process.env.SEED_ADMIN_CPF || "").replace(/\D/g, "");
  const password = process.env.SEED_ADMIN_PASSWORD || "";
  const name = process.env.SEED_ADMIN_NAME || "Administrador";
  const email = process.env.SEED_ADMIN_EMAIL || null;

  if (!cpf || !password) {
    console.log("SEED_ADMIN_CPF / SEED_ADMIN_PASSWORD não definidos — nenhum admin criado.");
  } else {
    const existing = await pool.query("SELECT id FROM users WHERE cpf = $1", [cpf]);
    let adminId;
    if (existing.rows.length) {
      adminId = existing.rows[0].id;
      await pool.query("UPDATE users SET is_admin = true, is_super = true WHERE id = $1", [adminId]);
      console.log(`Admin com CPF ${cpf} já existe (id ${adminId}) — marcado como super-admin, senha não alterada.`);
    } else {
      const hash = await bcrypt.hash(password, 10);
      const inserted = await pool.query(
        `INSERT INTO users (name, email, cpf, password_hash, is_admin, is_super)
         VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [name, email, cpf, hash]
      );
      adminId = inserted.rows[0].id;
      console.log(`Admin criado: ${name} (id ${adminId}).`);
    }

    const allModules = await pool.query("SELECT id FROM modules");
    for (const row of allModules.rows) {
      await pool.query(
        `INSERT INTO user_modules (user_id, module_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [adminId, row.id]
      );
    }
    console.log("Admin com acesso a todos os módulos.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
