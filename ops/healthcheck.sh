#!/usr/bin/env bash
set -euo pipefail

# Prüft Build-Artefakte, Replay-Frische und optional systemd Status.
# Kostenfrei weil Free-Tier / GitHub Student Pack

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

DIST_DIR="${DIST_DIR:-${REPO_DIR}/dist}"
REPLAY_DIR="${REPLAY_DIR:-${REPO_DIR}/data/replay}"
MAX_REPLAY_AGE_MIN="${MAX_REPLAY_AGE_MIN:-180}"
REQUIRE_RECENT_REPLAY="${REQUIRE_RECENT_REPLAY:-0}"
SERVICE_NAME="${SERVICE_NAME:-worldview-czml.service}"
TIMER_NAME="${TIMER_NAME:-worldview-czml.timer}"

FAILURES=0

info() { echo "[INFO] $*"; }
ok() { echo "[OK] $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; FAILURES=$((FAILURES + 1)); }

if [[ -d "${DIST_DIR}" ]] && [[ -f "${DIST_DIR}/index.html" ]]; then
  ok "Build-Artefakte vorhanden: ${DIST_DIR}"
else
  fail "Build-Artefakte fehlen oder unvollständig: ${DIST_DIR} (index.html fehlt)"
fi

if [[ ! -d "${REPLAY_DIR}" ]]; then
  fail "Replay-Verzeichnis fehlt: ${REPLAY_DIR}"
else
  newest_file="$(find "${REPLAY_DIR}" -type f -name '*.czml' -print0 | xargs -0 ls -1t 2>/dev/null | head -n 1 || true)"

  if [[ -z "${newest_file}" ]]; then
    if [[ "${REQUIRE_RECENT_REPLAY}" == "1" ]]; then
      fail "Keine CZML-Dateien in ${REPLAY_DIR} gefunden"
    else
      warn "Keine CZML-Dateien in ${REPLAY_DIR} gefunden (REQUIRE_RECENT_REPLAY=0)"
    fi
  else
    newest_epoch="$(stat -f '%m' "${newest_file}")"
    now_epoch="$(date +%s)"
    age_min="$(( (now_epoch - newest_epoch) / 60 ))"
    info "Neueste Replay-Datei: ${newest_file} (Alter: ${age_min} min)"

    if (( age_min > MAX_REPLAY_AGE_MIN )); then
      if [[ "${REQUIRE_RECENT_REPLAY}" == "1" ]]; then
        fail "Replay-Datei älter als ${MAX_REPLAY_AGE_MIN} min"
      else
        warn "Replay-Datei älter als ${MAX_REPLAY_AGE_MIN} min"
      fi
    else
      ok "Replay-Frische innerhalb Limit (${MAX_REPLAY_AGE_MIN} min)"
    fi
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}"; then
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
      ok "Service aktiv: ${SERVICE_NAME}"
    else
      warn "Service nicht aktiv: ${SERVICE_NAME}"
    fi
  else
    warn "Service nicht installiert: ${SERVICE_NAME}"
  fi

  if systemctl list-unit-files | grep -q "^${TIMER_NAME}"; then
    if systemctl is-enabled --quiet "${TIMER_NAME}"; then
      ok "Timer enabled: ${TIMER_NAME}"
    else
      warn "Timer nicht enabled: ${TIMER_NAME}"
    fi
    systemctl status "${TIMER_NAME}" --no-pager -n 5 || true
  else
    warn "Timer nicht installiert: ${TIMER_NAME}"
  fi
else
  warn "systemctl nicht verfügbar, Service/Timer-Checks übersprungen"
fi

if (( FAILURES > 0 )); then
  echo "[FAIL] Healthcheck beendet mit ${FAILURES} Fehler(n)"
  exit 1
fi

echo "[OK] Healthcheck erfolgreich"

