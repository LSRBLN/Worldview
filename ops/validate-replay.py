#!/usr/bin/env python3
"""
Validiert CZML-Replay-Dateien unter data/replay/*.
// Kostenfrei weil Free-Tier / GitHub Student Pack
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Any


ISO_Z_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WorldView Replay-Validator")
    parser.add_argument("--root", default=".", help="Repo-Root (Default: aktueller Ordner)")
    parser.add_argument(
        "--fail-on-empty",
        action="store_true",
        help="Exit != 0, falls keine CZML-Dateien gefunden werden",
    )
    return parser.parse_args()


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def parse_iso_z(raw: str, context: str, errors: list[str]) -> datetime | None:
    if not ISO_Z_RE.match(raw):
        errors.append(f"{context}: ungültiges ISO-Format (erwartet ...Z): {raw}")
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        errors.append(f"{context}: ungültiger Zeitstempel: {raw}")
        return None


def validate_interval(interval: str, context: str, errors: list[str]) -> None:
    parts = interval.split("/")
    if len(parts) != 2:
        errors.append(f"{context}: interval muss start/stop enthalten")
        return

    start = parse_iso_z(parts[0], f"{context}.start", errors)
    stop = parse_iso_z(parts[1], f"{context}.stop", errors)
    if start and stop and not (start < stop):
        errors.append(f"{context}: start muss vor stop liegen")


def validate_cartographic_degrees(values: Any, context: str, errors: list[str]) -> None:
    if not isinstance(values, list) or not values:
        errors.append(f"{context}: cartographicDegrees muss eine nicht-leere Liste sein")
        return
    if len(values) % 4 != 0:
        errors.append(f"{context}: cartographicDegrees-Länge muss Vielfaches von 4 sein")
        return

    previous_t: float | None = None
    for i in range(0, len(values), 4):
        t, lon, lat, alt = values[i : i + 4]
        if not all(is_number(v) for v in (t, lon, lat, alt)):
            errors.append(f"{context}: Sample ab Index {i} enthält keine endlichen Zahlen")
            continue

        t_f = float(t)
        lon_f = float(lon)
        lat_f = float(lat)

        if previous_t is not None and t_f < previous_t:
            errors.append(f"{context}: Zeitwerte müssen nicht-fallend sortiert sein")
        previous_t = t_f

        if not (-180.0 <= lon_f <= 180.0):
            errors.append(f"{context}: Longitude außerhalb Bereich [-180, 180]: {lon_f}")
        if not (-90.0 <= lat_f <= 90.0):
            errors.append(f"{context}: Latitude außerhalb Bereich [-90, 90]: {lat_f}")


def validate_document_packet(packet: dict[str, Any], context: str, errors: list[str]) -> None:
    if packet.get("id") != "document":
        errors.append(f"{context}: erstes Packet muss id='document' sein")
        return

    clock = packet.get("clock")
    if clock is None:
        errors.append(f"{context}: document.clock fehlt")
        return
    if not isinstance(clock, dict):
        errors.append(f"{context}: document.clock muss ein Objekt sein")
        return

    interval = clock.get("interval")
    current_time = clock.get("currentTime")
    if isinstance(interval, str):
        validate_interval(interval, f"{context}.clock.interval", errors)
    else:
        errors.append(f"{context}: document.clock.interval fehlt/ist ungültig")

    if isinstance(current_time, str):
        parse_iso_z(current_time, f"{context}.clock.currentTime", errors)
    else:
        errors.append(f"{context}: document.clock.currentTime fehlt/ist ungültig")


def validate_entity_packets(packets: Iterable[dict[str, Any]], context: str, errors: list[str]) -> None:
    seen_ids: set[str] = set()
    for idx, packet in enumerate(packets, start=1):
        pctx = f"{context}[{idx}]"

        packet_id = packet.get("id")
        if not isinstance(packet_id, str) or not packet_id.strip():
            errors.append(f"{pctx}: id fehlt/ist leer")
        else:
            if packet_id in seen_ids:
                errors.append(f"{pctx}: doppelte id entdeckt: {packet_id}")
            seen_ids.add(packet_id)

        availability = packet.get("availability")
        if availability is not None:
            if isinstance(availability, str):
                validate_interval(availability, f"{pctx}.availability", errors)
            else:
                errors.append(f"{pctx}: availability muss String sein")

        position = packet.get("position")
        if position is None:
            continue
        if not isinstance(position, dict):
            errors.append(f"{pctx}: position muss Objekt sein")
            continue

        epoch = position.get("epoch")
        if epoch is None:
            errors.append(f"{pctx}: position.epoch fehlt")
        elif not isinstance(epoch, str):
            errors.append(f"{pctx}: position.epoch muss String sein")
        else:
            parse_iso_z(epoch, f"{pctx}.position.epoch", errors)

        if "cartographicDegrees" not in position:
            errors.append(f"{pctx}: position.cartographicDegrees fehlt")
            continue
        validate_cartographic_degrees(position["cartographicDegrees"], f"{pctx}.position", errors)


def validate_czml_file(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{path}: JSON parse error: {exc}"]

    if not isinstance(payload, list) or not payload:
        return [f"{path}: CZML muss ein nicht-leeres JSON-Array sein"]
    if not isinstance(payload[0], dict):
        return [f"{path}: erstes Packet ist kein Objekt"]

    validate_document_packet(payload[0], f"{path}:document", errors)

    entity_packets = [p for p in payload[1:] if isinstance(p, dict)]
    if len(entity_packets) != len(payload[1:]):
        errors.append(f"{path}: mindestens ein Entity-Packet ist kein Objekt")
    validate_entity_packets(entity_packets, str(path), errors)

    return errors


def main() -> None:
    args = parse_args()
    repo_root = Path(args.root).resolve()
    replay_root = repo_root / "data" / "replay"

    if not replay_root.exists():
        raise SystemExit(f"[FAIL] Replay-Verzeichnis fehlt: {replay_root}")

    date_dirs = [p for p in replay_root.iterdir() if p.is_dir()]
    invalid_date_dirs = [p.name for p in date_dirs if not DATE_DIR_RE.match(p.name)]
    if invalid_date_dirs:
        print("[WARN] Nicht-standardisierte Replay-Ordnernamen:", ", ".join(sorted(invalid_date_dirs)))

    czml_files = sorted(replay_root.glob("**/*.czml"))
    if not czml_files:
        msg = f"[WARN] Keine CZML-Dateien unter {replay_root} gefunden"
        if args.fail_on_empty:
            raise SystemExit(msg.replace("[WARN]", "[FAIL]"))
        print(msg)
        print("[OK] Keine Fehler, da --fail-on-empty nicht gesetzt")
        return

    all_errors: list[str] = []
    for file in czml_files:
        file_errors = validate_czml_file(file)
        if file_errors:
            all_errors.extend(file_errors)
            print(f"[FAIL] {file}")
        else:
            print(f"[OK] {file}")

    if all_errors:
        print("\n=== VALIDIERUNGSFEHLER ===")
        for err in all_errors:
            print(f"- {err}")
        raise SystemExit(2)

    print(f"\n[OK] Replay-Validation erfolgreich ({len(czml_files)} Dateien)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[FAIL] Abgebrochen")
        sys.exit(130)

