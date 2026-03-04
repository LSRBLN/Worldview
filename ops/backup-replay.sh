#!/usr/bin/env bash
set -euo pipefail

# Erstellt tar.gz-Backups für data/replay inkl. Retention.
# Kostenfrei weil Free-Tier / GitHub Student Pack

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

SOURCE_DIR="${SOURCE_DIR:-${REPO_DIR}/data/replay}"
BACKUP_DIR="${BACKUP_DIR:-${REPO_DIR}/data/backups/replay}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="${BACKUP_DIR}/replay-${TS}.tar.gz"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "[FAIL] SOURCE_DIR existiert nicht: ${SOURCE_DIR}" >&2
  exit 1
fi

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "[FAIL] RETENTION_DAYS muss eine nicht-negative Ganzzahl sein: ${RETENTION_DAYS}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

echo "[INFO] Erzeuge Backup: ${ARCHIVE_PATH}"
tar -C "${SOURCE_DIR}" -czf "${ARCHIVE_PATH}" .

SIZE_HUMAN="$(du -h "${ARCHIVE_PATH}" | awk '{print $1}')"
echo "[OK] Backup erstellt (${SIZE_HUMAN})"

echo "[INFO] Wende Retention an: ${RETENTION_DAYS} Tage"
find "${BACKUP_DIR}" -type f -name 'replay-*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "[INFO] Aktuelle Backups"
ls -1t "${BACKUP_DIR}"/replay-*.tar.gz 2>/dev/null | head -n 10 || echo "[INFO] Keine Backups gefunden"

echo "[OK] Backup/Retention abgeschlossen"

