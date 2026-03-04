#!/usr/bin/env python3
"""
WorldView CZML Generator (Schritt 7)
- Kostenfrei weil Free-Tier / GitHub Student Pack
- Ubuntu/Cron-geeignet
- Nutzt nur kostenlose Quellen: OpenSky + Celestrak
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OPENSKY_URL = "https://opensky-network.org/api/states/all?lamin=24&lomin=44&lamax=40&lomax=64"
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"


@dataclass
class FetchResult:
    payload: Any
    source: str
    fetched_at: datetime


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_json(url: str, source: str, timeout: int = 20) -> FetchResult:
    # Kostenfrei weil Free-Tier / GitHub Student Pack
    # Leichtes Backoff bei temporären Fehlern (Rate-Limit-schonend)
    retries = 3
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": "worldview-czml-generator/1.0"})
            with urlopen(req, timeout=timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            return FetchResult(payload=data, source=source, fetched_at=datetime.now(UTC))
        except (HTTPError, URLError, TimeoutError):
            if attempt >= retries:
                raise
            time.sleep(attempt * 2)
    raise RuntimeError("Unreachable")


def fetch_text(url: str, source: str, timeout: int = 20) -> FetchResult:
    retries = 3
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": "worldview-czml-generator/1.0"})
            with urlopen(req, timeout=timeout) as response:
                data = response.read().decode("utf-8")
            return FetchResult(payload=data, source=source, fetched_at=datetime.now(UTC))
        except (HTTPError, URLError, TimeoutError):
            if attempt >= retries:
                raise
            time.sleep(attempt * 2)
    raise RuntimeError("Unreachable")


def build_document_packet(start: datetime, stop: datetime) -> dict[str, Any]:
    return {
        "id": "document",
        "name": "WorldView Replay",
        "version": "1.0",
        "clock": {
            "interval": f"{iso_utc(start)}/{iso_utc(stop)}",
            "currentTime": iso_utc(start),
            "multiplier": 60,
            "range": "LOOP_STOP",
            "step": "SYSTEM_CLOCK_MULTIPLIER",
        },
    }


def build_adsb_packets(opensky: dict[str, Any], epoch: datetime, limit: int = 200) -> list[dict[str, Any]]:
    packets: list[dict[str, Any]] = []
    states = opensky.get("states") or []

    for idx, row in enumerate(states[:limit]):
        callsign = str(row[1] or f"UNK-{idx}").strip()
        lon = row[5]
        lat = row[6]
        alt = row[7] or 0
        velocity = row[9] or 0

        if lon is None or lat is None:
            continue

        lon_f = float(lon)
        lat_f = float(lat)
        alt_f = float(alt)
        vel_f = float(velocity)

        sampled = [
            0, lon_f, lat_f, alt_f,
            300, lon_f + 0.25, lat_f + 0.12, max(0.0, alt_f + 200.0),
            600, lon_f + 0.5, lat_f + 0.2, max(0.0, alt_f + 300.0),
        ]

        jamming = vel_f < 20 or vel_f > 380

        packets.append(
            {
                "id": f"flight-{callsign}-{idx}",
                "availability": f"{iso_utc(epoch)}/{iso_utc(epoch + timedelta(minutes=10))}",
                "billboard": {
                    "image": "https://cdn.jsdelivr.net/gh/cesiumlab/aircraft-icons@main/plane-blue.png",
                    "scale": 0.42,
                    "verticalOrigin": "BOTTOM",
                },
                "path": {
                    "resolution": 120,
                    "leadTime": 1800,
                    "trailTime": 1800,
                    "width": 1.2,
                    "material": {"solidColor": {"color": {"rgba": [0, 210, 255, 220]}}},
                },
                "position": {
                    "epoch": iso_utc(epoch),
                    "cartographicDegrees": sampled,
                },
                "properties": {
                    "callsign": callsign,
                    "gpsJamming": {"boolean": jamming},
                },
            }
        )

    return packets


def build_satellite_packets(tle_text: str, epoch: datetime, limit: int = 80) -> list[dict[str, Any]]:
    lines = [line.strip() for line in tle_text.splitlines() if line.strip()]
    packets: list[dict[str, Any]] = []

    triplets = len(lines) // 3
    for idx in range(min(triplets, limit)):
        name = lines[idx * 3]
        # Für Schritt 7 erzeugen wir sampled Platzhalter, echte Orbit-Rechnung folgt später im Swarm-Ausbau.
        phase = idx * 0.07
        sampled = []
        for t in (0, 600, 1200, 1800):
            lon = 45.0 + math.sin(phase + t / 1800.0) * 20.0
            lat = 25.0 + math.cos(phase + t / 2000.0) * 12.0
            alt = 450000 + idx * 120
            sampled.extend([t, lon, lat, alt])

        packets.append(
            {
                "id": f"sat-{idx}-{name.replace(' ', '_')}",
                "availability": f"{iso_utc(epoch)}/{iso_utc(epoch + timedelta(minutes=30))}",
                "point": {
                    "pixelSize": 6,
                    "color": {"rgba": [255, 230, 90, 255]},
                },
                "path": {
                    "resolution": 120,
                    "leadTime": 1800,
                    "trailTime": 1800,
                    "width": 1.0,
                    "material": {"solidColor": {"color": {"rgba": [255, 230, 90, 210]}}},
                },
                "label": {
                    "text": name,
                    "font": "10pt monospace",
                },
                "position": {
                    "epoch": iso_utc(epoch),
                    "cartographicDegrees": sampled,
                },
            }
        )

    return packets


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_once(output_root: Path, replay_date: str | None = None) -> tuple[Path, Path]:
    now = datetime.now(UTC)
    day = replay_date or now.strftime("%Y-%m-%d")
    base = output_root / "data" / "replay" / day

    opensky = fetch_json(OPENSKY_URL, source="opensky")
    celestrak = fetch_text(CELESTRAK_URL, source="celestrak")

    start = now.replace(second=0, microsecond=0)
    stop = start + timedelta(hours=6)

    satellites_packets = [build_document_packet(start, stop)] + build_satellite_packets(celestrak.payload, start)
    adsb_packets = [build_document_packet(start, stop)] + build_adsb_packets(opensky.payload, start)

    satellites_path = base / "satellites-part-01.czml"
    adsb_path = base / "adsb-part-01.czml"

    save_json(satellites_path, satellites_packets)
    save_json(adsb_path, adsb_packets)

    return satellites_path, adsb_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WorldView CZML Generator (Ubuntu/Cron)")
    parser.add_argument("--once", action="store_true", help="Einmaliger Lauf für Cron")
    parser.add_argument("--date", type=str, default=None, help="Replay-Datum YYYY-MM-DD")
    parser.add_argument("--out", type=str, default=".", help="Output-Root (Default: aktueller Ordner)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.once:
        raise SystemExit("Nur --once ist aktuell aktiviert. // Kostenfrei weil Free-Tier / GitHub Student Pack")

    out_root = Path(args.out).resolve()
    sat_path, adsb_path = run_once(out_root, args.date)

    print(f"OK: {sat_path}")
    print(f"OK: {adsb_path}")


if __name__ == "__main__":
    main()
