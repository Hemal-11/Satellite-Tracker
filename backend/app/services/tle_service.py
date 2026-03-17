# tle_service.py
import requests
import csv
from skyfield.api import EarthSatellite, load

BASE = "https://celestrak.org/NORAD/elements"
SATCAT_CSV_URL = "https://celestrak.org/pub/satcat.csv"

ACTIVE_TLE_URL  = f"{BASE}/gp.php?GROUP=active&FORMAT=tle"
ISS_TLE_URL     = f"{BASE}/stations.txt"

HEADERS = {
    "User-Agent": "SatelliteTracker/1.0 (educational project)"
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
        resp = requests.get(SATCAT_CSV_URL, stream=True, timeout=(5, 30))
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

        print(f"✅ Country catalog loaded ({len(catalog)} entries)")
        return catalog

    except Exception as e:
        print("⚠️ Country catalog unavailable:", e)
        return {}


# --------------------------------------------------
# TLE FETCH (WITH FALLBACK)
# --------------------------------------------------

def fetch_tle_from_celestrak():
    try:
        resp = requests.get(ACTIVE_TLE_URL, timeout=(5, 20))
        resp.raise_for_status()
        print("✅ TLE data fetched from Celestrak")
        return resp.text

    except Exception as e:
        print("⚠️ Celestrak unreachable:", e)

        # 🔧 HARD FALLBACK — keeps backend alive
        return """ISS (ZARYA)
1 25544U 98067A   24026.51782528  .00016717  00000+0  10270-3 0  9993
2 25544  51.6400  13.0966 0003491  44.6363  85.5807 15.49815389435452
"""


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

    print(f"✅ Parsed {len(satellites)} satellites from TLE data")
    return satellites


# --------------------------------------------------
# ISS HELPER
# --------------------------------------------------

def get_iss():
    resp = requests.get(ISS_TLE_URL, timeout=10)
    resp.raise_for_status()
    lines = resp.text.strip().splitlines()
    return EarthSatellite(lines[1], lines[2], lines[0], ts)
