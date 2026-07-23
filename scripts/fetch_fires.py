#!/usr/bin/env python3
"""Récupère les foyers actifs (feux) en Tunisie depuis l'API NASA FIRMS.

Associe chaque détection à un gouvernorat et une délégation, puis écrit
data/fires.json. Utilise uniquement la bibliothèque standard de Python.

Nécessite la variable d'environnement FIRMS_MAP_KEY.
Usage : FIRMS_MAP_KEY=xxxx python3 scripts/fetch_fires.py
"""

import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MAP_KEY = os.environ.get("FIRMS_MAP_KEY")
if not MAP_KEY:
    sys.exit("Erreur : variable FIRMS_MAP_KEY manquante.")

# Emprise (bounding box) de la Tunisie : ouest,sud,est,nord
BBOX = "7.5,30.2,11.7,37.6"
# Sources VIIRS (résolution 375 m) — on combine les satellites.
SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]
DAYS = 5  # maximum autorisé par l'API area de FIRMS

DAY_MS = 24 * 3600 * 1000


# ---------- Point-dans-polygone (ray casting) ----------
def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def point_in_polygon(x, y, polygon):
    # polygon = [outer_ring, hole1, ...]
    if not point_in_ring(x, y, polygon[0]):
        return False
    for hole in polygon[1:]:
        if point_in_ring(x, y, hole):
            return False
    return True


def point_in_feature(x, y, geom):
    if geom["type"] == "Polygon":
        return point_in_polygon(x, y, geom["coordinates"])
    if geom["type"] == "MultiPolygon":
        return any(point_in_polygon(x, y, poly) for poly in geom["coordinates"])
    return False


def bbox_of(geom):
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    def scan(rings):
        nonlocal min_x, min_y, max_x, max_y
        for ring in rings:
            for x, y in ring:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

    if geom["type"] == "Polygon":
        scan(geom["coordinates"])
    elif geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            scan(poly)
    return (min_x, min_y, max_x, max_y)


def index_layer(geojson, name_prop):
    out = []
    for f in geojson["features"]:
        out.append({
            "name": f["properties"][name_prop],
            "bbox": bbox_of(f["geometry"]),
            "geom": f["geometry"],
        })
    return out


def locate(index, lon, lat):
    for f in index:
        min_x, min_y, max_x, max_y = f["bbox"]
        if lon < min_x or lon > max_x or lat < min_y or lat > max_y:
            continue
        if point_in_feature(lon, lat, f["geom"]):
            return f["name"]
    return None


# ---------- Récupération FIRMS ----------
def fetch_source(source, retries=4):
    url = (f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
           f"{MAP_KEY}/{source}/{BBOX}/{DAYS}")
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                text = resp.read().decode("utf-8")
            break
        except Exception as e:  # noqa: BLE001 — 502/timeout transitoires côté NASA
            last_err = e
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
    else:
        raise last_err
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        try:
            lat = float(r["latitude"])
            lon = float(r["longitude"])
        except (ValueError, KeyError):
            continue
        rows.append({
            "lat": lat,
            "lon": lon,
            "acq_date": r["acq_date"],
            "acq_time": r["acq_time"],  # HHMM UTC
            "confidence": r.get("confidence", ""),  # n / l / h
            "frp": _num(r.get("frp")),
            "bright": _num(r.get("bright_ti4")),
            "daynight": r.get("daynight", ""),
            "satellite": source.replace("VIIRS_", "").replace("_NRT", ""),
        })
    return rows


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_iso(date, time_hhmm):
    t = str(time_hhmm).zfill(4)
    return f"{date}T{t[:2]}:{t[2:]}:00Z"


def main():
    print("Chargement des frontières administratives (pleine résolution)…")
    adm1 = index_layer(
        json.loads((ROOT / "data/_adm1_full.json").read_text("utf-8")),
        "shapeName",
    )
    adm2 = index_layer(
        json.loads((ROOT / "data/_adm2_full.json").read_text("utf-8")),
        "shapeName",
    )

    print("Récupération des foyers actifs depuis NASA FIRMS…")
    raw = []
    for source in SOURCES:
        try:
            rows = fetch_source(source)
            print(f"  {source}: {len(rows)} détections")
            raw.extend(rows)
        except Exception as e:  # noqa: BLE001
            print(f"  {source}: échec ({e})")

    print("Association aux gouvernorats et délégations (Tunisie uniquement)…")
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    fires = []
    skipped = 0
    for d in raw:
        gov = locate(adm1, d["lon"], d["lat"])
        if gov is None:
            # Détection hors du territoire tunisien (Algérie, Libye, mer) : ignorée.
            skipped += 1
            continue
        fires.append({
            "lat": round(d["lat"], 5),
            "lon": round(d["lon"], 5),
            "t": to_iso(d["acq_date"], d["acq_time"]),
            "conf": d["confidence"],
            "frp": d["frp"],
            "bright": d["bright"],
            "dn": d["daynight"],
            "sat": d["satellite"],
            "gov": gov,
            "del": locate(adm2, d["lon"], d["lat"]),
        })
    print(f"  {len(fires)} détections en Tunisie, {skipped} ignorées (hors territoire).")

    def is_24h(f):
        return now_ms - _parse_ms(f["t"]) <= DAY_MS

    by_gov = {}
    for f in fires:
        g = f["gov"] or "Hors gouvernorat"
        entry = by_gov.setdefault(
            g, {"gov": g, "total": 0, "last24h": 0, "delegations": {}})
        entry["total"] += 1
        if is_24h(f):
            entry["last24h"] += 1
        if f["del"]:
            entry["delegations"][f["del"]] = entry["delegations"].get(f["del"], 0) + 1

    governorates = []
    for g in by_gov.values():
        dels = sorted(
            ({"name": n, "count": c} for n, c in g["delegations"].items()),
            key=lambda x: -x["count"],
        )
        governorates.append({**g, "delegations": dels})
    governorates.sort(key=lambda g: -g["total"])

    out = {
        "updated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "NASA FIRMS — VIIRS (S-NPP, NOAA-20, NOAA-21), NRT",
        "window_days": DAYS,
        "total": len(fires),
        "total_last24h": sum(1 for f in fires if is_24h(f)),
        "governorates_touched": sum(
            1 for g in governorates if g["gov"] != "Hors gouvernorat"),
        "governorates": governorates,
        "fires": fires,
    }

    (ROOT / "data/fires.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"\nÉcrit data/fires.json — {out['total']} détections "
          f"({out['total_last24h']} sur 24h), "
          f"{out['governorates_touched']} gouvernorats touchés.")


def _parse_ms(iso):
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc).timestamp() * 1000


if __name__ == "__main__":
    main()
