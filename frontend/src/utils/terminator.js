import * as Cesium from "cesium";

/**
 * Builds a day/night terminator polyline around Earth
 * Returns Cartesian3[] suitable for Cesium Polyline
 */
export function buildTerminator(date = new Date()) {
  const positions = [];
  const julianDate = Cesium.JulianDate.fromDate(date);

  // Sun position in ECI
  const sunPos = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    julianDate
  );

  // Normalize sun vector
  Cesium.Cartesian3.normalize(sunPos, sunPos);

  for (let lon = -180; lon <= 180; lon += 2) {
    // Terminator latitude formula
    const lat =
      Math.atan(
        -Math.cos(Cesium.Math.toRadians(lon)) /
          Math.tan(Math.asin(sunPos.z))
      ) *
      Cesium.Math.DEGREES_PER_RADIAN;

    positions.push(
      Cesium.Cartesian3.fromDegrees(lon, lat, 0)
    );
  }

  return positions;
}
