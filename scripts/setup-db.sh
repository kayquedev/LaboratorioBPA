#!/bin/bash
# ============================================================
# Cria o Postgres dedicado do Portal SGP (role + database),
# separado dos outros bancos do servidor, e grava as credenciais
# em /home/kayquedev/sgp-secrets/backend.env (fora do git).
#
# Uso: sudo bash setup-db.sh
# ============================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Rode com sudo: sudo bash setup-db.sh"
  exit 1
fi

DB_NAME="sgp"
DB_USER="sgp_app"
SECRETS_DIR="/home/kayquedev/sgp-secrets"
ENV_FILE="$SECRETS_DIR/backend.env"

echo ">>> Criando role e banco (se ainda não existirem)..."
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  DB_PASS="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9')"
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
  NEW_ROLE=1
else
  echo "Role ${DB_USER} já existe — não vou mexer na senha."
  NEW_ROLE=0
fi

sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

mkdir -p "$SECRETS_DIR"
chown kayquedev:kayquedev "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE já existe — mantendo como está."
elif [ "$NEW_ROLE" -eq 1 ]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=4000
SGP_DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
EOF
  chown kayquedev:kayquedev "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Gravado $ENV_FILE"
else
  echo "AVISO: role já existia mas $ENV_FILE não existe — crie manualmente com a senha correta."
fi

echo
echo "============================================================"
echo "Pronto. Próximo passo: rodar o seed do super-admin (veja README)."
echo "============================================================"
