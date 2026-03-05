#!/usr/bin/env python3
"""
WorldView CZML Generator (Schritt 7)
- Kostenfrei weil Free-Tier / GitHub Student Pack
- Ubuntu/Cron-geeignet
- Nutzt nur kostenlose Quellen: OpenSky + Celestrak
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import time
from collections import defaultdict
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


@dataclass
class AISSample:
    timestamp: datetime
    lat: float
    lon: float
    sog: float | None = None
    cog: float | None = None
    heading: float | None = None


@dataclass
class AISTrack:
    mmsi: str
    ship_name: str | None
    ship_type: str | None
    samples: list[AISSample]


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


def normalize_csv_header(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").strip().lower())


def pick_first_non_empty(row: dict[str, Any], aliases: tuple[str, ...]) -> str | None:
    for alias in aliases:
        value = row.get(alias)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None

    # Kostenfrei weil Free-Tier / GitHub Student Pack
    # NOAA/OSINT-CSV kommt häufig als Unix-Sekunden, Unix-Millis oder ISO8601.
    try:
        if re.fullmatch(r"\d{10}", text):
            return datetime.fromtimestamp(int(text), tz=UTC)
        if re.fullmatch(r"\d{13}", text):
            return datetime.fromtimestamp(int(text) / 1000.0, tz=UTC)
    except ValueError:
        return None

    normalized = text.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue

    return None


def ingest_ais_csv(csv_path: Path) -> dict[str, AISTrack]:
    # Kostenfrei weil Free-Tier / GitHub Student Pack
    # Kein externer Parser: robustes stdlib-csv Ingest für NOAA/OSINT-Exporte.
    alias_groups = {
        "mmsi": ("mmsi", "vesselmmsi", "shipmmsi"),
        "timestamp": ("timestamp", "time", "datetime", "basedatetime", "positiontimestamp", "ts"),
        "lat": ("lat", "latitude", "y", "ycoord"),
        "lon": ("lon", "lng", "long", "longitude", "x", "xcoord"),
        "sog": ("sog", "speedoverground", "speed", "speedknots"),
        "cog": ("cog", "courseoverground", "course"),
        "heading": ("heading", "hdg", "trueheading"),
        "ship_name": ("shipname", "vesselname", "name"),
        "ship_type": ("shiptype", "vesseltype", "type"),
    }

    tracks: dict[str, AISTrack] = {}
    grouped_samples: dict[str, list[AISSample]] = defaultdict(list)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return {}

        field_map = {normalize_csv_header(field): field for field in reader.fieldnames if field is not None}

        resolved: dict[str, tuple[str, ...]] = {}
        for key, aliases in alias_groups.items():
            resolved_fields = tuple(field_map[a] for a in aliases if a in field_map)
            resolved[key] = resolved_fields

        for row in reader:
            mmsi = pick_first_non_empty(row, resolved["mmsi"])
            timestamp_raw = pick_first_non_empty(row, resolved["timestamp"])
            lat_raw = pick_first_non_empty(row, resolved["lat"])
            lon_raw = pick_first_non_empty(row, resolved["lon"])

            if not mmsi or not timestamp_raw or not lat_raw or not lon_raw:
                continue

            ts = parse_timestamp(timestamp_raw)
            lat = parse_float(lat_raw)
            lon = parse_float(lon_raw)
            if ts is None or lat is None or lon is None:
                continue

            sample = AISSample(
                timestamp=ts,
                lat=lat,
                lon=lon,
                sog=parse_float(pick_first_non_empty(row, resolved["sog"])),
                cog=parse_float(pick_first_non_empty(row, resolved["cog"])),
                heading=parse_float(pick_first_non_empty(row, resolved["heading"])),
            )
            grouped_samples[mmsi].append(sample)

            existing = tracks.get(mmsi)
            ship_name = pick_first_non_empty(row, resolved["ship_name"])
            ship_type = pick_first_non_empty(row, resolved["ship_type"])
            if existing is None:
                tracks[mmsi] = AISTrack(mmsi=mmsi, ship_name=ship_name, ship_type=ship_type, samples=[])
            else:
                if not existing.ship_name and ship_name:
                    existing.ship_name = ship_name
                if not existing.ship_type and ship_type:
                    existing.ship_type = ship_type

    for mmsi, samples in grouped_samples.items():
        samples.sort(key=lambda item: item.timestamp)
        deduped: list[AISSample] = []
        last_key: datetime | None = None
        for sample in samples:
            if last_key is not None and sample.timestamp == last_key:
                deduped[-1] = sample
                continue
            deduped.append(sample)
            last_key = sample.timestamp
        tracks[mmsi].samples = deduped

    return {mmsi: track for mmsi, track in tracks.items() if track.samples}


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


def build_ais_packets(tracks: dict[str, AISTrack], limit: int | None = None) -> list[dict[str, Any]]:
    packets: list[dict[str, Any]] = []
    track_items = list(tracks.items())
    if limit is not None:
        track_items = track_items[:limit]

    for idx, (mmsi, track) in enumerate(track_items):
        if not track.samples:
            continue

        start = track.samples[0].timestamp
        stop = track.samples[-1].timestamp
        epoch = start

        sampled: list[float] = []
        for sample in track.samples:
            seconds = (sample.timestamp - epoch).total_seconds()
            sampled.extend([seconds, sample.lon, sample.lat, 0.0])

        latest = track.samples[-1]
        label = track.ship_name or f"MMSI {mmsi}"

        packets.append(
            {
                "id": f"ais-{mmsi}-{idx}",
                "availability": f"{iso_utc(start)}/{iso_utc(stop)}",
                "label": {
                    "text": label,
                    "font": "10pt monospace",
                    "fillColor": {"rgba": [120, 220, 255, 230]},
                },
                "point": {
                    "pixelSize": 5,
                    "color": {"rgba": [120, 220, 255, 255]},
                },
                "path": {
                    "resolution": 120,
                    "leadTime": 1200,
                    "trailTime": 1200,
                    "width": 1.1,
                    "material": {"solidColor": {"color": {"rgba": [120, 220, 255, 210]}}},
                },
                "position": {
                    "epoch": iso_utc(epoch),
                    "cartographicDegrees": sampled,
                },
                "properties": {
                    "mmsi": mmsi,
                    "shipName": track.ship_name,
                    "shipType": track.ship_type,
                    "sog": latest.sog,
                    "cog": latest.cog,
                    "heading": latest.heading,
                },
            }
        )

    return packets


def chunk_packets(packets: list[dict[str, Any]], chunk_size: int) -> list[list[dict[str, Any]]]:
    if chunk_size <= 0:
        return [packets]
    return [packets[i : i + chunk_size] for i in range(0, len(packets), chunk_size)]


def get_ais_time_bounds(tracks: dict[str, AISTrack]) -> tuple[datetime, datetime] | None:
    starts: list[datetime] = []
    stops: list[datetime] = []
    for track in tracks.values():
        if not track.samples:
            continue
        starts.append(track.samples[0].timestamp)
        stops.append(track.samples[-1].timestamp)
    if not starts or not stops:
        return None
    return min(starts), max(stops)


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_once(
    output_root: Path,
    replay_date: str | None = None,
    ais_csv: Path | None = None,
    ais_chunk_size: int = 400,
) -> tuple[Path, Path, list[Path]]:
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

    ais_paths: list[Path] = []
    if ais_csv is not None and ais_csv.exists():
        tracks = ingest_ais_csv(ais_csv)
        if tracks:
            ais_packets = build_ais_packets(tracks)
            if ais_packets:
                bounds = get_ais_time_bounds(tracks)
                if bounds is None:
                    bounds = (start, stop)
                ais_start, ais_stop = bounds
                for part_idx, chunk in enumerate(chunk_packets(ais_packets, ais_chunk_size), start=1):
                    part_payload = [build_document_packet(ais_start, ais_stop)] + chunk
                    part_path = base / f"ais-part-{part_idx:02d}.czml"
                    save_json(part_path, part_payload)
                    ais_paths.append(part_path)

    return satellites_path, adsb_path, ais_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WorldView CZML Generator (Ubuntu/Cron)")
    parser.add_argument("--once", action="store_true", help="Einmaliger Lauf für Cron")
    parser.add_argument("--date", type=str, default=None, help="Replay-Datum YYYY-MM-DD")
    parser.add_argument("--out", type=str, default=".", help="Output-Root (Default: aktueller Ordner)")
    parser.add_argument(
        "--ais-csv",
        type=str,
        default=None,
        help="Optionaler AIS-CSV-Pfad für Replay-Ingest (NOAA/OSINT).",
    )
    parser.add_argument(
        "--ais-chunk-size",
        type=int,
        default=400,
        help="AIS-Entities pro Multi-Part-CZML-Datei (Default: 400).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.once:
        raise SystemExit("Nur --once ist aktuell aktiviert. // Kostenfrei weil Free-Tier / GitHub Student Pack")

    out_root = Path(args.out).resolve()
    ais_csv = Path(args.ais_csv).resolve() if args.ais_csv else None
    sat_path, adsb_path, ais_paths = run_once(
        out_root,
        args.date,
        ais_csv=ais_csv,
        ais_chunk_size=args.ais_chunk_size,
    )

    print(f"OK: {sat_path}")
    print(f"OK: {adsb_path}")
    for ais_path in ais_paths:
        print(f"OK: {ais_path}")


if __name__ == "__main__":
    main()
