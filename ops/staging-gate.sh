#!/usr/bin/env bash
set -euo pipefail

# Lokales Staging-Gate für Build + Replay-Validation.
# Kostenfrei weil Free-Tier / GitHub Student Pack

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_DIR}"

echo "[STEP] npm ci"
npm ci

echo "[STEP] npm run typecheck"
npm run typecheck

echo "[STEP] npm run build"
npm run build

echo "[STEP] Replay-Validation"
python3 "${REPO_DIR}/ops/validate-replay.py" --root "${REPO_DIR}" --fail-on-empty

echo "[OK] Staging-Gate erfolgreich"

