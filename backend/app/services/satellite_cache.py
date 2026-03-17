# satellite_cache.py

LEO_MAX = 2000
GEO_MIN = 35786

class SatelliteCache:
    def __init__(self):
        self.all = []
        self.leo = []
        self.meo = []
        self.geo = []

    def load(self, satellites):
        self.all = satellites
        self.leo.clear()
        self.meo.clear()
        self.geo.clear()

        for sat in satellites:
            pos = sat.get("position")
            if not pos:
                continue

            alt = pos.get("altitude_km", 0)

            # 🔑 DO NOT DROP METADATA
            sat.setdefault("country", "UNKNOWN")
            sat.setdefault("category", "unknown")

            if alt < LEO_MAX:
                self.leo.append(sat)
            elif alt < GEO_MIN:
                self.meo.append(sat)
            else:
                self.geo.append(sat)

    def stats(self):
        return {
            "leo": len(self.leo),
            "meo": len(self.meo),
            "geo": len(self.geo),
            "total": len(self.all),
        }

sat_cache = SatelliteCache()
