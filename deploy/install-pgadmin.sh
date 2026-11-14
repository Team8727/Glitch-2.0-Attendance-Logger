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

cat > /etc/systemd/system/pgadmin4.service <<'UNIT'
[Unit]
Description=pgAdmin 4 web
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=pgadmin
Group=pgadmin
Environment=PGADMIN_SERVER_MODE=ON
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
echo "[pgadmin] add a Cloudflare public hostname:"
echo "  8727pgadmin.nrd919.space -> http://127.0.0.1:5050"
echo "[pgadmin] then open the dashboard and click Open pgAdmin"
