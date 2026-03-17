from skyfield.api import load, wgs84, EarthSatellite
from datetime import datetime, timedelta

ts = load.timescale()

def compute_passes(tle_lines, lat, lon, hours=24):
    """
    Compute visible satellite passes over an observer location.
    Returns a list of passes with rise, max elevation, and set times.
    """

    try:
        lat = float(lat)
        lon = float(lon)
    except ValueError:
        raise ValueError("Invalid latitude or longitude")

    satellite = EarthSatellite(
        tle_lines[1],
        tle_lines[2],
        tle_lines[0],
        ts
    )

    observer = wgs84.latlon(lat, lon)

    t0 = ts.now()
    t1 = ts.from_datetime(
        datetime.utcnow() + timedelta(hours=hours)
    )

    times, events = satellite.find_events(
        observer, t0, t1, altitude_degrees=10.0
    )

    passes = []
    current = {}

    for t, e in zip(times, events):
        if e == 0:  # rise
            current = {"rise": t.utc_iso()}
        elif e == 1:  # culminate
            alt, az, _ = (satellite - observer).at(t).altaz()
            current["max_elevation"] = round(alt.degrees, 2)
        elif e == 2:  # set
            current["set"] = t.utc_iso()
            passes.append(current)
            current = {}

    return passes
