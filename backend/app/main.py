from fastapi import FastAPI, HTTPException, Request, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
import re
from datetime import datetime, timedelta
import math
import os
import time
from collections import defaultdict
from dotenv import load_dotenv

from skyfield.api import EarthSatellite, load, wgs84, utc

from app.services.tle_service import (
    fetch_tle_from_celestrak,
    parse_satellite_dict,
)
from app.services.orbit_service import get_satellite_position

# --------------------------------------------------
# ENVIRONMENT
# --------------------------------------------------

load_dotenv()

# CORS: comma-separated origins in .env, or * for fully public read-only API
_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = (
    ["*"] if _raw_origins.strip() == "*"
    else [o.strip() for o in _raw_origins.split(",") if o.strip()]
)

# --------------------------------------------------
# NATIVE FASTAPI RATE LIMITER
# In-memory sliding-window counter (no third-party lib needed).
# Stores { ip: [(timestamp, count), ...] } per route key.
# --------------------------------------------------

_rate_store: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))

def rate_limit(max_calls: int, window_seconds: int = 60):
    """
    FastAPI dependency factory.
    Usage: Depends(rate_limit(30, 60))  → 30 req per 60 s per IP.
    """
    def dependency(request: Request):
        ip = request.client.host if request.client else "unknown"
        route = request.url.path
        key = f"{route}:{ip}"
        now = time.monotonic()
        cutoff = now - window_seconds

        # Prune old buckets
        _rate_store[route][ip] = [ts for ts in _rate_store[route][ip] if ts > cutoff]

        if len(_rate_store[route][ip]) >= max_calls:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: {max_calls} requests per {window_seconds}s. Try again later."
            )
        _rate_store[route][ip].append(now)

    return dependency

# --------------------------------------------------
# FASTAPI SETUP
# --------------------------------------------------

app = FastAPI()

# GZip compression for massive JSON satellite arrays
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    # To restrict: set ALLOWED_ORIGINS=https://yourapp.com in backend/.env
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# --------------------------------------------------
# SECURITY HEADERS
# --------------------------------------------------

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self)"
    return response

# --------------------------------------------------
# INPUT VALIDATION HELPERS
# --------------------------------------------------

def validate_latlon(lat: float, lon: float):
    """Raise 400 if lat/lon are out of geographic range."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="Invalid latitude or longitude")

def validate_norad(norad: int):
    """Raise 400 if NORAD ID is outside valid range."""
    if not (1 <= norad <= 99999):
        raise HTTPException(status_code=400, detail="Invalid NORAD ID (must be 1–99999)")

# --------------------------------------------------
# GLOBAL CACHES
# --------------------------------------------------

SAT_CACHE = {}
SAT_INDEX = []
POS_CACHE = {}
SKYFIELD_SATS = {}

LEO, MEO, GEO = [], [], []
LEO_MAX = 2000
GEO_MIN = 35786

ts = load.timescale()

# --------------------------------------------------
# COUNTRY RESOLUTION
# --------------------------------------------------

COUNTRY_NAME_MAP = {
    "US": "United States",
    "CIS": "Russia/CIS",
    "RU": "Russia",
    "PRC": "China",
    "CN": "China",
    "IND": "India",
    "IN": "India",
    "UK": "United Kingdom",
    "FR": "France",
    "DE": "Germany",
    "GER": "Germany",
    "JPN": "Japan",
    "JP": "Japan",
    "IRN": "Iran",
    "ISR": "Israel",
    "KZ": "Kazakhstan",
    "BR": "Brazil",
    "BRAZ": "Brazil",
    "ESA": "European Space Agency",
    "CAN": "Canada",
    "AUS": "Australia",
    "SKOR": "South Korea",
    "GLOB": "Globalstar",
    "ARGN": "Argentina",
    "IT": "Italy",
}

def resolve_country(info: dict):
    name_upper = info.get("name", "").upper()
    if "ISS" in name_upper or info.get("norad") == 25544:
        return {"name": "International", "confidence": "override"}
    code = info.get("country")
    if not code:
        return {"name": "Unknown", "confidence": "classified"}
    return {
        "name": COUNTRY_NAME_MAP.get(code, code),
        "confidence": "official"
    }

# --------------------------------------------------
# CATEGORY + OPERATOR
# --------------------------------------------------

def classify_operator(name: str) -> str | None:
    n = name.upper()
    if "STARLINK" in n:
        return "SpaceX (United States)"
    if "ISS" in n:
        return "International Partnership"
    return None

def classify_category(name: str) -> str:
    n = name.upper()

    if any(k in n for k in ["ISS", "TIANGONG", "CSS", "MIR"]):
        return "station"

    if any(k in n for k in [
        "GPS", "NAVSTAR", "GLONASS", "GALILEO", "BEIDOU", "IRNSS", "NAVIC",
        "QZSS", "NAVSAT", "TRANSIT"
    ]):
        return "nav"

    if any(k in n for k in [
        "STARLINK", "ONEWEB", "IRIDIUM", "GLOBALSTAR", "INTELSAT", "INMARSAT",
        "SES", "EUTELSAT", "TELSTAR", "AMOS", "HISPASAT", "ASIASAT", "THURAYA",
        "CHINASAT", "APSTAR", "KOREASAT", "NIGCOMSAT", "ARABSAT", "YAMAL",
        "EXPRESS", "G-SPACE", "O3B", "VIASAT", "ECHOSTAR", "SIRIUS", "XM ", "JCSAT",
        "SKYNET", "OPTUS", "NUSANTARA", "KUIPIER", "ASTRA", "MEASAT", "ABS",
        "YINHE", "ZHONGXING", "HONGYAN"
    ]):
        return "comm"

    if any(k in n for k in [
        "LANDSAT", "SENTINEL", "NOAA", "METEOR", "FENGYUN", "RESOURCESAT",
        "CARTOSAT", "RADARSAT", "SPOT", "KOMPSAT", "GAOFEN", "WORLDVIEW",
        "PLEIADES", "GOES", "HIMAWARI", "MSG", "MTSAT", "ELEKTRO", "METEOSAT",
        "COSMO-SKYMED", "SUOMI", "AQUA", "TERRA", "JASON", "ICESAT", "CRYOSAT",
        "SMAP", "GPM", "YUNHAI", "HJ-", "SUPERDOVE", "DOVE", "SKYSAT", "ICEYE",
        "CAPELLA", "HEAD", "JILIN", "FY-", "CBERS", "PLANET", "FLOCK", "LEMUR",
        "ZY-", "RS-", "FORMOSAT", "SITRO", "-AIS", " AIS ", "EXACTVIEW", "SPIRE"
    ]):
        return "earth"

    if any(k in n for k in [
        "HUBBLE", "JWST", "WEBB", "CHANDRA", "XMM", "KEPLER", "TESS",
        "HERSCHEL", "PLANCK", "EXOSAT", "SWIFT", "FERMI", "NUSTAR", "INTEGRAL",
        "ROSETTA", "BELA", "LRO", "SOHO", "STEREO", "MMS", "CLUSTER", "GEOTAIL",
        "WIND", "ACE", "DSCOVR", "SHIYAN", "SJ-", "ASTRID", "CHIPSAT", "CUTE",
        "SPEKTR", "AURA", "ASTROSAT", "COROT", "GALEX", "RXTE", "SUZAKU"
    ]):
        return "science"

    if any(k in n for k in [
        "USA", "NROL", "KH-", "KEYHOLE", "LACROSSE", "ONYX", "ORION",
        "COSMOS", "OFEQ", "YAOGAN", "SAR-LUPE", "FIA", "DSP", "SBIRS",
        "AEHF", "WGS", "MUOS", "MILSTAR", "SYRACUSE", "SICRAL", "ZHIHUI", "TJS"
    ]):
        return "military"

    if "GEO" in n or "GSO" in n:
        return "comm"

    return "Unknown (publicly unavailable)"


# --------------------------------------------------
# STARTUP: LOAD TLE + SKYFIELD OBJECTS
# --------------------------------------------------

@app.on_event("startup")
async def startup_event():
    global SAT_CACHE, SAT_INDEX, POS_CACHE, SKYFIELD_SATS, LEO, MEO, GEO

    raw = fetch_tle_from_celestrak()

    if not raw.strip():
        print("❌ No TLE data available — starting with empty dataset")
        SAT_CACHE = {}
        SAT_INDEX = []
        return

    SAT_CACHE = parse_satellite_dict(raw)
    SAT_INDEX = sorted(SAT_CACHE.keys())

    POS_CACHE.clear()
    SKYFIELD_SATS.clear()
    LEO.clear()
    MEO.clear()
    GEO.clear()

    for norad, info in SAT_CACHE.items():
        pos = get_satellite_position(info)
        POS_CACHE[norad] = pos

        alt = pos.get("altitude_km") if pos else None
        if alt is not None:
            if alt < LEO_MAX:
                LEO.append(norad)
            elif alt < GEO_MIN:
                MEO.append(norad)
            else:
                GEO.append(norad)

        try:
            tle1 = info.get("tle1")
            tle2 = info.get("tle2")
            if tle1 and tle2:
                SKYFIELD_SATS[norad] = EarthSatellite(
                    tle1, tle2, info["name"], ts
                )
        except Exception:
            pass

# --------------------------------------------------
# OUTPUT FORMATTER
# --------------------------------------------------

def to_output(norad: int, info: dict):
    orbit = (
        "LEO" if norad in LEO else
        "MEO" if norad in MEO else
        "GEO" if norad in GEO else
        "UNKNOWN"
    )

    country = resolve_country(info)
    pos = POS_CACHE.get(norad)
    sat_obj = SKYFIELD_SATS.get(norad)

    category = classify_category(info["name"])
    cat_confidence = (
        "low" if category == "Unknown (publicly unavailable)"
        else ("medium" if category == "military" else "high")
    )

    inclination = None
    period = None
    if sat_obj:
        try:
            inclination = round(math.degrees(sat_obj.model.inclo), 2)
            if sat_obj.model.no_kozai > 0:
                period = round((2 * math.pi) / sat_obj.model.no_kozai, 2)
        except Exception:
            pass

    launch_year = None
    tle1 = info.get("tle1", "")
    if len(tle1) > 11:
        yy_str = tle1[9:11].strip()
        if yy_str.isdigit():
            yy = int(yy_str)
            launch_year = 1900 + yy if yy > 56 else 2000 + yy

    return {
        "norad": norad,
        "name": info["name"],
        "tle1": tle1,
        "tle2": info.get("tle2", ""),
        "orbit": orbit,
        "category": category,
        "category_confidence": cat_confidence,
        "country": country["name"],
        "country_confidence": country["confidence"],
        "operator": classify_operator(info["name"]) or "Unknown",
        "launch_year": launch_year,
        "inclination_deg": inclination,
        "period_min": period,
        "position": {
            "latitude": pos.get("latitude") if pos else None,
            "longitude": pos.get("longitude") if pos else None,
            "altitude_km": pos.get("altitude_km") if pos else None,
        },
        "velocity_kms": pos.get("velocity_kms") if pos else None,
    }

# --------------------------------------------------
# SEARCH
# --------------------------------------------------

def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())

@app.get("/search")
def search(
    name: str = Query(..., min_length=2, max_length=50),
    _rl: None = Depends(rate_limit(30, 60)),
):
    q = normalize(name)
    return [
        {"norad": n, "name": SAT_CACHE[n]["name"]}
        for n in SAT_INDEX
        if q in normalize(SAT_CACHE[n]["name"])
    ]

# --------------------------------------------------
# OBSERVER HELPERS
# --------------------------------------------------

def azimuth_to_direction(az: float) -> str:
    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    idx = int((az + 22.5) // 45) % 8
    return directions[idx]


def estimate_visibility(max_elevation: float, category: str):
    if max_elevation >= 60:
        return {"level": "naked_eye", "hint": "Very bright, easily visible to naked eye", "quality": 5}
    if max_elevation >= 40:
        return {"level": "naked_eye", "hint": "Bright, visible to naked eye", "quality": 4}
    if max_elevation >= 25:
        return {"level": "binoculars", "hint": "Faint, binoculars recommended", "quality": 3}
    if max_elevation >= 15:
        return {"level": "telescope", "hint": "Very faint, small telescope required", "quality": 2}
    return {"level": "unlikely", "hint": "Too low on horizon, unlikely to see", "quality": 1}


# --------------------------------------------------
# PASS PREDICTION
# --------------------------------------------------

@app.get("/satellite/{norad}/passes")
def get_passes(
    norad: int,
    lat: float,
    lon: float,
    _rl: None = Depends(rate_limit(20, 60)),
):
    validate_norad(norad)
    validate_latlon(lat, lon)

    sat = SKYFIELD_SATS.get(norad)
    if not sat:
        return {"norad": norad, "passes": [], "best_pass": None}

    observer = wgs84.latlon(lat, lon)
    now_utc = datetime.utcnow().replace(tzinfo=utc)
    later_utc = now_utc + timedelta(hours=24)
    t0 = ts.from_datetime(now_utc)
    t1 = ts.from_datetime(later_utc)

    try:
        times, events = sat.find_events(observer, t0, t1, altitude_degrees=10.0)
    except Exception:
        return {"norad": norad, "passes": [], "best_pass": None}

    passes = []
    current = None

    for t, e in zip(times, events):
        if e == 0:
            current = {"rise": t.utc_iso(), "max": None, "set": None, "max_elevation": 0.0}
        elif e == 1 and current is not None:
            try:
                alt, az, _ = (sat - observer).at(t).altaz()
                max_el = round(float(alt.degrees), 1)
                az_deg = round(float(az.degrees), 1)
                visibility = estimate_visibility(max_el, classify_category(SAT_CACHE[norad]["name"]))
                current["max"] = t.utc_iso()
                current["max_elevation"] = max_el
                current["azimuth_deg"] = az_deg
                current["direction"] = azimuth_to_direction(az_deg)
                current["visibility"] = visibility["level"]
                current["visibility_hint"] = visibility["hint"]
                current["quality"] = visibility["quality"]
                magnitude = None
                if max_el > 0:
                    base_mag = 4.0
                    cat = classify_category(SAT_CACHE[norad]["name"])
                    if cat == "station": base_mag = -2.0
                    elif cat == "comm": base_mag = 3.0
                    elif cat == "earth": base_mag = 2.5
                    distance_factor = (90 - alt.degrees) / 90.0 if alt.degrees > 0 else 1.0
                    magnitude = round(base_mag + (distance_factor * 3.0), 1)
                current["magnitude"] = magnitude
            except Exception:
                current["max"] = t.utc_iso()
        elif e == 2 and current is not None:
            current["set"] = t.utc_iso()
            passes.append(current)
            current = None

    if not passes:
        return {"norad": norad, "passes": [], "best_pass": None}

    best_pass = max(passes, key=lambda p: p.get("max_elevation", 0.0))
    return {"norad": norad, "passes": passes, "best_pass": best_pass}


# --------------------------------------------------
# ORBIT PATH
# --------------------------------------------------

from app.services.orbit_service import get_future_positions

@app.get("/satellite/{norad}/orbit")
def get_orbit_path(
    norad: int,
    _rl: None = Depends(rate_limit(30, 60)),
):
    validate_norad(norad)
    if norad not in SAT_CACHE:
        raise HTTPException(status_code=404, detail="Satellite not found")
    path = get_future_positions(SAT_CACHE[norad], minutes=90, step=1)
    return {"norad": norad, "path": path}

# --------------------------------------------------
# PASS PATH
# --------------------------------------------------

@app.get("/satellite/{norad}/pass-path")
def get_pass_path(
    norad: int,
    lat: float,
    lon: float,
    _rl: None = Depends(rate_limit(20, 60)),
):
    validate_norad(norad)
    validate_latlon(lat, lon)

    sat = SKYFIELD_SATS.get(norad)
    if not sat:
        raise HTTPException(status_code=400, detail="Invalid satellite")

    observer = wgs84.latlon(lat, lon)
    now_utc = datetime.utcnow().replace(tzinfo=utc)
    t0 = ts.from_datetime(now_utc)
    t1 = ts.from_datetime(now_utc + timedelta(hours=24))

    times, events = sat.find_events(observer, t0, t1, altitude_degrees=10.0)

    pass_times = []
    collecting = False
    for t, e in zip(times, events):
        if e == 0:
            collecting = True
        if collecting:
            pass_times.append(t)
        if e == 2:
            break

    path = []
    for t in pass_times:
        sp = sat.at(t).subpoint()
        path.append({"lat": sp.latitude.degrees, "lon": sp.longitude.degrees})

    return {"norad": norad, "path": path}

# --------------------------------------------------
# API ENDPOINTS
# --------------------------------------------------

@app.get("/")
def read_root():
    return {
        "status": "Satellite Tracker API is running!",
        "endpoints": ["/api/tle/all", "/api/stats"]
    }

@app.get("/api/tle/all")
def get_all(_rl: None = Depends(rate_limit(5, 60))):
    return [to_output(n, SAT_CACHE[n]) for n in SAT_INDEX]

@app.get("/api/stats")
def stats(_rl: None = Depends(rate_limit(60, 60))):
    return {
        "status": "ok",
        "satellites": len(SAT_CACHE),
        "leo": len(LEO),
        "meo": len(MEO),
        "geo": len(GEO),
    }

# --------------------------------------------------
# SKY VIEW PATH
# --------------------------------------------------

@app.get("/satellite/{norad}/sky-path")
def get_sky_path(
    norad: int,
    lat: float,
    lon: float,
    _rl: None = Depends(rate_limit(20, 60)),
):
    validate_norad(norad)
    validate_latlon(lat, lon)

    sat = SKYFIELD_SATS.get(norad)
    if not sat:
        raise HTTPException(status_code=400, detail="Invalid satellite")

    observer = wgs84.latlon(lat, lon)
    now_utc = datetime.utcnow().replace(tzinfo=utc)
    t0 = ts.from_datetime(now_utc)
    t1 = ts.from_datetime(now_utc + timedelta(hours=24))

    try:
        times, events = sat.find_events(observer, t0, t1, altitude_degrees=10.0)
    except Exception:
        return {"path": []}

    samples = []
    collecting = False
    for t, e in zip(times, events):
        if e == 0:
            collecting = True
        if collecting:
            try:
                alt, az, _ = (sat - observer).at(t).altaz()
                samples.append({
                    "time": t.utc_iso(),
                    "az": round(float(az.degrees), 2),
                    "el": round(float(alt.degrees), 2),
                })
            except Exception:
                pass
        if e == 2:
            break

    return {"path": samples}


@app.get("/observer/sky")
def observer_sky(
    lat: float,
    lon: float,
    _rl: None = Depends(rate_limit(10, 60)),
):
    validate_latlon(lat, lon)

    observer = wgs84.latlon(lat, lon)
    now = ts.now()
    visible = []

    for norad, sat in SKYFIELD_SATS.items():
        try:
            alt, az, _ = (sat - observer).at(now).altaz()
            if alt.degrees > 10:
                visible.append({
                    "norad": norad,
                    "az": round(float(az.degrees), 1),
                    "el": round(float(alt.degrees), 1),
                })
        except Exception:
            continue

    return {"satellites": visible}
