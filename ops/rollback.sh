#!/usr/bin/env bash
set -euo pipefail

# Sicherer Rückbau kritischer SSH/Firewall-Änderungen.
# Kostenfrei weil Free-Tier / GitHub Student Pack

if [[ "${EUID}" -ne 0 ]]; then
  echo "[FEHLER] Dieses Skript muss als root laufen (sudo)."
  exit 1
fi

KEEP_FAIL2BAN="${KEEP_FAIL2BAN:-1}"

echo "[WARNUNG] Dieses Skript setzt SSH/Firewall auf sichere Recovery-Defaults zurück."
echo "[WARNUNG] Ziel: Zugang wiederherstellen (z. B. nach Lockout-Risiko)."

echo "[STEP] Entferne WorldView SSH Override ..."
if [[ -f /etc/ssh/sshd_config.d/99-worldview-hardening.conf ]]; then
  rm -f /etc/ssh/sshd_config.d/99-worldview-hardening.conf
fi

echo "[STEP] Schreibe Recovery-SSH-Config ..."
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/90-worldview-recovery.conf <<'EOF'
# Recovery-Config für kurzfristige Wiederherstellung des Zugangs
PubkeyAuthentication yes
PasswordAuthentication yes
KbdInteractiveAuthentication yes
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 6
AllowTcpForwarding yes
EOF

echo "[STEP] SSH-Konfiguration prüfen ..."
sshd -t

echo "[STEP] SSH neu laden ..."
systemctl reload ssh || systemctl restart ssh

echo "[STEP] Setze UFW auf Recovery-Regeln ..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'recovery-ssh'
ufw allow 80/tcp comment 'recovery-http'
ufw allow 443/tcp comment 'recovery-https'
ufw --force enable

if [[ "${KEEP_FAIL2BAN}" == "0" ]]; then
  echo "[STEP] Deaktiviere Fail2Ban (optional) ..."
  systemctl disable --now fail2ban || true
else
  echo "[STEP] Fail2Ban bleibt aktiv (KEEP_FAIL2BAN=${KEEP_FAIL2BAN}) ..."
  systemctl enable fail2ban || true
  systemctl restart fail2ban || true
fi

echo "[INFO] Recovery-Verifikation"
ufw status verbose || true
sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries|allowtcpforwarding' || true
systemctl status ssh --no-pager -n 20 || true

echo "[OK] Rollback abgeschlossen. Nach Login-Stabilisierung Hardening erneut mit ops/server-hardening.sh ausführen."

