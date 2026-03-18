// frontend/src/api/satellites.js

const API_BASE = "https://satellite-tracker-api.onrender.com";

function normalizeSatellite(s) {
  return {
    norad: Number(s.norad),
    name: s.name,
    orbit: s.orbit,
    category: s.category ?? "unknown",

    country: s.country ?? "Unknown",
    country_confidence: s.country_confidence ?? "classified",

    velocity_kms:
      typeof s.velocity_kms === "number" ? s.velocity_kms : null,

    position: {
      latitude: s.position?.latitude ?? null,
      longitude: s.position?.longitude ?? null,
      altitude_km: s.position?.altitude_km ?? null,
    },
  };
}

export function loadChunkedSatellites(group = "all") {
  async function* generator() {
    // Backend doesn't support chunking natively, so we fetch all and yield
    const res = await fetch(`${API_BASE}/api/tle/all`);
    if (!res.ok) return;

    const data = await res.json();
    const totalAvailable = data.length;

    yield { type: "meta", total: totalAvailable };

    // Yield in one big chunk 
    const items = data.map(normalizeSatellite);
    yield { type: "chunk", items };
  }

  return generator();
}
