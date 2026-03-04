#!/usr/bin/env bash
set -euo pipefail

# Kostenfrei weil Free-Tier / GitHub Student Pack
# Idempotente Grundhärtung für Ubuntu/Debian VPS.
# Achtung: Standardmäßig wird Passwort-Login für SSH deaktiviert.
# Wenn noch kein funktionierender SSH-Key verifiziert ist, zuerst mit
# ALLOW_PASSWORD_FALLBACK=1 ausführen und danach auf 0 umstellen.

if [[ "${EUID}" -ne 0 ]]; then
  echo "[FEHLER] Dieses Skript muss als root laufen (sudo)."
  exit 1
fi

ALLOW_PASSWORD_FALLBACK="${ALLOW_PASSWORD_FALLBACK:-0}"
BACKUP_ROOT="/root/worldview-backups"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${TS}"

echo "[INFO] Starte server-hardening.sh"
echo "[INFO] Backup-Verzeichnis: ${BACKUP_DIR}"

mkdir -p "${BACKUP_DIR}"

echo "[STEP] Installiere/aktualisiere Sicherheits-Pakete ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ufw fail2ban openssh-server ca-certificates

echo "[STEP] Erstelle Backups kritischer Dateien ..."
if [[ -f /etc/ssh/sshd_config ]]; then
  cp -a /etc/ssh/sshd_config "${BACKUP_DIR}/sshd_config.bak"
fi
if [[ -f /etc/ssh/sshd_config.d/99-worldview-hardening.conf ]]; then
  cp -a /etc/ssh/sshd_config.d/99-worldview-hardening.conf "${BACKUP_DIR}/99-worldview-hardening.conf.bak"
fi
if [[ -f /etc/fail2ban/jail.d/worldview.local ]]; then
  cp -a /etc/fail2ban/jail.d/worldview.local "${BACKUP_DIR}/fail2ban-worldview.local.bak"
fi

echo "[STEP] Konfiguriere UFW (idempotent) ..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'worldview-ssh'
ufw allow 80/tcp comment 'worldview-http'
ufw allow 443/tcp comment 'worldview-https'
ufw --force enable

echo "[STEP] Konfiguriere Fail2Ban für SSH ..."
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/worldview.local <<'EOF'
[sshd]
enabled = true
port = 22
logpath = %(sshd_log)s
banaction = ufw
findtime = 10m
maxretry = 5
bantime = 1h
ignoreip = 127.0.0.1/8 ::1
EOF

echo "[STEP] Erzeuge SSH-Hardening-Override ..."
mkdir -p /etc/ssh/sshd_config.d

if [[ "${ALLOW_PASSWORD_FALLBACK}" == "1" ]]; then
  echo "[WARNUNG] ALLOW_PASSWORD_FALLBACK=1 aktiv: Passwort-Login bleibt temporär erlaubt."
  SSH_PASSWORD_AUTH="yes"
  SSH_KBD_AUTH="yes"
else
  echo "[WARNUNG] Passwort-Login wird deaktiviert. Stelle sicher, dass SSH-Keys getestet sind!"
  SSH_PASSWORD_AUTH="no"
  SSH_KBD_AUTH="no"
fi

cat > /etc/ssh/sshd_config.d/99-worldview-hardening.conf <<EOF
# WorldView SSH hardening (managed by ops/server-hardening.sh)
Protocol 2
PubkeyAuthentication yes
PasswordAuthentication ${SSH_PASSWORD_AUTH}
KbdInteractiveAuthentication ${SSH_KBD_AUTH}
ChallengeResponseAuthentication no
PermitRootLogin no
PermitEmptyPasswords no
UsePAM yes

MaxAuthTries 3
LoginGraceTime 30

X11Forwarding no
AllowAgentForwarding yes
AllowTcpForwarding no
GatewayPorts no
PermitTunnel no

ClientAliveInterval 300
ClientAliveCountMax 2

# Lockout-Risiko-Hinweis:
# Vor Produktionsbetrieb zwingend zweiten SSH-Login testen,
# erst dann Passwort-Auth final deaktivieren.
EOF

echo "[STEP] Validiere SSH-Konfiguration ..."
if ! sshd -t; then
  echo "[FEHLER] sshd -t fehlgeschlagen. Rolle SSH-Config auf Backup zurück."
  if [[ -f "${BACKUP_DIR}/99-worldview-hardening.conf.bak" ]]; then
    cp -a "${BACKUP_DIR}/99-worldview-hardening.conf.bak" /etc/ssh/sshd_config.d/99-worldview-hardening.conf
  else
    rm -f /etc/ssh/sshd_config.d/99-worldview-hardening.conf
  fi
  if [[ -f "${BACKUP_DIR}/sshd_config.bak" ]]; then
    cp -a "${BACKUP_DIR}/sshd_config.bak" /etc/ssh/sshd_config
  fi
  exit 1
fi

echo "[STEP] Lade Dienste neu ..."
systemctl daemon-reload
systemctl enable ssh
systemctl reload ssh || systemctl restart ssh
systemctl enable fail2ban
systemctl restart fail2ban

echo "[INFO] Verifikations-Status"
ufw status verbose || true
fail2ban-client status sshd || true
sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries|allowtcpforwarding' || true

echo "[OK] Hardening abgeschlossen. Backup liegt unter: ${BACKUP_DIR}"

