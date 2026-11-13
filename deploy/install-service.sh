#!/usr/bin/env bash
# Install the attendance service as a systemd unit.
# Run from the attendance repo root: sudo ./deploy/install-service.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${SERVICE_DIR:-$REPO_DIR/service}"
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-jaxon}}"
sed -e "s|__SERVICE_USER__|$SERVICE_USER|g" \
    -e "s|__SERVICE_DIR__|$SERVICE_DIR|g" \
    "$REPO_DIR/deploy/systemd/glitch-attendance.service" \
    > /etc/systemd/system/glitch-attendance.service
systemctl daemon-reload
echo "Installed glitch-attendance.service. Create $SERVICE_DIR/.env, then:"
echo "  sudo systemctl enable --now glitch-attendance"
