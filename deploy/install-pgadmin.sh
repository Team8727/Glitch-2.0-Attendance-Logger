#!/usr/bin/env bash
# One-time pgAdmin4 web install for the Glitch attendance database.
# Run from the attendance repo root: sudo ./deploy/install-pgadmin.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates gnupg

install -d -m 0755 /etc/apt/keyrings
curl -fsS https://www.pgadmin.org/static/packages_pgadmin_org.pub \
  | gpg --dearmor -o /etc/apt/keyrings/packages-pgadmin-org.gpg

echo "deb [signed-by=/etc/apt/keyrings/packages-pgadmin-org.gpg] https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/$(lsb_release -cs) pgadmin4 main" \
  > /etc/apt/sources.list.d/pgadmin4.list

apt-get update
apt-get install -y --no-install-recommends pgadmin4-server

if ! id pgadmin >/dev/null 2>&1; then
  useradd --system --home /var/lib/pgadmin --shell /usr/sbin/nologin pgadmin
fi
install -d -m 0750 -o pgadmin -g pgadmin /var/lib/pgadmin
install -d -m 0750 -o pgadmin -g pgadmin /var/log/pgadmin

install -d -m 0755 /etc/glitch
CRED_FILE=/etc/glitch/pgadmin-credentials
if [ ! -f "$CRED_FILE" ]; then
  PGADMIN_EMAIL="${PGADMIN_EMAIL:-admin@glitch8727.com}"
  PGADMIN_PASSWORD="${PGADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)}"
  printf 'PGADMIN_EMAIL=%s\nPGADMIN_PASSWORD=%s\n' "$PGADMIN_EMAIL" "$PGADMIN_PASSWORD" > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
fi
# shellcheck disable=SC1090
. "$CRED_FILE"

# A failed first migration leaves a half-created SQLite DB. Reset it only when
# the service is not running, so a working pgAdmin install is never wiped.
if [ -f /var/lib/pgadmin/pgadmin4.db ] && ! systemctl is-active --quiet pgadmin4.service; then
  rm -f /var/lib/pgadmin/pgadmin4.db
fi

cat > /etc/systemd/system/pgadmin4.service <<UNIT
[Unit]
Description=pgAdmin 4 web
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=pgadmin
Group=pgadmin
Environment=PGADMIN_SERVER_MODE=ON
Environment=PGADMIN_SETUP_EMAIL=$PGADMIN_EMAIL
Environment=PGADMIN_SETUP_PASSWORD=$PGADMIN_PASSWORD
WorkingDirectory=/usr/pgadmin4/web
ExecStart=/usr/pgadmin4/venv/bin/python /usr/pgadmin4/web/pgAdmin4.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now pgadmin4.service

echo "[pgadmin] running on http://127.0.0.1:5050"
echo "[pgadmin] login email: $PGADMIN_EMAIL"
echo "[pgadmin] login password: $PGADMIN_PASSWORD"
echo "[pgadmin] credentials saved in $CRED_FILE"
echo "[pgadmin] add a Cloudflare public hostname:"
echo "  8727pgadmin.nrd919.space -> http://127.0.0.1:5050"
echo "[pgadmin] then open the dashboard and click Open pgAdmin"
