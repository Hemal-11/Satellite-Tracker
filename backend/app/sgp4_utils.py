from sgp4.api import Satrec, jday
from datetime import datetime, timezone
import numpy as np
import math

EARTH_RADIUS_KM = 6371.0

def eci_to_geodetic(x, y, z):
    lon = math.atan2(y, x)
    hyp = math.sqrt(x*x + y*y)
    lat = math.atan2(z, hyp)
    alt = math.sqrt(x*x + y*y + z*z) - EARTH_RADIUS_KM

    return (
        math.degrees(lat),
        math.degrees(lon),
        alt
    )

def propagate_tle(tle1: str, tle2: str):
    sat = Satrec.twoline2rv(tle1, tle2)

    now = datetime.now(timezone.utc)
    jd, fr = jday(
        now.year, now.month, now.day,
        now.hour, now.minute, now.second + now.microsecond * 1e-6
    )

    error, position, velocity = sat.sgp4(jd, fr)

    if error != 0:
        return None

    x, y, z = position
    lat, lon, alt = eci_to_geodetic(x, y, z)

    return {
        "latitude": lat,
        "longitude": lon,
        "altitude_km": alt
    }
