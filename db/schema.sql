CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'soon', -- 'live' | 'soon'
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  cpf TEXT UNIQUE NOT NULL, -- somente digitos, 11 chars
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_super BOOLEAN NOT NULL DEFAULT false, -- conta super-admin, nao pode ser excluida
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_modules (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id INT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, module_id)
);

-- ───────────────────────── KODE MAPS ─────────────────────────
-- Domicílio = ponto do MyMaps. Família = responsável familiar (uma linha do
-- CSV do MyMaps). Cidadão = só identificação (sem dado de saúde).
CREATE TABLE IF NOT EXISTS km_domicilio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave TEXT UNIQUE,                       -- endereço normalizado (null = cadastrado à mão)
  microarea TEXT,
  tipo_logradouro TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  cep TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  ponto_referencia TEXT,
  tipo_imovel TEXT NOT NULL DEFAULT 'SEM INFO'
    CHECK (tipo_imovel IN ('DPO','DUO','VAGO','EST','OUTROS','SEM INFO')),
  observacao TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  precisao_m REAL,
  coletado_em TIMESTAMPTZ,
  origem TEXT NOT NULL DEFAULT 'territorio', -- territorio | vinculados | app | painel
  excluido BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS km_domicilio_atualizado ON km_domicilio (atualizado_em);
CREATE INDEX IF NOT EXISTS km_domicilio_microarea ON km_domicilio (microarea);

CREATE TABLE IF NOT EXISTS km_familia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domicilio_id UUID NOT NULL REFERENCES km_domicilio(id) ON DELETE CASCADE,
  resp_chave TEXT NOT NULL,                -- cpf/cns do responsável (ou nome)
  responsavel_nome TEXT,
  responsavel_cpf TEXT,
  responsavel_cns TEXT,
  prontuario TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domicilio_id, resp_chave)
);

CREATE TABLE IF NOT EXISTS km_cidadao (
  id SERIAL PRIMARY KEY,
  chave TEXT UNIQUE NOT NULL,              -- cpf || cns || nome
  nome TEXT,
  cpf TEXT,
  cns TEXT,
  microarea TEXT,
  domicilio_id UUID REFERENCES km_domicilio(id) ON DELETE SET NULL,
  familia_id UUID REFERENCES km_familia(id) ON DELETE SET NULL,
  e_responsavel BOOLEAN NOT NULL DEFAULT false,
  endereco_texto TEXT
);
CREATE INDEX IF NOT EXISTS km_cidadao_dom ON km_cidadao (domicilio_id);
