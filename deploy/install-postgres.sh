#!/usr/bin/env bash
# One-time PostgreSQL setup for the Glitch attendance service.
# Run from the attendance repo root: sudo ./deploy/install-postgres.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_ENV="$REPO_DIR/service/.env"
DB_NAME="${DB_NAME:-glitch}"
DB_USER="${DB_USER:-glitch}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 24)}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends postgresql postgresql-contrib
systemctl enable --now postgresql

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"
else
  sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

if [ ! -f "$SERVICE_ENV" ]; then
  echo "Missing $SERVICE_ENV. Run the attendance service setup first." >&2
  exit 1
fi

python3 - "$SERVICE_ENV" "postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME" <<'PY'
import sys
from pathlib import Path
path, url = sys.argv[1], sys.argv[2]
p = Path(path)
lines = p.read_text().splitlines()
out = []
found = False
for line in lines:
    if line.startswith('DATABASE_URL='):
        out.append('DATABASE_URL=' + url)
        found = True
    else:
        out.append(line)
if not found:
    out.append('DATABASE_URL=' + url)
p.write_text('\n'.join(out) + '\n')
PY
chmod 600 "$SERVICE_ENV"

echo "[postgres] installed and running"
echo "[postgres] database: $DB_NAME, user: $DB_USER"
echo "[postgres] DATABASE_URL written to $SERVICE_ENV"
echo "[postgres] next: run the migration/build step"
