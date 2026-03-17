import sys
sys.path.insert(0, './')
from app.services.tle_service import fetch_tle_from_celestrak, parse_satellite_dict
from app.services.orbit_service import get_satellite_position
from skyfield.api import EarthSatellite, load

raw = fetch_tle_from_celestrak()
sats = parse_satellite_dict(raw)
ts = load.timescale()
LEO, MEO, GEO = [], [], []

success = 0
for norad, info in sats.items():
    pos = get_satellite_position(info)
    if pos:
        alt = pos.get("altitude_km")
        if alt is not None:
             success += 1
             if alt < 2000: LEO.append(norad)
             elif alt < 35786: MEO.append(norad)
             else: GEO.append(norad)
    try:
         EarthSatellite(info.get("tle1"), info.get("tle2"), info["name"], ts)
    except:
         pass
print(f"Alt Success: {success}, LEO: {len(LEO)}, MEO: {len(MEO)}, GEO: {len(GEO)}")
