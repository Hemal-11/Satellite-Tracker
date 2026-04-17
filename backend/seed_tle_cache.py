"""
seed_tle_cache.py — Run this to manually seed or refresh the TLE disk cache.

Useful when:
  - Backend restarts with only fallback sats (Celestrak rate-limited)
  - Deploying fresh on Render.com without a warm cache
  - Running: python seed_tle_cache.py

By-passes the GROUP=active rate-limit by fetching individual sub-groups.
"""
import requests
import time
import os

HEADERS = {"User-Agent": "SatelliteTracker/2.0 (hemal-satellite-tracker)"}

GROUPS = [
    "stations", "visual", "analyst", "starlink", "oneweb", "iridium",
    "gps-ops", "galileo", "beidou",
    "noaa", "goes", "resource", "sarsat", "dmc", "tdrss",
    "argos", "planet", "spire", "weather",
    "intelsat", "ses", "telesat", "globalstar",
    "amateur", "satnogs", "cubesat", "other",
    "science", "geodetic", "engineering", "education", "military",
]

CACHE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "tle_cache.txt"))


def seed():
    all_tle = ""
    seen_lines = set()
    total_sats = 0

    for group in GROUPS:
        try:
            url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
            r = requests.get(url, headers=HEADERS, timeout=(10, 30))
            if r.status_code == 200 and len(r.text) > 100:
                lines = r.text.strip().splitlines()
                added = 0
                i = 0
                while i + 2 < len(lines):
                    name = lines[i].strip()
                    l1 = lines[i + 1].strip()
                    l2 = lines[i + 2].strip()
                    if l1.startswith("1 ") and l2.startswith("2 ") and l1 not in seen_lines:
                        seen_lines.add(l1)
                        all_tle += name + "\n" + l1 + "\n" + l2 + "\n"
                        added += 1
                        i += 3
                    else:
                        i += 1
                total_sats += added
                print(f"[OK] {group}: +{added} (total: {total_sats})")
            elif r.status_code == 403:
                print(f"[SKIP] {group}: rate-limited (403)")
            else:
                print(f"[SKIP] {group}: HTTP {r.status_code}")
            time.sleep(0.3)
        except Exception as e:
            print(f"[ERR] {group}: {e}")

    if all_tle:
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            f.write(all_tle)
        print(f"\n[DONE] Saved {total_sats} satellites to {CACHE_PATH} ({len(all_tle):,} chars)")
    else:
        print("[FAIL] No data gathered.")


if __name__ == "__main__":
    seed()
