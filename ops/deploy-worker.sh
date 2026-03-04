#!/usr/bin/env bash
set -euo pipefail

# Kostenfrei weil Free-Tier / GitHub Student Pack
# Deployt den CZML-Generator als systemd Service/Timer auf Ubuntu/Debian.
# Idempotent: Mehrfaches Ausführen aktualisiert bestehende Installation.

if [[ "${EUID}" -ne 0 ]]; then
  echo "[FEHLER] Dieses Skript muss als root laufen (sudo)."
  exit 1
fi

REPO_DIR="${REPO_DIR:-/opt/worldview}"
SERVICE_NAME="worldview-czml.service"
TIMER_NAME="worldview-czml.timer"
APP_USER="${APP_USER:-worldview}"
APP_GROUP="${APP_GROUP:-worldview}"
BACKUP_ROOT="/root/worldview-backups"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${TS}"

echo "[INFO] Starte deploy-worker.sh"
echo "[INFO] REPO_DIR=${REPO_DIR}"

if [[ ! -f "${REPO_DIR}/tools/czml_generator.py" ]]; then
  echo "[FEHLER] ${REPO_DIR}/tools/czml_generator.py nicht gefunden."
  echo "[HINWEIS] Repository vorher nach ${REPO_DIR} auschecken/kopieren."
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
mkdir -p "${REPO_DIR}/ops"

echo "[STEP] Installiere Python-Laufzeit ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends python3 python3-venv python3-pip

echo "[STEP] Erzeuge Service-User falls nötig ..."
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home "${REPO_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
fi

if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${APP_GROUP}"
fi

usermod -a -G "${APP_GROUP}" "${APP_USER}" || true

echo "[STEP] Setze Besitzrechte für Laufzeit ..."
mkdir -p "${REPO_DIR}/data/replay"
chown -R "${APP_USER}:${APP_GROUP}" "${REPO_DIR}/data"

echo "[STEP] Erstelle/aktualisiere Python venv ..."
python3 -m venv "${REPO_DIR}/.venv"
"${REPO_DIR}/.venv/bin/pip" install --upgrade pip setuptools wheel

echo "[STEP] Sichere bestehende systemd-Units (falls vorhanden) ..."
if [[ -f "/etc/systemd/system/${SERVICE_NAME}" ]]; then
  cp -a "/etc/systemd/system/${SERVICE_NAME}" "${BACKUP_DIR}/${SERVICE_NAME}.bak"
fi
if [[ -f "/etc/systemd/system/${TIMER_NAME}" ]]; then
  cp -a "/etc/systemd/system/${TIMER_NAME}" "${BACKUP_DIR}/${TIMER_NAME}.bak"
fi

echo "[STEP] Installiere systemd-Units aus Repo ..."
install -m 0644 "${REPO_DIR}/ops/worldview-czml.service" "/etc/systemd/system/${SERVICE_NAME}"
install -m 0644 "${REPO_DIR}/ops/worldview-czml.timer" "/etc/systemd/system/${TIMER_NAME}"

echo "[STEP] Passe Unit-Dateien mit Parametern an ..."
sed -i "s|__REPO_DIR__|${REPO_DIR}|g" "/etc/systemd/system/${SERVICE_NAME}"
sed -i "s|__APP_USER__|${APP_USER}|g" "/etc/systemd/system/${SERVICE_NAME}"
sed -i "s|__APP_GROUP__|${APP_GROUP}|g" "/etc/systemd/system/${SERVICE_NAME}"

echo "[STEP] Reload + Aktivierung ..."
systemctl daemon-reload
systemctl enable "${TIMER_NAME}"
systemctl restart "${TIMER_NAME}"

echo "[INFO] Führe Probelauf via service aus ..."
systemctl start "${SERVICE_NAME}" || {
  echo "[FEHLER] Service-Probelauf fehlgeschlagen. Logs anzeigen:"
  journalctl -u "${SERVICE_NAME}" -n 100 --no-pager || true
  exit 1
}

echo "[INFO] Verifikation"
systemctl status "${SERVICE_NAME}" --no-pager -n 30 || true
systemctl status "${TIMER_NAME}" --no-pager -n 30 || true
systemctl list-timers "${TIMER_NAME}" --no-pager || true

echo "[OK] Deploy abgeschlossen. Unit-Backups unter: ${BACKUP_DIR}"

