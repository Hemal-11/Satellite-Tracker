# tle_service.py
import requests
import csv
from skyfield.api import EarthSatellite, load

BASE = "https://celestrak.org/NORAD/elements"
SATCAT_CSV_URL = "https://celestrak.org/pub/satcat.csv"

ACTIVE_TLE_URL  = f"{BASE}/gp.php?GROUP=active&FORMAT=tle"
ACTIVE_TLE_URL2 = f"{BASE}/gp.php?GROUP=stations&FORMAT=tle"
ACTIVE_TLE_URL3 = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle"

# CelesTrak alternate JSON endpoint (parse TLE fields from JSON)
ACTIVE_JSON_URL = f"{BASE}/gp.php?GROUP=active&FORMAT=json"

ISS_TLE_URL     = f"{BASE}/stations.txt"

HEADERS = {
    "User-Agent": "SatelliteTracker/1.0 (educational project; contact: hemal@example.com)"
}


ts = load.timescale()


# --------------------------------------------------
# COUNTRY CATALOG (SAFE)
# --------------------------------------------------

def fetch_celestrak_catalog():
    """
    Fetch NORAD → country code mapping.
    Returns { norad_id: country_code }
    """
    try:
        resp = requests.get(SATCAT_CSV_URL, headers=HEADERS, stream=True, timeout=(5, 30))
        resp.raise_for_status()

        catalog = {}
        lines = (line.decode('utf-8', errors='ignore') for line in resp.iter_lines())
        reader = csv.reader(lines)
        
        # Skip header
        next(reader, None)
        
        for row in reader:
            if len(row) > 5:
                try:
                    catalog[int(row[2])] = row[5]
                except ValueError:
                    continue

        print(f"[SUCCESS] Country catalog loaded ({len(catalog)} entries)")
        return catalog

    except Exception as e:
        print("[WARNING] Country catalog unavailable:", e)
        return {}


# --------------------------------------------------
# TLE FETCH WITH DISK CACHE
# Celestrak returns HTTP 403 when data hasn't changed
# since your last download (rate-limit per 2h cycle).
# We save TLE responses to disk so restarts still work.
# --------------------------------------------------

import os
import time

_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "tle_cache.txt")
_CACHE_MAX_AGE_SECONDS = 4 * 60 * 60  # 4 hours

_EMBEDDED_FALLBACK_TLE = """ISS (ZARYA)
1 25544U 98067A   26106.84451400  .00004242  00000+0  85733-4 0  9992
2 25544  51.6329 243.6903 0006573 315.5681  44.4780 15.48789484562249
DMSP 5D-3 F16 (USA 172)
1 28054U 03048A   26106.91350183  .00000029  00000+0  38706-4 0  9997
2 28054  98.9945 130.3227 0006365 328.6452 127.4666 14.14475149160822
METEOSAT-9 (MSG-2)
1 28912U 05049B   26106.94867449  .00000135  00000+0  00000+0 0  9993
2 28912   9.2241  54.7549 0001991  60.9572 116.5182  1.00268548  6380
"""


def _save_tle_cache(text: str):
    """Save TLE text to disk cache file."""
    try:
        cache_path = os.path.abspath(_CACHE_FILE)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"[CACHE] Saved TLE cache ({len(text)} chars) → {cache_path}")
    except Exception as e:
        print(f"[CACHE] Could not save cache: {e}")


def _load_tle_cache() -> str:
    """
    Load TLE text from disk cache.
    Returns empty string if cache doesn't exist or is too old.
    """
    try:
        cache_path = os.path.abspath(_CACHE_FILE)
        if not os.path.exists(cache_path):
            return ""
        age = time.time() - os.path.getmtime(cache_path)
        if age > _CACHE_MAX_AGE_SECONDS:
            print(f"[CACHE] Cache is {age/3600:.1f}h old — will try to refresh")
            # Still return the data (it's better than the fallback)
        with open(cache_path, "r", encoding="utf-8") as f:
            data = f.read().strip()
        if len(data) > 200:
            print(f"[CACHE] Loaded TLE cache ({len(data)} chars, age {age/3600:.1f}h)")
            return data
    except Exception as e:
        print(f"[CACHE] Could not load cache: {e}")
    return ""


def _try_fetch_tle(url: str, label: str) -> str:
    """
    Try to fetch TLE text from a URL.
    Handles Celestrak 403 'not updated' gracefully — returns empty string.
    Returns non-empty string only when we got real fresh data.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=(10, 30))

        # Celestrak 403 = "data hasn't changed since your last download"
        # This is NOT a real error — just means use the cached copy.
        if resp.status_code == 403:
            print(f"[INFO] {label} returned 403 (data unchanged since last download — using cache)")
            return ""

        resp.raise_for_status()
        text = resp.text.strip()

        if len(text) > 200:  # sanity check — real TLE data is always large
            print(f"[SUCCESS] TLE data fetched from {label} ({len(text)} chars)")
            _save_tle_cache(text)
            return text

        print(f"[WARNING] {label} returned suspiciously short data ({len(text)} chars), skipping")
        return ""

    except Exception as e:
        print(f"[WARNING] {label} unreachable: {e}")
        return ""


def fetch_tle_from_celestrak() -> str:
    """
    Fetch live TLE data with disk-cache fallback.

    Priority order:
    1. Live fetch from Celestrak full active catalog
    2. Live fetch from Celestrak stations group (smaller, more reliable)
    3. Live fetch from Celestrak Starlink group
    4. Disk cache (from previous successful fetch)
    5. Embedded static fallback (ISS, Starlink, NOAA — 3 sats)
    """
    # Attempt live fetches
    data = _try_fetch_tle(ACTIVE_TLE_URL, "Celestrak active")
    if data:
        return data

    data = _try_fetch_tle(ACTIVE_TLE_URL2, "Celestrak stations")
    if data:
        return data

    data = _try_fetch_tle(ACTIVE_TLE_URL3, "Celestrak starlink")
    if data:
        return data

    # Fall back to disk cache (contains last successful full 15k-sat download)
    cached = _load_tle_cache()
    if cached:
        print("[CACHE] Using cached TLE data from previous successful fetch")
        return cached

    # Absolute last resort
    print("[WARNING] All TLE sources failed and no cache found — using embedded fallback (3 satellites)")
    return _EMBEDDED_FALLBACK_TLE


# --------------------------------------------------
# TLE PARSER (FIXED)
# --------------------------------------------------

def parse_satellite_dict(raw_tle: str):
    """
    Parses raw TLE text → satellite dict

    Returns:
    {
        norad: {
            norad,
            name,
            tle1,
            tle2,
            country_code,
            country_confidence
        }
    }
    """
    satellites = {}

    if not raw_tle:
        return satellites

    # ✅ CRITICAL FIX: split into lines properly
    lines = [l.strip() for l in raw_tle.splitlines() if l.strip()]

    country_map = fetch_celestrak_catalog()

    i = 0
    while i + 2 < len(lines):
        name = lines[i]
        l1 = lines[i + 1]
        l2 = lines[i + 2]

        # Validate TLE structure
        if not (l1.startswith("1 ") and l2.startswith("2 ")):
            i += 1
            continue

        try:
            norad = int(l1[2:7])

            code = country_map.get(norad)
            if code:
                confidence = "official"
            else:
                code = "UNKNOWN"
                confidence = "classified"

            satellites[norad] = {
                "norad": norad,
                "name": name,
                "tle1": l1,
                "tle2": l2,
                "country": code,
                "country_confidence": confidence,
            }

            i += 3

        except Exception:
            i += 1

    print(f"[SUCCESS] Parsed {len(satellites)} satellites from TLE data")
    return satellites


# --------------------------------------------------
# ISS HELPER
# --------------------------------------------------

def get_iss():
    resp = requests.get(ISS_TLE_URL, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    lines = resp.text.strip().splitlines()
    return EarthSatellite(lines[1], lines[2], lines[0], ts)
