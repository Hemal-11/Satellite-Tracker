import * as satellite from "satellite.js";

export function propagateTLE(tle1, tle2, date = new Date()) {
  const satrec = satellite.twoline2satrec(tle1, tle2);
  const pv = satellite.propagate(satrec, date);

  if (!pv.position) return null;

  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);

  return {
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    altKm: geo.height,
    velocityKmS: Math.sqrt(
      pv.velocity.x ** 2 +
      pv.velocity.y ** 2 +
      pv.velocity.z ** 2
    ),
  };
}
