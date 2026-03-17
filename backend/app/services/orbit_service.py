# orbit_service.py

from math import isnan, sqrt
from skyfield.api import EarthSatellite, load

ts = load.timescale()

# ------------------------------------------------------------
# GET CURRENT SATELLITE POSITION + VELOCITY
# ------------------------------------------------------------
def get_satellite_position(sat_data: dict):
    """
    Accepts satellite dict from SAT_CACHE
    Builds EarthSatellite from TLE (no stored objects)
    Returns position + velocity (km/s)
    """

    try:
        tle1 = sat_data.get("tle1")
        tle2 = sat_data.get("tle2")
        name = sat_data.get("name", "UNKNOWN")

        if not tle1 or not tle2:
            return None

        satellite = EarthSatellite(tle1, tle2, name, ts)
        t = ts.now()

        geocentric = satellite.at(t)
        geo = geocentric.subpoint()

        lat = geo.latitude.degrees
        lon = geo.longitude.degrees
        alt = geo.elevation.km

        if any(map(isnan, [lat, lon, alt])):
            raise ValueError("NaN position")

        # Velocity magnitude (km/s)
        vx, vy, vz = geocentric.velocity.km_per_s
        velocity = sqrt(vx * vx + vy * vy + vz * vz)

        return {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "altitude_km": round(alt, 2),
            "velocity_kms": round(velocity, 2),
        }

    except Exception as e:
        print(f"⚠️ Orbit calc failed for {sat_data.get('name')}: {e}")
        return None


# ------------------------------------------------------------
# GET FUTURE POSITIONS (GROUND TRACK)
# ------------------------------------------------------------
def get_future_positions(sat_data: dict, minutes=90, step=1):
    """
    Computes future subpoints for ground track
    """

    positions = []

    try:
        tle1 = sat_data.get("tle1")
        tle2 = sat_data.get("tle2")
        name = sat_data.get("name", "UNKNOWN")

        if not tle1 or not tle2:
            return positions

        satellite = EarthSatellite(tle1, tle2, name, ts)

        for m in range(0, minutes, step):
            try:
                t = ts.now() + m / 1440.0  # minutes → days
                geo = satellite.at(t).subpoint()

                lat = geo.latitude.degrees
                lon = geo.longitude.degrees
                alt = geo.elevation.km

                if any(map(isnan, [lat, lon, alt])):
                    continue

                positions.append({
                    "lat": round(lat, 4),
                    "lon": round(lon, 4),
                    "alt_km": round(alt, 2),
                })

            except Exception:
                continue

    except Exception as e:
        print(f"⚠️ Ground track failed for {sat_data.get('name')}: {e}")

    return positions
