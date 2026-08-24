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
